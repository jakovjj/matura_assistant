#!/usr/bin/env python3
"""Build Croatian summary and school essay practice data from mirrored NCVVO ZIP files."""

from __future__ import annotations

import json
import re
import shutil
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse

from pdf_utils import pdfinfo_page_count, pdftotext, png_dimensions, render_pdf_page_to_png


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_INDEX = ROOT / "data" / "exams.js"
OUTPUT = ROOT / "data" / "croatian-writing.js"
ASSET_ROOT = ROOT / "files" / "interactive" / "croatian-writing"
ASSET_URL_PREFIX = "./files/interactive/croatian-writing"
ARCHIVE_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
OUTPUT_PREFIX = "window.ASISTENT_ZA_MATURE_CROATIAN_WRITING="
SUBJECT = "Hrvatski jezik"
TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}
SOURCE_RENDER_DPI = 120


@dataclass(frozen=True)
class WritingPart:
    kind: str
    label: str
    duration_minutes: int
    max_score: int
    word_range: dict[str, int | None]
    rubric_id: str
    score_multiplier: int = 1
    source_format: str = "new"


CURRENT_CATALOG_SOURCE = {
    "title": "NCVVO Ispitni katalog za državnu maturu 2022./2023. - Hrvatski jezik",
    "url": "https://www.ncvvo.hr/wp-content/uploads/2022/09/HRV-2023a.pdf",
}
LEGACY_2022_CATALOG_SOURCE = {
    "title": "NCVVO Ispitni katalog za državnu maturu 2021./2022. - Hrvatski jezik",
    "url": "https://www.ncvvo.hr/wp-content/uploads/2021/09/HRV2022a.pdf",
}
LEGACY_CATALOG_SOURCE = {
    "title": "NCVVO Ispitni katalog za državnu maturu 2018./2019. - Hrvatski jezik",
    "url": "https://www.ncvvo.hr/wp-content/uploads/2018/10/HRVATSKI-2019.pdf",
}

SUMMARY_RUBRIC_ID = "summary-2023"
SCHOOL_ESSAY_RUBRIC_ID = "school-essay-2023"
LEGACY_ESSAY_RUBRIC_ID = "school-essay-legacy"
LEGACY_ESSAY_2022_RUBRIC_ID = "school-essay-2022"

