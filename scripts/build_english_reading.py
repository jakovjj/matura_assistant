#!/usr/bin/env python3
"""Build the static English reading practice index from mirrored NCVVO ZIP files."""

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
    try:
        completed = subprocess.run(
            ["pdftotext", "-layout", "-", "-"],
            input=contents,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("pdftotext is required to build English reading data") from exc
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"pdftotext failed: {message}") from exc

    return completed.stdout.decode("utf-8", errors="replace")


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


def write_if_changed(path: Path, contents: bytes) -> None:
    if path.is_file() and path.read_bytes() == contents:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)


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
    destination = PAPER_ROOT / identifier / "paper.pdf"
    write_if_changed(destination, paper_contents)

    has_checking = exam["year"] >= CHECKING_MIN_YEAR
    answers = parse_choice_answers(pdf_text(key_contents), tasks) if has_checking else {}

    return {
        "id": identifier,
        "year": exam["year"],
        "schoolYear": exam["schoolYear"],
        "term": term,
        "level": exam["level"],
        "archiveUrl": exam["url"],
        "paperUrl": f"{PAPER_URL_PREFIX}/{quote(identifier)}/paper.pdf",
        "durationMinutes": parse_duration(paper_text),
        "checkingSupported": has_checking,
        "tasks": [
            task.to_json() | {"text": task_texts[task.number]}
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
