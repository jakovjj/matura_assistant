#!/usr/bin/env python3
"""Build a generic ABCD practice index from mirrored NCVVO ZIP files."""

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
OUTPUT = ROOT / "data" / "abcd-choice.js"
PAPER_ROOT = ROOT / "files" / "interactive" / "abcd-choice"
PAPER_URL_PREFIX = "./files/interactive/abcd-choice"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_ABCD_CHOICE="
MIN_QUESTIONS = 8

TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}
EXCLUDED_SUBJECTS = {
    "Engleski jezik",
    "Fizika",
    "Francuski jezik",
    "Glazbena umjetnost",
    "Hrvatski jezik",
    "Matematika",
    "Njemački jezik",
    "Talijanski jezik",
    "Španjolski jezik",
}
DURATION_FALLBACKS = {
    "Biologija": 150,
    "Etika": 150,
    "Filozofija": 150,
    "Geografija": 90,
    "Grčki jezik": 120,
    "Informatika": 100,
    "Kemija": 180,
    "Latinski jezik": 120,
    "Likovna umjetnost": 120,
    "Matematika": {"A": 180, "B": 150, "default": 180},
    "Mađarski jezik": 80,
    "Mađarski jezik i književnost": 80,
    "Politika i gospodarstvo": 90,
    "Povijest": 135,
    "Psihologija": 90,
    "Sociologija": 90,
    "Srpski jezik": 90,
    "Talijanski jezik i književnost": 100,
    "Vjeronauk": 70,
}

SIMPLE_ANSWER_LINE_RE = re.compile(
    r"^\s*(?P<question>\d{1,3}(?:[\.,]\d{1,2})?)\s*[\.)]?\s+"
    r"(?P<answer>[A-Da-d])\s*$"
)
SIMPLE_ANSWER_PAIR_RE = re.compile(
    r"(?<![\w.])(?P<question>\d{1,3}(?:[\.,]\d{1,2})?)\s*[\.)]?\s+"
    r"(?P<answer>[A-Da-d])(?=\s|$)"
)


def load_archive_index() -> dict[str, Any]:
    source = ARCHIVE_INDEX.read_text(encoding="utf-8").strip()
    if not source.startswith(ARCHIVE_PREFIX) or not source.endswith(";"):
        raise ValueError(f"Unsupported archive index format: {ARCHIVE_INDEX}")
    return json.loads(source[len(ARCHIVE_PREFIX) : -1])


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value.casefold()).replace("đ", "d")
    ascii_value = normalized.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.casefold()).strip("-")


def normalize_term(term: str) -> str:
    return TERM_ALIASES.get(term, term)


def exam_id(exam: dict[str, Any]) -> str:
    level = f"-{exam['level'].casefold()}" if exam.get("level") else ""
    return f"{slugify(exam['subject'])}{level}-{exam['year']}-{slugify(normalize_term(exam['term']))}"


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
        raise RuntimeError("pdftotext is required to build ABCD choice data") from exc
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"pdftotext failed: {message}") from exc

    return completed.stdout.decode("utf-8", errors="replace")


def is_key_name(name: str) -> bool:
    normalized = normalized_name(name)
    if "list" in normalized or "prag" in normalized:
        return False
    return bool(
        re.search(
            r"klju|kljuc|rje[šs]enja|rjesenja|rjeτenja|odgovor",
            normalized,
            flags=re.IGNORECASE,
        )
    )


def find_key_names(names: list[str]) -> list[str]:
    key_names = [
        name
        for name in names
        if name.casefold().endswith(".pdf") and is_key_name(name)
    ]
    if not key_names:
        raise ValueError("Could not find an answer key PDF")
    return sorted(key_names, key=lambda name: normalized_name(Path(name).name))


def is_paper_candidate(name: str) -> bool:
    normalized = normalized_name(name)
    if not name.casefold().endswith(".pdf"):
        return False
    if is_key_name(name):
        return False
    blocked_patterns = (
        r"\blist\b",
        r"\bkoncept\b",
        r"\bbodovan",
        r"\bprag\b",
        r"\besej",
        r"\bsazetak\b",
        r"\bsažetak\b",
        r"\bpopis\b",
        r"\bzvuc",
        r"\bzvuč",
        r"\btranskript\b",
        r"\btablic",
        r"\bformula",
        r"\bt\s*[abd]\b",
    )
    return not any(re.search(pattern, normalized, flags=re.IGNORECASE) for pattern in blocked_patterns)