RUBRICS: dict[str, dict[str, Any]] = {
    SUMMARY_RUBRIC_ID: {
        "id": SUMMARY_RUBRIC_ID,
        "label": "Službena rubrika za sažetak",
        "source": CURRENT_CATALOG_SOURCE,
        "criteria": [
            {
                "id": "content",
                "label": "Sadržaj",
                "maxScore": 3,
                "levels": [
                    {
                        "score": 3,
                        "description": (
                            "Navodi autora i naslov, temu, namjenu, autorov stav, osnovne "
                            "misli i važne pojedinosti; nema suvišnih detalja i uglavnom "
                            "se služi vlastitim riječima."
                        ),
                    },
                    {
                        "score": 2,
                        "description": (
                            "Sadržaj je djelomično potpun ili općenit, uz poneke suvišne "
                            "pojedinosti ili dijelove prenesene iz polaznoga teksta."
                        ),
                    },
                    {
                        "score": 1,
                        "description": (
                            "Tekst uglavnom prepričava, izdvaja samo jednu osnovnu misao "
                            "ili navodi slabije povezane pojedinosti."
                        ),
                    },
                    {
                        "score": 0,
                        "description": (
                            "Ne određuje temu, namjenu i autorov stav, ne izdvaja osnovne "
                            "misli ili je većinom prepisan."
                        ),
                    },
                ],
            },
            {
                "id": "organizationStyle",
                "label": "Organizacija teksta i stil",
                "maxScore": 3,
                "levels": [
                    {
                        "score": 3,
                        "description": (
                            "Ima jasan uvod, razradu i zaključak, logičan slijed, povezane "
                            "misli te objektivan, jasan i primjeren stil."
                        ),
                    },
                    {
                        "score": 2,
                        "description": (
                            "Trodijelna struktura postoji, ali slijed i veze među mislima "
                            "nisu potpuno jasni."
                        ),
                    },
                    {
                        "score": 1,
                        "description": (
                            "Nedostaje uvod ili zaključak, a slijed i povezanost misli slabi su."
                        ),
                    },
                    {
                        "score": 0,
                        "description": (
                            "Nema trodijelnu strukturu ni povezane osnovne misli i stil "
                            "nije primjeren sažetku."
                        ),
                    },
                ],
            },
            {
                "id": "languageAccuracy",
                "label": "Jezična točnost",
                "maxScore": 3,
                "levels": [
                    {"score": 3, "description": "Pravopisno, gramatički i leksički točno."},
                    {
                        "score": 2,
                        "description": "Uglavnom pravopisno, gramatički i leksički točno.",
                    },
                    {
                        "score": 1,
                        "description": "Djelomično pravopisno, gramatički i leksički točno.",
                    },
                    {"score": 0, "description": "Pravopisno, gramatički i leksički netočno."},
                ],
            },
        ],
        "specialRules": [
            "Očekivani opseg je 200-250 riječi; za vrednovanje je dopušteno 180-275 riječi.",
            "Sažetak se ne vrednuje ako ne ostvari barem 1 bod u sastavnici Sadržaj.",
            "Sažetak se ne vrednuje ako tekst nije čitljiv ili je pisan samo velikim tiskanim slovima.",
        ],
    },
    SCHOOL_ESSAY_RUBRIC_ID: {
        "id": SCHOOL_ESSAY_RUBRIC_ID,
        "label": "Službena rubrika za interpretacijski školski esej",
        "source": CURRENT_CATALOG_SOURCE,
        "criteria": [
            {
                "id": "centralThesis",
                "label": "Središnja tvrdnja",
                "maxScore": 3,
                "levels": [
                    {
                        "score": 3,
                        "description": (
                            "Tvrdnja je jasna i točna, pokazuje temeljito razumijevanje "
                            "djela i uključuje relevantna književna obilježja."
                        ),
                    },
                    {
                        "score": 2,
                        "description": (
                            "Tvrdnja je točna, ali općenita; razumijevanje i izdvojena "
                            "književna obilježja djelomični su."
                        ),
                    },
                    {
                        "score": 1,
                        "description": (
                            "Tvrdnja je vrlo općenita, razumijevanje površno, moguće su "
                            "činjenične pogreške i izostaju važna književna obilježja."
                        ),
                    },
                    {"score": 0, "description": "Nema razvijenu središnju tvrdnju."},
                ],
            },
            {
                "id": "argumentation",
                "label": "Argumentacija",
                "maxScore": 3,
                "levels": [
                    {
                        "score": 3,
                        "description": (
                            "Dva ili tri jasna argumenta temeljito objašnjavaju tvrdnju, "
                            "potkrijepljeni su djelom i cjelovitom analizom ulomka."
                        ),
                    },
                    {
                        "score": 2,
                        "description": (
                            "Dva ili tri općenita argumenta djelomično objašnjavaju i "
                            "potkrepljuju tvrdnju te daju djelomičnu analizu ulomka."
                        ),
                    },
                    {
                        "score": 1,
                        "description": (
                            "Jedan razvijen ili više slabih argumenata površno podupiru "
                            "tvrdnju, uz vrlo površnu analizu."
                        ),
                    },
                    {"score": 0, "description": "Argumentacija izostaje."},
                ],
            },
            {
                "id": "coherence",
                "label": "Povezanost teksta",
                "maxScore": 3,
                "levels": [
                    {
                        "score": 3,
                        "description": (
                            "Uvod, razrada i zaključak povezani su; odlomci su jasni i "
                            "logični, a kohezivna sredstva gotovo potpuno uporabljena."
                        ),
                    },
                    {
                        "score": 2,
                        "description": (
                            "Tekst ima tri dijela, ali oni nisu posve povezani; odlomci i "
                            "kohezivna sredstva djelomično su uspješni."
                        ),
                    },
                    {
                        "score": 1,
                        "description": (
                            "Tekst ima tri dijela, ali uvod ili zaključak vrlo su općeniti, "
                            "odlomci nejasni, a povezanost površna."
                        ),
                    },
                    {
                        "score": 0,
                        "description": (
                            "Tekst nema trodijelnu strukturu; razrada nije organizirana i "
                            "rečenice su nepovezane."
                        ),
                    },
                ],
            },
            {
                "id": "vocabulary",
                "label": "Upotreba rječnika",
                "maxScore": 3,
                "levels": [
                    {
                        "score": 3,
                        "description": (
                            "Rječnik je širok i primjeren; književni pojmovi rabe se "
                            "dosljedno i točno, a opće riječi precizno."
                        ),
                    },
                    {
                        "score": 2,
                        "description": (
                            "Rječnik je zadovoljavajući i uglavnom primjeren; književni "
                            "pojmovi rabe se djelomično, a opće riječi uglavnom točno."
                        ),
                    },
                    {
                        "score": 1,
                        "description": (
                            "Rječnik je ograničen i često neprimjeren; književni pojmovi "
                            "rijetki su, a opće riječi samo djelomično točne."
                        ),
                    },
                    {
                        "score": 0,
                        "description": (
                            "Rječnik je nezadovoljavajući i neprimjeren; književni pojmovi "
                            "izostaju, a opće riječi rabe se netočno."
                        ),
                    },
                ],
            },
            {
                "id": "languageAccuracy",
                "label": "Pravopisna i gramatička točnost",
                "maxScore": 3,
                "levels": [
                    {"score": 3, "description": "Pravopisno i gramatički točno."},
                    {"score": 2, "description": "Uglavnom pravopisno i gramatički točno."},
                    {"score": 1, "description": "Djelomično pravopisno i gramatički točno."},
                    {"score": 0, "description": "Pravopisno i gramatički netočno."},
                ],
            },
        ],
        "specialRules": [
            "Očekuje se najmanje 440 riječi; za vrednovanje je dopušteno najmanje 396 riječi.",
            "Esej se ne vrednuje ako ne ostvari barem 1 bod u sastavnici Središnja tvrdnja.",
            "Esej se ne vrednuje ako tekst nije čitljiv ili je pisan samo velikim tiskanim slovima.",
        ],
    },
    LEGACY_ESSAY_RUBRIC_ID: {
        "id": LEGACY_ESSAY_RUBRIC_ID,
        "label": "Službena rubrika za školski esej starog formata",
        "source": LEGACY_CATALOG_SOURCE,
        "criteria": [
            {
                "id": "contentArgumentation",
                "label": "A: Poznavanje i razumijevanje književnoga teksta",
                "maxScore": 20,
                "items": [
                    {"id": "A1", "label": "Prepoznaje obilježja polaznoga teksta ili tekstova", "maxScore": 2},
                    {"id": "A2", "label": "Navodi ključne sadržajne podatke i strukturu djela", "maxScore": 4},
                    {"id": "A3", "label": "Razumije i problematizira polazni tekst i djelo u cjelini", "maxScore": 6},
                    {"id": "A4", "label": "Tvrdnje potkrepljuje primjerima i citatima", "maxScore": 4},
                    {"id": "A5", "label": "Sintetizira argumente, stavove i čitateljsko iskustvo", "maxScore": 4},
                ],
            },
            {
                "id": "composition",
                "label": "B: Povezanost teksta",
                "maxScore": 6,
                "items": [
                    {"id": "B1", "label": "Sadržajno oblikuje uvod, razradu i zaključak", "maxScore": 1},
                    {"id": "B2", "label": "Povezuje tvrdnje smisleno i logično", "maxScore": 4},
                    {"id": "B3", "label": "Upotrebljava prikladan stil", "maxScore": 1},
                ],
            },
            {
                "id": "languageStyle",
                "label": "C: Upotreba standardnoga hrvatskog jezika",
                "maxScore": 14,
                "items": [
                    {"id": "C1", "label": "Sintaktička točnost", "maxScore": 4},
                    {"id": "C2", "label": "Pravopisna točnost", "maxScore": 6},
                    {"id": "C3", "label": "Morfološka točnost", "maxScore": 2},
                    {"id": "C4", "label": "Leksička točnost", "maxScore": 2},
                ],
            },
        ],
        "specialRules": [
            "Dopušteno je odstupanje do 10 % ispod zadanoga najmanjeg broja riječi.",
            "Esej se ne vrednuje ako zadatak nije ispunjen, tekst nije u obliku eseja, sadrži nepristojno izražavanje ili crteže, nije čitljiv ili je pisan samo velikim tiskanim slovima.",
        ],
    },
    LEGACY_ESSAY_2022_RUBRIC_ID: {
        "id": LEGACY_ESSAY_2022_RUBRIC_ID,
        "label": "Službena rubrika za školski esej 2021./2022.",
        "source": LEGACY_2022_CATALOG_SOURCE,
        "criteria": [
            {
                "id": "contentArgumentation",
                "label": "A: Poznavanje i razumijevanje književnoga teksta",
                "maxScore": 20,
                "items": [
                    {"id": "A1", "label": "Prepoznaje obilježja polaznoga teksta ili tekstova", "maxScore": 2},
                    {"id": "A2", "label": "Navodi ključne sadržajne podatke i strukturu djela u cjelini", "maxScore": 4},
                    {"id": "A3", "label": "Analizira polazni tekst i povezuje ga s djelom u cjelini", "maxScore": 6},
                    {"id": "A4", "label": "Tvrdnje potkrepljuje primjerima i citatima", "maxScore": 4},
                    {"id": "A5", "label": "Obrazlaže stavove, izvodi zaključak i pokazuje ukupno čitateljsko iskustvo", "maxScore": 4},
                ],
            },
            {
                "id": "composition",
                "label": "B: Povezanost teksta",
                "maxScore": 6,
                "items": [
                    {"id": "B1", "label": "Sadržajno oblikuje uvod, razradu i zaključak", "maxScore": 1},
                    {"id": "B2", "label": "Povezuje tvrdnje smisleno i logično", "maxScore": 4},
                    {"id": "B3", "label": "Upotrebljava prikladan stil", "maxScore": 1},
                ],
            },
            {
                "id": "languageStyle",
                "label": "C: Upotreba standardnoga hrvatskog jezika",
                "maxScore": 14,
                "items": [
                    {"id": "C1", "label": "Sintaktička točnost", "maxScore": 4},
                    {"id": "C2", "label": "Pravopisna točnost", "maxScore": 6},
                    {"id": "C3", "label": "Morfološka točnost", "maxScore": 2},
                    {"id": "C4", "label": "Leksička točnost", "maxScore": 2},
                ],
            },
        ],
        "specialRules": [
            "Dopušteno je odstupanje do 10 % ispod zadanoga najmanjeg broja riječi.",
            "Esej se ne vrednuje ako zadatak nije ispunjen, tekst nije u obliku eseja, sadrži nepristojno izražavanje ili crteže, nije čitljiv, pisan je samo velikim tiskanim slovima ili je potpisan.",
        ],
    },
}

