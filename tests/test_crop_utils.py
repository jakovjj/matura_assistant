from __future__ import annotations

import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from crop_utils import (
    compact_vertical_whitespace_segments,
    left_booklet_border_end,
    source_image_metadata,
    trim_left_booklet_border,
    trim_shaded_answer_strip,
)


class BookletBorderTest(unittest.TestCase):
    def setUp(self):
        self.image = Image.new("L", (1200, 1700), 255)
        ImageDraw.Draw(self.image).line((120, 200, 120, 1600), fill=0, width=2)
        self.crop = (96, 300, 1100, 450)

    def test_removes_long_outer_border(self):
        border = left_booklet_border_end(self.image)
        trimmed = trim_left_booklet_border(self.image, self.crop, border)
        self.assertGreater(trimmed[0], 121)
        self.assertEqual(trimmed[1:], self.crop[1:])

    def test_preserves_content_outside_border(self):
        ImageDraw.Draw(self.image).rectangle((100, 330, 112, 360), fill=0)
        border = left_booklet_border_end(self.image)
        self.assertEqual(trim_left_booklet_border(self.image, self.crop, border), self.crop)

    def test_preserves_short_diagram_line(self):
        image = Image.new("L", (1200, 1700), 255)
        ImageDraw.Draw(image).line((120, 300, 120, 500), fill=0)
        self.assertIsNone(left_booklet_border_end(image))

    def test_shared_metadata_uses_trimmed_bounds(self):
        metadata = source_image_metadata(
            self.image, url="page.png", image_width=1200, image_height=1700,
            crop_box=self.crop, compact_internal_whitespace=False,
        )
        self.assertGreater(metadata["crop"]["x"], 121)
        self.assertEqual(metadata["crop"]["x"] + metadata["crop"]["width"], 1100)


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

    def test_source_metadata_drops_sparse_page_footer_after_large_gap(self) -> None:
        image = Image.new("L", (600, 700), 255)
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 560, 100), fill=0)
        draw.line((40, 670, 560, 670), fill=0, width=1)
        draw.text((285, 675), "4", fill=0)

        metadata = source_image_metadata(
            image,
            url="page.png",
            image_width=600,
            image_height=700,
            crop_box=(20, 20, 580, 695),
        )

        self.assertLess(metadata["crop"]["height"], 200)
        self.assertNotIn("segments", metadata)

    def test_source_metadata_keeps_content_away_from_page_bottom(self) -> None:
        image = Image.new("L", (600, 900), 255)
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 560, 100), fill=0)
        draw.text((285, 675), "4", fill=0)

        crop = (20, 20, 580, 700)
        metadata = source_image_metadata(
            image,
            url="page.png",
            image_width=600,
            image_height=900,
            crop_box=crop,
        )

        self.assertEqual(metadata["crop"]["height"], crop[3] - crop[1])

    def test_keeps_gap_with_faint_content(self) -> None:
        image = Image.new("L", (600, 700), 255)
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 560, 100), fill=0)
        draw.rectangle((40, 600, 560, 640), fill=0)
        draw.line((300, 101, 300, 599), fill=235, width=2)

        crop = (20, 20, 580, 660)
        self.assertEqual(compact_vertical_whitespace_segments(image, *crop), [crop])


class TrimShadedAnswerStripTest(unittest.TestCase):
    def test_keeps_right_side_when_task_text_precedes_answer_panel(self) -> None:
        image = Image.new("L", (600, 700), 255)
        draw = ImageDraw.Draw(image)
        crop = (20, 20, 580, 650)

        # A lower-right shaded answer panel like the legacy English booklets.
        draw.rectangle((400, 360, 560, 600), fill=225, outline=0, width=2)
        # Task text above the panel legitimately uses the same right-hand area.
        for y in range(170, 215, 3):
            draw.rectangle((420, y, 545, y + 1), fill=0)

        self.assertEqual(trim_shaded_answer_strip(image, *crop), crop)


if __name__ == "__main__":
    unittest.main()
