#!/usr/bin/env python3
"""Generate WebP siblings for source-image PNGs.

The interactive solvers render full exam-page PNGs (1191x1684 @ 144 DPI) and
crop them with CSS. WebP cuts those payloads by ~65% with no visible loss on
crisp rendered text, so the server can transparently serve `page-N.webp`
instead of `page-N.png` when the browser advertises `Accept: image/webp`
(see server.js). The HTML/data files keep pointing at `.png`; nothing in the
parsers or front end changes.

This script is deterministic and idempotent: it only (re)encodes a PNG when its
`.webp` sibling is missing or older than the PNG, so re-running after a parse
is cheap. Run it after generating new page images:

    python3 scripts/optimize_images.py

Requires the `cwebp` binary (libwebp). Install with `apt install webp`.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

# Encode quality. 80 is the sweet spot for rendered exam pages: ~65% smaller
# than PNG with no visible degradation of text or thin lines.
QUALITY = 80

# Only scan directories that hold solver page images. Keep this list aligned
# with files/interactive/* so we never touch mirrored ZIPs or unrelated assets.
SCAN_ROOTS = ["files/interactive"]

SOURCE_SUFFIXES = {".png"}


def find_cwebp():
    cwebp = shutil.which("cwebp")
    if not cwebp:
        sys.exit(
            "cwebp not found. Install libwebp tools, e.g. `sudo apt install webp`."
        )
    return cwebp


def needs_encode(png_path: Path, webp_path: Path) -> bool:
    if not webp_path.exists():
        return True
    return webp_path.stat().st_mtime < png_path.stat().st_mtime


def main():
    repo_root = Path(__file__).resolve().parent.parent
    cwebp = find_cwebp()

    converted = 0
    skipped = 0
    saved_bytes = 0
    failed = []

    for root_name in SCAN_ROOTS:
        root = repo_root / root_name
        if not root.is_dir():
            continue
        for png_path in sorted(root.rglob("*")):
            if png_path.suffix.lower() not in SOURCE_SUFFIXES or not png_path.is_file():
                continue
            webp_path = png_path.with_suffix(".webp")
            if not needs_encode(png_path, webp_path):
                skipped += 1
                continue

            result = subprocess.run(
                [cwebp, "-quiet", "-q", str(QUALITY), str(png_path), "-o", str(webp_path)],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0 or not webp_path.exists():
                failed.append((png_path, result.stderr.strip()))
                continue

            saved_bytes += max(0, png_path.stat().st_size - webp_path.stat().st_size)
            converted += 1
            if converted % 200 == 0:
                print(f"  ... {converted} encoded", flush=True)

    rel = lambda p: os.path.relpath(p, repo_root)
    print(
        f"WebP optimize: {converted} encoded, {skipped} up to date, "
        f"{saved_bytes / (1024 * 1024):.1f} MB saved."
    )
    if failed:
        print(f"{len(failed)} failed:", file=sys.stderr)
        for path, err in failed[:20]:
            print(f"  {rel(path)}: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
