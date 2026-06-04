#!/usr/bin/env python3
"""Build Croatian summary and school essay practice data from mirrored NCVVO ZIP files."""

from __future__ import annotations

import json
import re
import shutil
import struct
import subprocess
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "croatian-writing.js"
ASSET_ROOT = ROOT / "files" / "interactive" / "croatian-writing"
ASSET_URL_PREFIX = "./files/interactive/croatian-writing"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_CROATIAN_WRITING="
SUBJECT = "Hrvatski jezik"
TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}
SOURCE_RENDER_DPI = 120


@dataclass(frozen=True)
class WritingPart:
    kind: str
    label: str
    duration_minutes: int
    max_score: int
    word_range: dict[str, int | None]
    criteria: list[dict[str, Any]]


WRITING_PARTS = (
    WritingPart(
        kind="sazetak",
        label="Sažetak",
        duration_minutes=80,
        max_score=18,
        word_range={"min": 200, "max": 250, "acceptedMin": 180, "acceptedMax": 275},
        criteria=[
            {"id": "content", "label": "Sadržaj", "maxScore": 3},
            {"id": "organizationStyle", "label": "Organizacija teksta i stil", "maxScore": 3},
            {"id": "languageAccuracy", "label": "Jezična točnost", "maxScore": 3},
        ],
    ),
    WritingPart(
        kind="skolski-esej",
        label="Školski esej",
        duration_minutes=160,
        max_score=30,
        word_range={"min": 440, "max": None, "acceptedMin": 396, "acceptedMax": None},
        criteria=[
            {"id": "centralThesis", "label": "Središnja tvrdnja", "maxScore": 3},
            {"id": "argumentation", "label": "Argumentacija", "maxScore": 3},
            {"id": "coherence", "label": "Povezanost teksta", "maxScore": 3},
            {"id": "vocabulary", "label": "Upotreba rječnika", "maxScore": 3},
            {
                "id": "languageAccuracy",
                "label": "Pravopisna i gramatička točnost",
                "maxScore": 3,
            },
        ],
    ),
)


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


def writing_id(exam: dict[str, Any], part: WritingPart) -> str:
    return f"hrvatski-{exam['year']}-{slugify(normalize_term(exam['term']))}-{part.kind}"


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


def run_pdf_command(arguments: list[str], contents: bytes, purpose: str) -> bytes:
    try:
        completed = subprocess.run(
            arguments,
            input=contents,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"{arguments[0]} is required to build Croatian writing data") from exc
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"{purpose} failed: {message}") from exc
    return completed.stdout


def pdf_text(contents: bytes, first_page: int | None = None, last_page: int | None = None) -> str:
    arguments = ["pdftotext", "-layout"]
    if first_page is not None:
        arguments.extend(["-f", str(first_page)])
    if last_page is not None:
        arguments.extend(["-l", str(last_page)])
    arguments.extend(["-", "-"])
    output = run_pdf_command(arguments, contents, "pdftotext")
    return output.decode("utf-8", errors="replace")


def pdf_page_count(contents: bytes) -> int:
    output = run_pdf_command(["pdfinfo", "-"], contents, "pdfinfo").decode(
        "utf-8", errors="replace"
    )
    match = re.search(r"^Pages:\s+(\d+)\s*$", output, flags=re.MULTILINE)
    if not match:
        raise ValueError("Could not read PDF page count")
    return int(match.group(1))


def find_summary_paper(names: list[str]) -> str:
    candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and re.search(r"\bik[-_ ]*2\b", normalized_name(name))
    ]
    if len(candidates) != 1:
        raise ValueError(f"Expected one Croatian summary paper, found {candidates}")
    return candidates[0]


def find_essay_task(names: list[str]) -> str:
    candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and re.search(r"esejski.?zadatak", normalized_name(name))
    ]
    if len(candidates) != 1:
        raise ValueError(f"Expected one Croatian school essay task, found {candidates}")
    return candidates[0]


def summary_task_pages(contents: bytes) -> list[int]:
    page_count = pdf_page_count(contents)
    page_texts = {
        page: pdf_text(contents, page, page)
        for page in range(1, page_count + 1)
    }
    start_page = next(
        (
            page
            for page, text in page_texts.items()
            if "Pročitajte polazni tekst." in text
        ),
        None,
    )
    if start_page is None:
        raise ValueError("Could not locate the Croatian summary source text")

    end_page = next(
        (
            page
            for page in range(start_page, page_count + 1)
            if "Smjernice za pisanje sažetka" in page_texts[page]
        ),
        None,
    )
    if end_page is None:
        raise ValueError("Could not locate the Croatian summary guidelines")
    return list(range(start_page, end_page + 1))


