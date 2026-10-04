"""Refresh existing manual solution crops without rebuilding question data.

Usage: python3 scripts/refresh_solution_crops.py [geography history ...]
Uses mirrored solutions.pdf files and existing model answers. A missing key or
unlocatable existing solution fails the refresh instead of silently dropping it.
"""

import importlib
import json
import sys

from generated_data_revision import update_data_revision
from manual_solution_images import build_manual_solution_images

SUBJECTS = ("geography", "history", "psychology", "sociology", "philosophy",
            "politics", "art", "informatics")


def refresh(subject: str) -> None:
    builder = importlib.import_module(f"build_{subject}_choice")
    text = builder.OUTPUT.read_text(encoding="utf-8")
    payload = json.loads(text[len(builder.OUTPUT_PREFIX):].strip().rstrip(";"))
    changed = 0
    for exam in payload["exams"]:
        questions = [q for task in exam["tasks"] for q in task.get("questions", [])
                     if q.get("type") == "open"]
        existing = {str(q["number"]) for q in questions if q.get("solutionImages")}
        if not existing:
            continue
        destination = builder.PAPER_ROOT / exam["id"]
        extra = {}
        if subject in {"art", "informatics"}:
            extra["wanted_questions"] = {str(q["number"]) for q in questions}
        images = build_manual_solution_images(
            [(destination / "solutions.pdf").read_bytes()], destination,
            exam["id"], builder.PAPER_URL_PREFIX, exam["openAnswers"],
            pdf_bbox_pages=builder.pdf_bbox_pages,
            parse_question_token=builder.parse_question_token,
            question_sort_key=builder.question_sort_key,
            render_dpi=builder.SOURCE_RENDER_DPI,
            required_message="pdftocairo is required to refresh solution crops",
            group_aware=subject in {"geography", "art", "informatics"}, **extra,
        )
        missing = existing - images.keys()
        if missing:
            raise ValueError(f"{exam['id']}: lost solution images for {sorted(missing)}")
        for question in questions:
            new = images.get(str(question["number"]))
            if new and new != question.get("solutionImages"):
                question["solutionImages"] = new
                changed += 1
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    builder.OUTPUT.write_text(f"{builder.OUTPUT_PREFIX}{serialized};\n", encoding="utf-8")
    update_data_revision(builder.ROOT, builder.OUTPUT, serialized)
    print(f"{subject}: {changed} solution crops updated", flush=True)


if __name__ == "__main__":
    subjects = sys.argv[1:] or SUBJECTS
    for subject in subjects:
        if subject not in SUBJECTS:
            raise SystemExit(f"Unknown subject: {subject}")
        refresh(subject)
