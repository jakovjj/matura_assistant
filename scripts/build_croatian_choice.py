#!/usr/bin/env python3
"""Build the static Croatian ABCD practice index from mirrored NCVVO ZIP files."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import unicodedata
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "croatian-choice.js"
PAPER_ROOT = ROOT / "files" / "interactive" / "croatian-choice"
PAPER_URL_PREFIX = "./files/interactive/croatian-choice"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_CROATIAN_CHOICE="
SUBJECT = "Hrvatski jezik"
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
    if len(candidates) != 1:
        raise ValueError(f"Expected one Croatian answer key, found {candidates}")
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
        raise RuntimeError("pdftotext is required to build Croatian choice data") from exc
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"pdftotext failed: {message}") from exc

    return completed.stdout.decode("utf-8", errors="replace")


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


def validate_answer_sequence(answers: dict[str, list[str]]) -> list[str]:
    questions = sorted(answers, key=question_sort_key)
    integer_questions = [int(question) for question in questions if "." not in question]
    decimal_questions = [question for question in questions if "." in question]

    if not integer_questions:
        raise ValueError("No regular Croatian answer numbers found")
    expected_integers = list(range(1, max(integer_questions) + 1))
    if integer_questions != expected_integers:
        raise ValueError(
            f"Croatian answer key is not contiguous: expected {expected_integers}, "
            f"found {integer_questions}"
        )

    if decimal_questions:
        base = max(integer_questions) + 1
        expected_decimals = [f"{base}.{index}" for index in range(1, len(decimal_questions) + 1)]
        if decimal_questions != expected_decimals:
            raise ValueError(
                f"Croatian decimal answers are not contiguous: expected {expected_decimals}, "
                f"found {decimal_questions}"
            )

    if len(questions) < 30:
        raise ValueError(f"Expected at least 30 Croatian ABCD answers, found {len(questions)}")
    return questions


def parse_choice_answers(text: str) -> tuple[list[str], dict[str, list[str]]]:
    answers: dict[str, list[str]] = {}
    previous_question: str | None = None

    for match in ANSWER_PAIR_RE.finditer(text):
        question = parse_answer_token(match.group("token"), previous_question)
        if question is None:
            continue
        if question == "1" and "1" in answers and len(answers) >= 30:
            break
        if question in answers:
            continue

        answer = match.group("answer").upper()
        answers[question] = [answer]
        previous_question = question

    questions = validate_answer_sequence(answers)
    return questions, {question: answers[question] for question in questions}


def write_if_changed(path: Path, contents: bytes) -> None:
    if path.is_file() and path.read_bytes() == contents:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)


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
    questions, answers = parse_choice_answers(pdf_text(key_contents))
    destination = PAPER_ROOT / identifier / "paper.pdf"
    write_if_changed(destination, paper_contents)

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
        "version": 1,
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
