#!/usr/bin/env python3
"""Build the static English essay practice index from mirrored NCVVO ZIP files."""

from __future__ import annotations

import json
import math
import re
import shutil
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse
from xml.etree import ElementTree

from crop_utils import (
    grayscale_image_from_png,
    source_image_metadata,
    trim_crop_bottom_whitespace,
)
from pdf_utils import pdftotext, png_dimensions, render_pdf_page_to_png


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "english-essay.js"
ASSET_ROOT = ROOT / "files" / "interactive" / "english-essay"
ASSET_URL_PREFIX = "./files/interactive/english-essay"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_ENGLISH_ESSAY="
SUBJECT = "Engleski jezik"
TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}
COMMON_TEXT_FIXES = {
    "schoo/s": "schools",
    "Sfudenfs": "Students",
}
SOURCE_RENDER_DPI = 144
SOURCE_TASK_HORIZONTAL_PADDING = 8
SOURCE_TASK_VERTICAL_PADDING = 6
SOURCE_FOOTER_MARGIN = 65


@dataclass(frozen=True)
class PdfLine:
    text: str
    first_word: str
    x_min: float
    x_max: float
    y_min: float
    y_max: float


@dataclass(frozen=True)
class PdfPage:
    number: int
    width: float
    height: float
    lines: list[PdfLine]


@dataclass(frozen=True)
class SourceCrop:
    page: PdfPage
    x_min: float
    y_min: float
    x_max: float
    y_max: float


def load_archive_index() -> dict[str, Any]:
    source = ARCHIVE_INDEX.read_text(encoding="utf-8").strip()
    if not source.startswith(ARCHIVE_PREFIX) or not source.endswith(";"):
        raise ValueError(f"Unsupported archive index format: {ARCHIVE_INDEX}")
    return json.loads(source[len(ARCHIVE_PREFIX) : -1])


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value.casefold()).replace("đ", "d")
    ascii_value = normalized.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")


def normalize_term(term: str) -> str:
    return TERM_ALIASES.get(term, term)


def exam_id(exam: dict[str, Any]) -> str:
    return f"engleski-{exam['level'].casefold()}-{exam['year']}-{slugify(normalize_term(exam['term']))}"


def local_archive_path(url: str) -> Path:
    parsed_url = urlparse(url)
    if parsed_url.scheme or parsed_url.netloc or parsed_url.query or parsed_url.fragment:
        raise ValueError(f"Unsupported local archive URL: {url}")

    relative_path = Path(unquote(parsed_url.path.removeprefix("./")))
    archive_path = ROOT / relative_path
    archive_path.resolve().relative_to(ROOT.resolve())
    return archive_path


def normalized_name(name: str) -> str:
    filename = Path(name).name
    normalized = unicodedata.normalize("NFD", filename).casefold()
    ascii_name = normalized.encode("ascii", "ignore").decode()
    return f"{normalized} {ascii_name}"


def pdf_text(contents: bytes) -> str:
    return pdftotext(
        contents,
        "-layout",
        required_message="pdftotext is required to build English essay data",
    )


def pdf_bbox_pages(contents: bytes) -> list[PdfPage]:
    xml = pdftotext(
        contents,
        "-bbox-layout",
        required_message="pdftotext is required to build English essay source images",
        failure_prefix="pdftotext -bbox-layout failed",
    )
    xml = "".join(character for character in xml if character in "\t\n\r" or ord(character) >= 32)
    root = ElementTree.fromstring(xml)
    pages: list[PdfPage] = []
    for page_number, page_element in enumerate(root.findall(".//{*}page"), start=1):
        lines: list[PdfLine] = []
        for line_element in page_element.findall(".//{*}line"):
            words = line_element.findall("./{*}word")
            if not words:
                continue
            word_texts = ["".join(word.itertext()).strip() for word in words]
            lines.append(
                PdfLine(
                    text=" ".join(word for word in word_texts if word),
                    first_word=word_texts[0],
                    x_min=float(words[0].attrib["xMin"]),
                    x_max=float(words[-1].attrib["xMax"]),
                    y_min=float(line_element.attrib["yMin"]),
                    y_max=float(line_element.attrib["yMax"]),
                )
            )
        pages.append(
            PdfPage(
                number=page_number,
                width=float(page_element.attrib["width"]),
                height=float(page_element.attrib["height"]),
                lines=lines,
            )
        )
    return pages


def sorted_page_lines(page: PdfPage) -> list[PdfLine]:
    return sorted(page.lines, key=lambda line: (line.y_min, line.x_min))


def is_blocked_pdf_name(name: str) -> bool:
    normalized = normalized_name(name)
    return bool(re.search(r"koncept|klju|kljuc|list|odgovor|bodov", normalized))


def find_essay_paper(archive: zipfile.ZipFile, names: list[str]) -> tuple[str, bytes, str]:
    essay_names = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and not is_blocked_pdf_name(name)
        and re.search(r"esej", normalized_name(name))
    ]
    if essay_names:
        name = sorted(essay_names, key=lambda item: normalized_name(Path(item).name))[0]
        contents = archive.read(name)
        return name, contents, pdf_text(contents)

    writing_candidates: list[tuple[int, str, bytes, str]] = []
    for name in names:
        if not name.casefold().endswith(".pdf") or is_blocked_pdf_name(name):
            continue

        contents = archive.read(name)
        text = pdf_text(contents)
        if not re.search(r"Write an essay of\s+200\s*[-–]\s*250\s+words", text):
            continue
        if not re.search(r"Writing Paper|ISPIT PISANJA", text, flags=re.IGNORECASE):
            continue

        normalized = normalized_name(name)
        score = 0 if re.search(r"\bik[-_ ]*2\b|knjizica 2", normalized) else 1
        writing_candidates.append((score, name, contents, text))

    if len(writing_candidates) != 1:
        writing_candidates.sort(key=lambda item: (item[0], normalized_name(item[1])))
    if not writing_candidates:
        raise ValueError("Could not find an English A writing paper")

    _, name, contents, text = writing_candidates[0]
    return name, contents, text


def should_skip_task_line(line: str) -> bool:
    return bool(
        re.fullmatch(
            r"A|Engleski jezik|Writing Paper|Writing paper|vi[šs]a razina|ISPIT PISANJA|Task 6|Question 41",
            line,
            flags=re.IGNORECASE,
        )
        or re.search(r"\bENG\s*A\b.*(?:IK|D-S|indd)", line, flags=re.IGNORECASE)
        or re.fullmatch(r"\d{1,2}(?:/\d{1,2})?", line)
    )


def parse_task_text(text: str) -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    collected: list[str] = []
    collecting = False

    for line in lines:
        if not line:
            continue
        if should_skip_task_line(line):
            continue
        if not collecting and re.search(r"Write an essay of\s+200\s*[-–]\s*250\s+words", line):
            collecting = True
        if not collecting:
            continue
        if re.search(r"Esej obvez|List za [čc]istopis|Način ispunjavanja", line, flags=re.IGNORECASE):
            break

        collected.append(line)
        if re.search(r"own opinion\.", line, flags=re.IGNORECASE):
            break

    task_text = " ".join(collected)
    task_text = re.sub(r"\s+([,.])", r"\1", task_text)
    task_text = re.sub(r"\s+", " ", task_text).strip()
    for broken, fixed in COMMON_TEXT_FIXES.items():
        task_text = task_text.replace(broken, fixed)
    if not task_text:
        raise ValueError("Could not parse essay task text")
    return task_text


def find_essay_task_crop(contents: bytes) -> SourceCrop:
    pages = pdf_bbox_pages(contents)

    for page in pages:
        lines = [
            line
            for line in sorted_page_lines(page)
            if line.text.strip() and not should_skip_task_line(line.text.strip())
        ]
        start_index = next(
            (
                index
                for index, line in enumerate(lines)
                if re.search(r"Write an essay of\s+200\s*[-–]\s*250\s+words", line.text)
            ),
            None,
        )
        if start_index is None:
            continue

        end_line: PdfLine | None = None
        task_lines: list[PdfLine] = []

        for line in lines[start_index:]:
            if line.y_min >= page.height - SOURCE_FOOTER_MARGIN:
                break
            if re.search(
                r"Esej obvez|List za [čc]istopis|Način ispunjavanja",
                line.text,
                flags=re.IGNORECASE,
            ):
                break
            task_lines.append(line)
            end_line = line
            if re.search(r"own opinion\.", line.text, flags=re.IGNORECASE):
                break

        if end_line is None:
            raise ValueError("Could not locate the end of the English essay task crop")

        x_min = max(0, min(line.x_min for line in task_lines) - SOURCE_TASK_HORIZONTAL_PADDING)
        x_max = min(page.width, max(line.x_max for line in task_lines) + SOURCE_TASK_HORIZONTAL_PADDING)
        y_min = max(0, task_lines[0].y_min - SOURCE_TASK_VERTICAL_PADDING)
        y_max = min(page.height, end_line.y_max + SOURCE_TASK_VERTICAL_PADDING)
        if y_max <= y_min:
            raise ValueError("English essay task crop has invalid bounds")
        if x_max <= x_min:
            raise ValueError("English essay task crop has invalid bounds")

        return SourceCrop(
            page=page,
            x_min=x_min,
            y_min=y_min,
            x_max=x_max,
            y_max=y_max,
        )

    raise ValueError("Could not locate English essay task crop")


