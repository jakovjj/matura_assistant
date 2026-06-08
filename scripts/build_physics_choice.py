#!/usr/bin/env python3
"""Build the static Physics practice index from mirrored NCVVO ZIP files."""

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
)
from pdf_utils import pdftotext, png_dimensions, render_pdf_page_to_png


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "physics-choice.js"
PAPER_ROOT = ROOT / "files" / "interactive" / "physics-choice"
PAPER_URL_PREFIX = "./files/interactive/physics-choice"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_PHYSICS_CHOICE="
SUBJECT = "Fizika"
DURATION_MINUTES = 180
SOURCE_RENDER_DPI = 144
SOURCE_CROP_HORIZONTAL_MARGIN = 48
SOURCE_CROP_VERTICAL_PADDING = 9
SOURCE_FOOTER_MARGIN = 65
SOLUTION_FOOTER_MARGIN = 70
SOLUTION_TABLE_RULE_MIN_WIDTH_RATIO = 0.45
SOLUTION_TABLE_CROP_PADDING = 2
SOLUTION_RULE_MARKER_TOLERANCE = 4
TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}
QUESTION_RE = re.compile(r"(?m)^\s{0,32}(\d{1,2})(?:\.|\s+(?=[A-ZČĆŽŠĐ]))\s*\S")
BLANK_PAGE_PARTS = {"P", "ca", "ni", "ra", "st", "a", "zn", "99", "00", "01", "02"}
POINT_VALUE_RE = re.compile(r"\s*\(\s*\d+\s+bod(?:a|ova)?\s*\)", flags=re.IGNORECASE)
POINT_LABEL_RE = re.compile(r"\(?\s*(\d+)\s+(bod(?:a|ova)?)\s*\)?", flags=re.IGNORECASE)
POSTUPAK_RE = re.compile(r"^\s*Postupak\s*:?\s*$", flags=re.IGNORECASE)

# The 2020 summer archive contains a post-marking supplement as the key PDF.
# Its first-section answers are available only on the solved answer sheet.
ANSWER_OVERRIDES = {
    "fizika-2020-ljetni-rok": {
        "1": ["D"],
        "2": ["B"],
        "3": ["A"],
        "4": ["D"],
        "5": ["B"],
        "6": ["C"],
        "7": ["B"],
        "8": ["A"],
        "9": ["B"],
        "10": ["D"],
        "11": ["B"],
        "12": ["C"],
        "13": ["A"],
        "14": ["D"],
        "15": ["D"],
        "16": ["D"],
        "17": ["A"],
        "18": ["D"],
        "19": ["B"],
        "20": ["D"],
        "21": ["B"],
        "22": ["B"],
        "23": ["D"],
        "24": ["C"],
        "25": ["C"],
    },
}

@dataclass(frozen=True)
class ParsedQuestion:
    number: int
    text: str
    options: dict[str, str]

    def to_json(self, source_image: dict[str, Any] | None = None) -> dict[str, Any]:
        question = {
            "number": self.number,
            "text": self.text,
            "options": self.options,
        }
        if source_image:
            question["sourceImage"] = source_image
        return question


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
    number: int
    page: PdfPage
    y_min: float


@dataclass(frozen=True)
class OpenQuestionMarker:
    number: int
    page: PdfPage
    y_min: float
    is_subquestion: bool


@dataclass(frozen=True)
class QuestionCrop:
    page: PdfPage
    x_min: float
    y_min: float
    x_max: float
    y_max: float


@dataclass(frozen=True)
class HorizontalRule:
    x_min: float
    y_min: float
    x_max: float
    y_max: float


def sorted_page_lines(page: PdfPage) -> list[PdfLine]:
    return sorted(page.lines, key=lambda line: (line.y_min, line.x_min))


def line_starts_with_question_number(line: PdfLine, minimum: int = 1) -> int | None:
    match = re.match(r"^\s*(\d{1,2})\s*\.", line.text)
    if not match:
        return None
    number = int(match.group(1))
    if number < minimum:
        return None
    return number


def line_starts_with_open_question_marker(
    line: PdfLine,
    minimum: int = 25,
) -> tuple[int, bool] | None:
    match = re.match(r"^\s*(\d{1,2})\.(?:(\d+)\.)?", line.text)
    if not match:
        return None
    number = int(match.group(1))
    if number < minimum:
        return None
    return number, match.group(2) is not None


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
    return f"fizika-{exam['year']}-{slugify(normalize_term(exam['term']))}"


def local_archive_path(url: str) -> Path:
    parsed_url = urlparse(url)
    if parsed_url.scheme or parsed_url.netloc or parsed_url.query or parsed_url.fragment:
        raise ValueError(f"Unsupported local archive URL: {url}")

    relative_path = Path(unquote(parsed_url.path.removeprefix("./")))
    archive_path = ROOT / relative_path
    archive_path.resolve().relative_to(ROOT.resolve())
    return archive_path


def pdf_text(contents: bytes) -> str:
    return pdftotext(
        contents,
        "-layout",
        required_message="pdftotext is required to build Physics choice data",
    )


def pdf_bbox_pages(contents: bytes) -> list[PdfPage]:
    xml = pdftotext(
        contents,
        "-bbox-layout",
        required_message="pdftotext is required to build Physics source images",
        failure_prefix="pdftotext -bbox-layout failed",
    )
    # Older NCVVO PDFs contain control glyphs that pdftotext writes into its
    # XHTML output even though XML does not allow them.
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


def find_question_crops(contents: bytes, question_numbers: list[int]) -> dict[int, QuestionCrop]:
    pages = pdf_bbox_pages(contents)
    markers: list[QuestionMarker] = []
    expected_index = 0
    found_choice_section = False

    for page in pages:
        for line in sorted_page_lines(page):
            if re.search(
                r"I\.\s*Zadatci\s+vi[šs]estrukoga\s+izbora",
                line.text,
                flags=re.IGNORECASE,
            ):
                found_choice_section = True
            if not found_choice_section or expected_index >= len(question_numbers):
                continue

            number = question_numbers[expected_index]
            has_question_number = line.first_word == f"{number}."
            has_legacy_question_number = (
                line.first_word == str(number) and line.text != line.first_word
            )
            if line.x_min < 125 and (has_question_number or has_legacy_question_number):
                markers.append(QuestionMarker(number=number, page=page, y_min=line.y_min))
                expected_index += 1

    found_numbers = [marker.number for marker in markers]
    if found_numbers != question_numbers:
        raise ValueError(
            f"Could not locate Physics question crops: expected {question_numbers}, "
            f"found {found_numbers}"
        )

    crops: dict[int, QuestionCrop] = {}
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
            score_lines = [line for line in relevant_lines if POINT_VALUE_RE.search(line.text)]
            final_line = score_lines[0] if score_lines else relevant_lines[-1]
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


def point_label_from_lines(lines: list[PdfLine]) -> str | None:
    for line in reversed(lines):
        match = POINT_LABEL_RE.search(line.text)
        if match:
            return f"{match.group(1)} {match.group(2).lower()}"

    for index, line in enumerate(lines):
        if not re.fullmatch(r"bod(?:a|ova)?", line.text.strip(), flags=re.IGNORECASE):
            continue
        score_values: list[int] = []
        for score_line in lines[max(0, index - 10) : index]:
            if abs(score_line.x_min - line.x_min) > 70:
                continue
            if not re.fullmatch(r"(?:\d+\s*)+", score_line.text.strip()):
                continue
            score_values.extend(
                value
                for value in (int(value) for value in re.findall(r"\d+", score_line.text))
                if 0 <= value <= 10
            )
        if score_values:
            return format_point_label(max(score_values))
    return None


def format_point_label(points: int) -> str:
    if points == 1:
        return "1 bod"
    if 2 <= points <= 4:
        return f"{points} boda"
    return f"{points} bodova"


def point_value_from_label(label: str) -> int | None:
    match = POINT_LABEL_RE.search(label)
    return int(match.group(1)) if match else None


def point_label_from_solution_lines(lines: list[PdfLine]) -> str | None:
    point_values = [
        int(match.group(1))
        for line in lines
        for match in POINT_LABEL_RE.finditer(line.text)
    ]
    if point_values:
        return format_point_label(sum(point_values))
    return point_label_from_lines(lines)


