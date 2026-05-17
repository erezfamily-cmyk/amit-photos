#!/usr/bin/env python3
"""
Weekly Social Media Report
שולח מייל שבועי עם נתוני ביצועים מאינסטגרם ופייסבוק (מספר עמודים).

הגדרת עמודי פייסבוק:
  FACEBOOK_PAGE_IDS=label1:page_id1,label2:page_id2,...
  כל עמוד משתמש באותו FACEBOOK_PAGE_TOKEN (User Access Token).
  אם FACEBOOK_PAGE_IDS לא מוגדר — נופל ל-FACEBOOK_PAGE_ID הישן.
"""

import os
import sys
import json
import requests
import anthropic
from pathlib import Path
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).parent.parent

GRAPH_API    = "https://graph.facebook.com/v21.0"
RESEND_API   = "https://api.resend.com/emails"

IG_USER_ID   = os.environ.get("INSTAGRAM_USER_ID", "")
IG_TOKEN     = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FB_TOKEN     = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
RESEND_KEY      = os.environ.get("RESEND_API_KEY", "")
ANTHROPIC_KEY   = os.environ.get("ANTHROPIC_API_KEY", "")
REPORT_EMAIL = os.environ.get("REPORT_EMAIL", "erez.family@gmail.com")

# תמיכה בריבוי עמודים: "label:page_id,label2:page_id2" — או fallback לישן
_fb_pages_raw = os.environ.get("FACEBOOK_PAGE_IDS", "")
_fb_page_id_legacy = os.environ.get("FACEBOOK_PAGE_ID", "")

def get_fb_pages():
    """מחזיר רשימת (label, page_id) לאיסוף נתונים."""
    if _fb_pages_raw:
        pages = []
        for part in _fb_pages_raw.split(","):
            part = part.strip()
            if ":" in part:
                label, pid = part.split(":", 1)
                pages.append((label.strip(), pid.strip()))
        if pages:
            return pages
    if _fb_page_id_legacy:
        return [("Facebook", _fb_page_id_legacy)]
    return []


# ===== Instagram =====

def fetch_ig_insights():
    """שולף נתוני אינסטגרם — פוסטים מ-7 ימים אחרונים."""
    since = int((datetime.now(timezone.utc) - timedelta(days=7)).timestamp())
    try:
        resp = requests.get(f"{GRAPH_API}/{IG_USER_ID}/media", params={
            "fields": "id,caption,like_count,comments_count,timestamp,media_url",
            "since":  since,
            "limit":  20,
            "access_token": IG_TOKEN,
        }, timeout=15)
        resp.raise_for_status()
        return resp.json().get("data", [])
    except Exception as e:
        print(f"⚠️  Instagram insights נכשל: {e}")
        return []


def fetch_ig_account_insights():
    """מדדי חשבון: followers, reach."""
    try:
        resp = requests.get(f"{GRAPH_API}/{IG_USER_ID}", params={
            "fields": "followers_count,media_count",
            "access_token": IG_TOKEN,
        }, timeout=15)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"⚠️  Instagram account insights נכשל: {e}")
        return {}


# ===== Facebook (multi-page) =====

def fetch_fb_page_posts(page_id):
    """שולף פוסטי פייסבוק מ-7 ימים אחרונים לעמוד ספציפי."""
    since = int((datetime.now(timezone.utc) - timedelta(days=7)).timestamp())
    try:
        resp = requests.get(f"{GRAPH_API}/{page_id}/feed", params={
            "fields": "id,message,created_time,reactions.summary(true),comments.summary(true)",
            "since":  since,
            "limit":  20,
            "access_token": FB_TOKEN,
        }, timeout=15)
        resp.raise_for_status()
        return resp.json().get("data", [])
    except Exception as e:
        print(f"⚠️  Facebook posts ({page_id}) נכשל: {e}")
        return []


def fetch_fb_page_info(page_id):
    """Fans count + שם עמוד."""
    try:
        resp = requests.get(f"{GRAPH_API}/{page_id}", params={
            "fields": "name,fan_count,followers_count",
            "access_token": FB_TOKEN,
        }, timeout=15)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"⚠️  Facebook page info ({page_id}) נכשל: {e}")
        return {}