def render_source_page(paper_path: Path, identifier: str, crop: SourceCrop) -> dict[str, Any]:
    filename = f"page-{crop.page.number}.png"
    destination = ASSET_ROOT / identifier

    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        temporary_prefix = temporary_root / f"page-{crop.page.number}"
        render_pdf_page_to_png(
            paper_path,
            temporary_prefix,
            crop.page.number,
            SOURCE_RENDER_DPI,
            required_message="pdftocairo is required to build English essay source images",
        )

        contents = temporary_prefix.with_suffix(".png").read_bytes()

    image_width, image_height = png_dimensions(contents)
    (destination / filename).write_bytes(contents)
    page_image = grayscale_image_from_png(contents)

    scale_x = image_width / crop.page.width
    scale_y = image_height / crop.page.height
    x_min = max(0, math.floor(crop.x_min * scale_x))
    y_min = max(0, math.floor(crop.y_min * scale_y))
    x_max = min(image_width, math.ceil(crop.x_max * scale_x))
    y_max = min(image_height, math.ceil(crop.y_max * scale_y))
    x_min, y_min, x_max, y_max = trim_crop_bottom_whitespace(
        page_image,
        x_min,
        y_min,
        x_max,
        y_max,
    )

    return source_image_metadata(
        page_image,
        url=f"{ASSET_URL_PREFIX}/{quote(identifier)}/{filename}",
        page=crop.page.number,
        image_width=image_width,
        image_height=image_height,
        crop_box=(x_min, y_min, x_max, y_max),
    )


def build_exam(exam: dict[str, Any]) -> dict[str, Any]:
    archive_path = local_archive_path(exam["url"])
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        paper_name, contents, text = find_essay_paper(archive, names)

    essay_id = exam_id(exam)
    target_dir = ASSET_ROOT / essay_id
    target_dir.mkdir(parents=True, exist_ok=True)
    paper_path = target_dir / "paper.pdf"
    paper_path.write_bytes(contents)
    source_image = render_source_page(paper_path, essay_id, find_essay_task_crop(contents))

    return {
        "id": essay_id,
        "year": exam["year"],
        "schoolYear": exam.get("schoolYear", ""),
        "term": normalize_term(exam["term"]),
        "level": exam["level"],
        "archiveUrl": exam["url"],
        "paperUrl": f"{ASSET_URL_PREFIX}/{essay_id}/paper.pdf",
        "sourceName": Path(paper_name).name,
        "durationMinutes": 75,
        "wordRange": {"min": 200, "max": 250},
        "maxScore": 20,
        "taskText": parse_task_text(text),
        "sourceImages": [source_image],
    }


def main() -> None:
    archive_index = load_archive_index()
    english_a_exams = [
        exam
        for exam in archive_index["exams"]
        if exam["subject"] == SUBJECT and exam.get("level") == "A"
    ]
    english_a_exams.sort(
        key=lambda item: (item["year"], normalize_term(item["term"])),
        reverse=True,
    )

    shutil.rmtree(ASSET_ROOT, ignore_errors=True)
    ASSET_ROOT.mkdir(parents=True, exist_ok=True)

    exams = [build_exam(exam) for exam in english_a_exams]
    payload = {
        "version": 1,
        "rubricSource": {
            "title": "NCVVO Ispitni katalog za državnu maturu 2025./2026. - Engleski jezik",
            "url": "https://www.ncvvo.hr/wp-content/uploads/2025/09/ENG-2026.pdf",
        },
        "exams": exams,
    }
    OUTPUT.write_text(
        f"{OUTPUT_PREFIX}{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8",
    )
    print(f"Built {len(exams)} English essay exams")


if __name__ == "__main__":
    main()
