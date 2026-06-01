#!/usr/bin/env python3
"""Build the local Asistent za Mature exam index from the public NCVVO archive."""

from __future__ import annotations

import html
import json
import os
import re
import shutil
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote, unquote, urljoin, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "exams.js"
MIRROR_ROOT = ROOT / "files" / "ncvvo"
MIRROR_URL_PREFIX = "./files/ncvvo"
API_URL = (
    "https://www.ncvvo.hr/wp-json/wp/v2/posts"
    "?categories=58&per_page=100&_fields=link,title"
)
ARCHIVE_URL = "https://www.ncvvo.hr/kategorija/drzavna-matura/provedeni-ispiti/"
MIN_YEAR = 2013
MAX_YEAR = 2025
DOWNLOAD_WORKERS = 4
USER_AGENT = "asistent-za-mature-archive-builder/1.0"

SUBJECTS = (
    "Hrvatski jezik",
    "Engleski jezik",
    "Matematika",
    "Fizika",
    "Biologija",
    "Kemija",
    "Informatika",
    "Geografija",
    "Povijest",
    "Politika i gospodarstvo",
    "Psihologija",
    "Sociologija",
    "Filozofija",
    "Etika",
    "Logika",
    "Likovna umjetnost",
    "Glazbena umjetnost",
    "Vjeronauk",
    "Njemački jezik",
    "Talijanski jezik i književnost",
    "Talijanski jezik",
    "Francuski jezik",
    "Španjolski jezik",
    "Latinski jezik",
    "Grčki jezik",
    "Srpski jezik",
    "Mađarski jezik i književnost",
    "Mađarski jezik",
)

PRIORITY_SUBJECTS = {
    "Hrvatski jezik",
    "Engleski jezik",
    "Matematika",
    "Fizika",
    "Biologija",
}

TERM_LABELS = {
    "prvi": "ljetni rok",
    "drugi": "jesenski rok",
    "ljetni": "ljetni rok",
    "jesenski": "jesenski rok",
}

TERM_ORDER = {
    "ljetni rok": 0,
    "jesenski rok": 1,
}

# Translated variants are separate archive files. The first version indexes the
# regular Croatian-language exam packages only.
TRANSLATION_SUFFIX = re.compile(r"(?:ITA|SRP|MAG)(?:[_-]?[a-z])?\.zip$", re.I)
YEAR_PATTERN = re.compile(r"(\d{4})\s*\./\s*(\d{4})\.")


@dataclass(frozen=True)
class Anchor:
    href: str
    text: str


