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


class SecondCheckTests(unittest.TestCase):
    def data(self):
        return {"photo_id": "p1", "title": "טחנה", "composition_rule": "symmetry", "composition_html": "<p><strong>סימטריה:</strong> טקסט.</p>", "thumbnail": "/photos/thumb/p1.webp", "tags": []}

    def centre(self):
        return gate.measure_subject(wall_with_block(0.40, 0.60))

    def test_a_contradicted_claim_or_an_unfitting_rule_blocks_and_is_explained(self):
        verification = {"claims": [
            {"claim": "כמעט במרכז", "verdict": "supported", "reason": "56%"},
            {"claim": "משתקפת בשלמות", "verdict": "contradicted", "reason": "רוב החלק התחתון קני סוף"},
            {"claim": "אור דרמטי", "verdict": "uncertain", "reason": "לא ברור"},
        ], "rule_fits": False, "rule_reason": "השמיים שולטים", "suggested_rule": "negative_space"}
        draft = gate.make_draft(self.data(), {}, None, self.centre(), verification)
        self.assertFalse(draft["publishable"])
        self.assertTrue(any("משתקפת בשלמות" in p for p in draft["problems"]))
        self.assertTrue(any("does not fit" in p and "negative_space" in p for p in draft["problems"]))
        self.assertTrue(any("אור דרמטי" in n for n in draft["notes"]))
        self.assertEqual(len(draft["second_check"]), 3)

    def test_all_supported_and_a_fitting_rule_passes(self):
        verification = {"claims": [{"claim": "סימטרי", "verdict": "supported", "reason": "r"}], "rule_fits": True}
        draft = gate.make_draft(self.data(), {}, None, self.centre(), verification)
        self.assertTrue(draft["publishable"])

    def test_a_second_check_that_could_not_run_fails_closed(self):
        for verification in ({"error": "HTTP 502 CLAUDE_VERIFY_FAILED"}, {"claims": []}, "garbage"):
            draft = gate.make_draft(self.data(), {}, None, self.centre(), verification)
            self.assertFalse(draft["publishable"], verification)
            self.assertTrue(any("could not run" in p for p in draft["problems"]))

    def test_the_mail_lists_every_claim_with_its_verdict(self):
        verification = {"claims": [{"claim": "משתקפת בשלמות", "verdict": "contradicted", "reason": "קני סוף"}], "rule_fits": True}
        draft = gate.make_draft(self.data(), {}, None, self.centre(), verification)
        draft.update({"facebook": "f", "instagram": "i"})
        subject, html = gate.build_approval_email(draft, "https://github.com/o/r/actions/runs/3")
        self.assertIn("✖ משתקפת בשלמות", html)
        self.assertIn("בדיקה שנייה", html)

    def test_run_second_check_never_raises_and_reports_errors(self):
        with mock.patch.dict(os.environ, {"ADMIN_TOKEN": "t"}), mock.patch("requests.post", side_effect=OSError("down")):
            self.assertEqual(gate.run_second_check({"photo_id": "p1"}), {"error": "request failed"})
        bad = mock.Mock(ok=False, status_code=502)
        bad.json.return_value = {"error": "VERIFY_PARSE_FAILED"}
        with mock.patch.dict(os.environ, {"ADMIN_TOKEN": "t"}), mock.patch("requests.post", return_value=bad) as post:
            self.assertEqual(gate.run_second_check({"photo_id": "p1", "composition_rule": "symmetry", "composition_html": "h", "extra": 1}), {"error": "HTTP 502 VERIFY_PARSE_FAILED"})
        self.assertEqual(post.call_args.kwargs["json"], {"photo_id": "p1", "composition_rule": "symmetry", "composition_html": "h"})
        self.assertTrue(post.call_args.args[0].endswith("/api/analyses/verify"))