NEW_WRITING_PARTS = (
    WritingPart(
        kind="sazetak",
        label="Sažetak",
        duration_minutes=80,
        max_score=18,
        word_range={"min": 200, "max": 250, "acceptedMin": 180, "acceptedMax": 275},
        rubric_id=SUMMARY_RUBRIC_ID,
        score_multiplier=2,
    ),
    WritingPart(
        kind="skolski-esej",
        label="Školski esej",
        duration_minutes=160,
        max_score=30,
        word_range={"min": 440, "max": None, "acceptedMin": 396, "acceptedMax": None},
        rubric_id=SCHOOL_ESSAY_RUBRIC_ID,
        score_multiplier=2,
    ),
)


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


def writing_id(exam: dict[str, Any], part: WritingPart) -> str:
    level = f"-{slugify(exam['level'])}" if exam.get("level") else ""
    return f"hrvatski{level}-{exam['year']}-{slugify(normalize_term(exam['term']))}-{part.kind}"


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


def pdf_text(contents: bytes, first_page: int | None = None, last_page: int | None = None) -> str:
    arguments = ["-layout"]
    if first_page is not None:
        arguments.extend(["-f", str(first_page)])
    if last_page is not None:
        arguments.extend(["-l", str(last_page)])
    return pdftotext(
        contents,
        *arguments,
        required_message="pdftotext is required to build Croatian writing data",
    )


