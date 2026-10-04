"""Keep browser/CDN data URLs in sync with generated index contents."""

import hashlib
import re
from pathlib import Path


def update_data_revision(root: Path, output: Path, serialized: str) -> None:
    revision = hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:12]
    url = "./" + output.relative_to(root).as_posix()
    pattern = re.escape(url) + r"(?:\?v=[^\s\"']+)?"
    for path in [*root.glob("*.html"), root / "app.js"]:
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        updated = re.sub(pattern, f"{url}?v={revision}", text)
        if updated != text:
            path.write_text(updated, encoding="utf-8")
    # The home page loads these indexes through app.js, which is itself cached.
    app = root / "app.js"
    if app.is_file():
        app_revision = hashlib.sha256(app.read_bytes()).hexdigest()[:12]
        for path in root.glob("*.html"):
            text = path.read_text(encoding="utf-8")
            updated = re.sub(
                r"\./app\.js(?:\?v=[^\s\"']+)?",
                f"./app.js?v={app_revision}", text,
            )
            if updated != text:
                path.write_text(updated, encoding="utf-8")
