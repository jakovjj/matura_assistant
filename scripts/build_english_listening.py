#!/usr/bin/env python3
"""Build the static English listening practice index from mirrored NCVVO ZIP files."""

from __future__ import annotations

import json
import math
import re
import shutil
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

from crop_utils import grayscale_image_from_png, trim_crop_bottom_whitespace
from pdf_utils import pdftotext, png_dimensions, render_pdf_page_to_png


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "english-listening.js"
ASSET_ROOT = ROOT / "files" / "interactive" / "english-listening"
ASSET_URL_PREFIX = "./files/interactive/english-listening"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_ENGLISH_LISTENING="
SUBJECT = "Engleski jezik"
TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}

# The official keys from 2022 onward have a stable machine-readable layout.
CHECKING_MIN_YEAR = 2022
TASK_HEADING = re.compile(r"(?m)^\s*Task\s+(\d+)\s*$")
BLANK_PAGE_PARTS = {
    "P",
    "ca",
    "ni",
    "ra",
    "st",
    "a",
    "zn",
    "Prazna stranica",
    "99",
    "00",
    "01",
    "02",
}
AUDIO_SUFFIXES = {".mp3", ".m4a", ".ogg", ".wav", ".wma"}
WEB_AUDIO_SUFFIXES = {".mp3", ".m4a", ".ogg", ".wav"}
SOURCE_RENDER_DPI = 144
SOURCE_CROP_HORIZONTAL_MARGIN = 48
SOURCE_CROP_VERTICAL_PADDING = 9


@dataclass(frozen=True)
class Task:
    number: int
    first_question: int
    last_question: int
    options: str

    def to_json(self) -> dict[str, Any]:
        return {
            "number": self.number,
            "firstQuestion": self.first_question,
            "lastQuestion": self.last_question,
            "kind": "choice",
            "options": list(self.options),
        }


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


A_TASKS = (
    Task(1, 1, 5, "ABCDEFGH"),
    Task(2, 6, 13, "ABC"),
    Task(3, 14, 19, "ABC"),
    Task(4, 20, 25, "ABC"),
)

