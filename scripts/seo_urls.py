from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import urlencode


ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "exams.js"
DATA_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
SITE_ORIGIN = "https://matura.com.hr"

TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}
TERM_LABELS = {
    "ljetni rok": "Ljetni rok",
    "jesenski rok": "Jesenski rok",
}
TERM_ORDER = {
    "ljetni rok": 0,
    "jesenski rok": 1,
}


def load_archive(path: Path = DATA_FILE) -> dict:
    source = path.read_text(encoding="utf-8").strip()
    if not source.startswith(DATA_PREFIX) or not source.endswith(";"):
        raise ValueError(f"{path} has an unsupported format")
    return json.loads(source[len(DATA_PREFIX) : -1])


def slug_part(value: object) -> str:
    normalized = unicodedata.normalize("NFD", str(value).lower()).replace("đ", "d")
    ascii_value = "".join(
        character for character in normalized if not unicodedata.combining(character)
    )
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", ascii_value))


def normalize_term(term: str) -> str:
    return TERM_ALIASES.get(term, term)


def format_term(term: str) -> str:
    normalized = normalize_term(term)
    return TERM_LABELS.get(normalized, term)


def exam_id(exam: dict) -> str:
    term = normalize_term(exam["term"])
    return "-".join(
        (
            slug_part(exam["subject"]),
            str(exam["year"]),
            slug_part(term),
            slug_part(exam.get("level") or "bez-razine"),
        )
    )


def normalized_exam(exam: dict) -> dict:
    term = normalize_term(exam["term"])
    return {
        **exam,
        "term": term,
        "id": exam_id({**exam, "term": term}),
    }


def subject_path(subject: str) -> str:
    return f"/predmeti/{slug_part(subject)}/"


def exam_path(exam: dict) -> str:
    parts = [str(exam["year"]), slug_part(normalize_term(exam["term"]))]
    if exam.get("level"):
        parts.append(slug_part(exam["level"]))
    return f"/ispiti/{slug_part(exam['subject'])}/{'-'.join(parts)}/"


def site_url(path: str = "/") -> str:
    if not path.startswith("/"):
        path = f"/{path}"
    return f"{SITE_ORIGIN}{path}"


def app_subject_url(subject: str) -> str:
    return f"/?{urlencode({'predmet': subject})}#predmeti"


def app_exam_url(exam: dict) -> str:
    return f"/?{urlencode({'predmet': exam['subject'], 'ispit': exam_id(exam)})}#predmeti"


def local_asset_url(url: str) -> str:
    return "/" + str(url).removeprefix("./").lstrip("/")


def compare_exams(exam: dict) -> tuple:
    return (
        -int(exam["year"]),
        TERM_ORDER.get(normalize_term(exam["term"]), 99),
        str(exam.get("level") or ""),
    )