def build_fb_page_block(label, page_id):
    """מחזיר dict מלא לעמוד פייסבוק אחד."""
    print(f"  📘 שולף עמוד: {label} ({page_id})")
    posts    = fetch_fb_page_posts(page_id)
    info     = fetch_fb_page_info(page_id)
    fans     = info.get("fan_count", 0)
    name     = info.get("name") or label
    n        = len(posts)

    total_likes    = sum(p.get("reactions", {}).get("summary", {}).get("total_count", 0) for p in posts)
    total_comments = sum(p.get("comments",  {}).get("summary", {}).get("total_count", 0) for p in posts)
    best = max(posts, key=lambda p: p.get("reactions", {}).get("summary", {}).get("total_count", 0), default=None)
    top5 = sorted(posts, key=lambda p: p.get("reactions", {}).get("summary", {}).get("total_count", 0), reverse=True)[:5]

    return {
        "label":   label,
        "name":    name,
        "page_id": page_id,
        "fans":    fans,
        "posts_this_week":    n,
        "total_likes":        total_likes,
        "total_comments":     total_comments,
        "avg_likes_per_post": round(total_likes / n, 1) if n else 0,
        "engagement_rate":    round((total_likes + total_comments) / (n * max(fans, 1)), 4) if n else 0,
        "top_posts": [
            {
                "message":  (p.get("message") or "")[:100].replace("\n", " "),
                "likes":    p.get("reactions", {}).get("summary", {}).get("total_count", 0),
                "comments": p.get("comments",  {}).get("summary", {}).get("total_count", 0),
                "date":     (p.get("created_time") or "")[:10],
            }
            for p in top5
        ],
        "best_post": {
            "message": (best.get("message") or "")[:120] if best else "",
            "likes":   best.get("reactions", {}).get("summary", {}).get("total_count", 0) if best else 0,
            "date":    (best.get("created_time") or "")[:10] if best else "",
        },
    }


# ===== Report builder =====

def build_html_report(ig_posts, ig_account, fb_pages_data):
    week_str = datetime.now().strftime("%d/%m/%Y")

    ig_total_likes    = sum(p.get("like_count", 0) for p in ig_posts)
    ig_total_comments = sum(p.get("comments_count", 0) for p in ig_posts)
    ig_best = max(ig_posts, key=lambda p: p.get("like_count", 0), default=None)
    ig_followers = ig_account.get("followers_count", "—")

    def post_rows_ig(posts):
        rows = ""
        for p in posts[:5]:
            date    = p.get("timestamp", "")[:10]
            likes   = p.get("like_count", 0)
            comments= p.get("comments_count", 0)
            caption = (p.get("caption") or "")[:60].replace("\n", " ")
            rows += f"""<tr>
                <td style="padding:6px 12px;border-bottom:1px solid #333">{date}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #333;color:#aaa">{caption}…</td>
                <td style="padding:6px 12px;border-bottom:1px solid #333;text-align:center">❤️ {likes}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #333;text-align:center">💬 {comments}</td>
            </tr>"""
        return rows or "<tr><td colspan='4' style='padding:12px;color:#666;text-align:center'>אין פוסטים השבוע</td></tr>"

    def fb_page_html(page):
        name  = page.get("name") or page.get("label", "Facebook")
        fans  = page.get("fans", 0)
        posts = page.get("posts_this_week", 0)
        likes = page.get("total_likes", 0)
        comms = page.get("total_comments", 0)
        best  = page.get("best_post", {})
        best_text = ""
        if best.get("message"):
            best_text = f"<p>⭐ <strong>הפוסט הטוב ביותר:</strong> {best['message'][:80]}… ({best.get('likes',0)} לייקים)</p>"
        return f"""
  <h2 style="color:#1877f2;margin-top:32px">📘 {name}</h2>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
    {''.join(f'<div style="background:#1a1a1a;padding:14px 20px;border-radius:8px;text-align:center;min-width:80px"><div style="font-size:24px;font-weight:bold;color:#c8a96e">{v}</div><div style="color:#888;font-size:12px">{lbl}</div></div>' for v,lbl in [(fans,'עוקבים'),(posts,'פוסטים'),(likes,'לייקים'),(comms,'תגובות')])}
  </div>
  {best_text}"""

    fb_sections = "".join(fb_page_html(p) for p in fb_pages_data) if fb_pages_data else "<p style='color:#888'>לא הוגדרו עמודי פייסבוק</p>"
    ig_best_text = f"<p>⭐ <strong>הפוסט הטוב ביותר:</strong> {(ig_best.get('caption') or '')[:80]}… ({ig_best.get('like_count', 0)} לייקים)</p>" if ig_best else ""

    return f"""<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><title>דוח שבועי — עמית ארז</title></head>
<body style="background:#0a0a0a;color:#f0ede8;font-family:Arial,sans-serif;padding:32px;max-width:640px;margin:0 auto">
  <h1 style="color:#c8a96e;border-bottom:1px solid #333;padding-bottom:12px">📊 דוח סושיאל מדיה שבועי</h1>
  <p style="color:#888">שבוע שהסתיים ב-{week_str}</p>

  <h2 style="color:#e1306c;margin-top:32px">📸 Instagram</h2>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
    {''.join(f'<div style="background:#1a1a1a;padding:14px 20px;border-radius:8px;text-align:center;min-width:80px"><div style="font-size:24px;font-weight:bold;color:#c8a96e">{v}</div><div style="color:#888;font-size:12px">{lbl}</div></div>' for v,lbl in [(ig_followers,'עוקבים'),(len(ig_posts),'פוסטים'),(ig_total_likes,'לייקים'),(ig_total_comments,'תגובות')])}
  </div>
  {ig_best_text}
  <table style="width:100%;border-collapse:collapse;background:#111;border-radius:8px;overflow:hidden">
    <thead><tr style="background:#1a1a1a;color:#c8a96e">
      <th style="padding:10px 12px;text-align:right">תאריך</th>
      <th style="padding:10px 12px;text-align:right">כיתוב</th>
      <th style="padding:10px 12px">לייקים</th>
      <th style="padding:10px 12px">תגובות</th>
    </tr></thead>
    <tbody>{post_rows_ig(ig_posts)}</tbody>
  </table>

  {fb_sections}

  <p style="color:#444;font-size:12px;margin-top:40px;text-align:center">דוח אוטומטי — amitphotos.com</p>
</body>
</html>"""


