#!/usr/bin/env python3
"""Build the static Croatian ABCD practice index from mirrored NCVVO ZIP files."""

from __future__ import annotations

import json
import math
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "croatian-choice.js"
PAPER_ROOT = ROOT / "files" / "interactive" / "croatian-choice"
PAPER_URL_PREFIX = "./files/interactive/croatian-choice"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_CROATIAN_CHOICE="
SUBJECT = "Hrvatski jezik"
SOURCE_RENDER_DPI = 144
SOURCE_CROP_HORIZONTAL_MARGIN = 36
SOURCE_CROP_VERTICAL_PADDING = 8
SOURCE_CONTENT_TOP_MARGIN = 84
SOURCE_FOOTER_MARGIN = 72
TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}
ANSWER_PAIR_RE = re.compile(
    r"(?<![\w.])"
    r"(?P<token>58\s+[1-5]|\d{1,2}(?:\s*[\.,]\s*\d+)?|[JjIiOo])"
    r"[\.,]?\s+"
    r"(?P<answer>[A-Da-d])"
    r"(?=\s|$)"
)
POINT_VALUE_RE = re.compile(r"\(\s*\d+\s+bod(?:a|ova)?\s*\)", flags=re.IGNORECASE)


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
class QuestionMarker:
    number: str
    page: PdfPage
    y_min: float


@dataclass(frozen=True)
class QuestionCrop:
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
    ascii_value = unicodedata.normalize("NFD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.casefold()).strip("-")


def normalize_term(term: str) -> str:
    return TERM_ALIASES.get(term, term)


def exam_id(exam: dict[str, Any]) -> str:
    term = slugify(normalize_term(exam["term"]))
    level = f"-{exam['level'].casefold()}" if exam.get("level") else ""
    return f"hrvatski{level}-{exam['year']}-{term}"


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


def find_paper_name(names: list[str]) -> str:
    pdfs = [name for name in names if name.casefold().endswith(".pdf")]
    ik1_candidates = [
        name
        for name in pdfs
        if re.search(r"\bik[-_ ]*1\b|ispitna knjizica 1", normalized_name(name))
    ]
    if len(ik1_candidates) == 1:
        return ik1_candidates[0]
    if len(ik1_candidates) > 1:
        raise ValueError(f"Expected one Croatian IK-1 paper, found {ik1_candidates}")

    fallback_candidates = [
        name
        for name in pdfs
        if "hrv" in normalized_name(name)
        and not re.search(
            r"esej|sazetak|saжetak|list|koncept|klju|kljuc|odgovor|ik[-_ ]*[23]",
            normalized_name(name),
        )
    ]
    if len(fallback_candidates) != 1:
        raise ValueError(f"Expected one Croatian paper, found {fallback_candidates}")
    return fallback_candidates[0]


def find_key_name(names: list[str]) -> str:
    pdfs = [name for name in names if name.casefold().endswith(".pdf")]
    candidates = [
        name
        for name in pdfs
        if "odgovor" in normalized_name(name)
        and re.search(r"klju|kljuc", normalized_name(name))
        and "list" not in normalized_name(name)
    ]
    if len(candidates) != 1:
        raise ValueError(f"Expected one Croatian answer key, found {candidates}")
    return candidates[0]


def pdf_text(contents: bytes) -> str:
    try:
        completed = subprocess.run(
            ["pdftotext", "-layout", "-", "-"],
            input=contents,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("pdftotext is required to build Croatian choice data") from exc
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"pdftotext failed: {message}") from exc

    return completed.stdout.decode("utf-8", errors="replace")


def pdf_bbox_pages(contents: bytes) -> list[PdfPage]:
    try:
        completed = subprocess.run(
            ["pdftotext", "-bbox-layout", "-", "-"],
            input=contents,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("pdftotext is required to build Croatian source images") from exc
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"pdftotext -bbox-layout failed: {message}") from exc

    xml = completed.stdout.decode("utf-8", errors="replace")
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
                    x_min=float(line_element.attrib["xMin"]),
                    x_max=float(line_element.attrib["xMax"]),
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


def page_contains(page: PdfPage, pattern: str) -> bool:
    return any(re.search(pattern, line.text, flags=re.IGNORECASE) for line in page.lines)


def first_page_containing(pages: list[PdfPage], pattern: str) -> PdfPage | None:
    return next((page for page in pages if page_contains(page, pattern)), None)


def question_token(line: PdfLine) -> str | None:
    match = re.fullmatch(r"(\d{1,2}(?:\.\d+)?)\.", line.first_word)
    return match.group(1) if match else None


def find_regular_question_markers(
    pages: list[PdfPage],
    questions: list[str],
) -> list[QuestionMarker]:
    regular_questions = [question for question in questions if "." not in question]
    section_page = first_page_containing(pages, r"\bI\.\s*(?:Čitanje|Književnost)")
    if not section_page:
        raise ValueError("Could not locate the first Croatian question section")

    markers: list[QuestionMarker] = []
    expected_index = 0
    for page in pages:
        if page.number < section_page.number:
            continue
        for line in sorted_page_lines(page):
            if expected_index >= len(regular_questions):
                break
            if line.x_min >= 180:
                continue
            expected = regular_questions[expected_index]
            if question_token(line) != expected:
                continue
            markers.append(QuestionMarker(number=expected, page=page, y_min=line.y_min))
            expected_index += 1

    found = [marker.number for marker in markers]
    if found != regular_questions:
        raise ValueError(
            f"Could not locate Croatian question crops: expected {regular_questions}, found {found}"
        )
    return markers


def running_header_bottom(page: PdfPage) -> float:
    header_lines = [
        line
        for line in page.lines
        if line.y_min < 130
        and re.fullmatch(
            r"(?:Hrvatski jezik|Čitanje|Književnost i neknjiževni tekst|Književnost i jezik)",
            line.text.strip(),
            flags=re.IGNORECASE,
        )
    ]
    return max((line.y_max for line in header_lines), default=0)


def full_content_crop(page: PdfPage, y_min: float | None = None) -> QuestionCrop:
    crop_y_min = max(
        SOURCE_CONTENT_TOP_MARGIN,
        running_header_bottom(page) + SOURCE_CROP_VERTICAL_PADDING,
        y_min or 0,
    )
    relevant_lines = [
        line
        for line in sorted_page_lines(page)
        if line.y_min >= crop_y_min
        and line.y_min < page.height - SOURCE_FOOTER_MARGIN
    ]
    crop_y_max = (
        min(
            relevant_lines[-1].y_max + SOURCE_CROP_VERTICAL_PADDING,
            page.height - SOURCE_FOOTER_MARGIN,
        )
        if relevant_lines
        else page.height - SOURCE_FOOTER_MARGIN
    )
    return QuestionCrop(
        page=page,
        x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
        y_min=crop_y_min,
        x_max=page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
        y_max=crop_y_max,
    )


def find_regular_question_crops(markers: list[QuestionMarker]) -> dict[str, QuestionCrop]:
    crops: dict[str, QuestionCrop] = {}
    for index, marker in enumerate(markers):
        next_marker = markers[index + 1] if index + 1 < len(markers) else None
        y_min = max(0, marker.y_min - SOURCE_CROP_VERTICAL_PADDING)
        if next_marker and next_marker.page == marker.page:
            y_max = next_marker.y_min - SOURCE_CROP_VERTICAL_PADDING
        else:
            relevant_lines = [
                line
                for line in sorted_page_lines(marker.page)
                if line.y_min >= marker.y_min
                and line.y_min < marker.page.height - SOURCE_FOOTER_MARGIN
            ]
            if not relevant_lines:
                raise ValueError(f"Question {marker.number} has no visible source lines")
            point_lines = [line for line in relevant_lines if POINT_VALUE_RE.search(line.text)]
            final_line = point_lines[0] if point_lines else relevant_lines[-1]
            y_max = min(
                final_line.y_max + SOURCE_CROP_VERTICAL_PADDING,
                marker.page.height - SOURCE_FOOTER_MARGIN,
            )

        if y_max <= y_min:
            raise ValueError(f"Question {marker.number} has an invalid crop")
        crops[marker.number] = QuestionCrop(
            page=marker.page,
            x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
            y_min=y_min,
            x_max=marker.page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
            y_max=y_max,
        )
    return crops


def reading_last_question(pages: list[PdfPage], markers: list[QuestionMarker]) -> int:
    section_page = first_page_containing(pages, r"Zadatci\s+bez\s+polaznoga\s+teksta")
    if not section_page:
        raise ValueError("Could not locate Croatian questions without a source text")
    next_question = next(
        (
            int(marker.number)
            for marker in markers
            if marker.page.number >= section_page.number
        ),
        None,
    )
    if next_question is None or next_question <= 1:
        raise ValueError("Could not locate the first Croatian question without a source text")
    return next_question - 1


def reading_context_crops(
    pages: list[PdfPage],
    markers: list[QuestionMarker],
    last_reading_question: int,
) -> dict[str, list[QuestionCrop]]:
    first_section_page = first_page_containing(pages, r"\bI\.\s*(?:Čitanje|Književnost)")
    if not first_section_page:
        raise ValueError("Could not locate Croatian reading source texts")

    reading_markers = [
        marker for marker in markers if int(marker.number) <= last_reading_question
    ]
    contexts: dict[str, list[QuestionCrop]] = {}
    previous_marker: QuestionMarker | None = None
    for marker in reading_markers:
        first_page_number = (
            first_section_page.number
            if previous_marker is None
            else previous_marker.page.number + 1
        )
        last_page_number = marker.page.number - 1
        if first_page_number <= last_page_number:
            contexts[marker.number] = [
                full_content_crop(pages[page_number - 1])
                for page_number in range(first_page_number, last_page_number + 1)
            ]
        previous_marker = marker
    return contexts


def completion_context_crops(
    pages: list[PdfPage],
    questions: list[str],
) -> list[QuestionCrop]:
    completion_questions = {question for question in questions if "." in question}
    if not completion_questions:
        return []

    section_page = first_page_containing(
        pages,
        r"Zadatak\s+vi[šs]estrukoga\s+izbora\s+s\s+nadopunjavanjem",
    )
    if not section_page:
        raise ValueError("Could not locate Croatian completion section")

    marker_pages = [
        page
        for page in pages
        if any(question_token(line) in completion_questions for line in page.lines)
    ]
    if not marker_pages:
        raise ValueError("Could not locate Croatian completion questions")

    first_line = next(
        line
        for line in sorted_page_lines(section_page)
        if re.search(
            r"Zadatak\s+vi[šs]estrukoga\s+izbora\s+s\s+nadopunjavanjem",
            line.text,
            flags=re.IGNORECASE,
        )
    )
    return [
        full_content_crop(
            pages[page_number - 1],
            first_line.y_min - SOURCE_CROP_VERTICAL_PADDING
            if page_number == section_page.number
            else None,
        )
        for page_number in range(section_page.number, max(page.number for page in marker_pages) + 1)
    ]


def parse_duration(text: str) -> int:
    match = re.search(r"Ispit\s+traje\s+(\d+)\s+minuta", text, flags=re.IGNORECASE)
    if not match:
        raise ValueError("Could not find Croatian IK-1 duration")
    return int(match.group(1))


def question_sort_key(question: str) -> tuple[int, int]:
    if "." not in question:
        return (int(question), 0)
    whole, decimal = question.split(".", 1)
    return (int(whole), int(decimal))


def parse_answer_token(token: str, previous_question: str | None) -> str | None:
    cleaned = re.sub(r"\s+", "", token).replace(",", ".").strip(".")
    if re.fullmatch(r"\d{1,2}\.\d+", cleaned):
        whole, decimal = cleaned.split(".", 1)
        return f"{int(whole)}.{int(decimal)}"
    if re.fullmatch(r"\d{1,2}", cleaned):
        return str(int(cleaned))
    if previous_question and re.fullmatch(r"[JjIiOo]", cleaned):
        previous_whole, previous_decimal = question_sort_key(previous_question)
        if previous_decimal == 0:
            return str(previous_whole + 1)
    return None


def validate_answer_sequence(answers: dict[str, list[str]]) -> list[str]:
    questions = sorted(answers, key=question_sort_key)
    integer_questions = [int(question) for question in questions if "." not in question]
    decimal_questions = [question for question in questions if "." in question]

    if not integer_questions:
        raise ValueError("No regular Croatian answer numbers found")
    expected_integers = list(range(1, max(integer_questions) + 1))
    if integer_questions != expected_integers:
        raise ValueError(
            f"Croatian answer key is not contiguous: expected {expected_integers}, "
            f"found {integer_questions}"
        )

    if decimal_questions:
        base = max(integer_questions) + 1
        expected_decimals = [f"{base}.{index}" for index in range(1, len(decimal_questions) + 1)]
        if decimal_questions != expected_decimals:
            raise ValueError(
                f"Croatian decimal answers are not contiguous: expected {expected_decimals}, "
                f"found {decimal_questions}"
            )

    if len(questions) < 30:
        raise ValueError(f"Expected at least 30 Croatian ABCD answers, found {len(questions)}")
    return questions


def parse_choice_answers(text: str) -> tuple[list[str], dict[str, list[str]]]:
    answers: dict[str, list[str]] = {}
    previous_question: str | None = None

    for match in ANSWER_PAIR_RE.finditer(text):
        question = parse_answer_token(match.group("token"), previous_question)
        if question is None:
            continue
        if question == "1" and "1" in answers and len(answers) >= 30:
            break
        if question in answers:
            continue

        answer = match.group("answer").upper()
        answers[question] = [answer]
        previous_question = question

    questions = validate_answer_sequence(answers)
    return questions, {question: answers[question] for question in questions}


def write_if_changed(path: Path, contents: bytes) -> None:
    if path.is_file() and path.read_bytes() == contents:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)


def png_dimensions(contents: bytes) -> tuple[int, int]:
    if contents[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Rendered Croatian source image is not a PNG")
    return struct.unpack(">II", contents[16:24])


def render_source_pages(
    paper_path: Path,
    identifier: str,
    crops: dict[str, QuestionCrop],
    force_render: bool = False,
) -> tuple[dict[str, dict[str, Any]], set[str]]:
    destination = PAPER_ROOT / identifier
    crops_by_page: dict[int, list[tuple[str, QuestionCrop]]] = {}
    for key, crop in crops.items():
        crops_by_page.setdefault(crop.page.number, []).append((key, crop))

    source_images: dict[str, dict[str, Any]] = {}
    expected_assets = {"paper.pdf"}
    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        for page_number, page_crops in sorted(crops_by_page.items()):
            filename = f"page-{page_number}.png"
            temporary_prefix = temporary_root / f"page-{page_number}"
            image_path = destination / filename
            if image_path.is_file() and not force_render:
                contents = image_path.read_bytes()
            else:
                try:
                    subprocess.run(
                        [
                            "pdftocairo",
                            "-png",
                            "-singlefile",
                            "-r",
                            str(SOURCE_RENDER_DPI),
                            "-f",
                            str(page_number),
                            "-l",
                            str(page_number),
                            str(paper_path),
                            str(temporary_prefix),
                        ],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        check=True,
                    )
                except FileNotFoundError as exc:
                    raise RuntimeError("pdftocairo is required to build Croatian source images") from exc
                except subprocess.CalledProcessError as exc:
                    message = exc.stderr.decode("utf-8", errors="replace")
                    raise RuntimeError(f"pdftocairo failed: {message}") from exc
                contents = temporary_prefix.with_suffix(".png").read_bytes()
            image_width, image_height = png_dimensions(contents)
            write_if_changed(image_path, contents)
            expected_assets.add(filename)

            for key, crop in page_crops:
                scale_x = image_width / crop.page.width
                scale_y = image_height / crop.page.height
                x_min = max(0, math.floor(crop.x_min * scale_x))
                y_min = max(0, math.floor(crop.y_min * scale_y))
                x_max = min(image_width, math.ceil(crop.x_max * scale_x))
                y_max = min(image_height, math.ceil(crop.y_max * scale_y))
                source_images[key] = {
                    "url": f"{PAPER_URL_PREFIX}/{quote(identifier)}/{filename}",
                    "width": image_width,
                    "height": image_height,
                    "crop": {
                        "x": x_min,
                        "y": y_min,
                        "width": x_max - x_min,
                        "height": y_max - y_min,
                    },
                }

    return source_images, expected_assets


def remove_unexpected_assets(identifier: str, expected_assets: set[str]) -> None:
    destination = PAPER_ROOT / identifier
    if not destination.is_dir():
        return
    for path in destination.iterdir():
        if path.is_file() and path.name not in expected_assets:
            path.unlink()


def build_tasks(
    pages: list[PdfPage],
    markers: list[QuestionMarker],
    questions: list[str],
    paper_path: Path,
    identifier: str,
    force_render: bool = False,
) -> list[dict[str, Any]]:
    last_reading_question = reading_last_question(pages, markers)
    question_crops = find_regular_question_crops(markers)
    contexts = reading_context_crops(pages, markers, last_reading_question)
    completion_crops = completion_context_crops(pages, questions)
    all_crops = {
        **{f"question:{question}": crop for question, crop in question_crops.items()},
        **{
            f"context:{question}:{index}": crop
            for question, question_contexts in contexts.items()
            for index, crop in enumerate(question_contexts)
        },
        **{
            f"completion:{index}": crop
            for index, crop in enumerate(completion_crops)
        },
    }
    source_images, expected_assets = render_source_pages(
        paper_path,
        identifier,
        all_crops,
        force_render,
    )
    remove_unexpected_assets(identifier, expected_assets)

    def build_question(number: str) -> dict[str, Any]:
        question: dict[str, Any] = {"number": number}
        source_image = source_images.get(f"question:{number}")
        if source_image:
            question["sourceImage"] = source_image
        question_contexts = [
            source_images[f"context:{number}:{index}"]
            for index in range(len(contexts.get(number, [])))
        ]
        if question_contexts:
            question["contextImages"] = question_contexts
        return question

    regular_questions = [question for question in questions if "." not in question]
    completion_questions = [question for question in questions if "." in question]
    reading_questions = [
        build_question(question)
        for question in regular_questions
        if int(question) <= last_reading_question
    ]
    choice_questions = [
        build_question(question)
        for question in regular_questions
        if int(question) > last_reading_question
    ]
    tasks = [
        {
            "id": "citanje-s-polaznim-tekstom",
            "label": "Čitanje s polaznim tekstom",
            "description": "Pročitaj polazni tekst pa odgovori na pripadajuća pitanja.",
            "questions": reading_questions,
        },
        {
            "id": "visestruki-izbor",
            "label": "Zadatci višestrukoga izbora",
            "description": "Odaberi jedan točan odgovor za svako pitanje.",
            "questions": choice_questions,
        },
    ]
    if completion_questions:
        tasks.append(
            {
                "id": "nadopunjavanje",
                "label": "Nadopunjavanje",
                "description": "Nadopuni praznine odabirom jednoga od ponuđenih odgovora.",
                "sourceImages": [
                    source_images[f"completion:{index}"]
                    for index in range(len(completion_crops))
                ],
                "questions": [build_question(question) for question in completion_questions],
            }
        )
    return tasks


def build_exam(exam: dict[str, Any]) -> dict[str, Any]:
    archive_path = local_archive_path(exam["url"])
    identifier = exam_id(exam)

    with zipfile.ZipFile(archive_path) as archive:
        names = [info.filename for info in archive.infolist() if not info.is_dir()]
        paper_name = find_paper_name(names)
        key_name = find_key_name(names)
        paper_contents = archive.read(paper_name)
        key_contents = archive.read(key_name)

    paper_text = pdf_text(paper_contents)
    questions, answers = parse_choice_answers(pdf_text(key_contents))
    destination = PAPER_ROOT / identifier / "paper.pdf"
    paper_changed = not destination.is_file() or destination.read_bytes() != paper_contents
    write_if_changed(destination, paper_contents)
    pages = pdf_bbox_pages(paper_contents)
    markers = find_regular_question_markers(pages, questions)
    tasks = build_tasks(
        pages,
        markers,
        questions,
        destination,
        identifier,
        force_render=paper_changed,
    )

    return {
        "id": identifier,
        "year": exam["year"],
        "schoolYear": exam["schoolYear"],
        "term": normalize_term(exam["term"]),
        "level": exam.get("level"),
        "archiveUrl": exam["url"],
        "paperUrl": f"{PAPER_URL_PREFIX}/{quote(identifier)}/paper.pdf",
        "durationMinutes": parse_duration(paper_text),
        "checkingSupported": True,
        "questions": questions,
        "tasks": tasks,
        "answers": answers,
    }


def remove_orphaned_papers(expected_ids: set[str]) -> None:
    if not PAPER_ROOT.is_dir():
        return
    for path in PAPER_ROOT.iterdir():
        if path.is_dir() and path.name not in expected_ids:
            shutil.rmtree(path)


def main() -> None:
    archive_index = load_archive_index()
    croatian_exams = [
        exam for exam in archive_index["exams"] if exam["subject"] == SUBJECT
    ]
    exams: list[dict[str, Any]] = []
    skipped: list[str] = []
    for exam in croatian_exams:
        identifier = exam_id(exam)
        try:
            exams.append(build_exam(exam))
        except Exception as exc:
            skipped.append(identifier)
            print(f"warning: skipped {identifier}: {exc}", file=sys.stderr)

    remove_orphaned_papers({exam["id"] for exam in exams})

    payload = {
        "version": 2,
        "exams": exams,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text(f"{OUTPUT_PREFIX}{serialized};\n", encoding="utf-8")

    print(f"Wrote {len(exams)} Croatian ABCD practice exams to {OUTPUT.relative_to(ROOT)}")
    if skipped:
        print(f"Skipped {len(skipped)} Croatian exams without reliable generated data")


if __name__ == "__main__":
    main()
