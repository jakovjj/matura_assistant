#!/usr/bin/env python3
"""Generate crawlable app-shell pages for subject and exam URLs."""

from __future__ import annotations

import html
import json
import shutil
from collections import defaultdict
from pathlib import Path

from seo_urls import (
    ROOT,
    SITE_ORIGIN,
    compare_exams,
    exam_path,
    format_term,
    load_archive,
    normalized_exam,
    site_url,
    subject_path,
)


INDEX_FILE = ROOT / "index.html"
GENERATED_DIRS = [ROOT / "predmeti", ROOT / "ispiti"]
SITE_NAME = "Asistent za Mature"
HOME_DESCRIPTION = (
    "Neslužbena arhiva prethodnih ispita državne mature s interaktivnim "
    "vježbama i lokalnim preslikama NCVVO paketa."
)


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def website_schema() -> dict:
    return {
        "@type": "WebSite",
        "@id": f"{SITE_ORIGIN}/#website",
        "url": f"{SITE_ORIGIN}/",
        "name": SITE_NAME,
        "description": HOME_DESCRIPTION,
        "inLanguage": "hr-HR",
        "disambiguatingDescription": "Neslužbeni projekt koji nije povezan s NCVVO-om.",
    }


def breadcrumb_schema(items: list[tuple[str, str]]) -> dict:
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": index + 1,
                "name": name,
                "item": url,
            }
            for index, (name, url) in enumerate(items)
        ],
    }


def structured_data(page_schema: dict) -> str:
    return json.dumps(
        {
            "@context": "https://schema.org",
            "@graph": [website_schema(), page_schema],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def app_body() -> str:
    source = INDEX_FILE.read_text(encoding="utf-8")
    body_start = source.index("  <body>")
    return source[body_start:]


def app_shell_page(*, title: str, description: str, canonical_url: str, page_schema: dict) -> str:
    full_title = f"{title} | {SITE_NAME}"
    return f"""<!doctype html>
<html lang="hr" class="is-app-subpage">
  <head>
    <meta charset="UTF-8" />
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="{esc(description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="theme-color" content="#14345b" />
    <meta property="og:locale" content="hr_HR" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="{SITE_NAME}" />
    <meta property="og:title" content="{esc(full_title)}" />
    <meta property="og:description" content="{esc(description)}" />
    <meta property="og:url" content="{esc(canonical_url)}" />
    <meta property="og:image" content="{SITE_ORIGIN}/asistent_za_maturu.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1045" />
    <meta property="og:image:height" content="1045" />
    <meta property="og:image:alt" content="Asistent za Mature" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="{esc(full_title)}" />
    <meta name="twitter:description" content="{esc(description)}" />
    <meta name="twitter:image" content="{SITE_ORIGIN}/asistent_za_maturu.png" />
    <title>{esc(full_title)}</title>
    <link rel="canonical" href="{esc(canonical_url)}" />
    <link rel="sitemap" type="application/xml" href="{SITE_ORIGIN}/sitemap.xml" />
    <link rel="icon" type="image/webp" href="./assets/asistent_za_maturu.webp" />
    <link rel="stylesheet" href="./styles.css?v=20260608-footer-coffee" />
    <script id="seo-structured-data" type="application/ld+json">{structured_data(page_schema)}</script>
    <script>
      document.documentElement.classList.add("is-app-subpage");
    </script>
    <script src="./analytics.js?v=20260605-clarity-force-2"></script>
  </head>
{app_body()}
"""


def subject_page(subject: str, exams: list[dict], archive: dict) -> str:
    canonical_url = site_url(subject_path(subject))
    title = f"{subject} državna matura: ispiti i vježba"
    description = (
        f"{subject}: prethodni ispiti državne mature od 2013. do 2025., "
        "službeni NCVVO paketi za preuzimanje i dostupne interaktivne vježbe."
    )
    sorted_exams = sorted(exams, key=compare_exams)
    page_schema = {
        "@type": ["CollectionPage", "LearningResource"],
        "@id": f"{canonical_url}#webpage",
        "url": canonical_url,
        "name": title,
        "description": description,
        "isPartOf": {"@id": f"{SITE_ORIGIN}/#website"},
        "inLanguage": "hr-HR",
        "dateModified": archive.get("generatedAt"),
        "educationalLevel": "Srednja škola",
        "educationalUse": ["vježba", "samoprocjena"],
        "learningResourceType": "Arhiva ispita državne mature",
        "about": {"@type": "Thing", "name": subject},
        "isBasedOn": archive.get("officialArchiveUrl"),
        "breadcrumb": breadcrumb_schema(
            [("Asistent za Mature", site_url("/")), (subject, canonical_url)]
        ),
        "mainEntity": {
            "@type": "ItemList",
            "name": f"{subject} - arhiva ispita",
            "numberOfItems": len(sorted_exams),
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": index + 1,
                    "name": exam_name(exam),
                    "url": site_url(exam_path(exam)),
                }
                for index, exam in enumerate(sorted_exams)
            ],
        },
    }
    return app_shell_page(
        title=title,
        description=description,
        canonical_url=canonical_url,
        page_schema=page_schema,
    )


