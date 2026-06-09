"""Build cropped official-solution images for manually reviewed open tasks."""

from __future__ import annotations

import math
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from crop_utils import (
    grayscale_image_from_png,
    source_image_metadata,
    trim_crop_bottom_whitespace,
)
from pdf_utils import png_dimensions, render_pdf_page_to_png


@dataclass(frozen=True)
class SolutionMarker:
    number: str
    page: Any
    y_min: float


@dataclass(frozen=True)
class SolutionCrop:
    page: Any
    x_min: float
    y_min: float
    x_max: float
    y_max: float


def build_manual_solution_images(
    key_documents: list[bytes],
    destination: Path,
    identifier: str,
    url_prefix: str,
    open_answers: dict[str, dict[str, Any]],
    *,
    pdf_bbox_pages: Callable[[bytes], list[Any]],
    parse_question_token: Callable[[str], str],
    question_sort_key: Callable[[str], tuple[int, int]],
    render_dpi: int,
    required_message: str,
    wanted_questions: set[str] | None = None,
    group_aware: bool = False,
) -> dict[str, list[dict[str, Any]]]:
    wanted_questions = (
        set(wanted_questions) if wanted_questions is not None else set(open_answers)
    )
    if not wanted_questions or not key_documents:
        return {}

    selected = max(
        (
            (
                contents,
                pages,
                _find_solution_markers(
                    pages,
                    wanted_questions,
                    open_answers,
                    parse_question_token,
                    question_sort_key,
                ),
            )
            for contents in key_documents
            for pages in [pdf_bbox_pages(contents)]
        ),
        key=lambda item: len(item[2]),
    )
    solution_contents, pages, markers = selected
    # Questions that carry an official model answer must be located; image-only
    # subitems (such as drawing tasks) may legitimately have no detectable label.
    required = (set(open_answers) & wanted_questions)
    missing = sorted(required - markers.keys(), key=question_sort_key)
    if missing:
        raise ValueError(
            "Could not locate official solution crops for open questions: "
            + ", ".join(missing)
        )

    destination.mkdir(parents=True, exist_ok=True)
    solution_pdf = destination / "solutions.pdf"
    _write_if_changed(solution_pdf, solution_contents)
    all_markers = (
        _collect_all_markers(pages, parse_question_token) if group_aware else None
    )
    crops = _solution_crops(
        pages, markers, all_markers, open_answers, question_sort_key
    )
    images = _render_solution_pages(
        solution_pdf,
        destination,
        identifier,
        url_prefix,
        crops,
        render_dpi=render_dpi,
        required_message=required_message,
    )
    _remove_unexpected_solution_pages(destination, images)
    return images


def attach_manual_solution_images(
    tasks: list[dict[str, Any]],
    solution_images: dict[str, list[dict[str, Any]]],
) -> None:
    for task in tasks:
        for question in task.get("questions", []):
            if question.get("type") != "open":
                continue
            images = solution_images.get(str(question["number"])) or []
            if images:
                question["solutionImages"] = images


def _iter_numbered_lines(
    pages: list[Any],
    parse_question_token: Callable[[str], str],
):
    ordered_lines = [
        (page, line)
        for page in pages
        for line in sorted(page.lines, key=lambda item: (item.y_min, item.x_min))
    ]
    for page, line in ordered_lines:
        number_text = line.first_word.strip()
        match = re.fullmatch(
            r"(?P<number>\d{1,3}(?:[\.,]\d{1,2})?)[\.\"”]+",
            number_text,
        )
        if not match and line.x_min <= page.width * 0.20:
            match = re.fullmatch(r"(?P<number>\d{1,3})", number_text)
        if not match:
            continue
        try:
            number = parse_question_token(match.group("number"))
        except (TypeError, ValueError):
            continue
        yield number, page, line


def _collect_all_markers(
    pages: list[Any],
    parse_question_token: Callable[[str], str],
) -> dict[str, SolutionMarker]:
    """Every numbered row in the key, including unscored parent headings.

    Parent headings (such as ``28.`` above ``28.1``) and sibling rows act as
    vertical boundaries so a question's crop never bleeds into a neighbour.
    """
    markers: dict[str, SolutionMarker] = {}
    for number, page, line in _iter_numbered_lines(pages, parse_question_token):
        markers.setdefault(
            number, SolutionMarker(number=number, page=page, y_min=line.y_min)
        )
    return markers


