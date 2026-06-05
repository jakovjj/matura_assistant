"""Shared pixel-level crop helpers for generated PDF page images."""

from __future__ import annotations

import io

from PIL import Image, ImageStat


def grayscale_image_from_png(contents: bytes) -> Image.Image:
    return Image.open(io.BytesIO(contents)).convert("L")


def grouped_indices(indices: list[int]) -> list[tuple[int, int]]:
    groups: list[tuple[int, int]] = []
    for index in indices:
        if groups and index <= groups[-1][1] + 1:
            groups[-1] = (groups[-1][0], index)
        else:
            groups.append((index, index))
    return groups


def trim_legacy_answer_frame(
    image: Image.Image,
    x_min: int,
    y_min: int,
    x_max: int,
    y_max: int,
    *,
    threshold: int = 190,
) -> tuple[int, int, int, int]:
    width = x_max - x_min
    height = y_max - y_min
    if width < 420 or height < 130:
        return x_min, y_min, x_max, y_max

    region = image.crop((x_min, y_min, x_max, y_max))
    data = region.tobytes()
    sample_height = min(height, 320)
    minimum_column_ink = max(50, int(sample_height * 0.45))
    column_ink = [0] * width
    for row_index in range(sample_height):
        offset = row_index * width
        row = data[offset : offset + width]
        for column_index, value in enumerate(row):
            if value < threshold:
                column_ink[column_index] += 1

    vertical_groups = grouped_indices(
        [
            column_index
            for column_index, ink in enumerate(column_ink)
            if ink >= minimum_column_ink
        ]
    )
    right_groups = [
        group
        for group in vertical_groups
        if ((group[0] + group[1]) / 2) >= width * 0.62
    ]
    if len(right_groups) < 2:
        return x_min, y_min, x_max, y_max

    separator = right_groups[-2]
    outer_border = right_groups[-1]
    separator_center = (separator[0] + separator[1]) / 2
    outer_center = (outer_border[0] + outer_border[1]) / 2
    strip_width = outer_center - separator_center
    if not width * 0.055 <= strip_width <= width * 0.2:
        return x_min, y_min, x_max, y_max
    if not width * 0.82 <= outer_center <= width * 0.99:
        return x_min, y_min, x_max, y_max

    strip_x_min = separator[1] + 1
    strip_x_max = outer_border[0]
    if strip_x_max <= strip_x_min:
        return x_min, y_min, x_max, y_max

    strip_mean = ImageStat.Stat(region.crop((strip_x_min, 0, strip_x_max, sample_height))).mean[0]
    main_mean = ImageStat.Stat(region.crop((0, 0, separator[0], sample_height))).mean[0]
    if strip_mean > 246 or main_mean - strip_mean < 6:
        return x_min, y_min, x_max, y_max

    left_groups = [
        group
        for group in vertical_groups
        if ((group[0] + group[1]) / 2) <= width * 0.3
    ]
    left_border = left_groups[-1] if left_groups else (0, 0)
    rule_x_min = int((left_border[0] + left_border[1]) / 2)
    rule_x_max = int(outer_center) + 1
    rule_width = rule_x_max - rule_x_min
    minimum_rule_ink = int(rule_width * 0.7)
    rule_rows: list[int] = []
    for row_index in range(max(60, int(height * 0.04)), height):
        offset = row_index * width
        row = data[offset + rule_x_min : offset + rule_x_max]
        if sum(value < threshold for value in row) >= minimum_rule_ink:
            rule_rows.append(row_index)

    bottom_rule = next(
        (
            group
            for group in grouped_indices(rule_rows)
            if group[0] >= 80
        ),
        None,
    )
    trimmed_y_max = y_min + bottom_rule[0] if bottom_rule else y_max
    if trimmed_y_max - y_min < 60:
        trimmed_y_max = y_max

    return x_min, y_min, x_min + separator[0], trimmed_y_max


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
    detect_legacy_answer_frame: bool = True,
) -> tuple[int, int, int, int]:
    if detect_legacy_answer_frame:
        x_min, y_min, x_max, y_max = trim_legacy_answer_frame(
            image,
            x_min,
            y_min,
            x_max,
            y_max,
        )
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