def send_email(subject, html):
    resp = requests.post(RESEND_API, headers={
        "Authorization": f"Bearer {RESEND_KEY}",
        "Content-Type": "application/json",
    }, json={
        "from":    "דוח עמית ארז <noreply@amitphotos.com>",
        "to":      [REPORT_EMAIL],
        "subject": subject,
        "html":    html,
    }, timeout=15)
    resp.raise_for_status()
    return resp.json()


def generate_ai_recommendations(ig_posts, ig_account, fb_pages_data):
    """יוצר המלצות AI מבוססות על ביצועי השבוע."""
    if not ANTHROPIC_KEY:
        return ["אין ANTHROPIC_API_KEY — המלצות לא זמינות"]

    ig_total_likes    = sum(p.get("like_count", 0) for p in ig_posts)
    ig_total_comments = sum(p.get("comments_count", 0) for p in ig_posts)
    ig_best = max(ig_posts, key=lambda p: p.get("like_count", 0), default=None)

    fb_summary = ""
    for page in fb_pages_data:
        fb_summary += f"\n  {page['name']}: {page['fans']} עוקבים, {page['posts_this_week']} פוסטים, {page['total_likes']} לייקים"

    summary = f"""Weekly social media performance for Amit Erez Photography (Israeli photographer):

Instagram:
- Followers: {ig_account.get('followers_count', '?')}
- Posts this week: {len(ig_posts)}
- Total likes: {ig_total_likes}
- Total comments: {ig_total_comments}
- Best post: {(ig_best.get('caption') or '')[:100] if ig_best else 'none'} ({ig_best.get('like_count', 0) if ig_best else 0} likes)

Facebook pages:{fb_summary or ' none configured'}"""

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            messages=[{"role": "user", "content": f"""{summary}

Based on this data, provide exactly 4 actionable recommendations in Hebrew for next week.
Each recommendation should be specific, practical, and based on the data.
Format: a simple JSON array of 4 strings, no markdown, no explanation outside the array.
Example: ["המלצה 1", "המלצה 2", "המלצה 3", "המלצה 4"]"""}],
        )
        text = msg.content[0].text.strip()
        return json.loads(text)
    except Exception as e:
        print(f"⚠️  AI recommendations נכשל: {e}")
        return ["לא הצלחתי לייצר המלצות השבוע"]


