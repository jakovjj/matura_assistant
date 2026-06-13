#!/usr/bin/env python3
"""Build the static Croatian ABCD practice index from mirrored NCVVO ZIP files."""

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

from PIL import Image

from crop_utils import (
    grayscale_image_from_png,
    source_image_metadata,
    trim_crop_bottom_whitespace,
    trim_crop_horizontal_whitespace,
)
from pdf_utils import pdftotext, pdfinfo_page_count, png_dimensions, render_pdf_page_to_png


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
ANSWER_ENTRY_RE = re.compile(
    r"(?<![\w.])"
    r"(?P<token>58\s+[1-5]|\d{1,2}(?:\s*[\.,]\s*\d+)?|[JjIiOo])"
    r"[\.,]?\s+"
    r"(?P<answer>[A-Da-d]|[-_]{2,}|;)"
    r"(?=\s|$)"
)
POINT_VALUE_RE = re.compile(r"\(\s*\d+\s+bod(?:a|ova)?\s*\)", flags=re.IGNORECASE)

# Ručne ispravke za pitanja gdje OCR sloj ključa krivo pročita slovo odgovora
# (npr. "B"/"C" očitano kao ";"), pa ga blank-fallback pogrešno označi kao
# poništeno pitanje s prihvaćenim svim odgovorima. Ključ je identifikator ispita
# (vidi exam_id), vrijednost je {broj pitanja: [točan odgovor]}.
ANSWER_OVERRIDES: dict[str, dict[str, list[str]]] = {
    "hrvatski-2023-jesenski-rok": {"38": ["B"], "51": ["C"]},
}


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
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        raise ValueError(f"Expected one Croatian answer key, found {candidates}")

    filled_answer_sheets = [
        name
        for name in pdfs
        if is_filled_answer_sheet_name(name)
    ]
    if len(filled_answer_sheets) == 1:
        return filled_answer_sheets[0]

    raise ValueError(f"Expected one Croatian answer key, found {candidates}")


def is_filled_answer_sheet_name(name: str) -> bool:
    normalized = normalized_name(name)
    return bool(
        "list" in normalized
        and re.search(
            r"\bs[ao]\s+odgovorima\b|list_sa_odgovorima|odgovore\s+s\s+rjesenim",
            normalized,
        )
    )


def pdf_text(contents: bytes) -> str:
    return pdftotext(
        contents,
        "-layout",
        required_message="pdftotext is required to build Croatian choice data",
    )


def pdf_bbox_pages(contents: bytes) -> list[PdfPage]:
    xml = pdftotext(
        contents,
        "-bbox-layout",
        required_message="pdftotext is required to build Croatian source images",
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


def completion_text_crops(
    pages: list[PdfPage],
    questions: list[str],
) -> list[QuestionCrop]:
    completion_questions = {question for question in questions if "." in question}
    if not completion_questions:
        return []

    regular_questions = [int(question) for question in questions if "." not in question]
    if not regular_questions:
        return []
    parent_number = str(max(regular_questions) + 1)
    section_page = first_page_containing(
        pages,
        r"Zadatak\s+vi[šs]estrukoga\s+izbora\s+s\s+nadopunjavanjem",
    )
    if not section_page:
        return completion_context_crops(pages, questions)
    first_instruction_line = next(
        line
        for line in sorted_page_lines(section_page)
        if re.search(
            r"Zadatak\s+vi[šs]estrukoga\s+izbora\s+s\s+nadopunjavanjem",
            line.text,
            flags=re.IGNORECASE,
        )
    )

    parent_marker: tuple[PdfPage, PdfLine] | None = None
    completion_markers: list[tuple[PdfPage, PdfLine]] = []
    for page in pages:
        for line in sorted_page_lines(page):
            token = question_token(line)
            if token == parent_number and parent_marker is None:
                parent_marker = (page, line)
            if token in completion_questions:
                completion_markers.append((page, line))

    if parent_marker is None or not completion_markers:
        return completion_context_crops(pages, questions)

    parent_page, parent_line = parent_marker
    following_completion_markers = [
        (page, line)
        for page, line in completion_markers
        if page.number > parent_page.number
        or (page.number == parent_page.number and line.y_min > parent_line.y_min)
    ]
    if not following_completion_markers:
        return completion_context_crops(pages, questions)

    first_marker_page, first_marker_line = min(
        following_completion_markers,
        key=lambda item: (item[0].number, item[1].y_min, item[1].x_min),
    )
    crops: list[QuestionCrop] = []

    instruction_last_page_number = (
        parent_page.number if section_page.number == parent_page.number else parent_page.number - 1
    )
    for page_number in range(section_page.number, instruction_last_page_number + 1):
        page = pages[page_number - 1]
        y_min = (
            max(
                SOURCE_CONTENT_TOP_MARGIN,
                running_header_bottom(page) + SOURCE_CROP_VERTICAL_PADDING,
                first_instruction_line.y_min - SOURCE_CROP_VERTICAL_PADDING,
            )
            if page_number == section_page.number
            else max(
                SOURCE_CONTENT_TOP_MARGIN,
                running_header_bottom(page) + SOURCE_CROP_VERTICAL_PADDING,
            )
        )
        y_max = (
            parent_line.y_min - SOURCE_CROP_VERTICAL_PADDING
            if page_number == parent_page.number
            else full_content_crop(page, y_min).y_max
        )
        if y_max <= y_min:
            continue
        crops.append(
            QuestionCrop(
                page=page,
                x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
                y_min=y_min,
                x_max=page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
                y_max=y_max,
            )
        )

    for page_number in range(parent_page.number, first_marker_page.number + 1):
        page = pages[page_number - 1]
        y_min = (
            max(
                SOURCE_CONTENT_TOP_MARGIN,
                running_header_bottom(page) + SOURCE_CROP_VERTICAL_PADDING,
                parent_line.y_min - SOURCE_CROP_VERTICAL_PADDING,
            )
            if page_number == parent_page.number
            else max(
                SOURCE_CONTENT_TOP_MARGIN,
                running_header_bottom(page) + SOURCE_CROP_VERTICAL_PADDING,
            )
        )
        y_max = (
            first_marker_line.y_min - SOURCE_CROP_VERTICAL_PADDING
            if page_number == first_marker_page.number
            else page.height - SOURCE_FOOTER_MARGIN
        )
        if y_max <= y_min:
            continue
        crops.append(
            QuestionCrop(
                page=page,
                x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
                y_min=y_min,
                x_max=page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
                y_max=y_max,
            )
        )

    return crops or completion_context_crops(pages, questions)


def matching_parent_numbers(questions: list[str]) -> list[str]:
    return sorted(
        {question.split(".", 1)[0] for question in questions if "." in question},
        key=int,
    )


def question_marker_line(pages: list[PdfPage], number: str) -> tuple[PdfPage, PdfLine] | None:
    for page in pages:
        for line in sorted_page_lines(page):
            if question_token(line) == number:
                return page, line
    return None


def matching_context_crops(
    pages: list[PdfPage],
    questions: list[str],
) -> dict[str, list[QuestionCrop]]:
    crops: dict[str, list[QuestionCrop]] = {}
    parents = matching_parent_numbers(questions)
    for index, parent in enumerate(parents):
        marker = question_marker_line(pages, parent)
        if marker is None:
            raise ValueError(f"Could not locate Croatian matching task {parent}")
        page, line = marker
        next_number = parents[index + 1] if index + 1 < len(parents) else str(int(parent) + 1)
        next_marker = question_marker_line(pages, next_number)

        parent_crops: list[QuestionCrop] = []
        final_page_number = next_marker[0].number if next_marker else page.number
        for page_number in range(page.number, final_page_number + 1):
            current_page = pages[page_number - 1]
            y_min = (
                max(
                    SOURCE_CONTENT_TOP_MARGIN,
                    running_header_bottom(current_page) + SOURCE_CROP_VERTICAL_PADDING,
                    line.y_min - SOURCE_CROP_VERTICAL_PADDING,
                )
                if page_number == page.number
                else max(
                    SOURCE_CONTENT_TOP_MARGIN,
                    running_header_bottom(current_page) + SOURCE_CROP_VERTICAL_PADDING,
                )
            )
            y_max = (
                next_marker[1].y_min - SOURCE_CROP_VERTICAL_PADDING
                if next_marker and page_number == next_marker[0].number
                else current_page.height - SOURCE_FOOTER_MARGIN
            )
            if y_max - y_min < 24:
                continue
            parent_crops.append(
                QuestionCrop(
                    page=current_page,
                    x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
                    y_min=y_min,
                    x_max=current_page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
                    y_max=y_max,
                )
            )

        if not parent_crops:
            raise ValueError(f"Could not crop Croatian matching task {parent}")
        crops[parent] = parent_crops
    return crops


def completion_question_by_gap_index(questions: list[str]) -> dict[int, str]:
    mapping: dict[int, str] = {}
    for question in questions:
        if "." not in question:
            continue
        _, decimal = question.split(".", 1)
        if decimal.isdigit():
            mapping[int(decimal)] = question
    return mapping


def crop_relative_region(
    source_image: dict[str, Any],
    crop: QuestionCrop,
    x_min: float,
    y_min: float,
    x_max: float,
    y_max: float,
) -> dict[str, int] | None:
    image_crop = source_image.get("crop")
    if not image_crop:
        return None

    scale_x = source_image["width"] / crop.page.width
    scale_y = source_image["height"] / crop.page.height
    pixel_x_min = math.floor(x_min * scale_x) - image_crop["x"]
    pixel_y_min = math.floor(y_min * scale_y) - image_crop["y"]
    pixel_x_max = math.ceil(x_max * scale_x) - image_crop["x"]
    pixel_y_max = math.ceil(y_max * scale_y) - image_crop["y"]

    relative_x = max(0, min(image_crop["width"], pixel_x_min))
    relative_y = max(0, min(image_crop["height"], pixel_y_min))
    relative_x_max = max(relative_x, min(image_crop["width"], pixel_x_max))
    relative_y_max = max(relative_y, min(image_crop["height"], pixel_y_max))
    width = relative_x_max - relative_x
    height = relative_y_max - relative_y
    if width <= 0 or height <= 0:
        return None

    return {
        "x": relative_x,
        "y": relative_y,
        "width": width,
        "height": height,
    }


def completion_blank_regions(
    completion_crops: list[QuestionCrop],
    completion_questions: list[str],
    source_images: dict[str, dict[str, Any]],
    source_prefix: str = "completion",
) -> dict[str, dict[str, int]]:
    questions_by_gap = completion_question_by_gap_index(completion_questions)
    blanks: dict[str, dict[str, int]] = {}

    for index, crop in enumerate(completion_crops):
        source_image = source_images.get(f"{source_prefix}:{index}")
        if not source_image:
            continue

        for line in sorted_page_lines(crop.page):
            if line.y_min < crop.y_min or line.y_max > crop.y_max:
                continue

            for word_index, word in enumerate(line.words):
                embedded_match = re.fullmatch(r"\((\d+)\.\)(_+[.,]?)", word.text)
                if embedded_match:
                    gap_index = int(embedded_match.group(1))
                    underscore_text = embedded_match.group(2).rstrip(".,")
                    visible_text = word.text.rstrip(".,")
                    prefix_width = (
                        (len(visible_text) - len(underscore_text)) / len(visible_text)
                    ) * (word.x_max - word.x_min)
                    x_min = word.x_min + prefix_width
                    x_max = word.x_max
                else:
                    if not re.fullmatch(r"_+[.,]?", word.text):
                        continue

                    previous = " ".join(
                        item.text for item in line.words[max(0, word_index - 3) : word_index]
                    )
                    match = re.search(r"\((\d+)\.\)\s*$", previous)
                    if not match:
                        continue
                    gap_index = int(match.group(1))
                    x_min = word.x_min
                    x_max = word.x_max

                question = questions_by_gap.get(gap_index)
                if not question:
                    continue

                region = crop_relative_region(
                    source_image,
                    crop,
                    x_min,
                    word.y_min,
                    x_max,
                    word.y_max,
                )
                if region:
                    blanks[question] = {"sourceImageIndex": index, **region}

    return blanks


def completion_question_markers(
    pages: list[PdfPage],
    completion_questions: list[str],
) -> dict[str, tuple[PdfPage, PdfLine]]:
    wanted = set(completion_questions)
    markers: dict[str, tuple[PdfPage, PdfLine]] = {}
    for page in pages:
        for line in sorted_page_lines(page):
            token = question_token(line)
            if token in wanted:
                markers[token] = (page, line)
    return markers


def option_column_x_max(
    page: PdfPage,
    marker_line: PdfLine,
    markers: dict[str, tuple[PdfPage, PdfLine]],
) -> float:
    right_markers = [
        other_line.x_min
        for other_page, other_line in markers.values()
        if other_page == page and other_line.x_min > marker_line.x_min + 40
    ]
    if right_markers:
        return min(right_markers) - 12
    return page.width - SOURCE_CROP_HORIZONTAL_MARGIN


def option_y_max(
    page: PdfPage,
    marker_line: PdfLine,
    markers: dict[str, tuple[PdfPage, PdfLine]],
) -> float:
    next_markers = [
        other_line.y_min
        for other_page, other_line in markers.values()
        if other_page == page
        and abs(other_line.x_min - marker_line.x_min) < 80
        and other_line.y_min > marker_line.y_min
    ]
    if next_markers:
        return min(next_markers) - SOURCE_CROP_VERTICAL_PADDING
    return page.height - SOURCE_FOOTER_MARGIN


def option_text_for_label(
    page: PdfPage,
    label_line: PdfLine,
    x_max: float,
) -> str:
    same_row = [
        line
        for line in page.lines
        if abs(line.y_min - label_line.y_min) < 3
        and line.x_min > label_line.x_max
        and line.x_min < x_max
        and line.text.strip()
    ]
    if same_row:
        return sorted(same_row, key=lambda line: line.x_min)[0].text.strip()

    inline_match = re.match(r"^[A-D]\.\s+(.+)$", label_line.text.strip())
    return inline_match.group(1).strip() if inline_match else ""


def completion_option_texts(
    pages: list[PdfPage],
    completion_questions: list[str],
) -> dict[str, dict[str, str]]:
    markers = completion_question_markers(pages, completion_questions)
    options_by_question: dict[str, dict[str, str]] = {}

    for question, (page, marker_line) in markers.items():
        x_min = marker_line.x_min - 4
        x_max = option_column_x_max(page, marker_line, markers)
        y_min = marker_line.y_min
        y_max = option_y_max(page, marker_line, markers)
        options: dict[str, str] = {}

        for line in sorted_page_lines(page):
            if not (y_min < line.y_min < y_max and x_min <= line.x_min < x_max):
                continue

            label_match = re.fullmatch(r"([A-D])\.", line.text.strip())
            inline_match = re.match(r"^([A-D])\.\s+(.+)$", line.text.strip())
            if label_match:
                option = label_match.group(1)
                options[option] = option_text_for_label(page, line, x_max)
            elif inline_match:
                option = inline_match.group(1)
                options[option] = inline_match.group(2).strip()

        if options:
            options_by_question[question] = {
                option: options[option]
                for option in ["A", "B", "C", "D"]
                if options.get(option)
            }

    return options_by_question


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
    spaced_decimal = re.fullmatch(r"\s*(\d{1,2})\s+(\d+)\s*", token)
    if spaced_decimal:
        return f"{int(spaced_decimal.group(1))}.{int(spaced_decimal.group(2))}"

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


def validate_answer_sequence(
    answers: dict[str, list[str]],
    blank_questions: set[str] | None = None,
) -> list[str]:
    questions = sorted(answers, key=question_sort_key)
    all_detected_questions = sorted(
        set(questions) | (blank_questions or set()),
        key=question_sort_key,
    )
    integer_questions = {int(question) for question in all_detected_questions if "." not in question}
    decimal_questions_by_parent: dict[int, list[int]] = {}
    for question in all_detected_questions:
        if "." not in question:
            continue
        whole, decimal = question.split(".", 1)
        decimal_questions_by_parent.setdefault(int(whole), []).append(int(decimal))

    if not integer_questions and not decimal_questions_by_parent:
        raise ValueError("No regular Croatian answer numbers found")

    max_question = max([*integer_questions, *decimal_questions_by_parent])
    for question_number in range(1, max_question + 1):
        has_integer = question_number in integer_questions
        decimals = sorted(decimal_questions_by_parent.get(question_number, []))
        if has_integer and decimals:
            raise ValueError(f"Croatian answer key mixes parent and subitems: {question_number}")
        if has_integer:
            continue
        if decimals:
            expected_decimals = list(range(1, len(decimals) + 1))
            if decimals != expected_decimals:
                raise ValueError(
                    f"Croatian decimal answers are not contiguous for {question_number}: "
                    f"expected {expected_decimals}, found {decimals}"
                )
            continue
        raise ValueError(
            f"Croatian answer key is not contiguous: missing {question_number}"
        )

    decimal_questions = [question for question in all_detected_questions if "." in question]
    if decimal_questions and max(decimal_questions_by_parent) == max_question:
        base = max(integer_questions, default=0) + 1
        expected_decimals = [f"{base}.{index}" for index in range(1, len(decimal_questions) + 1)]
        if min(decimal_questions_by_parent) == base and decimal_questions != expected_decimals:
            raise ValueError(
                f"Croatian decimal answers are not contiguous: expected {expected_decimals}, "
                f"found {decimal_questions}"
            )

    if len(questions) < 30:
        raise ValueError(f"Expected at least 30 Croatian ABCD answers, found {len(questions)}")
    return questions


def parse_choice_answers(text: str) -> tuple[list[str], dict[str, list[str]]]:
    answers: dict[str, list[str]] = {}
    blank_questions: set[str] = set()
    previous_question: str | None = None

    for match in ANSWER_ENTRY_RE.finditer(text):
        question = parse_answer_token(match.group("token"), previous_question)
        if question is None:
            continue
        if question == "1" and ("1" in answers or "1" in blank_questions) and len(answers) >= 30:
            break
        if question in answers or question in blank_questions:
            continue

        answer = match.group("answer").upper()
        if re.fullmatch(r"[-_]{2,}|;", answer):
            blank_questions.add(question)
            answers[question] = ["A", "B", "C", "D"]
        else:
            answers[question] = [answer]
        previous_question = question

    questions = validate_answer_sequence(answers, blank_questions)
    return questions, {question: answers[question] for question in questions}


def is_answer_sheet_pink(rgb: tuple[int, int, int]) -> bool:
    red, green, blue = rgb
    return (
        red > 185
        and green > 90
        and blue > 110
        and green < 245
        and blue < 252
        and red > green + 8
        and blue > green + 3
    )


def is_answer_box_white(rgb: tuple[int, int, int]) -> bool:
    red, green, blue = rgb
    return red > 238 and green > 238 and blue > 238


def is_answer_mark(rgb: tuple[int, int, int]) -> bool:
    red, green, blue = rgb
    return (
        (blue > red + 15 and blue > green + 5 and red < 180)
        or (red < 120 and green < 130 and blue < 170)
    )


def grouped_runs(values: list[int], gap: int = 2) -> list[tuple[int, int]]:
    groups: list[tuple[int, int]] = []
    for value in values:
        if groups and value <= groups[-1][1] + gap:
            groups[-1] = (groups[-1][0], value)
        else:
            groups.append((value, value))
    return groups


def cluster_numbers(values: list[int], tolerance: int = 18) -> list[int]:
    clusters: list[list[int]] = []
    for value in sorted(values):
        if clusters and value <= round(sum(clusters[-1]) / len(clusters[-1])) + tolerance:
            clusters[-1].append(value)
        else:
            clusters.append([value])
    return [round(sum(cluster) / len(cluster)) for cluster in clusters]


def rendered_pdf_images(contents: bytes) -> list[Image.Image]:
    page_count = pdfinfo_page_count(
        contents,
        required_message="pdfinfo is required to read Croatian answer sheets",
    )
    images: list[Image.Image] = []
    with tempfile.TemporaryDirectory() as tmpdir:
        source = Path(tmpdir) / "source.pdf"
        source.write_bytes(contents)
        for page_number in range(1, page_count + 1):
            output_prefix = Path(tmpdir) / f"page-{page_number}"
            render_pdf_page_to_png(
                source,
                output_prefix,
                page_number,
                SOURCE_RENDER_DPI,
                required_message="pdftocairo is required to read Croatian answer sheets",
            )
            images.append(Image.open(output_prefix.with_suffix(".png")).convert("RGB"))
    return images


def answer_sheet_row_centers_in_region(
    image: Image.Image,
    expected_count: int,
    *,
    x_min: int | None = None,
    x_max: int | None = None,
) -> list[int]:
    width, height = image.size
    pixels = image.load()
    start_x = 0 if x_min is None else max(0, x_min)
    end_x = width if x_max is None else min(width, x_max)
    threshold = max(40, (end_x - start_x) * 0.3)
    pink_rows = [
        y
        for y in range(height)
        if sum(1 for x in range(start_x, end_x) if is_answer_sheet_pink(pixels[x, y])) > threshold
    ]
    groups = [
        (start, end)
        for start, end in grouped_runs(pink_rows)
        if 25 <= end - start + 1 <= 65
    ]
    answer_area_groups = [
        (start, end)
        for start, end in grouped_runs(pink_rows)
        if end - start + 1 > 25 and 90 < start < height - 150
    ]
    centers = [
        round((start + end) / 2)
        for start, end in groups
        if 90 < start < height - 150
    ]

    if len(centers) >= expected_count:
        return centers[:expected_count]

    box_centers = answer_box_centers(
        image,
        x_min=start_x,
        x_max=end_x,
        y_min=max(90, min((start for start, _ in answer_area_groups), default=90) - 30),
        y_max=min(height - 220, max((end for _, end in answer_area_groups), default=height - 220) + 30),
    )
    box_y_centers = cluster_numbers([y for _, y in box_centers], tolerance=25)
    if len(box_y_centers) >= expected_count:
        return box_y_centers[:expected_count]

    if not centers:
        raise ValueError("Could not locate Croatian answer-sheet rows")

    diffs = [
        centers[index + 1] - centers[index]
        for index in range(len(centers) - 1)
        if 30 <= centers[index + 1] - centers[index] <= 60
    ]
    spacing = round(sum(diffs) / len(diffs)) if diffs else 45
    return [round(centers[0] + index * spacing) for index in range(expected_count)]


def answer_sheet_row_centers(image: Image.Image, expected_count: int) -> list[int]:
    return answer_sheet_row_centers_in_region(image, expected_count)


def answer_sheet_panel_row_centers(
    image: Image.Image,
    expected_count: int,
    *,
    x_min: int,
    x_max: int,
) -> list[int]:
    pixels = image.load()
    threshold = max(40, (x_max - x_min) * 0.3)
    pink_rows = [
        y
        for y in range(image.height)
        if sum(1 for x in range(x_min, x_max) if is_answer_sheet_pink(pixels[x, y])) > threshold
    ]
    groups = [
        (start, end)
        for start, end in grouped_runs(pink_rows)
        if end - start + 1 > 35 and 90 < start < image.height - 150
    ]
    if not groups:
        return answer_sheet_row_centers_in_region(
            image,
            expected_count,
            x_min=x_min,
            x_max=x_max,
        )
    start = min(start for start, _end in groups)
    return [round(start + 28 + index * 46) for index in range(expected_count)]


def tall_answer_sheet_groups_in_region(
    image: Image.Image,
    *,
    x_min: int,
    x_max: int,
) -> list[tuple[int, int]]:
    pixels = image.load()
    threshold = max(40, (x_max - x_min) * 0.3)
    pink_rows = [
        y
        for y in range(image.height)
        if sum(1 for x in range(x_min, x_max) if is_answer_sheet_pink(pixels[x, y])) > threshold
    ]
    return [
        (start, end)
        for start, end in grouped_runs(pink_rows)
        if end - start + 1 > 100 and 90 < start < image.height - 150
    ]


def nearby_pink(image: Image.Image, x: int, y: int) -> bool:
    width, height = image.size
    pixels = image.load()
    for dx, dy in ((0, -12), (0, 12), (-12, 0), (12, 0)):
        xx = min(width - 1, max(0, x + dx))
        yy = min(height - 1, max(0, y + dy))
        if is_answer_sheet_pink(pixels[xx, yy]):
            return True
    return False


def answer_box_centers(
    image: Image.Image,
    *,
    x_min: int,
    x_max: int,
    y_min: int,
    y_max: int,
) -> list[tuple[int, int]]:
    pixels = image.load()
    white: set[tuple[int, int]] = set()
    for y in range(max(0, y_min), min(image.height, y_max)):
        for x in range(max(0, x_min), min(image.width, x_max)):
            if is_answer_box_white(pixels[x, y]) and nearby_pink(image, x, y):
                white.add((x, y))

    seen: set[tuple[int, int]] = set()
    centers: list[tuple[int, int]] = []
    for point in list(white):
        if point in seen:
            continue
        stack = [point]
        seen.add(point)
        xs: list[int] = []
        ys: list[int] = []
        while stack:
            x, y = stack.pop()
            xs.append(x)
            ys.append(y)
            for neighbor in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if neighbor in white and neighbor not in seen:
                    seen.add(neighbor)
                    stack.append(neighbor)
        component_width = max(xs) - min(xs) + 1
        component_height = max(ys) - min(ys) + 1
        area = len(xs)
        if 8 <= component_width <= 40 and 8 <= component_height <= 40 and area > 60:
            centers.append((round(sum(xs) / len(xs)), round(sum(ys) / len(ys))))
    return centers


def regular_answer_x_centers(image: Image.Image, row_centers: list[int]) -> tuple[list[int], list[int]]:
    panel_columns = regular_answer_x_centers_from_panels(image, row_centers)
    if panel_columns:
        return panel_columns

    y_min = max(0, min(row_centers) - 30)
    y_max = min(image.height, max(row_centers) + 30)
    centers = answer_box_centers(
        image,
        x_min=40,
        x_max=image.width - 40,
        y_min=y_min,
        y_max=y_max,
    )
    left = cluster_numbers([x for x, _ in centers if x < image.width * 0.45])
    right = cluster_numbers([x for x, _ in centers if x > image.width * 0.45])
    if len(left) < 4 or len(right) < 4:
        raise ValueError("Could not locate Croatian answer-sheet answer columns")
    return best_regular_answer_columns(left), best_regular_answer_columns(right)


def best_regular_answer_columns(clusters: list[int]) -> list[int]:
    windows = [clusters[index : index + 4] for index in range(len(clusters) - 3)]
    candidates: list[tuple[float, list[int]]] = []
    for window in windows:
        diffs = [window[index + 1] - window[index] for index in range(3)]
        if any(diff < 45 or diff > 95 for diff in diffs):
            continue
        span = window[-1] - window[0]
        if span < 180 or span > 260:
            continue
        mean = sum(diffs) / len(diffs)
        variance = sum((diff - mean) ** 2 for diff in diffs)
        candidates.append((variance, window))
    if candidates:
        return min(candidates, key=lambda item: item[0])[1]
    return clusters[:4]


def regular_answer_x_centers_from_panels(
    image: Image.Image,
    row_centers: list[int],
) -> tuple[list[int], list[int]] | None:
    pixels = image.load()
    for y_center in row_centers[:5]:
        pink_columns = [
            x
            for x in range(image.width)
            if is_answer_sheet_pink(pixels[x, y_center])
        ]
        groups = [
            (start, end)
            for start, end in grouped_runs(pink_columns, gap=40)
            if 250 <= end - start + 1 <= 460
        ]
        if len(groups) < 2:
            continue
        groups = sorted(groups, key=lambda item: item[0])[:2]

        def columns(group: tuple[int, int]) -> list[int]:
            start, end = group
            width = end - start
            return [
                round(start + width * ratio)
                for ratio in (0.30, 0.50, 0.69, 0.89)
            ]

        return columns(groups[0]), columns(groups[1])
    return None


def answer_mark_score(image: Image.Image, x_center: int, y_center: int) -> int:
    pixels = image.load()
    score = 0
    for y in range(y_center - 16, y_center + 17):
        for x in range(x_center - 16, x_center + 17):
            if 0 <= x < image.width and 0 <= y < image.height and is_answer_mark(pixels[x, y]):
                score += 1
    return score


def answer_cross_score(image: Image.Image, x_center: int, y_center: int) -> int:
    pixels = image.load()
    first_diagonal = 0
    second_diagonal = 0
    for y in range(y_center - 18, y_center + 19):
        for x in range(x_center - 18, x_center + 19):
            if not (0 <= x < image.width and 0 <= y < image.height):
                continue
            if not is_answer_mark(pixels[x, y]):
                continue
            dx = x - x_center
            dy = y - y_center
            if abs(dy - dx) <= 5:
                first_diagonal += 1
            if abs(dy + dx) <= 5:
                second_diagonal += 1
    return min(first_diagonal, second_diagonal)


def selected_answers(
    image: Image.Image,
    x_centers: list[int],
    y_center: int,
    options: list[str],
) -> list[str]:
    scores = [
        (
            answer_mark_score(image, x_center, y_center),
            answer_cross_score(image, x_center, y_center),
            option,
        )
        for x_center, option in zip(x_centers, options)
    ]
    max_score = max(score for score, _cross_score, _option in scores)
    if max_score < 8:
        raise ValueError(f"Could not read Croatian answer-sheet mark at row {y_center}: {scores}")
    threshold = max(8, round(max_score * 0.45))
    candidates = [
        (score, cross_score, option)
        for score, cross_score, option in scores
        if score >= threshold
    ]
    if len(candidates) <= 1:
        return [option for _score, _cross_score, option in candidates]
    if (
        len(candidates) == len(options)
        and min(score for score, _cross_score, _option in candidates) >= max_score * 0.75
    ):
        return [option for _score, _cross_score, option in candidates]

    max_cross_score = max(cross_score for _score, cross_score, _option in candidates)
    if max_cross_score >= 20:
        cross_threshold = max(20, round(max_cross_score * 0.8))
        cross_candidates = [
            option
            for _score, cross_score, option in candidates
            if cross_score >= cross_threshold
        ]
        if cross_candidates:
            return cross_candidates
    return [option for _score, _cross_score, option in candidates]


def read_regular_answer_rows(
    image: Image.Image,
    row_centers: list[int],
    left_x_centers: list[int],
    right_x_centers: list[int],
    left_questions: list[str],
    right_questions: list[str],
) -> dict[str, list[str]]:
    answers: dict[str, list[str]] = {}
    for row_index, question in enumerate(left_questions):
        answers[question] = selected_answers(
            image,
            left_x_centers,
            row_centers[row_index],
            ["A", "B", "C", "D"],
        )
    for row_index, question in enumerate(right_questions):
        answers[question] = selected_answers(
            image,
            right_x_centers,
            row_centers[row_index],
            ["A", "B", "C", "D"],
        )
    return answers


def matching_subitem_y_centers(image: Image.Image, y_min: int, y_max: int) -> list[int]:
    first_center = y_min + 45
    last_center = y_max - 39
    if last_center <= first_center:
        raise ValueError("Could not locate Croatian matching answer rows")
    spacing = (last_center - first_center) / 4
    return [round(first_center + index * spacing) for index in range(5)]


def matching_answer_x_centers(image: Image.Image, y_centers: list[int]) -> list[int]:
    centers = answer_box_centers(
        image,
        x_min=150,
        x_max=round(image.width * 0.45),
        y_min=min(y_centers) - 25,
        y_max=max(y_centers) + 25,
    )
    x_centers = cluster_numbers([x for x, _ in centers], tolerance=18)
    if len(x_centers) < 3:
        raise ValueError("Could not locate Croatian matching answer columns")
    return x_centers[:3]


def parse_filled_answer_sheet_answers(
    contents: bytes,
    exam: dict[str, Any],
) -> tuple[list[str], dict[str, list[str]]]:
    images = rendered_pdf_images(contents)
    if len(images) < 2:
        raise ValueError("Expected a two-page Croatian answer sheet")

    first_page_rows = answer_sheet_row_centers(images[0], 20)
    first_left_x, first_right_x = regular_answer_x_centers(images[0], first_page_rows)
    answers = read_regular_answer_rows(
        images[0],
        first_page_rows,
        first_left_x,
        first_right_x,
        [str(number) for number in range(1, 21)],
        [str(number) for number in range(21, 41)],
    )

    if exam["year"] <= 2014:
        page = images[1]
        right_rows = answer_sheet_panel_row_centers(
            page,
            20,
            x_min=round(page.width * 0.45),
            x_max=page.width - 40,
        )
        left_rows = right_rows[:5] + right_rows[15:20]
        second_left_x, second_right_x = first_left_x, first_right_x
        answers.update(
            read_regular_answer_rows(
                page,
                left_rows,
                second_left_x,
                second_right_x,
                [str(number) for number in range(41, 46)] + [str(number) for number in range(48, 53)],
                [],
            )
        )
        answers.update(
            read_regular_answer_rows(
                page,
                right_rows,
                second_left_x,
                second_right_x,
                [],
                [str(number) for number in range(53, 73)],
            )
        )

        first_matching_rows = matching_subitem_y_centers(
            page,
            right_rows[4] + 25,
            right_rows[9] + 20,
        )
        second_matching_rows = matching_subitem_y_centers(
            page,
            right_rows[10] - 20,
            right_rows[14] + 20,
        )
        first_matching_x = matching_answer_x_centers(page, first_matching_rows)
        second_matching_x = matching_answer_x_centers(page, second_matching_rows)
        for index, y_center in enumerate(first_matching_rows, start=1):
            answers[f"46.{index}"] = selected_answers(page, first_matching_x, y_center, ["A", "B", "C"])
        for index, y_center in enumerate(second_matching_rows, start=1):
            answers[f"47.{index}"] = selected_answers(page, second_matching_x, y_center, ["A", "B", "C"])
    else:
        second_page_rows = answer_sheet_row_centers(images[1], 20)
        second_left_x, second_right_x = first_left_x, first_right_x
        answers.update(
            read_regular_answer_rows(
                images[1],
                second_page_rows,
                second_left_x,
                second_right_x,
                [str(number) for number in range(41, 61)],
                [str(number) for number in range(61, 81)],
            )
        )

    questions = validate_answer_sequence(answers)
    return questions, {question: answers[question] for question in questions}


def write_if_changed(path: Path, contents: bytes) -> None:
    if path.is_file() and path.read_bytes() == contents:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)


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
                render_pdf_page_to_png(
                    paper_path,
                    temporary_prefix,
                    page_number,
                    SOURCE_RENDER_DPI,
                    required_message="pdftocairo is required to build Croatian source images",
                )
                contents = temporary_prefix.with_suffix(".png").read_bytes()
            image_width, image_height = png_dimensions(
                contents,
                error_message="Rendered Croatian source image is not a PNG",
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
                if key.startswith("context:"):
                    x_min, y_min, x_max, y_max = trim_crop_horizontal_whitespace(
                        page_image,
                        x_min,
                        y_min,
                        x_max,
                        y_max,
                    )
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


def normalize_context_crop_widths(
    source_images: dict[str, dict[str, Any]],
    contexts: dict[str, list[QuestionCrop]],
) -> None:
    for question, crops in contexts.items():
        images = [
            source_images[f"context:{question}:{index}"]
            for index in range(len(crops))
        ]
        if len(images) < 2:
            continue

        left_ratio = min(image["crop"]["x"] / image["width"] for image in images)
        right_ratio = max(
            (image["crop"]["x"] + image["crop"]["width"]) / image["width"]
            for image in images
        )
        for image in images:
            x_min = max(0, math.floor(left_ratio * image["width"]))
            x_max = min(image["width"], math.ceil(right_ratio * image["width"]))
            image["crop"]["x"] = x_min
            image["crop"]["width"] = x_max - x_min
            for segment in image.get("segments", []):
                segment["x"] = x_min
                segment["width"] = x_max - x_min


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
    decimal_questions = [question for question in questions if "." in question]
    completion_section = first_page_containing(
        pages,
        r"Zadatak\s+vi[šs]estrukoga\s+izbora\s+s\s+nadopunjavanjem",
    )
    completion_questions = decimal_questions if completion_section else []
    matching_questions = decimal_questions if decimal_questions and not completion_section else []
    matching_crops = matching_context_crops(pages, matching_questions) if matching_questions else {}
    completion_crops = (
        completion_context_crops(pages, completion_questions)
        if completion_questions
        else []
    )
    completion_text_source_crops = (
        completion_text_crops(pages, questions)
        if completion_questions
        else []
    )
    regular_questions = [question for question in questions if "." not in question]
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
        **{
            f"completionText:{index}": crop
            for index, crop in enumerate(completion_text_source_crops)
        },
        **{
            f"matching:{parent}:{index}": crop
            for parent, parent_crops in matching_crops.items()
            for index, crop in enumerate(parent_crops)
        },
    }
    source_images, expected_assets = render_source_pages(
        paper_path,
        identifier,
        all_crops,
        force_render,
    )
    normalize_context_crop_widths(source_images, contexts)
    remove_unexpected_assets(identifier, expected_assets)
    completion_blanks = completion_blank_regions(
        completion_text_source_crops,
        completion_questions,
        source_images,
        source_prefix="completionText",
    )
    completion_options = completion_option_texts(pages, completion_questions)

    def build_question(number: str) -> dict[str, Any]:
        question: dict[str, Any] = {"number": number}
        source_image = source_images.get(f"question:{number}")
        if source_image:
            question["sourceImage"] = source_image
        if number in completion_blanks:
            question["blank"] = completion_blanks[number]
        if number in completion_options:
            question["options"] = completion_options[number]
        question_contexts = [
            source_images[f"context:{number}:{index}"]
            for index in range(len(contexts.get(number, [])))
        ]
        if question_contexts:
            question["contextImages"] = question_contexts
        if number in matching_questions:
            parent, decimal = number.split(".", 1)
            if decimal == "1":
                matching_contexts = [
                    source_images[f"matching:{parent}:{index}"]
                    for index in range(len(matching_crops.get(parent, [])))
                ]
                if matching_contexts:
                    question["contextImages"] = matching_contexts
            question["choiceOptions"] = ["A", "B", "C"]
        return question

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
                "textImages": [
                    source_images[f"completionText:{index}"]
                    for index in range(len(completion_text_source_crops))
                ],
                "questions": [build_question(question) for question in completion_questions],
            }
        )
    if matching_questions:
        tasks.append(
            {
                "id": "povezivanje",
                "label": "Zadatci povezivanja",
                "description": "Poveži svaki podzadatak s jednim od ponuđenih odgovora.",
                "questions": [build_question(question) for question in matching_questions],
            }
        )
    return tasks


def mark_excluded_questions(
    tasks: list[dict[str, Any]], answers: dict[str, list[str]]
) -> None:
    """Označi poništena pitanja (ključ prihvaća sve ponuđene odgovore) kao
    izuzeta iz bodovanja. NCVVO je takva pitanja ukinuo (npr. zbog pogreške ili
    pandemijskih okolnosti 2020.), pa ih solver prikazuje s napomenom umjesto da
    nudi odabir odgovora."""
    for task in tasks:
        for question in task.get("questions", []):
            answer = answers.get(question["number"], [])
            options = question.get("choiceOptions", ["A", "B", "C", "D"])
            if len(answer) > 1 and set(answer) == set(options):
                question["excluded"] = True


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
    key_text = pdf_text(key_contents)
    try:
        questions, answers = parse_choice_answers(key_text)
    except Exception:
        if not is_filled_answer_sheet_name(key_name):
            raise
        questions, answers = parse_filled_answer_sheet_answers(key_contents, exam)
    for question, override in ANSWER_OVERRIDES.get(identifier, {}).items():
        if question not in answers:
            raise ValueError(f"Override for unknown question {question} in {identifier}")
        answers[question] = override
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
    mark_excluded_questions(tasks, answers)

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
        "version": 3,
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
