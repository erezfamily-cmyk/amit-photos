#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from photo_catalog_audit import build_audit


class PhotoCatalogAuditTests(unittest.TestCase):
    def test_flags_metadata_candidates_without_auto_delete(self):
        photos = [
            {
                "id": "a",
                "title": "Same",
                "category": "ישראל",
                "description": "",
                "width": 1000,
                "height": 700,
                "exif": {},
                "parent_category": None,
            },
            {
                "id": "b",
                "title": "Same",
                "category": "ישראל",
                "description": "ok",
                "width": 4000,
                "height": 3000,
                "exif": {"camera": "x"},
                "parent_category": "travel",
            },
        ]
        report = build_audit(photos, {"status": "waiting_for_mapped_data"})
        self.assertFalse(report["policy"]["automatic_delete"])
        self.assertFalse(report["policy"]["automatic_hide"])
        self.assertEqual(report["issues"]["missing_description_count"], 1)
        self.assertEqual(report["issues"]["low_resolution_count"], 1)
        self.assertEqual(report["issues"]["duplicate_title_group_count"], 1)
        self.assertEqual(report["categories"][0]["taxonomy_type"], "location_collection")

    def test_marks_style_categories_as_attributes(self):
        report = build_audit([
            {
                "id": "bw",
                "title": "BW",
                "category": "שחור-לבן",
                "description": "ok",
                "width": 3000,
                "height": 2000,
                "exif": {"camera": "x"},
                "parent_category": "art",
            }
        ])
        self.assertEqual(report["categories"][0]["taxonomy_type"], "style_or_attribute")


if __name__ == "__main__":
    unittest.main()
