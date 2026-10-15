import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from PIL import Image, ImageDraw  # noqa: E402

import learn_post_gate as gate  # noqa: E402


def wall_with_block(x0, x1, y0=0.05, y1=0.80, size=(600, 400)):
    """Beige wall with one strongly coloured block, like the blue window on a brick wall."""
    image = Image.new("RGB", size, (214, 190, 150))
    ImageDraw.Draw(image).rectangle([x0 * size[0], y0 * size[1], x1 * size[0], y1 * size[1]], fill=(20, 60, 170))
    return image


class CleanLeadTests(unittest.TestCase):
    def test_removes_the_bold_heading_and_cuts_at_a_sentence_end(self):
        html = "<p><strong>סימטריה מרכזית:</strong> החלון במרכז הפריים. הוא בולט מאוד והצבע חזק מאוד ובולט על הקיר העתיק שמסביב לו ואין שם עוד שום דבר אחר בפריים הזה כלל וכלל ועוד המשך ארוך.</p><p>עוד</p>"
        lead = gate.clean_lead(html, limit=60)
        self.assertFalse(lead.startswith("סימטריה מרכזית"))
        self.assertTrue(lead.endswith("."))
        self.assertEqual(lead, "החלון במרכז הפריים.")

    def test_without_a_sentence_end_it_cuts_at_a_word_with_an_ellipsis(self):
        lead = gate.clean_lead("<p>" + "מילה " * 80 + "</p>", limit=40)
        self.assertTrue(lead.endswith("…"))
        self.assertLessEqual(len(lead), 42)