def _find_solution_markers(
    pages: list[Any],
    wanted_questions: set[str],
    open_answers: dict[str, dict[str, Any]],
    parse_question_token: Callable[[str], str],
    question_sort_key: Callable[[str], tuple[int, int]],
) -> dict[str, SolutionMarker]:
    direct: dict[str, list[SolutionMarker]] = {}
    ordered_lines = [
        (page, line)
        for page in pages
        for line in sorted(page.lines, key=lambda item: (item.y_min, item.x_min))
    ]

    for number, page, line in _iter_numbered_lines(pages, parse_question_token):
        if number in wanted_questions:
            direct.setdefault(number, []).append(
                SolutionMarker(number=number, page=page, y_min=line.y_min)
            )

    markers = {
        number: candidates[0]
        for number, candidates in direct.items()
    }
    ordered_questions = sorted(wanted_questions, key=question_sort_key)
    for index, number in enumerate(ordered_questions):
        if number in markers:
            continue
        previous = next(
            (markers[item] for item in reversed(ordered_questions[:index]) if item in markers),
            None,
        )
        following = next(
            (markers[item] for item in ordered_questions[index + 1 :] if item in markers),
            None,
        )
        marker = _find_marker_from_answer_text(
            ordered_lines,
            number,
            str(open_answers.get(number, {}).get("modelAnswer") or ""),
            previous,
            following,
        )
        if marker:
            markers[number] = marker

    return markers


def _find_marker_from_answer_text(
    ordered_lines: list[tuple[Any, Any]],
    number: str,
    answer_text: str,
    previous: SolutionMarker | None,
    following: SolutionMarker | None,
) -> SolutionMarker | None:
    candidates = [
        _normalize_line(line)
        for line in answer_text.splitlines()
        if len(_normalize_line(line)) >= 18
        and not re.match(r"^\d+\s+bod", _normalize_line(line), flags=re.IGNORECASE)
    ]
    if not candidates:
        return None

    previous_position = _marker_position(previous) if previous else None
    following_position = _marker_position(following) if following else None
    for candidate in candidates:
        for page, line in ordered_lines:
            position = (page.number, line.y_min)
            if previous_position and position <= previous_position:
                continue
            if following_position and position >= following_position:
                continue
            if _normalize_line(line.text) == candidate:
                return SolutionMarker(number=number, page=page, y_min=line.y_min)
    return None


def _solution_crops(
    pages: list[Any],
    markers: dict[str, SolutionMarker],
    all_markers: dict[str, SolutionMarker] | None,
    open_answers: dict[str, dict[str, Any]],
    question_sort_key: Callable[[str], tuple[int, int]],
) -> dict[str, list[SolutionCrop]]:
    pages_by_number = {page.number: page for page in pages}
    ordered_lines = [
        (page, line)
        for page in pages
        for line in sorted(page.lines, key=lambda item: (item.y_min, item.x_min))
    ]
    wanted = set(markers)
    # Without group awareness, boundaries are the wanted markers themselves,
    # which reproduces the original next-open-question cropping exactly.
    boundary_markers = all_markers if all_markers is not None else markers
    ordered_boundary = sorted(boundary_markers, key=question_sort_key)
    boundary_position = {
        number: (boundary_markers[number].page.number, boundary_markers[number].y_min)
        for number in boundary_markers
    }
    crops: dict[str, list[SolutionCrop]] = {}

    for number in sorted(markers, key=question_sort_key):
        marker = markers[number]
        own_position = (marker.page.number, marker.y_min)

        # The crop ends at the next boundary row, so a question never reaches
        # into the following question's (or heading's) cell.
        next_marker = None
        for candidate in ordered_boundary:
            if boundary_position[candidate] > own_position:
                next_marker = boundary_markers[candidate]
                break

        # The first subitem of a group absorbs its unscored parent heading
        # row, because the shared example/solution image sits in that cell
        # while the subitem label is centred lower inside it.
        start_marker = marker
        parent = _parent_number(number)
        if (
            all_markers is not None
            and parent
            and parent in all_markers
            and parent not in wanted
            and boundary_position[parent] < own_position
            and not any(
                boundary_position[parent] < boundary_position[candidate] < own_position
                for candidate in ordered_boundary
            )
        ):
            start_marker = all_markers[parent]

        answer_end = None if next_marker else _find_answer_end(
            ordered_lines,
            marker,
            str(open_answers.get(number, {}).get("modelAnswer") or ""),
        )
        end_page_number = (
            next_marker.page.number
            if next_marker
            else answer_end[0].number
            if answer_end
            else pages[-1].number
        )
        question_crops: list[SolutionCrop] = []

        for page_number in range(start_marker.page.number, end_page_number + 1):
            page = pages_by_number[page_number]
            y_min = start_marker.y_min - 6 if page_number == start_marker.page.number else 36
            y_max = (
                next_marker.y_min - 6
                if next_marker and page_number == next_marker.page.number
                else answer_end[1] + 12
                if answer_end and page_number == answer_end[0].number
                else page.height - 36
            )
            if y_max <= y_min:
                continue
            question_crops.append(
                SolutionCrop(
                    page=page,
                    x_min=30,
                    y_min=max(0, y_min),
                    x_max=page.width - 30,
                    y_max=min(page.height, y_max),
                )
            )

        crops[number] = question_crops

    return crops


