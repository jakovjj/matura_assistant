#!/usr/bin/env python3
"""Repair and validate generated official answers for open exam tasks."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
INDEXES = (
    ("data/psychology-choice.js", "window.ASISTENT_ZA_MATURE_PSYCHOLOGY_CHOICE="),
    ("data/geography-choice.js", "window.ASISTENT_ZA_MATURE_GEOGRAPHY_CHOICE="),
    ("data/history-choice.js", "window.ASISTENT_ZA_MATURE_HISTORY_CHOICE="),
    ("data/politics-choice.js", "window.ASISTENT_ZA_MATURE_POLITICS_CHOICE="),
)

RUBRIC_HEADING_RE = re.compile(
    r"^\s*(?P<points>\d+)\s+bod(?:a|ova)?(?:\s+|$)",
    flags=re.IGNORECASE,
)
MODEL_HEADING_RE = re.compile(
    r"^\s*MODEL[^\n]*TO[ČC]N[^\n]*ODGOVORA:?\s*$",
    flags=re.IGNORECASE,
)
TASK_HEADING_RE = re.compile(
    r"^\s*(?:[IVX]+\.\s*)?ZADAT(?:AK|CI)\b",
    flags=re.IGNORECASE,
)


@dataclass(frozen=True)
class OpenQuestionSpec:
    number: str
    task_id: str
    max_points: int


@dataclass(frozen=True)
class ValidationIssue:
    exam_id: str
    question: str
    code: str
    message: str
    text: str

    def format(self) -> str:
        excerpt = re.sub(r"\s+", " ", self.text).strip()[:240]
        return (
            f"{self.exam_id}, zadatak {self.question}: {self.message} "
            f"[{self.code}] {excerpt!r}"
        )


class OpenAnswerValidationError(ValueError):
    def __init__(self, issues: Iterable[ValidationIssue]):
        self.issues = list(issues)
        super().__init__("\n".join(issue.format() for issue in self.issues))


def question_sort_key(question: str) -> tuple[int, int]:
    whole, _, decimal = str(question).partition(".")
    return int(whole), int(decimal or 0)


def rubric_heading_points(text: str) -> list[int]:
    return [
        int(match.group("points"))
        for line in str(text or "").splitlines()
        if (match := RUBRIC_HEADING_RE.match(line))
    ]


def merge_answer_text(prefix: str, suffix: str, question: str) -> str:
    prefix_lines = _without_question_marker(prefix.splitlines(), question)
    suffix_lines = _without_question_marker(suffix.splitlines(), question)

    overlap = 0
    maximum_overlap = min(12, len(prefix_lines), len(suffix_lines))
    for size in range(maximum_overlap, 0, -1):
        if prefix_lines[-size:] == suffix_lines[:size]:
            overlap = size
            break

    lines = prefix_lines + suffix_lines[overlap:]
    return "\n".join(line for line in lines if line.strip()).strip()


def repair_open_answer_boundaries(
    entries: list[dict[str, Any]],
    specs: list[OpenQuestionSpec],
) -> list[dict[str, Any]]:
    """Move rubric text that PDF column ordering attached to the prior task."""

    by_number = {str(entry["number"]): dict(entry) for entry in entries}
    ordered_specs = sorted(specs, key=lambda spec: question_sort_key(spec.number))

    for _ in range(3):
        changed = False
        for previous_spec, next_spec in zip(ordered_specs, ordered_specs[1:]):
            previous = by_number.get(previous_spec.number)
            if not previous:
                continue

            previous_text = str(previous.get("answerText") or "").strip()
            split_at = _boundary_line_index(previous_text, previous_spec, next_spec)
            if split_at is None:
                continue

            lines = previous_text.splitlines()
            retained = "\n".join(lines[:split_at]).strip()
            moved = "\n".join(lines[split_at:]).strip()
            if not retained or not moved:
                continue

            previous["answerText"] = retained
            next_entry = by_number.get(next_spec.number)
            if next_entry:
                next_entry["answerText"] = merge_answer_text(
                    moved,
                    str(next_entry.get("answerText") or ""),
                    next_spec.number,
                )
            else:
                by_number[next_spec.number] = {
                    "number": next_spec.number,
                    "answerText": merge_answer_text(moved, "", next_spec.number),
                    "taskId": next_spec.task_id,
                }
            changed = True

        if not changed:
            break

    return [
        by_number[number]
        for number in sorted(by_number, key=question_sort_key)
    ]


def validate_exam_open_answers(exam: dict[str, Any]) -> list[ValidationIssue]:
    exam_id = str(exam.get("id") or "nepoznati-ispit")
    open_answers = exam.get("openAnswers") or {}
    task_items = {
        str(item.get("number")): item
        for task in exam.get("tasks") or []
        for item in task.get("questions") or []
        if item.get("type") == "open"
    }
    ordered_questions = sorted(
        {str(question) for question in exam.get("openQuestions") or open_answers},
        key=question_sort_key,
    )
    issues: list[ValidationIssue] = []

    for index, question in enumerate(ordered_questions):
        model = open_answers.get(question)
        text = str(model.get("modelAnswer") if isinstance(model, dict) else "").strip()
        model_max = _positive_int(model.get("maxPoints") if isinstance(model, dict) else None)
        task_max = _positive_int(task_items.get(question, {}).get("maxPoints"))
        maximum = task_max or model_max or 1

        if not text:
            issues.append(
                ValidationIssue(
                    exam_id,
                    question,
                    "missing-model-answer",
                    "nedostaje službeni model odgovora",
                    text,
                )
            )
            continue

        if model_max and task_max and model_max != task_max:
            issues.append(
                ValidationIssue(
                    exam_id,
                    question,
                    "max-points-disagree",
                    f"maxPoints u zadatku ({task_max}) i rješenju ({model_max}) nisu usklađeni",
                    text,
                )
            )

        rubric_points = rubric_heading_points(text)
        if maximum == 1 and any(points > 1 for points in rubric_points):
            issues.append(
                ValidationIssue(
                    exam_id,
                    question,
                    "one-point-has-multi-point-rubric",
                    "jednobodovni odgovor sadrži višebodovnu rubriku",
                    text,
                )
            )
        elif rubric_points and max(rubric_points) != maximum:
            issues.append(
                ValidationIssue(
                    exam_id,
                    question,
                    "rubric-max-points-disagree",
                    (
                        f"maxPoints je {maximum}, a najveća pronađena rubrika "
                        f"ima {max(rubric_points)} bodova"
                    ),
                    text,
                )
            )

        foreign_numbers = [
            candidate
            for candidate in ordered_questions
            if candidate != question and _contains_question_marker(text, candidate)
        ]
        if foreign_numbers:
            issues.append(
                ValidationIssue(
                    exam_id,
                    question,
                    "foreign-question-number",
                    f"odgovor sadrži oznaku susjednoga zadatka {foreign_numbers[0]}",
                    text,
                )
            )

        model_headings = sum(
            1 for line in text.splitlines() if MODEL_HEADING_RE.match(line)
        )
        if model_headings > 1:
            issues.append(
                ValidationIssue(
                    exam_id,
                    question,
                    "multiple-model-headings",
                    "odgovor sadrži više naslova modela točnoga odgovora",
                    text,
                )
            )

        task_headings = [line for line in text.splitlines() if TASK_HEADING_RE.match(line)]
        if task_headings:
            issues.append(
                ValidationIssue(
                    exam_id,
                    question,
                    "foreign-task-heading",
                    "odgovor sadrži naslov druge sekcije zadataka",
                    text,
                )
            )

        if index + 1 < len(ordered_questions):
            next_question = ordered_questions[index + 1]
            next_model = open_answers.get(next_question) or {}
            next_text = str(next_model.get("modelAnswer") or "").strip()
            if _looks_like_sentence_continuation(text, next_text, maximum):
                issues.append(
                    ValidationIssue(
                        exam_id,
                        question,
                        "split-sentence-boundary",
                        (
                            "odgovor završava kao nedovršena rečenica, a sljedeći "
                            f"zadatak {next_question} počinje njezinim nastavkom"
                        ),
                        f"{text}\n--- {next_question} ---\n{next_text}",
                    )
                )

    return _deduplicate_issues(issues)


def assert_valid_exam_open_answers(exam: dict[str, Any]) -> None:
    issues = validate_exam_open_answers(exam)
    if issues:
        raise OpenAnswerValidationError(issues)


def load_generated_index(path: Path, prefix: str) -> dict[str, Any]:
    source = path.read_text(encoding="utf-8").strip()
    if not source.startswith(prefix) or not source.endswith(";"):
        raise ValueError(f"Unsupported generated index format: {path}")
    return json.loads(source[len(prefix) : -1])


def validate_generated_indexes(root: Path = ROOT) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for relative_path, prefix in INDEXES:
        payload = load_generated_index(root / relative_path, prefix)
        for exam in payload.get("exams") or []:
            issues.extend(validate_exam_open_answers(exam))
    return issues


def _boundary_line_index(
    text: str,
    previous: OpenQuestionSpec,
    following: OpenQuestionSpec,
) -> int | None:
    lines = text.splitlines()
    if len(lines) < 2:
        return None

    seen_top_rubric = False
    seen_completed_rubric = False
    seen_model_heading = False
    task_changed = previous.task_id != following.task_id

    for index, line in enumerate(lines):
        if index == 0:
            match = RUBRIC_HEADING_RE.match(line)
            seen_top_rubric = bool(match and int(match.group("points")) == previous.max_points)
            seen_model_heading = bool(MODEL_HEADING_RE.match(line))
            continue

        if _is_question_marker(line, following.number):
            return index

        if re.match(r"^\s*0\s+bodova?\b", line, flags=re.IGNORECASE):
            seen_completed_rubric = True
        elif re.match(r"^\s*Svi ostali odgovori\b", line, flags=re.IGNORECASE):
            seen_completed_rubric = True

        if MODEL_HEADING_RE.match(line):
            if task_changed or seen_model_heading or seen_completed_rubric:
                return index
            seen_model_heading = True
            continue

        rubric_match = RUBRIC_HEADING_RE.match(line)
        if not rubric_match:
            continue

        points = int(rubric_match.group("points"))
        if points != following.max_points:
            continue

        if task_changed and following.max_points > previous.max_points:
            return index
        if seen_completed_rubric or seen_top_rubric:
            return index

        seen_top_rubric = points == previous.max_points

    return None


def _without_question_marker(lines: list[str], question: str) -> list[str]:
    return [line.strip() for line in lines if line.strip() and not _is_question_marker(line, question)]


def _is_question_marker(line: str, question: str) -> bool:
    return bool(
        re.fullmatch(
            rf"\s*{re.escape(question)}\s*[\.)]\s*",
            line,
        )
    )


def _contains_question_marker(text: str, question: str) -> bool:
    return any(_is_question_marker(line, question) for line in text.splitlines())


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _looks_like_sentence_continuation(previous: str, following: str, maximum: int) -> bool:
    previous = previous.strip()
    following = following.strip()
    if len(previous) < 140 or not following:
        return False
    if previous.endswith((".", "!", "?", ":", ";", "…", ")", "]")):
        return False

    first_line = following.splitlines()[0].strip()
    if not first_line or RUBRIC_HEADING_RE.match(first_line) or MODEL_HEADING_RE.match(first_line):
        return False
    if first_line.startswith(("", "•", "-", "–", "—", "Izvor:")):
        return False

    first_word_match = re.match(r"([A-Za-zČĆŽŠĐčćžšđ]+)", first_line)
    if not first_word_match or not first_word_match.group(1)[0].islower():
        return False

    return maximum > 1 or bool(rubric_heading_points(previous))


def _deduplicate_issues(issues: list[ValidationIssue]) -> list[ValidationIssue]:
    unique: dict[tuple[str, str, str], ValidationIssue] = {}
    for issue in issues:
        unique.setdefault((issue.exam_id, issue.question, issue.code), issue)
    return list(unique.values())


def main() -> None:
    issues = validate_generated_indexes()
    if issues:
        print(f"Pronađeno je {len(issues)} sumnjivih službenih modela odgovora:")
        for issue in issues:
            print(f"- {issue.format()}")
        raise SystemExit(1)
    print("Sva četiri generirana indeksa imaju pouzdane granice službenih odgovora.")


if __name__ == "__main__":
    main()
