#!/usr/bin/env python3
"""
Build the bilingual Amit Photos "50 tips" PDF guides.

The selected portfolio images are intentionally restricted to photos that were
already marked visual_complete, score > 85, owner_review_required=false and
material_problem=false in data/portfolio-curation-scores.json on 2026-10-02.
"""

from __future__ import annotations

import html
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qsl, urlunparse

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build" / "free-guide"
ASSETS = BUILD / "assets"
PREVIEWS = BUILD / "previews"
SITE = "https://amitphotos.com"
CAMPAIGN = "202610_freeguide_photo_tips"

PHOTOS = {
    "cover": ("1z65uWUxPZhNE29Zr2x3nKZT6wtlg5adj", "שלווה בלילה הערבי"),
    "composition": ("1to7-FhYiQPE4OMsTMqzDXpHyIgblTueb", "סימטריה גיאומטרית בצהוב"),
    "light": ("1PD7M4RiX41DQGMl_1VnBJE_3cO-xIZBi", "כיפת בזיליקת סן פיטרו"),
    "focus": ("1ZgvZFQ5APlGXKzwrLMe4g7xAA-qPTZ5z", "פרחי סחלב סגולים"),
    "macro": ("1JK0T5D9bSH3ZJJ0_HMWAWVa6bUi-BoaG", "ורד ורוד מלא"),
    "motion": ("161Eix_UKWee55fjpQq4gGuiaSjtNIQFw", "שחף בנוף איטלקי"),
    "landscape": ("17Mi83JaiUca3PrKf4BTMG14oIsFlgMjb", "אובליסק בוותיקן"),
    "story": ("1PeF5YhwImK9XCDNVH0rJvyuf6As_3X7a", "גשר אהבה של נעילות"),
    "night": ("1FcgYpVjgppXtq1eVZUfRSNFMMR-fmlIB", "הנצנצים הלבנים של שייח זאיד"),
    "editing": ("1fQMiyv96P6JhiQL9jsPrd65Xt_mghWHO", "גרפיטי צבעוני תלת ממדי"),
    "extra1": ("1-iqxlYN773fYnouAo4H6C4MSrWGWRFZc", "חמנייה בשדה"),
    "extra2": ("1-XeHZVRXouPbQVrsbIMbhWy18f33V6BK", "משכן הלבן באבו דאבי"),
}