def clean_task_text(text: str, part: WritingPart) -> str:
    if part.kind == "sazetak":
        start = text.find("Pročitajte polazni tekst.")
        end = text.find("LISTOVI ZA PISANJE", start)
        if start < 0 or end < 0:
            raise ValueError("Could not extract the Croatian summary task text")
        text = text[start:end]

    skipped_lines = {
        "Hrvatski jezik",
        "Sažetak",
        "Školski esej",
    }
    lines: list[str] = []
    for raw_line in text.replace("\f", "\n").splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line or line in skipped_lines:
            continue
        if re.fullmatch(r"\d+(?:/\d+)?", line):
            continue
        if re.search(r"\bHRV (?:IK-\d|IK-\d|IK|[A-Z]\d)", line):
            continue
        lines.append(line)

    task_text = "\n".join(lines).strip()
    if not task_text:
        raise ValueError(f"Could not extract Croatian {part.kind} task text")
    return task_text


def png_dimensions(contents: bytes) -> tuple[int, int]:
    if contents[:16] != b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR":
        raise ValueError("Expected a PNG source page")
    return struct.unpack(">II", contents[16:24])


def render_source_pages(paper_path: Path, identifier: str, pages: list[int]) -> list[dict[str, Any]]:
    destination = ASSET_ROOT / identifier
    source_images: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        for page in pages:
            temporary_prefix = temporary_root / f"page-{page}"
            try:
                subprocess.run(
                    [
                        "pdftocairo",
                        "-png",
                        "-singlefile",
                        "-r",
                        str(SOURCE_RENDER_DPI),
                        "-f",
                        str(page),
                        "-l",
                        str(page),
                        str(paper_path),
                        str(temporary_prefix),
                    ],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=True,
                )
            except FileNotFoundError as exc:
                raise RuntimeError(
                    "pdftocairo is required to build Croatian writing source images"
                ) from exc
            except subprocess.CalledProcessError as exc:
                message = exc.stderr.decode("utf-8", errors="replace")
                raise RuntimeError(f"pdftocairo failed: {message}") from exc

            contents = temporary_prefix.with_suffix(".png").read_bytes()
            width, height = png_dimensions(contents)
            filename = f"page-{page}.png"
            (destination / filename).write_bytes(contents)
            source_images.append(
                {
                    "url": f"{ASSET_URL_PREFIX}/{quote(identifier)}/{filename}",
                    "page": page,
                    "width": width,
                    "height": height,
                    "crop": {"x": 0, "y": 0, "width": width, "height": height},
                }
            )

    return source_images


def build_part(
    exam: dict[str, Any],
    archive: zipfile.ZipFile,
    names: list[str],
    part: WritingPart,
) -> dict[str, Any]:
    source_name = find_summary_paper(names) if part.kind == "sazetak" else find_essay_task(names)
    contents = archive.read(source_name)
    pages = (
        summary_task_pages(contents)
        if part.kind == "sazetak"
        else list(range(1, pdf_page_count(contents) + 1))
    )
    identifier = writing_id(exam, part)
    destination = ASSET_ROOT / identifier
    destination.mkdir(parents=True, exist_ok=True)
    paper_path = destination / "paper.pdf"
    paper_path.write_bytes(contents)

    return {
        "id": identifier,
        "kind": part.kind,
        "partLabel": part.label,
        "year": exam["year"],
        "schoolYear": exam.get("schoolYear", ""),
        "term": normalize_term(exam["term"]),
        "level": exam.get("level"),
        "archiveUrl": exam["url"],
        "paperUrl": f"{ASSET_URL_PREFIX}/{identifier}/paper.pdf",
        "sourceName": Path(source_name).name,
        "durationMinutes": part.duration_minutes,
        "wordRange": part.word_range,
        "maxScore": part.max_score,
        "criteria": part.criteria,
        "taskText": clean_task_text(pdf_text(contents), part),
        "sourceImages": render_source_pages(paper_path, identifier, pages),
    }


def build_exam(exam: dict[str, Any]) -> list[dict[str, Any]]:
    archive_path = local_archive_path(exam["url"])
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        return [build_part(exam, archive, names, part) for part in WRITING_PARTS]


def main() -> None:
    archive_index = load_archive_index()
    # The unified one-level format with a separate summary starts in 2023.
    # Older A/B school essays use a different scoring rubric.
    croatian_exams = [
        exam
        for exam in archive_index["exams"]
        if exam["subject"] == SUBJECT and exam["year"] >= 2023 and not exam.get("level")
    ]
    croatian_exams.sort(
        key=lambda item: (item["year"], normalize_term(item["term"])),
        reverse=True,
    )

    shutil.rmtree(ASSET_ROOT, ignore_errors=True)
    ASSET_ROOT.mkdir(parents=True, exist_ok=True)

    exams = [part for exam in croatian_exams for part in build_exam(exam)]
    payload = {
        "version": 1,
        "rubricSource": {
            "title": "NCVVO Ispitni katalog za državnu maturu 2025./2026. - Hrvatski jezik",
            "url": "https://www.ncvvo.hr/wp-content/uploads/2025/09/HRV-2026.pdf",
        },
        "exams": exams,
    }
    OUTPUT.write_text(
        f"{OUTPUT_PREFIX}{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8",
    )
    print(f"Built {len(exams)} Croatian writing parts")


if __name__ == "__main__":
    main()
