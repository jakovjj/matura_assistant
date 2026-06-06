#!/usr/bin/env python3
"""Build sitemap.xml from the generated NCVVO exam archive index."""

from __future__ import annotations

import xml.etree.ElementTree as ET

from seo_urls import ROOT, exam_path, load_archive, site_url, subject_path


OUTPUT_FILE = ROOT / "sitemap.xml"
SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9"


def sitemap_urls(archive: dict) -> list[dict[str, str]]:
    exams = archive.get("exams")
    if not isinstance(exams, list):
        raise ValueError("data/exams.js does not contain an exam list")

    lastmod = str(archive.get("generatedAt") or "")[:10]
    urls = {site_url("/")}
    for subject in {exam["subject"] for exam in exams}:
        urls.add(site_url(subject_path(subject)))

    for exam in exams:
        urls.add(site_url(exam_path(exam)))

    return [{"loc": url, "lastmod": lastmod} for url in sorted(urls)]


def write_sitemap(urls: list[dict[str, str]] | list[str]) -> None:
    ET.register_namespace("", SITEMAP_NAMESPACE)
    root = ET.Element(f"{{{SITEMAP_NAMESPACE}}}urlset")
    for item in urls:
        entry_data = {"loc": item} if isinstance(item, str) else item
        entry = ET.SubElement(root, f"{{{SITEMAP_NAMESPACE}}}url")
        ET.SubElement(entry, f"{{{SITEMAP_NAMESPACE}}}loc").text = entry_data["loc"]
        if entry_data.get("lastmod"):
            ET.SubElement(entry, f"{{{SITEMAP_NAMESPACE}}}lastmod").text = entry_data["lastmod"]

    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    tree.write(OUTPUT_FILE, encoding="utf-8", xml_declaration=True)


def main() -> None:
    urls = sitemap_urls(load_archive())
    write_sitemap(urls)
    print(f"Wrote {len(urls)} URLs to {OUTPUT_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
