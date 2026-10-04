#!/usr/bin/env python3
"""Build the static Mathematics practice index from mirrored NCVVO ZIP files."""

from __future__ import annotations

import hashlib
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
from pdf_crop_layout import HorizontalRule, detect_horizontal_rules, solution_table_row_bounds
from pdf_utils import pdftotext, png_dimensions, render_pdf_page_to_png


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "math-choice.js"
PAPER_ROOT = ROOT / "files" / "interactive" / "math-choice"
PAPER_URL_PREFIX = "./files/interactive/math-choice"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_MATH_CHOICE="
SUBJECT = "Matematika"
# Hand-verified answer keys for exams whose only answer source is a hand-marked
# bubble sheet (no machine-readable key). The pixel parser misreads those, both
# flipping letters and dropping whole questions (the question set is derived from
# the parsed answers), so we substitute a verified key. Keyed by exam id, mapping
# question number -> correct letter. See math_choice_answer_overrides.json.
ANSWER_OVERRIDES_PATH = ROOT / "scripts" / "math_choice_answer_overrides.json"
ANSWER_OVERRIDES: dict[str, dict[str, str]] = (
    json.loads(ANSWER_OVERRIDES_PATH.read_text(encoding="utf-8"))
    if ANSWER_OVERRIDES_PATH.is_file()
    else {}
)

# Open tasks whose official answer key prints an empty answer box (NCVVO left
# the cell blank in the post-grading key, so there is nothing to crop). Listed
# items get no solutionImage; the solver then reveals a short "no official
# solution" note instead of an empty crop. Keyed by exam id -> question numbers.
# See math_choice_blank_solutions.json.
BLANK_SOLUTIONS_PATH = ROOT / "scripts" / "math_choice_blank_solutions.json"
BLANK_SOLUTIONS: dict[str, list[str]] = (
    json.loads(BLANK_SOLUTIONS_PATH.read_text(encoding="utf-8"))
    if BLANK_SOLUTIONS_PATH.is_file()
    else {}
)
MIN_CHOICE_QUESTIONS = 10
SOURCE_RENDER_DPI = 144
SOURCE_CROP_HORIZONTAL_MARGIN = 48
SOURCE_CROP_VERTICAL_PADDING = 9
SOURCE_FOOTER_MARGIN = 65
SOLUTION_FOOTER_MARGIN = 36
SOLUTION_CROP_VERTICAL_PADDING = 8
# Never let a solution crop begin in the preceding task's row. Table-rule
# detection is useful for whitespace, but some official keys omit a rule
# between adjacent rows (for example 2026 summer A, tasks 20 and 21).
SOLUTION_MARKER_TOP_PADDING = 2
SOLUTION_TABLE_RULE_MIN_WIDTH_RATIO = 0.45
SOLUTION_TABLE_CROP_PADDING = 2
SOLUTION_RULE_MARKER_TOLERANCE = 4
# Two answer-key markers count as sharing a table row when their tops align
# within this many PDF points. Within-row markers align within a few points;
# the smallest gap between separate rows in these keys is ~30.
SOLUTION_ROW_TOLERANCE = 14
# A page is treated as a clean row grid (questions laid out left-to-right per
# row, like the 2022+ keys) only when at least this fraction of its markers
# share their row with a marker in another column. Column-flow keys (questions
# stacked within columns) score well below this and keep the simple per-column
# crop so a wide answer is never extended into a neighbouring question.
SOLUTION_ROW_GRID_SHARE_MIN = 0.9
# A merged cell's right edge is only pushed past the default per-column boundary
# when a table border sits at least this many PDF points beyond it; smaller gaps
# are just the regular column separator and must not trigger an extension.
SOLUTION_MERGE_MIN = 16
# A vertical dark run inside a cell's row counts as the bordering table rule when
# it is darker than this and spans both the absolute and proportional minimums of
# the row band.
SOLUTION_MERGE_RULE_THRESHOLD = 160
SOLUTION_MERGE_RULE_MIN_RUN = 40
SOLUTION_MERGE_RULE_BAND_RATIO = 0.8
TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}
QUESTION_RE = re.compile(r"(?m)^\s{0,32}(\d{1,2})(?:\.|\s+(?=[A-ZČĆŽŠĐ]))\s*\S")
QUESTION_TOKEN_RE = re.compile(r"^\s*(\d{1,2}(?:[\.,]\d{1,2})?)\s*\.(?!\d)")
BLANK_PAGE_PARTS = {"P", "ca", "ni", "ra", "st", "a", "zn", "99", "00", "01", "02"}
POINT_VALUE_RE = re.compile(r"\s*\(\s*\d+\s+bod(?:a|ova)?\s*\)", flags=re.IGNORECASE)
POINT_LABEL_RE = re.compile(r"\(?\s*(\d+)\s+(bod(?:a|ova)?)\s*\)?", flags=re.IGNORECASE)
TOTAL_POINT_LABEL_RE = re.compile(
    r"Ukupno\s+(\d+)\s+bod(?:a|ova)?", flags=re.IGNORECASE
)
POSTUPAK_RE = re.compile(r"^\s*Postupak\s*:?\s*$", flags=re.IGNORECASE)
SOLUTION_SEPARATOR_RE = re.compile(r"[\s_\-–—]{6,}")

@dataclass(frozen=True)
class ParsedQuestion:
    number: str
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
class PdfWord:
    text: str
    x_min: float
    x_max: float
    y_min: float
    y_max: float


@dataclass(frozen=True)
class QuestionMarker:
    number: str
    page: PdfPage
    y_min: float
    x_min: float = 0.0
    section: str = ""


@dataclass(frozen=True)
class QuestionCrop:
    page: PdfPage
    x_min: float
    y_min: float
    x_max: float
    y_max: float


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


def line_starts_with_question_token(line: PdfLine) -> str | None:
    match = QUESTION_TOKEN_RE.match(line.text)
    if not match:
        return None
    return parse_question_token(match.group(1))


def line_starts_with_known_question_token(line: PdfLine, wanted_numbers: set[str]) -> str | None:
    match = re.match(
        r"^\s*(\d{1,2}(?:[\.,]\d{1,2})?)(?:\.|\b)",
        line.text,
    )
    if not match:
        return None
    number = parse_question_token(match.group(1))
    return number if number in wanted_numbers else None


def whole_question_number(question: str) -> int:
    return int(question.split(".", 1)[0])


def solution_layout_markers(pages: list[PdfPage], question_numbers: list[str]) -> list[QuestionMarker]:
    whole_min = min(whole_question_number(number) for number in question_numbers)
    whole_max = max(whole_question_number(number) for number in question_numbers)
    markers: list[QuestionMarker] = []
    seen: set[tuple[int, str, float, float]] = set()

    for page in pages:
        for line in sorted_page_lines(page):
            number = line_starts_with_question_token(line)
            if number is None:
                continue
            if not whole_min <= whole_question_number(number) <= whole_max:
                continue
            key = (page.number, number, round(line.x_min, 1), round(line.y_min, 1))
            if key in seen:
                continue
            seen.add(key)
            markers.append(QuestionMarker(number=number, page=page, y_min=line.y_min, x_min=line.x_min))

    return markers


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
    level = f"-{exam['level'].casefold()}" if exam.get("level") else ""
    return f"matematika{level}-{exam['year']}-{slugify(normalize_term(exam['term']))}"