def find_open_question_crops(contents: bytes) -> tuple[dict[int, list[QuestionCrop]], dict[int, str]]:
    pages = pdf_bbox_pages(contents)
    markers: list[OpenQuestionMarker] = []
    found_open_section = False
    current_question_number: int | None = None

    for page in pages:
        for line in sorted_page_lines(page):
            if re.search(
                r"II\.\s*Zadatci\s+produ[žz]enoga\s+odgovora",
                line.text,
                flags=re.IGNORECASE,
            ):
                found_open_section = True
                continue
            if not found_open_section:
                continue

            marker = line_starts_with_open_question_marker(line, minimum=25)
            if marker is None or line.x_min >= 140:
                continue
            number, is_subquestion = marker
            if is_subquestion:
                if number != current_question_number:
                    continue
            elif current_question_number is not None and number <= current_question_number:
                continue

            if not is_subquestion:
                current_question_number = number
            markers.append(
                OpenQuestionMarker(
                    number=number,
                    page=page,
                    y_min=line.y_min,
                    is_subquestion=is_subquestion,
                )
            )

    if not markers:
        raise ValueError("Could not locate Physics extended-response question crops")

    crops: dict[int, list[QuestionCrop]] = {}
    point_segments: dict[int, list[tuple[bool, int]]] = {}
    for index, marker in enumerate(markers):
        next_marker = markers[index + 1] if index + 1 < len(markers) else None
        y_min = max(0, marker.y_min - SOURCE_CROP_VERTICAL_PADDING)
        relevant_lines = [
            line
            for line in sorted_page_lines(marker.page)
            if line.y_min >= marker.y_min
            and line.y_min < marker.page.height - SOURCE_FOOTER_MARGIN
            and (not next_marker or next_marker.page != marker.page or line.y_min < next_marker.y_min)
        ]
        if not relevant_lines:
            raise ValueError(f"Open question {marker.number} has no visible source lines")

        point_label = point_label_from_lines(relevant_lines)
        if point_label:
            point_value = point_value_from_label(point_label)
            if point_value is not None:
                point_segments.setdefault(marker.number, []).append(
                    (marker.is_subquestion, point_value)
                )

        postupak_line = next(
            (line for line in relevant_lines if POSTUPAK_RE.match(line.text)),
            None,
        )
        if postupak_line:
            y_max = postupak_line.y_min - SOURCE_CROP_VERTICAL_PADDING
        elif next_marker and next_marker.page == marker.page:
            y_max = next_marker.y_min - SOURCE_CROP_VERTICAL_PADDING
        else:
            y_max = min(
                relevant_lines[-1].y_max + SOURCE_CROP_VERTICAL_PADDING,
                marker.page.height - SOURCE_FOOTER_MARGIN,
            )

        if y_max <= y_min:
            raise ValueError(f"Open question {marker.number} has an invalid crop")
        crops.setdefault(marker.number, []).append(
            QuestionCrop(
                page=marker.page,
                x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
                y_min=y_min,
                x_max=marker.page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
                y_max=y_max,
            )
        )

    points: dict[int, str] = {}
    for number, values in point_segments.items():
        subquestion_total = sum(value for is_subquestion, value in values if is_subquestion)
        main_values = [value for is_subquestion, value in values if not is_subquestion]
        total = (
            max(subquestion_total, max(main_values, default=0))
            if subquestion_total
            else sum(main_values)
        )
        if total:
            points[number] = format_point_label(total)
    return crops, points


def find_solution_page_crops(
    contents: bytes,
    question_numbers: list[int],
) -> tuple[dict[int, QuestionCrop], dict[int, str]]:
    pages = pdf_bbox_pages(contents)
    wanted_numbers = set(question_numbers)
    markers: list[QuestionMarker] = []

    for page in pages:
        for line in sorted_page_lines(page):
            number = line_starts_with_question_number(line, minimum=min(question_numbers))
            if number is None or number not in wanted_numbers or line.x_min >= 170:
                continue
            if any(marker.number == number for marker in markers):
                continue
            markers.append(QuestionMarker(number=number, page=page, y_min=line.y_min))

    found_numbers = [marker.number for marker in markers]
    if sorted(found_numbers) != sorted(question_numbers):
        raise ValueError(
            f"Could not locate Physics solution crops: expected {question_numbers}, "
            f"found {found_numbers}"
        )

    markers.sort(key=lambda marker: (marker.page.number, marker.y_min))
    rules_by_page = detect_horizontal_rules(
        contents,
        {marker.page.number: marker.page for marker in markers},
    )
    crops: dict[int, QuestionCrop] = {}
    points: dict[int, str] = {}
    for index, marker in enumerate(markers):
        next_marker = markers[index + 1] if index + 1 < len(markers) else None
        page_rules = rules_by_page.get(marker.page.number, [])
        top_rule = max(
            (
                rule
                for rule in page_rules
                if rule.y_min <= marker.y_min + SOLUTION_RULE_MARKER_TOLERANCE
            ),
            key=lambda rule: rule.y_min,
            default=None,
        )
        bottom_rule = min(
            (
                rule
                for rule in page_rules
                if rule.y_min > marker.y_min + SOLUTION_RULE_MARKER_TOLERANCE
            ),
            key=lambda rule: rule.y_min,
            default=None,
        )
        table_rule_height = (
            bottom_rule.y_max - top_rule.y_min
            if top_rule and bottom_rule
            else marker.page.height
        )
        use_table_rules = (
            top_rule is not None
            and bottom_rule is not None
            and table_rule_height <= marker.page.height * 0.65
        )

        if use_table_rules:
            x_min = max(0, min(top_rule.x_min, bottom_rule.x_min) - SOLUTION_TABLE_CROP_PADDING)
            y_min = max(0, top_rule.y_min - SOLUTION_TABLE_CROP_PADDING)
            x_max = min(
                marker.page.width,
                max(top_rule.x_max, bottom_rule.x_max) + SOLUTION_TABLE_CROP_PADDING,
            )
            y_max = min(marker.page.height, bottom_rule.y_max + SOLUTION_TABLE_CROP_PADDING)
        else:
            relevant_lines = [
                line
                for line in sorted_page_lines(marker.page)
                if line.y_min >= marker.y_min
                and line.y_min < marker.page.height - SOLUTION_FOOTER_MARGIN
                and (not next_marker or next_marker.page != marker.page or line.y_min < next_marker.y_min)
            ]
            if not relevant_lines:
                raise ValueError(f"Solution {marker.number} has no visible source lines")
            x_min = max(0, min(line.x_min for line in relevant_lines) - SOURCE_CROP_HORIZONTAL_MARGIN)
            y_min = max(0, marker.y_min - SOURCE_CROP_VERTICAL_PADDING)
            x_max = min(
                marker.page.width,
                max(line.x_max for line in relevant_lines) + SOURCE_CROP_HORIZONTAL_MARGIN,
            )
            y_max = min(
                relevant_lines[-1].y_max + SOURCE_CROP_VERTICAL_PADDING,
                marker.page.height - SOLUTION_FOOTER_MARGIN,
            )

        relevant_lines = [
            line
            for line in sorted_page_lines(marker.page)
            if line.y_min >= y_min and line.y_min < y_max
        ]
        point_label = point_label_from_solution_lines(relevant_lines)
        if point_label:
            points[marker.number] = point_label

        crops[marker.number] = QuestionCrop(
            page=marker.page,
            x_min=x_min,
            y_min=y_min,
            x_max=x_max,
            y_max=y_max,
        )
    return crops, points


def normalized_name(name: str) -> str:
    return unicodedata.normalize("NFD", Path(name).name).casefold()


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
        raise ValueError(f"Expected one Physics IK-1 paper, found {ik1_candidates}")

    full_paper_candidates = [
        name
        for name in pdfs
        if re.search(r"\bfiz\b.*\bd[-_ ]?s\d+", normalized_name(name))
        and not re.search(r"\b(?:td|t d|list|koncept|klju|formul)", normalized_name(name))
    ]
    if len(full_paper_candidates) != 1:
        raise ValueError(f"Expected one Physics paper, found {full_paper_candidates}")
    return full_paper_candidates[0]


def find_open_paper_name(names: list[str], choice_paper_name: str) -> str:
    pdfs = [name for name in names if name.casefold().endswith(".pdf")]
    ik2_candidates = [
        name
        for name in pdfs
        if re.search(r"\bik[-_ ]*2\b|ispitna knjizica 2", normalized_name(name))
    ]
    if len(ik2_candidates) == 1:
        return ik2_candidates[0]
    if len(ik2_candidates) > 1:
        raise ValueError(f"Expected one Physics IK-2 paper, found {ik2_candidates}")
    return choice_paper_name


def find_key_name(names: list[str]) -> str:
    candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and "odgovore" in normalized_name(name)
        and "list" not in normalized_name(name)
    ]
    if len(candidates) != 1:
        raise ValueError(f"Expected one Physics answer key, found {candidates}")
    return candidates[0]


def write_if_changed(path: Path, contents: bytes) -> None:
    if path.is_file() and path.read_bytes() == contents:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)


def longest_dark_run(row: bytes, threshold: int = 180) -> tuple[int, int, int]:
    best_start = 0
    best_length = 0
    current_start: int | None = None

    for index, value in enumerate(row):
        if value < threshold:
            if current_start is None:
                current_start = index
            continue

        if current_start is not None:
            length = index - current_start
            if length > best_length:
                best_start = current_start
                best_length = length
            current_start = None

    if current_start is not None:
        length = len(row) - current_start
        if length > best_length:
            best_start = current_start
            best_length = length

    return best_start, best_start + best_length, best_length


