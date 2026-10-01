#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import photo_strength_report as psr
import social_photo_map as spm


class PhotoStrengthReportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.ga = root / "ga.json"
        self.social = root / "social.json"
        self.photos = root / "photos.json"
        self.out = root / "out.json"
        self.map = root / "map.json"

        self.old = (
            psr.GA_FILE, psr.SOCIAL_FILE, psr.PHOTOS_FILE, psr.OUT_FILE,
            spm.MAP_FILE,
        )
        psr.GA_FILE, psr.SOCIAL_FILE, psr.PHOTOS_FILE, psr.OUT_FILE = (
            self.ga, self.social, self.photos, self.out
        )
        spm.MAP_FILE = self.map

    def tearDown(self):
        psr.GA_FILE, psr.SOCIAL_FILE, psr.PHOTOS_FILE, psr.OUT_FILE, spm.MAP_FILE = self.old
        self.tmp.cleanup()

    def write(self, path, value):
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")

    def test_waits_instead_of_ranking_without_mapped_data(self):
        self.write(self.ga, [{"period": "test", "photo_analytics": None}])
        self.write(self.social, {})
        self.write(self.photos, [])
        report = psr.build_report()
        self.assertEqual(report["status"], "waiting_for_mapped_data")
        self.assertEqual(report["ranked"], [])

    def test_real_site_signal_ranks_photo_and_low_sample_stays_low_confidence(self):
        self.write(self.ga, [{
            "period": "test",
            "photo_analytics": {
                "window_days": 30,
                "views": [
                    {"photo_id": "strong", "count": 25},
                    {"photo_id": "tiny", "count": 2},
                ],
                "intents": [{"photo_id": "strong", "count": 4}],
                "purchases": [],
            },
        }])
        self.write(self.social, {})
        self.write(self.photos, [
            {"id": "strong", "title": "Strong", "category": "טבע"},
            {"id": "tiny", "title": "Tiny", "category": "טבע"},
        ])
        report = psr.build_report()
        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["ranked"][0]["photo_id"], "strong")
        self.assertEqual(report["ranked"][0]["confidence"], "high")
        tiny = next(r for r in report["ranked"] if r["photo_id"] == "tiny")
        self.assertEqual(tiny["confidence"], "low")
        self.assertFalse(tiny["eligible_for_featured_review"])

    def test_social_mapping_is_deduplicated(self):
        spm.save_social_photo_mapping("instagram", "post-1", "photo-1")
        spm.save_social_photo_mapping("instagram", "post-1", "photo-1")
        rows = spm.load_social_photo_map()
        self.assertEqual(len(rows), 1)
        self.assertEqual(spm.build_post_lookup()[("instagram", "post-1")], "photo-1")

    def test_pipeline_wiring_contains_required_mapping_guards(self):
        instagram = (ROOT / "src" / "instagram_post.py").read_text(encoding="utf-8")
        facebook = (ROOT / "src" / "facebook_post.py").read_text(encoding="utf-8")
        weekly = (ROOT / "src" / "weekly_report.py").read_text(encoding="utf-8")
        ga = (ROOT / "src" / "ga_weekly_report.py").read_text(encoding="utf-8")

        self.assertIn("from social_photo_map import save_social_photo_mapping", instagram)
        self.assertIn('save_social_photo_mapping("instagram", post_id, photo["id"])', instagram)
        self.assertIn("from social_photo_map import save_social_photo_mapping", facebook)
        self.assertIn('save_social_photo_mapping("facebook", post_id, photo["id"])', facebook)

        reel_fn = weekly.split("def build_reel_summary", 1)[1].split("def fetch_ig_account_insights", 1)[0]
        self.assertIn("post_lookup = build_post_lookup()", reel_fn)
        self.assertIn('"photo_id": post_lookup.get', reel_fn)

        self.assertIn('data["photo_analytics"] = fetch_photo_analytics()', ga)
        self.assertIn('"photo_analytics": data.get("photo_analytics")', ga)


if __name__ == "__main__":
    unittest.main()
