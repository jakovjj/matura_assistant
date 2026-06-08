#!/usr/bin/env python3
"""Build the static English reading practice index from mirrored NCVVO ZIP files."""

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

from crop_utils import grayscale_image_from_png, trim_crop_bottom_whitespace
from pdf_utils import pdftotext, png_dimensions, render_pdf_page_to_png


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "english-reading.js"
PAPER_ROOT = ROOT / "files" / "interactive" / "english-reading"
PAPER_URL_PREFIX = "./files/interactive/english-reading"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_ENGLISH_READING="
SUBJECT = "Engleski jezik"
TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}

# The exam format changed in 2022. From that year onward all reading responses
# are choices and the official key has a stable machine-readable layout.
CHECKING_MIN_YEAR = 2022
TASK_HEADING = re.compile(r"(?m)^\s*Task\s+(\d+)\s*$")
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


A_COMMON_TASKS = (
    Task(1, 1, 12, "choice", "ABCDEF"),
    Task(2, 13, 18, "choice", "ABCD"),
    Task(3, 19, 24, "choice", "ABCDEFGH"),
    Task(4, 25, 32, "choice", "ABCD"),
)

B_COMMON_TASKS = (
    Task(1, 1, 5, "choice", "ABCDEF"),
    Task(2, 6, 10, "choice", "ABC"),
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
    return f"engleski-{exam['level'].casefold()}-{exam['year']}-{term}"


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
        required_message="pdftotext is required to build English reading data",
    )


def pdf_bbox_pages(contents: bytes) -> list[PdfPage]:
    xml = pdftotext(
        contents,
        "-bbox-layout",
        required_message="pdftotext is required to build English reading source images",
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
        r"(?:Reading Paper|Writing Paper|Engleski jezik)(?:\s+(?:Reading Paper|Writing Paper|Engleski jezik))*",
        stripped,
    ):
        return True

    if re.search(r"\bENG\s*[AB]\b.*(?:IK[- ]?1|D-S\d+)", stripped, flags=re.IGNORECASE):
        return True

    if re.search(r"\bENG[AB]\b.*Ispitna knjizica 1", stripped, flags=re.IGNORECASE):
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
            raise ValueError(f"Could not find Task {task.number} in reading paper")

        next_matches = [candidate for candidate in matches if candidate.start() > match.start()]
        end = next_matches[0].start() if next_matches else len(text)
        raw_task_text = text[match.start() : end]
        raw_task_text = re.split(
            r"(?m)^\s*(?:ISPIT\s+PISANJA|\(Writing Paper\)|Writing Paper)\s*$",
            raw_task_text,
            maxsplit=1,
        )[0]
        task_text = clean_task_text(raw_task_text)
        if not task_text:
            raise ValueError(f"Task {task.number} has no extracted text")
        task_texts[task.number] = task_text

    return task_texts


def tasks_for(exam: dict[str, Any]) -> tuple[Task, ...]:
    has_choice_only_format = exam["year"] >= CHECKING_MIN_YEAR
    if exam["level"] == "A":
        final_task = Task(5, 33, 40, "choice", "ABCDEFGHIJKLM")
        if not has_choice_only_format:
            final_task = Task(5, 33, 40, "text")
        return (*A_COMMON_TASKS, final_task)

    if exam["level"] == "B":
        third_task = Task(3, 11, 15, "choice", "ABC")
        final_task = Task(6, 26, 30, "choice", "ABCDEFGHI")
        if not has_choice_only_format:
            third_task = Task(3, 11, 15, "text")
            final_task = Task(6, 26, 30, "text")
        return (
            *B_COMMON_TASKS,
            third_task,
            Task(4, 16, 20, "choice", "ABCDEF"),
            Task(5, 21, 25, "choice", "ABC"),
            final_task,
        )

    raise ValueError(f"Unsupported English exam level: {exam['level']}")


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


