import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "sync_pinterest_sheet",
    Path(__file__).resolve().parent.parent / "src" / "sync_pinterest_sheet.py",
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

HEADER = ["id", "title", "category", "description", "image_url", "link", "posted"]


class PinterestSheetSyncTests(unittest.TestCase):
    def test_updates_only_missing_true_values(self):
        values = [HEADER, ["a", "", "", "", "", "", "FALSE"],
                  ["b", "", "", "", "", "", "TRUE"],
                  ["c", "", "", "", "", "", "FALSE"]]
        queue = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
        updates = module.plan_updates(values, queue, {"a", "b", "outside-queue"})
        self.assertEqual(updates, [{"range": "'pinterest_queue.csv'!G2", "values": [["TRUE"]]}])

    def test_rejects_changed_row_identity(self):
        with self.assertRaisesRegex(ValueError, "IDs differ"):
            module.plan_updates([HEADER, ["different"]], [{"id": "expected"}], {"expected"})

    def test_rejects_duplicate_sheet_ids(self):
        with self.assertRaisesRegex(ValueError, "IDs differ"):
            module.plan_updates([HEADER, ["a"], ["a"]], [{"id": "a"}], {"a"})


if __name__ == "__main__":
    unittest.main()
