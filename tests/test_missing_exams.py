import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_missing_exams import merge_exams, needs_build
from build_physics_choice import parse_question
import build_biology_choice as biology


class MissingExamsTests(unittest.TestCase):
    def test_adds_new_exam_and_preserves_other_entries(self):
        old = {"id": "old", "year": 2025, "term": "ljetni rok", "custom": [1, 2]}
        new = {"id": "new", "year": 2026, "term": "jesenski rok"}
        self.assertEqual(merge_exams([old], [new]), [new, old])

    def test_revised_archive_requires_rebuild(self):
        builder = SimpleNamespace(exam_id=lambda e: "exam")
        existing = [{"id": "exam", "archiveUrl": "old.zip"}]
        self.assertTrue(needs_build("math_choice", builder, {"url": "rev2.zip"}, existing))
        self.assertFalse(needs_build("math_choice", builder, {"url": "old.zip"}, existing))

    def test_croatian_requires_both_writing_parts(self):
        existing = [{"archiveUrl": "hrv.zip", "kind": "sazetak"}]
        self.assertTrue(needs_build("croatian_writing", None, {"url": "hrv.zip"}, existing))
        existing.append({"archiveUrl": "hrv.zip", "kind": "skolski-esej"})
        self.assertFalse(needs_build("croatian_writing", None, {"url": "hrv.zip"}, existing))

    def test_physics_numeric_option_without_dot(self):
        question = parse_question("20. Prompt\n A. 1\n B 2\n C. 3\n D. 4\n (1 bod)", 20)
        self.assertEqual(question.options, {"A": "1", "B": "2", "C": "3", "D": "4"})

    def test_physics_variable_in_prose_is_not_an_option(self):
        question = parse_question("1. Prompt\n A. formula\n B je konstanta\n B. other", 1)
        self.assertEqual(set(question.options), {"A", "B"})
        self.assertIn("B je konstanta", question.options["A"])

    def test_biology_subitems_without_final_dots(self):
        numbers = biology.parse_open_question_numbers("46.1   First answer\n46.2   Second answer\n46.3. Third", {"35": ["A"]})
        self.assertTrue({"46.1", "46.2", "46.3"}.issubset(numbers))

    def test_biology_autumn_numbering_ignores_page_number(self):
        paper = Path(__file__).resolve().parents[1] / "files/interactive/biology-choice/biologija-2026-jesenski-rok/paper.pdf"
        if not paper.exists():
            self.skipTest("2026 autumn Biology asset not built")
        answers = {"35": ["A"]}
        numbers = biology.find_open_question_numbers(paper.read_bytes(), answers)
        self.assertEqual(len(numbers), 35)
        self.assertEqual(numbers[0], "36.1")
        self.assertEqual(numbers[-1], "48.3")
        self.assertEqual(biology.open_question_output_number("36.1", answers, numbers), "36.1")


if __name__ == "__main__":
    unittest.main()