HE_SECTIONS = [
    ("קומפוזיציה", "לפני הגדרות — בנו תמונה", "composition", "composition", [
        "החליטו מה הנושא המרכזי לפני שאתם נוגעים בהגדרות.",
        "בדקו גם את שולי הפריים. חפץ קטן או כתם בהיר בקצה יכולים למשוך תשומת לב מהנושא.",
        "שנו מיקום לפני שאתם עושים זום; חצי מטר ימינה יכול לשנות הכול.",
        "חוק השלישים הוא כלי פשוט לסידור הפריים, לא חובה. השתמשו בו רק כשהוא מחזק את התמונה.",
        "חפשו מה נמצא קרוב, באמצע וברקע. שלוש שכבות כאלה עוזרות לתמונה להרגיש עמוקה יותר.",
        "סימטריה עובדת מצוין כשהיא מדויקת ומכוונת.",
        "השאירו מרחב שלילי כשהוא מדגיש את הנושא ולא רק ממלא מקום.",
        "השתמשו בקווים, מסגרות וחזרות כדי להוביל את העין בתוך התמונה.",
    ]),
    ("אור וחשיפה", "תנו לאור להחליט מה חשוב", "light", "exposure", [
        "בדקו קודם מאיזה כיוון מגיע האור ורק אחר כך בחרו חשיפה.",
        "בשעת הזהב חפשו אור צדדי ולא רק שמש מול המצלמה.",
        "אור צדדי מדגיש מרקם, נפח וקווי מתאר.",
        "שמרו במיוחד על האזורים הבהירים כדי שלא יהפכו ללבן חסר פרטים. בדרך כלל קל יותר להבהיר מעט את הצללים בעריכה.",
        "אם המצלמה מציגה תמונה בהירה או כהה מדי, השתמשו בפיצוי חשיפה כדי לתקן זאת במהירות.",
        "היסטוגרמה היא גרף שמראה כמה מהתמונה כהה וכמה בהירה. היא שימושית במיוחד כשקשה לשפוט את המסך בשמש.",
        "ISO קובע עד כמה המצלמה רגישה לאור. אל תפחדו להעלות אותו: עדיף מעט רעש דיגיטלי מתמונה מטושטשת.",
        "הצמצם ומהירות התריס אינם מספרים שצריך 'לנצח'. בחרו אותם לפי מה שחשוב לכם: עומק שדה, חדות או תנועה.",
    ]),
    ("פוקוס וחדות", "חדות במקום הנכון חשובה יותר מחדות בכל מקום", "focus", "focus", [
        "מקמו את נקודת הפוקוס על הפרט הקריטי: עין, מרקם או קצה חשוב.",
        "לנושא סטטי העדיפו נקודת פוקוס מדויקת במקום בחירה אוטומטית רחבה.",
        "כשמצלמים נושא נע, עברו לפוקוס רציף: המצלמה ממשיכה לעדכן את הפוקוס בזמן שאתם עוקבים אחריו.",
        "ככל שמצלמים בעדשה מקרבת יותר, רעד היד מורגש יותר. לכן כדאי להשתמש במהירות תריס גבוהה יותר.",
        "הצמידו מרפקים לגוף והשתמשו בקיר, מעקה או תיק כתמיכה.",
        "בתנועה, צלמו רצף קצר של כמה תמונות. כך תגדילו את הסיכוי לתפוס את הרגע בלי למלא את הכרטיס בעשרות קבצים כמעט זהים.",
        "אל תנסו 'לתקן' חדות מוגזמת בעריכה; חידוד טוב מתחיל בפוקוס טוב.",
    ]),
    ("עומק שדה ומאקרו", "להחליט מה חד — ומה לא", "macro", "depth-of-field", [
        "עומק שדה רדוד פירושו שרק חלק קטן מהתמונה חד. השתמשו בו כדי להפריד את הנושא מהרקע, לא רק כדי ליצור טשטוש.",
        "הרחיקו את הרקע מהנושא כדי לקבל טשטוש נקי יותר.",
        "בצילום מאקרו (תקריב), עומק השדה קטן מאוד. לפעמים קל יותר להזיז מעט את המצלמה קדימה או אחורה מאשר לחכות לפוקוס האוטומטי.",
        "נסו להיות מקבילים לפרט שחשוב לכם להשאיר חד.",
        "צמצם סגור יותר מגדיל את האזור החד בתמונה. אבל אם סוגרים אותו יותר מדי, התמונה עלולה לאבד מעט חדות.",
        "חפשו אור רך במאקרו; ענן או צל פתוח יכולים להיות מפזר אור מצוין.",
        "בדקו את הרקע לפני הלחיצה — כתם בהיר קטן יכול לגנוב את כל תשומת הלב.",
    ]),
    ("תנועה ותזמון", "לא רק מהירות תריס — גם ציפייה", "motion", "focus", [
        "להקפאת תנועה העלו מהירות תריס עד שהפרט החשוב נשאר חד.",
        "ב־panning (מעקב בתנועה), הזיזו את המצלמה יחד עם הנושא והמשיכו את התנועה גם אחרי הלחיצה.",
        "התחילו לעקוב אחרי נושא נע לפני שהוא נכנס לנקודה הטובה בפריים.",
        "חכו לשיא הפעולה: כנף פתוחה, מבט, צעד או התזה.",
        "אחרי שהרגע 'נגמר', הישארו עוד שנייה — לעיתים התמונה הטובה מגיעה מיד אחריו.",
    ]),
    ("נוף ואדריכלות", "סדר, עומק וקנה מידה", "landscape", "landscape", [
        "בנוף חפשו שלוש שכבות: קדמה, מרכז ורקע.",
        "חזרו לאותו מקום באור אחר; מזג האוויר הוא חלק מהנושא.",
        "הכניסו אלמנט שממחיש קנה מידה כשאין לצופה דרך להבין את הגודל.",
        "בצילום מבנים, שימו לב לקווים האנכיים. החליטו אם אתם רוצים אותם ישרים או מתכנסים בכוונה.",
        "בדקו את ארבע פינות הפריים לפני צילום מבנים; שם מסתתרות רוב ההפרעות.",
    ]),
    ("פורטרט וסיפור", "תמונה טובה מספרת משהו על האדם או המקום", "story", "portrait", [
        "בפורטרט חפשו אור בעיניים לפני שאתם מחפשים רקע מושלם.",
        "הזיזו את המצולם ביחס לאור, לא רק את המצלמה ביחס למצולם.",
        "השאירו מעט סביבה כשהיא מוסיפה מידע על האדם והסיפור.",
        "בצילום רחוב חכו למחווה, קשר עין או צירוף מקרים שמחבר בין המרכיבים.",
    ]),
    ("לילה וצבע", "לשמור על האווירה בלי לאבד פרטים", "night", "night", [
        "בלילה השתמשו בחצובה כשאפשר, אבל בדקו גם אם תנועה קלה מוסיפה אווירה.",
        "בחשיפה ארוכה התריס נשאר פתוח יותר זמן. בדקו שפנסים, שלטים ואזורים בהירים לא הופכים לכתמים לבנים בלי פרטים.",
        "איזון לבן קובע אם הצבעים ייראו חמים או קרים. בחרו אותו לפי האווירה שאתם רוצים, לא רק לפי מה שנראה 'נייטרלי'.",
    ]),
    ("שחור־לבן ועריכה", "עריכה טובה מחזקת החלטה שכבר הייתה בצילום", "editing", "editing", [
        "עברו לשחור־לבן כשהאור, הצורה והמרקם חזקים יותר מהצבע עצמו.",
        "בעריכה, העדיפו תיקונים קטנים באזור שצריך אותם במקום להעלות קונטרסט חזק בכל התמונה.",
        "בצעו חיתוך (Crop) בסוף. שאלו אם הוא באמת מחזק את הסיפור, או רק מסתיר משהו שהיה אפשר לפתור כבר בזמן הצילום.",
    ]),
]

