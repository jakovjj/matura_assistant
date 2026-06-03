#!/usr/bin/env python3
"""Build the static English essay practice index from mirrored NCVVO ZIP files."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import unicodedata
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "english-essay.js"
ASSET_ROOT = ROOT / "files" / "interactive" / "english-essay"
ASSET_URL_PREFIX = "./files/interactive/english-essay"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_ENGLISH_ESSAY="
SUBJECT = "Engleski jezik"
TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}
COMMON_TEXT_FIXES = {
    "schoo/s": "schools",
    "Sfudenfs": "Students",
}


def load_archive_index() -> dict[str, Any]:
    source = ARCHIVE_INDEX.read_text(encoding="utf-8").strip()
    if not source.startswith(ARCHIVE_PREFIX) or not source.endswith(";"):
        raise ValueError(f"Unsupported archive index format: {ARCHIVE_INDEX}")
    return json.loads(source[len(ARCHIVE_PREFIX) : -1])


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value.casefold()).replace("đ", "d")
    ascii_value = normalized.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")


def normalize_term(term: str) -> str:
    return TERM_ALIASES.get(term, term)


def exam_id(exam: dict[str, Any]) -> str:
    return f"engleski-{exam['level'].casefold()}-{exam['year']}-{slugify(normalize_term(exam['term']))}"


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
        raise RuntimeError("pdftotext is required to build English essay data") from exc
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"pdftotext failed: {message}") from exc

    return completed.stdout.decode("utf-8", errors="replace")


def is_blocked_pdf_name(name: str) -> bool:
    normalized = normalized_name(name)
    return bool(re.search(r"koncept|klju|kljuc|list|odgovor|bodov", normalized))


def find_essay_paper(archive: zipfile.ZipFile, names: list[str]) -> tuple[str, bytes, str]:
    essay_names = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and not is_blocked_pdf_name(name)
        and re.search(r"esej", normalized_name(name))
    ]
    if essay_names:
        name = sorted(essay_names, key=lambda item: normalized_name(Path(item).name))[0]
        contents = archive.read(name)
        return name, contents, pdf_text(contents)

    writing_candidates: list[tuple[int, str, bytes, str]] = []
    for name in names:
        if not name.casefold().endswith(".pdf") or is_blocked_pdf_name(name):
            continue

        contents = archive.read(name)
        text = pdf_text(contents)
        if not re.search(r"Write an essay of\s+200\s*[-–]\s*250\s+words", text):
            continue
        if not re.search(r"Writing Paper|ISPIT PISANJA", text, flags=re.IGNORECASE):
            continue

        normalized = normalized_name(name)
        score = 0 if re.search(r"\bik[-_ ]*2\b|knjizica 2", normalized) else 1
        writing_candidates.append((score, name, contents, text))

    if len(writing_candidates) != 1:
        writing_candidates.sort(key=lambda item: (item[0], normalized_name(item[1])))
    if not writing_candidates:
        raise ValueError("Could not find an English A writing paper")

    _, name, contents, text = writing_candidates[0]
    return name, contents, text


def should_skip_task_line(line: str) -> bool:
    return bool(
        re.fullmatch(
            r"A|Engleski jezik|Writing Paper|Writing paper|vi[šs]a razina|ISPIT PISANJA|Task 6|Question 41",
            line,
            flags=re.IGNORECASE,
        )
        or re.search(r"\bENG\s*A\b.*(?:IK|D-S|indd)", line, flags=re.IGNORECASE)
        or re.fullmatch(r"\d{1,2}(?:/\d{1,2})?", line)
    )


def parse_task_text(text: str) -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    collected: list[str] = []
    collecting = False

    for line in lines:
        if not line:
            continue
        if should_skip_task_line(line):
            continue
        if not collecting and re.search(r"Write an essay of\s+200\s*[-–]\s*250\s+words", line):
            collecting = True
        if not collecting:
            continue
        if re.search(r"Esej obvez|List za [čc]istopis|Način ispunjavanja", line, flags=re.IGNORECASE):
            break

        collected.append(line)
        if re.search(r"own opinion\.", line, flags=re.IGNORECASE):
            break

    task_text = " ".join(collected)
    task_text = re.sub(r"\s+([,.])", r"\1", task_text)
    task_text = re.sub(r"\s+", " ", task_text).strip()
    for broken, fixed in COMMON_TEXT_FIXES.items():
        task_text = task_text.replace(broken, fixed)
    if not task_text:
        raise ValueError("Could not parse essay task text")
    return task_text


def build_exam(exam: dict[str, Any]) -> dict[str, Any]:
    archive_path = local_archive_path(exam["url"])
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        paper_name, contents, text = find_essay_paper(archive, names)

    essay_id = exam_id(exam)
    target_dir = ASSET_ROOT / essay_id
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / "paper.pdf").write_bytes(contents)

    return {
        "id": essay_id,
        "year": exam["year"],
        "schoolYear": exam.get("schoolYear", ""),
        "term": normalize_term(exam["term"]),
        "level": exam["level"],
        "archiveUrl": exam["url"],
        "paperUrl": f"{ASSET_URL_PREFIX}/{essay_id}/paper.pdf",
        "sourceName": Path(paper_name).name,
        "durationMinutes": 75,
        "wordRange": {"min": 200, "max": 250},
        "maxScore": 20,
        "taskText": parse_task_text(text),
    }


def main() -> None:
    archive_index = load_archive_index()
    english_a_exams = [
        exam
        for exam in archive_index["exams"]
        if exam["subject"] == SUBJECT and exam.get("level") == "A"
    ]
    english_a_exams.sort(
        key=lambda item: (item["year"], normalize_term(item["term"])),
        reverse=True,
    )

    shutil.rmtree(ASSET_ROOT, ignore_errors=True)
    ASSET_ROOT.mkdir(parents=True, exist_ok=True)

    exams = [build_exam(exam) for exam in english_a_exams]
    payload = {
        "version": 1,
        "rubricSource": {
            "title": "NCVVO Ispitni katalog za državnu maturu 2025./2026. - Engleski jezik",
            "url": "https://www.ncvvo.hr/wp-content/uploads/2025/09/ENG-2026.pdf",
        },
        "exams": exams,
    }
    OUTPUT.write_text(
        f"{OUTPUT_PREFIX}{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8",
    )
    print(f"Built {len(exams)} English essay exams")


if __name__ == "__main__":
    main()