def pdf_page_count(contents: bytes) -> int:
    return pdfinfo_page_count(
        contents,
        required_message="pdfinfo is required to build Croatian writing data",
    )


def find_summary_paper(names: list[str]) -> str:
    candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and re.search(r"\bik[-_ ]*2\b", normalized_name(name))
    ]
    if len(candidates) != 1:
        raise ValueError(f"Expected one Croatian summary paper, found {candidates}")
    return candidates[0]


def find_essay_task(names: list[str]) -> str:
    candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and re.search(r"esejski.?zadatak", normalized_name(name))
    ]
    if len(candidates) != 1:
        raise ValueError(f"Expected one Croatian school essay task, found {candidates}")
    return candidates[0]


def find_old_essay_booklet(names: list[str]) -> str | None:
    candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and re.search(r"\bik[-_ ]*2\b|ispitna knjizica 2", normalized_name(name))
    ]
    if not candidates:
        return None
    if len(candidates) != 1:
        raise ValueError(f"Expected one old Croatian essay booklet, found {candidates}")
    return candidates[0]


def find_old_essay_task(names: list[str]) -> str | None:
    direct_candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and re.search(r"esejski.?zadatak", normalized_name(name))
    ]
    if direct_candidates:
        if len(direct_candidates) != 1:
            raise ValueError(f"Expected one old Croatian essay task, found {direct_candidates}")
        return direct_candidates[0]

    essay_candidates = [
        name
        for name in names
        if name.casefold().endswith(".pdf")
        and re.search(r"\bhrv\s*[ab]\s*esej\b", normalized_name(name))
        and not re.search(r"list|ik[-_ ]*2|koncept|klju|odgovor", normalized_name(name))
    ]
    if essay_candidates:
        if len(essay_candidates) != 1:
            raise ValueError(f"Expected one old Croatian essay fallback task, found {essay_candidates}")
        return essay_candidates[0]

    return find_old_essay_booklet(names)


