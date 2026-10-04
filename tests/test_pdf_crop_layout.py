"""Subject-independent table geometry contracts."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from pdf_crop_layout import HorizontalRule, longest_dark_run, solution_table_row_bounds


class PdfCropLayoutTest(unittest.TestCase):
    def test_dark_run_includes_last_pixel(self):
        self.assertEqual(longest_dark_run(bytes([255, 0, 0, 255, 0, 0, 0])), (4, 7, 3))
        self.assertEqual(longest_dark_run(bytes([255, 255])), (0, 0, 0))

    def test_row_geometry_accepts_subject_independent_identifiers(self):
        rules = [HorizontalRule(0, y, 500, y + 1) for y in [100, 140, 180]]
        for number in [43, "43", "36.2"]:
            with self.subTest(number=number):
                marker = SimpleNamespace(number=number, y_min=120)
                neighbour = SimpleNamespace(number="next", y_min=160)
                self.assertEqual(
                    solution_table_row_bounds(marker, [marker, neighbour], rules),
                    (100, 141),
                )

    def test_ambiguous_and_unbounded_rows_are_not_assigned(self):
        marker = SimpleNamespace(number=1, y_min=120)
        neighbour = SimpleNamespace(number=2, y_min=130)
        top = HorizontalRule(0, 100, 500, 101)
        bottom = HorizontalRule(0, 140, 500, 141)
        self.assertIsNone(solution_table_row_bounds(marker, [marker, neighbour], [top, bottom]))
        self.assertIsNone(solution_table_row_bounds(marker, [marker], [top]))
        self.assertIsNone(solution_table_row_bounds(marker, [marker], [bottom]))


if __name__ == "__main__":
    unittest.main()
