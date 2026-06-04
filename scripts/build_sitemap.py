#!/usr/bin/env python3
"""Build sitemap.xml from the generated NCVVO exam archive index."""

from __future__ import annotations

import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlencode


ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "exams.js"
OUTPUT_FILE = ROOT / "sitemap.xml"
DATA_PREFIX = "window.ASISTENT_ZA_MATURE_DATA="
SITE_ORIGIN = "https://matura.com.hr"
SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9"
TERM_ALIASES = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
}


def load_archive() -> dict:
    source = DATA_FILE.read_text(encoding="utf-8").strip()
    if not source.startswith(DATA_PREFIX) or not source.endswith(";"):
        raise ValueError(f"{DATA_FILE} has an unsupported format")
    return json.loads(source[len(DATA_PREFIX) : -1])


def slug_part(value: object) -> str:
    normalized = unicodedata.normalize("NFD", str(value).lower()).replace("đ", "d")
    ascii_value = "".join(
        character for character in normalized if not unicodedata.combining(character)
    )
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", ascii_value))


def exam_id(exam: dict) -> str:
    term = TERM_ALIASES.get(exam["term"], exam["term"])
    return "-".join(
        (
            slug_part(exam["subject"]),
            str(exam["year"]),
            slug_part(term),
            slug_part(exam.get("level") or "bez-razine"),
        )
    )


def page_url(params: dict[str, str] | None = None) -> str:
    if not params:
        return f"{SITE_ORIGIN}/"
    return f"{SITE_ORIGIN}/?{urlencode(params)}"


def sitemap_urls(archive: dict) -> list[str]:
    exams = archive.get("exams")
    if not isinstance(exams, list):
        raise ValueError(f"{DATA_FILE} does not contain an exam list")

    urls = {page_url()}
    for subject in {exam["subject"] for exam in exams}:
        urls.add(page_url({"predmet": subject}))

    for exam in exams:
        urls.add(
            page_url(
                {
                    "predmet": exam["subject"],
                    "ispit": exam_id(exam),
                }
            )
        )

    return sorted(urls)


def write_sitemap(urls: list[str]) -> None:
    ET.register_namespace("", SITEMAP_NAMESPACE)
    root = ET.Element(f"{{{SITEMAP_NAMESPACE}}}urlset")
    for url in urls:
        entry = ET.SubElement(root, f"{{{SITEMAP_NAMESPACE}}}url")
        ET.SubElement(entry, f"{{{SITEMAP_NAMESPACE}}}loc").text = url

    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    tree.write(OUTPUT_FILE, encoding="utf-8", xml_declaration=True)


def main() -> None:
    urls = sitemap_urls(load_archive())
    write_sitemap(urls)
    print(f"Wrote {len(urls)} URLs to {OUTPUT_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