EN_SECTIONS = [
    ("Composition", "Build the frame before touching the settings", "composition", "composition", [
        "Decide what the main subject is before changing camera settings.",
        "Clean the edges of the frame; small distractions often weaken a strong photo.",
        "Change your position before zooming. Half a meter can transform the composition.",
        "The rule of thirds is a starting point, not a law. Use it only when it serves the story.",
        "Look for foreground, middle ground and background to create depth.",
        "Symmetry is powerful when it is precise and intentional.",
        "Use negative space when it strengthens the subject, not just to fill the frame.",
        "Use lines, frames and repetition to guide the viewer through the image.",
    ]),
    ("Light & exposure", "Let the light decide what matters", "light", "exposure", [
        "Check the direction of the light before deciding on exposure.",
        "At golden hour, look for side light rather than only shooting toward the sun.",
        "Side light reveals texture, volume and shape.",
        "Protect important highlights; shadow detail is often easier to recover.",
        "Use exposure compensation when the camera makes the scene too bright or too dark.",
        "Use the histogram, especially when the rear screen is misleading in bright daylight.",
        "ISO is a tool, not an enemy. A sharp image with some noise beats a blurred clean image.",
        "Aperture and shutter speed should serve your intention, not a supposedly perfect number.",
    ]),
    ("Focus & sharpness", "Sharpness in the right place matters more than sharpness everywhere", "focus", "focus", [
        "Place focus on the critical detail: an eye, texture or important edge.",
        "For a still subject, use a precise focus point instead of a broad automatic area.",
        "For movement, switch to continuous autofocus and begin tracking before the moment.",
        "When hand-holding, raise shutter speed as focal length increases.",
        "Brace your elbows and use a wall, railing or bag for support.",
        "Use short bursts for movement instead of endless high-speed shooting.",
        "Do not rely on aggressive sharpening later; good sharpening begins with good focus.",
    ]),
    ("Depth of field & macro", "Choose what is sharp — and what is not", "macro", "depth-of-field", [
        "Shallow depth of field is a separation tool, not a goal by itself.",
        "Increase subject-to-background distance for cleaner blur.",
        "In macro, move millimeters forward and backward instead of trusting autofocus alone.",
        "Keep the camera plane parallel to the detail you want to keep sharp.",
        "Stopping down adds depth of field, but very small apertures can soften detail.",
        "Look for soft light in macro; clouds and open shade are excellent diffusers.",
        "Inspect the background before pressing the shutter; one bright spot can steal attention.",
    ]),
    ("Motion & timing", "Shutter speed matters — anticipation matters too", "motion", "focus", [
        "To freeze action, raise shutter speed until the important detail stays crisp.",
        "When panning, continue the movement smoothly after pressing the shutter.",
        "Start tracking a moving subject before it reaches the best point in the frame.",
        "Wait for the peak moment: an open wing, a glance, a step or a splash.",
        "Stay one second after the obvious moment; the stronger picture often happens just after it.",
    ]),
    ("Landscape & architecture", "Order, depth and scale", "landscape", "landscape", [
        "Build landscapes in three layers: foreground, middle ground and background.",
        "Return to the same place in different light; weather is part of the subject.",
        "Include an element of scale when viewers have no other way to understand size.",
        "In architecture, decide whether verticals are straight or intentionally converging.",
        "Check all four corners before shooting a building; most distractions hide there.",
    ]),
    ("Portrait & storytelling", "A strong picture tells us something about the person or place", "story", "portrait", [
        "In portraits, look for light in the eyes before chasing a perfect background.",
        "Move the person relative to the light, not only the camera relative to the person.",
        "Keep some environment when it adds information and story.",
        "In street photography, wait for a gesture, glance or coincidence that connects the elements.",
    ]),
    ("Night & color", "Keep the atmosphere without losing detail", "night", "night", [
        "At night, use a tripod when useful, but also ask whether slight movement adds atmosphere.",
        "With long exposures, watch signs, lamps and other highlights that clip quickly.",
        "Choose white balance intentionally; do not automatically neutralize every warm or cool tone.",
    ]),
    ("Black & white and editing", "Good editing strengthens a decision already made in camera", "editing", "editing", [
        "Choose black and white when light, shape and texture matter more than color.",
        "Prefer subtle local adjustments over heavy global contrast.",
        "Crop last, and ask whether the crop strengthens the story or simply hides a problem.",
    ]),
]

GUIDES = {
    "composition": "/camera/composition/",
    "exposure": "/camera/exposure/",
    "light": "/camera/light/",
    "focus": "/camera/focus/",
    "depth-of-field": "/camera/depth-of-field/",
    "macro": "/camera/macro/",
    "portrait": "/camera/portrait/",
    "night": "/camera/night/",
    "landscape": "/camera/landscape/",
    "editing": "/camera/editing/",
    "black-and-white": "/camera/black-and-white/",
}

TERM_LINKS = {
    "he": [
        ("פיצוי חשיפה", "/camera/exposure/", "exposure_compensation"),
        ("מהירות תריס", "/camera/exposure/", "shutter_speed"),
        ("חשיפה ארוכה", "/camera/night/", "long_exposure"),
        ("עומק שדה", "/camera/depth-of-field/", "depth_of_field"),
        ("פוקוס רציף", "/camera/focus/", "continuous_focus"),
        ("איזון לבן", "/camera/white-balance/", "white_balance"),
        ("חוק השלישים", "/camera/composition/", "rule_of_thirds"),
        ("שחור־לבן", "/camera/black-and-white/", "black_and_white"),
        ("היסטוגרמה", "/camera/histogram/", "histogram"),
        ("קומפוזיציה", "/camera/composition/", "composition"),
        ("מאקרו", "/camera/macro/", "macro"),
        ("panning", "/camera/sports/", "panning"),
        ("פורטרט", "/camera/portrait/", "portrait"),
        ("פוקוס", "/camera/focus/", "focus"),
        ("צמצם", "/camera/exposure/", "aperture"),
        ("חשיפה", "/camera/exposure/", "exposure"),
        ("ISO", "/camera/exposure/", "iso"),
        ("Crop", "/camera/editing/", "crop"),
        ("עריכה", "/camera/editing/", "editing"),
    ],
    "en": [
        ("exposure compensation", "/camera/exposure/", "exposure_compensation"),
        ("shutter speed", "/camera/exposure/", "shutter_speed"),
        ("long exposure", "/camera/night/", "long_exposure"),
        ("depth of field", "/camera/depth-of-field/", "depth_of_field"),
        ("continuous autofocus", "/camera/focus/", "continuous_focus"),
        ("white balance", "/camera/white-balance/", "white_balance"),
        ("rule of thirds", "/camera/composition/", "rule_of_thirds"),
        ("black and white", "/camera/black-and-white/", "black_and_white"),
        ("histogram", "/camera/histogram/", "histogram"),
        ("composition", "/camera/composition/", "composition"),
        ("macro", "/camera/macro/", "macro"),
        ("panning", "/camera/sports/", "panning"),
        ("portrait", "/camera/portrait/", "portrait"),
        ("autofocus", "/camera/focus/", "autofocus"),
        ("focus", "/camera/focus/", "focus"),
        ("aperture", "/camera/exposure/", "aperture"),
        ("exposure", "/camera/exposure/", "exposure"),
        ("ISO", "/camera/exposure/", "iso"),
        ("crop", "/camera/editing/", "crop"),
        ("editing", "/camera/editing/", "editing"),
    ],
}