def save_social_report(ig_posts, ig_account, fb_pages_data, recommendations):
    """שומר דוח JSON לשימוש האדמין."""
    out = ROOT / "data" / "social_report.json"

    # שמור נתוני שבוע קודם להשוואה
    prev = {}
    if out.exists():
        try:
            old = json.loads(out.read_text(encoding="utf-8"))
            prev = {
                "ig_followers":      old.get("ig", {}).get("followers"),
                "ig_posts_this_week": old.get("ig", {}).get("posts_this_week"),
                "ig_total_likes":    old.get("ig", {}).get("total_likes"),
                "fb_fans":           old.get("fb", {}).get("fans"),
                "fb_posts_this_week": old.get("fb", {}).get("posts_this_week"),
                "fb_total_likes":    old.get("fb", {}).get("total_likes"),
            }
        except Exception:
            pass

    ig_best = max(ig_posts, key=lambda p: p.get("like_count", 0), default=None)
    ig_total_likes    = sum(p.get("like_count", 0) for p in ig_posts)
    ig_total_comments = sum(p.get("comments_count", 0) for p in ig_posts)
    ig_followers      = ig_account.get("followers_count", 0)
    ig_n              = len(ig_posts)
    ig_sorted = sorted(ig_posts, key=lambda p: p.get("like_count", 0), reverse=True)[:5]

    # fb backward-compat: aggregate or use first page
    first_fb = fb_pages_data[0] if fb_pages_data else {}

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "week_ending":  datetime.now().strftime("%d/%m/%Y"),
        "ig": {
            "followers":          ig_followers,
            "media_count":        ig_account.get("media_count", 0),
            "posts_this_week":    ig_n,
            "total_likes":        ig_total_likes,
            "total_comments":     ig_total_comments,
            "avg_likes_per_post": round(ig_total_likes / ig_n, 1) if ig_n else 0,
            "engagement_rate":    round((ig_total_likes + ig_total_comments) / (ig_n * max(ig_followers, 1)), 4) if ig_n else 0,
            "top_posts": [
                {
                    "caption":  (p.get("caption") or "")[:100].replace("\n", " "),
                    "likes":    p.get("like_count", 0),
                    "comments": p.get("comments_count", 0),
                    "date":     (p.get("timestamp") or "")[:10],
                }
                for p in ig_sorted
            ],
            "best_post": {
                "caption": (ig_best.get("caption") or "")[:120] if ig_best else "",
                "likes":   ig_best.get("like_count", 0) if ig_best else 0,
                "date":    (ig_best.get("timestamp") or "")[:10] if ig_best else "",
            },
        },
        # backward-compat: first FB page under "fb" key
        "fb": {
            "fans":               first_fb.get("fans", 0),
            "posts_this_week":    first_fb.get("posts_this_week", 0),
            "total_likes":        first_fb.get("total_likes", 0),
            "total_comments":     first_fb.get("total_comments", 0),
            "avg_likes_per_post": first_fb.get("avg_likes_per_post", 0),
            "engagement_rate":    first_fb.get("engagement_rate", 0),
            "top_posts":          first_fb.get("top_posts", []),
            "best_post":          first_fb.get("best_post", {"message": "", "likes": 0, "date": ""}),
        },
        # all FB pages as array (new)
        "fb_pages": fb_pages_data,
        "prev":           prev,
        "recommendations": recommendations,
    }

    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"💾 דוח נשמר ל-{out}")


def main():
    if not RESEND_KEY:
        print("❌ חסר RESEND_API_KEY")
        sys.exit(1)

    print("📊 אוסף נתוני Instagram...")
    ig_posts   = fetch_ig_insights()
    ig_account = fetch_ig_account_insights()

    print("📘 אוסף נתוני Facebook...")
    pages = get_fb_pages()
    if not pages:
        print("⚠️  לא הוגדרו עמודי פייסבוק (FACEBOOK_PAGE_IDS / FACEBOOK_PAGE_ID חסרים)")
    fb_pages_data = [build_fb_page_block(label, pid) for label, pid in pages]

    print("🤖 מייצר המלצות AI...")
    recommendations = generate_ai_recommendations(ig_posts, ig_account, fb_pages_data)
    for i, r in enumerate(recommendations, 1):
        print(f"   {i}. {r}")

    print("💾 שומר דוח JSON...")
    save_social_report(ig_posts, ig_account, fb_pages_data, recommendations)

    print("✉️  בונה דוח...")
    html = build_html_report(ig_posts, ig_account, fb_pages_data)

    week_str = datetime.now().strftime("%d/%m/%Y")
    subject  = f"📊 דוח שבועי סושיאל — {week_str}"

    print("📤 שולח מייל...")
    result = send_email(subject, html)
    print(f"✅ דוח נשלח! ID: {result.get('id', '')}")


if __name__ == "__main__":
    main()
