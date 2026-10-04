#!/usr/bin/env python3
"""Build the independent medicine model from scan-reviewed transcription.

Raw OCR is never published. --check verifies the checked-in outputs without
writing them. See docs/medicine.md for review and regeneration instructions.
"""
import argparse
import hashlib
import io
import json
import pathlib
import re

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content/medicine"
GROUPS = [
    ("biology", "Biologija", 12, 33, 108, 34),
    ("physics", "Fizika", 36, 68, 108, 69),
    ("chemistry", "Kemija", 72, 101, 108, 102),
    ("exam-2020", None, 105, 139, 120, 140),
]


def read(name):
    return json.loads((CONTENT / name).read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def normalize(text):
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    return re.sub(r"\s+", " ", text).strip()


def rich(text, figures, tables):
    blocks = []
    for token in re.split(r"(\[(?:figure|table):[\w-]+\])", normalize(text)):
        marker = re.fullmatch(r"\[(figure|table):([\w-]+)\]", token)
        if marker:
            kind, identifier = marker.groups()
            require(identifier in (figures if kind == "figure" else tables), f"Unknown {token}")
            blocks.append({"type": kind, "id": identifier})
        elif token.strip():
            blocks.append({"type": "text", "text": token.strip()})
    return blocks


def build(check=False):
    review = read("review-manifest.json")
    for name, expected in review["files"].items():
        require(digest(CONTENT / name) == expected, f"Review changed content before building: {name}")
    require(read("inventory.json")["pdfSha256"] == review["pdfSha256"], "PDF provenance mismatch")
    keys, figures, tables = read("answer-keys.json"), read("figures.json"), read("tables.json")
    issues = read("review-issues.json")
    questions, sets = [], []
    for group, subject, first, last, count, keypage in GROUPS:
        entries = []
        key = "".join(keys[group])
        require(len(key) == count and set(key) <= set("ABCDE"), f"Invalid answer key: {group}")
        for page in range(first, last + 1):
            name = f"pages/{page:03}.txt"
            require(name in review["files"], f"Page not reviewed: {page}")
            path = CONTENT / name
            text = path.read_text()
            matches = list(re.finditer(r"(?m)^(\d+)\.\s+", text))
            for index, match in enumerate(matches):
                number = int(match[1])
                body = text[match.end():matches[index + 1].start() if index + 1 < len(matches) else len(text)]
                parts = re.split(r"(?m)^([ABCDE])[.,]\s*", body)
                require(len(parts) == 11 and parts[1::2] == list("ABCDE"), f"Expected A–E: page {page}, question {number}")
                require(1 <= number <= count, f"Unexpected number: {group}/{number}")
                identifier = f"{group}-{number}"
                question = {
                    "id": identifier, "number": number,
                    "subject": subject or ("Biologija" if number <= 40 else "Fizika" if number <= 80 else "Kemija"),
                    "prompt": rich(parts[0], figures, tables),
                    "options": [{"id": letter, "content": rich(value, figures, tables)} for letter, value in zip(parts[1::2], parts[2::2])],
                    "answer": key[number - 1], "points": 5,
                    "verification": "scan-reviewed",
                    "provenance": {
                        "pdfPage": page, "printedPage": page - 10, "sourceNumber": number,
                        "keyPage": keypage, "transcriptionSha256": digest(path),
                    },
                }
                if identifier in issues:
                    question["reviewIssue"] = issues[identifier]
                require(question["prompt"] and all(option["content"] for option in question["options"]), f"Empty content: {identifier}")
                entries.append(question)
        require([q["number"] for q in entries] == list(range(1, count + 1)), f"Missing/duplicate questions: {group}")
        questions.extend(entries)
        sets.append({
            "id": group, "title": subject + " · zbirka zadataka" if subject else "Prijemni ispit 2020.",
            "kind": "collection" if subject else "original", "year": None if subject else 2020,
            "durationMinutes": None if subject else 180, "durationKind": None if subject else "official",
            "questionIds": [q["id"] for q in entries], "expectedCount": count, "complete": True,
            "threshold": None if subject else {"totalPoints": 330, "perSubjectCorrect": 16},
        })
    # Eligible pool for a fresh 40-per-subject paper assembled in the browser.
    mockids = []
    for subject in ("Biologija", "Fizika", "Kemija"):
        candidates = [q["id"] for q in questions if q["subject"] == subject and not q["id"].startswith("exam-") and not q.get("reviewIssue")]
        mockids.extend(candidates)
    sets.append({
        "id": "random-120", "title": "Nasumični ispit", "kind": "random", "year": None,
        "durationMinutes": 180, "durationKind": "practice", "questionIds": mockids,
        "expectedCount": 120, "complete": True, "threshold": {"totalPoints": 330, "perSubjectCorrect": 16},
    })
    require(len(questions) == 444 and len(set(mockids)) == len(mockids), "Incomplete content")
    require(all(sum(q["subject"] == subject for q in questions if q["id"] in mockids) >= 40 for subject in ("Biologija", "Fizika", "Kemija")), "Insufficient random pool")
    require(set(issues) <= {q["id"] for q in questions}, "Unknown question in review issues")

    outputs = {}
    used = {block["id"] for q in questions for block in q["prompt"] + [b for o in q["options"] for b in o["content"]] if block["type"] == "figure"}
    publicfigs = {}
    for identifier in sorted(used):
        figure = figures[identifier]
        with Image.open(ROOT / f'var/medicine/ocr/page-{figure["page"]:03}.png') as source:
            scale = source.width / 1000
            box = tuple(round(value * scale) for value in figure["box"])
            require(0 <= box[0] < box[2] <= source.width and 0 <= box[1] < box[3] <= source.height, f"Invalid crop: {identifier}")
            buffer = io.BytesIO()
            source.crop(box).save(buffer, "WEBP", quality=92)
            outputs[ROOT / f"files/medicine/{identifier}.webp"] = buffer.getvalue()
            publicfigs[identifier] = {"url": f"./files/medicine/{identifier}.webp", "alt": figure["alt"], "width": box[2] - box[0], "height": box[3] - box[1]}

    audit = {"schemaVersion": 1, "pdfSha256": review["pdfSha256"], "questions": questions, "sets": sets, "figures": figures, "tables": tables}
    outputs[CONTENT / "audit.json"] = (json.dumps(audit, ensure_ascii=False, indent=2) + "\n").encode()
    public = {"schemaVersion": 1, "questions": [{k: v for k, v in q.items() if k not in ("provenance", "verification")} for q in questions], "sets": sets, "figures": publicfigs, "tables": tables}
    for filename, variable, payload in (("medicine.js", "MEDICINE_DATA", public), ("medicine-catalog.js", "MEDICINE_CATALOG", sets)):
        outputs[ROOT / "data" / filename] = ("// Generated by scripts/build_medicine.py; do not edit.\nwindow." + variable + " = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n").encode()
    # Validate every input before replacing any public output.
    for path, payload in outputs.items():
        if check:
            require(path.exists() and path.read_bytes() == payload, f"Stale generated file: {path.relative_to(ROOT)}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_bytes(payload)
            temporary.replace(path)
    print(f'{len(questions)} scan-reviewed questions; {len(sets)} sets; {len(publicfigs)} figures; {len(issues)} source issues' + ("; outputs match" if check else ""))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    build(parser.parse_args().check)
