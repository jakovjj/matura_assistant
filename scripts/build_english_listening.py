#!/usr/bin/env python3
"""Build the static English listening practice index from mirrored NCVVO ZIP files."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse


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
BLANK_PAGE_PARTS = {"P", "ca", "ni", "ra", "st", "a", "zn", "00", "01", "02"}
AUDIO_SUFFIXES = {".mp3", ".m4a", ".ogg", ".wav"}


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

    if re.search(r"\bENG\s*[AB]\b.*(?:IK[- ]?2|D-S\d+)", stripped, flags=re.IGNORECASE):
        return True

    if re.fullmatch(r"\d+/\d+", stripped):
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


def audio_label(name: str, split_index: int, total: int) -> str:
    if total == 1 or "cijeli" in slugify(Path(name).stem):
        return "Cijela snimka"
    return f"Snimka {split_index}"


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
        write_if_changed(destination / "paper.pdf", paper_contents)

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

    task_texts = extract_task_texts(paper_text, tasks)
    has_checking = exam["year"] >= CHECKING_MIN_YEAR
    answers = parse_choice_answers(pdf_text(key_contents), tasks) if has_checking else {}

    return {
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
            task.to_json() | {"text": task_texts[task.number]}
            for task in tasks
        ],
        "answers": answers,
    }


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