def detect_horizontal_rules(contents: bytes, pages: dict[int, PdfPage]) -> dict[int, list[HorizontalRule]]:
    rules_by_page: dict[int, list[HorizontalRule]] = {}
    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        pdf_path = temporary_root / "source.pdf"
        pdf_path.write_bytes(contents)

        for page_number, page in sorted(pages.items()):
            temporary_prefix = temporary_root / f"rules-{page_number}"
            render_pdf_page_to_png(
                pdf_path,
                temporary_prefix,
                page_number,
                SOURCE_RENDER_DPI,
                required_message="pdftocairo is required to locate Physics solution rows",
                failure_prefix="pdftocairo failed while locating solution rows",
            )

            image = Image.open(temporary_prefix.with_suffix(".png")).convert("L")
            width, height = image.size
            scale_x = width / page.width
            scale_y = height / page.height
            minimum_run = int(width * SOLUTION_TABLE_RULE_MIN_WIDTH_RATIO)
            candidates: list[tuple[int, int, int]] = []
            pixels = image.load()
            for y in range(height):
                row = bytes(pixels[x, y] for x in range(width))
                x_min, x_max, run_length = longest_dark_run(row)
                if run_length >= minimum_run:
                    candidates.append((y, x_min, x_max))

            groups: list[list[tuple[int, int, int]]] = []
            for candidate in candidates:
                if groups and candidate[0] <= groups[-1][-1][0] + 1:
                    groups[-1].append(candidate)
                else:
                    groups.append([candidate])

            rules_by_page[page_number] = [
                HorizontalRule(
                    x_min=min(candidate[1] for candidate in group) / scale_x,
                    y_min=min(candidate[0] for candidate in group) / scale_y,
                    x_max=max(candidate[2] for candidate in group) / scale_x,
                    y_max=(max(candidate[0] for candidate in group) + 1) / scale_y,
                )
                for group in groups
            ]

    return rules_by_page


def render_source_pages(
    paper_path: Path,
    identifier: str,
    crops: dict[int, QuestionCrop],
    page_prefix: str = "page",
    expected_assets: set[str] | None = None,
) -> dict[int, dict[str, Any]]:
    destination = PAPER_ROOT / identifier
    if expected_assets is None:
        expected_assets = set()
    crops_by_page: dict[int, list[tuple[int, QuestionCrop]]] = {}
    for question, crop in crops.items():
        crops_by_page.setdefault(crop.page.number, []).append((question, crop))

    source_images: dict[int, dict[str, Any]] = {}
    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        for page_number, page_crops in sorted(crops_by_page.items()):
            filename = f"{page_prefix}-{page_number}.png"
            temporary_prefix = temporary_root / f"{page_prefix}-{page_number}"
            render_pdf_page_to_png(
                paper_path,
                temporary_prefix,
                page_number,
                SOURCE_RENDER_DPI,
                required_message="pdftocairo is required to build Physics source images",
            )

            contents = temporary_prefix.with_suffix(".png").read_bytes()
            image_width, image_height = png_dimensions(contents)
            write_if_changed(destination / filename, contents)
            expected_assets.add(filename)
            page_image = grayscale_image_from_png(contents)

            for question, crop in page_crops:
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
                source_images[question] = source_image_metadata(
                    page_image,
                    url=f"{PAPER_URL_PREFIX}/{quote(identifier)}/{filename}",
                    image_width=image_width,
                    image_height=image_height,
                    crop_box=(x_min, y_min, x_max, y_max),
                )

    return source_images


def render_grouped_source_pages(
    paper_path: Path,
    identifier: str,
    grouped_crops: dict[int, list[QuestionCrop]],
    page_prefix: str = "page",
    expected_assets: set[str] | None = None,
) -> dict[int, list[dict[str, Any]]]:
    flat_crops: dict[int, QuestionCrop] = {}
    flat_questions: dict[int, int] = {}
    next_key = 1
    for question_number, crops in grouped_crops.items():
        for crop in crops:
            flat_crops[next_key] = crop
            flat_questions[next_key] = question_number
            next_key += 1

    flat_images = render_source_pages(
        paper_path,
        identifier,
        flat_crops,
        page_prefix=page_prefix,
        expected_assets=expected_assets,
    )
    grouped_images: dict[int, list[dict[str, Any]]] = {}
    for key in sorted(flat_images):
        grouped_images.setdefault(flat_questions[key], []).append(flat_images[key])
    return grouped_images