class MainAnchorParser(HTMLParser):
    """Collect anchors from the page's main content, excluding site chrome."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.main_depth = 0
        self.current_href: str | None = None
        self.current_text: list[str] = []
        self.anchors: list[Anchor] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "main":
            self.main_depth += 1
        elif self.main_depth and tag == "a":
            self.current_href = attributes.get("href")
            self.current_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.current_href is not None:
            text = " ".join(" ".join(self.current_text).split())
            self.anchors.append(Anchor(self.current_href, text))
            self.current_href = None
            self.current_text = []
        elif tag == "main" and self.main_depth:
            self.main_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.current_href is not None:
            self.current_text.append(data)


def fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_json(url: str) -> Any:
    return json.loads(fetch_text(url))


def clean_label(value: str) -> str:
    value = html.unescape(value).replace("\xa0", " ")
    value = value.strip(" \t\r\n-–—")
    return " ".join(value.split())


def parse_subject(label: str) -> str | None:
    normalized = clean_label(label)
    lower_label = normalized.casefold()

    for subject in SUBJECTS:
        if lower_label.startswith(subject.casefold()):
            return subject

    # Older posts use "materinski" wording for minority-language exams.
    if lower_label.startswith("srpski materinski"):
        return "Srpski jezik"
    if lower_label.startswith("mađarski materinski"):
        return "Mađarski jezik"
    if lower_label.startswith("talijanski materinski"):
        return "Talijanski jezik"

    return None


def parse_level(label: str, filename: str, subject: str) -> str | None:
    lower_label = clean_label(label).casefold()
    if "osnovna razina" in lower_label:
        return "B"
    if "viša razina" in lower_label or "visa razina" in lower_label:
        return "A"

    if subject not in {"Hrvatski jezik", "Engleski jezik", "Matematika"}:
        return None

    code = {
        "Hrvatski jezik": "HRV",
        "Engleski jezik": "ENG",
        "Matematika": "MAT",
    }[subject]
    match = re.search(rf"{code}[_-]?([AB])", filename, re.I)
    return match.group(1).upper() if match else None


def parse_term(title: str) -> str | None:
    lower_title = title.casefold()
    for token, term in TERM_LABELS.items():
        if token in lower_title:
            return term
    return None


def should_skip_zip(filename: str) -> bool:
    return bool(TRANSLATION_SUFFIX.search(filename))


def collect_post_exams(post: dict[str, Any]) -> list[dict[str, Any]]:
    title = clean_label(post["title"]["rendered"])
    year_match = YEAR_PATTERN.search(title)
    if "probni" in title.casefold() or not year_match:
        return []

    year = int(year_match.group(2))
    term = parse_term(title)
    if not term or not MIN_YEAR <= year <= MAX_YEAR:
        return []

    parser = MainAnchorParser()
    parser.feed(fetch_text(post["link"]))

    exams: list[dict[str, Any]] = []
    seen: set[tuple[str, str | None]] = set()

    for anchor in parser.anchors:
        url = urljoin(post["link"], anchor.href)
        parsed_url = urlparse(url)
        filename = unquote(Path(parsed_url.path).name)
        if parsed_url.netloc != "www.ncvvo.hr":
            continue
        if not filename.casefold().endswith(".zip") or should_skip_zip(filename):
            continue

        subject = parse_subject(anchor.text)
        if not subject:
            continue

        level = parse_level(anchor.text, filename, subject)
        dedupe_key = (subject, level)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        exams.append(
            {
                "year": year,
                "schoolYear": f"{year - 1}./{year}.",
                "term": term,
                "subject": subject,
                "level": level,
                "priority": subject in PRIORITY_SUBJECTS,
                "url": url,
                "sourceUrl": post["link"],
            }
        )

    return exams


def mirror_target(upstream_url: str) -> tuple[Path, str]:
    parsed_url = urlparse(upstream_url)
    archive_path = unquote(parsed_url.path)
    relative_path = PurePosixPath(archive_path.lstrip("/"))

    if (
        parsed_url.netloc != "www.ncvvo.hr"
        or not archive_path.startswith("/wp-content/uploads/")
        or ".." in relative_path.parts
    ):
        raise ValueError(f"Unsupported NCVVO archive URL: {upstream_url}")

    local_url = f"{MIRROR_URL_PREFIX}/{quote(relative_path.as_posix(), safe='/')}"
    return MIRROR_ROOT.joinpath(*relative_path.parts), local_url


def mirror_zip(upstream_url: str) -> str:
    destination, local_url = mirror_target(upstream_url)
    if destination.is_file() and zipfile.is_zipfile(destination):
        return local_url

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f"{destination.name}.part")
    temporary.unlink(missing_ok=True)
    print(f"Downloading {upstream_url}", file=sys.stderr)

    try:
        request = Request(upstream_url, headers={"User-Agent": USER_AGENT})
        with urlopen(request, timeout=120) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output)

        if not zipfile.is_zipfile(temporary):
            raise ValueError(f"Downloaded file is not a valid ZIP archive: {upstream_url}")

        os.replace(temporary, destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise

    return local_url


def mirror_exams(exams: list[dict[str, Any]]) -> None:
    targets: dict[Path, str] = {}
    for exam in exams:
        destination, _ = mirror_target(exam["url"])
        previous_url = targets.setdefault(destination, exam["url"])
        if previous_url != exam["url"]:
            raise ValueError(
                f"Multiple NCVVO URLs map to {destination.relative_to(ROOT)}: "
                f"{previous_url}, {exam['url']}"
            )

    upstream_urls = list(dict.fromkeys(exam["url"] for exam in exams))
    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as executor:
        local_urls = dict(zip(upstream_urls, executor.map(mirror_zip, upstream_urls)))
        for exam in exams:
            upstream_url = exam["url"]
            exam["url"] = local_urls[upstream_url]
            exam["upstreamUrl"] = upstream_url


def build_index() -> dict[str, Any]:
    posts = fetch_json(API_URL)
    exams: list[dict[str, Any]] = []

    for post in posts:
        title = clean_label(post["title"]["rendered"])
        if "probni" in title.casefold():
            continue
        print(f"Fetching {title}", file=sys.stderr)
        exams.extend(collect_post_exams(post))

    exams.sort(
        key=lambda exam: (
            -exam["year"],
            TERM_ORDER[exam["term"]],
            exam["subject"],
            exam["level"] or "",
        )
    )

    mirror_exams(exams)

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "officialArchiveUrl": ARCHIVE_URL,
        "minYear": MIN_YEAR,
        "maxYear": MAX_YEAR,
        "exams": exams,
    }


def main() -> None:
    index = build_index()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(index, ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text(f"window.ASISTENT_ZA_MATURE_DATA={payload};\n", encoding="utf-8")
    print(f"Wrote {len(index['exams'])} exams to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