def summary_task_pages(contents: bytes) -> list[int]:
    page_count = pdf_page_count(contents)
    page_texts = {
        page: pdf_text(contents, page, page)
        for page in range(1, page_count + 1)
    }
    start_page = next(
        (
            page
            for page, text in page_texts.items()
            if "Pročitajte polazni tekst." in text
        ),
        None,
    )
    if start_page is None:
        raise ValueError("Could not locate the Croatian summary source text")

    end_page = next(
        (
            page
            for page in range(start_page, page_count + 1)
            if "Smjernice za pisanje sažetka" in page_texts[page]
        ),
        None,
    )
    if end_page is None:
        raise ValueError("Could not locate the Croatian summary guidelines")
    return list(range(start_page, end_page + 1))


def old_essay_task_pages(contents: bytes) -> list[int]:
    page_count = pdf_page_count(contents)
    page_texts = {
        page: pdf_text(contents, page, page)
        for page in range(1, page_count + 1)
    }
    if page_count <= 3:
        return list(range(1, page_count + 1))

    start_page = next(
        (
            page
            for page, text in page_texts.items()
            if re.search(r"Pozorno pročitajte (?:sljedeć[ei]|naveden[ei])", text)
            or "ZADATAK ZA PISANJE ŠKOLSKOGA ESEJA" in text
        ),
        None,
    )
    if start_page is None:
        start_page = next(
            (
                page
                for page, text in page_texts.items()
                if re.search(r"\b(?:Prvi|Polazni) tekst\b", text)
            ),
            None,
        )
    if start_page is None:
        raise ValueError("Could not locate the old Croatian essay task")

    end_page = page_count
    for page in range(start_page + 1, page_count + 1):
        normalized = re.sub(r"\s+", " ", page_texts[page]).strip()
        if (
            "LISTOVI ZA PISANJE" in normalized
            or "List za školski esej" in normalized
            or "ca ni ra st a zn ra P" in normalized
        ):
            end_page = page - 1
            break

    return list(range(start_page, end_page + 1))