def duration_minutes(exam: dict[str, Any]) -> int:
    return 150 if exam.get("level") == "B" else 180


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
        required_message="pdftotext is required to build Mathematics practice data",
    )


def pdf_bbox_pages(contents: bytes) -> list[PdfPage]:
    xml = pdftotext(
        contents,
        "-bbox-layout",
        required_message="pdftotext is required to build Mathematics source images",
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


def pdf_bbox_words(contents: bytes) -> list[PdfWord]:
    xml = pdftotext(
        contents,
        "-bbox-layout",
        required_message="pdftotext is required to read Mathematics answer sheets",
        failure_prefix="pdftotext -bbox-layout failed",
    )
    xml = "".join(character for character in xml if character in "\t\n\r" or ord(character) >= 32)
    root = ElementTree.fromstring(xml)
    return [
        PdfWord(
            text="".join(word.itertext()).strip(),
            x_min=float(word.attrib["xMin"]),
            x_max=float(word.attrib["xMax"]),
            y_min=float(word.attrib["yMin"]),
            y_max=float(word.attrib["yMax"]),
        )
        for word in root.findall(".//{*}word")
    ]


def legacy_question_marker(line: PdfLine, number: str) -> bool:
    if line.first_word != number or line.text == line.first_word:
        return False
    remainder = line.text[len(line.first_word) :].strip()
    return bool(remainder) and (remainder[0].isupper() or remainder[0] in "([")


def find_question_crops(contents: bytes, question_numbers: list[str]) -> dict[str, QuestionCrop]:
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
            has_legacy_question_number = legacy_question_marker(line, number)
            if line.x_min < 150 and (has_question_number or has_legacy_question_number):
                markers.append(QuestionMarker(number=number, page=page, y_min=line.y_min, x_min=line.x_min))
                expected_index += 1

    found_numbers = [marker.number for marker in markers]
    if found_numbers != question_numbers:
        raise ValueError(
            f"Could not locate Mathematics choice question crops: expected {question_numbers}, "
            f"found {found_numbers}"
        )

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
    score_box_points = point_value_from_score_box_lines(lines)
    if score_box_points is not None:
        return format_point_label(score_box_points)
    return None


def format_point_label(points: int) -> str:
    if points == 1:
        return "1 bod"
    if 2 <= points <= 4:
        return f"{points} boda"
    return f"{points} bodova"


def point_label_from_solution_lines(lines: list[PdfLine]) -> str | None:
    text = "\n".join(line.text for line in lines)
    total_match = TOTAL_POINT_LABEL_RE.search(text)
    if total_match:
        return format_point_label(int(total_match.group(1)))

    point_values = [
        int(match.group(1))
        for line in lines
        for match in POINT_LABEL_RE.finditer(line.text)
    ]
    if point_values:
        return format_point_label(sum(point_values))
    return point_label_from_lines(lines)


def exact_point_value(line: PdfLine) -> int | None:
    match = re.fullmatch(
        r"\s*\(?\s*(?:Ukupno\s*)?(\d+)\s+bod(?:a|ova)?\s*\)?\s*",
        line.text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    value = int(match.group(1))
    return value if 1 <= value <= 40 else None


def criterion_point_value(line: PdfLine) -> int | None:
    match = re.match(
        r"\s*(\d+)\s+bod(?:a|ova)?\s*(?::|[-–])",
        line.text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    value = int(match.group(1))
    return value if 1 <= value <= 10 else None


def point_value_from_score_box_lines(lines: list[PdfLine]) -> int | None:
    box_values: list[int] = []
    for index, line in enumerate(lines):
        if not re.fullmatch(r"\s*bod\s*", line.text, flags=re.IGNORECASE):
            continue

        values: list[int] = []
        for nearby_line in lines[max(0, index - 10):index]:
            if abs(nearby_line.x_min - line.x_min) > 32:
                continue
            if not re.fullmatch(r"\s*(?:\d+\s*)+\s*", nearby_line.text):
                continue
            values.extend(int(item) for item in re.findall(r"\d+", nearby_line.text))

        valid_values = [value for value in values if 1 <= value <= 10]
        if valid_values:
            box_values.append(max(valid_values))

    total = sum(box_values)
    return total if 1 <= total <= 40 else None


def question_block_lines(
    pages: list[PdfPage],
    marker: QuestionMarker,
    next_marker: QuestionMarker | None,
) -> list[PdfLine]:
    lines: list[PdfLine] = []
    for page in pages:
        if page.number < marker.page.number:
            continue
        if next_marker and page.number > next_marker.page.number:
            break

        y_min = marker.y_min if page.number == marker.page.number else 0
        if next_marker and page.number == next_marker.page.number:
            y_max = next_marker.y_min
        else:
            y_max = page.height - SOURCE_FOOTER_MARGIN

        lines.extend(
            line
            for line in sorted_page_lines(page)
            if line.y_min >= y_min and line.y_min < y_max
        )
    return lines


def next_marker_after(marker: QuestionMarker, ordered_markers: list[QuestionMarker]) -> QuestionMarker | None:
    for candidate in ordered_markers:
        if candidate.page.number < marker.page.number:
            continue
        if candidate.page.number == marker.page.number and candidate.y_min <= marker.y_min + 0.5:
            continue
        return candidate
    return None


def marker_column_bounds(page: PdfPage, page_markers: list[QuestionMarker], marker: QuestionMarker) -> tuple[float, float, int]:
    centers: list[list[float]] = []
    for x_min in sorted(item.x_min for item in page_markers):
        if not centers or x_min - centers[-1][-1] > 40:
            centers.append([x_min])
        else:
            centers[-1].append(x_min)

    cluster_centers = [sum(cluster) / len(cluster) for cluster in centers]
    cluster_index = min(
        range(len(cluster_centers)),
        key=lambda index: abs(cluster_centers[index] - marker.x_min),
    )
    left_bound = 0 if cluster_index == 0 else cluster_centers[cluster_index] - 12
    right_bound = (
        page.width
        if cluster_index + 1 >= len(cluster_centers)
        else cluster_centers[cluster_index + 1] - 12
    )
    return left_bound, right_bound, cluster_index


def solution_points_from_blocks(markers: list[QuestionMarker]) -> dict[str, str]:
    points: dict[str, str] = {}
    markers_by_page: dict[int, list[QuestionMarker]] = {}
    for marker in markers:
        markers_by_page.setdefault(marker.page.number, []).append(marker)

    for page_markers in markers_by_page.values():
        page = page_markers[0].page
        page_markers.sort(key=lambda marker: (marker.x_min, marker.y_min, question_sort_key(marker.number)))
        cluster_indexes = {
            marker.number: marker_column_bounds(page, page_markers, marker)[2]
            for marker in page_markers
        }

        for marker in page_markers:
            left_bound, right_bound, cluster_index = marker_column_bounds(page, page_markers, marker)
            next_marker = next(
                (
                    item
                    for item in sorted(page_markers, key=lambda item: item.y_min)
                    if item.y_min > marker.y_min + 2
                    and cluster_indexes.get(item.number) == cluster_index
                ),
                None,
            )
            y_max = next_marker.y_min - 2 if next_marker else page.height
            block_lines = [
                line
                for line in sorted_page_lines(page)
                if line.y_min >= marker.y_min
                and line.y_min < y_max
                and line.x_min >= left_bound - 4
                and line.x_min < right_bound + 4
            ]
            exact_values = [
                value
                for value in (exact_point_value(line) for line in block_lines)
                if value is not None
            ]
            if exact_values:
                points[marker.number] = format_point_label(exact_values[0])
                continue

            criterion_values = [
                value
                for value in (criterion_point_value(line) for line in block_lines)
                if value is not None
            ]
            criterion_total = sum(criterion_values)
            if 1 <= criterion_total <= 10:
                points[marker.number] = format_point_label(criterion_total)

    return points


def solution_column_clusters(page_markers: list[QuestionMarker]) -> list[float]:
    centers: list[list[float]] = []
    for x_min in sorted(item.x_min for item in page_markers):
        if not centers or x_min - centers[-1][-1] > 40:
            centers.append([x_min])
        else:
            centers[-1].append(x_min)
    return [sum(cluster) / len(cluster) for cluster in centers]


def marker_cluster_index(cluster_centers: list[float], x_min: float) -> int:
    return min(
        range(len(cluster_centers)),
        key=lambda index: abs(cluster_centers[index] - x_min),
    )


def is_row_grid_page(page_markers: list[QuestionMarker], cluster_centers: list[float]) -> bool:
    if len(page_markers) < 2 or len(cluster_centers) < 2:
        return False
    shared = 0
    for marker in page_markers:
        columns = {
            marker_cluster_index(cluster_centers, item.x_min)
            for item in page_markers
            if abs(item.y_min - marker.y_min) <= SOLUTION_ROW_TOLERANCE
        }
        if len(columns) >= 2:
            shared += 1
    return shared / len(page_markers) >= SOLUTION_ROW_GRID_SHARE_MIN


def solution_column_bounds(page: PdfPage, page_markers: list[QuestionMarker], marker: QuestionMarker) -> tuple[float, float, int]:
    cluster_centers = solution_column_clusters(page_markers)
    cluster_index = marker_cluster_index(cluster_centers, marker.x_min)
    left_bound = max(0, cluster_centers[cluster_index] - 12)
    right_bound = (
        page.width - 18
        if cluster_index + 1 >= len(cluster_centers)
        else cluster_centers[cluster_index + 1] - 12
    )
    return left_bound, right_bound, cluster_index


def is_merged_solution_cell(
    page_markers: list[QuestionMarker],
    cluster_centers: list[float],
    marker: QuestionMarker,
    cluster_index: int,
) -> bool:
    """A merged cell is one on a clean row-grid page that has no neighbouring
    marker in any column to its right on the same row, i.e. its answer spans the
    remaining columns (the 2022 A key's final task is the canonical case)."""
    if not is_row_grid_page(page_markers, cluster_centers):
        return False
    if cluster_index + 1 >= len(cluster_centers):
        return True
    return not any(
        abs(item.y_min - marker.y_min) <= SOLUTION_ROW_TOLERANCE
        and marker_cluster_index(cluster_centers, item.x_min) > cluster_index
        for item in page_markers
    )


def merged_cell_right_bound(
    page: PdfPage,
    page_image: "Image.Image | None",
    default_x_max: float,
    y_min: float,
    y_max: float,
    right_limit: float | None = None,
) -> float:
    """Snap a merged cell's right edge to the table border that bounds its row.
    Scans the rendered page within the cell's own row band for the first
    full-height vertical rule past the default per-column boundary. Falls back to
    the default boundary when the nearest rule is just the regular column
    separator (within ``SOLUTION_MERGE_MIN``) or absent, so a cell is never
    extended into open space or a neighbouring column with no separator."""
    if page_image is None:
        return default_x_max
    width, height = page_image.size
    scale_x = width / page.width
    scale_y = height / page.height
    band_top = max(0, int(round(y_min * scale_y)))
    band_bottom = min(height, int(round(y_max * scale_y)))
    band = band_bottom - band_top
    if band <= 0:
        return default_x_max
    needed_run = max(SOLUTION_MERGE_RULE_MIN_RUN, SOLUTION_MERGE_RULE_BAND_RATIO * band)
    pixels = page_image.load()
    scan_end = min(width - 2, int((right_limit or page.width) * scale_x))
    for x in range(int(round(default_x_max * scale_x)) + 3, scan_end):
        longest = current = 0
        for y in range(band_top, band_bottom):
            if pixels[x, y] < SOLUTION_MERGE_RULE_THRESHOLD:
                current += 1
                longest = max(longest, current)
            else:
                current = 0
        if longest >= needed_run:
            rule_x = x / scale_x
            return rule_x + 1 / scale_x
    return default_x_max


def solution_cell_left_bound(
    page: PdfPage,
    page_image: "Image.Image",
    default_x_min: float,
    marker_x: float,
    y_min: float,
    y_max: float,
) -> float:
    """Remove the neighbouring cell's strip, retaining the actual left rule.

    Only inspect the margin before the question number and require a rule
    through nearly the entire row, so answer text cannot become a crop edge.
    Borderless keys retain their original bounds.
    """
    scale_x = page_image.width / page.width
    scale_y = page_image.height / page.height
    top = max(0, math.ceil(y_min * scale_y) + 2)
    bottom = min(page_image.height, math.floor(y_max * scale_y) - 2)
    if bottom - top < 12:
        return default_x_min
    pixels = page_image.load()
    for x in range(max(0, math.ceil(default_x_min * scale_x)),
                   min(page_image.width, math.floor((marker_x - 2) * scale_x))):
        dark = sum(pixels[x, y] < SOLUTION_MERGE_RULE_THRESHOLD
                   for y in range(top, bottom))
        if dark >= (bottom - top) * 0.9:
            return x / scale_x
    return default_x_min


def horizontal_rule_overlaps_crop(rule: HorizontalRule, x_min: float, x_max: float) -> bool:
    overlap = min(rule.x_max, x_max) - max(rule.x_min, x_min)
    return overlap >= min(30, max(8, (x_max - x_min) * 0.25))


def solution_separator_line(line: PdfLine, x_min: float, x_max: float) -> bool:
    if not SOLUTION_SEPARATOR_RE.fullmatch(line.text):
        return False
    return horizontal_rule_overlaps_crop(
        HorizontalRule(line.x_min, line.y_min, line.x_max, line.y_max),
        x_min,
        x_max,
    )


def line_overlaps_x_range(line: PdfLine, x_min: float, x_max: float) -> bool:
    return min(line.x_max, x_max) - max(line.x_min, x_min) >= 2


def trim_trailing_solution_separator(
    page: PdfPage,
    x_min: float,
    y_min: float,
    x_max: float,
    y_max: float,
    marker_y_min: float,
) -> float:
    trailing_separator: PdfLine | None = None
    for line in reversed(sorted_page_lines(page)):
        if line.y_min < marker_y_min + 18:
            break
        if line.y_min >= y_max or line.y_max <= y_min:
            continue
        if not line_overlaps_x_range(line, x_min, x_max):
            continue
        if solution_separator_line(line, x_min, x_max):
            trailing_separator = line
            continue
        break

    if not trailing_separator:
        return y_max

    return min(y_max, max(y_min + 24, trailing_separator.y_min - SOLUTION_CROP_VERTICAL_PADDING))


def solution_crop_from_marker(
    marker: QuestionMarker,
    page_markers: list[QuestionMarker],
    page_rules: list[HorizontalRule],
    page_image: "Image.Image | None" = None,
) -> QuestionCrop:
    page = marker.page
    x_min, x_max, cluster_index = solution_column_bounds(page, page_markers, marker)
    marker_clusters = [
        (item, solution_column_bounds(page, page_markers, item)[2])
        for item in page_markers
    ]
    same_cluster_markers = sorted(
        [
            item
            for item, item_cluster_index in marker_clusters
            if item_cluster_index == cluster_index
        ],
        key=lambda item: (item.y_min, question_sort_key(item.number)),
    )
    previous_marker = next(
        (
            item
            for item in reversed(same_cluster_markers)
            if item.y_min < marker.y_min - 2
        ),
        None,
    )
    next_marker = next(
        (
            item
            for item in same_cluster_markers
            if item.y_min > marker.y_min + 2
        ),
        None,
    )

    overlapping_rules = [
        rule
        for rule in sorted(page_rules, key=lambda rule: rule.y_min)
        if horizontal_rule_overlaps_crop(rule, x_min, x_max)
    ]
    # Prefer a complete, uniquely assigned table row. Question numbers are
    # often vertically centred beside fractions or multiline answers, so their
    # text coordinates are not the answer's top or bottom.
    row_bounds = solution_table_row_bounds(marker, same_cluster_markers, overlapping_rules)
    if row_bounds is not None:
        y_min, y_max = row_bounds
    else:
        previous_rule = next(
            (
                rule
                for rule in reversed(overlapping_rules)
                if rule.y_max <= marker.y_min - 3
            ),
            None,
        )
        next_rule = next(
            (
                rule
                for rule in overlapping_rules
                if rule.y_min >= marker.y_min + 14
            ),
            None,
        )

        y_min = max(0, marker.y_min - 10)
        previous_rule_is_current_boundary = (
            previous_rule is not None
            and marker.y_min - previous_rule.y_min <= 140
            and (previous_marker is None or previous_rule.y_min > previous_marker.y_min)
        )
        if previous_rule_is_current_boundary:
            y_min = max(0, previous_rule.y_max + SOLUTION_TABLE_CROP_PADDING)

        # A detected table rule can belong to the preceding row when the official
        # key does not draw a separator between every task. Keep the crop anchored
        # to the current marker so the preceding answer can never be revealed.
        y_min = max(y_min, marker.y_min - SOLUTION_MARKER_TOP_PADDING)

        y_max = page.height - SOLUTION_FOOTER_MARGIN
        if next_marker:
            y_max = min(y_max, next_marker.y_min - SOLUTION_CROP_VERTICAL_PADDING)
        if next_rule:
            y_max = min(y_max, next_rule.y_min - SOLUTION_TABLE_CROP_PADDING)

        if y_max <= marker.y_min + 18:
            y_max = (
                next_marker.y_min - SOLUTION_MARKER_TOP_PADDING
                if next_marker
                else page.height - SOLUTION_FOOTER_MARGIN
            )
        if y_max <= y_min:
            y_min = max(0, marker.y_min - 10)
            y_max = min(page.height - SOLUTION_FOOTER_MARGIN, marker.y_min + 220)

        y_max = trim_trailing_solution_separator(page, x_min, y_min, x_max, y_max, marker.y_min)

    # A merged cell (a wide answer that spans the columns to its right, like the
    # 2022 A key's final task) is sliced by the per-column boundary. Push its
    # right edge out to the table border that actually bounds its row.
    if page_image is not None:
        # Scoring guides mix ordinary columns and full-width merged cells on
        # one page. Verify the border in this row instead of classifying the
        # whole page as a grid. Never scan past another answer's marker.
        right_limit = min(
            (item.x_min - 2 for item in page_markers
             if item.x_min > marker.x_min + 40 and y_min <= item.y_min < y_max),
            default=page.width,
        )
        x_max = merged_cell_right_bound(page, page_image, x_max, y_min, y_max, right_limit)
        x_min = solution_cell_left_bound(page, page_image, x_min, marker.x_min, y_min, y_max)

    return QuestionCrop(
        page=page,
        x_min=max(0, x_min),
        y_min=max(0, y_min),
        x_max=min(page.width, max(x_max, x_min + 40)),
        # Compact answer tables can have rows shorter than 24 points. A
        # minimum height would override the next marker and reveal its answer.
        y_max=min(page.height, y_max),
    )


def find_open_question_crops(
    contents: bytes,
    question_numbers: list[str],
) -> tuple[dict[str, QuestionCrop], dict[str, QuestionCrop], dict[str, str], dict[str, str]]:
    pages = pdf_bbox_pages(contents)
    markers: list[QuestionMarker] = []
    wanted_numbers = set(question_numbers)
    multipart_parent_numbers = {
        number.split(".", 1)[0]
        for number in question_numbers
        if "." in number
    }
    parent_markers: dict[str, QuestionMarker] = {}
    found_open_section = False
    current_section = "short"

    for page in pages:
        for line in sorted_page_lines(page):
            if re.search(
                r"II\.\s*Zadatci\s+kratkoga\s+odgovora",
                line.text,
                flags=re.IGNORECASE,
            ):
                found_open_section = True
                current_section = "short"
                continue
            if found_open_section and re.search(
                r"III\.\s*Zadatci\s+produ[žz]enoga\s+odgovora",
                line.text,
                flags=re.IGNORECASE,
            ):
                current_section = "extended"
                continue
            if not found_open_section:
                continue

            number = line_starts_with_question_token(line)
            if number is None or line.x_min >= 220:
                continue
            if number in multipart_parent_numbers and "." not in number:
                parent_markers.setdefault(
                    number,
                    QuestionMarker(
                        number=number,
                        page=page,
                        y_min=line.y_min,
                        x_min=line.x_min,
                        section=current_section,
                    ),
                )
            if number not in wanted_numbers:
                continue
            if any(marker.number == number for marker in markers):
                continue
            markers.append(
                QuestionMarker(
                    number=number,
                    page=page,
                    y_min=line.y_min,
                    x_min=line.x_min,
                    section=current_section,
                )
            )

    if not markers:
        raise ValueError("Could not locate Mathematics open question crops")

    found_numbers = [marker.number for marker in markers]
    if sorted(found_numbers, key=question_sort_key) != sorted(question_numbers, key=question_sort_key):
        raise ValueError(
            f"Could not locate Mathematics open question crops: expected {question_numbers}, "
            f"found {found_numbers}"
        )

    markers.sort(key=lambda marker: (marker.page.number, marker.y_min, question_sort_key(marker.number)))
    crops: dict[str, QuestionCrop] = {}
    context_crops: dict[str, QuestionCrop] = {}
    points: dict[str, str] = {}
    sections: dict[str, str] = {}
    first_child_markers = {
        parent_number: min(
            (
                marker
                for marker in markers
                if marker.number.startswith(f"{parent_number}.")
            ),
            key=lambda marker: (marker.page.number, marker.y_min),
        )
        for parent_number in multipart_parent_numbers
        if any(marker.number.startswith(f"{parent_number}.") for marker in markers)
    }
    crop_boundary_markers = sorted(
        [
            *markers,
            *(
                parent_marker
                for parent_number, parent_marker in parent_markers.items()
                if parent_number in first_child_markers
                and all(marker.number != parent_number for marker in markers)
            ),
        ],
        key=lambda marker: (marker.page.number, marker.y_min, question_sort_key(marker.number)),
    )
    for parent_number, parent_marker in parent_markers.items():
        first_child = first_child_markers.get(parent_number)
        if not first_child:
            continue
        if parent_marker.page.number == first_child.page.number:
            y_max = first_child.y_min - SOURCE_CROP_VERTICAL_PADDING
        else:
            y_max = parent_marker.page.height - SOURCE_FOOTER_MARGIN
        y_min = max(0, parent_marker.y_min - SOURCE_CROP_VERTICAL_PADDING)
        if y_max <= y_min:
            continue
        context_crops[parent_number] = QuestionCrop(
            page=parent_marker.page,
            x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
            y_min=y_min,
            x_max=parent_marker.page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
            y_max=y_max,
        )

    for marker in markers:
        next_marker = next_marker_after(marker, crop_boundary_markers)
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
        if not point_label:
            point_label = point_label_from_lines(question_block_lines(pages, marker, next_marker))
        if point_label:
            points[marker.number] = point_label
        sections[marker.number] = marker.section

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
        crops[marker.number] = QuestionCrop(
            page=marker.page,
            x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
            y_min=y_min,
            x_max=marker.page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
            y_max=y_max,
        )
    return crops, context_crops, points, sections


def find_open_question_numbers(contents: bytes, choice_answers: dict[str, list[str]]) -> list[str]:
    choice_max = max(int(question) for question in choice_answers)
    pages = pdf_bbox_pages(contents)
    found_open_section = False
    numbers: list[str] = []

    for page in pages:
        for line in sorted_page_lines(page):
            if re.search(
                r"II\.\s*Zadatci\s+kratkoga\s+odgovora",
                line.text,
                flags=re.IGNORECASE,
            ):
                found_open_section = True
                continue
            if not found_open_section:
                continue

            number = line_starts_with_question_token(line)
            if number is None or line.x_min >= 220:
                continue
            whole = int(number.split(".", 1)[0])
            if not choice_max < whole <= 60:
                continue
            if number not in numbers:
                numbers.append(number)

    decimal_parent_numbers = {
        number.split(".", 1)[0]
        for number in numbers
        if "." in number
    }
    filtered = [
        number
        for number in numbers
        if "." in number or number not in decimal_parent_numbers
    ]
    if not filtered:
        raise ValueError("Could not find Mathematics open question numbers in paper")
    return sorted(filtered, key=question_sort_key)


def find_solution_page_crops(
    contents: bytes,
    question_numbers: list[str],
) -> tuple[dict[str, QuestionCrop], dict[str, str]]:
    pages = pdf_bbox_pages(contents)
    wanted_numbers = set(question_numbers)
    layout_markers = solution_layout_markers(pages, question_numbers)
    markers = []
    for marker in layout_markers:
        if marker.number not in wanted_numbers:
            continue
        if any(item.number == marker.number for item in markers):
            continue
        markers.append(marker)

    found_numbers = [marker.number for marker in markers]
    if sorted(found_numbers, key=question_sort_key) != sorted(question_numbers, key=question_sort_key):
        for page in pages:
            for line in sorted_page_lines(page):
                number = line_starts_with_known_question_token(line, wanted_numbers)
                if number is None or number not in wanted_numbers:
                    continue
                if any(marker.number == number for marker in markers):
                    continue
                markers.append(QuestionMarker(number=number, page=page, y_min=line.y_min, x_min=line.x_min))

    found_numbers = [marker.number for marker in markers]
    if sorted(found_numbers, key=question_sort_key) != sorted(question_numbers, key=question_sort_key):
        found_set = set(found_numbers)
        for missing_number in question_numbers:
            if missing_number in found_set or not markers:
                continue
            missing_key = question_sort_key(missing_number)
            fallback_marker = min(
                markers,
                key=lambda marker: abs(
                    (question_sort_key(marker.number)[0] * 100 + question_sort_key(marker.number)[1])
                    - (missing_key[0] * 100 + missing_key[1])
                ),
            )
            markers.append(
                QuestionMarker(
                    number=missing_number,
                    page=fallback_marker.page,
                    y_min=fallback_marker.y_min,
                    x_min=fallback_marker.x_min,
                )
            )

    points = solution_points_from_blocks(markers)
    crops: dict[str, QuestionCrop] = {}
    pages_by_number = {page.number: page for page in pages}
    rules_by_page = detect_horizontal_rules(
        contents, pages_by_number,
        dpi=SOURCE_RENDER_DPI,
        minimum_width_ratio=SOLUTION_TABLE_RULE_MIN_WIDTH_RATIO,
    )
    page_images = render_solution_page_images(contents, pages_by_number)
    layout_markers_by_page: dict[int, list[QuestionMarker]] = {}
    for marker in layout_markers:
        layout_markers_by_page.setdefault(marker.page.number, []).append(marker)

    markers_by_page: dict[int, list[QuestionMarker]] = {}
    for marker in markers:
        page_markers = markers_by_page.setdefault(
            marker.page.number,
            list(layout_markers_by_page.get(marker.page.number, [])),
        )
        if not any(
            item.number == marker.number
            and abs(item.x_min - marker.x_min) < 0.5
            and abs(item.y_min - marker.y_min) < 0.5
            for item in page_markers
        ):
            page_markers.append(marker)

    for page_markers in markers_by_page.values():
        page_markers.sort(key=lambda marker: (marker.x_min, marker.y_min, question_sort_key(marker.number)))
        for marker in [item for item in page_markers if item.number in wanted_numbers]:
            crops[marker.number] = solution_crop_from_marker(
                marker,
                page_markers,
                rules_by_page.get(marker.page.number, []),
                page_images.get(marker.page.number),
            )
    return crops, points


def normalized_name(name: str) -> str:
    filename = Path(name).name
    normalized = unicodedata.normalize("NFD", filename).casefold()
    ascii_name = normalized.encode("ascii", "ignore").decode()
    return f"{normalized} {ascii_name}"


def is_answer_sheet_name(name: str) -> bool:
    normalized = normalized_name(name)
    return "list" in normalized and ("odgovor" in normalized or "odgovorima" in normalized)


def is_key_name(name: str) -> bool:
    normalized = normalized_name(name)
    if is_answer_sheet_name(name):
        return False
    return bool(
        re.search(
            r"klju|kljuc|rje[šs]enja|rjesenja|odgovor|bodov|ocjenj",
            normalized,
            flags=re.IGNORECASE,
        )
    )


def find_paper_name(names: list[str]) -> str:
    pdfs = [name for name in names if name.casefold().endswith(".pdf")]
    candidates = [
        name
        for name in pdfs
        if not is_key_name(name)
        and not is_answer_sheet_name(name)
        and not re.search(
            r"\b(?:koncept|formul|formula|prag|bodov|ocjenj|list|t\s*[ab]\b)\b",
            normalized_name(name),
            flags=re.IGNORECASE,
        )
    ]

    ds_candidates = [
        name
        for name in candidates
        if re.search(r"\bmat\s*[ab]\b.*\bd[-_ ]?s\d+", normalized_name(name), flags=re.IGNORECASE)
    ]
    if ds_candidates:
        return sorted(ds_candidates, key=lambda name: normalized_name(Path(name).name))[0]

    booklet_candidates = [
        name
        for name in candidates
        if re.search(r"ispitna\s+knjizica|ispitna\s+knji[žz]ica", normalized_name(name))
    ]
    if booklet_candidates:
        return sorted(booklet_candidates, key=lambda name: normalized_name(Path(name).name))[0]

    if candidates:
        return sorted(candidates, key=lambda name: normalized_name(Path(name).name))[0]

    raise ValueError("Could not find a Mathematics paper PDF")


def find_open_paper_name(names: list[str], choice_paper_name: str) -> str:
    return choice_paper_name


def find_key_name(names: list[str]) -> str:
    return find_key_names(names)[0]


def find_key_names(names: list[str]) -> list[str]:
    candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and is_key_name(name)
        and not re.search(r"\bbodov|ocjenj", normalized_name(name), flags=re.IGNORECASE)
    ]
    if not candidates:
        candidates = [
            name
            for name in names
            if name.casefold().endswith(".pdf") and is_key_name(name)
        ]
    if not candidates:
        raise ValueError("Could not find a Mathematics answer key PDF")
    return sorted(candidates, key=lambda name: normalized_name(Path(name).name))


def find_scoring_name(names: list[str], key_name: str) -> str:
    candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and not is_answer_sheet_name(name)
        and re.search(r"\bbodov|ocjenj", normalized_name(name), flags=re.IGNORECASE)
    ]
    if candidates:
        return sorted(candidates, key=lambda name: normalized_name(Path(name).name))[0]
    return key_name


def find_filled_answer_sheet_name(names: list[str]) -> str | None:
    preferred_candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and is_answer_sheet_name(name)
        and re.search(
            r"\bs\s+odgovorima|\bsa\s+odgovorima|ispunjen|rjesen|rije[šs]en",
            normalized_name(name),
            flags=re.IGNORECASE,
        )
    ]
    candidates = preferred_candidates or [
        name
        for name in names
        if name.casefold().endswith(".pdf") and is_answer_sheet_name(name)
    ]
    if not candidates:
        return None
    return sorted(candidates, key=lambda name: normalized_name(Path(name).name))[0]


def write_if_changed(path: Path, contents: bytes) -> None:
    if path.is_file() and path.read_bytes() == contents:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)


def render_solution_page_images(contents: bytes, pages: dict[int, PdfPage]) -> dict[int, "Image.Image"]:
    """Render each solution page to a grayscale image so merged answer cells can
    be snapped to the table border that bounds their row."""
    images: dict[int, Image.Image] = {}
    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        pdf_path = temporary_root / "source.pdf"
        pdf_path.write_bytes(contents)

        for page_number in sorted(pages):
            temporary_prefix = temporary_root / f"columns-{page_number}"
            render_pdf_page_to_png(
                pdf_path,
                temporary_prefix,
                page_number,
                SOURCE_RENDER_DPI,
                required_message="pdftocairo is required to locate Mathematics solution columns",
                failure_prefix="pdftocairo failed while locating solution columns",
            )
            images[page_number] = Image.open(temporary_prefix.with_suffix(".png")).convert("L").copy()

    return images


def render_source_pages(
    paper_path: Path,
    identifier: str,
    crops: dict[str, QuestionCrop],
    page_prefix: str = "page",
    expected_assets: set[str] | None = None,
) -> dict[str, dict[str, Any]]:
    destination = PAPER_ROOT / identifier
    if expected_assets is None:
        expected_assets = set()
    crops_by_page: dict[int, list[tuple[str, QuestionCrop]]] = {}
    for question, crop in crops.items():
        crops_by_page.setdefault(crop.page.number, []).append((question, crop))

    source_images: dict[str, dict[str, Any]] = {}
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
                required_message="pdftocairo is required to build Mathematics source images",
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
    if stripped == "Matematika":
        return True
    if re.search(r"\bMAT(?:EMATIKA)?\b.*(?:IK[- ]?1|D[- ]?S\d+)", stripped, flags=re.IGNORECASE):
        return True
    if re.search(r"\bMAT\s+[AB]?\s*IK[- ]?1\b", stripped, flags=re.IGNORECASE):
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
        raise ValueError("Could not find Mathematics multiple-choice section")

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
    answers: dict[str, list[str]] = {}
    for question, answer in re.findall(
        r"(?<![\w])(\d{1,2})\.\s*([A-D](?:\s*(?:i|I|ili|/|,|\+)?\s*[A-D])?)\b",
        text,
    ):
        number = int(question)
        key = str(number)
        if not 1 <= number <= 40 or key in answers:
            continue
        normalized = normalize_answer_token(answer)
        if normalized:
            answers[key] = normalized

    expected: list[str] = []
    for number in range(1, 41):
        key = str(number)
        if key not in answers:
            break
        expected.append(key)

    if len(expected) < MIN_CHOICE_QUESTIONS:
        raise ValueError(f"Expected at least {MIN_CHOICE_QUESTIONS} choice answers, found {sorted(answers)}")

    return {number: answers[number] for number in expected}