HE_IMAGE_LESSONS = {
    "composition": "למה זה עובד: החזרה הגיאומטרית והסימטריה יוצרות סדר ומובילות את העין.",
    "light": "למה זה עובד: האור האחיד חושף פרטים עדינים בלי לאבד את הזהב והכחול.",
    "focus": "למה זה עובד: מרכז הפרח חד והרקע נמס, כך שהעין יודעת בדיוק איפה לעצור.",
    "macro": "למה זה עובד: עומק שדה רדוד מפריד בין שכבות עלי הכותרת לרקע.",
    "motion": "למה זה עובד: הנושא חד והרקע רך - שילוב שמדגיש גם תנועה וגם הקשר.",
    "landscape": "למה זה עובד: קווים אדריכליים וקנה מידה מובילים אל מרכז הפריים.",
    "story": "למה זה עובד: שכבות של פרטים יוצרות גם מרקם וגם סיפור אנושי.",
    "night": "למה זה עובד: האור הכחול נשמר, בזמן שהאזורים הלבנים עדיין שומרים על פרטים.",
    "editing": "למה זה עובד: צבע, קצב וצורות הם הנושא - העריכה צריכה לחזק אותם, לא להחליף אותם.",
}

EN_IMAGE_LESSONS = {
    "composition": "Why it works: repeated geometry and near-symmetry create order and guide the eye.",
    "light": "Why it works: even light reveals fine detail while preserving the blue-and-gold palette.",
    "focus": "Why it works: the flower center is crisp while the background melts away.",
    "macro": "Why it works: shallow depth separates the petal layers from the background.",
    "motion": "Why it works: a sharp subject against a softer background preserves both action and context.",
    "landscape": "Why it works: architectural lines and scale lead the eye toward the center of the frame.",
    "story": "Why it works: layered details create both texture and a human story.",
    "night": "Why it works: the blue atmosphere remains intact while bright architectural detail is preserved.",
    "editing": "Why it works: color, rhythm and shape are the subject - editing should strengthen them, not replace them.",
}

def tracked(path: str, lang: str, content: str) -> str:
    if path.startswith("http"):
        base = path
    else:
        base = SITE + path
    parsed = urlparse(base)
    q = dict(parse_qsl(parsed.query))
    q.update({
        "utm_source": "free_guide",
        "utm_medium": "pdf",
        "utm_campaign": CAMPAIGN,
        "utm_content": f"{lang}_{content}",
    })
    return urlunparse(parsed._replace(query=urlencode(q)))

def esc(s: str) -> str:
    return html.escape(s, quote=True)

def linked_text(s: str, lang: str) -> str:
    """Escape text and turn supported photography terms into tracked links."""
    terms = TERM_LINKS[lang]
    by_term = {term.lower(): (path, key) for term, path, key in terms}
    pattern = re.compile("|".join(re.escape(term) for term, _, _ in sorted(terms, key=lambda x: len(x[0]), reverse=True)), re.IGNORECASE)
    out = []
    last = 0
    for match in pattern.finditer(s):
        out.append(esc(s[last:match.start()]))
        shown = match.group(0)
        path, key = by_term[shown.lower()]
        out.append(f'<a class="term-link" href="{tracked(path, lang, "term_"+key)}">{esc(shown)}</a>')
        last = match.end()
    out.append(esc(s[last:]))
    return "".join(out)

def download_images() -> dict[str, Path]:
    ASSETS.mkdir(parents=True, exist_ok=True)
    out = {}
    session = requests.Session()
    session.headers["User-Agent"] = "AmitPhotos-FreeGuide/2026-10-02"
    failures = []
    for key, (pid, title) in PHOTOS.items():
        src = f"{SITE}/photos/{pid}.webp"
        dest = ASSETS / f"{key}.jpg"
        try:
            r = session.get(src, timeout=30)
            r.raise_for_status()
            raw = ASSETS / f"{key}.webp"
            raw.write_bytes(r.content)
            with Image.open(raw) as im:
                im = im.convert("RGB")
                im.thumbnail((1800, 1400), Image.Resampling.LANCZOS)
                im.save(dest, "JPEG", quality=90, optimize=True)
            raw.unlink(missing_ok=True)
            out[key] = dest
        except Exception as exc:
            failures.append(f"{key} ({title}): {exc}")
    if len(out) < 8:
        raise RuntimeError("Too few guide images downloaded:\n" + "\n".join(failures))
    if failures:
        print("Image download warnings:", *failures, sep="\n- ")
    return out