class ExifTests(unittest.TestCase):
    def test_exif_line_has_only_real_fields(self):
        self.assertEqual(gate.format_exif_line({"aperture": 8, "shutter": 0.01, "iso": 200, "focal": 70}), "f/8 · 1/100s · ISO 200 · 70mm")
        self.assertEqual(gate.format_exif_line({"aperture": 2.8}), "f/2.8")
        self.assertIsNone(gate.format_exif_line(None))
        self.assertIsNone(gate.format_exif_line({}))

    def test_camera_values_that_contradict_the_exif_are_reported(self):
        exif = {"aperture": 8, "shutter": 0.01, "iso": 200, "focal": 70}
        wrong = {"aperture": {"value": "f/8.0"}, "shutter": {"value": "1/250s"}, "iso": {"value": "100"}, "focal": {"value": "35mm"}}
        problems = gate.verify_camera(wrong, exif)
        self.assertEqual(len(problems), 3)
        self.assertTrue(any("ISO 100" in p for p in problems))
        self.assertTrue(any("35" in p for p in problems))
        self.assertTrue(any("1/250" in p for p in problems))
        right = {"aperture": {"value": "f/8.0"}, "shutter": {"value": "1/100s"}, "iso": {"value": "200"}, "focal": {"value": "70mm"}}
        self.assertEqual(gate.verify_camera(right, exif), [])

    def test_without_exif_nothing_can_be_verified(self):
        self.assertTrue(gate.verify_camera({"iso": {"value": "100"}}, None)[0].startswith("no EXIF"))

    def test_the_values_a_visitor_reads_are_parsed_from_the_page(self):
        html = "<div>צמצם f/8.0 צמצם סגור</div><div>מהירות תריס 1/250s תאורה</div><div>ISO 100 אור יום</div><div>מרחק מוקד 35mm עדשה</div><script>ISO 999 </script>"
        camera = gate.parse_page_camera(html)
        self.assertEqual({k: v["value"] for k, v in camera.items()}, {"aperture": "f/8.0", "shutter": "1/250", "iso": "100", "focal": "35mm"})

    def test_load_exif_reads_the_photo_record(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "photos.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump([{"id": "a", "exif": {"aperture": 8, "iso": 200}}, {"id": "b", "exif": {}}, {"id": "c"}], handle)
            self.assertEqual(gate.load_exif("a", path), {"aperture": 8, "iso": 200})
            self.assertIsNone(gate.load_exif("b", path))
            self.assertIsNone(gate.load_exif("c", path))
            self.assertIsNone(gate.load_exif("missing", path))
            self.assertIsNone(gate.load_exif("a", os.path.join(folder, "nope.json")))


class MeasurementTests(unittest.TestCase):
    def test_a_block_in_the_right_third_is_measured_right_of_centre(self):
        measurement = gate.measure_subject(wall_with_block(0.51, 0.74))
        self.assertIsNotNone(measurement)
        self.assertAlmostEqual(measurement["center"][0], 0.625, delta=0.05)
        self.assertEqual(gate.describe_position(measurement["center"][0]), "right of centre")

    def test_a_centred_block_is_measured_at_the_centre(self):
        measurement = gate.measure_subject(wall_with_block(0.40, 0.60))
        self.assertAlmostEqual(measurement["center"][0], 0.5, delta=0.04)
        self.assertEqual(gate.describe_position(measurement["center"][0]), "near the centre")

    def test_a_flat_image_has_no_subject(self):
        self.assertIsNone(gate.measure_subject(Image.new("RGB", (300, 200), (10, 10, 10))))


class CompositionCheckTests(unittest.TestCase):
    def setUp(self):
        self.right = gate.measure_subject(wall_with_block(0.51, 0.74))
        self.centre = gate.measure_subject(wall_with_block(0.40, 0.60))

    def test_the_window_case_symmetry_and_centred_claims_are_flagged(self):
        text = "התמונה בנויה על סימטריה כמעט מושלמת, החלון הכחול ממוקם במרכז הפריים"
        problems = gate.verify_composition("symmetry", text, self.right)
        self.assertEqual(len(problems), 2)
        self.assertTrue(any("symmetry" in p for p in problems))
        self.assertTrue(any("centred" in p for p in problems))

    def test_the_corrected_analysis_passes(self):
        text = "החלון תופס שליש ימני: מרכזו קרוב לקו השליש הימני"
        self.assertEqual(gate.verify_composition("rule_of_thirds", text, self.right), [])

    def test_a_truly_centred_subject_passes_symmetry_and_fails_a_thirds_claim(self):
        self.assertEqual(gate.verify_composition("symmetry", "סימטריה: הנושא במרכז הפריים", self.centre), [])
        problems = gate.verify_composition("rule_of_thirds", "הנושא על קו השליש הימני", self.centre)
        self.assertTrue(problems)

    def test_no_measurement_means_a_human_check_not_a_pass(self):
        self.assertIn("could not be measured", gate.verify_composition("symmetry", "x", None)[0])


class CaptionTests(unittest.TestCase):
    def test_captions_have_no_heading_prefix_and_carry_the_link_only_on_facebook(self):
        facebook, instagram = gate.build_captions("חלון", "החלון בשליש הימני.", "f/8 · 1/100s · ISO 200 · 70mm", "https://amitphotos.com/learn/x", ["חוק השליש", "אדריכלות"], "חוק השליש")
        self.assertIn("📸 חלון", facebook)
        self.assertIn("📏 f/8 · 1/100s · ISO 200 · 70mm", facebook)
        self.assertIn("https://amitphotos.com/learn/x", facebook)
        self.assertNotIn("https://", instagram)
        self.assertIn("#חוקהשליש", facebook)
        self.assertIn("#amitphotos", instagram)

    def test_no_exif_line_means_no_camera_numbers(self):
        facebook, instagram = gate.build_captions("t", "lead", None, "https://amitphotos.com/learn/x", [], "חוק השליש")
        self.assertNotIn("📏", facebook)
        self.assertNotIn("📏", instagram)


class DraftTests(unittest.TestCase):
    def data(self, rule, html):
        return {"photo_id": "p1", "title": "חלון", "composition_rule": rule, "composition_html": html, "thumbnail": "/photos/thumb/p1.webp", "tags": ["a"]}

    def test_the_window_mistake_blocks_publication(self):
        right = gate.measure_subject(wall_with_block(0.51, 0.74))
        exif = {"aperture": 8, "shutter": 0.01, "iso": 200, "focal": 70}
        camera = {"iso": {"value": "100"}}
        draft = gate.make_draft(self.data("symmetry", "<p><strong>סימטריה:</strong> החלון ממוקם במרכז הפריים.</p>"), camera, exif, right)
        self.assertFalse(draft["publishable"])
        self.assertTrue(draft["problems"])

    def test_a_consistent_analysis_is_publishable_and_uses_the_real_exif(self):
        right = gate.measure_subject(wall_with_block(0.51, 0.74))
        exif = {"aperture": 8, "shutter": 0.01, "iso": 200, "focal": 70}
        draft = gate.make_draft(self.data("rule_of_thirds", "<p><strong>חוק השליש:</strong> החלון בשליש הימני.</p>"), {"iso": {"value": "200"}}, exif, right)
        self.assertTrue(draft["publishable"])
        self.assertIn("f/8 · 1/100s · ISO 200 · 70mm", draft["facebook"])
        self.assertTrue(draft["image_url"].startswith("https://www.amitphotos.com/"))

    def test_a_missing_measurement_is_a_note_not_a_hard_block_and_missing_exif_adds_no_numbers(self):
        draft = gate.make_draft(self.data("rule_of_thirds", "<p><strong>x:</strong> טקסט.</p>"), {}, None, None)
        self.assertTrue(draft["publishable"])
        self.assertTrue(draft["notes"])
        self.assertNotIn("📏", draft["facebook"])


class EmailAndPublishTests(unittest.TestCase):
    def draft(self, ok=True):
        return {"title": "חלון", "image_url": "https://www.amitphotos.com/photos/thumb/p1.webp", "facebook": "fb <b>text</b>", "instagram": "ig text",
                "learn_url": "https://amitphotos.com/learn/p1", "problems": [] if ok else ["rule 'symmetry' but the centre is at 62%"], "notes": ["n"], "publishable": ok}

    def test_the_approval_mail_shows_the_draft_the_checks_and_the_approval_path_and_escapes_html(self):
        subject, html = gate.build_approval_email(self.draft(True), "https://github.com/o/r/actions/runs/1")
        self.assertIn("אישור פרסום", subject)
        self.assertIn("https://github.com/o/r/actions/runs/1", html)
        self.assertIn("Approve and deploy", html)
        self.assertIn("&lt;b&gt;text&lt;/b&gt;", html)
        self.assertNotIn("<b>text</b>", html)

    def test_a_blocked_draft_mail_says_it_was_stopped(self):
        subject, html = gate.build_approval_email(self.draft(False), "https://github.com/o/r/actions/runs/2")
        self.assertIn("לא מפרסם", subject)
        self.assertIn("הפוסט נעצר", html)
        self.assertNotIn("Approve and deploy", html)

    def test_send_email_uses_the_secrets_from_the_environment_and_never_prints_them(self):
        response = mock.Mock(ok=True, status_code=200)
        http = mock.Mock()
        http.post.return_value = response
        with mock.patch.dict(os.environ, {"RESEND_API_KEY": "re_secret_value", "APPROVAL_EMAIL": "owner@example.com"}), mock.patch("builtins.print") as printed:
            self.assertTrue(gate.send_email("s", "<p>h</p>", requests_module=http))
        call = http.post.call_args
        self.assertEqual(call.kwargs["json"]["to"], ["owner@example.com"])
        self.assertEqual(call.kwargs["headers"]["Authorization"], "Bearer re_secret_value")
        self.assertNotIn("re_secret_value", " ".join(str(c) for c in printed.call_args_list))
        self.assertNotIn("owner@example.com", " ".join(str(c) for c in printed.call_args_list))

    def test_without_secrets_no_mail_is_sent(self):
        http = mock.Mock()
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(gate.send_email("s", "h", requests_module=http))
        http.post.assert_not_called()

    def test_publish_refuses_a_draft_that_did_not_pass_and_posts_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "draft.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(self.draft(False), handle)
            with mock.patch.object(gate, "post_to_facebook") as fb, mock.patch.object(gate, "post_to_instagram") as ig:
                with self.assertRaises(SystemExit):
                    gate.publish(path)
            fb.assert_not_called()
            ig.assert_not_called()

    def test_publish_saves_the_approved_analysis_first_and_then_posts_to_both_networks(self):
        order = []
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "draft.json")
            draft = self.draft(True)
            draft["analysis"] = {"photo_id": "p1", "composition_rule": "rule_of_thirds"}
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(draft, handle)
            with mock.patch.object(gate, "save_analysis", side_effect=lambda a: order.append("save") or True) as save, \
                    mock.patch.object(gate, "post_to_facebook", side_effect=lambda *a: order.append("fb") or True) as fb, \
                    mock.patch.object(gate, "post_to_instagram", side_effect=lambda *a: order.append("ig") or True) as ig:
                gate.publish(path)
            save.assert_called_once_with({"photo_id": "p1", "composition_rule": "rule_of_thirds"})
            fb.assert_called_once_with("https://www.amitphotos.com/photos/thumb/p1.webp", "fb <b>text</b>")
            ig.assert_called_once_with("https://www.amitphotos.com/photos/thumb/p1.webp", "ig text")
        self.assertEqual(order, ["save", "fb", "ig"])

    def test_if_the_analysis_cannot_be_saved_nothing_is_posted(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "draft.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(self.draft(True), handle)
            with mock.patch.object(gate, "save_analysis", return_value=False), \
                    mock.patch.object(gate, "post_to_facebook") as fb, mock.patch.object(gate, "post_to_instagram") as ig:
                with self.assertRaises(SystemExit):
                    gate.publish(path)
            fb.assert_not_called()
            ig.assert_not_called()

    def test_save_analysis_posts_the_payload_with_the_admin_token_and_never_prints_it(self):
        response = mock.Mock(ok=True, status_code=200)
        with mock.patch.dict(os.environ, {"ADMIN_TOKEN": "admin_secret_value"}), mock.patch("requests.post", return_value=response) as post, \
                mock.patch("builtins.print") as printed:
            self.assertTrue(gate.save_analysis({"photo_id": "p1"}))
        self.assertTrue(post.call_args.args[0].endswith("/api/analyses/save"))
        self.assertEqual(post.call_args.kwargs["headers"], {"X-Admin-Password": "admin_secret_value"})
        self.assertEqual(post.call_args.kwargs["json"], {"photo_id": "p1"})
        self.assertNotIn("admin_secret_value", " ".join(str(c) for c in printed.call_args_list))
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(gate.save_analysis({"photo_id": "p1"}))
        self.assertFalse(gate.save_analysis(None))


class ServerErrorTextTests(unittest.TestCase):
    def test_the_server_error_code_is_shown_shortened_and_on_one_line(self):
        response = mock.Mock()
        response.json.return_value = {"error": "Claude API error (analysis) 529:\n  overloaded " + "x" * 400}
        text = gate.server_error_text(response)
        self.assertTrue(text.startswith("Claude API error (analysis) 529: overloaded"))
        self.assertNotIn("\n", text)
        self.assertLessEqual(len(text), 200)

    def test_a_non_json_or_odd_body_gives_an_empty_text(self):
        response = mock.Mock()
        response.json.side_effect = ValueError("not json")
        self.assertEqual(gate.server_error_text(response), "")
        response = mock.Mock()
        response.json.return_value = ["not", "a", "dict"]
        self.assertEqual(gate.server_error_text(response), "")


class WorkflowWiringTests(unittest.TestCase):
    def test_the_workflow_posts_only_through_the_approval_gate(self):
        path = os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "learn-generate.yml")
        text = open(path, encoding="utf-8").read()
        self.assertIn("environment: social-approval", text)
        self.assertIn("src/learn_post_gate.py prepare", text)
        self.assertIn("src/learn_post_gate.py publish", text)
        self.assertNotIn("learn_social_post.py", text)
        prepare = text.split("publish:")[0]
        self.assertNotIn("FACEBOOK_PAGE_TOKEN", prepare)
        self.assertNotIn("INSTAGRAM_PAGE_TOKEN", prepare)
        self.assertIn("dry run", text)
        self.assertIn("needs.prepare.outputs.publishable == 'true'", text)


if __name__ == "__main__":
    unittest.main()