def is_writing_section_marker(line: PdfLine) -> bool:
    stripped = line.text.strip()
    return bool(
        re.fullmatch(r"ISPIT\s+PISANJA", stripped, flags=re.IGNORECASE)
        or re.fullmatch(r"\(?Writing\s+Paper\)?(?:\s+Engleski\s+jezik)?", stripped, flags=re.IGNORECASE)
    )


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
            raise ValueError(f"Could not locate Task {task.number} in English reading paper")
        selected.append(marker)
        cursor = marker_position(marker)
    return selected


def find_reading_end_marker(pages: list[PdfPage], last_task_marker: TaskMarker) -> TaskMarker | None:
    last_position = marker_position(last_task_marker)
    for page in pages:
        for line in sorted_page_lines(page):
            if (page.number, line.y_min) <= last_position:
                continue
            if is_writing_section_marker(line):
                return TaskMarker(number=0, page=page, y_min=line.y_min)
    return None


def is_person_matching_prompt(line: PdfLine) -> bool:
    return bool(re.match(r"^\s*Which\s+person\b", line.text.strip(), flags=re.IGNORECASE))


def is_matching_question_line_candidate(page: PdfPage, line: PdfLine) -> bool:
    stripped = line.text.strip()
    if re.fullmatch(r"\d{1,2}", stripped):
        return line.y_min < page.height - 80
    return not is_running_header_or_footer(stripped)


def question_number_from_line(line: PdfLine) -> str | None:
    match = re.match(r"^\s*(\d{1,2})\b", line.text.strip())
    return match.group(1) if match else None


def person_matching_question_crops(
    line_entries: list[PdfLineEntry],
    task: Task,
) -> dict[str, SourceCrop]:
    expected_questions = {
        str(question)
        for question in range(task.first_question, task.last_question + 1)
    }
    groups: dict[str, list[PdfLineEntry]] = {}
    current_question: str | None = None

    for page, line in line_entries:
        question = question_number_from_line(line)
        if question == "0":
            current_question = None
            continue
        if question in expected_questions:
            current_question = question
            groups[current_question] = [(page, line)]
            continue
        if current_question:
            groups[current_question].append((page, line))

    missing_questions = sorted(
        expected_questions.difference(groups),
        key=int,
    )
    if missing_questions:
        raise ValueError(
            f"Could not locate matching question crops for task {task.number}: "
            f"{', '.join(missing_questions)}"
        )

    crops: dict[str, SourceCrop] = {}
    for question in sorted(expected_questions, key=int):
        entries = groups[question]
        pages = {page.number: page for page, _line in entries}
        if len(pages) != 1:
            raise ValueError(
                f"Question {question} in task {task.number} spans multiple pages"
            )
        page = next(iter(pages.values()))
        lines = [line for _page, line in entries]
        y_min = max(0, min(line.y_min for line in lines) - SOURCE_CROP_VERTICAL_PADDING)
        y_max = min(page.height, max(line.y_max for line in lines) + SOURCE_CROP_VERTICAL_PADDING)
        crops[question] = SourceCrop(
            page=page,
            x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
            y_min=y_min,
            x_max=page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
            y_max=y_max,
        )

    return crops


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
    return task.kind == "choice" and task.number == 2 and bool(task.options)