def css() -> str:
    return r"""
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin:0; padding:0; background:#111; font-family:"Noto Sans","DejaVu Sans",Arial,sans-serif; }
    body { color:#171717; }
    .page {
      position:relative; width:210mm; height:297mm; overflow:hidden;
      background:#f6f3ed; padding:16mm 16mm 13mm; break-after:page;
      -webkit-print-color-adjust:exact; print-color-adjust:exact;
    }
    .page.dark { background:#0a0a0a; color:white; }
    .cover { padding:0; }
    .cover img { width:100%; height:100%; object-fit:cover; display:block; }
    .cover:after { content:""; position:absolute; inset:0; background:linear-gradient(180deg,rgba(0,0,0,.10),rgba(0,0,0,.10) 25%,rgba(0,0,0,.82) 100%); }
    .cover-copy { position:absolute; z-index:2; left:16mm; right:16mm; bottom:20mm; }
    .eyebrow { font-size:10pt; letter-spacing:.12em; text-transform:uppercase; color:#d4aa55; font-weight:700; }
    .cover h1 { font-size:35pt; line-height:1.05; margin:5mm 0 3mm; max-width:165mm; }
    .cover p { max-width:150mm; font-size:14pt; line-height:1.45; color:#f0eee8; }
    .goldline { width:34mm; height:1.2mm; background:#d4aa55; margin:5mm 0; }
    .brand { position:absolute; z-index:2; top:14mm; left:16mm; font-size:11pt; letter-spacing:.06em; }
    .photo-frame { position:relative; width:100%; margin-bottom:7mm; }
    .section-photo { width:100%; object-fit:cover; border-radius:5mm; display:block; }
    .photo-lesson { position:absolute; left:4mm; right:4mm; bottom:4mm; max-width:145mm; background:rgba(8,15,18,.86); color:white; border-radius:3mm; padding:2.8mm 3.5mm; font-size:8.2pt; line-height:1.35; backdrop-filter:blur(3px); }
    [dir=rtl] .photo-lesson { margin-left:auto; text-align:right; }
    [dir=ltr] .photo-lesson { margin-right:auto; text-align:left; }
    .section-head { display:flex; align-items:flex-end; justify-content:space-between; gap:8mm; margin-bottom:5mm; }
    h2 { font-size:24pt; margin:0; line-height:1.08; }
    .sub { font-size:10.5pt; color:#6a6257; margin-top:2mm; }
    .num { font-size:32pt; color:#d4aa55; font-weight:800; line-height:1; }
    .tips { display:grid; grid-template-columns:1fr 1fr; gap:3.1mm; }
    .tip { background:white; border-radius:3.2mm; padding:3.6mm 4mm; min-height:25mm; border:0.35mm solid #e7e0d4; display:flex; gap:2.8mm; align-items:flex-start; }
    .tip b { color:#b4832f; font-size:10.5pt; flex:0 0 auto; direction:ltr; unicode-bidi:isolate; line-height:1.42; }
    .tip span { font-size:9.7pt; line-height:1.42; flex:1 1 auto; }
    .term-link { color:inherit !important; text-decoration:underline; text-decoration-color:#d4aa55; text-decoration-thickness:.65px; text-underline-offset:1.4px; }
    .guide-row { margin-top:5mm; display:flex; align-items:center; justify-content:space-between; gap:5mm; }
    .guide-link { display:inline-block; background:#111; color:white !important; text-decoration:none; border-radius:999px; padding:3mm 5mm; font-size:9.5pt; font-weight:700; }
    .caption { color:#756d62; font-size:7.8pt; }
    .page-no { position:absolute; bottom:6mm; font-size:8pt; color:#8e877d; }
    [dir=rtl] .page-no { left:16mm; } [dir=ltr] .page-no { right:16mm; }
    .intro h2 { font-size:28pt; margin-bottom:6mm; }
    .intro-grid { display:grid; grid-template-columns:1.1fr .9fr; gap:7mm; align-items:stretch; }
    .intro-card { background:white; border-radius:5mm; padding:7mm; border:0.35mm solid #e7e0d4; }
    .intro-card h3 { margin:0 0 3mm; font-size:15pt; }
    .intro-card p, .intro-card li { font-size:10pt; line-height:1.55; }
    .mini-photo { width:100%; height:92mm; object-fit:cover; border-radius:5mm; }
    .intro-gallery { display:grid; grid-template-columns:1fr 1fr 1fr; gap:3mm; margin-top:7mm; }
    .intro-gallery img { width:100%; height:34mm; object-fit:cover; border-radius:4mm; }
    .glossary { margin-top:6mm; background:#111; color:white; border-radius:5mm; padding:5mm; }
    .glossary h3 { margin:0 0 3mm; color:#d4aa55; font-size:13pt; }
    .glossary-grid { display:grid; grid-template-columns:1fr 1fr; gap:2.5mm 5mm; }
    .glossary-item { font-size:8.3pt; line-height:1.35; }
    .glossary-item strong { display:block; color:#d4aa55; margin-bottom:.6mm; }
    .glossary-item span { color:#f0eee8; }
    .link-grid { display:grid; grid-template-columns:1fr 1fr; gap:3mm; margin-top:5mm; }
    .resource { background:white; border:0.35mm solid #e5ddd0; border-radius:4mm; padding:3.6mm 4mm; text-decoration:none; color:#181818 !important; min-height:21mm; }
    .resource:last-child { grid-column:1 / -1; }
    .resource strong { display:block; font-size:10.5pt; margin-bottom:1mm; }
    .resource small { color:#766e64; font-size:7.9pt; line-height:1.3; }
    .path { margin-top:6mm; }
    .path-row { display:grid; grid-template-columns:13mm 1fr 36mm; gap:4mm; align-items:center; background:white; border-radius:4mm; margin-bottom:3mm; padding:4mm; }
    .path-row .step { width:10mm; height:10mm; border-radius:50%; background:#d4aa55; display:flex; align-items:center; justify-content:center; font-weight:800; }
    .path-row strong { font-size:11pt; }
    .path-row small { display:block; color:#746b61; margin-top:1mm; }
    .path-row a { text-align:center; font-size:8.5pt; font-weight:700; color:#111; }
    .collage { display:grid; grid-template-columns:1.2fr .8fr; grid-template-rows:46mm 46mm; gap:3mm; margin-top:5mm; }
    .collage img { width:100%; height:100%; object-fit:cover; border-radius:3mm; }
    .collage img:first-child { grid-row:1/3; }
    .footer-cta { margin-top:5mm; background:#111; color:white; border-radius:5mm; padding:5mm 6mm; }
    .footer-cta h3 { margin:0 0 1.5mm; font-size:15pt; }
    .footer-cta p { margin:0 0 3mm; color:#d7d2c9; font-size:8.8pt; line-height:1.4; }
    .footer-cta a { display:inline-block; background:#d4aa55; color:#111 !important; font-weight:800; text-decoration:none; padding:2.5mm 4.5mm; border-radius:999px; font-size:8.8pt; }
    .rtl { direction:rtl; text-align:right; }
    .ltr { direction:ltr; text-align:left; }
    """

def img_uri(path: Path) -> str:
    return path.resolve().as_uri()

def cover(lang: str, imgs: dict[str, Path]) -> str:
    if lang == "he":
        title = "50 טיפים לצילום טוב יותר"
        desc = "מדריך מעשי וברור לצלמים בתחילת הדרך: קומפוזיציה, אור והגדרות מצלמה — עם דוגמאות מהפורטפוליו של עמית ארז וקישורים להעמקה."
        brand = "עמית ארז | צילום"
        direction = "rtl"
    else:
        title = "50 tips for better photography"
        desc = "A practical beginner-friendly guide to composition, light and camera settings — with examples from Amit Erez's portfolio and links for deeper learning."
        brand = "Amit Erez | Photography"
        direction = "ltr"
    return f"""<div class="page dark cover {direction}" dir="{direction}">
      <img src="{img_uri(imgs['cover'])}">
      <div class="brand">{esc(brand)}</div>
      <div class="cover-copy">
        <div class="eyebrow">AMITPHOTOS.COM</div><div class="goldline"></div>
        <h1>{esc(title)}</h1><p>{esc(desc)}</p>
      </div>
    </div>"""

def intro(lang: str, imgs: dict[str, Path], pageno: int) -> str:
    rtl = lang == "he"
    direction = "rtl" if rtl else "ltr"
    if rtl:
        title = "איך להשתמש בחוברת"
        p1 = "לא צריך לזכור 50 כללים. בחרו בכל יציאה לצילום שניים או שלושה טיפים, תרגלו אותם בכוונה, ורק אחר כך הוסיפו עוד."
        h1 = "העיקרון החשוב"
        t1 = "הגדרות הן אמצעי. לפני צמצם, ISO או מהירות תריס — שאלו מה אתם רוצים שהצופה יראה, ירגיש ויזכור."
        h2 = "הפכו את זה לתרגול"
        bullets = ["צלמו אותה סצנה משלושה מיקומים.", "השוו שתי חשיפות שונות ובדקו מה השתנה.", "בדקו מה קורה בשולי הפריים.", "חזרו לצילום אחרי עריכה ושאלו מה הייתם עושים אחרת."]
    else:
        title = "How to use this guide"
        p1 = "You do not need to memorize 50 rules. Pick two or three tips for each shoot, practice them deliberately, then add more."
        h1 = "The key idea"
        t1 = "Settings are tools. Before aperture, ISO or shutter speed, ask what you want the viewer to notice, feel and remember."
        h2 = "Turn it into practice"
        bullets = ["Shoot the same scene from three positions.", "Compare exposures, not only final images.", "Inspect the edges of every frame.", "Revisit the shot after editing and ask what you would do differently."]
    lis = "".join(f"<li>{linked_text(x, lang)}</li>" for x in bullets)
    if rtl:
        glossary = [
            ("צמצם", "גודל הפתח בעדשה. הוא משפיע על כמות האור ועל עומק השדה."),
            ("מהירות תריס", "כמה זמן החיישן נחשף לאור. מהירות גבוהה מקפיאה תנועה; איטית יכולה לטשטש אותה."),
            ("ISO", "רגישות המצלמה לאור. ערך גבוה עוזר בחושך אך עלול להוסיף רעש דיגיטלי."),
            ("עומק שדה", "כמה מהאזור שלפני ומאחורי נקודת הפוקוס נראה חד."),
            ("panning", "מעקב עם המצלמה אחרי נושא נע כדי לשמור עליו חד יחסית והרקע ייראה בתנועה."),
        ]
        glossary_title = "מילון קצר למתחילים"
    else:
        glossary = [
            ("Aperture", "The opening inside the lens. It affects light and depth of field."),
            ("Shutter speed", "How long the sensor is exposed to light. Fast speeds freeze motion; slow speeds can blur it."),
            ("ISO", "The camera's sensitivity setting. Higher ISO helps in low light but can add digital noise."),
            ("Depth of field", "How much of the area in front of and behind the focus point appears sharp."),
            ("Panning", "Following a moving subject with the camera so the subject stays relatively sharp while the background shows motion."),
        ]
        glossary_title = "Quick beginner glossary"
    glossary_html = "".join(f'<div class="glossary-item"><strong>{linked_text(k, lang)}</strong><span>{linked_text(v, lang)}</span></div>' for k,v in glossary)
    return f"""<div class="page intro {direction}" dir="{direction}">
      <div class="eyebrow">50 TIPS · AMITPHOTOS.COM</div>
      <h2>{esc(title)}</h2>
      <div class="intro-grid">
        <div>
          <div class="intro-card"><h3>{esc(h1)}</h3><p>{linked_text(t1, lang)}</p></div>
          <div class="intro-card" style="margin-top:5mm"><h3>{esc(h2)}</h3><ul>{lis}</ul></div>
          <p style="font-size:10pt;line-height:1.55;margin-top:6mm">{linked_text(p1, lang)}</p>
        </div>
        <img class="mini-photo" src="{img_uri(imgs['extra1'])}">
      </div>
      <div class="intro-gallery">
        <img src="{img_uri(imgs['composition'])}">
        <img src="{img_uri(imgs['macro'])}">
        <img src="{img_uri(imgs['night'])}">
      </div>
      <div class="glossary"><h3>{esc(glossary_title)}</h3><div class="glossary-grid">{glossary_html}</div></div>
      <div class="page-no">{pageno}</div>
    </div>"""

