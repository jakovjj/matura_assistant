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


# NCVVO answer-key pages repeat the same page chrome: a logo and the table
# header (`BROJ ZADATKA` / `TOČAN ODGOVOR`) at the top, and an address line plus
# page number at the bottom. A crop that spans a page boundary must stop above
# the footer and resume below the repeated header instead of swallowing them.
_FOOTER_TEXT_PATTERN = re.compile(
    r"ncvvo|nacionalni centar za vanjsko", re.IGNORECASE
)
_KEY_HEADER_PATTERN = re.compile(r"to[čc]an\s+odgovor|broj\s+zadatka", re.IGNORECASE)


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
    ordered_wanted = sorted(markers, key=question_sort_key)

    def _next_boundary(own_position: tuple[int, float]) -> str | None:
        for candidate in ordered_boundary:
            if boundary_position[candidate] > own_position:
                return candidate
        return None

    def _previous_boundary(own_position: tuple[int, float]) -> SolutionMarker | None:
        previous: SolutionMarker | None = None
        previous_position: tuple[int, float] | None = None
        for candidate in ordered_boundary:
            position = boundary_position[candidate]
            if position < own_position and (
                previous_position is None or position > previous_position
            ):
                previous = boundary_markers[candidate]
                previous_position = position
        return previous

    # Pass 1: locate each wanted question's model-answer text span. The NCVVO
    # answer table centres the question number vertically inside a tall cell, so
    # the label row sits in the MIDDLE of a long answer. `answer_start` is the
    # true top of the cell (the answer's first line); image-only tasks leave it
    # unresolved and fall back to the label row.
    answer_text_by = {
        number: str(open_answers.get(number, {}).get("modelAnswer") or "")
        for number in ordered_wanted
    }

    # 1a: each answer's last line, bounded above by the next numbered row. This
    # also serves as the lower bound for the NEXT answer's first-line search.
    answer_ends: dict[str, tuple[Any, float] | None] = {}
    for number in ordered_wanted:
        marker = markers[number]
        own_position = (marker.page.number, marker.y_min)
        following = _next_boundary(own_position)
        following_marker = boundary_markers[following] if following else None
        answer_ends[number] = _find_answer_end(
            ordered_lines, marker, answer_text_by[number], following=following_marker
        )

    # 1b: each answer's first line. The lower bound is the previous answer's
    # located end (or, lacking one, the previous numbered row), so a boilerplate
    # header shared by adjacent cells (e.g. `Model točnoga odgovora`) resolves to
    # THIS cell rather than the previous answer's tail.
    answer_starts: dict[str, tuple[Any, float] | None] = {}
    for index, number in enumerate(ordered_wanted):
        marker = markers[number]
        own_position = (marker.page.number, marker.y_min)
        following = _next_boundary(own_position)
        upper_position = (
            boundary_position[following] if following else None
        )
        previous_marker = _previous_boundary(own_position)
        lower_position = (
            _marker_position(previous_marker) if previous_marker else None
        )
        previous_number = ordered_wanted[index - 1] if index > 0 else None
        previous_end = answer_ends.get(previous_number) if previous_number else None
        if previous_end is not None:
            previous_end_position = (previous_end[0].number, previous_end[1])
            lower_position = (
                previous_end_position
                if lower_position is None
                else max(lower_position, previous_end_position)
            )
        answer_starts[number] = _find_answer_start(
            ordered_lines, answer_text_by[number], lower_position, upper_position
        )

    crops: dict[str, list[SolutionCrop]] = {}

    for number in ordered_wanted:
        marker = markers[number]
        own_position = (marker.page.number, marker.y_min)
        next_number = _next_boundary(own_position)
        next_marker = boundary_markers[next_number] if next_number else None

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

        # TOP: extend up to this question's answer start when it sits above the
        # (centred) label, so the crop opens at the top of the cell.
        answer_start = answer_starts[number]
        start_page = start_marker.page
        start_y = start_marker.y_min - 6
        if answer_start is not None and (
            answer_start[0].number,
            answer_start[1],
        ) < (start_marker.page.number, start_marker.y_min):
            start_page = answer_start[0]
            start_y = answer_start[1] - 6

        # BOTTOM: stop at the rule between this cell and the next, i.e. the top
        # of the next cell. Using the next question's located answer start (its
        # cell top) instead of its centred label keeps the crop from spilling
        # into the next answer, while still capturing image/continuation content
        # that the model-answer text does not cover. The last question has no
        # next cell, so it falls back to its own answer end, then page bottom.
        bottom: tuple[int, float] | None = None
        if next_marker is not None:
            bottom = (next_marker.page.number, next_marker.y_min)
            next_start = answer_starts.get(next_number) if next_number else None
            if next_number in wanted and next_start is not None:
                # The next cell opens at whichever is higher: its centred label
                # (long answers) or its first text line (short, top-aligned
                # answers whose first line sits below the label).
                bottom = min(bottom, (next_start[0].number, next_start[1]))

        answer_end = answer_ends[number]
        if bottom is not None:
            end_page_number = bottom[0]
        elif answer_end is not None:
            end_page_number = answer_end[0].number
        else:
            end_page_number = pages[-1].number
        end_page_number = max(end_page_number, start_page.number)
        question_crops: list[SolutionCrop] = []

        for page_number in range(start_page.number, end_page_number + 1):
            page = pages_by_number[page_number]
            if page_number == start_page.number:
                y_min = start_y
            else:
                # A continuation page reopens with the logo and the repeated
                # table header; start below it instead of at the page top.
                header_bottom = _key_header_bottom(page)
                y_min = header_bottom + 2 if header_bottom is not None else 36
            if bottom is not None and page_number == bottom[0]:
                y_max = bottom[1] - 6
            elif (
                bottom is None
                and answer_end is not None
                and page_number == answer_end[0].number
            ):
                y_max = answer_end[1] + 12
            else:
                y_max = page.height - 36
            # Never reach into the footer band when the crop runs to the bottom
            # of a page it continues past.
            footer_top = _footer_top(page)
            if footer_top is not None and y_max > footer_top - 6:
                y_max = footer_top - 6
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