def numbered_choice_question_crops(
    line_entries: list[PdfLineEntry],
    task: Task,
) -> dict[str, list[SourceCrop]]:
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
            return {}
        selected_markers.append(marker)
        cursor = (marker[1].number, marker[2].y_min)

    crops: dict[str, list[SourceCrop]] = {}
    for index, (question, marker_page, marker_line) in enumerate(selected_markers):
        start = (marker_page.number, marker_line.y_min)
        next_marker = selected_markers[index + 1] if index + 1 < len(selected_markers) else None
        end = (
            (next_marker[1].number, next_marker[2].y_min)
            if next_marker
            else (10_000, 10_000.0)
        )
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

    return crops


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
    split_matching_prompts: bool = False,
    split_choice_questions: bool = False,
) -> tuple[dict[int, list[SourceCrop]], dict[int, dict[str, list[SourceCrop]]]]:
    pages = pdf_bbox_pages(contents)
    task_numbers = {task.number for task in tasks}
    task_by_number = {task.number: task for task in tasks}
    markers: list[TaskMarker] = []

    for page in pages:
        for line in sorted_page_lines(page):
            match = re.fullmatch(r"Task\s+(\d+)", line.text.strip(), flags=re.IGNORECASE)
            if not match:
                continue
            number = int(match.group(1))
            if number in task_numbers:
                markers.append(TaskMarker(number=number, page=page, y_min=line.y_min))

    markers.sort(key=marker_position)
    selected_markers = select_reading_task_markers(markers, tasks)
    reading_end_marker = find_reading_end_marker(pages, selected_markers[-1])

    crops: dict[int, list[SourceCrop]] = {}
    question_crops: dict[int, dict[str, list[SourceCrop]]] = {}
    for index, marker in enumerate(selected_markers):
        next_marker = (
            selected_markers[index + 1]
            if index + 1 < len(selected_markers)
            else reading_end_marker
        )
        task = task_by_number[marker.number]
        line_entries = task_line_entries(pages, marker, next_marker)
        numbered_question_crops = (
            numbered_choice_question_crops(line_entries, task)
            if split_choice_questions and should_split_numbered_choice_questions(task)
            else {}
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
        found_trailing_matching_prompt = False
        matching_question_lines: list[PdfLineEntry] = []
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

            if split_matching_prompts:
                prompt_index = next(
                    (
                        line_index
                        for line_index, line in enumerate(page_lines)
                        if is_person_matching_prompt(line)
                    ),
                    None,
                )
                if prompt_index is not None:
                    found_trailing_matching_prompt = True
                    matching_question_lines.extend(
                        (page, line)
                        for line in page_lines[prompt_index + 1 :]
                        if is_matching_question_line_candidate(page, line)
                    )
                    relevant_lines = [
                        line
                        for line in page_lines[:prompt_index]
                        if not is_running_header_or_footer(line.text)
                    ]
                elif found_trailing_matching_prompt:
                    matching_question_lines.extend(
                        (page, line)
                        for line in page_lines
                        if is_matching_question_line_candidate(page, line)
                    )
                    relevant_lines = []

            if not relevant_lines:
                if found_trailing_matching_prompt:
                    break
                if first_question_position and page.number >= first_question_position[0]:
                    break
                continue

            y_min = max(0, relevant_lines[0].y_min - SOURCE_CROP_VERTICAL_PADDING)
            y_max = min(page.height, relevant_lines[-1].y_max + SOURCE_CROP_VERTICAL_PADDING)
            if y_max <= y_min:
                raise ValueError(f"Task {marker.number} has an invalid crop on page {page.number}")

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
            if found_trailing_matching_prompt:
                break

        if not task_crops:
            raise ValueError(f"Task {marker.number} has no visible source crop")
        crops[marker.number] = task_crops
        if matching_question_lines:
            question_crops[marker.number] = {
                question: [crop]
                for question, crop in person_matching_question_crops(
                    matching_question_lines,
                    task_by_number[marker.number],
                ).items()
            }
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
                required_message="pdftocairo is required to build English reading source images",
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
                    {
                        "url": f"{PAPER_URL_PREFIX}/{quote(identifier)}/{filename}",
                        "page": page_number,
                        "width": image_width,
                        "height": image_height,
                        "crop": {
                            "x": x_min,
                            "y": y_min,
                            "width": x_max - x_min,
                            "height": y_max - y_min,
                        },
                    }
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

    # Prefer true inline blanks such as "(33) ___". B-level form-completion
    # tasks use numbered rows, so use those only when no inline gaps exist.
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
        split_matching_prompts=has_checking,
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
    gap_task_numbers = {
        task.number for task in tasks if task.number >= (3 if exam["level"] == "A" else 4)
    }
    incomplete_gap_task_numbers = {
        task.number
        for task in tasks
        if task.number in gap_task_numbers
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
    english_exams = [
        exam for exam in archive_index["exams"] if exam["subject"] == SUBJECT
    ]
    exams = [build_exam(exam) for exam in english_exams]
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
        f"Wrote {len(exams)} English reading exams to {OUTPUT.relative_to(ROOT)} "
        f"({checkable_count} with answer checking)"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise
