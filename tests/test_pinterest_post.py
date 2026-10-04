import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location(
    "pinterest_post", Path(__file__).resolve().parent.parent / "src" / "pinterest_post.py"
)
module = importlib.util.module_from_spec(SPEC)
try:
    import requests
except ImportError:
    sys.modules["requests"] = types.SimpleNamespace(
        RequestException=Exception, get=Mock(), request=Mock()
    )
SPEC.loader.exec_module(module)


def item(photo_id, category="Flowers", posted="FALSE"):
    return {
        "id": photo_id, "title": f"Photo {photo_id}", "category": category,
        "description": "Curated description #photography",
        "image_url": "https://drive.google.com/example.jpg",
        "link": f"https://amitphotos.com/?photo={photo_id}", "posted": posted,
    }


class PinterestQueueTests(unittest.TestCase):
    def test_repository_queue_is_complete_and_reconciled(self):
        rows, fields = module.load_queue()
        posted = module.load_posted()
        self.assertEqual(len(rows), 447)
        self.assertEqual(len({row["id"] for row in rows}), 447)
        self.assertTrue(all(row["description"] for row in rows))
        self.assertTrue(all(row["id"] in posted for row in rows if row["posted"] == "TRUE"))

    def test_selection_excludes_prior_posts_and_unpublished_photos(self):
        rows = [item("old"), item("hidden"), item("new"), item("another", "Landscape")]
        live = {"old": {}, "new": {}, "another": {}}
        with patch.object(module.random, "shuffle"):
            result = module.select_rows(rows, live, {"old"})
        self.assertEqual([row["id"] for row in result], ["new", "another"])

    def test_invalid_or_duplicate_queue_stops_before_any_post(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "queue.csv"
            file.write_text(
                "id,title,category,description,image_url,link,posted\n"
                "a,A,Flowers,Description,https://example.com/a,https://amitphotos.com/,FALSE\n",
                encoding="utf-8",
            )
            with patch.object(module, "QUEUE_FILE", file):
                with self.assertRaisesRegex(ValueError, "Invalid per-photo link"):
                    module.load_queue()

    def test_pin_uses_curated_copy_and_photo_destination(self):
        row = item("photo-id")
        photo = {"id": "photo-id", "thumbnail": "/photos/photo-id.webp"}
        with patch.object(module, "pinterest_request", return_value={"id": "pin-id"}) as send:
            module.publish("token", row, photo, "board-id")
        body = send.call_args.kwargs["json"]
        self.assertEqual(body["description"], row["description"])
        self.assertEqual(body["media_source"]["url"], "https://amitphotos.com/photos/photo-id.webp")
        self.assertIn("photo=photo-id", body["link"])
        self.assertIn("utm_source=pinterest", body["link"])
        self.assertNotIn("buy=1", body["link"])

    def test_state_round_trip_preserves_existing_posted_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            queue, posted_file = Path(directory) / "queue.csv", Path(directory) / "posted.json"
            rows = [item("already", posted="TRUE"), item("new", posted="TRUE")]
            fields = list(rows[0])
            with patch.object(module, "QUEUE_FILE", queue), patch.object(module, "POSTED_FILE", posted_file):
                module.save_state(rows, fields, {"already", "new", "prior-outside-queue"})
                loaded, _ = module.load_queue()
                state = module.load_posted()
            self.assertEqual([row["posted"] for row in loaded], ["TRUE", "TRUE"])
            self.assertEqual(state, {"already", "new", "prior-outside-queue"})


if __name__ == "__main__":
    unittest.main()