def exam_name(exam: dict) -> str:
    level = f", {exam['level']} razina" if exam.get("level") else ""
    return f"{exam['subject']} {exam['year']}. - {format_term(exam['term'])}{level}"


def exam_page(exam: dict, archive: dict) -> str:
    canonical_url = site_url(exam_path(exam))
    name = exam_name(exam)
    title = f"{name} - državna matura"
    level = f", {exam['level']} razina" if exam.get("level") else ""
    description = (
        f"{exam['subject']} {exam['year']}., {exam['term']}{level}. "
        "Preuzmi službeni NCVVO paket i otvori dostupne interaktivne cjeline za vježbu ili simulaciju mature."
    )
    page_schema = {
        "@type": "WebPage",
        "@id": f"{canonical_url}#webpage",
        "url": canonical_url,
        "name": name,
        "description": description,
        "isPartOf": {"@id": f"{SITE_ORIGIN}/#website"},
        "inLanguage": "hr-HR",
        "dateModified": archive.get("generatedAt"),
        "breadcrumb": breadcrumb_schema(
            [
                ("Asistent za Mature", site_url("/")),
                (exam["subject"], site_url(subject_path(exam["subject"]))),
                (name, canonical_url),
            ]
        ),
        "mainEntity": {
            "@type": "LearningResource",
            "name": name,
            "description": description,
            "inLanguage": "hr-HR",
            "educationalLevel": "Srednja škola",
            "educationalUse": ["vježba", "samoprocjena"],
            "learningResourceType": "Ispit državne mature",
            "about": {"@type": "Thing", "name": exam["subject"]},
            "isBasedOn": exam.get("upstreamUrl")
            or exam.get("sourceUrl")
            or archive.get("officialArchiveUrl"),
            "encoding": {
                "@type": "MediaObject",
                "contentUrl": site_url(str(exam["url"]).removeprefix("./")),
                "encodingFormat": "application/zip",
            },
        },
    }
    return app_shell_page(
        title=title,
        description=description,
        canonical_url=canonical_url,
        page_schema=page_schema,
    )


def write_page(path: str, content: str) -> None:
    page_path = ROOT / path.lstrip("/") / "index.html"
    page_path.parent.mkdir(parents=True, exist_ok=True)
    page_path.write_text(content, encoding="utf-8")


def build_seo_pages(archive: dict | None = None) -> int:
    archive = archive or load_archive()
    exams = [normalized_exam(exam) for exam in archive.get("exams", [])]
    if not exams:
        raise ValueError("data/exams.js does not contain exams")

    for directory in GENERATED_DIRS:
        if directory.exists():
            shutil.rmtree(directory)

    by_subject: dict[str, list[dict]] = defaultdict(list)
    for exam in exams:
        by_subject[exam["subject"]].append(exam)

    count = 0
    for subject, subject_exams in by_subject.items():
        write_page(subject_path(subject), subject_page(subject, subject_exams, archive))
        count += 1

    for exam in exams:
        write_page(exam_path(exam), exam_page(exam, archive))
        count += 1

    return count


def main() -> None:
    count = build_seo_pages()
    print(f"Wrote {count} app-shell SEO pages to predmeti/ and ispiti/")


if __name__ == "__main__":
    main()
