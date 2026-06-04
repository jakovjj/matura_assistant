#!/usr/bin/env python3
"""Build the interactive Geography practice index from mirrored NCVVO ZIP files."""

from __future__ import annotations

import hashlib
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

from PIL import Image

from crop_utils import grayscale_image_from_png, trim_crop_bottom_whitespace
from pdf_utils import pdftotext, png_dimensions, render_pdf_page_to_png


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "geography-choice.js"
PAPER_ROOT = ROOT / "files" / "interactive" / "geography-choice"
PAPER_URL_PREFIX = "./files/interactive/geography-choice"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_GEOGRAPHY_CHOICE="
SUBJECT = "Geografija"
SOURCE_RENDER_DPI = 144
SOURCE_CROP_HORIZONTAL_MARGIN = 36
SOURCE_CROP_VERTICAL_PADDING = 8
SOURCE_CONTENT_TOP_MARGIN = 84
SOURCE_FOOTER_MARGIN = 72
SOURCE_BLANK_TRIM_PADDING = 14
SOURCE_LINE_ONLY_MIN_GAP = 72
SOURCE_LINE_ONLY_PIXEL_THRESHOLD = 214
SOURCE_BLANK_PIXEL_THRESHOLD = 236
SOURCE_TRAILING_RULE_MIN_COUNT = 2

TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}

TASK_LABELS = {
    "visestruki-izbor": "Zadatci višestrukoga izbora",
    "visestruke-kombinacije": "Zadatci višestrukih kombinacija",
    "povezivanje": "Zadatci povezivanja",
    "kratki-odgovor": "Zadatci kratkoga odgovora",
    "produzeni-odgovor": "Zadatak produženoga odgovora",
    "otvoreni-zadaci": "Zadatci otvorenoga tipa",
}
TASK_DESCRIPTIONS = {
    "visestruki-izbor": "Odaberi jedan točan odgovor za svako pitanje.",
    "visestruke-kombinacije": "Upiši kombinaciju odgovora; AI procjenjuje bod prema službenome ključu.",
    "povezivanje": "Poveži svaku stavku s odgovarajućim odgovorom.",
    "kratki-odgovor": "Upiši kratak odgovor; AI procjenjuje bodove prema službenome ključu.",
    "produzeni-odgovor": "Napiši produženi odgovor; AI procjenjuje bodove prema službenome modelu.",
    "otvoreni-zadaci": "Upiši odgovor; AI procjenjuje bodove prema službenome ključu.",
}
TASK_ORDER = [
    "visestruki-izbor",
    "visestruke-kombinacije",
    "povezivanje",
    "kratki-odgovor",
    "produzeni-odgovor",
    "otvoreni-zadaci",
]

ENTRY_RE = re.compile(
    r"^\s*(?:Geografija\s+)?(?P<number>\d{1,3}(?:[\.,]\d{1,2})?)(?:\.|\s+)(?P<answer>.*)$",
    flags=re.IGNORECASE,
)
PAPER_QUESTION_RE = re.compile(r"(?m)^\s*(?P<number>\d{1,3}(?:\.\d{1,2})?)\.\s+")
PAPER_HEADING_RE = re.compile(r"(?m)^\s*(?P<roman>[IVX]+)\.\s+(?P<label>Zadat[^\n]+)")
ANSWER_LETTER_RE = re.compile(r"^\s*(?P<answer>[A-Ea-e])(?:\s*$|[\.)]\s*|\s+)")
POINTS_RE = re.compile(r"\((?P<points>\d+)\s+bod(?:ova|a)?\)", flags=re.IGNORECASE)
SIMPLE_ANSWER_LINE_RE = re.compile(
    r"^\s*(?:Geografija\s+)?(?P<question>\d{1,3}(?:[\.,]\d{1,2})?)\s*[\.)]?\s+"
    r"(?P<answer>[A-Ea-e])\s*$",
    flags=re.IGNORECASE,
)
SIMPLE_ANSWER_PAIR_RE = re.compile(
    r"(?<![\w.])(?P<question>\d{1,3}(?:[\.,]\d{1,2})?)\s*[\.)]?\s+"
    r"(?P<answer>[A-Ea-e])(?=\s|$)"
)
TRAILING_DECIMAL_ANSWER_RE = re.compile(
    r"(?P<question>\d{1,3}\.\d{1,2})\.\s+(?P<answer>[A-Ea-e])\s*$"
)
MATCHING_ASSIGNMENT_RE = re.compile(
    r"(?<!\d)(?P<item>\d{1,2})\s*[.\-:]?\s*(?P<answer>[A-Ea-e])(?=\s*[,;/]|\s*$)"
)
MODEL_ANSWER_HEADING_RE = re.compile(
    r"(?im)^\s*MODEL[^\n]*TO[ČC]N[^\n]*ODGOVORA:?\s*$"
)
TWO_COLUMN_CLOSED_ROW_RE = re.compile(
    r"^\s*(?P<leftQuestion>\d{1,3}(?:\.\d{1,2})?)\.\s+"
    r"(?P<leftAnswer>.*?)\s{2,}"
    r"(?P<rightQuestion>\d{1,3}\.\d{1,2})\.\s+"
    r"(?P<rightAnswer>[A-Ea-e])\s*$"
)
PDF_TRAILER_ID_RE = re.compile(
    rb"/ID\s*\[\s*\((?:\\.|[^\\)])*\)\s*\((?:\\.|[^\\)])*\)\s*\]"
)

