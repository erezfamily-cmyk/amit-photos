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


def build_approval_email(draft, run_url):
    ready = draft["publishable"]
    subject = ("אישור פרסום: " if ready else "נדרש תיקון, לא מפרסם: ") + draft["title"]
    problems = "".join(f"<li>{esc(p)}</li>" for p in draft["problems"]) or "<li>לא נמצאו סתירות</li>"
    notes = "".join(f"<li>{esc(n)}</li>" for n in draft["notes"])
    action = (
        f'<p><b>לאישור:</b> פתח את <a href="{esc(run_url)}">ההרצה ב-GitHub</a> ולחץ Review deployments ← social-approval ← Approve and deploy. '
        "בלי אישור שלך שום דבר לא מתפרסם.</p>"
        if ready
        else f'<p><b>הפוסט נעצר.</b> הבדיקות מצאו סתירות. הפרטים ב<a href="{esc(run_url)}">הרצה</a>. עמוד הניתוח כבר נשמר באתר ועשוי להכיל את אותן טעויות.</p>'
    )
    html = f"""<div dir="rtl" style="font-family:Arial,sans-serif;max-width:640px">
<h2>{esc(draft['title'])}</h2>
<img src="{esc(draft['image_url'])}" alt="" style="max-width:100%;border-radius:8px">
{action}
<h3>בדיקות</h3><ul>{problems}</ul>
<h4>הערות</h4><ul>{notes}</ul>
<p style="color:#555">הדף באתר ייווצר רק אחרי האישור, יחד עם הפוסטים.</p>
<h3>פייסבוק</h3><pre style="white-space:pre-wrap;font-family:inherit">{esc(draft['facebook'])}</pre>
<h3>אינסטגרם</h3><pre style="white-space:pre-wrap;font-family:inherit">{esc(draft['instagram'])}</pre>
<p>עמוד הניתוח: <a href="{esc(draft['learn_url'])}">{esc(draft['learn_url'])}</a></p>
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


def make_draft(data, camera_json, exif, measurement):
    photo_id = data.get("photo_id", "")
    rule = data.get("composition_rule", "")
    text = strip_html(data.get("composition_html", ""))
    problems = verify_composition(rule, text, measurement)
    notes = []
    if camera_json:
        camera_problems = verify_camera(camera_json, exif)
        # a missing EXIF is a note (the captions then carry no numbers); a contradiction is a problem
        for item in camera_problems:
            (notes if item.startswith("no EXIF") else problems).append(item)
    elif not exif:
        notes.append("no EXIF: the caption carries no camera numbers")
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
        "publishable": not hard and bool(data.get("thumbnail") or data.get("url")),
    }


def server_error_text(response):
    """The server's own error code/message, shortened. The site never puts secrets in these messages."""
    try:
        body = response.json()
    except Exception:
        return ""
    text = str(body.get("error", "")) if isinstance(body, dict) else ""
    return re.sub(r"\s+", " ", text)[:200]


def prepare(out_path="draft.json"):
    import requests
    from io import BytesIO

    from PIL import Image

    token = os.environ.get("ADMIN_TOKEN", "")
    if not token:
        print("❌ ADMIN_TOKEN missing")
        sys.exit(1)
    response = requests.post(f"{SITE_URL}/api/analyses/generate", headers={"X-Admin-Password": token}, json={"dry_run": True}, timeout=120)
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
    draft = make_draft(data, camera, exif, measurement)
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
    if not draft.get("publishable") or draft.get("problems"):
        print("❌ the draft did not pass the checks: nothing is posted")
        sys.exit(1)
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


def main(argv):
    if len(argv) < 2 or argv[1] not in ("prepare", "publish"):
        print("usage: learn_post_gate.py prepare|publish")
        return 2
    prepare() if argv[1] == "prepare" else publish()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
