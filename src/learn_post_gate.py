#!/usr/bin/env python3
"""Approval gate for the /learn social posts (Facebook + Instagram).

Two stages, run by .github/workflows/learn-generate.yml:

  prepare  generate the analysis as a DRY RUN (nothing is saved on the site), check it against facts we can
           measure (real EXIF from data/photos.json, subject position measured from the pixels), build the
           captions, write draft.json and e-mail the owner for approval.
  publish  runs only after the owner approved the run in GitHub (environment "social-approval") and only for a
           draft that passed the checks. It saves the approved analysis (the /learn page goes live now) and then
           posts to Facebook and Instagram.

Nothing here prints a token, and draft.json contains only public post text and URLs.
"""

import json
import os
import re
import sys
import time

SITE_URL = "https://amitphotos.com"
GRAPH_API = "https://graph.facebook.com/v21.0"
FROM_EMAIL = "Amit Photos <contact@amitphotos.com>"

RULE_LABELS = {
    "rule_of_thirds": "חוק השליש",
    "symmetry": "סימטריה",
    "leading_lines": "קווי הובלה",
    "golden_ratio": "יחס הזהב",
    "framing": "ממסגר",
    "negative_space": "מרחב שלילי",
}

# ---------------------------------------------------------------- text ---------------------------------------------------------


