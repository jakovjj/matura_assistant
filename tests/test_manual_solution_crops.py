import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import manual_solution_images as solutions
import build_geography_choice as geography
from pdf_crop_layout import HorizontalRule, detect_horizontal_rules


class ManualSolutionCropTest(unittest.TestCase):
    def test_border_alignment_preserves_shared_and_continuation_crops(self):
        page = SimpleNamespace(number=1, width=600, height=840)
        marker = solutions.SolutionMarker("22", page, 120)
        rules = {1: [HorizontalRule(70, y, 520, y + 1) for y in [100, 150]]}
        crop = solutions.SolutionCrop(page, 30, 114, 570, 160)
        aligned = solutions._align_table_crops(
            {"22": [crop]}, {"22": marker}, {"22": marker}, rules,
        )["22"][0]
        self.assertEqual((aligned.x_min, aligned.y_min, aligned.x_max, aligned.y_max),
                         (69.5, 99.5, 520.5, 151.5))
        self.assertTrue(aligned.table_aligned)
        shared = solutions.SolutionCrop(page, 30, 80, 570, 160)
        for parts in [[shared], [crop, crop]]:
            self.assertEqual(solutions._align_table_crops(
                {"22": parts}, {"22": marker}, {"22": marker}, rules,
            )["22"], parts)
        neighbour = solutions.SolutionMarker("23", page, 140)
        self.assertEqual(solutions._align_table_crops(
            {"22": [crop]}, {"22": marker}, {"22": marker, "23": neighbour}, rules,
        )["22"], [crop])

    def test_repeated_separator_cannot_locate_answer(self):
        page = SimpleNamespace(number=1)
        lines = [(page, SimpleNamespace(text=text, y_min=y)) for text, y in
                 [("________________________", 60), ("The complete answer.", 700)]]
        answer = "The complete answer.\n________________________\n2/4"
        start = solutions._find_answer_start(lines, answer, None, None)
        self.assertEqual(start, (page, 700))
        self.assertFalse(solutions._is_answer_anchor("2/4"))
        self.assertFalse(solutions._is_answer_anchor("----------------"))

    def test_geography_2026_task_22_excludes_header_and_other_answers(self):
        path = ROOT / "files/interactive/geography-choice/geografija-2026-ljetni-rok/solutions.pdf"
        if not path.exists():
            self.skipTest("Mirrored official key unavailable")
        text = geography.OUTPUT.read_text()
        payload = json.loads(text[text.index("{"):].strip().rstrip(";"))
        exam = next(e for e in payload["exams"] if e["id"] == "geografija-2026-ljetni-rok")
        pages = geography.pdf_bbox_pages(path.read_bytes())
        markers = solutions._find_solution_markers(
            pages, set(exam["openAnswers"]), exam["openAnswers"],
            geography.parse_question_token, geography.question_sort_key,
        )
        boundaries = solutions._collect_all_markers(pages, geography.parse_question_token)
        crops = solutions._solution_crops(
            pages, markers, boundaries, exam["openAnswers"], geography.question_sort_key,
        )["22"]
        self.assertEqual(len(crops), 1)
        self.assertEqual(crops[0].page.number, 1)
        self.assertGreater(crops[0].y_min, 690)
        self.assertLess(crops[0].y_max - crops[0].y_min, 100)
        rules = detect_horizontal_rules(path.read_bytes(), {p.number: p for p in pages})
        aligned = solutions._align_table_crops({"22": crops}, markers, boundaries, rules)["22"][0]
        self.assertTrue(aligned.table_aligned)
        self.assertLess(aligned.x_max - aligned.x_min, crops[0].x_max - crops[0].x_min)
        self.assertLess(aligned.y_max - aligned.y_min, 45)


if __name__ == "__main__":
    unittest.main()
