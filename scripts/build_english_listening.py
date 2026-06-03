#!/usr/bin/env python3
"""Build the static English listening practice index from mirrored NCVVO ZIP files."""

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

from crop_utils import grayscale_image_from_png, trim_crop_bottom_whitespace


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
AUDIO_SUFFIXES = {".mp3", ".m4a", ".ogg", ".wav"}
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


A_TASKS = (
    Task(1, 1, 5, "ABCDEFGH"),
    Task(2, 6, 13, "ABC"),
    Task(3, 14, 19, "ABCDEFGH"),
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
    try:
        completed = subprocess.run(
            ["pdftotext", "-layout", "-", "-"],
            input=contents,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("pdftotext is required to build English listening data") from exc
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
        raise RuntimeError("pdftotext is required to build English listening source images") from exc
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


def png_dimensions(contents: bytes) -> tuple[int, int]:
    if contents[:16] != b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR":
        raise ValueError("Expected a PNG source page")
    return struct.unpack(">II", contents[16:24])


def find_task_source_crops(contents: bytes, tasks: tuple[Task, ...]) -> dict[int, list[SourceCrop]]:
    pages = pdf_bbox_pages(contents)
    task_numbers = {task.number for task in tasks}
    markers: list[TaskMarker] = []

    for page in pages:
        for line in sorted_page_lines(page):
            match = re.fullmatch(r"Task\s+(\d+)", line.text.strip(), flags=re.IGNORECASE)
            if not match:
                continue
            number = int(match.group(1))
            if number in task_numbers:
                markers.append(TaskMarker(number=number, page=page, y_min=line.y_min))

    markers.sort(key=lambda marker: (marker.page.number, marker.y_min))
    found_numbers = [marker.number for marker in markers]
    expected_numbers = [task.number for task in tasks]
    if found_numbers != expected_numbers:
        raise ValueError(
            f"Could not locate English listening task crops: expected {expected_numbers}, "
            f"found {found_numbers}"
        )

    crops: dict[int, list[SourceCrop]] = {}
    for index, marker in enumerate(markers):
        next_marker = markers[index + 1] if index + 1 < len(markers) else None
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
                relevant_lines.append(line)

            if not relevant_lines:
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

    return crops


def render_source_pages(
    paper_path: Path,
    identifier: str,
    crops: dict[int, list[SourceCrop]],
    expected_assets: set[str],
) -> dict[int, list[dict[str, Any]]]:
    destination = ASSET_ROOT / identifier
    crops_by_page: dict[int, list[tuple[int, SourceCrop]]] = {}
    for task_number, task_crops in crops.items():
        for crop in task_crops:
            crops_by_page.setdefault(crop.page.number, []).append((task_number, crop))

    source_images: dict[int, list[dict[str, Any]]] = {}
    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        for page_number, page_crops in sorted(crops_by_page.items()):
            filename = f"page-{page_number}.png"
            temporary_prefix = temporary_root / f"page-{page_number}"
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
                raise RuntimeError("pdftocairo is required to build English listening source images") from exc
            except subprocess.CalledProcessError as exc:
                message = exc.stderr.decode("utf-8", errors="replace")
                raise RuntimeError(f"pdftocairo failed: {message}") from exc

            contents = temporary_prefix.with_suffix(".png").read_bytes()
            image_width, image_height = png_dimensions(contents)
            write_if_changed(destination / filename, contents)
            expected_assets.add(filename)
            page_image = grayscale_image_from_png(contents)

            for task_number, crop in page_crops:
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
                source_images.setdefault(task_number, []).append(
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
        source_images = render_source_pages(
            destination / "paper.pdf",
            identifier,
            find_task_source_crops(paper_contents, tasks),
            expected_assets,
        )

        audio_items = []
        expected_audio_names = set()
        split_index = 0
        for index, audio_name in enumerate(audio_names, start=1):
            if "cijeli" not in slugify(Path(audio_name).stem):
                split_index += 1
            suffix = Path(audio_name).suffix.casefold()
            local_name = f"{index:02}{suffix}"
            expected_audio_names.add(local_name)
            write_if_changed(destination / "audio" / local_name, archive.read(audio_name))
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
            task.to_json() | {
                "text": task_texts[task.number],
                "sourceImages": source_images.get(task.number, []),
            }
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
