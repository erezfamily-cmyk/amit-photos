#!/usr/bin/env python3
"""
Weekly Social Media Report
שולח מייל שבועי עם נתוני ביצועים מאינסטגרם ופייסבוק.
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
FB_PAGE_ID   = os.environ.get("FACEBOOK_PAGE_ID", "")
FB_TOKEN     = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
RESEND_KEY      = os.environ.get("RESEND_API_KEY", "")
ANTHROPIC_KEY   = os.environ.get("ANTHROPIC_API_KEY", "")
REPORT_EMAIL = os.environ.get("REPORT_EMAIL", "erez.family@gmail.com")


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


def fetch_fb_posts():
    """שולף פוסטי פייסבוק מ-7 ימים אחרונים עם likes."""
    since = int((datetime.now(timezone.utc) - timedelta(days=7)).timestamp())
    try:
        resp = requests.get(f"{GRAPH_API}/{FB_PAGE_ID}/feed", params={
            "fields": "id,message,created_time,likes.summary(true),comments.summary(true)",
            "since":  since,
            "limit":  20,
            "access_token": FB_TOKEN,
        }, timeout=15)
        resp.raise_for_status()
        return resp.json().get("data", [])
    except Exception as e:
        print(f"⚠️  Facebook posts נכשל: {e}")
        return []


def fetch_fb_page_insights():
    """Fans count."""
    try:
        resp = requests.get(f"{GRAPH_API}/{FB_PAGE_ID}", params={
            "fields": "fan_count,followers_count",
            "access_token": FB_TOKEN,
        }, timeout=15)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"⚠️  Facebook page insights נכשל: {e}")
        return {}


def build_html_report(ig_posts, ig_account, fb_posts, fb_page):
    week_str = datetime.now().strftime("%d/%m/%Y")

    # Instagram stats
    ig_total_likes    = sum(p.get("like_count", 0) for p in ig_posts)
    ig_total_comments = sum(p.get("comments_count", 0) for p in ig_posts)
    ig_best = max(ig_posts, key=lambda p: p.get("like_count", 0), default=None)
    ig_followers = ig_account.get("followers_count", "—")

    # Facebook stats
    fb_total_likes    = sum(p.get("likes", {}).get("summary", {}).get("total_count", 0) for p in fb_posts)
    fb_total_comments = sum(p.get("comments", {}).get("summary", {}).get("total_count", 0) for p in fb_posts)
    fb_best = max(fb_posts, key=lambda p: p.get("likes", {}).get("summary", {}).get("total_count", 0), default=None)
    fb_fans = fb_page.get("fan_count", "—")

    def post_rows(posts, platform):
        rows = ""
        for p in posts[:5]:
            if platform == "ig":
                date    = p.get("timestamp", "")[:10]
                likes   = p.get("like_count", 0)
                comments= p.get("comments_count", 0)
                caption = (p.get("caption") or "")[:60].replace("\n", " ")
            else:
                date    = p.get("created_time", "")[:10]
                likes   = p.get("likes", {}).get("summary", {}).get("total_count", 0)
                comments= p.get("comments", {}).get("summary", {}).get("total_count", 0)
                caption = (p.get("message") or "")[:60].replace("\n", " ")
            rows += f"""<tr>
                <td style="padding:6px 12px;border-bottom:1px solid #333">{date}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #333;color:#aaa">{caption}…</td>
                <td style="padding:6px 12px;border-bottom:1px solid #333;text-align:center">❤️ {likes}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #333;text-align:center">💬 {comments}</td>
            </tr>"""
        return rows or "<tr><td colspan='4' style='padding:12px;color:#666;text-align:center'>אין פוסטים השבוע</td></tr>"

    ig_best_text = ""
    if ig_best:
        ig_best_text = f"<p>⭐ <strong>הפוסט הטוב ביותר:</strong> {(ig_best.get('caption') or '')[:80]}… ({ig_best.get('like_count', 0)} לייקים)</p>"

    fb_best_text = ""
    if fb_best:
        fb_likes = fb_best.get("likes", {}).get("summary", {}).get("total_count", 0)
        fb_best_text = f"<p>⭐ <strong>הפוסט הטוב ביותר:</strong> {(fb_best.get('message') or '')[:80]}… ({fb_likes} לייקים)</p>"

    return f"""<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><title>דוח שבועי — עמית ארז</title></head>
<body style="background:#0a0a0a;color:#f0ede8;font-family:Arial,sans-serif;padding:32px;max-width:640px;margin:0 auto">
  <h1 style="color:#c8a96e;border-bottom:1px solid #333;padding-bottom:12px">
    📊 דוח סושיאל מדיה שבועי
  </h1>
  <p style="color:#888">שבוע שהסתיים ב-{week_str}</p>

  <!-- Instagram -->
  <h2 style="color:#e1306c;margin-top:32px">📸 Instagram</h2>
  <div style="display:flex;gap:24px;margin-bottom:16px">
    <div style="background:#1a1a1a;padding:16px 24px;border-radius:8px;flex:1;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#c8a96e">{ig_followers}</div>
      <div style="color:#888;font-size:13px">עוקבים</div>
    </div>
    <div style="background:#1a1a1a;padding:16px 24px;border-radius:8px;flex:1;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#c8a96e">{len(ig_posts)}</div>
      <div style="color:#888;font-size:13px">פוסטים השבוע</div>
    </div>
    <div style="background:#1a1a1a;padding:16px 24px;border-radius:8px;flex:1;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#c8a96e">{ig_total_likes}</div>
      <div style="color:#888;font-size:13px">לייקים</div>
    </div>
    <div style="background:#1a1a1a;padding:16px 24px;border-radius:8px;flex:1;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#c8a96e">{ig_total_comments}</div>
      <div style="color:#888;font-size:13px">תגובות</div>
    </div>
  </div>
  {ig_best_text}
  <table style="width:100%;border-collapse:collapse;background:#111;border-radius:8px;overflow:hidden">
    <thead>
      <tr style="background:#1a1a1a;color:#c8a96e">
        <th style="padding:10px 12px;text-align:right">תאריך</th>
        <th style="padding:10px 12px;text-align:right">כיתוב</th>
        <th style="padding:10px 12px">לייקים</th>
        <th style="padding:10px 12px">תגובות</th>
      </tr>
    </thead>
    <tbody>{post_rows(ig_posts, "ig")}</tbody>
  </table>

  <!-- Facebook -->
  <h2 style="color:#1877f2;margin-top:32px">📘 Facebook</h2>
  <div style="display:flex;gap:24px;margin-bottom:16px">
    <div style="background:#1a1a1a;padding:16px 24px;border-radius:8px;flex:1;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#c8a96e">{fb_fans}</div>
      <div style="color:#888;font-size:13px">עוקבים</div>
    </div>
    <div style="background:#1a1a1a;padding:16px 24px;border-radius:8px;flex:1;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#c8a96e">{len(fb_posts)}</div>
      <div style="color:#888;font-size:13px">פוסטים השבוע</div>
    </div>
    <div style="background:#1a1a1a;padding:16px 24px;border-radius:8px;flex:1;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#c8a96e">{fb_total_likes}</div>
      <div style="color:#888;font-size:13px">לייקים</div>
    </div>
    <div style="background:#1a1a1a;padding:16px 24px;border-radius:8px;flex:1;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#c8a96e">{fb_total_comments}</div>
      <div style="color:#888;font-size:13px">תגובות</div>
    </div>
  </div>
  {fb_best_text}
  <table style="width:100%;border-collapse:collapse;background:#111;border-radius:8px;overflow:hidden">
    <thead>
      <tr style="background:#1a1a1a;color:#c8a96e">
        <th style="padding:10px 12px;text-align:right">תאריך</th>
        <th style="padding:10px 12px;text-align:right">פוסט</th>
        <th style="padding:10px 12px">לייקים</th>
        <th style="padding:10px 12px">תגובות</th>
      </tr>
    </thead>
    <tbody>{post_rows(fb_posts, "fb")}</tbody>
  </table>

  <p style="color:#444;font-size:12px;margin-top:40px;text-align:center">
    דוח אוטומטי — amitphotos.com
  </p>
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


