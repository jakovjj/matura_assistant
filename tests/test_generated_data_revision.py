import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from generated_data_revision import update_data_revision


class GeneratedDataRevisionTest(unittest.TestCase):
    def test_refresh_updates_solver_and_cached_home_loader(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text('<script src="./app.js?v=old"></script>')
            (root / "solver.html").write_text('<script src="./data/example.js?v=old"></script>')
            (root / "app.js").write_text('const url = "./data/example.js?v=old";')
            update_data_revision(root, root / "data/example.js", "first")
            paths = [root / name for name in ["index.html", "solver.html", "app.js"]]
            first = [p.read_text() for p in paths]
            self.assertTrue(all("?v=old" not in text for text in first))
            update_data_revision(root, root / "data/example.js", "first")
            self.assertEqual(first, [p.read_text() for p in paths])
            update_data_revision(root, root / "data/example.js", "second")
            self.assertTrue(all(old != p.read_text() for old, p in zip(first, paths)))


if __name__ == "__main__":
    unittest.main()