def option_from_answer_sheet_x(x_center: float) -> str | None:
    if 48 <= x_center < 84:
        return "A"
    if 84 <= x_center < 122:
        return "B"
    if 122 <= x_center < 156:
        return "C"
    if 156 <= x_center < 194:
        return "D"
    return None


def parse_filled_answer_sheet_answers(contents: bytes) -> dict[str, list[str]]:
    text_answers = parse_filled_answer_sheet_text(pdf_text(contents))
    if len(text_answers) >= MIN_CHOICE_QUESTIONS:
        return text_answers

    words = [
        word
        for word in pdf_bbox_words(contents)
        if word.x_min < 235 and 170 <= word.y_min <= 540
    ]
    row_markers = [
        word
        for word in words
        if word.x_min < 80
        and (
            re.fullmatch(r"\d{1,2}\.", word.text)
            or re.fullmatch(r"[lLiI1]", word.text)
            or re.fullmatch(r"\d{1,2},", word.text)
        )
    ]
    row_centers = [
        (word.y_min + word.y_max) / 2
        for word in sorted(row_markers, key=lambda item: item.y_min)
    ]
    if len(row_centers) < MIN_CHOICE_QUESTIONS and len(row_centers) >= 3:
        gaps = [
            row_centers[index + 1] - row_centers[index]
            for index in range(min(len(row_centers) - 1, 4))
            if 12 <= row_centers[index + 1] - row_centers[index] <= 35
        ]
        if gaps:
            gap = sorted(gaps)[len(gaps) // 2]
            first_center = row_centers[0]
            row_centers = [
                first_center + index * gap
                for index in range(40)
                if first_center + index * gap < 570
            ]

    answers: dict[str, list[str]] = {}
    for question_number, row_center in enumerate(row_centers, start=1):
        row_words = [
            word
            for word in words
            if 45 <= word.x_min < 235
            and abs(((word.y_min + word.y_max) / 2) - row_center) <= 14
        ]
        option_words = [
            word
            for word in sorted(row_words, key=lambda item: item.x_min)
            if not re.fullmatch(r"\d{1,2}[\.,]?", word.text)
            and re.search(r"[A-Da-dcCoOqQ8xX(]", word.text)
        ][:4]
        if len(option_words) < 3:
            continue

        selected: tuple[int, str] | None = None
        for option, word in zip(["A", "B", "C", "D"], option_words):
            normalized = word.text.upper()
            width = word.x_max - word.x_min
            score = 0
            if "X" in normalized:
                score += 3
            if width > 12:
                score += 2
            if normalized not in {option, option.lower(), "C", "c"}:
                score += 1
            if score and (selected is None or score > selected[0]):
                selected = (score, option)

        if selected:
            answers[str(question_number)] = [selected[1]]

    if len(answers) < MIN_CHOICE_QUESTIONS:
        pixel_answers = parse_filled_answer_sheet_pixels(contents)
        if len(pixel_answers) >= MIN_CHOICE_QUESTIONS:
            return pixel_answers
        raise ValueError(f"Could not parse filled answer sheet, found {len(answers)} answers")
    return answers


def answer_sheet_row_centers(words: list[PdfWord]) -> list[float]:
    row_markers = [
        word
        for word in words
        if word.x_min < 80
        and (
            re.fullmatch(r"\d{1,2}\.", word.text)
            or re.fullmatch(r"[lLiI1]", word.text)
            or re.fullmatch(r"\d{1,2},", word.text)
        )
    ]
    row_centers = [
        (word.y_min + word.y_max) / 2
        for word in sorted(row_markers, key=lambda item: item.y_min)
    ]
    if len(row_centers) < MIN_CHOICE_QUESTIONS and len(row_centers) >= 3:
        gaps = [
            row_centers[index + 1] - row_centers[index]
            for index in range(min(len(row_centers) - 1, 4))
            if 12 <= row_centers[index + 1] - row_centers[index] <= 35
        ]
        if gaps:
            gap = sorted(gaps)[len(gaps) // 2]
            first_center = row_centers[0]
            row_centers = [
                first_center + index * gap
                for index in range(40)
                if first_center + index * gap < 570
            ]
    return row_centers


def answer_sheet_option_centers(words: list[PdfWord], row_center: float) -> list[float]:
    row_words = [
        word
        for word in words
        if 45 <= word.x_min < 235
        and abs(((word.y_min + word.y_max) / 2) - row_center) <= 14
    ]
    option_words = [
        word
        for word in sorted(row_words, key=lambda item: item.x_min)
        if not re.fullmatch(r"\d{1,2}[\.,]?", word.text)
        and re.search(r"[A-Da-dcCoOqQ8xX(]", word.text)
    ][:4]
    if len(option_words) >= 4:
        return [(word.x_min + word.x_max) / 2 for word in option_words]
    return []


def parse_filled_answer_sheet_pixels(contents: bytes) -> dict[str, list[str]]:
    pages = pdf_bbox_pages(contents)
    if not pages:
        return {}
    page = pages[0]
    words = [
        word
        for word in pdf_bbox_words(contents)
        if word.x_min < 235 and 170 <= word.y_min <= 620
    ]
    row_centers = answer_sheet_row_centers(words)
    if not row_centers:
        return {}
    option_centers = answer_sheet_option_centers(words, row_centers[0])
    if len(option_centers) < 4:
        return {}

    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        pdf_path = temporary_root / "answer-sheet.pdf"
        pdf_path.write_bytes(contents)
        output_prefix = temporary_root / "answer-sheet"
        render_pdf_page_to_png(
            pdf_path,
            output_prefix,
            1,
            SOURCE_RENDER_DPI,
            required_message="pdftocairo is required to read Mathematics answer sheets",
            failure_prefix="pdftocairo failed while reading answer sheet",
        )

        image = Image.open(output_prefix.with_suffix(".png")).convert("L")
        scale_x = image.width / page.width
        scale_y = image.height / page.height
        answers: dict[str, list[str]] = {}

        for question_number, row_center in enumerate(row_centers, start=1):
            scores: list[int] = []
            for option_center in option_centers:
                x_min = max(0, int((option_center - 14) * scale_x))
                x_max = min(image.width, int((option_center + 14) * scale_x))
                y_min = max(0, int((row_center - 9) * scale_y))
                y_max = min(image.height, int((row_center + 9) * scale_y))
                crop = image.crop((x_min, y_min, x_max, y_max))
                scores.append(sum(1 for value in crop.getdata() if value < 170))

            if not scores or max(scores) < 40:
                if question_number > MIN_CHOICE_QUESTIONS:
                    break
                continue
            selected_index = max(range(len(scores)), key=lambda index: scores[index])
            answers[str(question_number)] = [["A", "B", "C", "D"][selected_index]]

        return answers


def parse_filled_answer_sheet_text(text: str) -> dict[str, list[str]]:
    answers: dict[str, list[str]] = {}
    selected_patterns = {
        "A": re.compile(r"(?:A\s*[X(]|(?<![A-D])X\s*A)", flags=re.IGNORECASE),
        "B": re.compile(r"(?:B\s*[XA]|8\s*X|(?<![A-D])X\s*[B8])", flags=re.IGNORECASE),
        "C": re.compile(r"(?:[CQ]\s*X|(?<![A-D])X\s*[CQ])", flags=re.IGNORECASE),
        "D": re.compile(r"(?:[DO]\s*X|(?<![A-D])X\s*[DO])", flags=re.IGNORECASE),
    }

    for line in text.splitlines():
        match = re.match(r"^\s*(\d{1,2}|[oO])[\.,]\s+(.+)$", line)
        if not match:
            continue
        raw_number = match.group(1)
        if raw_number.lower() == "o":
            number = "6"
        else:
            number = str(int(raw_number))
        if number in answers:
            continue
        body = match.group(2)
        selected = [
            option
            for option, pattern in selected_patterns.items()
            if pattern.search(body)
        ]
        if len(selected) == 1:
            answers[number] = [selected[0]]

    if not answers:
        return {}

    contiguous: dict[str, list[str]] = {}
    for number in range(1, 41):
        key = str(number)
        if key not in answers:
            break
        contiguous[key] = answers[key]
    return contiguous


def parse_open_question_numbers(text: str, choice_answers: dict[str, list[str]]) -> list[str]:
    choice_max = max(int(question) for question in choice_answers)
    numbers: set[str] = set()
    for match in re.finditer(r"(?<![\w])(\d{1,2}(?:[\.,]\d{1,2})?)\.", text):
        question = parse_question_token(match.group(1))
        whole = int(question.split(".", 1)[0])
        if choice_max < whole <= 60:
            numbers.add(question)

    filtered = sorted(numbers, key=question_sort_key)
    if not filtered:
        raise ValueError("Could not find Mathematics open question numbers")
    return filtered


def build_tasks(
    questions: list[ParsedQuestion],
    source_images: dict[str, dict[str, Any]],
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
    question_images: dict[str, dict[str, Any]],
    context_images: dict[str, dict[str, Any]],
    solution_images: dict[str, dict[str, Any]],
    points: dict[str, str],
    blank_solutions: set[str] | None = None,
) -> list[dict[str, Any]]:
    blank_solutions = blank_solutions or set()
    question_numbers = sorted(question_images, key=question_sort_key)
    if not question_numbers:
        return []

    missing_solutions = [
        number
        for number in question_numbers
        if number not in solution_images and number not in blank_solutions
    ]
    if missing_solutions:
        raise ValueError(f"Missing Mathematics solution images for {missing_solutions}")

    questions = []
    for number in question_numbers:
        group_number = number.split(".", 1)[0]
        question = {
            "number": number,
            "groupNumber": group_number,
            "sourceImage": question_images[number],
        }
        if number in solution_images:
            question["solutionImage"] = solution_images[number]
        if group_number in context_images and number == next(
            item for item in question_numbers if item.split(".", 1)[0] == group_number
        ):
            question["contextImage"] = context_images[group_number]
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
        key_names = find_key_names(names)
        key_name = key_names[0]
        scoring_name = find_scoring_name(names, key_name)
        answer_sheet_name = find_filled_answer_sheet_name(names)
        paper_contents = archive.read(paper_name)
        open_paper_contents = archive.read(open_paper_name)
        key_contents_items = [(name, archive.read(name)) for name in key_names]
        scoring_contents = archive.read(scoring_name)
        answer_sheet_contents = archive.read(answer_sheet_name) if answer_sheet_name else None

    key_text = ""
    answers: dict[str, list[str]] | None = None
    last_choice_error: Exception | None = None
    for _, key_contents in key_contents_items:
        candidate_text = pdf_text(key_contents)
        if not key_text:
            key_text = candidate_text
        try:
            answers = parse_choice_answers(candidate_text)
            key_text = candidate_text
            break
        except ValueError as exc:
            last_choice_error = exc
    override = ANSWER_OVERRIDES.get(identifier)
    if override is not None:
        # Verified key wins over the unreliable bubble-sheet parse. Driving the
        # question set from this complete key lets the paper-driven crop logic
        # below reconstruct every question (including ones the parser dropped).
        answers = {question: [override[question]] for question in override}
    elif answers is None:
        if not answer_sheet_contents:
            assert last_choice_error is not None
            raise last_choice_error
        answers = parse_filled_answer_sheet_answers(answer_sheet_contents)
        key_text = pdf_text(key_contents_items[0][1])
    choice_question_numbers = list(answers)
    open_question_numbers = find_open_question_numbers(open_paper_contents, answers)
    solution_number_candidates: set[str] = set()
    for solution_text in (pdf_text(scoring_contents), key_text):
        try:
            solution_number_candidates.update(parse_open_question_numbers(solution_text, answers))
        except ValueError:
            pass
    if solution_number_candidates:
        filtered_open_question_numbers = [
            number for number in open_question_numbers if number in solution_number_candidates
        ]
        if filtered_open_question_numbers:
            open_question_numbers = filtered_open_question_numbers

    questions = [
        ParsedQuestion(number=number, text="", options={option: "" for option in ["A", "B", "C", "D"]})
        for number in choice_question_numbers
    ]
    for question, correct_answers in answers.items():
        invalid_answers = [answer for answer in correct_answers if answer not in {"A", "B", "C", "D"}]
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
        find_question_crops(paper_contents, choice_question_numbers),
        expected_assets=expected_assets,
    )
    open_question_crops, open_context_crops, open_question_points, open_question_sections = find_open_question_crops(
        open_paper_contents,
        open_question_numbers,
    )
    rendered_open_images = render_source_pages(
        open_paper_destination,
        identifier,
        {
            **open_question_crops,
            **{
                f"context:{number}": crop
                for number, crop in open_context_crops.items()
            },
        },
        page_prefix="open-page",
        expected_assets=expected_assets,
    )
    open_question_images = {
        number: rendered_open_images[number]
        for number in open_question_crops
    }
    open_context_images = {
        number: rendered_open_images[f"context:{number}"]
        for number in open_context_crops
    }
    solution_key_destination = PAPER_ROOT / identifier / "solutions.pdf"
    write_if_changed(solution_key_destination, scoring_contents)
    expected_assets.add("solutions.pdf")
    solution_crops, _solution_points = find_solution_page_crops(scoring_contents, open_question_numbers)
    blank_solution_numbers = {
        number
        for number in BLANK_SOLUTIONS.get(identifier, [])
        if number in open_question_numbers
    }
    for number in blank_solution_numbers:
        solution_crops.pop(number, None)
    solution_images = render_source_pages(
        solution_key_destination,
        identifier,
        solution_crops,
        page_prefix="solution-page",
        expected_assets=expected_assets,
    )
    open_question_points = {
        **_solution_points,
        **open_question_points,
        **{
            question: "1 bod"
            for question, section in open_question_sections.items()
            if section == "short"
        },
    }
    remove_unexpected_assets(identifier, expected_assets)

    return {
        "id": identifier,
        "year": exam["year"],
        "schoolYear": exam["schoolYear"],
        "term": normalize_term(exam["term"]),
        "level": exam.get("level"),
        "archiveUrl": exam["url"],
        "paperUrl": f"{PAPER_URL_PREFIX}/{quote(identifier)}/paper.pdf",
        "openPaperUrl": f"{PAPER_URL_PREFIX}/{quote(identifier)}/{open_paper_filename}",
        "durationMinutes": duration_minutes(exam),
        "checkingSupported": True,
        "tasks": build_tasks(questions, source_images),
        "openTasks": build_open_tasks(
            open_question_images,
            open_context_images,
            solution_images,
            open_question_points,
            blank_solution_numbers,
        ),
        "answers": answers,
    }


def remove_orphaned_papers(expected_ids: set[str]) -> None:
    if not PAPER_ROOT.is_dir():
        return
    for path in PAPER_ROOT.iterdir():
        if path.is_dir() and path.name not in expected_ids:
            shutil.rmtree(path)


def write_payload(exams: list[dict[str, Any]]) -> None:
    payload = {
        "version": 1,
        "exams": exams,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text(f"{OUTPUT_PREFIX}{serialized};\n", encoding="utf-8")
    # The CDN caches JavaScript even when the origin requests revalidation.
    # Change both entry points whenever the generated data changes so corrected
    # crops cannot remain hidden behind an older cached index.
    revision = hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:12]
    for entrypoint in (ROOT / "matematika.html", ROOT / "app.js"):
        text = entrypoint.read_text(encoding="utf-8")
        updated = re.sub(
            r"\./data/math-choice\.js(?:\?v=[^\s\"']+)?",
            f"./data/math-choice.js?v={revision}",
            text,
        )
        if updated != text:
            entrypoint.write_text(updated, encoding="utf-8")


def main() -> None:
    archive_index = load_archive_index()
    math_exams = [
        exam for exam in archive_index["exams"] if exam["subject"] == SUBJECT
    ]

    target_ids = set(sys.argv[1:])
    if target_ids:
        # Scoped rebuild: regenerate only the requested exam ids and merge them
        # into the existing output, leaving every other exam (and its assets)
        # untouched. Does NOT prune orphaned papers.
        existing_text = OUTPUT.read_text(encoding="utf-8")
        existing = json.loads(existing_text[len(OUTPUT_PREFIX):].strip().rstrip(";"))
        by_id = {entry["id"]: entry for entry in existing["exams"]}
        order = [entry["id"] for entry in existing["exams"]]
        rebuilt: list[str] = []
        for exam in math_exams:
            identifier = exam_id(exam)
            if identifier in target_ids:
                try:
                    by_id[identifier] = build_exam(exam)
                except Exception as exc:
                    raise RuntimeError(f"{identifier}: {exc}") from exc
                rebuilt.append(identifier)
        missing = target_ids - set(rebuilt)
        if missing:
            raise RuntimeError(f"unknown Mathematics exam ids: {sorted(missing)}")
        write_payload([by_id[identifier] for identifier in order])
        print(f"Rebuilt {len(rebuilt)} Mathematics exams (scoped): {', '.join(rebuilt)}")
        return

    exams = []
    for exam in math_exams:
        try:
            exams.append(build_exam(exam))
        except Exception as exc:
            raise RuntimeError(f"{exam_id(exam)}: {exc}") from exc
    remove_orphaned_papers({exam["id"] for exam in exams})
    write_payload(exams)
    print(f"Wrote {len(exams)} Mathematics practice exams to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise
