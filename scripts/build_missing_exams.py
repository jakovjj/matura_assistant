"""Build missing/revised exams for one year without rebuilding older assets.

Refresh the archive with fetch_ncvvo.py first, then run e.g.:
    python3 scripts/build_missing_exams.py --year 2026
    python3 scripts/optimize_images.py
"""

import argparse
import importlib
import json
import sys
from pathlib import Path

from generated_data_revision import update_data_revision

ROOT = Path(__file__).resolve().parents[1]
BUILDERS = (
    "math_choice", "physics_choice", "biology_choice", "chemistry_choice",
    "geography_choice", "history_choice", "informatics_choice", "philosophy_choice",
    "art_choice", "politics_choice", "psychology_choice", "sociology_choice",
    "english_reading", "english_listening", "english_essay",
    "german_reading", "german_listening", "german_essay",
    "croatian_choice", "croatian_writing",
)


def read_payload(path):
    return json.loads(path.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))


def needs_build(builder_name, builder, archive, existing):
    if builder_name == "croatian_writing":
        # The modern Croatian exam has two independently selected writing parts.
        kinds = {e.get("kind") for e in existing if e.get("archiveUrl") == archive["url"]}
        return not {"sazetak", "skolski-esej"}.issubset(kinds)
    entry = next((e for e in existing if e["id"] == builder.exam_id(archive)), None)
    return entry is None or entry.get("archiveUrl") != archive["url"]


def merge_exams(existing, rebuilt):
    by_id = {e["id"]: e for e in existing}
    by_id.update({e["id"]: e for e in rebuilt})
    return sorted(by_id.values(), key=lambda e: (
        -e["year"], 0 if e["term"] == "ljetni rok" else 1, e["id"],
    ))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", required=True, type=int)
    parser.add_argument("--builders", nargs="+", choices=BUILDERS, default=BUILDERS)
    parser.add_argument("--force", action="store_true", help="Rebuild selected year's existing entries too")
    args = parser.parse_args()
    archive = read_payload(ROOT / "data/exams.js")
    failures = []
    total = 0
    for name in args.builders:
        builder = importlib.import_module("build_" + name)
        payload = read_payload(builder.OUTPUT)
        candidates = [e for e in archive["exams"] if e["year"] == args.year
                      and e["subject"] == builder.SUBJECT
                      and (not name.endswith("_essay") or e.get("level") == "A")]
        pending = [e for e in candidates if args.force or needs_build(name, builder, e, payload["exams"])]
        rebuilt = []
        failed = False
        for exam in pending:
            label = f"{name}: {exam['year']} {exam['term']} {exam.get('level') or ''}".strip()
            print(f"Building {label}", flush=True)
            try:
                result = builder.build_exam(exam)
                if not result:
                    raise ValueError("Builder returned no exam")
                rebuilt.extend(result if isinstance(result, list) else [result])
            except Exception as exc:
                failed = True
                failures.append(label)
                print(f"FAILED {label}: {exc}", file=sys.stderr, flush=True)
        if rebuilt and not failed:
            payload["exams"] = merge_exams(payload["exams"], rebuilt)
            serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            prefix = builder.OUTPUT.read_text(encoding="utf-8").split("=", 1)[0] + "="
            builder.OUTPUT.write_text(f"{prefix}{serialized};\n", encoding="utf-8")
            update_data_revision(ROOT, builder.OUTPUT, serialized)
            total += len(rebuilt)
            print(f"Saved {len(rebuilt)} exams to {builder.OUTPUT.name}", flush=True)
    print(f"Built {total} exam parts; {len(failures)} failures", flush=True)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