def remove_unexpected_assets(identifier: str, expected_assets: set[str]) -> None:
    destination = PAPER_ROOT / identifier
    if not destination.is_dir():
        return
    for path in destination.iterdir():
        if path.is_file() and path.name not in expected_assets:
            path.unlink()


def is_running_header_or_footer(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if stripped in BLANK_PAGE_PARTS:
        return True
    if stripped == "Fizika":
        return True
    if re.search(r"\bFIZ(?:IKA)?\b.*(?:IK[- ]?1|D[- ]?S\d+)", stripped, flags=re.IGNORECASE):
        return True
    if re.search(r"\bFIZ\s+IK[- ]?1\b", stripped, flags=re.IGNORECASE):
        return True
    if ".indd" in stripped:
        return True
    if re.fullmatch(r"\d{1,2}", stripped):
        return True
    return False


def clean_layout_line(line: str) -> str | None:
    if is_running_header_or_footer(line):
        return None

    line = line.rstrip()
    if not line.strip():
        return ""

    if re.fullmatch(r"\s{45,}[A-E]\.", line):
        return None
    if re.fullmatch(r"\s{0,44}[A-E]\.", line):
        return line

    trailing_marker = re.search(r"\s{8,}([A-E])\.\s*$", line)
    if trailing_marker:
        before_marker = line[: trailing_marker.start()]
        labels_before = list(re.finditer(r"(?<!\S)[A-E]\.\s*", before_marker))
        text_after_previous_label = (
            before_marker[labels_before[-1].end() :].strip() if labels_before else ""
        )
        if not labels_before or text_after_previous_label:
            line = before_marker.rstrip()
    if is_running_header_or_footer(line):
        return None
    return line


def clean_question_block(block: str) -> str:
    lines = [clean_layout_line(line) for line in block.splitlines()]
    kept = [line for line in lines if line is not None]
    text = "\n".join(kept)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_choice_section(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    match = re.search(r"I\.\s*Zadatci\s+vi[šs]estrukoga\s+izbora", normalized, flags=re.IGNORECASE)
    if not match:
        raise ValueError("Could not find Physics multiple-choice section")

    section = normalized[match.start() :]
    section = re.split(
        r"(?m)^\s*II\.\s*Zadatci\s+produ[žz]enoga\s+odgovora\b",
        section,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    return section


def split_question_blocks(section: str) -> dict[int, str]:
    candidates = list(QUESTION_RE.finditer(section))
    matches = []
    expected_number = 1
    for match in candidates:
        number = int(match.group(1))
        has_dot = bool(re.match(r"\s*\d{1,2}\.", match.group(0)))
        if not has_dot and number < 20:
            continue
        if number != expected_number:
            continue
        matches.append(match)
        expected_number += 1
        if expected_number > 25:
            break

    blocks: dict[int, str] = {}
    for index, match in enumerate(matches):
        number = int(match.group(1))
        end = matches[index + 1].start() if index + 1 < len(matches) else len(section)
        blocks[number] = clean_question_block(section[match.start() : end])
    return blocks


def append_line(current: str, line: str) -> str:
    line = line.strip()
    if not line:
        return current
    if not current:
        return line
    if current.endswith(("-", "/", "=", "+", "−", "–")):
        return f"{current}\n{line}"
    return f"{current} {line}"


def remove_point_value(value: str) -> str:
    return POINT_VALUE_RE.sub("", value).strip()


def parse_question(block: str, number: int) -> ParsedQuestion:
    lines = [line for line in block.splitlines() if line.strip()]
    if not lines:
        raise ValueError(f"Question {number} has no text")

    lines[0] = re.sub(r"^\s*\d{1,2}\.?\s*", "", lines[0]).strip()
    question_lines: list[str] = []
    option_items: list[dict[str, str]] = []
    active_option_index: int | None = None

    for line in lines:
        option_matches = list(re.finditer(r"(?<!\S)([A-D])\.\s*", line))

        if option_matches:
            prefix = line[: option_matches[0].start()].strip()
            if prefix:
                if active_option_index is not None:
                    option_items[active_option_index]["text"] = append_line(
                        option_items[active_option_index]["text"],
                        prefix,
                    )
                else:
                    question_lines.append(prefix)

            for index, match in enumerate(option_matches):
                active_option = match.group(1)
                next_start = (
                    option_matches[index + 1].start()
                    if index + 1 < len(option_matches)
                    else len(line)
                )
                option_text = line[match.end() : next_start]
                option_items.append({"label": active_option, "text": append_line("", option_text)})
                active_option_index = len(option_items) - 1
            continue

        if active_option_index is not None:
            option_items[active_option_index]["text"] = append_line(
                option_items[active_option_index]["text"],
                line,
            )
        else:
            question_lines.append(line.strip())

    labels = [item["label"] for item in option_items]
    if "B" not in labels and labels[:4] == ["A", "D", "C", "D"]:
        option_items[1]["label"] = "B"

    options: dict[str, str] = {}
    for item in option_items:
        options[item["label"]] = append_line(options.get(item["label"], ""), item["text"])

    option_keys = sorted(options)
    if not option_keys:
        options = {option: "" for option in ["A", "B", "C", "D"]}
        option_keys = sorted(options)

    expected_keys = list("ABCD"[: len(option_keys)])
    if len(option_keys) < 2 or option_keys != expected_keys:
        raise ValueError(f"Question {number} options are not contiguous from A: {option_keys}")

    question_text = "\n".join(question_lines).strip()
    if not question_text:
        raise ValueError(f"Question {number} has no prompt")

    return ParsedQuestion(
        number=number,
        text=remove_point_value(question_text),
        options={option: remove_point_value(options[option]) for option in option_keys},
    )


def normalize_answer_token(token: str) -> list[str]:
    token = (
        unicodedata.normalize("NFKD", token)
        .replace(" ", "")
        .replace(".", "")
        .replace(";", ",")
    )
    token = token.replace("AiC", "A i C").replace("aiC", "A i C")
    has_connector = bool(re.search(r"(?:i|ili|/|,|\+)", token, flags=re.IGNORECASE))
    letters = re.findall(r"[A-D]", token.upper())
    if not letters:
        return []
    if has_connector:
        return sorted(set(letters))
    return [letters[0]]


def parse_choice_answers(text: str) -> dict[str, list[str]]:
    answers: dict[int, list[str]] = {}
    for question, answer in re.findall(
        r"(?<![\w])(\d{1,2})\.\s*([A-D](?:\s*(?:i|I|ili|/|,|\+)?\s*[A-D])?)\b",
        text,
    ):
        number = int(question)
        if not 1 <= number <= 25 or number in answers:
            continue
        normalized = normalize_answer_token(answer)
        if normalized:
            answers[number] = normalized

    expected: list[int] = []
    for number in range(1, 26):
        if number not in answers:
            break
        expected.append(number)

    if len(expected) < 24:
        raise ValueError(f"Expected at least 24 choice answers, found {sorted(answers)}")

    return {str(number): answers[number] for number in expected}


def build_tasks(
    questions: list[ParsedQuestion],
    source_images: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    for task_index, start in enumerate(range(0, len(questions), 6), start=1):
        task_questions = questions[start : start + 6]
        task_options = sorted(
            {option for question in task_questions for option in question.options}
        )
        tasks.append(
            {
                "number": task_index,
                "firstQuestion": task_questions[0].number,
                "lastQuestion": task_questions[-1].number,
                "kind": "choice",
                "options": task_options,
                "questions": [
                    question.to_json(source_images.get(question.number))
                    for question in task_questions
                ],
            }
        )
    return tasks


def build_open_tasks(
    question_images: dict[int, list[dict[str, Any]]],
    solution_images: dict[int, dict[str, Any]],
    points: dict[int, str],
) -> list[dict[str, Any]]:
    question_numbers = sorted(question_images)
    if not question_numbers:
        return []

    missing_solutions = [
        number for number in question_numbers if number not in solution_images
    ]
    if missing_solutions:
        raise ValueError(f"Missing Physics solution images for {missing_solutions}")

    questions = []
    for number in question_numbers:
        source_images = question_images[number]
        question = {
            "number": number,
            "sourceImage": source_images[0],
            "solutionImage": solution_images[number],
        }
        if len(source_images) > 1:
            question["sourceImages"] = source_images
        if number in points:
            question["points"] = points[number]
            question["maxPoints"] = int(points[number].split()[0])
        questions.append(question)
    return [
        {
            "number": 1,
            "firstQuestion": questions[0]["number"],
            "lastQuestion": questions[-1]["number"],
            "kind": "open",
            "questions": questions,
        }
    ]


def build_exam(exam: dict[str, Any]) -> dict[str, Any]:
    archive_path = local_archive_path(exam["url"])
    identifier = exam_id(exam)

    with zipfile.ZipFile(archive_path) as archive:
        names = [info.filename for info in archive.infolist() if not info.is_dir()]
        paper_name = find_paper_name(names)
        open_paper_name = find_open_paper_name(names, paper_name)
        key_name = find_key_name(names)
        paper_contents = archive.read(paper_name)
        open_paper_contents = archive.read(open_paper_name)
        key_contents = archive.read(key_name)

    answers = ANSWER_OVERRIDES.get(identifier) or parse_choice_answers(pdf_text(key_contents))
    question_numbers = [int(question) for question in answers]
    expected_questions = list(range(1, max(question_numbers) + 1))
    if sorted(question_numbers) != expected_questions:
        raise ValueError(f"{identifier}: expected contiguous answers, found {sorted(question_numbers)}")

    blocks = split_question_blocks(extract_choice_section(pdf_text(paper_contents)))
    questions: list[ParsedQuestion] = []
    for number in expected_questions:
        if number not in blocks:
            continue
        try:
            questions.append(parse_question(blocks[number], number))
        except ValueError as exc:
            raise ValueError(f"{identifier}: {exc}") from exc
    if [question.number for question in questions] != expected_questions:
        raise ValueError(
            f"{identifier}: expected questions {expected_questions}, "
            f"found {[question.number for question in questions]}"
        )
    option_by_question = {str(question.number): set(question.options) for question in questions}
    for question, correct_answers in answers.items():
        invalid_answers = [answer for answer in correct_answers if answer not in option_by_question[question]]
        if invalid_answers:
            raise ValueError(
                f"{identifier}: answer {invalid_answers} is not valid for question {question}"
            )

    expected_assets = {"paper.pdf"}
    destination = PAPER_ROOT / identifier / "paper.pdf"
    write_if_changed(destination, paper_contents)
    open_paper_filename = "paper.pdf"
    open_paper_destination = destination
    if open_paper_name != paper_name:
        open_paper_filename = "open-paper.pdf"
        open_paper_destination = PAPER_ROOT / identifier / open_paper_filename
        write_if_changed(open_paper_destination, open_paper_contents)
        expected_assets.add(open_paper_filename)

    source_images = render_source_pages(
        destination,
        identifier,
        find_question_crops(paper_contents, expected_questions),
        expected_assets=expected_assets,
    )
    open_question_crops, open_question_points = find_open_question_crops(open_paper_contents)
    open_question_numbers = sorted(open_question_crops)
    open_question_images = render_grouped_source_pages(
        open_paper_destination,
        identifier,
        open_question_crops,
        page_prefix="open-page",
        expected_assets=expected_assets,
    )
    solution_key_destination = PAPER_ROOT / identifier / "solutions.pdf"
    write_if_changed(solution_key_destination, key_contents)
    expected_assets.add("solutions.pdf")
    solution_crops, solution_points = find_solution_page_crops(key_contents, open_question_numbers)
    solution_images = render_source_pages(
        solution_key_destination,
        identifier,
        solution_crops,
        page_prefix="solution-page",
        expected_assets=expected_assets,
    )
    open_question_points = {**solution_points, **open_question_points}
    remove_unexpected_assets(identifier, expected_assets)

    return {
        "id": identifier,
        "year": exam["year"],
        "schoolYear": exam["schoolYear"],
        "term": normalize_term(exam["term"]),
        "archiveUrl": exam["url"],
        "paperUrl": f"{PAPER_URL_PREFIX}/{quote(identifier)}/paper.pdf",
        "openPaperUrl": f"{PAPER_URL_PREFIX}/{quote(identifier)}/{open_paper_filename}",
        "durationMinutes": DURATION_MINUTES,
        "checkingSupported": True,
        "tasks": build_tasks(questions, source_images),
        "openTasks": build_open_tasks(open_question_images, solution_images, open_question_points),
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
    physics_exams = [
        exam for exam in archive_index["exams"] if exam["subject"] == SUBJECT
    ]
    exams = [build_exam(exam) for exam in physics_exams]
    remove_orphaned_papers({exam["id"] for exam in exams})

    payload = {
        "version": 1,
        "exams": exams,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text(f"{OUTPUT_PREFIX}{serialized};\n", encoding="utf-8")

    print(f"Wrote {len(exams)} Physics practice exams to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise
