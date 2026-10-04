#!/usr/bin/env python3
"""Build the static German reading practice index from mirrored NCVVO ZIP files."""

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
from pdf_utils import pdftotext, png_dimensions, render_pdf_page_to_png


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "german-reading.js"
PAPER_ROOT = ROOT / "files" / "interactive" / "german-reading"
PAPER_URL_PREFIX = "./files/interactive/german-reading"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_GERMAN_READING="
SUBJECT = "Njemački jezik"
TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}

# Level B used a different (6-task) reading structure through 2016 and the
# official key layout is unreliable to parse before this year. Skip earlier
# exams rather than guess at a legacy structure.
MIN_YEAR = 2019

# The last reading task switched from free-text gap-fill answers to a
# machine-readable multiple-choice/matching format in 2022, same cutoff year
# as the English reading paper.
CHECKING_MIN_YEAR = 2022
TASK_HEADING = re.compile(r"(?im)^\s*Aufgabe\s+(\d+)\s*$")
BLANK_PAGE_PARTS = {"P", "ca", "ni", "ra", "st", "a", "zn", "00", "01", "02"}
SOURCE_RENDER_DPI = 144
SOURCE_CROP_HORIZONTAL_MARGIN = 48
SOURCE_CROP_VERTICAL_PADDING = 9


@dataclass(frozen=True)
class Task:
    number: int
    first_question: int
    last_question: int
    kind: str
    options: str = ""

    def to_json(self) -> dict[str, Any]:
        return {
            "number": self.number,
            "firstQuestion": self.first_question,
            "lastQuestion": self.last_question,
            "kind": self.kind,
            "options": list(self.options),
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
class TaskMarker:
    number: int
    page: PdfPage
    y_min: float


@dataclass(frozen=True)
class SourceCrop:
    page: PdfPage
    x_min: float
    y_min: float
    x_max: float
    y_max: float


CropKey = tuple[str, int] | tuple[str, int, str]
PdfLineEntry = tuple[PdfPage, PdfLine]


# Levels A and B each keep a stable 5-task shape from 2019 onward; only the
# final task's kind (choice vs free text) changes at CHECKING_MIN_YEAR.
A_COMMON_TASKS = (
    Task(1, 1, 8, "choice", "ABCDEFGHIJ"),
    Task(2, 9, 16, "choice", "ABCD"),
    Task(3, 17, 24, "choice", "ABCDEFGHIJ"),
    Task(4, 25, 32, "choice", "ABCD"),
)

B_COMMON_TASKS = (
    Task(1, 1, 6, "choice", "ABCDEFG"),
    Task(2, 7, 12, "choice", "ABC"),
    Task(3, 13, 18, "choice", "ABCDEFG"),
    Task(4, 19, 24, "choice", "ABC"),
)


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
    return f"njemacki-{exam['level'].casefold()}-{exam['year']}-{term}"


def local_archive_path(url: str) -> Path:
    parsed_url = urlparse(url)
    if parsed_url.scheme or parsed_url.netloc or parsed_url.query or parsed_url.fragment:
        raise ValueError(f"Unsupported local archive URL: {url}")

    relative_path = Path(unquote(parsed_url.path.removeprefix("./")))
    archive_path = ROOT / relative_path
    archive_path.resolve().relative_to(ROOT.resolve())
    return archive_path


def find_single_pdf(names: list[str], description: str, pattern: re.Pattern[str]) -> str:
    candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf") and pattern.search(Path(name).name)
    ]
    if len(candidates) != 1:
        raise ValueError(f"Expected one {description}, found {len(candidates)}: {candidates}")
    return candidates[0]


def pdf_text(contents: bytes) -> str:
    return pdftotext(
        contents,
        "-layout",
        required_message="pdftotext is required to build German reading data",
    )