def section_page(lang: str, title: str, subtitle: str, photo_key: str, guide_key: str, tips: list[str], start_num: int, imgs: dict[str, Path], pageno: int) -> str:
    direction = "rtl" if lang == "he" else "ltr"
    rows = []
    for i, tip in enumerate(tips, start=start_num):
        rows.append(f'<div class="tip"><b>{i:02d}</b><span>{linked_text(tip, lang)}</span></div>')
    guide_text = "למדריך המלא" if lang == "he" else "Read the full guide"
    cap = "צילום מתוך הפורטפוליו של עמית ארז" if lang == "he" else "Photo from Amit Erez's portfolio"
    href = tracked(GUIDES[guide_key], lang, guide_key)
    lesson = (HE_IMAGE_LESSONS if lang == "he" else EN_IMAGE_LESSONS).get(photo_key, "")
    photo_h = "112mm" if len(tips) <= 3 else ("92mm" if len(tips) <= 5 else "68mm")
    return f"""<div class="page {direction}" dir="{direction}">
      <div class="photo-frame"><img class="section-photo" style="height:{photo_h}" src="{img_uri(imgs[photo_key])}"><div class="photo-lesson">{linked_text(lesson, lang)}</div></div>
      <div class="section-head">
        <div><h2>{linked_text(title, lang)}</h2><div class="sub">{linked_text(subtitle, lang)}</div></div>
        <div class="num">{start_num:02d}</div>
      </div>
      <div class="tips">{''.join(rows)}</div>
      <div class="guide-row"><a class="guide-link" href="{href}">{esc(guide_text)}</a><div class="caption">{esc(cap)}</div></div>
      <div class="page-no">{pageno}</div>
    </div>"""

def learning_page(lang: str, imgs: dict[str, Path], pageno: int) -> str:
    direction = "rtl" if lang == "he" else "ltr"
    if lang == "he":
        title = "מסלול תרגול מומלץ"
        intro_txt = "רוצים להפוך את הטיפים להרגל? עברו על ארבעת השלבים האלה במשך שבועיים."
        rows = [
            ("1", "קומפוזיציה", "יום אחד שבו אתם כמעט לא משנים הגדרות — רק מיקום, זווית ופריים.", "composition"),
            ("2", "אור וחשיפה", "צלמו את אותו נושא באור קדמי, צדדי ואחורי והשוו.", "exposure"),
            ("3", "פוקוס ועומק שדה", "בנו סדרה שבה בכל תמונה ברור בדיוק מה הנושא החד.", "depth-of-field"),
            ("4", "לילה ועריכה", "צלמו בלילה, ערכו בעדינות, והשוו בין הגרסה הסופית לקובץ המקור.", "night"),
        ]
        linktxt = "פתחו מדריך"
    else:
        title = "A recommended practice path"
        intro_txt = "Want the tips to become habits? Work through these four steps over two weeks."
        rows = [
            ("1", "Composition", "Spend one session barely changing settings — only position, angle and framing.", "composition"),
            ("2", "Light & exposure", "Photograph the same subject with front, side and back light and compare.", "exposure"),
            ("3", "Focus & depth", "Build a series where the viewer always knows exactly what is meant to be sharp.", "depth-of-field"),
            ("4", "Night & editing", "Shoot at night, edit gently, and compare the final image with the original file.", "night"),
        ]
        linktxt = "Open guide"
    body = ""
    for n, name, desc, key in rows:
        body += f"""<div class="path-row"><div class="step">{n}</div><div><strong>{esc(name)}</strong><small>{esc(desc)}</small></div><a href="{tracked(GUIDES[key],lang,'path_'+key)}">{esc(linktxt)}</a></div>"""
    return f"""<div class="page {direction}" dir="{direction}">
      <div class="eyebrow">PRACTICE · AMITPHOTOS.COM</div>
      <h2 style="margin-top:3mm">{esc(title)}</h2>
      <p style="font-size:11pt;line-height:1.55;max-width:160mm">{esc(intro_txt)}</p>
      <img class="section-photo" style="height:82mm;margin-top:6mm" src="{img_uri(imgs['extra2'])}">
      <div class="path">{body}</div>
      <div class="page-no">{pageno}</div>
    </div>"""