def strip_html(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()


def clean_lead(composition_html, limit=220):
    """First paragraph without its bold heading ("סימטריה מרכזית:"), cut at a sentence end, never mid-sentence."""
    first = re.split(r"</p>", composition_html or "", maxsplit=1)[0]
    first = re.sub(r"<strong>.*?</strong>", "", first, count=1, flags=re.S)
    text = strip_html(first).lstrip(":-— ").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    ends = [m.end() for m in re.finditer(r"[.!?](?=\s|$)", cut)]
    if ends:
        return cut[: ends[-1]].strip()
    return cut.rsplit(" ", 1)[0].rstrip(",;:-— ") + "…"


def hashtag(tag):
    return "#" + re.sub(r"[^\w]", "", tag, flags=re.U)


# ---------------------------------------------------------------- EXIF ---------------------------------------------------------


def load_exif(photo_id, photos_path="data/photos.json"):
    try:
        with open(photos_path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    photos = data if isinstance(data, list) else data.get("photos", [])
    for photo in photos:
        if photo.get("id") == photo_id:
            exif = photo.get("exif") or {}
            return exif if exif.get("aperture") or exif.get("iso") or exif.get("shutter") or exif.get("focal") else None
    return None


def format_shutter(seconds):
    if not seconds:
        return None
    return f"1/{round(1 / seconds)}s" if seconds < 1 else f"{seconds:g}s"


def format_exif_line(exif):
    """Only the fields that exist; None when there is nothing real to show."""
    if not exif:
        return None
    parts = []
    if exif.get("aperture"):
        parts.append(f"f/{exif['aperture']:g}")
    shutter = format_shutter(exif.get("shutter"))
    if shutter:
        parts.append(shutter)
    if exif.get("iso"):
        parts.append(f"ISO {int(exif['iso'])}")
    if exif.get("focal"):
        parts.append(f"{exif['focal']:g}mm")
    return " · ".join(parts) or None


def _number(text):
    match = re.search(r"[\d.]+", str(text or ""))
    return float(match.group()) if match else None


def _shutter_seconds(text):
    match = re.search(r"1\s*/\s*(\d+(?:\.\d+)?)", str(text or ""))
    if match:
        return 1 / float(match.group(1))
    value = _number(text)
    return value


def parse_page_camera(page_html):
    """Camera values as the live /learn page shows them (what visitors read), from its public HTML."""
    text = strip_html(re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", page_html or ""))
    camera = {}
    patterns = {
        "aperture": r"צמצם\s*(f/[\d.]+)",
        "shutter": r"מהירות תריס\s*(1/\d+|[\d.]+)\s*s",
        "iso": r"ISO\s*(\d+)\s",
        "focal": r"מרחק מוקד\s*(\d+\s*mm)",
    }
    for key, pattern in patterns.items():
        match = re.search(pattern, text)
        if match:
            camera[key] = {"value": match.group(1)}
    return camera


def verify_camera(camera, exif):
    """Compare the camera values the analysis states with the real EXIF. Returns a list of problems."""
    if not exif:
        return ["no EXIF in data/photos.json: the camera settings could not be verified"]
    problems = []
    if exif.get("aperture") and camera.get("aperture"):
        stated = _number(camera["aperture"].get("value"))
        if stated is not None and abs(stated - exif["aperture"]) > 0.15:
            problems.append(f"aperture f/{stated:g} vs EXIF f/{exif['aperture']:g}")
    if exif.get("iso") and camera.get("iso"):
        stated = _number(camera["iso"].get("value"))
        if stated is not None and int(stated) != int(exif["iso"]):
            problems.append(f"ISO {int(stated)} vs EXIF {int(exif['iso'])}")
    if exif.get("focal") and camera.get("focal"):
        stated = _number(camera["focal"].get("value"))
        if stated is not None and abs(stated - exif["focal"]) > 2:
            problems.append(f"focal length {stated:g}mm vs EXIF {exif['focal']:g}mm")
    if exif.get("shutter") and camera.get("shutter"):
        stated = _shutter_seconds(camera["shutter"].get("value"))
        if stated and abs(stated - exif["shutter"]) / exif["shutter"] > 0.35:
            problems.append(f"shutter {camera['shutter'].get('value')} vs EXIF {format_shutter(exif['shutter'])}")
    return problems


# ----------------------------------------------------------- measurement -------------------------------------------------------


def measure_subject(image, grid=64):
    """Locate the most distinct region of the picture (colour distance from the median colour).

    Returns {"bbox": [x0, y0, x1, y1], "center": [cx, cy], "confidence": 0..1} in fractions of the frame, or None.
    It is a heuristic used to catch clear contradictions, never to praise or to decide the composition rule.
    """
    rgb = image.convert("RGB")
    width, height = rgb.size
    if width < 8 or height < 8:
        return None
    cols = grid
    rows = max(8, round(grid * height / width))
    small = rgb.resize((cols, rows))
    pixels = list(small.getdata())

    def median(values):
        ordered = sorted(values)
        return ordered[len(ordered) // 2]

    mr, mg, mb = (median([p[i] for p in pixels]) for i in range(3))
    dist = [((p[0] - mr) ** 2 + (p[1] - mg) ** 2 + (p[2] - mb) ** 2) ** 0.5 for p in pixels]
    mean = sum(dist) / len(dist)
    std = (sum((d - mean) ** 2 for d in dist) / len(dist)) ** 0.5
    if std < 1e-6:
        return None
    threshold = mean + 0.75 * std
    mask = [d > threshold for d in dist]

    seen = [False] * len(mask)
    best = None
    total_weight = sum(d for d, m in zip(dist, mask) if m) or 1.0
    for start in range(len(mask)):
        if not mask[start] or seen[start]:
            continue
        stack = [start]
        seen[start] = True
        weight = 0.0
        x0 = y0 = 10 ** 9
        x1 = y1 = -1
        while stack:
            index = stack.pop()
            y, x = divmod(index, cols)
            weight += dist[index]
            x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < rows and 0 <= nx < cols:
                    neighbour = ny * cols + nx
                    if mask[neighbour] and not seen[neighbour]:
                        seen[neighbour] = True
                        stack.append(neighbour)
        if best is None or weight > best["weight"]:
            best = {"weight": weight, "box": (x0, y0, x1, y1)}
    if best is None:
        return None
    x0, y0, x1, y1 = best["box"]
    bbox = [x0 / cols, y0 / rows, (x1 + 1) / cols, (y1 + 1) / rows]
    return {
        "bbox": [round(v, 3) for v in bbox],
        "center": [round((bbox[0] + bbox[2]) / 2, 3), round((bbox[1] + bbox[3]) / 2, 3)],
        "confidence": round(best["weight"] / total_weight, 3),
    }


def describe_position(center_x):
    if center_x < 0.40:
        return "left of centre"
    if center_x > 0.60:
        return "right of centre"
    return "near the centre"


_CENTER_CLAIM = re.compile(r"(במרכז|ממורכז|מרכז הפריים|באמצע הפריים|סימטריה (?:כמעט )?מושלמת)")
_THIRDS_CLAIM = re.compile(r"(חוק השליש|כלל השלישים|קו השליש|צומת השלישים|שליש ימני|שליש שמאלי)")


def verify_composition(rule, text, measurement):
    """Flag only clear contradictions between the analysis and the measured position of the main subject."""
    if not measurement:
        return ["subject position could not be measured: composition claims need a human check"]
    if measurement["confidence"] < 0.35:
        return ["subject position measurement is not confident: composition claims need a human check"]
    problems = []
    cx = measurement["center"][0]
    offset = abs(cx - 0.5)
    where = describe_position(cx)
    if rule == "symmetry" and offset > 0.10:
        problems.append(f"rule 'symmetry' but the main subject's centre is at {cx:.0%} of the width ({where})")
    if _CENTER_CLAIM.search(text or "") and offset > 0.10:
        problems.append(f"text says the subject is centred but it is at {cx:.0%} of the width ({where})")
    if rule == "rule_of_thirds" and offset < 0.05 and not re.search(r"(שליש)", text or ""):
        problems.append(f"rule 'rule of thirds' but the main subject sits at the centre ({cx:.0%})")
    if _THIRDS_CLAIM.search(text or "") and offset < 0.04 and measurement["bbox"][2] - measurement["bbox"][0] < 0.5:
        problems.append(f"text cites the rule of thirds but the main subject sits at the centre ({cx:.0%})")
    return problems


# --------------------------------------------------------------- captions ------------------------------------------------------


def build_captions(title, lead, exif_line, learn_url, tags, rule_label):
    tag_line = " ".join(["#צילום"] + [hashtag(t) for t in tags[:4] if hashtag(t) != "#"])
    body = [f"📸 {title}", "", lead]
    if exif_line:
        body += ["", f"📏 {exif_line}"]
    facebook = "\n".join(body + ["", f"👉 הניתוח המלא: {learn_url}", "", tag_line])
    instagram = "\n".join(body + ["", f"{rule_label} · ניתוח מלא באתר amitphotos.com", "", tag_line + " #amitphotos #photography"])
    return facebook, instagram


# ------------------------------------------------------------------ e-mail -----------------------------------------------------


def esc(text):
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


CAMERA_LABELS = (("aperture", "צמצם"), ("shutter", "מהירות תריס"), ("iso", "ISO"), ("focal", "מרחק מוקד"))


def page_preview_html(analysis):
    """What the /learn page will show, as plain escaped text (the page itself does not exist before approval)."""
    if not analysis:
        return "<p>אין תצוגה מקדימה.</p>"
    rule = RULE_LABELS.get(analysis.get("composition_rule", ""), analysis.get("composition_rule", ""))
    paragraphs = [strip_html(p) for p in re.split(r"</p>", analysis.get("composition_html", "")) if strip_html(p)]
    camera = analysis.get("camera_analysis") or {}
    camera_rows = "".join(
        f"<li><b>{label}:</b> {esc(str((camera.get(key) or {}).get('value', '')))}</li>" for key, label in CAMERA_LABELS if camera.get(key)
    )
    tags = " · ".join(esc(t) for t in analysis.get("tags") or [])
    body = "".join(f"<p>{esc(p)}</p>" for p in paragraphs)
    return (
        f'<div style="border:1px solid #ddd;border-radius:8px;padding:12px">'
        f"<p><b>חוק הקומפוזיציה:</b> {esc(rule)}</p>{body}"
        + (f"<p><b>הגדרות מצלמה:</b></p><ul>{camera_rows}</ul>" if camera_rows else "")
        + (f"<p><b>תגיות:</b> {tags}</p>" if tags else "")
        + "</div>"
    )


def build_approval_email(draft, run_url):
    ready = draft["publishable"]
    approvable = draft.get("approvable", ready)
    subject = ("אישור פרסום: " if ready else ("⚠ בעיות שנמצאו, לאישורך: " if approvable else "נדרש תיקון, לא מפרסם: ")) + draft["title"]
    problems = "".join(f'<li style="color:#b00020"><b>{esc(p)}</b></li>' for p in draft["problems"]) or "<li>לא נמצאו סתירות</li>"
    notes = "".join(f"<li>{esc(n)}</li>" for n in draft["notes"])
    preview = page_preview_html(draft.get("analysis") or {})
    marks = {"supported": "✔", "contradicted": "✖", "uncertain": "?"}
    claims = "".join(
        f"<li>{marks.get(c.get('verdict'), '?')} {esc(c.get('claim', ''))} — {esc(c.get('reason', ''))}</li>" for c in draft.get("second_check", [])
    ) or "<li>לא רצה</li>"
    action = (
        f'<p><b>לאישור:</b> פתח את <a href="{esc(run_url)}">ההרצה ב-GitHub</a> ולחץ Review deployments ← social-approval ← Approve and deploy. '
        "בלי אישור שלך שום דבר לא מתפרסם.</p>"
        if ready
        else (
            f'<p style="color:#b00020"><b>הבדיקות מצאו בעיות (מסומנות באדום למטה).</b> אם אתה מסכים לפרסם בכל זאת, פתח את '
            f'<a href="{esc(run_url)}">ההרצה ב-GitHub</a> ואשר (Review deployments ← social-approval ← Approve and deploy). '
            "אם לא — פשוט אל תאשר, ושום דבר לא יעלה. אפשר גם לאשר ואז לתקן את העמוד באדמין.</p>"
            if approvable
            else f'<p><b>הפוסט נעצר.</b> אין מה לאשר (חסר ניתוח או תמונה). הפרטים ב<a href="{esc(run_url)}">הרצה</a>.</p>'
        )
    )
    html = f"""<div dir="rtl" style="font-family:Arial,sans-serif;max-width:640px">
<h2>{esc(draft['title'])}</h2>
<img src="{esc(draft['image_url'])}" alt="" style="max-width:100%;border-radius:8px">
{action}
<h3>בדיקות</h3><ul>{problems}</ul>
<h4>הערות</h4><ul>{notes}</ul>
<h4>בדיקה שנייה (כל טענה מול התמונה)</h4><ul>{claims}</ul>
<p style="color:#555">הדף באתר ייווצר רק אחרי האישור, יחד עם הפוסטים.</p>
<h3>פייסבוק</h3><pre style="white-space:pre-wrap;font-family:inherit">{esc(draft['facebook'])}</pre>
<h3>אינסטגרם</h3><pre style="white-space:pre-wrap;font-family:inherit">{esc(draft['instagram'])}</pre>
<h3>תצוגה מקדימה של עמוד הניתוח</h3>
<p style="color:#555">העמוד עדיין לא קיים באתר — הוא נוצר רק אחרי האישור. עד אז הכתובת {esc(draft['learn_url'])} מחזירה 404, וזה צפוי.</p>
{preview}
</div>"""
    return subject, html


def send_email(subject, html, requests_module=None):
    import requests as _requests

    http = requests_module or _requests
    key, to = os.environ.get("RESEND_API_KEY", ""), os.environ.get("APPROVAL_EMAIL", "")
    if not key or not to:
        print("⚠️  RESEND_API_KEY / APPROVAL_EMAIL missing: no approval e-mail was sent")
        return False
    response = http.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"from": FROM_EMAIL, "to": [to], "subject": subject, "html": html},
        timeout=30,
    )
    print("approval e-mail:", "sent" if response.ok else f"failed (HTTP {response.status_code})")
    return bool(response.ok)


# ------------------------------------------------------------------ stages -----------------------------------------------------


def absolute(url):
    return f"https://www.amitphotos.com{url}" if url and url.startswith("/") else url


def second_check_findings(verification, rule, rule_locked=False):
    """Problems and notes from the separate sceptical pass (/api/analyses/verify). None = not run (unit tests).

    rule_locked: the owner chose the rule; a disagreement about the rule is then a note, never a problem.
    """
    if verification is None:
        return [], []
    if not isinstance(verification, dict) or verification.get("error") or not verification.get("claims"):
        reason = verification.get("error") if isinstance(verification, dict) else "no answer"
        return [f"second check could not run ({reason}): a human must review every claim"], []
    problems, notes = [], []
    for claim in verification["claims"]:
        if claim.get("verdict") == "contradicted":
            problems.append(f"claim contradicted by the picture: {claim.get('claim', '')} — {claim.get('reason', '')}")
        elif claim.get("verdict") == "uncertain":
            notes.append(f"uncertain claim: {claim.get('claim', '')} — {claim.get('reason', '')}")
    if verification.get("rule_fits") is False:
        suggested = verification.get("suggested_rule")
        message = f"rule '{rule}' does not fit the picture: {verification.get('rule_reason', '')}" + (f" (suggested: {suggested})" if suggested else "")
        if rule_locked:
            notes.append("the second check disagrees with the rule you chose (kept): " + message)
        else:
            problems.append(message)
    return problems, notes


def make_draft(data, camera_json, exif, measurement, verification=None, rule_locked=False):
    photo_id = data.get("photo_id", "")
    rule = data.get("composition_rule", "")
    text = strip_html(data.get("composition_html", ""))
    # The pixel measurement is a heuristic (it measured the reeds instead of the windmill, and flagged an honest
    # "the door is closer to the centre than recommended" as a centring claim). Since the second check judges every
    # claim against the picture, measurement findings are notes for the human, never blocks.
    problems = []
    notes = [f"measurement note: {item}" for item in verify_composition(rule, text, measurement)]
    if camera_json:
        camera_problems = verify_camera(camera_json, exif)
        # a missing EXIF is a note (the captions then carry no numbers); a contradiction is a problem
        for item in camera_problems:
            (notes if item.startswith("no EXIF") else problems).append(item)
    elif not exif:
        notes.append("no EXIF: the caption carries no camera numbers")
    check_problems, check_notes = second_check_findings(verification, rule, rule_locked)
    problems += check_problems
    notes += check_notes
    soft = [p for p in problems if "could not be measured" in p or "not confident" in p]
    hard = [p for p in problems if p not in soft]
    notes += soft
    tags = data.get("tags") or []
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except ValueError:
            tags = []
    learn_url = f"{SITE_URL}/learn/{photo_id}"
    facebook, instagram = build_captions(
        data.get("title", ""), clean_lead(data.get("composition_html", "")), format_exif_line(exif), learn_url, tags,
        RULE_LABELS.get(rule, rule),
    )
    analysis = {
        "photo_id": photo_id,
        "composition_rule": rule,
        "composition_html": data.get("composition_html", ""),
        "tags": tags,
        "annotations": data.get("annotations") or [],
        "camera_analysis": data.get("camera_analysis") or camera_json or {},
    }
    return {
        "analysis": analysis,
        "photo_id": photo_id,
        "title": data.get("title", ""),
        "rule": rule,
        "image_url": absolute(data.get("thumbnail") or data.get("url", "")),
        "learn_url": learn_url,
        "facebook": facebook,
        "instagram": instagram,
        "problems": hard,
        "notes": notes,
        "measurement": measurement,
        "second_check": (verification or {}).get("claims", []) if isinstance(verification, dict) else [],
        "publishable": not hard and bool(data.get("thumbnail") or data.get("url")),
        # The owner may approve a draft with problems (his decision); only a draft without content cannot be approved.
        "approvable": bool((data.get("thumbnail") or data.get("url")) and data.get("composition_html") and photo_id),
    }


def review_with_revision(data, check, revise, rule_locked=False):
    """Second check; if it found contradicted claims or an unfitting rule, ONE repair round and a fresh check.

    check(data) -> verification dict; revise(data, verification) -> revised fields or {"error": ...}.
    Returns (final_data, final_verification, revision_info_or_None). Never loops more than once.
    """
    verification = check(data)
    problems, _ = second_check_findings(verification, data.get("composition_rule", ""), rule_locked)
    usable = isinstance(verification, dict) and not verification.get("error") and verification.get("claims")
    if not usable or not problems:
        return data, verification, None
    revised = revise(data, verification)
    if not isinstance(revised, dict) or revised.get("error") or not revised.get("composition_html"):
        reason = revised.get("error") if isinstance(revised, dict) else "no answer"
        return data, verification, {"revised": False, "reason": reason, "first_problems": problems}
    fields = ("composition_html", "annotations", "tags") if rule_locked else ("composition_rule", "composition_html", "annotations", "tags")
    data = {**data, **{key: revised[key] for key in fields if key in revised}}
    return data, check(data), {"revised": True, "first_problems": problems}


def run_revision(analysis, verification, lock_rule=False):
    """Asks the site for one repair round. Returns the revised fields or {"error": ...}; never raises."""
    import requests

    token = os.environ.get("ADMIN_TOKEN", "")
    payload = {k: analysis.get(k) for k in ("photo_id", "composition_rule", "composition_html")}
    payload["problems"] = [c for c in verification.get("claims", []) if c.get("verdict") == "contradicted"]
    payload["rule_fits"] = verification.get("rule_fits")
    payload["rule_reason"] = verification.get("rule_reason", "")
    payload["suggested_rule"] = verification.get("suggested_rule")
    if lock_rule:
        payload["lock_rule"] = True
        payload["rule_fits"] = True
    try:
        response = requests.post(f"{SITE_URL}/api/analyses/revise", headers={"X-Admin-Password": token}, json=payload, timeout=120)
    except Exception:
        return {"error": "request failed"}
    if not response.ok:
        return {"error": f"HTTP {response.status_code} {server_error_text(response)}".strip()}
    try:
        return response.json()
    except ValueError:
        return {"error": "invalid JSON"}


def run_second_check(analysis):
    """Asks the site for the separate sceptical pass. Returns its JSON or {"error": ...}; never raises."""
    import requests

    token = os.environ.get("ADMIN_TOKEN", "")
    payload = {k: analysis.get(k) for k in ("photo_id", "composition_rule", "composition_html")}
    try:
        response = requests.post(f"{SITE_URL}/api/analyses/verify", headers={"X-Admin-Password": token}, json=payload, timeout=120)
    except Exception:
        return {"error": "request failed"}
    if not response.ok:
        return {"error": f"HTTP {response.status_code} {server_error_text(response)}".strip()}
    try:
        return response.json()
    except ValueError:
        return {"error": "invalid JSON"}


def server_error_text(response):
    """The server's own error code/message, shortened. The site never puts secrets in these messages."""
    try:
        body = response.json()
    except Exception:
        return ""
    if not isinstance(body, dict):
        return ""
    text = str(body.get("error", ""))
    if body.get("status"):
        text += f" (Claude HTTP {body['status']})"
    return re.sub(r"\s+", " ", text)[:200]


def generate_request_body(environ):
    """Always a dry run; a photo picked by the owner (and the rule it was screened for) is passed through."""
    body = {"dry_run": True}
    photo_id = (environ.get("PHOTO_ID") or "").strip()
    if photo_id and re.fullmatch(r"[A-Za-z0-9_-]{6,80}", photo_id):
        body["photo_id"] = photo_id
        rule = (environ.get("RULE") or "").strip()
        if rule in RULE_LABELS:
            body["rule"] = rule
    return body


def prepare(out_path="draft.json"):
    import requests
    from io import BytesIO

    from PIL import Image

    token = os.environ.get("ADMIN_TOKEN", "")
    if not token:
        print("❌ ADMIN_TOKEN missing")
        sys.exit(1)
    response = requests.post(f"{SITE_URL}/api/analyses/generate", headers={"X-Admin-Password": token}, json=generate_request_body(os.environ), timeout=120)
    if not response.ok:
        print(f"❌ generate failed: HTTP {response.status_code} {server_error_text(response)}")
        sys.exit(1)
    data = response.json()
    if data.get("error"):
        print("❌ server error while generating")
        sys.exit(1)
    exif = load_exif(data.get("photo_id", ""))
    measurement = None
    image_url = absolute(data.get("thumbnail") or data.get("url", ""))
    try:
        image = Image.open(BytesIO(requests.get(image_url, timeout=30).content))
        measurement = measure_subject(image)
    except Exception:  # a failed measurement is reported, never silently ignored
        measurement = None
    if not data.get("dry_run"):
        print("❌ the server did not honour dry_run: refusing to continue (the page may already be public)")
        sys.exit(1)
    camera = data.get("camera_analysis") or {}
    rule_locked = (os.environ.get("RULE") or "").strip() in RULE_LABELS and bool(os.environ.get("PHOTO_ID"))
    revise = (lambda d, v: run_revision(d, v, lock_rule=True)) if rule_locked else run_revision
    data, verification, revision = review_with_revision(data, run_second_check, revise, rule_locked)
    draft = make_draft(data, camera, exif, measurement, verification, rule_locked)
    if revision:
        if revision.get("revised"):
            draft["notes"].append("the first draft was revised once after the second check; first-round problems: " + " | ".join(revision["first_problems"]))
        else:
            draft["notes"].append(f"the repair round could not run ({revision.get('reason')}); the first-round problems stand")
        draft["revision"] = revision
    draft["notes"].append("nothing is saved on the site yet: the /learn page and the posts go live only after your approval")
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(draft, handle, ensure_ascii=False, indent=1)
    run_url = os.environ.get("RUN_URL", "")
    subject, html = build_approval_email(draft, run_url)
    send_email(subject, html)
    print(f"draft for '{draft['title']}': {'READY for approval' if draft['publishable'] else 'BLOCKED: ' + '; '.join(draft['problems'])}")
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as handle:
            handle.write(f"publishable={'true' if draft['publishable'] else 'false'}\n")
            handle.write(f"approvable={'true' if draft.get('approvable') else 'false'}\n")


def post_to_facebook(image_url, message):
    import requests

    page, token = os.environ.get("FACEBOOK_PAGE_ID", ""), os.environ.get("FACEBOOK_PAGE_TOKEN", "")
    if not page or not token:
        print("⚠️  Facebook credentials missing: skipped")
        return False
    response = requests.post(f"{GRAPH_API}/{page}/photos", data={"url": image_url, "message": message, "access_token": token}, timeout=30)
    print("Facebook:", "published" if response.ok else f"failed (HTTP {response.status_code})")
    return response.ok


def post_to_instagram(image_url, caption):
    import requests

    user, token = os.environ.get("INSTAGRAM_USER_ID", ""), os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
    if not user or not token:
        print("⚠️  Instagram credentials missing: skipped")
        return False
    container = requests.post(f"{GRAPH_API}/{user}/media", data={"image_url": image_url, "caption": caption, "access_token": token}, timeout=30)
    if not container.ok:
        print(f"Instagram container failed (HTTP {container.status_code})")
        return False
    creation_id = container.json().get("id")
    for _ in range(10):
        time.sleep(5)
        status = requests.get(f"{GRAPH_API}/{creation_id}", params={"fields": "status_code", "access_token": token}, timeout=30).json().get("status_code", "")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print("Instagram container error")
            return False
    publish = requests.post(f"{GRAPH_API}/{user}/media_publish", data={"creation_id": creation_id, "access_token": token}, timeout=30)
    print("Instagram:", "published" if publish.ok else f"failed (HTTP {publish.status_code})")
    return publish.ok


def save_analysis(analysis):
    """Saves the approved analysis on the site (this is what makes the /learn page public)."""
    import requests

    token = os.environ.get("ADMIN_TOKEN", "")
    if not token or not analysis:
        return False
    response = requests.post(f"{SITE_URL}/api/analyses/save", headers={"X-Admin-Password": token}, json=analysis, timeout=60)
    print("save analysis:", "saved" if response.ok else f"failed (HTTP {response.status_code})")
    return bool(response.ok)


def publish(draft_path="draft.json"):
    with open(draft_path, encoding="utf-8") as handle:
        draft = json.load(handle)
    if not draft.get("approvable", draft.get("publishable")):
        print("❌ the draft has no content to publish: nothing is posted")
        sys.exit(1)
    if draft.get("problems"):
        print(f"⚠️  publishing despite {len(draft['problems'])} problem(s) found by the checks: the owner approved it")
    if not draft.get("image_url"):
        print("❌ no image URL: nothing is posted")
        sys.exit(1)
    print(f"publishing '{draft['title']}' after the owner's approval")
    if not save_analysis(draft.get("analysis")):
        print("❌ the approved analysis could not be saved: nothing is posted")
        sys.exit(1)
    facebook = post_to_facebook(draft["image_url"], draft["facebook"])
    instagram = post_to_instagram(draft["image_url"], draft["instagram"])
    if not (facebook or instagram):
        sys.exit(1)



# ------------------------------------------------------------------ weekly pick ------------------------------------------------
# propose: screen photos (site endpoint), open a GitHub issue with up to 3 candidates and e-mail the owner.
# pick:    the owner comments 1, 2 or 3 on that issue; the chosen photo and its rule go to prepare.

PICK_LABEL = "learn-pick"
CANDIDATES_MARK = "learn-candidates"


def build_pick_issue(candidates):
    lines = [
        "בחירת תמונה לניתוח השבוע. **הגב על ה-Issue הזה במספר בלבד: 1, 2 או 3.**",
        "אחרי הבחירה ייכתב ניתוח לתמונה שבחרת, הוא ייבדק, ותקבל מייל אישור לפני שמשהו עולה לאתר או לרשתות.",
        "אם החוק שזוהה לא נכון, כתוב אחרי המספר את החוק הנכון, למשל: `2 שליש` (שליש, סימטריה, קווים, זהב, מסגור, מרחב).",
        "**אל תשיב למייל** — הבחירה נקלטת רק כתגובה כאן ב-GitHub.",
        "",
    ]
    for index, candidate in enumerate(candidates, 1):
        rule = RULE_LABELS.get(candidate.get("rule", ""), candidate.get("rule", ""))
        lines += [
            f"### {index}. {candidate.get('title', '')}",
            f"![{candidate.get('title', '')}]({absolute(candidate.get('thumbnail', ''))})",
            f"**חוק:** {rule} · **ודאות:** {round(float(candidate.get('clarity', 0)) * 100)}%",
            candidate.get("reason", ""),
            "",
        ]
    payload = [{k: c.get(k) for k in ("photo_id", "title", "thumbnail", "rule", "clarity")} for c in candidates]
    lines.append(f"<!-- {CANDIDATES_MARK}: {json.dumps(payload, ensure_ascii=False)} -->")
    return "בחירת תמונה לניתוח השבוע", "\n".join(lines)


def parse_candidates(issue_body):
    match = re.search(r"<!-- " + CANDIDATES_MARK + r": (\[.*?\]) -->", issue_body or "", re.S)
    if not match:
        return []
    try:
        data = json.loads(match.group(1))
    except ValueError:
        return []
    return [c for c in data if isinstance(c, dict) and c.get("photo_id") and c.get("rule") in RULE_LABELS]


RULE_KEYWORDS = {
    "שליש": "rule_of_thirds", "חוק השליש": "rule_of_thirds", "כלל השליש": "rule_of_thirds", "thirds": "rule_of_thirds", "rule_of_thirds": "rule_of_thirds",
    "סימטריה": "symmetry", "symmetry": "symmetry",
    "קווים": "leading_lines", "קווי הובלה": "leading_lines", "קווים מובילים": "leading_lines", "leading_lines": "leading_lines",
    "זהב": "golden_ratio", "יחס הזהב": "golden_ratio", "golden_ratio": "golden_ratio",
    "מסגור": "framing", "ממסגר": "framing", "מסגרת": "framing", "framing": "framing",
    "מרחב": "negative_space", "מרחב שלילי": "negative_space", "negative_space": "negative_space",
}


def parse_pick(comment, available):
    """A bare number, optionally followed by a rule that overrides the screened one ("2 שליש").

    Returns (number, rule_or_None) or None. Anything else (e.g. "2 please") is not a pick, so ordinary comments never
    start an analysis.
    """
    match = re.fullmatch(r"\s*#?\s*([1-9])\s*\.?\s*(?:[-–—:,]\s*)?(.*?)\s*", comment or "", re.S)
    if not match:
        return None
    number = int(match.group(1))
    if not 1 <= number <= available:
        return None
    word = re.sub(r"\s+", " ", match.group(2)).strip().lower()
    if not word:
        return number, None
    rule = RULE_KEYWORDS.get(word)
    return (number, rule) if rule else None


def parse_choice(comment, available):
    """Only a bare number (optionally with #) counts, so an ordinary comment never triggers an analysis."""
    picked = parse_pick(comment, available)
    return picked[0] if picked and picked[1] is None else None


def build_pick_email(candidates, issue_url):
    if not candidates:
        return "השבוע לא נמצאה תמונה מתאימה לניתוח", (
            '<div dir="rtl" style="font-family:Arial,sans-serif"><p>הסינון לא מצא השבוע תמונה שמדגימה חוק קומפוזיציה בבירור, '
            "ולכן לא נכתב ניתוח ולא יפורסם פוסט. אין צורך בפעולה.</p></div>"
        )
    items = "".join(
        f'<div style="margin:12px 0"><b>{i}. {esc(c.get("title", ""))}</b><br>'
        f'<img src="{esc(absolute(c.get("thumbnail", "")))}" alt="" style="max-width:100%;border-radius:8px"><br>'
        f'{esc(RULE_LABELS.get(c.get("rule", ""), c.get("rule", "")))} · ודאות {round(float(c.get("clarity", 0)) * 100)}%<br>{esc(c.get("reason", ""))}</div>'
        for i, c in enumerate(candidates, 1)
    )
    html = (
        f'<div dir="rtl" style="font-family:Arial,sans-serif;max-width:640px"><h2>בחר תמונה לניתוח השבוע</h2>'
        f'<p><b>איך בוחרים:</b> פתח את <a href="{esc(issue_url)}">ה-Issue ב-GitHub</a> והגב במספר בלבד (1, 2 או 3). '
        "אם החוק לא נכון, הוסף אותו אחרי המספר, למשל <b>2 שליש</b>. "
        "<b>אל תשיב למייל הזה</b> — הבחירה נקלטת רק בתגובה ב-GitHub. "
        "אחרי זה תקבל מייל אישור עם הניתוח והפוסטים, ושום דבר לא יעלה בלי אישורך.</p>"
        f"{items}</div>"
    )
    return "בחר תמונה לניתוח השבוע", html


def github_api(method, path, payload=None):
    import requests

    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    response = requests.request(
        method, f"https://api.github.com/repos/{repo}{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        json=payload, timeout=30,
    )
    return response


def propose():
    import requests

    token = os.environ.get("ADMIN_TOKEN", "")
    response = requests.post(f"{SITE_URL}/api/analyses/candidates", headers={"X-Admin-Password": token}, json={"count": 3, "pool": 8}, timeout=300)
    if not response.ok:
        print(f"❌ screening failed: HTTP {response.status_code} {server_error_text(response)}")
        sys.exit(1)
    candidates = response.json().get("candidates") or []
    if not candidates:
        subject, html = build_pick_email([], "")
        send_email(subject, html)
        print("no clear candidate this week: nothing proposed")
        return
    github_api("POST", "/labels", {"name": PICK_LABEL, "color": "0e8a16", "description": "weekly learn photo pick"})
    title, body = build_pick_issue(candidates)
    created = github_api("POST", "/issues", {"title": title, "body": body, "labels": [PICK_LABEL]})
    if not created.ok:
        print(f"❌ could not open the pick issue: HTTP {created.status_code}")
        sys.exit(1)
    issue_url = created.json().get("html_url", "")
    subject, html = build_pick_email(candidates, issue_url)
    send_email(subject, html)
    print(f"proposed {len(candidates)} candidates: {issue_url}")


def pick(event_path=None):
    """Reads the issue_comment event, writes photo_id/rule to GITHUB_OUTPUT, comments back and closes the issue."""
    with open(event_path or os.environ.get("GITHUB_EVENT_PATH", ""), encoding="utf-8") as handle:
        event = json.load(handle)
    issue = event.get("issue") or {}
    number = issue.get("number")
    candidates = parse_candidates(issue.get("body", ""))
    picked = parse_pick((event.get("comment") or {}).get("body", ""), len(candidates))
    if not candidates or not picked:
        print("the comment is not a valid choice: nothing to do")
        return None
    choice, override = picked
    chosen = dict(candidates[choice - 1])
    if override:
        chosen["rule"] = override
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as handle:
            handle.write(f"photo_id={chosen['photo_id']}\nrule={chosen['rule']}\n")
    github_api("POST", f"/issues/{number}/comments", {"body": f"נבחרה תמונה {choice}: {chosen.get('title', '')} (חוק: {RULE_LABELS.get(chosen['rule'], chosen['rule'])}). הניתוח נכתב ונבדק עכשיו, ומייל אישור יישלח בסיום."})
    github_api("PATCH", f"/issues/{number}", {"state": "closed"})
    print(f"picked {choice}: {chosen['photo_id']} ({chosen['rule']})")
    return chosen


def main(argv):
    stages = {"prepare": prepare, "publish": publish, "propose": propose, "pick": pick}
    if len(argv) < 2 or argv[1] not in stages:
        print("usage: learn_post_gate.py propose|pick|prepare|publish")
        return 2
    stages[argv[1]]()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
