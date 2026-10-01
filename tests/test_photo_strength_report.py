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


if __name__ == "__main__":
    unittest.main()
