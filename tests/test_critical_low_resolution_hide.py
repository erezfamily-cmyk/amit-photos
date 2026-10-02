#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "critical_low_resolution_hide", ROOT / "src" / "critical_low_resolution_hide.py"
)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


class CriticalLowResolutionHideTests(unittest.TestCase):
    def test_threshold(self):
        self.assertTrue(mod.is_critical_low_resolution({"width": 950, "height": 634}))
        self.assertTrue(mod.is_critical_low_resolution({"width": 1100, "height": 900}))
        self.assertFalse(mod.is_critical_low_resolution({"width": 1200, "height": 800}))
        self.assertFalse(mod.is_critical_low_resolution({"width": 4288, "height": 2848}))

    def test_any_owner_decision_is_protected(self):
        photos = [
            {"id": "a", "width": 950, "height": 634},
            {"id": "b", "width": 950, "height": 634},
            {"id": "c", "width": 950, "height": 634},
        ]
        decisions = {
            "a": {"decision": "KEEP"},
            "b": {"decision": "KEEP_SECONDARY"},
        }
        plan = mod.build_plan(photos, decisions)
        self.assertEqual([x["photo_id"] for x in plan["eligible"]], ["c"])
        self.assertEqual({x["photo_id"] for x in plan["protected"]}, {"a", "b"})

    def test_sql_is_hide_only_and_does_not_overwrite_decisions(self):
        plan = {"eligible": [{"photo_id": "abc"}]}
        sql = mod.build_sql(plan)
        self.assertIn("UPDATE photos SET published=0", sql)
        self.assertIn("json_extract", sql)
        self.assertIn("IS NULL", sql)
        self.assertNotIn("DELETE FROM photos", sql)
        self.assertNotIn("DELETE FROM", sql)
        self.assertNotIn("published=1", sql)


if __name__ == "__main__":
    unittest.main()