def resources_page(lang: str, imgs: dict[str, Path], pageno: int) -> str:
    direction = "rtl" if lang == "he" else "ltr"
    if lang == "he":
        title = "מכאן ממשיכים לצלם"
        sub = "החוברת היא נקודת פתיחה. באתר מחכים לכם גלריות, מדריכים, ניתוחי תמונות, מקומות צילום וסרטונים."
        resources = [
            ("גלריות ותמונות", "עבודות נבחרות לפי נושאים ומקומות.", "/#gallery", "gallery"),
            ("כל מדריכי הצילום", "חשיפה, קומפוזיציה, אור, פוקוס, מאקרו, לילה ועוד.", "/camera/", "camera"),
            ("ניתוח תמונות", "למה תמונה עובדת, מה אפשר ללמוד ממנה ואיך צולמה.", "/learn/", "learn"),
            ("מקומות לצילום בארץ", "רעיונות והכוונה ללוקיישנים לצילום.", "/locations/", "locations"),
            ("סרטוני צילום", "הסברים, הדגמות ותוכן לצפייה.", "/videos/", "videos"),
        ]
        cta_h = "הטיפ הכי חשוב: לצאת ולצלם"
        cta_p = "בחרו רעיון אחד מהחוברת, צאו איתו לצילום אחד, וחזרו לאתר כשתרצו להעמיק."
        cta = "ל־AMITPHOTOS.COM"
    else:
        title = "Keep learning — and keep shooting"
        sub = "This guide is a starting point. The site has galleries, in-depth guides, photo breakdowns, locations and videos."
        resources = [
            ("Galleries & photographs", "Selected work by subject and location.", "/#gallery", "gallery"),
            ("All photography guides", "Exposure, composition, light, focus, macro, night and more.", "/camera/", "camera"),
            ("Photo breakdowns", "Why an image works, what to learn from it and how it was made.", "/learn/", "learn"),
            ("Photo locations in Israel", "Ideas and practical guidance for places to shoot.", "/locations/", "locations"),
            ("Photography videos", "Explanations, demonstrations and watchable learning.", "/videos/", "videos"),
        ]
        cta_h = "The most important tip: go shoot"
        cta_p = "Pick one idea from the guide, take it into one real shoot, and return to the site when you want to go deeper."
        cta = "VISIT AMITPHOTOS.COM"
    cards = "".join(
        f'<a class="resource" href="{tracked(path,lang,key)}"><strong>{esc(name)}</strong><small>{esc(desc)}</small></a>'
        for name, desc, path, key in resources
    )
    return f"""<div class="page {direction}" dir="{direction}">
      <div class="eyebrow">EXPLORE · AMITPHOTOS.COM</div>
      <h2 style="margin-top:3mm">{esc(title)}</h2>
      <p style="font-size:10.2pt;line-height:1.45;max-width:165mm;margin:2.5mm 0 0">{esc(sub)}</p>
      <div class="collage">
        <img src="{img_uri(imgs['composition'])}">
        <img src="{img_uri(imgs['macro'])}">
        <img src="{img_uri(imgs['night'])}">
      </div>
      <div class="link-grid">{cards}</div>
      <div class="footer-cta"><h3>{esc(cta_h)}</h3><p>{esc(cta_p)}</p><a href="{tracked('/',lang,'final_cta')}">{esc(cta)}</a></div>
      <div class="page-no">{pageno}</div>
    </div>"""

def build_html(lang: str, imgs: dict[str, Path]) -> str:
    sections = HE_SECTIONS if lang == "he" else EN_SECTIONS
    parts = [cover(lang, imgs), intro(lang, imgs, 2)]
    tip_num = 1
    page_no = 3
    for title, subtitle, photo_key, guide_key, tips in sections:
        parts.append(section_page(lang, title, subtitle, photo_key, guide_key, tips, tip_num, imgs, page_no))
        tip_num += len(tips)
        page_no += 1
    assert tip_num == 51, tip_num
    parts.append(learning_page(lang, imgs, page_no)); page_no += 1
    parts.append(resources_page(lang, imgs, page_no))
    direction = "rtl" if lang == "he" else "ltr"
    return f"""<!doctype html><html lang="{lang}" dir="{direction}"><head><meta charset="utf-8"><style>{css()}</style></head><body>{''.join(parts)}</body></html>"""

def chrome_binary() -> str:
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        p = subprocess.run(["bash","-lc",f"command -v {name} || true"], capture_output=True, text=True).stdout.strip()
        if p:
            return p
    raise RuntimeError("No Chrome/Chromium binary found")

def render_pdf(html_path: Path, pdf_path: Path):
    chrome = chrome_binary()
    cmd = [
        chrome, "--headless=new", "--no-sandbox", "--disable-gpu",
        "--allow-file-access-from-files", "--hide-scrollbars",
        f"--print-to-pdf={pdf_path}", "--print-to-pdf-no-header",
        html_path.resolve().as_uri(),
    ]
    subprocess.run(cmd, check=True)

def verify_pdf(pdf_path: Path, expected_pages: int):
    if not pdf_path.exists() or pdf_path.stat().st_size < 200_000:
        raise RuntimeError(f"PDF too small or missing: {pdf_path}")
    info = subprocess.run(["pdfinfo", str(pdf_path)], capture_output=True, text=True, check=True).stdout
    pages = None
    for line in info.splitlines():
        if line.startswith("Pages:"):
            pages = int(line.split(":",1)[1].strip())
    if pages != expected_pages:
        raise RuntimeError(f"{pdf_path.name}: expected {expected_pages} pages, got {pages}")
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(pdf_path))
        links = 0
        for page in reader.pages:
            for annot in page.get("/Annots", []) or []:
                obj = annot.get_object()
                a = obj.get("/A")
                if a and a.get("/URI"):
                    links += 1
        if links < 10:
            raise RuntimeError(f"{pdf_path.name}: only {links} links found")
        return links
    except ImportError:
        return -1

def make_previews(pdf_path: Path, prefix: str):
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    # Cover, one teaching page, and resources page.
    for page in (1, 4, 13):
        out = PREVIEWS / f"{prefix}-p{page}"
        subprocess.run(["pdftoppm","-f",str(page),"-l",str(page),"-singlefile","-scale-to","1300","-jpeg",str(pdf_path),str(out)], check=True)

def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    imgs = download_images()
    result = {}
    for lang, filename in (("he","50tips-heb.pdf"), ("en","50tips-eng.pdf")):
        html_path = BUILD / f"guide-{lang}.html"
        html_path.write_text(build_html(lang, imgs), encoding="utf-8")
        pdf_path = ROOT / filename
        render_pdf(html_path, pdf_path)
        links = verify_pdf(pdf_path, 13)
        make_previews(pdf_path, lang)
        result[lang] = {"file": filename, "size": pdf_path.stat().st_size, "pages": 13, "links": links}
    metadata = {
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "campaign": CAMPAIGN,
        "selection_policy": "visual_complete && score > 85 && !owner_review_required && !material_problem",
        "photo_ids": {k:v[0] for k,v in PHOTOS.items()},
        "outputs": result,
    }
    (ROOT / "data" / "free-guide-build.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
