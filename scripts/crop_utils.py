"""Shared pixel-level crop helpers for generated PDF page images."""

from __future__ import annotations

import io
from typing import Any

from PIL import Image, ImageStat

PANEL_SHADE_BYTES = tuple(bytes([value]) for value in range(219, 226))
INTERNAL_GAP_THRESHOLD = 248
INTERNAL_GAP_MIN_HEIGHT = 120
INTERNAL_GAP_MIN_WIDTH_RATIO = 0.18
INTERNAL_GAP_KEEP_HEIGHT = 36


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


def has_long_horizontal_rule(
    row: bytes,
    *,
    threshold: int,
    minimum_width: int,
    gap_tolerance: int = 3,
) -> bool:
    longest_run = 0
    current_run = 0
    pending_gap = 0
    for value in row:
        if value < threshold:
            current_run += pending_gap + 1
            pending_gap = 0
        elif current_run:
            pending_gap += 1
            if pending_gap > gap_tolerance:
                longest_run = max(longest_run, current_run)
                current_run = 0
                pending_gap = 0

    longest_run = max(longest_run, current_run)
    return longest_run >= minimum_width


def right_strip_contains_task_content(
    region: Image.Image,
    strip_x_min: int,
    start_y: int,
    *,
    end_y: int | None = None,
    threshold: int = 190,
) -> bool:
    width, height = region.size
    if width - strip_x_min < 20 or start_y >= height - 40:
        return False

    x_min = min(width - 1, strip_x_min + 4)
    x_max = max(x_min + 1, width - 4)
    y_min = max(0, start_y)
    # Ignore the bottom footer/barcode area; it can legitimately live inside the
    # answer frame but is not part of the task body.
    y_max = min(height, int(height * 0.88), end_y or height)
    if y_max - y_min < 40:
        return False

    strip = region.crop((x_min, y_min, x_max, y_max))
    strip_width, strip_height = strip.size
    data = strip.tobytes()
    row_dark_minimum = max(4, int(strip_width * 0.025))
    dark_rows = 0
    dark_pixels = 0
    for row_index in range(strip_height):
        offset = row_index * strip_width
        row = data[offset : offset + strip_width]
        shaded_pixels = sum(205 <= value <= 240 for value in row)
        if shaded_pixels / strip_width >= 0.25:
            continue
        row_dark_pixels = sum(value < threshold for value in row)
        dark_pixels += row_dark_pixels
        if row_dark_pixels >= row_dark_minimum:
            dark_rows += 1

    dark_ratio = dark_pixels / len(data)
    minimum_dark_rows = max(24, int(strip_height * 0.06))
    return dark_ratio >= 0.008 and dark_rows >= minimum_dark_rows