def generate_ai_recommendations(ig_posts, ig_account, fb_posts, fb_page):
    """יוצר המלצות AI מבוססות על ביצועי השבוע."""
    if not ANTHROPIC_KEY:
        return ["אין ANTHROPIC_API_KEY — המלצות לא זמינות"]

    ig_total_likes    = sum(p.get("like_count", 0) for p in ig_posts)
    ig_total_comments = sum(p.get("comments_count", 0) for p in ig_posts)
    ig_best = max(ig_posts, key=lambda p: p.get("like_count", 0), default=None)
    fb_total_likes    = sum(p.get("likes", {}).get("summary", {}).get("total_count", 0) for p in fb_posts)
    fb_best = max(fb_posts, key=lambda p: p.get("likes", {}).get("summary", {}).get("total_count", 0), default=None)

    summary = f"""Weekly social media performance for Amit Erez Photography (Israeli photographer):

Instagram:
- Followers: {ig_account.get('followers_count', '?')}
- Posts this week: {len(ig_posts)}
- Total likes: {ig_total_likes}
- Total comments: {ig_total_comments}
- Best post: {(ig_best.get('caption') or '')[:100] if ig_best else 'none'} ({ig_best.get('like_count', 0) if ig_best else 0} likes)

Facebook:
- Fans: {fb_page.get('fan_count', '?')}
- Posts this week: {len(fb_posts)}
- Total likes: {fb_total_likes}
- Best post: {(fb_best.get('message') or '')[:100] if fb_best else 'none'} ({fb_best.get('likes', {}).get('summary', {}).get('total_count', 0) if fb_best else 0} likes)"""

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


def save_social_report(ig_posts, ig_account, fb_posts, fb_page, recommendations):
    """שומר דוח JSON לשימוש האדמין."""
    ig_best = max(ig_posts, key=lambda p: p.get("like_count", 0), default=None)
    fb_best = max(fb_posts, key=lambda p: p.get("likes", {}).get("summary", {}).get("total_count", 0), default=None)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "week_ending": datetime.now().strftime("%d/%m/%Y"),
        "ig": {
            "followers": ig_account.get("followers_count", 0),
            "media_count": ig_account.get("media_count", 0),
            "posts_this_week": len(ig_posts),
            "total_likes": sum(p.get("like_count", 0) for p in ig_posts),
            "total_comments": sum(p.get("comments_count", 0) for p in ig_posts),
            "best_post": {
                "caption": (ig_best.get("caption") or "")[:120] if ig_best else "",
                "likes": ig_best.get("like_count", 0) if ig_best else 0,
                "date": ig_best.get("timestamp", "")[:10] if ig_best else "",
            },
        },
        "fb": {
            "fans": fb_page.get("fan_count", 0),
            "posts_this_week": len(fb_posts),
            "total_likes": sum(p.get("likes", {}).get("summary", {}).get("total_count", 0) for p in fb_posts),
            "total_comments": sum(p.get("comments", {}).get("summary", {}).get("total_count", 0) for p in fb_posts),
            "best_post": {
                "message": (fb_best.get("message") or "")[:120] if fb_best else "",
                "likes": fb_best.get("likes", {}).get("summary", {}).get("total_count", 0) if fb_best else 0,
                "date": fb_best.get("created_time", "")[:10] if fb_best else "",
            },
        },
        "recommendations": recommendations,
    }

    out = ROOT / "data" / "social_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"💾 דוח נשמר ל-{out}")


def main():
    if not RESEND_KEY:
        print("❌ חסר RESEND_API_KEY")
        sys.exit(1)

    print("📊 אוסף נתוני Instagram...")
    ig_posts   = fetch_ig_insights()
    ig_account = fetch_ig_account_insights()

    print("📊 אוסף נתוני Facebook...")
    fb_posts = fetch_fb_posts()
    fb_page  = fetch_fb_page_insights()

    print("🤖 מייצר המלצות AI...")
    recommendations = generate_ai_recommendations(ig_posts, ig_account, fb_posts, fb_page)
    for i, r in enumerate(recommendations, 1):
        print(f"   {i}. {r}")

    print("💾 שומר דוח JSON...")
    save_social_report(ig_posts, ig_account, fb_posts, fb_page, recommendations)

    print("✉️  בונה דוח...")
    html = build_html_report(ig_posts, ig_account, fb_posts, fb_page)

    week_str = datetime.now().strftime("%d/%m/%Y")
    subject  = f"📊 דוח שבועי סושיאל — {week_str}"

    print("📤 שולח מייל...")
    result = send_email(subject, html)
    print(f"✅ דוח נשלח! ID: {result.get('id', '')}")


if __name__ == "__main__":
    main()