def pdf_bbox_pages(contents: bytes) -> list[PdfPage]:
    xml = pdftotext(
        contents,
        "-bbox-layout",
        required_message="pdftotext is required to build German reading source images",
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
            word_objects = tuple(
                PdfWord(
                    text="".join(word.itertext()).strip(),
                    x_min=float(word.attrib["xMin"]),
                    x_max=float(word.attrib["xMax"]),
                    y_min=float(word.attrib["yMin"]),
                    y_max=float(word.attrib["yMax"]),
                )
                for word in words
                if "".join(word.itertext()).strip()
            )
            if not word_objects:
                continue
            lines.append(
                PdfLine(
                    text=" ".join(word.text for word in word_objects),
                    first_word=word_objects[0].text,
                    x_min=word_objects[0].x_min,
                    x_max=word_objects[-1].x_max,
                    y_min=float(line_element.attrib["yMin"]),
                    y_max=float(line_element.attrib["yMax"]),
                    words=word_objects,
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


def parse_duration(text: str) -> int:
    match = re.search(
        r"Ispit\s+\w*itanja(?:\s+i\s+pisanja)?\s+traje\s+(\d+)\s+minuta",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        raise ValueError("Could not find reading duration in paper")
    return int(match.group(1))


def is_running_header_or_footer(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False

    if re.fullmatch(
        r"\(?(?:Leseverstehen|Njemački jezik)\)?(?:\s+\(?(?:Leseverstehen|Njemački jezik)\)?)*",
        stripped,
        flags=re.IGNORECASE,
    ):
        return True

    if re.search(r"\bNJE\s*[AB]\b.*(?:IK[- ]?1|D-S\d+)", stripped, flags=re.IGNORECASE):
        return True

    if ".indd" in stripped:
        return True

    if re.fullmatch(r"\d{1,2}\.\d{1,2}\.\d{4}\.?\s+\d{1,2}:\d{2}:\d{2}", stripped):
        return True

    if re.fullmatch(r"\d+/\d+", stripped):
        return True

    if re.fullmatch(r"\d{1,2}", stripped):
        return True

    return stripped in BLANK_PAGE_PARTS


def clean_task_text(raw_text: str) -> str:
    raw_text = re.sub(r"[\x00-\x08\x0b-\x1f]", "", raw_text)
    cleaned_pages: list[str] = []
    for page in raw_text.replace("\r\n", "\n").replace("\r", "\n").split("\f"):
        lines = [
            line.rstrip()
            for line in page.split("\n")
            if not is_running_header_or_footer(line)
        ]

        while lines and not lines[0].strip():
            lines.pop(0)
        while lines and not lines[-1].strip():
            lines.pop()

        page_text = "\n".join(lines)
        if not re.search(r"[A-Za-z]{3,}", page_text):
            continue

        page_text = re.sub(r"\n{3,}", "\n\n", page_text)
        cleaned_pages.append(page_text)

    return "\n\n".join(cleaned_pages).strip()


def extract_task_texts(text: str, tasks: tuple[Task, ...]) -> dict[int, str]:
    matches = list(TASK_HEADING.finditer(text))
    match_by_number = {int(match.group(1)): match for match in matches}
    task_texts: dict[int, str] = {}

    for task in tasks:
        match = match_by_number.get(task.number)
        if match is None:
            raise ValueError(f"Could not find Aufgabe {task.number} in reading paper")

        next_matches = [candidate for candidate in matches if candidate.start() > match.start()]
        end = next_matches[0].start() if next_matches else len(text)
        raw_task_text = text[match.start() : end]
        task_text = clean_task_text(raw_task_text)
        if not task_text:
            raise ValueError(f"Aufgabe {task.number} has no extracted text")
        task_texts[task.number] = task_text

    return task_texts


def tasks_for(exam: dict[str, Any]) -> tuple[Task, ...]:
    has_choice_only_format = exam["year"] >= CHECKING_MIN_YEAR
    if exam["level"] == "A":
        final_task = Task(5, 33, 40, "choice", "ABCDEFGHIJK")
        if not has_choice_only_format:
            final_task = Task(5, 33, 40, "text")
        return (*A_COMMON_TASKS, final_task)

    if exam["level"] == "B":
        final_task = Task(5, 25, 30, "choice", "ABCDEFGHI")
        if not has_choice_only_format:
            final_task = Task(5, 25, 30, "text")
        return (*B_COMMON_TASKS, final_task)

    raise ValueError(f"Unsupported German exam level: {exam['level']}")


def parse_choice_answers(text: str, tasks: tuple[Task, ...]) -> dict[str, str]:
    reading_section = re.split(
        r"ISPITNA CJELINA (?:SLUŠANJE|PISANJE)",
        text,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    answers = {
        int(question): answer
        for question, answer in re.findall(
            r"^\s*(\d+)\.?\s+([A-Z])\s*$",
            reading_section,
            flags=re.MULTILINE,
        )
    }
    expected_questions = [
        question
        for task in tasks
        for question in range(task.first_question, task.last_question + 1)
    ]
    if sorted(answers) != expected_questions:
        raise ValueError(
            f"Expected answers {expected_questions}, found {sorted(answers)}"
        )

    for task in tasks:
        for question in range(task.first_question, task.last_question + 1):
            answer = answers[question]
            if answer not in task.options:
                raise ValueError(
                    f"Answer {answer} for question {question} is not valid for task "
                    f"{task.number}: {task.options}"
                )

    return {str(question): answers[question] for question in expected_questions}


def marker_position(marker: TaskMarker) -> tuple[int, float]:
    return marker.page.number, marker.y_min


def select_reading_task_markers(
    markers: list[TaskMarker],
    tasks: tuple[Task, ...],
) -> list[TaskMarker]:
    selected: list[TaskMarker] = []
    cursor = (0, -1.0)
    for task in tasks:
        marker = next(
            (
                candidate
                for candidate in markers
                if candidate.number == task.number and marker_position(candidate) > cursor
            ),
            None,
        )
        if marker is None:
            raise ValueError(f"Could not locate Aufgabe {task.number} in German reading paper")
        selected.append(marker)
        cursor = marker_position(marker)
    return selected


def question_number_from_line(line: PdfLine) -> str | None:
    match = re.match(r"^\s*(\d{1,2})\b", line.text.strip())
    return match.group(1) if match else None


def task_question_marker_number(
    page: PdfPage,
    line: PdfLine,
    expected_questions: set[str],
) -> str | None:
    question = question_number_from_line(line)
    if question not in expected_questions:
        return None
    if line.y_min >= page.height - 80:
        return None
    if line.x_min > SOURCE_CROP_HORIZONTAL_MARGIN + 48:
        return None
    return question


def should_split_numbered_choice_questions(task: Task) -> bool:
    # Every German reading task numbers its items down the left margin
    # (both the matching tasks and the plain multiple-choice ones), so
    # per-question crops can be split for the whole task set.
    return task.kind == "choice" and bool(task.options)


def find_trailing_reference_start(
    line_entries: list[PdfLineEntry],
    after_position: tuple[int, float],
) -> tuple[int, float] | None:
    # Matching tasks (e.g. Aufgabe 1) print their shared list of lettered
    # options ("Überschriften:", ...) AFTER the last numbered item rather
    # than before it. Detect that trailing label line so it can be pulled
    # out of the last item's crop and shown once at the top of the task
    # instead, alongside every question.
    for page, line in line_entries:
        position = (page.number, line.y_min)
        if position <= after_position:
            continue
        if re.fullmatch(r"[A-Za-zÀ-ÿ]+:", line.text.strip()):
            return position
    return None


def numbered_choice_question_crops(
    line_entries: list[PdfLineEntry],
    task: Task,
) -> tuple[dict[str, list[SourceCrop]], tuple[int, float] | None]:
    expected_questions = [
        str(question)
        for question in range(task.first_question, task.last_question + 1)
    ]
    expected_set = set(expected_questions)
    marker_candidates: list[tuple[str, PdfPage, PdfLine]] = []
    for page, line in line_entries:
        question = task_question_marker_number(page, line, expected_set)
        if question:
            marker_candidates.append((question, page, line))
    selected_markers: list[tuple[str, PdfPage, PdfLine]] = []
    cursor = (0, -1.0)

    for question in expected_questions:
        marker = next(
            (
                candidate
                for candidate in marker_candidates
                if candidate[0] == question and (candidate[1].number, candidate[2].y_min) > cursor
            ),
            None,
        )
        if marker is None:
            return {}, None
        selected_markers.append(marker)
        cursor = (marker[1].number, marker[2].y_min)

    last_marker_page, last_marker_line = selected_markers[-1][1], selected_markers[-1][2]
    trailing_start = find_trailing_reference_start(
        line_entries, (last_marker_page.number, last_marker_line.y_min)
    )

    crops: dict[str, list[SourceCrop]] = {}
    for index, (question, marker_page, marker_line) in enumerate(selected_markers):
        start = (marker_page.number, marker_line.y_min)
        next_marker = selected_markers[index + 1] if index + 1 < len(selected_markers) else None
        if next_marker:
            end = (next_marker[1].number, next_marker[2].y_min)
        elif trailing_start:
            end = trailing_start
        else:
            end = (10_000, 10_000.0)
        group_entries: list[PdfLineEntry] = []
        for page, line in line_entries:
            position = (page.number, line.y_min)
            if position < start or position >= end:
                continue
            if is_running_header_or_footer(line.text) and line is not marker_line:
                continue
            group_entries.append((page, line))

        question_crops: list[SourceCrop] = []
        page_numbers = []
        for page, _line in group_entries:
            if page.number not in page_numbers:
                page_numbers.append(page.number)

        for page_number in page_numbers:
            page_entries = [
                (page, line)
                for page, line in group_entries
                if page.number == page_number
            ]
            page = page_entries[0][0]
            lines = [line for _page, line in page_entries]
            y_min = max(0, min(line.y_min for line in lines) - SOURCE_CROP_VERTICAL_PADDING)
            y_max = min(page.height, max(line.y_max for line in lines) + SOURCE_CROP_VERTICAL_PADDING)
            question_crops.append(
                SourceCrop(
                    page=page,
                    x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
                    y_min=y_min,
                    x_max=page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
                    y_max=y_max,
                )
            )

        crops[question] = question_crops

    return crops, trailing_start


def task_line_entries(
    pages: list[PdfPage],
    marker: TaskMarker,
    next_marker: TaskMarker | None,
) -> list[PdfLineEntry]:
    line_entries: list[PdfLineEntry] = []
    for page in pages:
        if page.number < marker.page.number:
            continue
        if next_marker and page.number > next_marker.page.number:
            continue

        for line in sorted_page_lines(page):
            if not line.text.strip():
                continue
            if page.number == marker.page.number and line.y_min < marker.y_min:
                continue
            if next_marker and page.number == next_marker.page.number and line.y_min >= next_marker.y_min:
                continue
            line_entries.append((page, line))

    return line_entries


def find_task_source_crops(
    contents: bytes,
    tasks: tuple[Task, ...],
    split_choice_questions: bool = False,
) -> tuple[dict[int, list[SourceCrop]], dict[int, dict[str, list[SourceCrop]]]]:
    pages = pdf_bbox_pages(contents)
    task_numbers = {task.number for task in tasks}
    task_by_number = {task.number: task for task in tasks}
    markers: list[TaskMarker] = []

    for page in pages:
        for line in sorted_page_lines(page):
            match = re.fullmatch(r"Aufgabe\s+(\d+)", line.text.strip(), flags=re.IGNORECASE)
            if not match:
                continue
            number = int(match.group(1))
            if number in task_numbers:
                markers.append(TaskMarker(number=number, page=page, y_min=line.y_min))

    markers.sort(key=marker_position)
    selected_markers = select_reading_task_markers(markers, tasks)

    crops: dict[int, list[SourceCrop]] = {}
    question_crops: dict[int, dict[str, list[SourceCrop]]] = {}
    for index, marker in enumerate(selected_markers):
        next_marker = (
            selected_markers[index + 1]
            if index + 1 < len(selected_markers)
            else None
        )
        task = task_by_number[marker.number]
        line_entries = task_line_entries(pages, marker, next_marker)
        numbered_question_crops, trailing_reference_start = (
            numbered_choice_question_crops(line_entries, task)
            if split_choice_questions and should_split_numbered_choice_questions(task)
            else ({}, None)
        )
        first_question_position = None
        if numbered_question_crops:
            first_question_crop = numbered_question_crops[str(task.first_question)][0]
            first_question_position = (
                first_question_crop.page.number,
                first_question_crop.y_min,
            )
        lines_by_page: dict[int, list[PdfLine]] = {}
        for page, line in line_entries:
            lines_by_page.setdefault(page.number, []).append(line)
        task_crops: list[SourceCrop] = []
        for page in pages:
            if page.number not in lines_by_page:
                continue

            page_lines = lines_by_page[page.number]
            relevant_lines = [
                line for line in page_lines if not is_running_header_or_footer(line.text)
            ]
            if first_question_position:
                relevant_lines = [
                    line
                    for line in relevant_lines
                    if (page.number, line.y_min) < first_question_position
                ]

            if not relevant_lines:
                if first_question_position and page.number >= first_question_position[0]:
                    break
                continue

            y_min = max(0, relevant_lines[0].y_min - SOURCE_CROP_VERTICAL_PADDING)
            y_max = min(page.height, relevant_lines[-1].y_max + SOURCE_CROP_VERTICAL_PADDING)
            if y_max <= y_min:
                raise ValueError(f"Aufgabe {marker.number} has an invalid crop on page {page.number}")

            task_crops.append(
                SourceCrop(
                    page=page,
                    x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
                    y_min=y_min,
                    x_max=page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
                    y_max=y_max,
                )
            )

            if next_marker and page.number == next_marker.page.number:
                break

        if trailing_reference_start:
            trailing_lines_by_page: dict[int, list[PdfLine]] = {}
            for page, line in line_entries:
                position = (page.number, line.y_min)
                if position < trailing_reference_start:
                    continue
                if is_running_header_or_footer(line.text):
                    continue
                trailing_lines_by_page.setdefault(page.number, []).append(line)

            for page in pages:
                if page.number not in trailing_lines_by_page:
                    continue
                trailing_lines = trailing_lines_by_page[page.number]
                trailing_y_min = max(0, trailing_lines[0].y_min - SOURCE_CROP_VERTICAL_PADDING)
                trailing_y_max = min(
                    page.height, trailing_lines[-1].y_max + SOURCE_CROP_VERTICAL_PADDING
                )
                task_crops.append(
                    SourceCrop(
                        page=page,
                        x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
                        y_min=trailing_y_min,
                        x_max=page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
                        y_max=trailing_y_max,
                    )
                )
                if next_marker and page.number == next_marker.page.number:
                    break

        if not task_crops:
            raise ValueError(f"Aufgabe {marker.number} has no visible source crop")
        crops[marker.number] = task_crops
        if numbered_question_crops:
            question_crops.setdefault(marker.number, {}).update(numbered_question_crops)

    return crops, question_crops


def render_source_pages(
    paper_path: Path,
    identifier: str,
    crops: dict[CropKey, list[SourceCrop]],
    expected_assets: set[str],
    preserve_horizontal_keys: set[CropKey] | None = None,
) -> dict[CropKey, list[dict[str, Any]]]:
    preserve_horizontal_keys = preserve_horizontal_keys or set()
    destination = PAPER_ROOT / identifier
    crops_by_page: dict[int, list[tuple[CropKey, SourceCrop]]] = {}
    for crop_key, task_crops in crops.items():
        for crop in task_crops:
            crops_by_page.setdefault(crop.page.number, []).append((crop_key, crop))

    source_images: dict[CropKey, list[dict[str, Any]]] = {}
    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        for page_number, page_crops in sorted(crops_by_page.items()):
            filename = f"page-{page_number}.png"
            temporary_prefix = temporary_root / f"page-{page_number}"
            render_pdf_page_to_png(
                paper_path,
                temporary_prefix,
                page_number,
                SOURCE_RENDER_DPI,
                required_message="pdftocairo is required to build German reading source images",
            )

            contents = temporary_prefix.with_suffix(".png").read_bytes()
            image_width, image_height = png_dimensions(contents)
            write_if_changed(destination / filename, contents)
            expected_assets.add(filename)
            page_image = grayscale_image_from_png(contents)

            for crop_key, crop in page_crops:
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
                    detect_legacy_answer_frame=crop_key not in preserve_horizontal_keys,
                )
                source_images.setdefault(crop_key, []).append(
                    source_image_metadata(
                        page_image,
                        url=f"{PAPER_URL_PREFIX}/{quote(identifier)}/{filename}",
                        page=page_number,
                        image_width=image_width,
                        image_height=image_height,
                        crop_box=(x_min, y_min, x_max, y_max),
                    )
                )

    return source_images


def crop_relative_region(
    source_image: dict[str, Any],
    crop: SourceCrop,
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


def underscore_region(word: PdfWord) -> tuple[float, float, float, float] | None:
    stripped = word.text.strip()
    if "_" not in stripped:
        return None

    match = re.search(r"_+", stripped)
    if not match:
        return None

    if len(stripped) == match.end() - match.start():
        return word.x_min, word.y_min, word.x_max, word.y_max

    text_width = max(1, len(stripped))
    word_width = word.x_max - word.x_min
    x_min = word.x_min + (match.start() / text_width) * word_width
    x_max = word.x_min + (match.end() / text_width) * word_width
    return x_min, word.y_min, x_max, word.y_max


def question_from_parenthesized_gap(line: PdfLine, word_index: int) -> str | None:
    word = line.words[word_index]
    embedded = re.search(r"\((\d{1,2})\)\s*_+", word.text.replace("\xad", ""))
    if embedded:
        return embedded.group(1)

    previous = " ".join(
        item.text for item in line.words[max(0, word_index - 4) : word_index]
    ).replace("\xad", "")
    match = re.search(r"\((\d{1,2})\)\s*$", previous)
    return match.group(1) if match else None


def question_from_numbered_blank_line(line: PdfLine, word_index: int) -> str | None:
    if word_index == 0 or not line.words:
        return None
    first_word = line.words[0].text.strip().strip(".:")
    return first_word if re.fullmatch(r"\d{1,2}", first_word) else None


def question_from_nearby_numbered_line(lines: list[PdfLine], line_index: int) -> str | None:
    current = lines[line_index]
    current_x = current.words[0].x_min if current.words else 0
    for previous in reversed(lines[max(0, line_index - 8) : line_index]):
        if abs(previous.y_min - current.y_min) > 2.5:
            continue
        if previous.words and previous.words[0].x_min >= current_x:
            continue
        question = question_from_numbered_blank_line(previous, 1)
        if question:
            return question
    return None


def text_blank_regions(
    task_crops: list[SourceCrop],
    task: Task,
    source_images: list[dict[str, Any]],
) -> dict[str, dict[str, int]]:
    expected_questions = {
        str(question)
        for question in range(task.first_question, task.last_question + 1)
    }
    parenthesized: dict[str, dict[str, int]] = {}
    numbered_lines: dict[str, dict[str, int]] = {}

    for index, crop in enumerate(task_crops):
        if index >= len(source_images):
            continue
        source_image = source_images[index]

        lines = sorted_page_lines(crop.page)
        for line_index, line in enumerate(lines):
            if line.y_min < crop.y_min or line.y_max > crop.y_max:
                continue

            for word_index, word in enumerate(line.words):
                region = underscore_region(word)
                if not region:
                    continue

                parenthesized_question = question_from_parenthesized_gap(line, word_index)
                numbered_question = (
                    question_from_numbered_blank_line(line, word_index)
                    or question_from_nearby_numbered_line(lines, line_index)
                )

                for target, question in (
                    (parenthesized, parenthesized_question),
                    (numbered_lines, numbered_question),
                ):
                    if question not in expected_questions or question in target:
                        continue
                    relative = crop_relative_region(source_image, crop, *region)
                    if relative:
                        target[question] = {"sourceImageIndex": index, **relative}

    return parenthesized or numbered_lines


def remove_unexpected_files(destination: Path, expected_assets: set[str]) -> None:
    if not destination.is_dir():
        return
    for path in destination.iterdir():
        if path.is_file() and path.name not in expected_assets:
            path.unlink()


def write_if_changed(path: Path, contents: bytes) -> None:
    if path.is_file() and path.read_bytes() == contents:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)


def task_payload(
    task: Task,
    task_texts: dict[int, str],
    task_crops: dict[int, list[SourceCrop]],
    source_images: dict[int, list[dict[str, Any]]],
    question_images: dict[int, dict[str, dict[str, Any] | list[dict[str, Any]]]],
) -> dict[str, Any]:
    payload = task.to_json() | {
        "text": task_texts[task.number],
        "sourceImages": source_images.get(task.number, []),
    }
    if question_images.get(task.number):
        payload["questionImages"] = question_images[task.number]
    blanks = text_blank_regions(
        task_crops.get(task.number, []),
        task,
        source_images.get(task.number, []),
    )
    expected_blank_count = task.last_question - task.first_question + 1
    if len(blanks) == expected_blank_count:
        payload["blanks"] = blanks
    return payload


def build_exam(exam: dict[str, Any]) -> dict[str, Any]:
    archive_path = local_archive_path(exam["url"])
    tasks = tasks_for(exam)

    with zipfile.ZipFile(archive_path) as archive:
        names = [info.filename for info in archive.infolist() if not info.is_dir()]
        paper_name = find_single_pdf(
            names,
            "reading paper",
            re.compile(r"(?:ispitna knjizica|ik)[ _-]*1", flags=re.IGNORECASE),
        )
        key_name = find_single_pdf(
            names,
            "answer key",
            re.compile(r"klju", flags=re.IGNORECASE),
        )
        paper_contents = archive.read(paper_name)
        key_contents = archive.read(key_name)

    paper_text = pdf_text(paper_contents)
    task_texts = extract_task_texts(paper_text, tasks)
    term = normalize_term(exam["term"])
    identifier = exam_id(exam)
    destination = PAPER_ROOT / identifier
    expected_assets = {"paper.pdf", "key.pdf"}
    write_if_changed(destination / "paper.pdf", paper_contents)
    write_if_changed(destination / "key.pdf", key_contents)
    has_checking = exam["year"] >= CHECKING_MIN_YEAR
    task_crops, matching_question_crops = find_task_source_crops(
        paper_contents,
        tasks,
        split_choice_questions=True,
    )
    render_crops: dict[CropKey, list[SourceCrop]] = {
        ("task", task_number): crops
        for task_number, crops in task_crops.items()
    }
    for task_number, task_question_crops in matching_question_crops.items():
        for question, crops in task_question_crops.items():
            render_crops[("question", task_number, question)] = crops

    rendered_images = render_source_pages(
        destination / "paper.pdf",
        identifier,
        render_crops,
        expected_assets,
    )
    source_images = {
        task.number: rendered_images.get(("task", task.number), [])
        for task in tasks
    }
    expected_blank_counts = {
        task.number: task.last_question - task.first_question + 1 for task in tasks
    }
    incomplete_gap_task_numbers = {
        task.number
        for task in tasks
        if task.kind == "text"
        and len(
            text_blank_regions(
                task_crops.get(task.number, []),
                task,
                source_images.get(task.number, []),
            )
        )
        != expected_blank_counts[task.number]
    }
    if incomplete_gap_task_numbers:
        preserved_rendered_images = render_source_pages(
            destination / "paper.pdf",
            identifier,
            render_crops,
            expected_assets,
            preserve_horizontal_keys={
                ("task", task_number) for task_number in incomplete_gap_task_numbers
            },
        )
        preserved_source_images = {
            task.number: preserved_rendered_images.get(("task", task.number), [])
            for task in tasks
        }
        for task in tasks:
            if task.number not in incomplete_gap_task_numbers:
                continue
            current_count = len(
                text_blank_regions(
                    task_crops.get(task.number, []),
                    task,
                    source_images.get(task.number, []),
                )
            )
            preserved_count = len(
                text_blank_regions(
                    task_crops.get(task.number, []),
                    task,
                    preserved_source_images.get(task.number, []),
                )
            )
            if preserved_count > current_count:
                source_images[task.number] = preserved_source_images[task.number]
    question_images: dict[int, dict[str, dict[str, Any] | list[dict[str, Any]]]] = {}
    for task_number, task_question_crops in matching_question_crops.items():
        question_images[task_number] = {}
        for question in task_question_crops:
            images = rendered_images.get(("question", task_number, question), [])
            if images:
                question_images[task_number][question] = images[0] if len(images) == 1 else images
    remove_unexpected_files(destination, expected_assets)

    answers = parse_choice_answers(pdf_text(key_contents), tasks) if has_checking else {}

    return {
        "id": identifier,
        "year": exam["year"],
        "schoolYear": exam["schoolYear"],
        "term": term,
        "level": exam["level"],
        "archiveUrl": exam["url"],
        "paperUrl": f"{PAPER_URL_PREFIX}/{quote(identifier)}/paper.pdf",
        "keyUrl": f"{PAPER_URL_PREFIX}/{quote(identifier)}/key.pdf",
        "durationMinutes": parse_duration(paper_text),
        "checkingSupported": has_checking,
        "tasks": [
            task_payload(task, task_texts, task_crops, source_images, question_images)
            for task in tasks
        ],
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
    german_exams = [
        exam
        for exam in archive_index["exams"]
        if exam["subject"] == SUBJECT and exam["year"] >= MIN_YEAR
    ]
    exams = [build_exam(exam) for exam in german_exams]
    remove_orphaned_papers({exam["id"] for exam in exams})

    payload = {
        "version": 1,
        "checkingMinYear": CHECKING_MIN_YEAR,
        "exams": exams,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text(f"{OUTPUT_PREFIX}{serialized};\n", encoding="utf-8")

    checkable_count = sum(exam["checkingSupported"] for exam in exams)
    print(
        f"Wrote {len(exams)} German reading exams to {OUTPUT.relative_to(ROOT)} "
        f"({checkable_count} with answer checking)"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise
