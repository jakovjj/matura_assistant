#!/usr/bin/env python3
"""Build the interactive Politics and Economy practice index from NCVVO ZIP files."""

from __future__ import annotations

import json
import math
import re
import shutil
import sys
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
from open_answer_validation import (
    OpenAnswerValidationError,
    OpenQuestionSpec,
    answer_boundary_penalty,
    assert_valid_exam_open_answers,
    is_excluded_task_text,
    repair_open_answer_boundaries,
)
from manual_solution_images import (
    attach_manual_solution_images,
    build_manual_solution_images,
)
from pdf_utils import pdftotext, png_dimensions, render_pdf_page_to_png


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "politics-choice.js"
PAPER_ROOT = ROOT / "files" / "interactive" / "politics-choice"
PAPER_URL_PREFIX = "./files/interactive/politics-choice"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_POLITICS_CHOICE="
SUBJECT = "Politika i gospodarstvo"

SOURCE_RENDER_DPI = 144
SOURCE_CROP_HORIZONTAL_MARGIN = 36
SOURCE_CROP_VERTICAL_PADDING = 8
SOURCE_CONTENT_TOP_MARGIN = 70
SOURCE_FOOTER_MARGIN = 62

TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}

TASK_LABELS = {
    "alternativni-izbor": "Zadatci alternativnoga izbora",
    "visestruki-izbor": "Zadatci višestrukoga izbora",
    "dopunjavanje": "Zadatci dopunjavanja",
    "kratki-odgovor": "Zadatci kratkoga odgovora",
    "produzeni-odgovor": "Zadatci produženoga odgovora",
    "otvoreni-zadatci": "Otvoreni zadatci",
}
TASK_DESCRIPTIONS = {
    "alternativni-izbor": "Odaberi T za točnu tvrdnju ili N za netočnu tvrdnju.",
    "visestruki-izbor": "Odaberi jedan točan odgovor za svako pitanje.",
    "dopunjavanje": "Dopuni rečenicu i samostalno usporedi odgovor sa službenim rješenjem.",
    "kratki-odgovor": "Odgovori kratko i samostalno usporedi odgovor sa službenim rješenjem.",
    "produzeni-odgovor": "Odgovori s nekoliko rečenica i unesi bodove nakon pregleda službenoga rješenja.",
    "otvoreni-zadatci": "Usporedi svoj odgovor sa službenim rješenjem i unesi bodove.",
}
TASK_ORDER = [
    "alternativni-izbor",
    "visestruki-izbor",
    "dopunjavanje",
    "kratki-odgovor",
    "produzeni-odgovor",
    "otvoreni-zadatci",
]
OPEN_TASK_IDS = {
    "dopunjavanje",
    "kratki-odgovor",
    "produzeni-odgovor",
    "otvoreni-zadatci",
}

PAPER_QUESTION_RE = re.compile(r"(?m)^\s*(?P<number>\d{1,3}(?:\.\d{1,2})?)\.\s+")
PAPER_HEADING_RE = re.compile(r"(?m)^\s*(?P<roman>[IVX]+)\.\s+(?P<label>Zadat[^\n]+)")
KEY_ENTRY_RE = re.compile(r"^\s*(?P<number>\d{1,3}(?:[\.,]\d{1,2})?)\.\s*(?P<answer>.*)$")
POINTS_RE = re.compile(r"(?P<points>\d+)\s+bod(?:a|ova)?", flags=re.IGNORECASE)
SKIPPED_KEY_LINE_PATTERNS = (
    r"^\d+$",
    r"^BROJ(?:\s+ZADATKA)?(?:\s+TO[ČC]AN\s+ODGOVOR)?$",
    r"^ZADATKA$",
    r"^TO[ČC]AN\s+ODGOVOR$",
    r"^Klju[čc]\s+za\s+odgovore$",
    r"^RJE[ŠS]ENJA\s+ISPITA",
    r"^POLITIKA I GOSPODARSTVO",
    r"^DR[ŽZ]AVNE MATURE",
    r"^U ŠKOLSKOJ GODINI",
    r"^Nacionalni centar\b",
    r"^NCVVO\b",
    r"^Tel:",
    r"^www\.ncvvo\.hr$",
    r"^OIB:",
    r"^Mati[čc]ni broj",
)


@dataclass(frozen=True)
class PaperSection:
    task_id: str
    label: str
    start: int
    end: int
    numbers: frozenset[str]


@dataclass(frozen=True)
class PdfWord:
    text: str
    x_min: float
    x_max: float
    y_min: float
    y_max: float


@dataclass(frozen=True)
class PdfLine:
    text: str
    first_word: str
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    words: tuple[PdfWord, ...]


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
    normalized = unicodedata.normalize("NFD", value.casefold()).replace("đ", "d")
    ascii_value = normalized.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.casefold()).strip("-")


def normalize_term(term: str) -> str:
    return TERM_ALIASES.get(term, term)


def exam_id(exam: dict[str, Any]) -> str:
    return f"politika-i-gospodarstvo-{exam['year']}-{slugify(normalize_term(exam['term']))}"


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


def pdf_text(contents: bytes, *args: str) -> str:
    return pdftotext(
        contents,
        *args,
        required_message="pdftotext is required to build Politics practice data",
    )


def pdf_bbox_pages(contents: bytes) -> list[PdfPage]:
    xml = pdftotext(
        contents,
        "-bbox-layout",
        required_message="pdftotext is required to build Politics source images",
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
            pdf_words = tuple(
                PdfWord(
                    text="".join(word.itertext()).strip(),
                    x_min=float(word.attrib["xMin"]),
                    x_max=float(word.attrib["xMax"]),
                    y_min=float(word.attrib["yMin"]),
                    y_max=float(word.attrib["yMax"]),
                )
                for word in words
            )
            word_texts = [word.text for word in pdf_words]
            lines.append(
                PdfLine(
                    text=" ".join(word for word in word_texts if word),
                    first_word=word_texts[0],
                    x_min=float(line_element.attrib["xMin"]),
                    x_max=float(line_element.attrib["xMax"]),
                    y_min=float(line_element.attrib["yMin"]),
                    y_max=float(line_element.attrib["yMax"]),
                    words=pdf_words,
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


def parse_question_token(value: str) -> str:
    cleaned = re.sub(r"\s+", "", value).replace(",", ".").strip(".")
    if "." in cleaned:
        whole, decimal = cleaned.split(".", 1)
        return f"{int(whole)}.{int(decimal)}"
    return str(int(cleaned))


def question_sort_key(question: str) -> tuple[int, int]:
    if "." not in question:
        return (int(question), 0)
    whole, decimal = question.split(".", 1)
    return (int(whole), int(decimal))


def is_key_name(name: str) -> bool:
    normalized = normalized_name(name)
    if "list" in normalized or "prag" in normalized:
        return False
    return bool(re.search(r"klju|kljuc|rje[šs]enja|rjesenja", normalized))


def find_key_name(names: list[str]) -> str:
    key_names = [name for name in names if name.casefold().endswith(".pdf") and is_key_name(name)]
    if not key_names:
        raise ValueError("Could not find an answer key PDF")
    return sorted(key_names, key=lambda name: normalized_name(Path(name).name))[0]


def is_paper_candidate(name: str) -> bool:
    normalized = normalized_name(name)
    if not name.casefold().endswith(".pdf") or is_key_name(name):
        return False
    blocked_patterns = (
        r"\blist\b",
        r"\bkoncept\b",
        r"\bbodovan",
        r"\bprag\b",
    )
    return not any(re.search(pattern, normalized) for pattern in blocked_patterns)


def find_paper_name(names: list[str]) -> str:
    candidates = [name for name in names if is_paper_candidate(name)]
    if not candidates:
        raise ValueError("Could not find an exam paper PDF")

    ds_candidates = [
        name
        for name in candidates
        if re.search(r"\bd[-_ ]*s\s*\d+", normalized_name(name), flags=re.IGNORECASE)
    ]
    if ds_candidates:
        return sorted(ds_candidates, key=lambda name: normalized_name(Path(name).name))[0]

    return sorted(candidates, key=lambda name: normalized_name(Path(name).name))[0]


def task_id_for_heading(label: str) -> str:
    normalized = unicodedata.normalize("NFD", label.casefold()).encode("ascii", "ignore").decode()
    if "alternativ" in normalized:
        return "alternativni-izbor"
    if "visestruk" in normalized:
        return "visestruki-izbor"
    if "dopunj" in normalized:
        return "dopunjavanje"
    if "produzen" in normalized:
        return "produzeni-odgovor"
    if "kratk" in normalized:
        return "kratki-odgovor"
    return "otvoreni-zadatci"


def extract_paper_sections(paper_text: str) -> list[PaperSection]:
    headings = list(PAPER_HEADING_RE.finditer(paper_text))
    sections: list[PaperSection] = []

    for index, heading in enumerate(headings):
        start = heading.end()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(paper_text)
        section_text = paper_text[start:end]
        numbers = frozenset(
            parse_question_token(match.group("number"))
            for match in PAPER_QUESTION_RE.finditer(section_text)
        )
        label = " ".join(heading.group("label").split())
        sections.append(
            PaperSection(
                task_id=task_id_for_heading(label),
                label=label,
                start=start,
                end=end,
                numbers=numbers,
            )
        )

    return sections


def section_for_question(sections: list[PaperSection], question: str) -> PaperSection | None:
    for section in sections:
        if question in section.numbers:
            return section
    return None


def clean_line(line: str) -> str:
    return re.sub(r"\s+", " ", line.replace("\f", " ")).strip()


def should_skip_key_line(line: str) -> bool:
    if not line:
        return True
    return any(re.search(pattern, line, flags=re.IGNORECASE) for pattern in SKIPPED_KEY_LINE_PATTERNS)


def normalize_answer_text(lines: list[str]) -> str:
    useful = [line for line in (clean_line(line) for line in lines) if not should_skip_key_line(line)]
    text = "\n".join(useful)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def embedded_question_parts(
    raw_line: str,
    known_questions: set[str],
) -> tuple[str, str, str] | None:
    candidates: list[tuple[int, int, str]] = []
    for question in known_questions:
        for match in re.finditer(rf"(?<!\d){re.escape(question)}\.(?!\d)", raw_line):
            if match.start() == 0 or raw_line[: match.start()].endswith("  "):
                candidates.append((match.start(), match.end(), question))
    if not candidates:
        return None
    start, end, question = min(candidates)
    return raw_line[:start], question, raw_line[end:]


def parse_key_entries(
    key_texts: list[str],
    sections: list[PaperSection],
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    known_questions = {question for section in sections for question in section.numbers}

    for key_text in key_texts:
        current: dict[str, Any] | None = None

        def flush() -> None:
            nonlocal current
            if not current:
                return
            answer_text = normalize_answer_text(current["lines"])
            if answer_text:
                entries.append({"number": current["number"], "answerText": answer_text})
            current = None

        for raw_line in key_text.splitlines():
            line = clean_line(raw_line)
            if not line:
                continue

            embedded = embedded_question_parts(raw_line, known_questions)
            if embedded and not KEY_ENTRY_RE.match(line):
                prefix, question, answer_start = embedded
                prefix = clean_line(prefix)
                if current and prefix and not should_skip_key_line(prefix):
                    current["lines"].append(prefix)
                flush()
                current = {
                    "number": question,
                    "lines": [answer_start],
                }
                continue

            match = KEY_ENTRY_RE.match(line)
            if match:
                question = parse_question_token(match.group("number"))
                answer_start = clean_line(match.group("answer"))
                if (
                    question not in known_questions
                    or re.match(r"bod(?:a|ova)?\b", answer_start, flags=re.IGNORECASE)
                ):
                    if current:
                        current["lines"].append(line)
                    continue
                flush()
                current = {
                    "number": question,
                    "lines": [match.group("answer")],
                }
                continue

            if current and not should_skip_key_line(line):
                current["lines"].append(line)

        flush()

    by_number: dict[str, dict[str, Any]] = {}
    for entry in entries:
        existing = by_number.get(entry["number"])
        if existing is None or answer_boundary_penalty(entry["answerText"]) < answer_boundary_penalty(
            existing["answerText"]
        ):
            by_number[entry["number"]] = entry
    return [by_number[number] for number in sorted(by_number, key=question_sort_key)]


def closed_answer(answer_text: str) -> str | None:
    cleaned = clean_line(answer_text).strip().strip(".").upper()
    return cleaned if cleaned in {"A", "B", "C", "D", "T", "N"} else None


def max_points_for_open_answer(task_id: str, answer_text: str) -> int:
    matches = [int(match.group("points")) for match in POINTS_RE.finditer(answer_text)]
    if matches:
        return max(matches)
    if task_id == "produzeni-odgovor":
        return 2
    return 1


def extract_question_text(
    paper_text: str,
    sections: list[PaperSection],
    question: str,
) -> str:
    section = section_for_question(sections, question)
    search_start = section.start if section else 0
    search_end = section.end if section else len(paper_text)
    section_text = paper_text[search_start:search_end]
    match = re.search(rf"(?m)^\s*{re.escape(question)}\.\s+", section_text)
    if not match:
        return ""
    next_match = PAPER_QUESTION_RE.search(section_text, match.end())
    end = next_match.start() if next_match else len(section_text)
    return section_text[match.start() : end]


def open_question_specs(
    paper_text: str,
    sections: list[PaperSection],
) -> list[OpenQuestionSpec]:
    specs: list[OpenQuestionSpec] = []
    previous_section_max = 0
    for section in sections:
        section_questions = [
            question
            for question in sorted(section.numbers, key=question_sort_key)
            if int(question.split(".", 1)[0]) > previous_section_max
        ]
        if section.task_id in OPEN_TASK_IDS:
            for question in section_questions:
                question_text = extract_question_text(paper_text, sections, question)
                points = [
                    int(match.group("points"))
                    for match in POINTS_RE.finditer(question_text)
                ]
                maximum = max(
                    points,
                    default=2 if section.task_id == "produzeni-odgovor" else 1,
                )
                specs.append(OpenQuestionSpec(question, section.task_id, maximum))
        if section_questions:
            previous_section_max = max(
                previous_section_max,
                max(int(question.split(".", 1)[0]) for question in section_questions),
            )
    return specs


def options_for_closed_answer(task_id: str, answer: str, exam_year: int) -> list[str]:
    if task_id == "alternativni-izbor" or answer in {"T", "N"}:
        return ["T", "N"]
    if exam_year >= 2022 or answer == "D":
        return ["A", "B", "C", "D"]
    return ["A", "B", "C"]


def build_tasks(
    entries: list[dict[str, Any]],
    sections: list[PaperSection],
    exam_year: int,
) -> tuple[list[dict[str, Any]], dict[str, list[str]], dict[str, dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    answers: dict[str, list[str]] = {}
    open_answers: dict[str, dict[str, Any]] = {}

    for entry in entries:
        question = entry["number"]
        answer_text = entry["answerText"]
        section = section_for_question(sections, question)
        task_id = section.task_id if section else "otvoreni-zadatci"
        if is_excluded_task_text(answer_text):
            grouped.setdefault(task_id, []).append(
                {
                    "number": question,
                    "excluded": True,
                }
            )
            continue
        answer = closed_answer(answer_text)

        if answer:
            question_item = {
                "number": question,
                "type": "closed",
                "options": options_for_closed_answer(task_id, answer, exam_year),
            }
            answers[question] = [answer]
        else:
            max_points = max_points_for_open_answer(task_id, answer_text)
            question_item = {
                "number": question,
                "type": "open",
                "maxPoints": max_points,
            }
            open_answers[question] = {
                "maxPoints": max_points,
                "modelAnswer": answer_text,
            }

        grouped.setdefault(task_id, []).append(question_item)

    tasks: list[dict[str, Any]] = []
    ordered_ids = [task_id for task_id in TASK_ORDER if task_id in grouped]
    ordered_ids.extend(task_id for task_id in grouped if task_id not in ordered_ids)

    for task_id in ordered_ids:
        questions = sorted(grouped[task_id], key=lambda item: question_sort_key(item["number"]))
        tasks.append(
            {
                "id": task_id,
                "label": TASK_LABELS.get(task_id, task_id),
                "description": TASK_DESCRIPTIONS.get(task_id, ""),
                "questions": questions,
            }
        )

    return tasks, answers, open_answers


def parse_duration(text: str) -> int:
    match = re.search(r"Ispit\s+traje\s+(\d+)\s+minuta", text, flags=re.IGNORECASE)
    return int(match.group(1)) if match else 90


def write_if_changed(path: Path, contents: bytes) -> None:
    if path.is_file() and path.read_bytes() == contents:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)


def page_contains(page: PdfPage, pattern: str) -> bool:
    return any(re.search(pattern, line.text, flags=re.IGNORECASE) for line in page.lines)


def first_task_page_number(pages: list[PdfPage]) -> int:
    page = next((page for page in pages if page_contains(page, r"\bI\.\s+Zadat")), None)
    return page.number if page else 1


def marker_token(line: PdfLine) -> str | None:
    match = re.fullmatch(r"(\d{1,3}(?:\.\d{1,2})?)\.", line.first_word.strip())
    if not match:
        return None
    token = parse_question_token(match.group(1))
    stripped = line.text.strip()
    rest = stripped[len(line.first_word.strip()) :].strip()
    if rest and rest[0].islower():
        return None
    return token


def find_question_markers(
    pages: list[PdfPage],
    wanted_questions: set[str],
) -> dict[str, QuestionMarker]:
    start_page_number = first_task_page_number(pages)
    candidates: dict[str, list[QuestionMarker]] = {}

    for page in pages:
        if page.number < start_page_number:
            continue
        for line in sorted_page_lines(page):
            token = marker_token(line)
            if token not in wanted_questions:
                continue
            if line.x_min > page.width * 0.46:
                continue
            candidates.setdefault(token, []).append(QuestionMarker(number=token, page=page, y_min=line.y_min))

    markers: dict[str, QuestionMarker] = {}
    last_page = 0
    last_y_min = -math.inf
    for question in sorted(wanted_questions, key=question_sort_key):
        for candidate in candidates.get(question, []):
            if candidate.page.number > last_page or (
                candidate.page.number == last_page and candidate.y_min > last_y_min
            ):
                markers[question] = candidate
                last_page = candidate.page.number
                last_y_min = candidate.y_min
                break
    return markers


def running_header_bottom(page: PdfPage) -> float:
    header_lines = [
        line
        for line in page.lines
        if line.y_min < 130
        and re.search(r"Politika i gospodarstvo|PIG", line.text.strip(), flags=re.IGNORECASE)
    ]
    return max((line.y_max for line in header_lines), default=0)


def question_crop_y_max(marker: QuestionMarker, ordered_markers: list[QuestionMarker]) -> float:
    marker_index = ordered_markers.index(marker)
    next_marker = ordered_markers[marker_index + 1] if marker_index + 1 < len(ordered_markers) else None
    if next_marker and next_marker.page == marker.page:
        return next_marker.y_min - SOURCE_CROP_VERTICAL_PADDING

    relevant_lines = [
        line
        for line in sorted_page_lines(marker.page)
        if line.y_min >= marker.y_min
        and line.y_min < marker.page.height - SOURCE_FOOTER_MARGIN
    ]
    if not relevant_lines:
        return marker.page.height - SOURCE_FOOTER_MARGIN

    point_lines = [line for line in relevant_lines if POINTS_RE.search(line.text) or re.fullmatch(r"bod", line.text.strip(), flags=re.IGNORECASE)]
    final_line = point_lines[0] if point_lines else relevant_lines[-1]
    return min(final_line.y_max + SOURCE_CROP_VERTICAL_PADDING, marker.page.height - SOURCE_FOOTER_MARGIN)


def find_question_crops(markers: dict[str, QuestionMarker]) -> dict[str, QuestionCrop]:
    ordered_markers = sorted(
        markers.values(),
        key=lambda marker: (marker.page.number, marker.y_min, question_sort_key(marker.number)),
    )
    crops: dict[str, QuestionCrop] = {}

    for marker in ordered_markers:
        y_min = max(
            SOURCE_CONTENT_TOP_MARGIN,
            running_header_bottom(marker.page) + SOURCE_CROP_VERTICAL_PADDING,
            marker.y_min - SOURCE_CROP_VERTICAL_PADDING,
        )
        y_max = question_crop_y_max(marker, ordered_markers)
        if y_max <= y_min:
            continue
        crops[marker.number] = QuestionCrop(
            page=marker.page,
            x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
            y_min=y_min,
            x_max=marker.page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
            y_max=y_max,
        )

    return crops


def render_source_pages(
    paper_path: Path,
    identifier: str,
    crops: dict[str, QuestionCrop],
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
            if image_path.is_file():
                contents = image_path.read_bytes()
            else:
                render_pdf_page_to_png(
                    paper_path,
                    temporary_prefix,
                    page_number,
                    SOURCE_RENDER_DPI,
                    required_message="pdftocairo is required to build Politics source images",
                )
                contents = temporary_prefix.with_suffix(".png").read_bytes()
            image_width, image_height = png_dimensions(
                contents,
                error_message="Rendered Politics source image is not a PNG",
                strict_ihdr=False,
            )
            write_if_changed(image_path, contents)
            expected_assets.add(filename)
            page_image = grayscale_image_from_png(contents)

            for key, crop in page_crops:
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
                if x_max <= x_min or y_max <= y_min:
                    continue
                source_images[key] = source_image_metadata(
                    page_image,
                    url=f"{PAPER_URL_PREFIX}/{quote(identifier)}/{filename}",
                    image_width=image_width,
                    image_height=image_height,
                    crop_box=(x_min, y_min, x_max, y_max),
                )

    return source_images, expected_assets


def remove_unexpected_assets(identifier: str, expected_assets: set[str]) -> None:
    destination = PAPER_ROOT / identifier
    if not destination.is_dir():
        return
    for path in destination.iterdir():
        if path.is_file() and path.name not in expected_assets:
            path.unlink()


def build_source_images(
    paper_contents: bytes,
    paper_path: Path,
    identifier: str,
    tasks: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    question_numbers = [
        str(question["number"])
        for task in tasks
        for question in task.get("questions", [])
    ]
    if not question_numbers:
        return {}

    pages = pdf_bbox_pages(paper_contents)
    markers = find_question_markers(pages, set(question_numbers))
    crops = find_question_crops(markers)
    source_images, expected_assets = render_source_pages(paper_path, identifier, crops)
    remove_unexpected_assets(identifier, expected_assets)
    return source_images


def attach_source_images(
    tasks: list[dict[str, Any]],
    source_images: dict[str, dict[str, Any]],
) -> None:
    for task in tasks:
        for question in task.get("questions", []):
            source_image = source_images.get(str(question["number"]))
            if source_image:
                question["sourceImage"] = source_image


def build_exam(exam: dict[str, Any]) -> dict[str, Any]:
    archive_path = local_archive_path(exam["url"])
    identifier = exam_id(exam)

    with zipfile.ZipFile(archive_path) as archive:
        names = [info.filename for info in archive.infolist() if not info.is_dir()]
        key_name = find_key_name(names)
        paper_name = find_paper_name(names)
        paper_contents = archive.read(paper_name)
        key_contents = archive.read(key_name)
        key_texts = [
            pdf_text(key_contents, "-raw"),
            pdf_text(key_contents, "-layout"),
        ]

    paper_text = pdf_text(paper_contents, "-layout")
    sections = extract_paper_sections(paper_text)
    entries = parse_key_entries(key_texts, sections)
    entries = repair_open_answer_boundaries(
        entries,
        open_question_specs(paper_text, sections),
    )
    tasks, answers, open_answers = build_tasks(entries, sections, exam["year"])

    if not answers and not open_answers:
        raise ValueError("Could not parse any Politics answers")

    destination = PAPER_ROOT / identifier / "paper.pdf"
    write_if_changed(destination, paper_contents)
    source_images = build_source_images(paper_contents, destination, identifier, tasks)
    attach_source_images(tasks, source_images)
    solution_images = build_manual_solution_images(
        [key_contents],
        destination.parent,
        identifier,
        PAPER_URL_PREFIX,
        open_answers,
        pdf_bbox_pages=pdf_bbox_pages,
        parse_question_token=parse_question_token,
        question_sort_key=question_sort_key,
        render_dpi=SOURCE_RENDER_DPI,
        required_message="pdftocairo is required to build Politics solution images",
    )
    attach_manual_solution_images(tasks, solution_images)

    closed_questions = sorted(answers, key=question_sort_key)
    open_questions = sorted(open_answers, key=question_sort_key)

    result = {
        "id": identifier,
        "subject": SUBJECT,
        "year": exam["year"],
        "schoolYear": exam["schoolYear"],
        "term": normalize_term(exam["term"]),
        "level": exam.get("level"),
        "archiveUrl": exam["url"],
        "paperUrl": f"{PAPER_URL_PREFIX}/{quote(identifier)}/paper.pdf",
        "durationMinutes": parse_duration(paper_text),
        "checkingSupported": True,
        "questions": closed_questions,
        "openQuestions": open_questions,
        "tasks": tasks,
        "answers": {question: answers[question] for question in closed_questions},
        "openAnswers": {question: open_answers[question] for question in open_questions},
    }
    assert_valid_exam_open_answers(result)
    return result


def remove_orphaned_papers(expected_ids: set[str]) -> None:
    if not PAPER_ROOT.is_dir():
        return
    for path in PAPER_ROOT.iterdir():
        if path.is_dir() and path.name not in expected_ids:
            shutil.rmtree(path)


def main() -> None:
    archive_index = load_archive_index()
    candidate_exams = [exam for exam in archive_index["exams"] if exam["subject"] == SUBJECT]
    exams: list[dict[str, Any]] = []
    skipped: list[str] = []

    for exam in candidate_exams:
        identifier = exam_id(exam)
        try:
            exams.append(build_exam(exam))
        except OpenAnswerValidationError:
            raise
        except Exception as exc:
            skipped.append(identifier)
            print(f"warning: skipped {identifier}: {exc}", file=sys.stderr)

    remove_orphaned_papers({exam["id"] for exam in exams})

    payload = {
        "version": 1,
        "exams": exams,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text(f"{OUTPUT_PREFIX}{serialized};\n", encoding="utf-8")

    print(f"Wrote {len(exams)} Politics practice exams to {OUTPUT.relative_to(ROOT)}")
    if skipped:
        print(f"Skipped {len(skipped)} Politics archives without reliable generated data")


if __name__ == "__main__":
    main()
