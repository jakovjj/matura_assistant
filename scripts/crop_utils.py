"""Shared pixel-level crop helpers for generated PDF page images."""

from __future__ import annotations

import io

from PIL import Image


def grayscale_image_from_png(contents: bytes) -> Image.Image:
    return Image.open(io.BytesIO(contents)).convert("L")


def trim_crop_bottom_whitespace(
    image: Image.Image,
    x_min: int,
    y_min: int,
    x_max: int,
    y_max: int,
    *,
    padding: int = 18,
    minimum_y_max: int | None = None,
    min_height: int = 48,
    min_trim: int = 24,
    threshold: int = 244,
    scan_margin: int = 10,
    min_dark_ratio: float = 0.004,
) -> tuple[int, int, int, int]:
    width = x_max - x_min
    height = y_max - y_min
    if width <= 0 or height <= 0:
        return x_min, y_min, x_max, y_max

    margin = min(scan_margin, max(0, (width - 1) // 4))
    scan_x_min = x_min + margin
    scan_x_max = x_max - margin
    if scan_x_max <= scan_x_min:
        return x_min, y_min, x_max, y_max

    region = image.crop((scan_x_min, y_min, scan_x_max, y_max))
    scan_width, scan_height = region.size
    data = region.tobytes()
    min_dark_pixels = max(7, int(scan_width * min_dark_ratio))

    last_content_row: int | None = None
    for row_index in range(scan_height - 1, -1, -1):
        offset = row_index * scan_width
        row = data[offset : offset + scan_width]
        if sum(value < threshold for value in row) >= min_dark_pixels:
            last_content_row = row_index
            break

    if last_content_row is None:
        return x_min, y_min, x_max, y_max

    candidate_y_max = y_min + last_content_row + 1 + padding
    floor_y_max = max(y_min + min_height, minimum_y_max or y_min)
    candidate_y_max = min(y_max, max(floor_y_max, candidate_y_max))
    if y_max - candidate_y_max < min_trim:
        return x_min, y_min, x_max, y_max

    return x_min, y_min, x_max, candidate_y_max