B_TASKS = (
    Task(1, 1, 5, "ABCDEF"),
    Task(2, 6, 10, "ABC"),
    Task(3, 11, 15, "ABC"),
    Task(4, 16, 20, "ABC"),
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


def natural_sort_key(value: str) -> list[Any]:
    return [
        int(part) if part.isdigit() else part.casefold()
        for part in re.split(r"(\d+)", value)
    ]


def pdf_text(contents: bytes) -> str:
    return pdftotext(
        contents,
        "-layout",
        required_message="pdftotext is required to build English listening data",
    )


def pdf_bbox_pages(contents: bytes) -> list[PdfPage]:
    xml = pdftotext(
        contents,
        "-bbox-layout",
        required_message="pdftotext is required to build English listening source images",
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


def find_single_pdf(names: list[str], description: str, pattern: re.Pattern[str]) -> str:
    candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf") and pattern.search(Path(name).name)
    ]
    if len(candidates) != 1:
        raise ValueError(f"Expected one {description}, found {len(candidates)}: {candidates}")
    return candidates[0]


def find_listening_paper(archive: zipfile.ZipFile, names: list[str]) -> tuple[bytes, str]:
    candidates: list[tuple[bytes, str]] = []
    for name in names:
        if not name.casefold().endswith(".pdf"):
            continue
        contents = archive.read(name)
        text = pdf_text(contents)
        if not re.search(r"ISPIT\s+SLU[ŠS]ANJA|Listening Paper", text, flags=re.IGNORECASE):
            continue
        if len(TASK_HEADING.findall(text)) != 4:
            continue
        candidates.append((contents, text))

    if len(candidates) != 1:
        raise ValueError(f"Expected one listening paper, found {len(candidates)}")
    return candidates[0]


def find_audio_names(names: list[str]) -> list[str]:
    audio_names = [
        name for name in names if Path(name).suffix.casefold() in AUDIO_SUFFIXES
    ]
    return sorted(
        audio_names,
        key=lambda name: (
            "cijeli" not in slugify(Path(name).stem),
            natural_sort_key(name),
        ),
    )


def parse_duration(text: str) -> int:
    match = re.search(
        r"Ispit\s+slušanja\s+traje\s+(\d+)\s+minuta",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        raise ValueError("Could not find listening duration in paper")
    return int(match.group(1))


def is_running_header_or_footer(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False

    if re.fullmatch(
        r"(?:Listening Paper|Engleski jezik)(?:\s+(?:Listening Paper|Engleski jezik))*",
        stripped,
    ):
        return True

    if re.search(r"\bENG\s*[AB]\b.*(?:IK[- ]?\d|D[- ]?S\d+)", stripped, flags=re.IGNORECASE):
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
            raise ValueError(f"Could not find Task {task.number} in listening paper")

        next_matches = [candidate for candidate in matches if candidate.start() > match.start()]
        end = next_matches[0].start() if next_matches else len(text)
        task_text = clean_task_text(text[match.start() : end])
        if not task_text:
            raise ValueError(f"Task {task.number} has no extracted text")
        task_texts[task.number] = task_text

    return task_texts


def tasks_for(exam: dict[str, Any]) -> tuple[Task, ...]:
    if exam["level"] == "A":
        return A_TASKS
    if exam["level"] == "B":
        return B_TASKS
    raise ValueError(f"Unsupported English exam level: {exam['level']}")


def parse_choice_answers(text: str, tasks: tuple[Task, ...]) -> dict[str, str]:
    sections = re.split(
        r"ISPITNA CJELINA\s+SLUŠANJE",
        text,
        maxsplit=1,
        flags=re.IGNORECASE,
    )
    if len(sections) != 2:
        raise ValueError("Could not find listening section in answer key")

    answers = {
        int(question): answer
        for question, answer in re.findall(
            r"^\s*(\d+)\.?\s+([A-H])\s*$",
            sections[1],
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


def write_if_changed(path: Path, contents: bytes) -> None:
    if path.is_file() and path.read_bytes() == contents:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)


def marker_position(marker: TaskMarker) -> tuple[int, float]:
    return marker.page.number, marker.y_min


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
            position = (page.number, line.y_min)
            if position < marker_position(marker):
                continue
            if next_marker and position >= marker_position(next_marker):
                continue
            line_entries.append((page, line))

    return line_entries


def question_marker_visual_top(
    line_entries: list[PdfLineEntry],
    marker_page: PdfPage,
    marker_line: PdfLine,
) -> float:
    aligned_lines = [
        line
        for page, line in line_entries
        if page.number == marker_page.number
        and line.y_max >= marker_line.y_min - 4
        and line.y_min <= marker_line.y_max + 4
    ]
    return min(
        (line.y_min for line in aligned_lines),
        default=marker_line.y_min,
    )


def is_listening_end_marker(line: PdfLine) -> bool:
    return bool(
        re.search(
            r"(?:five minutes.*copy your answers|end of the listening paper)",
            line.text,
            flags=re.IGNORECASE,
        )
    )


def numbered_question_crops(
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
                if candidate[0] == question
                and (candidate[1].number, candidate[2].y_min) > cursor
            ),
            None,
        )
        if marker is None:
            return {}
        selected_markers.append(marker)
        cursor = (marker[1].number, marker[2].y_min)

    crops: dict[str, list[SourceCrop]] = {}
    for index, (question, marker_page, marker_line) in enumerate(selected_markers):
        start_y = question_marker_visual_top(
            line_entries,
            marker_page,
            marker_line,
        )
        start = (marker_page.number, start_y)
        next_question_marker = (
            selected_markers[index + 1]
            if index + 1 < len(selected_markers)
            else None
        )
        if next_question_marker:
            end = (
                next_question_marker[1].number,
                question_marker_visual_top(
                    line_entries,
                    next_question_marker[1],
                    next_question_marker[2],
                ),
            )
        else:
            end = next(
                (
                    (page.number, line.y_min)
                    for page, line in line_entries
                    if (page.number, line.y_min) > start
                    and is_listening_end_marker(line)
                ),
                (10_000, 10_000.0),
            )
        group_entries = [
            (page, line)
            for page, line in line_entries
            if page.number == marker_page.number
            and start <= (page.number, line.y_min) < end
            and (
                not is_running_header_or_footer(line.text)
                or line is marker_line
            )
        ]

        question_crops: list[SourceCrop] = []
        page_numbers = list(dict.fromkeys(page.number for page, _line in group_entries))
        for page_number in page_numbers:
            page_entries = [
                (page, line)
                for page, line in group_entries
                if page.number == page_number
            ]
            page = page_entries[0][0]
            lines = [line for _page, line in page_entries]
            y_min = max(
                0,
                min(line.y_min for line in lines) - SOURCE_CROP_VERTICAL_PADDING,
            )
            y_max = min(
                page.height,
                max(line.y_max for line in lines) + SOURCE_CROP_VERTICAL_PADDING,
            )
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


def find_task_source_crops(
    contents: bytes,
    tasks: tuple[Task, ...],
) -> tuple[
    dict[int, list[SourceCrop]],
    dict[int, dict[str, list[SourceCrop]]],
]:
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
    found_numbers = [marker.number for marker in markers]
    expected_numbers = [task.number for task in tasks]
    if found_numbers != expected_numbers:
        raise ValueError(
            f"Could not locate English listening task crops: expected {expected_numbers}, "
            f"found {found_numbers}"
        )

    crops: dict[int, list[SourceCrop]] = {}
    question_crops: dict[int, dict[str, list[SourceCrop]]] = {}
    for index, marker in enumerate(markers):
        next_marker = markers[index + 1] if index + 1 < len(markers) else None
        task = task_by_number[marker.number]
        line_entries = task_line_entries(pages, marker, next_marker)
        task_question_crops = numbered_question_crops(line_entries, task)
        first_question_position = None
        if task_question_crops:
            first_question_crop = task_question_crops[str(task.first_question)][0]
            first_question_position = (
                first_question_crop.page.number,
                first_question_crop.y_min,
            )
        task_crops: list[SourceCrop] = []
        for page in pages:
            if page.number < marker.page.number:
                continue
            if next_marker and page.number > next_marker.page.number:
                continue
            if not next_marker and page.number < marker.page.number:
                continue

            relevant_lines = []
            for line in sorted_page_lines(page):
                if not line.text.strip():
                    continue
                if is_running_header_or_footer(line.text):
                    continue
                if page.number == marker.page.number and line.y_min < marker.y_min:
                    continue
                if next_marker and page.number == next_marker.page.number and line.y_min >= next_marker.y_min:
                    continue
                if (
                    first_question_position
                    and (page.number, line.y_min) >= first_question_position
                ):
                    continue
                relevant_lines.append(line)

            if not relevant_lines:
                if (
                    first_question_position
                    and page.number >= first_question_position[0]
                ):
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

        if not task_crops:
            raise ValueError(f"Task {marker.number} has no visible source crop")
        crops[marker.number] = task_crops
        if task_question_crops:
            question_crops[marker.number] = task_question_crops

    return crops, question_crops


def render_source_pages(
    paper_path: Path,
    identifier: str,
    crops: dict[CropKey, list[SourceCrop]],
    expected_assets: set[str],
) -> dict[CropKey, list[dict[str, Any]]]:
    destination = ASSET_ROOT / identifier
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
                required_message="pdftocairo is required to build English listening source images",
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
                )
                source_images.setdefault(crop_key, []).append(
                    {
                        "url": f"{ASSET_URL_PREFIX}/{quote(identifier)}/{filename}",
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


def remove_unexpected_files(destination: Path, expected_assets: set[str]) -> None:
    if not destination.is_dir():
        return
    for path in destination.iterdir():
        if path.is_file() and path.name not in expected_assets:
            path.unlink()


def audio_label(name: str, split_index: int, total: int) -> str:
    if total == 1 or "cijeli" in slugify(Path(name).stem):
        return "Cijela snimka"
    return f"Snimka {split_index}"


def build_audio_plan(
    audio_items: list[dict[str, str]], tasks: tuple[Task, ...]
) -> dict[str, Any] | None:
    if len(tasks) != 4:
        return None

    full_indexes = [
        index
        for index, audio in enumerate(audio_items)
        if audio["label"] == "Cijela snimka"
        or "cijeli" in slugify(audio["sourceName"])
    ]
    split_indexes = [
        index for index in range(len(audio_items)) if index not in full_indexes
    ]

    if len(full_indexes) > 1 or len(split_indexes) != 9:
        return None

    for position, audio_index in enumerate(split_indexes, start=1):
        if audio_items[audio_index]["label"] != f"Snimka {position}":
            return None

    plan: dict[str, Any] = {
        "mode": "certified-task-tracks",
        "introAudioIndex": split_indexes[0],
        "closingAudioIndex": split_indexes[8],
        "tasks": {
            "1": [
                {
                    "audioIndex": split_indexes[1],
                    "label": "Snimka zadatka",
                    "kind": "task",
                }
            ],
            "2": [
                {
                    "audioIndex": split_indexes[2],
                    "label": "Uputa",
                    "kind": "instruction",
                },
                {
                    "audioIndex": split_indexes[3],
                    "label": "Snimka zadatka",
                    "kind": "task",
                },
            ],
            "3": [
                {
                    "audioIndex": split_indexes[4],
                    "label": "Uputa",
                    "kind": "instruction",
                },
                {
                    "audioIndex": split_indexes[5],
                    "label": "Snimka zadatka",
                    "kind": "task",
                },
            ],
            "4": [
                {
                    "audioIndex": split_indexes[6],
                    "label": "Uputa",
                    "kind": "instruction",
                },
                {
                    "audioIndex": split_indexes[7],
                    "label": "Snimka zadatka",
                    "kind": "task",
                },
            ],
        },
    }

    if full_indexes:
        plan["fullAudioIndex"] = full_indexes[0]

    return plan


def remove_orphaned_audio(audio_root: Path, expected_names: set[str]) -> None:
    if not audio_root.is_dir():
        return
    for path in audio_root.iterdir():
        if path.is_file() and path.name not in expected_names:
            path.unlink()


def convert_audio_to_mp3(contents: bytes, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmpdir:
        source = Path(tmpdir) / "source.wma"
        output = Path(tmpdir) / "output.mp3"
        source.write_bytes(contents)
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(source),
                    "-codec:a",
                    "libmp3lame",
                    "-q:a",
                    "4",
                    str(output),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("ffmpeg is required to convert WMA listening audio") from exc
        except subprocess.CalledProcessError as exc:
            message = exc.stderr.decode("utf-8", errors="replace")
            raise RuntimeError(f"ffmpeg failed to convert WMA listening audio: {message}") from exc
        write_if_changed(destination, output.read_bytes())


def write_web_audio(contents: bytes, source_name: str, destination: Path) -> str:
    suffix = Path(source_name).suffix.casefold()
    if suffix == ".wma":
        mp3_destination = destination.with_suffix(".mp3")
        convert_audio_to_mp3(contents, mp3_destination)
        return mp3_destination.name

    if suffix not in WEB_AUDIO_SUFFIXES:
        raise ValueError(f"Unsupported web audio format: {source_name}")

    write_if_changed(destination, contents)
    return destination.name


def build_exam(exam: dict[str, Any]) -> dict[str, Any] | None:
    archive_path = local_archive_path(exam["url"])
    tasks = tasks_for(exam)

    with zipfile.ZipFile(archive_path) as archive:
        names = [info.filename for info in archive.infolist() if not info.is_dir()]
        audio_names = find_audio_names(names)
        if not audio_names:
            return None

        paper_contents, paper_text = find_listening_paper(archive, names)
        key_name = find_single_pdf(
            names,
            "answer key",
            re.compile(r"klju", flags=re.IGNORECASE),
        )
        key_contents = archive.read(key_name)

        identifier = exam_id(exam)
        destination = ASSET_ROOT / identifier
        expected_assets = {"paper.pdf"}
        write_if_changed(destination / "paper.pdf", paper_contents)
        task_crops, task_question_crops = find_task_source_crops(
            paper_contents,
            tasks,
        )
        render_crops: dict[CropKey, list[SourceCrop]] = {
            ("task", task_number): crops
            for task_number, crops in task_crops.items()
        }
        for task_number, questions in task_question_crops.items():
            for question, crops in questions.items():
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
        question_images: dict[
            int,
            dict[str, dict[str, Any] | list[dict[str, Any]]],
        ] = {}
        for task_number, questions in task_question_crops.items():
            question_images[task_number] = {}
            for question in questions:
                images = rendered_images.get(
                    ("question", task_number, question),
                    [],
                )
                if images:
                    question_images[task_number][question] = (
                        images[0] if len(images) == 1 else images
                    )

        audio_items = []
        expected_audio_names = set()
        split_index = 0
        for index, audio_name in enumerate(audio_names, start=1):
            if "cijeli" not in slugify(Path(audio_name).stem):
                split_index += 1
            suffix = Path(audio_name).suffix.casefold()
            local_suffix = ".mp3" if suffix == ".wma" else suffix
            local_name = f"{index:02}{local_suffix}"
            expected_audio_names.add(local_name)
            written_name = write_web_audio(
                archive.read(audio_name),
                audio_name,
                destination / "audio" / local_name,
            )
            if written_name != local_name:
                raise ValueError(f"Unexpected converted audio name: {written_name}")
            audio_items.append(
                {
                    "label": audio_label(audio_name, split_index, len(audio_names)),
                    "url": f"{ASSET_URL_PREFIX}/{quote(identifier)}/audio/{local_name}",
                    "sourceName": Path(audio_name).name,
                }
            )
        remove_orphaned_audio(destination / "audio", expected_audio_names)
        remove_unexpected_files(destination, expected_assets)

    task_texts = extract_task_texts(paper_text, tasks)
    has_checking = exam["year"] >= CHECKING_MIN_YEAR
    answers = parse_choice_answers(pdf_text(key_contents), tasks) if has_checking else {}

    built = {
        "id": identifier,
        "year": exam["year"],
        "schoolYear": exam["schoolYear"],
        "term": normalize_term(exam["term"]),
        "level": exam["level"],
        "archiveUrl": exam["url"],
        "paperUrl": f"{ASSET_URL_PREFIX}/{quote(identifier)}/paper.pdf",
        "durationMinutes": parse_duration(paper_text),
        "checkingSupported": has_checking,
        "audio": audio_items,
        "tasks": [
            (
                task.to_json()
                | {
                "text": task_texts[task.number],
                "sourceImages": source_images.get(task.number, []),
                }
                | (
                    {"questionImages": question_images[task.number]}
                    if question_images.get(task.number)
                    else {}
                )
            )
            for task in tasks
        ],
        "answers": answers,
    }
    audio_plan = build_audio_plan(audio_items, tasks)
    if audio_plan:
        built["audioPlan"] = audio_plan

    return built


def remove_orphaned_assets(expected_ids: set[str]) -> None:
    if not ASSET_ROOT.is_dir():
        return
    for path in ASSET_ROOT.iterdir():
        if path.is_dir() and path.name not in expected_ids:
            shutil.rmtree(path)


def main() -> None:
    archive_index = load_archive_index()
    english_exams = [
        exam for exam in archive_index["exams"] if exam["subject"] == SUBJECT
    ]
    exams = [
        built_exam
        for exam in english_exams
        if (built_exam := build_exam(exam)) is not None
    ]
    remove_orphaned_assets({exam["id"] for exam in exams})

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
        f"Wrote {len(exams)} English listening exams to {OUTPUT.relative_to(ROOT)} "
        f"({checkable_count} with answer checking)"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise
