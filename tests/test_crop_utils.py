from __future__ import annotations

import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from crop_utils import compact_vertical_whitespace_segments


class CompactVerticalWhitespaceSegmentsTest(unittest.TestCase):
    def test_splits_large_white_internal_gap(self) -> None:
        image = Image.new("L", (600, 700), 255)
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 560, 100), fill=0)
        draw.rectangle((40, 600, 560, 640), fill=0)

        segments = compact_vertical_whitespace_segments(image, 20, 20, 580, 660)

        self.assertEqual(len(segments), 2)
        self.assertLess(sum(y_max - y_min for _, y_min, _, y_max in segments), 300)
        self.assertLessEqual(segments[0][3], segments[1][1])

    def test_keeps_small_white_gap(self) -> None:
        image = Image.new("L", (600, 360), 255)
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 560, 100), fill=0)
        draw.rectangle((40, 200, 560, 260), fill=0)

        crop = (20, 20, 580, 320)
        self.assertEqual(compact_vertical_whitespace_segments(image, *crop), [crop])

    def test_keeps_gap_with_faint_content(self) -> None:
        image = Image.new("L", (600, 700), 255)
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 560, 100), fill=0)
        draw.rectangle((40, 600, 560, 640), fill=0)
        draw.line((300, 101, 300, 599), fill=235, width=2)

        crop = (20, 20, 580, 660)
        self.assertEqual(compact_vertical_whitespace_segments(image, *crop), [crop])


if __name__ == "__main__":
    unittest.main()