def _parent_number(number: str) -> str | None:
    text = str(number)
    if "." in text:
        return text.split(".")[0]
    return None


def _find_answer_end(
    ordered_lines: list[tuple[Any, Any]],
    marker: SolutionMarker,
    answer_text: str,
) -> tuple[Any, float] | None:
    candidates = []
    for line in answer_text.splitlines():
        normalized = _normalize_line(line)
        if re.match(r"^(?:Izvor|Prilagođeno prema):", normalized, flags=re.IGNORECASE):
            break
        if len(normalized) >= 8:
            candidates.append(normalized)
    marker_position = _marker_position(marker)
    for candidate in reversed(candidates):
        for page, line in reversed(ordered_lines):
            if (page.number, line.y_min) < marker_position:
                continue
            rendered = _normalize_line(line.text)
            if rendered == candidate or (
                min(len(rendered), len(candidate)) >= 18
                and (rendered in candidate or candidate in rendered)
            ):
                return page, line.y_max
    return None


def _render_solution_pages(
    solution_pdf: Path,
    destination: Path,
    identifier: str,
    url_prefix: str,
    crops: dict[str, list[SolutionCrop]],
    *,
    render_dpi: int,
    required_message: str,
) -> dict[str, list[dict[str, Any]]]:
    crops_by_page: dict[int, list[tuple[str, SolutionCrop]]] = {}
    for number, question_crops in crops.items():
        for crop in question_crops:
            crops_by_page.setdefault(crop.page.number, []).append((number, crop))

    images: dict[str, list[dict[str, Any]]] = {}
    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        for page_number, page_crops in sorted(crops_by_page.items()):
            filename = f"solution-page-{page_number}.png"
            image_path = destination / filename
            if image_path.is_file():
                contents = image_path.read_bytes()
            else:
                temporary_prefix = temporary_root / f"solution-page-{page_number}"
                render_pdf_page_to_png(
                    solution_pdf,
                    temporary_prefix,
                    page_number,
                    render_dpi,
                    required_message=required_message,
                )
                contents = temporary_prefix.with_suffix(".png").read_bytes()
            image_width, image_height = png_dimensions(
                contents,
                error_message="Rendered official solution image is not a PNG",
                strict_ihdr=False,
            )
            _write_if_changed(image_path, contents)
            page_image = grayscale_image_from_png(contents)

            for number, crop in page_crops:
                scale_x = image_width / crop.page.width
                scale_y = image_height / crop.page.height
                x_min = max(0, math.floor(crop.x_min * scale_x))
                y_min = max(0, math.floor(crop.y_min * scale_y))
                x_max = min(image_width, math.ceil(crop.x_max * scale_x))
                y_max = min(image_height, math.ceil(crop.y_max * scale_y))
                x_min, y_min, x_max, y_max = trim_crop_bottom_whitespace(
                    page_image,
                    x_min,
                    y_min,
                    x_max,
                    y_max,
                    padding=14,
                    min_height=28,
                    min_trim=10,
                    detect_legacy_answer_frame=False,
                )
                if x_max <= x_min or y_max <= y_min:
                    continue
                images.setdefault(number, []).append(
                    source_image_metadata(
                        page_image,
                        url=f"{url_prefix}/{identifier}/{filename}",
                        image_width=image_width,
                        image_height=image_height,
                        crop_box=(x_min, y_min, x_max, y_max),
                    )
                )

    return images


def _remove_unexpected_solution_pages(
    destination: Path,
    images: dict[str, list[dict[str, Any]]],
) -> None:
    expected = {
        Path(image["url"]).name
        for question_images in images.values()
        for image in question_images
    }
    for path in destination.glob("solution-page-*.png"):
        if path.name not in expected:
            path.unlink()


def _normalize_line(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _marker_position(marker: SolutionMarker) -> tuple[int, float]:
    return marker.page.number, marker.y_min


def _write_if_changed(path: Path, contents: bytes) -> None:
    if path.is_file() and path.read_bytes() == contents:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)