def trim_shaded_answer_strip(
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
    if width < 420 or height < 40:
        return x_min, y_min, x_max, y_max

    region = image.crop((x_min, y_min, x_max, y_max)).convert("L")
    data = region.tobytes()
    shade_threshold = 245
    right_band_widths = sorted(
        {
            max(20, int(width * ratio))
            for ratio in (
                0.04,
                0.07,
                0.12,
                0.18,
                0.3,
                0.5,
            )
        }
    )

    minimum_block_height = max(30, min(100, int(height * 0.12)))
    panel_rows: list[int] = []
    for row_index in range(height):
        offset = row_index * width
        for right_band_width in right_band_widths:
            segment = data[offset + width - right_band_width : offset + width]
            dominant_shade_count = max(
                segment.count(value) for value in PANEL_SHADE_BYTES
            )
            if dominant_shade_count / right_band_width >= 0.2:
                panel_rows.append(row_index)
                break

    answer_blocks = [
        group
        for group in grouped_indices(panel_rows)
        if group[1] - group[0] + 1 >= minimum_block_height
    ]
    for block_y_min, block_y_max in answer_blocks:
        block_height = block_y_max - block_y_min + 1
        minimum_column_shade = int(block_height * 0.55)
        shaded_columns: list[int] = []
        for column_index in range(int(width * 0.45), width):
            shaded_count = 0
            for row_index in range(block_y_min, block_y_max + 1):
                if data[row_index * width + column_index] < shade_threshold:
                    shaded_count += 1
            if shaded_count >= minimum_column_shade:
                shaded_columns.append(column_index)

        column_groups = grouped_indices(shaded_columns)
        merged_column_groups: list[tuple[int, int]] = []
        maximum_checkbox_gap = max(36, int(width * 0.04))
        for group in column_groups:
            previous_width = (
                merged_column_groups[-1][1] - merged_column_groups[-1][0] + 1
                if merged_column_groups
                else 0
            )
            if (
                merged_column_groups
                and group[0] - merged_column_groups[-1][1] - 1
                <= maximum_checkbox_gap
                and previous_width <= width * 0.22
            ):
                merged_column_groups[-1] = (
                    merged_column_groups[-1][0],
                    group[1],
                )
            else:
                merged_column_groups.append(group)

        edge_groups = [
            group
            for group in merged_column_groups
            if group[1] >= width - max(35, int(width * 0.13))
        ]
        if not edge_groups:
            continue

        strip_group = edge_groups[-1]
        strip_x_min = strip_group[0]
        shaded_strip_width = strip_group[1] - strip_group[0] + 1
        removable_width = width - strip_x_min
        if not width * 0.055 <= shaded_strip_width <= width * 0.45:
            continue
        if removable_width > width * 0.52:
            continue

        strip = region.crop(
            (strip_x_min, block_y_min, strip_group[1] + 1, block_y_max + 1)
        )
        strip_mean = ImageStat.Stat(strip).mean[0]
        strip_data = strip.tobytes()
        strip_histogram = strip.histogram()
        dominant_shade_ratio = (
            max(strip_histogram[205:241]) / len(strip_data)
        )
        shaded_pixel_ratio = (
            sum(value < shade_threshold for value in strip_data) / len(strip_data)
        )
        main = region.crop(
            (0, block_y_min, max(1, strip_x_min), block_y_max + 1)
        )
        main_mean = ImageStat.Stat(main).mean[0]
        strip_width = strip.width
        densely_shaded_rows = 0
        for row_index in range(strip.height):
            offset = row_index * strip_width
            row = strip_data[offset : offset + strip_width]
            if (
                sum(value < shade_threshold for value in row) / strip_width
                >= 0.55
            ):
                densely_shaded_rows += 1
        shaded_row_ratio = densely_shaded_rows / strip.height
        if (
            main_mean < 170
            or not 180 <= strip_mean <= 240
            or dominant_shade_ratio < 0.25
            or shaded_pixel_ratio < 0.5
            or shaded_row_ratio < 0.45
        ):
            continue

        rule_x_min = 0
        rule_x_max = strip_x_min + 1
        rule_width = rule_x_max - rule_x_min
        minimum_rule_ink = int(rule_width * 0.7)
        rule_rows: list[int] = []
        for row_index in range(max(block_y_min + 20, block_y_max - 20), height):
            offset = row_index * width
            row = data[offset + rule_x_min : offset + rule_x_max]
            if has_long_horizontal_rule(
                row,
                threshold=threshold,
                minimum_width=minimum_rule_ink,
            ):
                rule_rows.append(row_index)

        bottom_rule = next(iter(grouped_indices(rule_rows)), None)
        trimmed_y_max = y_min + bottom_rule[0] if bottom_rule else y_max
        if trimmed_y_max - y_min < 60:
            trimmed_y_max = y_max

        if right_strip_contains_task_content(
            region,
            strip_x_min,
            block_y_max + 8,
            end_y=trimmed_y_max - y_min,
            threshold=threshold,
        ):
            continue

        return x_min, y_min, x_min + strip_x_min, trimmed_y_max

    return x_min, y_min, x_max, y_max


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
    if width < 420 or height < 40:
        return x_min, y_min, x_max, y_max

    shaded_trim = trim_shaded_answer_strip(
        image,
        x_min,
        y_min,
        x_max,
        y_max,
        threshold=threshold,
    )
    if shaded_trim != (x_min, y_min, x_max, y_max):
        return shaded_trim

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
        return trim_shaded_answer_strip(
            image,
            x_min,
            y_min,
            x_max,
            y_max,
            threshold=threshold,
        )

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
        return trim_shaded_answer_strip(
            image,
            x_min,
            y_min,
            x_max,
            y_max,
            threshold=threshold,
        )

    strip_mean = ImageStat.Stat(region.crop((strip_x_min, 0, strip_x_max, sample_height))).mean[0]
    main_mean = ImageStat.Stat(region.crop((0, 0, separator[0], sample_height))).mean[0]
    if strip_mean > 246 or main_mean - strip_mean < 6:
        return trim_shaded_answer_strip(
            image,
            x_min,
            y_min,
            x_max,
            y_max,
            threshold=threshold,
        )

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
        if has_long_horizontal_rule(
            row,
            threshold=threshold,
            minimum_width=minimum_rule_ink,
        ):
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

    if right_strip_contains_task_content(
        region,
        strip_x_min,
        sample_height,
        threshold=threshold,
    ):
        return x_min, y_min, x_max, y_max

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


def trim_crop_horizontal_whitespace(
    image: Image.Image,
    x_min: int,
    y_min: int,
    x_max: int,
    y_max: int,
    *,
    padding: int = 6,
    min_trim: int = 8,
    threshold: int = 248,
    min_content_ratio: float = 0.005,
) -> tuple[int, int, int, int]:
    width = x_max - x_min
    height = y_max - y_min
    if width <= 0 or height <= 0:
        return x_min, y_min, x_max, y_max

    region = image.crop((x_min, y_min, x_max, y_max)).convert("L")
    data = region.tobytes()
    min_content_pixels = max(3, int(height * min_content_ratio))
    content_columns: list[int] = []
    for column_index in range(width):
        content_pixels = sum(
            data[row_index * width + column_index] < threshold
            for row_index in range(height)
        )
        if content_pixels >= min_content_pixels:
            content_columns.append(column_index)

    if not content_columns:
        return x_min, y_min, x_max, y_max

    candidate_x_min = max(x_min, x_min + content_columns[0] - padding)
    candidate_x_max = min(x_max, x_min + content_columns[-1] + 1 + padding)
    if candidate_x_min - x_min < min_trim:
        candidate_x_min = x_min
    if x_max - candidate_x_max < min_trim:
        candidate_x_max = x_max
    if candidate_x_max <= candidate_x_min:
        return x_min, y_min, x_max, y_max

    return candidate_x_min, y_min, candidate_x_max, y_max


def compact_vertical_whitespace_segments(
    image: Image.Image,
    x_min: int,
    y_min: int,
    x_max: int,
    y_max: int,
    *,
    threshold: int = INTERNAL_GAP_THRESHOLD,
    minimum_gap_height: int = INTERNAL_GAP_MIN_HEIGHT,
    minimum_gap_width_ratio: float = INTERNAL_GAP_MIN_WIDTH_RATIO,
    keep_gap_height: int = INTERNAL_GAP_KEEP_HEIGHT,
    scan_margin: int = 12,
    maximum_dark_ratio: float = 0.0015,
) -> list[tuple[int, int, int, int]]:
    """Split a crop around large, nearly white internal horizontal bands."""

    width = x_max - x_min
    height = y_max - y_min
    if width <= 0 or height <= 0:
        return [(x_min, y_min, x_max, y_max)]

    minimum_gap = max(
        minimum_gap_height,
        int(width * minimum_gap_width_ratio),
    )
    if height < minimum_gap * 2:
        return [(x_min, y_min, x_max, y_max)]

    margin = min(scan_margin, max(0, (width - 1) // 4))
    scan_x_min = x_min + margin
    scan_x_max = x_max - margin
    if scan_x_max <= scan_x_min:
        return [(x_min, y_min, x_max, y_max)]

    region = image.crop((scan_x_min, y_min, scan_x_max, y_max)).convert("L")
    scan_width, scan_height = region.size
    data = region.tobytes()
    maximum_dark_pixels = max(1, int(scan_width * maximum_dark_ratio))
    blank_rows: list[int] = []
    for row_index in range(scan_height):
        offset = row_index * scan_width
        row = data[offset : offset + scan_width]
        if sum(value < threshold for value in row) <= maximum_dark_pixels:
            blank_rows.append(row_index)

    candidate_gaps = [
        (start, end + 1)
        for start, end in grouped_indices(blank_rows)
        if end - start + 1 >= minimum_gap
        and start > 0
        and end < scan_height - 1
    ]
    if not candidate_gaps:
        return [(x_min, y_min, x_max, y_max)]

    segments: list[tuple[int, int, int, int]] = []
    segment_y_min = y_min
    keep_before = keep_gap_height // 2
    keep_after = keep_gap_height - keep_before
    for gap_start, gap_end in candidate_gaps:
        segment_y_max = min(y_max, y_min + gap_start + keep_before)
        next_y_min = max(y_min, y_min + gap_end - keep_after)
        if segment_y_max > segment_y_min:
            segments.append((x_min, segment_y_min, x_max, segment_y_max))
        segment_y_min = max(segment_y_min, next_y_min)

    if segment_y_min < y_max:
        segments.append((x_min, segment_y_min, x_max, y_max))

    if len(segments) < 2:
        return [(x_min, y_min, x_max, y_max)]
    return segments


def source_image_metadata(
    image: Image.Image,
    *,
    url: str,
    image_width: int,
    image_height: int,
    crop_box: tuple[int, int, int, int],
    page: int | None = None,
    compact_internal_whitespace: bool = True,
) -> dict[str, Any]:
    x_min, y_min, x_max, y_max = crop_box
    metadata: dict[str, Any] = {
        "url": url,
        "width": image_width,
        "height": image_height,
        "crop": {
            "x": x_min,
            "y": y_min,
            "width": x_max - x_min,
            "height": y_max - y_min,
        },
    }
    if page is not None:
        metadata["page"] = page

    if compact_internal_whitespace:
        segments = compact_vertical_whitespace_segments(
            image,
            x_min,
            y_min,
            x_max,
            y_max,
        )
        if len(segments) > 1:
            metadata["segments"] = [
                {
                    "x": segment_x_min,
                    "y": segment_y_min,
                    "width": segment_x_max - segment_x_min,
                    "height": segment_y_max - segment_y_min,
                }
                for segment_x_min, segment_y_min, segment_x_max, segment_y_max in segments
            ]

    return metadata