SKIPPED_LINE_PATTERNS = (
    r"^BROJ$",
    r"^TOČAN ODGOVOR$",
    r"^TOCAN ODGOVOR$",
    r"^ZADATKA$",
    r"^NCVVO\b",
    r"^Nacionalni centar\b",
    r"^Tel:",
    r"^www\.ncvvo\.hr$",
    r"^OIB:",
    r"^Matični broj",
    r"^Matieni broj",
    r"^[IVX]+\.$",
    r"^\d+$",
    r"^\d{1,3}(?:\.\d{1,2})?\.$",
)


@dataclass(frozen=True)
class PaperSection:
    task_id: str
    label: str
    start: int
    end: int
    numbers: frozenset[str]


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
class QuestionMarker:
    number: str
    page: PdfPage
    y_min: float


@dataclass(frozen=True)
class QuestionCrop:
    page: PdfPage
    x_min: float
    y_min: float
    x_max: float
    y_max: float


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
    return f"geografija-{exam['year']}-{slugify(normalize_term(exam['term']))}"


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
    return pdftotext(
        contents,
        "-layout",
        required_message="pdftotext is required to build Geography practice data",
    )


def pdf_bbox_pages(contents: bytes) -> list[PdfPage]:
    xml = pdftotext(
        contents,
        "-bbox-layout",
        required_message="pdftotext is required to build Geography source images",
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
            pdf_words = tuple(
                PdfWord(
                    text="".join(word.itertext()).strip(),
                    x_min=float(word.attrib["xMin"]),
                    x_max=float(word.attrib["xMax"]),
                    y_min=float(word.attrib["yMin"]),
                    y_max=float(word.attrib["yMax"]),
                )
                for word in words
            )
            word_texts = [word.text for word in pdf_words]
            lines.append(
                PdfLine(
                    text=" ".join(word for word in word_texts if word),
                    first_word=word_texts[0],
                    x_min=float(line_element.attrib["xMin"]),
                    x_max=float(line_element.attrib["xMax"]),
                    y_min=float(line_element.attrib["yMin"]),
                    y_max=float(line_element.attrib["yMax"]),
                    words=pdf_words,
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


def page_contains(page: PdfPage, pattern: str) -> bool:
    return any(re.search(pattern, line.text, flags=re.IGNORECASE) for line in page.lines)


def first_page_containing(pages: list[PdfPage], pattern: str) -> PdfPage | None:
    return next((page for page in pages if page_contains(page, pattern)), None)


def geography_question_token(line: PdfLine) -> str | None:
    match = re.fullmatch(r"(\d{1,3}(?:\.\d{1,2})?)\.", line.first_word.strip())
    if not match:
        return None
    return parse_question_token(match.group(1))


def geography_marker_token(line: PdfLine) -> str | None:
    token = geography_question_token(line)
    if token is None:
        return None

    stripped = line.text.strip()
    rest = stripped[len(line.first_word.strip()) :].strip()
    if not rest:
        return token
    if rest[0].islower():
        return None
    return token


def geography_first_task_page(pages: list[PdfPage]) -> PdfPage | None:
    return first_page_containing(pages, r"\bI\.\s+Zadat")


def find_geography_question_markers(
    pages: list[PdfPage],
    wanted_questions: set[str],
) -> dict[str, QuestionMarker]:
    first_task_page = geography_first_task_page(pages)
    start_page_number = first_task_page.number if first_task_page else 1
    candidates: dict[str, list[QuestionMarker]] = {}

    for page in pages:
        if page.number < start_page_number:
            continue
        for line in sorted_page_lines(page):
            token = geography_marker_token(line)
            if token not in wanted_questions:
                continue
            if line.x_min > page.width * 0.42:
                continue
            candidates.setdefault(token, []).append(QuestionMarker(number=token, page=page, y_min=line.y_min))

    markers: dict[str, QuestionMarker] = {}
    last_page = 0
    last_y_min = -math.inf
    for question in sorted(wanted_questions, key=question_sort_key):
        for candidate in candidates.get(question, []):
            if candidate.page.number > last_page or (
                candidate.page.number == last_page and candidate.y_min > last_y_min
            ):
                markers[question] = candidate
                last_page = candidate.page.number
                last_y_min = candidate.y_min
                break
    return markers


def running_header_bottom(page: PdfPage) -> float:
    header_lines = [
        line
        for line in page.lines
        if line.y_min < 130
        and re.fullmatch(r"(?:Geografija|GEO)", line.text.strip(), flags=re.IGNORECASE)
    ]
    return max((line.y_max for line in header_lines), default=0)


def question_crop_y_max(marker: QuestionMarker, ordered_markers: list[QuestionMarker]) -> float:
    marker_index = ordered_markers.index(marker)
    next_marker = ordered_markers[marker_index + 1] if marker_index + 1 < len(ordered_markers) else None
    if next_marker and next_marker.page == marker.page:
        return next_marker.y_min - SOURCE_CROP_VERTICAL_PADDING

    relevant_lines = [
        line
        for line in sorted_page_lines(marker.page)
        if line.y_min >= marker.y_min
        and line.y_min < marker.page.height - SOURCE_FOOTER_MARGIN
    ]
    if not relevant_lines:
        return marker.page.height - SOURCE_FOOTER_MARGIN

    point_lines = [line for line in relevant_lines if POINTS_RE.search(line.text)]
    final_line = point_lines[0] if point_lines else relevant_lines[-1]
    return min(final_line.y_max + SOURCE_CROP_VERTICAL_PADDING, marker.page.height - SOURCE_FOOTER_MARGIN)


def find_geography_question_crops(markers: dict[str, QuestionMarker]) -> dict[str, QuestionCrop]:
    ordered_markers = sorted(
        markers.values(),
        key=lambda marker: (marker.page.number, marker.y_min, question_sort_key(marker.number)),
    )
    crops: dict[str, QuestionCrop] = {}

    for marker in ordered_markers:
        y_min = max(
            SOURCE_CONTENT_TOP_MARGIN,
            running_header_bottom(marker.page) + SOURCE_CROP_VERTICAL_PADDING,
            marker.y_min - SOURCE_CROP_VERTICAL_PADDING,
        )
        y_max = question_crop_y_max(marker, ordered_markers)
        if y_max <= y_min:
            continue
        crops[marker.number] = QuestionCrop(
            page=marker.page,
            x_min=SOURCE_CROP_HORIZONTAL_MARGIN,
            y_min=y_min,
            x_max=marker.page.width - SOURCE_CROP_HORIZONTAL_MARGIN,
            y_max=y_max,
        )

    return crops


def is_key_name(name: str) -> bool:
    normalized = normalized_name(name)
    if "list" in normalized or "prag" in normalized:
        return False
    return bool(re.search(r"klju|kljuc|rje.?enja|rjesenja|odgovor", normalized))


def find_key_names(names: list[str]) -> list[str]:
    key_names = [name for name in names if name.casefold().endswith(".pdf") and is_key_name(name)]
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
        r"\bpopis\b",
    )
    return not any(re.search(pattern, normalized) for pattern in blocked_patterns)


def find_paper_names(names: list[str]) -> list[str]:
    candidates = [name for name in names if is_paper_candidate(name)]
    if not candidates:
        raise ValueError("Could not find an exam paper PDF")

    first_booklets = [
        name
        for name in candidates
        if re.search(r"\bik[-_ ]*1\b|ispitna knjizica 1", normalized_name(name))
    ]
    second_booklets = [
        name
        for name in candidates
        if re.search(r"\bik[-_ ]*2\b|ispitna knjizica 2", normalized_name(name))
    ]
    if first_booklets and second_booklets:
        return [
            sorted(first_booklets, key=lambda name: normalized_name(Path(name).name))[0],
            sorted(second_booklets, key=lambda name: normalized_name(Path(name).name))[0],
        ]

    ds_candidates = [
        name
        for name in candidates
        if re.search(r"\bd[-_ ]*s\s*\d+", normalized_name(name), flags=re.IGNORECASE)
    ]
    if ds_candidates:
        return [sorted(ds_candidates, key=lambda name: normalized_name(Path(name).name))[0]]

    return [sorted(candidates, key=lambda name: normalized_name(Path(name).name))[0]]


def combine_pdf_contents(parts: list[bytes]) -> bytes:
    if len(parts) == 1:
        return parts[0]

    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        input_paths: list[Path] = []
        for index, contents in enumerate(parts, start=1):
            input_path = temporary_root / f"part-{index}.pdf"
            input_path.write_bytes(contents)
            input_paths.append(input_path)
        output_path = temporary_root / "paper.pdf"
        try:
            subprocess.run(
                ["pdfunite", *(str(path) for path in input_paths), str(output_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("pdfunite is required to combine Geography exam booklets") from exc
        except subprocess.CalledProcessError as exc:
            message = exc.stderr.decode("utf-8", errors="replace")
            raise RuntimeError(f"pdfunite failed: {message}") from exc
        return canonicalize_pdf_id(output_path.read_bytes(), parts)


def canonicalize_pdf_id(contents: bytes, source_parts: list[bytes]) -> bytes:
    matches = list(PDF_TRAILER_ID_RE.finditer(contents))
    if not matches:
        raise ValueError("Combined Geography PDF does not contain a trailer ID")

    digest = hashlib.sha256()
    for part in source_parts:
        digest.update(len(part).to_bytes(8, byteorder="big"))
        digest.update(part)
    identifier = digest.hexdigest()[:32].encode("ascii")
    replacement = b"/ID [<" + identifier + b"> <" + identifier + b">]"
    match = matches[-1]
    return contents[: match.start()] + replacement + contents[match.end() :]


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


def task_id_for_heading(label: str) -> str:
    normalized = unicodedata.normalize("NFD", label.casefold()).encode("ascii", "ignore").decode()
    if "produzen" in normalized:
        return "produzeni-odgovor"
    if ("kratk" in normalized and "odgovor" in normalized) or "dopunjavan" in normalized:
        return "kratki-odgovor"
    if "povezivan" in normalized:
        return "povezivanje"
    if "visestrukih kombinacija" in normalized:
        return "visestruke-kombinacije"
    if "visestruk" in normalized and "izbor" in normalized:
        return "visestruki-izbor"
    return "otvoreni-zadaci"


def extract_paper_sections(paper_text: str) -> list[PaperSection]:
    headings = list(PAPER_HEADING_RE.finditer(paper_text))
    sections: list[PaperSection] = []

    for index, heading in enumerate(headings):
        start = heading.end()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(paper_text)
        section_text = paper_text[start:end]
        numbers = frozenset(parse_question_token(match.group("number")) for match in PAPER_QUESTION_RE.finditer(section_text))
        label = " ".join(heading.group("label").split())
        sections.append(
            PaperSection(
                task_id=task_id_for_heading(label),
                label=label,
                start=start,
                end=end,
                numbers=numbers,
            )
        )

    return sections


def section_for_question(sections: list[PaperSection], question: str) -> PaperSection | None:
    for section in sections:
        if question in section.numbers:
            return section
    if "." in question:
        parent = question.split(".", 1)[0]
        for section in sections:
            if parent in section.numbers:
                return section
    return None


def clean_line(line: str) -> str:
    return re.sub(r"\s+", " ", line.replace("\f", " ")).strip()


def should_skip_key_line(line: str) -> bool:
    if not line:
        return True
    return any(re.search(pattern, line, flags=re.IGNORECASE) for pattern in SKIPPED_LINE_PATTERNS)


def normalize_answer_text(lines: list[str]) -> str:
    useful = [line for line in (clean_line(line) for line in lines) if not should_skip_key_line(line)]
    text = "\n".join(useful)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def parse_key_entries(key_texts: list[str], sections: list[PaperSection]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []

    for key_text in key_texts:
        current: dict[str, Any] | None = None
        current_task_id: str | None = None

        def flush() -> None:
            nonlocal current
            if not current:
                return
            answer_text = normalize_answer_text(current["lines"])
            if answer_text:
                entries.append(
                    {
                        "number": current["number"],
                        "answerText": answer_text,
                        "taskId": current.get("taskId"),
                    }
                )
            current = None

        for raw_line in key_text.splitlines():
            two_column_match = TWO_COLUMN_CLOSED_ROW_RE.match(raw_line)
            if two_column_match:
                flush()
                for side in ("left", "right"):
                    question = parse_question_token(two_column_match.group(f"{side}Question"))
                    answer_text = clean_line(two_column_match.group(f"{side}Answer"))
                    section = section_for_question(sections, question)
                    if answer_text:
                        entries.append(
                            {
                                "number": question,
                                "answerText": answer_text,
                                "taskId": section.task_id if section else None,
                            }
                        )
                continue

            line = clean_line(raw_line)
            if not line:
                continue

            heading_task_id = task_id_for_heading(line) if "Zadat" in line else None
            if heading_task_id and heading_task_id != "otvoreni-zadaci":
                flush()
                current_task_id = heading_task_id
                continue

            match = ENTRY_RE.match(line)
            if match:
                flush()
                question = parse_question_token(match.group("number"))
                section = section_for_question(sections, question)
                current = {
                    "number": question,
                    "taskId": current_task_id or section.task_id if section else current_task_id,
                    "lines": [match.group("answer")],
                }
                continue

            if (
                current
                and "MODEL" in line.upper()
                and closed_answer(normalize_answer_text(current["lines"]))
            ):
                flush()
                continue

            if current and not should_skip_key_line(line):
                current["lines"].append(line)

        flush()

    by_number: dict[str, dict[str, Any]] = {}
    for entry in entries:
        by_number.setdefault(entry["number"], entry)
    return [by_number[number] for number in sorted(by_number, key=question_sort_key)]


def parse_simple_answer_pairs(text: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []

    for line in text.splitlines():
        trailing_match = TRAILING_DECIMAL_ANSWER_RE.search(line)
        if trailing_match:
            pairs.append(
                (
                    parse_question_token(trailing_match.group("question")),
                    trailing_match.group("answer").upper(),
                )
            )
            continue

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


def apply_simple_answer_overrides(
    entries: list[dict[str, Any]],
    key_texts: list[str],
    sections: list[PaperSection],
) -> list[dict[str, Any]]:
    by_number = {entry["number"]: entry for entry in entries}
    for key_text in key_texts:
        for question, answer in parse_simple_answer_pairs(key_text):
            section = section_for_question(sections, question)
            task_id = section.task_id if section else None
            entry = by_number.get(question)
            if entry:
                entry["answerText"] = answer
                entry["taskId"] = entry.get("taskId") or task_id
            else:
                by_number[question] = {
                    "number": question,
                    "answerText": answer,
                    "taskId": task_id,
                }
    return [by_number[number] for number in sorted(by_number, key=question_sort_key)]


def expand_matching_entries(
    entries: list[dict[str, Any]],
    sections: list[PaperSection],
) -> list[dict[str, Any]]:
    expanded: list[dict[str, Any]] = []
    for entry in entries:
        section = section_for_question(sections, entry["number"])
        task_id = entry.get("taskId") or (section.task_id if section else None)
        assignments = list(MATCHING_ASSIGNMENT_RE.finditer(entry["answerText"]))
        if "." not in entry["number"] and len(assignments) >= 2:
            for assignment in assignments:
                expanded.append(
                    {
                        "number": f"{entry['number']}.{int(assignment.group('item'))}",
                        "answerText": assignment.group("answer").upper(),
                        "taskId": task_id,
                    }
                )
            continue
        expanded.append(entry)

    by_number: dict[str, dict[str, Any]] = {}
    for entry in expanded:
        by_number.setdefault(entry["number"], entry)
    return [by_number[number] for number in sorted(by_number, key=question_sort_key)]


def apply_extended_model_blocks(
    entries: list[dict[str, Any]],
    key_texts: list[str],
    sections: list[PaperSection],
) -> list[dict[str, Any]]:
    extended_questions = sorted(
        {
            question
            for section in sections
            if section.task_id == "produzeni-odgovor"
            for question in section.numbers
        },
        key=question_sort_key,
    )
    if not extended_questions:
        return entries

    model_blocks: list[str] = []
    for key_text in key_texts:
        headings = list(MODEL_ANSWER_HEADING_RE.finditer(key_text))
        for index, heading in enumerate(headings):
            end = headings[index + 1].start() if index + 1 < len(headings) else len(key_text)
            block = normalize_answer_text(key_text[heading.start() : end].splitlines())
            if block:
                model_blocks.append(block)
    if len(model_blocks) < len(extended_questions):
        return entries

    by_number = {entry["number"]: entry for entry in entries}
    for question, model_answer in zip(extended_questions, model_blocks[-len(extended_questions) :]):
        by_number[question] = {
            "number": question,
            "answerText": model_answer,
            "taskId": "produzeni-odgovor",
        }
    return [by_number[number] for number in sorted(by_number, key=question_sort_key)]


def closed_answer(answer_text: str) -> str | None:
    match = ANSWER_LETTER_RE.match(answer_text)
    if not match:
        return None
    return match.group("answer").upper()


def clean_prompt_text(text: str) -> str:
    lines: list[str] = []
    for raw_line in text.splitlines():
        line = clean_line(raw_line)
        if not line:
            if lines and lines[-1]:
                lines.append("")
            continue
        if re.fullmatch(r"_+", line):
            continue
        if re.fullmatch(r"(?:Geografija|GEO(?: D-S\d+)?|\d+)", line):
            continue
        if re.search(r"^(?:GEO|Nacionalni centar|NCVVO)\b", line):
            continue
        lines.append(line)

    prompt = "\n".join(lines)
    prompt = re.sub(r"\n{3,}", "\n\n", prompt).strip()
    return prompt


def extract_question_prompt(paper_text: str, sections: list[PaperSection], question: str) -> str:
    section = section_for_question(sections, question)
    search_start = section.start if section else 0
    search_end = section.end if section else len(paper_text)
    section_text = paper_text[search_start:search_end]
    pattern = re.compile(rf"(?m)^\s*{re.escape(question)}\.\s+")
    match = pattern.search(section_text)
    if not match:
        return ""

    next_match = PAPER_QUESTION_RE.search(section_text, match.end())
    end = next_match.start() if next_match else len(section_text)
    return clean_prompt_text(section_text[match.start() : end])[:1600]


def max_points_for_open_question(prompt: str, answer_text: str) -> int:
    for source in (prompt, answer_text):
        matches = [int(match.group("points")) for match in POINTS_RE.finditer(source)]
        if matches:
            return max(matches)
    return 1


def build_tasks(entries: list[dict[str, Any]], paper_text: str, sections: list[PaperSection]) -> tuple[list[dict[str, Any]], dict[str, list[str]], dict[str, dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    answers: dict[str, list[str]] = {}
    open_answers: dict[str, dict[str, Any]] = {}

    for entry in entries:
        question = entry["number"]
        answer_text = entry["answerText"]
        section = section_for_question(sections, question)
        task_id = section.task_id if section else entry.get("taskId") or "otvoreni-zadaci"
        answer = closed_answer(answer_text)

        if answer:
            if task_id == "otvoreni-zadaci" and "." in question:
                task_id = "povezivanje"
            question_item = {"number": question}
            if task_id in {"visestruke-kombinacije", "povezivanje"} or answer == "E":
                question_item["options"] = ["A", "B", "C", "D", "E"]
            answers[question] = [answer]
        else:
            if task_id == "visestruki-izbor":
                task_id = "otvoreni-zadaci"
            prompt = extract_question_prompt(paper_text, sections, question)
            max_points = max_points_for_open_question(prompt, answer_text)
            if task_id == "produzeni-odgovor" and max_points == 1:
                max_points = 3
            question_item = {
                "number": question,
                "type": "open",
                "maxPoints": max_points,
                "prompt": prompt,
            }
            open_answers[question] = {
                "maxPoints": max_points,
                "modelAnswer": answer_text,
            }

        grouped.setdefault(task_id, []).append(question_item)

    tasks: list[dict[str, Any]] = []
    ordered_ids = [task_id for task_id in TASK_ORDER if task_id in grouped]
    ordered_ids.extend(task_id for task_id in grouped if task_id not in ordered_ids)

    for task_id in ordered_ids:
        questions = sorted(grouped[task_id], key=lambda item: question_sort_key(item["number"]))
        tasks.append(
            {
                "id": task_id,
                "label": TASK_LABELS.get(task_id, task_id),
                "description": TASK_DESCRIPTIONS.get(task_id, ""),
                "questions": questions,
            }
        )

    return tasks, answers, open_answers


def parse_duration(text: str) -> int | None:
    patterns = (
        r"Ispit\s+traje\s+(\d+)\s+minuta",
        r"Vrijeme\s+rješavanja\s+ispita\s+je\s+(\d+)\s+minuta",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return int(match.group(1))
    return 90


def write_if_changed(path: Path, contents: bytes) -> None:
    if path.is_file() and path.read_bytes() == contents:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)


def crop_text_lines(crop: QuestionCrop) -> list[PdfLine]:
    return [
        line
        for line in sorted_page_lines(crop.page)
        if line.text.strip()
        and line.y_max >= crop.y_min
        and line.y_min <= crop.y_max
    ]


def is_answer_rule_text(line: PdfLine) -> bool:
    return bool(re.fullmatch(r"[\s_]{12,}", line.text.strip()))


def row_dark_counts(
    image: Image.Image,
    box: tuple[int, int, int, int],
    threshold: int,
) -> list[int]:
    x_min, y_min, x_max, y_max = box
    if x_max <= x_min or y_max <= y_min:
        return []

    region = image.crop(box)
    width, height = region.size
    data = region.tobytes()
    counts: list[int] = []
    for row_index in range(height):
        offset = row_index * width
        row = data[offset : offset + width]
        counts.append(sum(value < threshold for value in row))
    return counts


def horizontal_rule_group_count(row_counts: list[int], width: int) -> int:
    if not row_counts or width <= 0:
        return 0

    long_row_threshold = max(80, int(width * 0.42))
    groups = 0
    in_group = False
    group_height = 0
    for count in row_counts:
        if count >= long_row_threshold:
            if not in_group:
                in_group = True
                group_height = 0
            group_height += 1
            continue

        if in_group and group_height <= 8:
            groups += 1
        in_group = False
        group_height = 0

    if in_group and group_height <= 8:
        groups += 1
    return groups


def region_is_blank_or_rules_only(
    image: Image.Image,
    box: tuple[int, int, int, int],
) -> bool:
    x_min, y_min, x_max, y_max = box
    width = x_max - x_min
    height = y_max - y_min
    if width <= 0 or height <= 0:
        return True

    row_counts = row_dark_counts(image, box, SOURCE_LINE_ONLY_PIXEL_THRESHOLD)
    total_dark = sum(row_counts)
    if total_dark <= max(60, int(width * height * 0.00035)):
        return True

    long_row_threshold = max(80, int(width * 0.42))
    rule_rows = [count >= long_row_threshold for count in row_counts]
    rule_dark = sum(count for count, is_rule in zip(row_counts, rule_rows) if is_rule)
    non_rule_dark = total_dark - rule_dark
    return (
        horizontal_rule_group_count(row_counts, width) >= 1
        and non_rule_dark <= max(380, int(total_dark * 0.12))
    )


def trim_trailing_answer_rule_lines(
    visible_lines: list[PdfLine],
    y_min: int,
    y_max: int,
    scale_y: float,
) -> tuple[int, int]:
    trailing_rules: list[PdfLine] = []
    for line in reversed(visible_lines):
        if is_answer_rule_text(line):
            trailing_rules.append(line)
            continue
        break

    if len(trailing_rules) < SOURCE_TRAILING_RULE_MIN_COUNT:
        return y_max, y_min + 48

    first_rule = min(trailing_rules, key=lambda line: line.y_min)
    content_lines = [
        line
        for line in visible_lines
        if not is_answer_rule_text(line)
        and line.y_max <= first_rule.y_min
    ]
    if not content_lines:
        return y_max, y_min + 48

    content_bottom = max(line.y_max for line in content_lines)
    if first_rule.y_min - content_bottom < SOURCE_CROP_VERTICAL_PADDING:
        return y_max, y_min + 48

    candidate_y_max = min(
        y_max,
        math.ceil((content_bottom + SOURCE_BLANK_TRIM_PADDING) * scale_y),
    )
    return candidate_y_max, max(y_min + 48, candidate_y_max)


def refine_geography_crop_box(
    image: Image.Image,
    crop: QuestionCrop,
    x_min: int,
    y_min: int,
    x_max: int,
    y_max: int,
    scale_y: float,
) -> tuple[int, int, int, int]:
    refined_y_max = y_max
    visible_lines = crop_text_lines(crop)
    visible_content_lines = [line for line in visible_lines if not is_answer_rule_text(line)]
    minimum_y_max = y_min + 48
    if visible_content_lines:
        minimum_y_max = max(
            minimum_y_max,
            math.ceil((max(line.y_max for line in visible_content_lines) + SOURCE_CROP_VERTICAL_PADDING) * scale_y),
        )
    non_point_lines = [
        line
        for line in visible_lines
        if not POINTS_RE.search(line.text)
        and not is_answer_rule_text(line)
    ]
    if non_point_lines:
        content_bottom = max(line.y_max for line in non_point_lines)
        point_y_min = min(
            (
                line.y_min
                for line in visible_lines
                if POINTS_RE.search(line.text)
                and line.y_min > content_bottom + SOURCE_CROP_VERTICAL_PADDING
            ),
            default=None,
        )
        if point_y_min is not None and point_y_min - content_bottom >= SOURCE_LINE_ONLY_MIN_GAP:
            candidate_y_max = min(
                refined_y_max,
                math.ceil((content_bottom + SOURCE_BLANK_TRIM_PADDING) * scale_y),
            )
            test_y_min = max(y_min, candidate_y_max)
            test_y_max = min(
                refined_y_max,
                math.floor((point_y_min - SOURCE_CROP_VERTICAL_PADDING) * scale_y),
            )
            if (
                test_y_max - test_y_min >= SOURCE_LINE_ONLY_MIN_GAP * scale_y
                and region_is_blank_or_rules_only(image, (x_min, test_y_min, x_max, test_y_max))
            ):
                minimum_y_max = max(y_min + 48, candidate_y_max)
                refined_y_max = minimum_y_max

    trailing_rule_y_max, trailing_rule_minimum = trim_trailing_answer_rule_lines(
        visible_lines,
        y_min,
        refined_y_max,
        scale_y,
    )
    if trailing_rule_y_max < refined_y_max:
        refined_y_max = trailing_rule_y_max
        minimum_y_max = max(minimum_y_max, trailing_rule_minimum)

    _, _, _, refined_y_max = trim_crop_bottom_whitespace(
        image,
        x_min,
        y_min,
        x_max,
        refined_y_max,
        padding=SOURCE_BLANK_TRIM_PADDING * 2,
        minimum_y_max=min(minimum_y_max, refined_y_max),
        threshold=SOURCE_BLANK_PIXEL_THRESHOLD,
        min_trim=18,
    )
    return x_min, y_min, x_max, max(y_min + 48, refined_y_max)


def render_source_pages(
    paper_path: Path,
    identifier: str,
    crops: dict[str, QuestionCrop],
    force_render: bool = False,
) -> tuple[dict[str, dict[str, Any]], set[str]]:
    destination = PAPER_ROOT / identifier
    crops_by_page: dict[int, list[tuple[str, QuestionCrop]]] = {}
    for key, crop in crops.items():
        crops_by_page.setdefault(crop.page.number, []).append((key, crop))

    source_images: dict[str, dict[str, Any]] = {}
    expected_assets = {"paper.pdf"}
    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        for page_number, page_crops in sorted(crops_by_page.items()):
            filename = f"page-{page_number}.png"
            temporary_prefix = temporary_root / f"page-{page_number}"
            image_path = destination / filename
            if image_path.is_file() and not force_render:
                contents = image_path.read_bytes()
            else:
                render_pdf_page_to_png(
                    paper_path,
                    temporary_prefix,
                    page_number,
                    SOURCE_RENDER_DPI,
                    required_message="pdftocairo is required to build Geography source images",
                )
                contents = temporary_prefix.with_suffix(".png").read_bytes()
            image_width, image_height = png_dimensions(
                contents,
                error_message="Rendered Geography source image is not a PNG",
                strict_ihdr=False,
            )
            write_if_changed(image_path, contents)
            expected_assets.add(filename)
            page_image = grayscale_image_from_png(contents)

            for key, crop in page_crops:
                scale_x = image_width / crop.page.width
                scale_y = image_height / crop.page.height
                x_min = max(0, math.floor(crop.x_min * scale_x))
                y_min = max(0, math.floor(crop.y_min * scale_y))
                x_max = min(image_width, math.ceil(crop.x_max * scale_x))
                y_max = min(image_height, math.ceil(crop.y_max * scale_y))
                x_min, y_min, x_max, y_max = refine_geography_crop_box(
                    page_image,
                    crop,
                    x_min,
                    y_min,
                    x_max,
                    y_max,
                    scale_y,
                )
                if x_max <= x_min or y_max <= y_min:
                    continue
                source_images[key] = {
                    "url": f"{PAPER_URL_PREFIX}/{quote(identifier)}/{filename}",
                    "width": image_width,
                    "height": image_height,
                    "crop": {
                        "x": x_min,
                        "y": y_min,
                        "width": x_max - x_min,
                        "height": y_max - y_min,
                    },
                }

    return source_images, expected_assets


def remove_unexpected_assets(identifier: str, expected_assets: set[str]) -> None:
    destination = PAPER_ROOT / identifier
    if not destination.is_dir():
        return
    for path in destination.iterdir():
        if path.is_file() and path.name not in expected_assets:
            path.unlink()


def parent_question_number(question: str) -> str | None:
    return question.split(".", 1)[0] if "." in question else None


def build_source_images(
    paper_contents: bytes,
    paper_path: Path,
    identifier: str,
    tasks: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    question_numbers = [
        str(question["number"])
        for task in tasks
        for question in task.get("questions", [])
    ]
    parent_numbers = {
        parent
        for question in question_numbers
        if (parent := parent_question_number(question)) and parent not in question_numbers
    }
    wanted_numbers = set(question_numbers) | parent_numbers
    if not wanted_numbers:
        return {}

    pages = pdf_bbox_pages(paper_contents)
    markers = find_geography_question_markers(pages, wanted_numbers)
    crops = find_geography_question_crops(markers)
    all_crops = {
        **{
            f"question:{question}": crops[question]
            for question in question_numbers
            if question in crops
        },
        **{
            f"context:{parent}": crops[parent]
            for parent in parent_numbers
            if parent in crops
        },
    }
    source_images, expected_assets = render_source_pages(paper_path, identifier, all_crops)
    remove_unexpected_assets(identifier, expected_assets)
    return source_images


def attach_source_images(
    tasks: list[dict[str, Any]],
    source_images: dict[str, dict[str, Any]],
) -> None:
    for task in tasks:
        for question in task.get("questions", []):
            number = str(question["number"])
            source_image = source_images.get(f"question:{number}")
            if source_image:
                question["sourceImage"] = source_image

            parent = parent_question_number(number)
            context_image = source_images.get(f"context:{parent}") if parent else None
            if context_image:
                question["contextImages"] = [context_image]


def build_exam(exam: dict[str, Any]) -> dict[str, Any]:
    archive_path = local_archive_path(exam["url"])
    identifier = exam_id(exam)

    with zipfile.ZipFile(archive_path) as archive:
        names = [info.filename for info in archive.infolist() if not info.is_dir()]
        key_names = find_key_names(names)
        paper_names = find_paper_names(names)
        paper_contents = combine_pdf_contents([archive.read(name) for name in paper_names])
        key_texts = [pdf_text(archive.read(name)) for name in key_names]

    paper_text = pdf_text(paper_contents)
    sections = extract_paper_sections(paper_text)
    entries = parse_key_entries(key_texts, sections)
    entries = apply_simple_answer_overrides(entries, key_texts, sections)
    entries = expand_matching_entries(entries, sections)
    entries = apply_extended_model_blocks(entries, key_texts, sections)
    tasks, answers, open_answers = build_tasks(entries, paper_text, sections)

    if not answers and not open_answers:
        raise ValueError("Could not parse any Geography answers")

    destination = PAPER_ROOT / identifier / "paper.pdf"
    write_if_changed(destination, paper_contents)
    source_images = build_source_images(paper_contents, destination, identifier, tasks)
    attach_source_images(tasks, source_images)

    closed_questions = sorted(answers, key=question_sort_key)
    open_questions = sorted(open_answers, key=question_sort_key)

    return {
        "id": identifier,
        "subject": SUBJECT,
        "year": exam["year"],
        "schoolYear": exam["schoolYear"],
        "term": normalize_term(exam["term"]),
        "level": exam.get("level"),
        "archiveUrl": exam["url"],
        "paperUrl": f"{PAPER_URL_PREFIX}/{quote(identifier)}/paper.pdf",
        "durationMinutes": parse_duration(paper_text),
        "checkingSupported": True,
        "questions": closed_questions,
        "openQuestions": open_questions,
        "tasks": tasks,
        "answers": {question: answers[question] for question in closed_questions},
        "openAnswers": {question: open_answers[question] for question in open_questions},
    }


def remove_orphaned_papers(expected_ids: set[str]) -> None:
    if not PAPER_ROOT.is_dir():
        return
    for path in PAPER_ROOT.iterdir():
        if path.is_dir() and path.name not in expected_ids:
            shutil.rmtree(path)


def main() -> None:
    archive_index = load_archive_index()
    candidate_exams = [exam for exam in archive_index["exams"] if exam["subject"] == SUBJECT]
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

    print(f"Wrote {len(exams)} Geography practice exams to {OUTPUT.relative_to(ROOT)}")
    if skipped:
        print(f"Skipped {len(skipped)} Geography archives without reliable generated data")


if __name__ == "__main__":
    main()