def find_paper_name(names: list[str]) -> str:
    candidates = [name for name in names if is_paper_candidate(name)]
    if not candidates:
        raise ValueError("Could not find an exam paper PDF")

    ik1_candidates = [
        name
        for name in candidates
        if re.search(r"\bik[-_ ]*1\b|ispitna knjizica 1", normalized_name(name))
    ]
    if ik1_candidates:
        return sorted(ik1_candidates, key=lambda name: normalized_name(Path(name).name))[0]

    ds_candidates = [
        name
        for name in candidates
        if re.search(r"\bd[-_ ]*s\s*\d+", normalized_name(name), flags=re.IGNORECASE)
    ]
    if ds_candidates:
        return sorted(ds_candidates, key=lambda name: normalized_name(Path(name).name))[0]

    return sorted(candidates, key=lambda name: normalized_name(Path(name).name))[0]


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


def parse_simple_answer_pairs(text: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []

    for line in text.splitlines():
        match = SIMPLE_ANSWER_LINE_RE.match(line)
        if match:
            pairs.append(
                (
                    parse_question_token(match.group("question")),
                    match.group("answer").upper(),
                )
            )
            continue

        stripped = line.strip()
        found = list(SIMPLE_ANSWER_PAIR_RE.finditer(stripped))
        if len(found) < 2:
            continue

        remainder = SIMPLE_ANSWER_PAIR_RE.sub("", stripped).strip(" ;,")
        if remainder:
            continue

        pairs.extend(
            (
                parse_question_token(match.group("question")),
                match.group("answer").upper(),
            )
            for match in found
        )

    return pairs


def parse_choice_answers(texts: list[str]) -> tuple[list[str], dict[str, list[str]]]:
    answers: dict[str, list[str]] = {}

    for text in texts:
        for question, answer in parse_simple_answer_pairs(text):
            if question in answers:
                continue
            answers[question] = [answer]

    questions = sorted(answers, key=question_sort_key)
    if len(questions) < MIN_QUESTIONS:
        raise ValueError(f"Expected at least {MIN_QUESTIONS} ABCD answers, found {len(questions)}")

    return questions, {question: answers[question] for question in questions}


def parse_duration(text: str, exam: dict[str, Any]) -> int | None:
    patterns = (
        r"Ispit\s+traje\s+(\d+)\s+minuta",
        r"Vrijeme\s+rješavanja\s+ispita\s+je\s+(\d+)\s+minuta",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return int(match.group(1))

    fallback = DURATION_FALLBACKS.get(exam["subject"])
    if isinstance(fallback, dict):
        return fallback.get(exam.get("level") or "") or fallback.get("default")
    return fallback


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
        key_names = find_key_names(names)
        paper_name = find_paper_name(names)
        paper_contents = archive.read(paper_name)
        key_texts = [pdf_text(archive.read(name)) for name in key_names]

    paper_text = pdf_text(paper_contents)
    questions, answers = parse_choice_answers(key_texts)
    destination = PAPER_ROOT / identifier / "paper.pdf"
    write_if_changed(destination, paper_contents)

    return {
        "id": identifier,
        "subject": exam["subject"],
        "year": exam["year"],
        "schoolYear": exam["schoolYear"],
        "term": normalize_term(exam["term"]),
        "level": exam.get("level"),
        "archiveUrl": exam["url"],
        "paperUrl": f"{PAPER_URL_PREFIX}/{quote(identifier)}/paper.pdf",
        "durationMinutes": parse_duration(paper_text, exam),
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
    candidate_exams = [
        exam
        for exam in archive_index["exams"]
        if exam["subject"] not in EXCLUDED_SUBJECTS
    ]
    exams: list[dict[str, Any]] = []
    skipped: list[str] = []

    for exam in candidate_exams:
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

    print(f"Wrote {len(exams)} generic ABCD practice exams to {OUTPUT.relative_to(ROOT)}")
    if skipped:
        print(f"Skipped {len(skipped)} archives without reliable generated ABCD data")


if __name__ == "__main__":
    main()
