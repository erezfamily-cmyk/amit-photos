#!/usr/bin/env python3
import importlib.util
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "portfolio_visual_curation", ROOT / "src" / "portfolio_visual_curation.py"
)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


class PortfolioVisualCurationTests(unittest.TestCase):
    def test_resolution_bands_are_bounded_and_monotonic(self):
        samples = [
            (433, 301),
            (950, 634),
            (1440, 956),
            (3000, 1993),
            (4288, 2848),
            (8256, 5504),
        ]
        scores = [mod.resolution_score(w, h) for w, h in samples]
        self.assertEqual(scores, sorted(scores))
        self.assertTrue(all(0 <= x <= 100 for x in scores))

    def test_pending_items_never_fake_visual_zeros(self):
        photo = {
            "id": "x",
            "title": "תמונה",
            "category": "ישראל",
            "description": "",
            "filename": "x.jpg",
            "width": 4288,
            "height": 2848,
            "exif": {},
            "thumbnail": "/photos/thumb/x.webp",
        }
        item = mod.item_from_photo(photo, Counter({"תמונה": 1}), Counter({"x.jpg": 1}))
        self.assertEqual(item["score_kind"], "pending_visual")
        self.assertIsNone(item["score"])
        self.assertIsNone(item["components"]["sharpness"])
        self.assertIsNone(item["components"]["composition"])
        self.assertIsNone(item["components"]["light_color"])

    def test_completed_flower_visual_scores_are_preserved(self):
        photos = [{
            "id": "flower",
            "title": "פרח",
            "category": "פרחים וצמחים",
            "description": "תיאור",
            "filename": "f.jpg",
            "width": 4000,
            "height": 3000,
            "exif": {"camera": "x"},
        }]
        flower = {"items": [{
            "photo_id": "flower",
            "pilot_score": 82,
            "score_kind": "visual_complete",
            "confidence": "high",
            "technical_score": 90,
            "components": {
                "sharpness": 80,
                "composition": 82,
                "light_color": 84,
                "resolution": 85,
                "uniqueness": 100,
                "category_fit": 100,
                "metadata": 100,
            },
        }]}
        state = mod.build_state(photos, {}, flower)
        item = state["items"][0]
        self.assertEqual(item["score_kind"], "visual_complete")
        self.assertEqual(item["score"], 82)
        self.assertTrue(item["owner_review_required"])

    def test_above_85_is_not_sent_to_owner_review_without_material_problem(self):
        item = {
            "components": {
                "sharpness": 92,
                "composition": 92,
                "light_color": 92,
                "resolution": 92,
                "uniqueness": 100,
                "category_fit": 95,
                "metadata": 100,
            },
            "material_problem": False,
        }
        mod.apply_visual_result(item, {
            "sharpness": 92,
            "composition": 92,
            "light_color": 92,
            "category_fit": 95,
            "visual_flags": [],
            "note": "",
        })
        self.assertGreater(item["score"], 85)
        self.assertFalse(item["owner_review_required"])
        self.assertEqual(item["recommended_action"], "KEEP_CANDIDATE")

    def test_visual_review_prefers_full_image_over_thumbnail(self):
        photo = {
            "url": "/photos/full.webp",
            "thumbnail": "/photos/thumb/full.webp",
        }
        self.assertEqual(mod.image_url(photo), "https://amitphotos.com/photos/full.webp")

    def test_pipeline_is_advisory_only(self):
        source = (ROOT / "src" / "portfolio_visual_curation.py").read_text(encoding="utf-8")
        self.assertNotIn("/api/photos", source)
        self.assertNotIn("published=0", source)
        self.assertNotIn("DELETE FROM photos", source)


if __name__ == "__main__":
    unittest.main()