def clean_task_text(text: str, part: WritingPart) -> str:
    if part.kind == "sazetak":
        start = text.find("Pročitajte polazni tekst.")
        end = text.find("LISTOVI ZA PISANJE", start)
        if start < 0:
            raise ValueError("Could not extract the Croatian summary task text")
        if end < 0:
            end = len(text)
        text = text[start:end]

    skipped_lines = {
        "Hrvatski jezik",
        "Sažetak",
        "Školski esej",
    }
    lines: list[str] = []
    for raw_line in text.replace("\f", "\n").splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line or line in skipped_lines:
            continue
        if re.fullmatch(r"\d+(?:/\d+)?", line):
            continue
        if re.search(r"\bHRV (?:IK-\d|IK-\d|IK|[A-Z]\d)", line):
            continue
        lines.append(line)

    task_text = "\n".join(lines).strip()
    if not task_text:
        raise ValueError(f"Could not extract Croatian {part.kind} task text")
    return task_text


def render_source_pages(paper_path: Path, identifier: str, pages: list[int]) -> list[dict[str, Any]]:
    destination = ASSET_ROOT / identifier
    source_images: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        for page in pages:
            temporary_prefix = temporary_root / f"page-{page}"
            render_pdf_page_to_png(
                paper_path,
                temporary_prefix,
                page,
                SOURCE_RENDER_DPI,
                required_message="pdftocairo is required to build Croatian writing source images",
            )

            contents = temporary_prefix.with_suffix(".png").read_bytes()
            width, height = png_dimensions(contents)
            filename = f"page-{page}.png"
            (destination / filename).write_bytes(contents)
            source_images.append(
                {
                    "url": f"{ASSET_URL_PREFIX}/{quote(identifier)}/{filename}",
                    "page": page,
                    "width": width,
                    "height": height,
                    "crop": {"x": 0, "y": 0, "width": width, "height": height},
                }
            )

    return source_images


def old_essay_word_range(exam: dict[str, Any]) -> dict[str, int | None]:
    level = exam.get("level")
    if level == "A":
        minimum = 400
        maximum = 600 if exam["year"] <= 2015 else None
    elif level == "B":
        minimum = 350
        maximum = 500 if exam["year"] <= 2015 else None
    else:
        raise ValueError(f"Old Croatian essay requires A/B level: {exam}")

    return {
        "min": minimum,
        "max": maximum,
        "acceptedMin": round(minimum * 0.9),
        "acceptedMax": None,
    }


