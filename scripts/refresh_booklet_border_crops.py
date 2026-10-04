#!/usr/bin/env python3
"""Refresh existing crop metadata without rerendering the official PDF images."""

import json
from functools import lru_cache
from pathlib import Path
from urllib.parse import unquote

from PIL import Image

from crop_utils import left_booklet_border_end, trim_left_booklet_border
from generated_data_revision import update_data_revision

ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=8)
def load_page(url):
    path = (ROOT / unquote(url.removeprefix("./"))).resolve()
    if not path.is_relative_to(ROOT / "files" / "interactive") or not path.is_file():
        return None, None
    with Image.open(path) as source:
        image = source.convert("L")
    return image, left_booklet_border_end(image)


def refresh(value):
    changed = 0
    if isinstance(value, dict):
        crop = value.get("crop")
        if isinstance(crop, dict) and isinstance(value.get("url"), str):
            image, border = load_page(value["url"])
            if image is not None:
                box = (crop["x"], crop["y"], crop["x"] + crop["width"], crop["y"] + crop["height"])
                new = trim_left_booklet_border(image, box, border)
                shift = new[0] - box[0]
                if shift:
                    crop["x"] += shift
                    crop["width"] -= shift
                    for segment in value.get("segments", []):
                        segment["x"] += shift
                        segment["width"] -= shift
                    changed += 1
        changed += sum(refresh(child) for child in value.values())
    elif isinstance(value, list):
        changed += sum(refresh(child) for child in value)
    return changed


def main():
    for path in sorted((ROOT / "data").glob("*.js")):
        text = path.read_text()
        prefix, separator, body = text.partition("=")
        if not separator:
            continue
        try:
            data = json.loads(body.rstrip(";\n"))
        except json.JSONDecodeError:
            continue
        changed = refresh(data)
        if changed:
            serialized = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
            path.write_text(prefix + "=" + serialized + ";\n")
            update_data_revision(ROOT, path, serialized)
            print(f"{path.name}: {changed} crops", flush=True)


if __name__ == "__main__":
    main()
