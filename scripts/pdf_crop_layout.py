"""Shared PDF crop geometry, independent of exam subject and task wording.

Builders identify page-local markers and select layout strategies. This module
finds table borders and assigns unambiguous rows; crop_utils handles subsequent
pixel trimming/metadata, and source-image-viewer.js displays the resulting crop.
"""

from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Protocol, Sequence

from PIL import Image

from pdf_utils import render_pdf_page_to_png


class PageGeometry(Protocol):
    width: float
    height: float


class RowMarker(Protocol):
    number: str | int
    y_min: float


@dataclass(frozen=True)
class HorizontalRule:
    x_min: float
    y_min: float
    x_max: float
    y_max: float


def longest_dark_run(row: bytes, threshold: int = 180) -> tuple[int, int, int]:
    best_start = 0
    best_length = 0
    current_start: int | None = None

    for index, value in enumerate(row):
        if value < threshold:
            if current_start is None:
                current_start = index
            continue

        if current_start is not None:
            length = index - current_start
            if length > best_length:
                best_start = current_start
                best_length = length
            current_start = None

    if current_start is not None:
        length = len(row) - current_start
        if length > best_length:
            best_start = current_start
            best_length = length

    return best_start, best_start + best_length, best_length


def detect_horizontal_rules(
    contents: bytes,
    pages: Mapping[int, PageGeometry],
    *,
    dpi: int = 144,
    minimum_width_ratio: float = 0.45,
) -> dict[int, list[HorizontalRule]]:
    rules_by_page: dict[int, list[HorizontalRule]] = {}
    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        pdf_path = temporary_root / "source.pdf"
        pdf_path.write_bytes(contents)

        for page_number, page in sorted(pages.items()):
            temporary_prefix = temporary_root / f"rules-{page_number}"
            render_pdf_page_to_png(
                pdf_path,
                temporary_prefix,
                page_number,
                dpi,
                required_message="pdftocairo is required to locate PDF table rows",
                failure_prefix="pdftocairo failed while locating solution rows",
            )

            image = Image.open(temporary_prefix.with_suffix(".png")).convert("L")
            width, height = image.size
            scale_x = width / page.width
            scale_y = height / page.height
            minimum_run = int(width * minimum_width_ratio)
            candidates: list[tuple[int, int, int]] = []
            pixels = image.load()
            for y in range(height):
                row = bytes(pixels[x, y] for x in range(width))
                x_min, x_max, run_length = longest_dark_run(row)
                if run_length >= minimum_run:
                    candidates.append((y, x_min, x_max))

            groups: list[list[tuple[int, int, int]]] = []
            for candidate in candidates:
                if groups and candidate[0] <= groups[-1][-1][0] + 1:
                    groups[-1].append(candidate)
                else:
                    groups.append([candidate])

            rules_by_page[page_number] = [
                HorizontalRule(
                    x_min=min(candidate[1] for candidate in group) / scale_x,
                    y_min=min(candidate[0] for candidate in group) / scale_y,
                    x_max=max(candidate[2] for candidate in group) / scale_x,
                    y_max=(max(candidate[0] for candidate in group) + 1) / scale_y,
                )
                for group in groups
            ]

    return rules_by_page


def solution_table_row_bounds(
    marker: RowMarker,
    column_markers: Sequence[RowMarker],
    rules: Sequence[HorizontalRule],
) -> tuple[float, float] | None:
    """Use enclosing table borders only when they identify one answer row.

    Missing separators and shared cells must not assign a preceding/following
    answer to this task. Those layouts retain the marker-based fallback.
    Include the border pixels rather than shaving padding off mathematical ink.
    """
    above = [rule for rule in rules if rule.y_max <= marker.y_min]
    below = [rule for rule in rules if rule.y_min > marker.y_min]
    if not above or not below:
        return None
    top = max(above, key=lambda rule: rule.y_max)
    bottom = min(below, key=lambda rule: rule.y_min)
    occupants = [
        item for item in column_markers
        if top.y_max <= item.y_min < bottom.y_min
    ]
    if len(occupants) != 1 or occupants[0].number != marker.number:
        return None
    return top.y_min, bottom.y_max