def old_school_essay_part(exam: dict[str, Any]) -> WritingPart:
    score_multiplier = 2 if 2016 <= exam["year"] <= 2018 else 1
    return WritingPart(
        kind="skolski-esej",
        label="Školski esej",
        duration_minutes=160,
        max_score=40 * score_multiplier,
        word_range=old_essay_word_range(exam),
        rubric_id=(
            LEGACY_ESSAY_2022_RUBRIC_ID
            if exam["year"] == 2022
            else LEGACY_ESSAY_RUBRIC_ID
        ),
        score_multiplier=score_multiplier,
        source_format="old",
    )


def writing_parts_for_exam(exam: dict[str, Any]) -> tuple[WritingPart, ...]:
    if exam["year"] >= 2023 and not exam.get("level"):
        return NEW_WRITING_PARTS
    if exam["year"] < 2023 and exam.get("level") in {"A", "B"}:
        return (old_school_essay_part(exam),)
    return ()


def source_name_for_part(
    names: list[str],
    part: WritingPart,
) -> str | None:
    if part.kind == "sazetak":
        return find_summary_paper(names)
    if part.source_format == "old":
        return find_old_essay_task(names)
    return find_essay_task(names)


def task_pages(contents: bytes, part: WritingPart) -> list[int]:
    if part.kind == "sazetak":
        return summary_task_pages(contents)
    if part.source_format == "old":
        return old_essay_task_pages(contents)
    return list(range(1, pdf_page_count(contents) + 1))


def build_part(
    exam: dict[str, Any],
    archive: zipfile.ZipFile,
    names: list[str],
    part: WritingPart,
) -> dict[str, Any] | None:
    source_name = source_name_for_part(names, part)
    if source_name is None:
        return None

    contents = archive.read(source_name)
    pages = task_pages(contents, part)
    identifier = writing_id(exam, part)
    destination = ASSET_ROOT / identifier
    destination.mkdir(parents=True, exist_ok=True)
    paper_path = destination / "paper.pdf"
    paper_path.write_bytes(contents)

    return {
        "id": identifier,
        "kind": part.kind,
        "partLabel": part.label,
        "year": exam["year"],
        "schoolYear": exam.get("schoolYear", ""),
        "term": normalize_term(exam["term"]),
        "level": exam.get("level"),
        "archiveUrl": exam["url"],
        "paperUrl": f"{ASSET_URL_PREFIX}/{identifier}/paper.pdf",
        "sourceName": Path(source_name).name,
        "durationMinutes": part.duration_minutes,
        "wordRange": part.word_range,
        "maxScore": part.max_score,
        "scoreMultiplier": part.score_multiplier,
        "rubricId": part.rubric_id,
        "taskText": clean_task_text(pdf_text(contents, pages[0], pages[-1]), part),
        "sourceImages": render_source_pages(paper_path, identifier, pages),
    }


def build_exam(exam: dict[str, Any]) -> list[dict[str, Any]]:
    archive_path = local_archive_path(exam["url"])
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        parts = []
        for part in writing_parts_for_exam(exam):
            built_part = build_part(exam, archive, names, part)
            if built_part is not None:
                parts.append(built_part)
        return parts


def main() -> None:
    archive_index = load_archive_index()
    croatian_exams = [
        exam
        for exam in archive_index["exams"]
        if exam["subject"] == SUBJECT and writing_parts_for_exam(exam)
    ]
    croatian_exams.sort(
        key=lambda item: (item["year"], normalize_term(item["term"]), item.get("level") or ""),
        reverse=True,
    )

    shutil.rmtree(ASSET_ROOT, ignore_errors=True)
    ASSET_ROOT.mkdir(parents=True, exist_ok=True)

    exams = [part for exam in croatian_exams for part in build_exam(exam)]
    payload = {
        "version": 2,
        "rubrics": RUBRICS,
        "exams": exams,
    }
    OUTPUT.write_text(
        f"{OUTPUT_PREFIX}{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8",
    )
    print(f"Built {len(exams)} Croatian writing parts")


if __name__ == "__main__":
    main()