class PagePreviewTests(unittest.TestCase):
    def test_the_mail_previews_the_page_and_says_the_link_is_404_until_approval(self):
        draft = {"title": "טחנה", "image_url": "https://www.amitphotos.com/photos/thumb/p1.webp", "facebook": "f", "instagram": "i",
                 "learn_url": "https://amitphotos.com/learn/p1", "problems": [], "notes": [], "publishable": True,
                 "analysis": {"composition_rule": "rule_of_thirds", "composition_html": "<p><strong>חוק השליש:</strong> הטחנה בצד ימין.</p><p><strong>אור:</strong> שמיים <b>סוערים</b>.</p>",
                              "camera_analysis": {"aperture": {"value": "f/22"}, "iso": {"value": "90"}}, "tags": ["נוף", "<script>"]}}
        subject, html = gate.build_approval_email(draft, "https://github.com/o/r/actions/runs/4")
        self.assertIn("תצוגה מקדימה של עמוד הניתוח", html)
        self.assertIn("מחזירה 404, וזה צפוי", html)
        self.assertIn("חוק השליש", html)
        self.assertIn("הטחנה בצד ימין.", html)
        self.assertIn("<b>צמצם:</b> f/22", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertNotIn("<script>", html)
        self.assertNotIn('<a href="https://amitphotos.com/learn/p1"', html, "no clickable link to a page that does not exist yet")

    def test_without_an_analysis_the_preview_says_so(self):
        self.assertIn("אין תצוגה מקדימה", gate.page_preview_html({}))


class RevisionRoundTests(unittest.TestCase):
    def data(self):
        return {"photo_id": "p1", "composition_rule": "framing", "composition_html": "<p><strong>a:</strong> הנושא מואר.</p>", "tags": ["x"], "annotations": []}

    bad = {"claims": [{"claim": "הנושא מואר", "verdict": "contradicted", "reason": "צללית"}], "rule_fits": True}
    good = {"claims": [{"claim": "הנושא צללית", "verdict": "supported", "reason": "r"}], "rule_fits": True}

    def test_a_clean_first_check_means_no_repair_round(self):
        revise = mock.Mock()
        data, verification, revision = gate.review_with_revision(self.data(), lambda d: self.good, revise)
        revise.assert_not_called()
        self.assertIsNone(revision)
        self.assertEqual(verification, self.good)

    def test_contradicted_claims_get_one_repair_round_and_a_fresh_check(self):
        checks = iter([self.bad, self.good])
        seen = []
        def check(d):
            seen.append(d["composition_html"])
            return next(checks)
        revised = {"composition_rule": "framing", "composition_html": "<p><strong>a:</strong> הנושא צללית.</p>", "annotations": [], "tags": ["y"]}
        data, verification, revision = gate.review_with_revision(self.data(), check, lambda d, v: revised)
        self.assertEqual(seen, ["<p><strong>a:</strong> הנושא מואר.</p>", "<p><strong>a:</strong> הנושא צללית.</p>"])
        self.assertEqual(data["composition_html"], revised["composition_html"])
        self.assertEqual(data["tags"], ["y"])
        self.assertEqual(verification, self.good)
        self.assertTrue(revision["revised"])
        draft = gate.make_draft({**data, "title": "t", "thumbnail": "/photos/thumb/p1.webp"}, {}, None, gate.measure_subject(wall_with_block(0.40, 0.60)), verification)
        self.assertTrue(draft["publishable"])

    def test_only_one_round_even_if_the_revision_is_still_wrong(self):
        calls = {"check": 0, "revise": 0}
        def check(d):
            calls["check"] += 1
            return self.bad
        def revise(d, v):
            calls["revise"] += 1
            return {"composition_rule": "framing", "composition_html": "<p><strong>a:</strong> עדיין שגוי.</p>"}
        data, verification, revision = gate.review_with_revision(self.data(), check, revise)
        self.assertEqual(calls, {"check": 2, "revise": 1})
        draft = gate.make_draft({**data, "title": "t", "thumbnail": "/x"}, {}, None, gate.measure_subject(wall_with_block(0.40, 0.60)), verification)
        self.assertFalse(draft["publishable"])

    def test_a_failed_repair_keeps_the_first_problems(self):
        data, verification, revision = gate.review_with_revision(self.data(), lambda d: self.bad, lambda d, v: {"error": "HTTP 502 REVISE_INVALID"})
        self.assertFalse(revision["revised"])
        self.assertEqual(revision["reason"], "HTTP 502 REVISE_INVALID")
        self.assertEqual(verification, self.bad)
        self.assertEqual(data["composition_html"], self.data()["composition_html"])

    def test_a_second_check_that_could_not_run_does_not_trigger_a_repair(self):
        revise = mock.Mock()
        data, verification, revision = gate.review_with_revision(self.data(), lambda d: {"error": "HTTP 502"}, revise)
        revise.assert_not_called()
        self.assertIsNone(revision)

    def test_run_revision_sends_only_the_contradicted_claims_and_the_rule_verdict(self):
        response = mock.Mock(ok=True, status_code=200)
        response.json.return_value = {"composition_html": "<p>x</p>"}
        verification = {"claims": [{"claim": "a", "verdict": "supported"}, {"claim": "b", "verdict": "contradicted", "reason": "r"}], "rule_fits": False, "rule_reason": "rr", "suggested_rule": "negative_space"}
        with mock.patch.dict(os.environ, {"ADMIN_TOKEN": "t"}), mock.patch("requests.post", return_value=response) as post:
            self.assertEqual(gate.run_revision(self.data(), verification), {"composition_html": "<p>x</p>"})
        payload = post.call_args.kwargs["json"]
        self.assertTrue(post.call_args.args[0].endswith("/api/analyses/revise"))
        self.assertEqual(payload["problems"], [{"claim": "b", "verdict": "contradicted", "reason": "r"}])
        self.assertEqual((payload["rule_fits"], payload["suggested_rule"]), (False, "negative_space"))
        with mock.patch.dict(os.environ, {"ADMIN_TOKEN": "t"}), mock.patch("requests.post", side_effect=OSError("down")):
            self.assertEqual(gate.run_revision(self.data(), verification), {"error": "request failed"})


class WeeklyPickTests(unittest.TestCase):
    candidates = [
        {"photo_id": "PhotoA_123456", "title": "גשר", "thumbnail": "/photos/thumb/a.webp", "rule": "framing", "clarity": 0.92, "reason": "קשת ממסגרת"},
        {"photo_id": "PhotoB_123456", "title": "מסילה", "thumbnail": "/photos/thumb/b.webp", "rule": "leading_lines", "clarity": 0.88, "reason": "קווים מובילים"},
        {"photo_id": "PhotoC_123456", "title": "אגם", "thumbnail": "/photos/thumb/c.webp", "rule": "symmetry", "clarity": 0.81, "reason": "השתקפות"},
    ]

    def test_the_issue_shows_the_candidates_and_carries_them_for_the_pick(self):
        title, body = gate.build_pick_issue(self.candidates)
        self.assertIn("1, 2 או 3", body)
        self.assertIn("### 2. מסילה", body)
        self.assertIn("https://www.amitphotos.com/photos/thumb/a.webp", body)
        self.assertIn("92%", body)
        parsed = gate.parse_candidates(body)
        self.assertEqual([c["photo_id"] for c in parsed], ["PhotoA_123456", "PhotoB_123456", "PhotoC_123456"])
        self.assertEqual(gate.parse_candidates("no marker"), [])

    def test_only_a_bare_number_in_range_is_a_choice(self):
        for text, expected in (("1", 1), (" 2 ", 2), ("#3", 3), ("3.", 3), ("4", None), ("0", None), ("I like 2", None), ("2 please", None), ("", None), (None, None)):
            self.assertEqual(gate.parse_choice(text, 3), expected, repr(text))
        self.assertIsNone(gate.parse_choice("3", 2))

    def write_event(self, folder, comment):
        title, body = gate.build_pick_issue(self.candidates)
        path = os.path.join(folder, "event.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"issue": {"number": 7, "body": body}, "comment": {"body": comment}}, handle)
        return path

    def test_pick_writes_the_photo_and_rule_comments_and_closes_the_issue(self):
        with tempfile.TemporaryDirectory() as folder:
            out = os.path.join(folder, "out.txt")
            with mock.patch.dict(os.environ, {"GITHUB_OUTPUT": out}), mock.patch.object(gate, "github_api") as api:
                chosen = gate.pick(self.write_event(folder, "2"))
            self.assertEqual(chosen["photo_id"], "PhotoB_123456")
            self.assertEqual(open(out, encoding="utf-8").read(), "photo_id=PhotoB_123456\nrule=leading_lines\n")
            calls = [(c.args[0], c.args[1]) for c in api.call_args_list]
            self.assertEqual(calls, [("POST", "/issues/7/comments"), ("PATCH", "/issues/7")])
            self.assertEqual(api.call_args_list[1].args[2], {"state": "closed"})

    def test_an_ordinary_comment_does_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            out = os.path.join(folder, "out.txt")
            with mock.patch.dict(os.environ, {"GITHUB_OUTPUT": out}), mock.patch.object(gate, "github_api") as api:
                self.assertIsNone(gate.pick(self.write_event(folder, "nice photos!")))
            api.assert_not_called()
            self.assertFalse(os.path.exists(out))

    def test_propose_with_no_clear_candidate_mails_that_and_opens_no_issue(self):
        response = mock.Mock(ok=True, status_code=200)
        response.json.return_value = {"candidates": []}
        with mock.patch("requests.post", return_value=response), mock.patch.object(gate, "github_api") as api, mock.patch.object(gate, "send_email") as mail:
            gate.propose()
        api.assert_not_called()
        self.assertIn("לא נמצאה", mail.call_args.args[0])

    def test_propose_opens_the_issue_and_mails_its_link(self):
        response = mock.Mock(ok=True, status_code=200)
        response.json.return_value = {"candidates": self.candidates}
        created = mock.Mock(ok=True, status_code=201)
        created.json.return_value = {"html_url": "https://github.com/o/r/issues/9"}
        def api(method, path, payload=None):
            return created if path == "/issues" else mock.Mock(ok=True, status_code=201)
        with mock.patch("requests.post", return_value=response) as post, mock.patch.object(gate, "github_api", side_effect=api) as github, \
                mock.patch.object(gate, "send_email") as mail:
            gate.propose()
        self.assertTrue(post.call_args.args[0].endswith("/api/analyses/candidates"))
        paths = [c.args[1] for c in github.call_args_list]
        self.assertEqual(paths, ["/labels", "/issues"])
        self.assertEqual(github.call_args_list[1].args[2]["labels"], ["learn-pick"])
        subject, html = mail.call_args.args
        self.assertIn("בחר תמונה", subject)
        self.assertIn("https://github.com/o/r/issues/9", html)

    def test_prepare_always_asks_for_a_dry_run_and_passes_the_pick_through(self):
        self.assertEqual(gate.generate_request_body({}), {"dry_run": True})
        self.assertEqual(gate.generate_request_body({"PHOTO_ID": "PhotoB_123456", "RULE": "leading_lines"}), {"dry_run": True, "photo_id": "PhotoB_123456", "rule": "leading_lines"})
        self.assertEqual(gate.generate_request_body({"PHOTO_ID": "PhotoB_123456", "RULE": "spiral"}), {"dry_run": True, "photo_id": "PhotoB_123456"})
        self.assertEqual(gate.generate_request_body({"PHOTO_ID": "../etc", "RULE": "framing"}), {"dry_run": True})


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
        self.assertIn("github.event.comment.user.login == github.repository_owner", text)
        self.assertIn("contains(github.event.issue.labels.*.name, 'learn-pick')", text)
        self.assertIn("src/learn_post_gate.py propose", text)
        self.assertIn("src/learn_post_gate.py pick", text)
        propose_job = text.split("  propose:")[1].split("  prepare:")[0]
        self.assertNotIn("FACEBOOK_PAGE_TOKEN", propose_job)
        self.assertNotIn("INSTAGRAM_PAGE_TOKEN", propose_job)


if __name__ == "__main__":
    unittest.main()
