from __future__ import annotations

import re
import struct
import subprocess
import unicodedata
from pathlib import Path
from typing import Sequence


def slugify(value: str, *, replace_dj: bool = False) -> str:
    normalized = unicodedata.normalize("NFD", value.casefold())
    if replace_dj:
        normalized = normalized.replace("đ", "d")
    ascii_value = normalized.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")


def normalize_term(term: str, aliases: dict[str, str] | None = None) -> str:
    return (aliases or {}).get(term, term)


def run_pdf_command(
    arguments: Sequence[str],
    contents: bytes | None = None,
    *,
    required_message: str,
    failure_prefix: str,
) -> bytes:
    try:
        completed = subprocess.run(
            list(arguments),
            input=contents,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(required_message) from exc
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"{failure_prefix}: {message}") from exc
    return completed.stdout


def pdftotext(
    contents: bytes,
    *arguments: str,
    required_message: str,
    failure_prefix: str = "pdftotext failed",
) -> str:
    output = run_pdf_command(
        ["pdftotext", *arguments, "-", "-"],
        contents,
        required_message=required_message,
        failure_prefix=failure_prefix,
    )
    return output.decode("utf-8", errors="replace")


def pdfinfo_page_count(contents: bytes, *, required_message: str) -> int:
    output = run_pdf_command(
        ["pdfinfo", "-"],
        contents,
        required_message=required_message,
        failure_prefix="pdfinfo failed",
    ).decode("utf-8", errors="replace")
    match = re.search(r"^Pages:\s+(\d+)\s*$", output, flags=re.MULTILINE)
    if not match:
        raise ValueError("Could not read PDF page count")
    return int(match.group(1))


def render_pdf_page_to_png(
    pdf_path: Path,
    output_prefix: Path,
    page_number: int,
    dpi: int,
    *,
    required_message: str,
    failure_prefix: str = "pdftocairo failed",
) -> None:
    run_pdf_command(
        [
            "pdftocairo",
            "-png",
            "-singlefile",
            "-r",
            str(dpi),
            "-f",
            str(page_number),
            "-l",
            str(page_number),
            str(pdf_path),
            str(output_prefix),
        ],
        required_message=required_message,
        failure_prefix=failure_prefix,
    )


def png_dimensions(
    contents: bytes,
    *,
    error_message: str = "Expected a PNG source page",
    strict_ihdr: bool = True,
) -> tuple[int, int]:
    expected_header = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" if strict_ihdr else b"\x89PNG\r\n\x1a\n"
    )
    if contents[: len(expected_header)] != expected_header:
        raise ValueError(error_message)
    return struct.unpack(">II", contents[16:24])