def _footer_top(page: Any) -> float | None:
    """Top y of the page footer band, or None.

    Two footer shapes occur in NCVVO answer keys: an address line (often with
    `www.ncvvo.hr` and a page number below it) or, on some exams, just a bare
    page number. Both are matched only in the bottom margin so body text never
    triggers them, and answer-table numbers (which carry a trailing period) are
    not mistaken for a page number.
    """
    footer_y: list[float] = []
    for line in page.lines:
        text = _normalize_line(line.text)
        if line.y_min >= page.height * 0.85 and _FOOTER_TEXT_PATTERN.search(text):
            footer_y.append(line.y_min)
        elif line.y_min >= page.height * 0.93 and re.fullmatch(r"\d{1,3}", text):
            footer_y.append(line.y_min)
    return min(footer_y) if footer_y else None


def _key_header_bottom(page: Any) -> float | None:
    """Bottom y of the repeated answer-key table header row, or None.

    Restricted to the top of the page so it only matches the chrome header,
    never a `TOČAN ODGOVOR` mention inside an answer body. The header label
    `BROJ ZADATKA` is stacked across two left-column lines that don't match the
    pattern on their own, so the matched row is expanded to cover every line it
    vertically overlaps.
    """
    top_lines = [line for line in page.lines if line.y_min <= page.height * 0.25]
    matched = [
        line
        for line in top_lines
        if _KEY_HEADER_PATTERN.search(_normalize_line(line.text))
    ]
    if not matched:
        return None
    # Expand against the fixed matched-row band (not a growing one) so closely
    # spaced answer-body lines below the header never chain the boundary down.
    row_top = min(line.y_min for line in matched)
    row_bottom = max(line.y_max for line in matched)
    overlapping = [
        line.y_max
        for line in top_lines
        if line.y_min <= row_bottom and line.y_max >= row_top
    ]
    return max([row_bottom, *overlapping])


def _parent_number(number: str) -> str | None:
    text = str(number)
    if "." in text:
        return text.split(".")[0]
    return None


def _find_answer_start(
    ordered_lines: list[tuple[Any, Any]],
    answer_text: str,
    lower_position: tuple[int, float] | None,
    upper_position: tuple[int, float] | None,
) -> tuple[Any, float] | None:
    """Locate the first model-answer line, i.e. the top of the task cell.

    Bounded below by the previous answer's end (or the previous numbered row) and
    above by the following numbered row, so a header line repeated across cells
    (every answer opens with ``MODEL TOČNOGA ODGOVORA:``) resolves to this
    question's own cell, never a neighbour's.
    """
    candidates: list[str] = []
    for line in answer_text.splitlines():
        normalized = _normalize_line(line)
        if re.match(r"^(?:Izvor|Prilagođeno prema):", normalized, flags=re.IGNORECASE):
            break
        # A short scoring header such as `3 boda` legitimately opens a rubric
        # cell; keep it as an anchor so the cell top is found above it rather
        # than at the first prose line below.
        if len(normalized) >= 8 or re.match(
            r"^\d+\s*(?:bod|boda|bodova)\b", normalized, flags=re.IGNORECASE
        ):
            candidates.append(normalized)
        if len(candidates) >= 6:
            break
    if not candidates:
        return None

    for page, line in ordered_lines:
        position = (page.number, line.y_min)
        if lower_position and position <= lower_position:
            continue
        if upper_position and position >= upper_position:
            break
        rendered = _normalize_line(line.text)
        for candidate in candidates:
            if rendered == candidate or (
                min(len(rendered), len(candidate)) >= 18
                and (rendered in candidate or candidate in rendered)
            ):
                return page, line.y_min
    return None


def _find_answer_end(
    ordered_lines: list[tuple[Any, Any]],
    marker: SolutionMarker,
    answer_text: str,
    following: SolutionMarker | None = None,
) -> tuple[Any, float] | None:
    candidates = []
    for line in answer_text.splitlines():
        normalized = _normalize_line(line)
        if re.match(r"^(?:Izvor|Prilagođeno prema):", normalized, flags=re.IGNORECASE):
            break
        if len(normalized) >= 8:
            candidates.append(normalized)
    marker_position = _marker_position(marker)
    following_position = _marker_position(following) if following else None
    for candidate in reversed(candidates):
        for page, line in reversed(ordered_lines):
            if (page.number, line.y_min) < marker_position:
                continue
            if following_position and (page.number, line.y_min) >= following_position:
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
