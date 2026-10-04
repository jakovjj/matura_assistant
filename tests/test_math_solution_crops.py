from __future__ import annotations

import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_math_choice as builder
from build_math_choice import (
    HorizontalRule,
    PdfLine,
    PdfPage,
    QuestionMarker,
    SOLUTION_MARKER_TOP_PADDING,
    find_solution_page_crops,
    solution_crop_from_marker,
)


class MathSolutionCropTest(unittest.TestCase):
    def test_autumn_2026_answer_22_has_no_neighbouring_cell_strip(self) -> None:
        path = builder.PAPER_ROOT / "matematika-a-2026-jesenski-rok" / "solutions.pdf"
        if not path.exists():
            self.skipTest("Mirrored scoring guide is unavailable")
        crops, _ = find_solution_page_crops(path.read_bytes(),
                                          [str(n) for n in range(21, 46)])
        # Visually verified borders: the old x=137.3 included the previous cell.
        self.assertAlmostEqual(crops["22"].x_min, 143.46, delta=0.5)
        self.assertAlmostEqual(crops["22"].x_max, 276.92, delta=0.5)

    def test_left_edge_stops_at_cell_border(self) -> None:
        from PIL import Image, ImageDraw
        page = PdfPage(number=1, width=300, height=200, lines=[])
        image = Image.new("L", (600, 400), 255)
        draw = ImageDraw.Draw(image)
        # Horizontal borders continue left into the neighbouring answer.
        draw.line((200, 40, 550, 40), fill=0)
        draw.line((200, 180, 550, 180), fill=0)
        draw.line((220, 40, 220, 180), fill=0)
        self.assertEqual(builder.solution_cell_left_bound(
            page, image, 100, 116, 20, 90), 110)
        # A short stroke in a borderless margin must not move the edge.
        draw.line((220, 40, 220, 180), fill=255)
        draw.line((220, 70, 220, 95), fill=0)
        self.assertEqual(builder.solution_cell_left_bound(
            page, image, 100, 116, 20, 90), 100)

    def test_rebuilt_data_changes_both_entrypoint_cache_keys(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entrypoints = [root / "matematika.html", root / "app.js"]
            for path in entrypoints:
                path.write_text('"./data/math-choice.js?v=old"')
            with patch.object(builder, "ROOT", root), patch.object(
                builder, "OUTPUT", root / "data/math-choice.js"
            ):
                builder.write_payload([])
                first = [path.read_text() for path in entrypoints]
                self.assertEqual(first[0], first[1])
                self.assertNotIn("?v=old", first[0])
                builder.write_payload([])
                self.assertEqual(first, [path.read_text() for path in entrypoints])
                builder.write_payload([{"id": "changed"}])
                for before, path in zip(first, entrypoints):
                    self.assertNotEqual(before, path.read_text())

    def test_official_2026_key_preserves_complete_rows(self) -> None:
        path = ROOT / "files/ncvvo/wp-content/uploads/2026/07/MAT_A_1_rok_2025_2026.zip"
        if not path.exists():
            self.skipTest("Mirrored official key is unavailable")
        numbers = ([str(n) for n in range(21, 35)]
                   + [f"{n}.{sub}" for n in range(35, 40) for sub in [1, 2]]
                   + [str(n) for n in range(40, 46)])
        # Pin this regression to the compact answer key. The generated
        # solutions.pdf now uses the separately published detailed scoring guide.
        with zipfile.ZipFile(path) as archive:
            contents = archive.read("Kljuc za odgovore.pdf")
        crops, _ = find_solution_page_crops(contents, numbers)
        # Visually verified table borders in PDF points. These include the
        # complete mathematical ink and stop before adjacent answers.
        expected = {"22": (507.45, 522.95), "23": (521.95, 538.95),
                    "40": (302.97, 350.97), "43": (390.96, 422.96),
                    "44": (422.46, 453.96)}
        for number, (top, bottom) in expected.items():
            with self.subTest(question=number):
                self.assertAlmostEqual(crops[number].y_min, top, delta=0.1)
                self.assertAlmostEqual(crops[number].y_max, bottom, delta=0.1)

    def test_detailed_scoring_guide_keeps_merged_answer_width(self) -> None:
        path = ROOT / "files/ncvvo/wp-content/uploads/2026/07/MAT_A_1_rok_2025_2026.zip"
        if not path.exists():
            self.skipTest("Mirrored official scoring guide is unavailable")
        with zipfile.ZipFile(path) as archive:
            contents = archive.read("MAT A_Bodovanje_2026_1. rok_NAKON OCJENJIVANJA.pdf")
        numbers = ([str(n) for n in range(21, 35)]
                   + [f"{n}.{sub}" for n in range(35, 40) for sub in [1, 2]]
                   + [str(n) for n in range(40, 46)])
        crops, _ = find_solution_page_crops(contents, numbers)
        # Task 43 spans all three columns below tasks 40-42. The verified
        # right border is at x=565 PDF points, not the first column's x=252.
        self.assertEqual(crops["43"].page.number, 2)
        self.assertAlmostEqual(crops["43"].x_max, 565, delta=1)
        self.assertAlmostEqual(crops["40"].x_max, 252, delta=1)
        self.assertLess(crops["40"].x_max, 257)

    def test_table_borders_preserve_answer_above_centred_question_number(self) -> None:
        page = PdfPage(number=1, width=595, height=842, lines=[])
        markers = [QuestionMarker(str(n), page, y, 76) for n, y in
                   [(42, 374), (43, 403), (44, 434), (45, 456)]]
        rules = [HorizontalRule(70, y, 524, y + 0.5)
                 for y in [365, 391, 422, 453, 468]]
        crop = solution_crop_from_marker(markers[1], markers, rules)
        self.assertEqual((crop.y_min, crop.y_max), (391, 422.5))
        # The numerator starts above task 43's number; the next answer starts
        # at 426, also above its own number. Neither edge can use that number.
        self.assertLess(crop.y_min, 395)
        self.assertGreater(crop.y_max, 418)
        self.assertLess(crop.y_max, 426)

    def test_compact_table_row_never_discards_detected_bottom_border(self) -> None:
        page = PdfPage(number=1, width=595, height=842, lines=[])
        markers = [QuestionMarker("22", page, 510, 76),
                   QuestionMarker("23", page, 525, 76)]
        rules = [HorizontalRule(70, y, 524, y + 0.5) for y in [507, 522, 538]]
        crop = solution_crop_from_marker(markers[0], markers, rules)
        self.assertEqual((crop.y_min, crop.y_max), (507, 522.5))

    def test_missing_separator_does_not_reveal_two_answers(self) -> None:
        page = PdfPage(number=1, width=595, height=842, lines=[])
        markers = [QuestionMarker("20", page, 459, 76),
                   QuestionMarker("21", page, 474, 76),
                   QuestionMarker("22", page, 510, 76)]
        rules = [HorizontalRule(70, y, 524, y + 0.5) for y in [456, 508, 524]]
        crop = solution_crop_from_marker(markers[1], markers, rules)
        self.assertGreaterEqual(crop.y_min, 472)
        self.assertLess(crop.y_max, 510)

    def test_compact_rows_keep_full_answer_without_revealing_next_row(self) -> None:
        page = PdfPage(
            number=1, width=595, height=842,
            lines=[
                PdfLine("22.", "22.", 76, 92, 510.06, 520.28),
                PdfLine("4", "4", 154, 162, 510.99, 521.79),
                PdfLine("23.", "23.", 76, 92, 524.94, 535.16),
                PdfLine("a 4", "a", 154, 170, 525.53, 537.91),
                PdfLine("24.", "24.", 76, 92, 540.90, 551.12),
            ],
        )
        markers = [
            QuestionMarker("22", page, 510.06, 76),
            QuestionMarker("23", page, 524.94, 76),
            QuestionMarker("24", page, 540.90, 76),
        ]
        for index, answer_bottom in [(0, 521.79), (1, 537.91)]:
            with self.subTest(question=markers[index].number):
                crop = solution_crop_from_marker(markers[index], markers, [])
                self.assertGreaterEqual(crop.y_max, answer_bottom)
                self.assertLess(crop.y_max, markers[index + 1].y_min)

    def test_preceding_table_row_cannot_leak_into_solution(self) -> None:
        page = PdfPage(
            number=1,
            width=595,
            height=842,
            lines=[
                PdfLine("20.", "20.", 76, 92, 459, 470),
                PdfLine("C", "C", 154, 162, 460, 471),
                PdfLine("21.", "21.", 76, 92, 474, 484),
                PdfLine("answer 21", "answer", 154, 250, 473, 507),
                PdfLine("22.", "22.", 76, 92, 510, 520),
            ],
        )
        markers = [
            QuestionMarker("20", page, 459, 76),
            QuestionMarker("21", page, 474, 76),
            QuestionMarker("22", page, 510, 76),
        ]
        # This is the misleading rule above task 20 that previously moved the
        # task 21 crop upward far enough to expose task 20's answer.
        rules = [HorizontalRule(70, 456, 570, 458)]

        crop = solution_crop_from_marker(markers[1], markers, rules)

        self.assertGreaterEqual(
            crop.y_min,
            markers[1].y_min - SOLUTION_MARKER_TOP_PADDING,
        )
        self.assertGreater(crop.y_min, page.lines[1].y_max)
        self.assertLess(crop.y_max, markers[2].y_min)

    def test_first_requested_solution_is_also_anchored_to_its_marker(self) -> None:
        page = PdfPage(
            number=1,
            width=595,
            height=842,
            lines=[PdfLine("21.", "21.", 76, 92, 474, 484)],
        )
        marker = QuestionMarker("21", page, 474, 76)

        crop = solution_crop_from_marker(
            marker,
            [marker],
            [HorizontalRule(70, 456, 570, 458)],
        )

        self.assertEqual(crop.y_min, 474 - SOLUTION_MARKER_TOP_PADDING)


if __name__ == "__main__":
    unittest.main()
