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
import subprocess
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
    """שולף נתוני אינסטגרם — פוסטים מ-7 ימים אחרונים (כולל media_type/media_product_type לזיהוי Reels)."""
    since = int((datetime.now(timezone.utc) - timedelta(days=7)).timestamp())
    try:
        resp = requests.get(f"{GRAPH_API}/{IG_USER_ID}/media", params={
            "fields": "id,caption,like_count,comments_count,timestamp,media_url,media_type,media_product_type",
            "since":  since,
            "limit":  20,
            "access_token": IG_TOKEN,
        }, timeout=15)
        resp.raise_for_status()
        return resp.json().get("data", [])
    except Exception as e:
        print(f"⚠️  Instagram insights נכשל: {e}")
        return []


# מדדים ספציפיים ל-Reels (Graph API v21.0). מטא שינתה את "plays" ל-"views" — הפונקציה
# נכשלת בשקט ומחזירה {} אם מדד לא תקין (כמו שאר קריאות ה-API בקובץ), לא קורסת את הדוח כולו.
REEL_METRICS = "views,reach,saved,shares,total_interactions,ig_reels_avg_watch_time"


def is_reel(post):
    return post.get("media_product_type") == "REELS" or post.get("media_type") == "VIDEO"


def fetch_reel_insights(media_id):
    """שולף מדדי Reels (צפיות, זמן צפייה ממוצע, שיתופים, שמירות) למדיה בודדת."""
    try:
        resp = requests.get(f"{GRAPH_API}/{media_id}/insights", params={
            "metric": REEL_METRICS,
            "access_token": IG_TOKEN,
        }, timeout=15)
        resp.raise_for_status()
        out = {}
        for item in resp.json().get("data", []):
            values = item.get("values", [])
            out[item.get("name")] = values[0].get("value", 0) if values else 0
        return out
    except requests.exceptions.HTTPError as e:
        # מטא משנה שמות מדדים בין גרסאות API — הדפס את גוף התשובה כדי לדעת איזה metric נכשל בפועל
        detail = e.response.text if e.response is not None else str(e)
        print(f"⚠️  Reel insights ({media_id}) נכשל: {detail}")
        return {}
    except Exception as e:
        print(f"⚠️  Reel insights ({media_id}) נכשל: {e}")
        return {}


def build_reel_summary(ig_posts):
    """מרכז מדדי Reels לשבוע: סה\"כ צפיות/שיתופים/שמירות + הרילס המוביל."""
    reels = [p for p in ig_posts if is_reel(p)]
    for p in reels:
        p["reel_metrics"] = fetch_reel_insights(p["id"])

    n = len(reels)
    total_plays   = sum(p["reel_metrics"].get("views", 0) for p in reels)
    total_reach   = sum(p["reel_metrics"].get("reach", 0) for p in reels)
    total_shares  = sum(p["reel_metrics"].get("shares", 0) for p in reels)
    total_saved   = sum(p["reel_metrics"].get("saved", 0) for p in reels)
    watch_times   = [p["reel_metrics"].get("ig_reels_avg_watch_time", 0) for p in reels if p["reel_metrics"].get("ig_reels_avg_watch_time")]
    avg_watch     = round(sum(watch_times) / len(watch_times), 1) if watch_times else 0
    best = max(reels, key=lambda p: p["reel_metrics"].get("views", 0), default=None)

    return {
        "reels_this_week": n,
        "total_plays":     total_plays,
        "total_reach":     total_reach,
        "total_shares":    total_shares,
        "total_saved":     total_saved,
        "avg_watch_time":  avg_watch,
        "top_reels": [
            {
                "caption": (p.get("caption") or "")[:100].replace("\n", " "),
                "plays":   p["reel_metrics"].get("views", 0),
                "reach":   p["reel_metrics"].get("reach", 0),
                "shares":  p["reel_metrics"].get("shares", 0),
                "saved":   p["reel_metrics"].get("saved", 0),
                "date":    (p.get("timestamp") or "")[:10],
            }
            for p in sorted(reels, key=lambda p: p["reel_metrics"].get("views", 0), reverse=True)[:5]
        ],
        "best_reel": {
            "caption": (best.get("caption") or "")[:120] if best else "",
            "plays":   best["reel_metrics"].get("views", 0) if best else 0,
            "date":    (best.get("timestamp") or "")[:10] if best else "",
        },
    }


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

def count_fb_posts_from_git():
    """סופר פרסומי פייסבוק מ-7 ימים אחרונים לפי git log של facebook_posted.json."""
    try:
        result = subprocess.run(
            ["git", "log", "--since=7 days ago", "--oneline", "--", "data/facebook_posted.json"],
            capture_output=True, text=True, cwd=ROOT, timeout=10,
        )
        count = len([l for l in result.stdout.strip().splitlines() if l])
        print(f"📋 git fallback: {count} פרסומי פייסבוק ב-7 ימים אחרונים")
        return count
    except Exception as e:
        print(f"⚠️  git fallback נכשל: {e}")
        return 0


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
        try:
            detail = e.response.json() if hasattr(e, "response") else {}
        except Exception:
            detail = {}
        print(f"⚠️  Facebook posts ({page_id}) נכשל: {e} | פרטים: {detail}")
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
    # כשה-API נכשל (token חסר הרשאות קריאה), נשתמש ב-git כ-fallback לספירת פוסטים
    if n == 0 and not posts:
        n = count_fb_posts_from_git()

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

def build_html_report(ig_posts, ig_account, fb_pages_data, reel_summary):
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

    def reel_rows():
        rows = ""
        for r in reel_summary.get("top_reels", []):
            rows += f"""<tr>
                <td style="padding:6px 12px;border-bottom:1px solid #333">{r['date']}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #333;color:#aaa">{r['caption']}…</td>
                <td style="padding:6px 12px;border-bottom:1px solid #333;text-align:center">▶️ {r['plays']}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #333;text-align:center">🔁 {r['shares']}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #333;text-align:center">🔖 {r['saved']}</td>
            </tr>"""
        return rows or "<tr><td colspan='5' style='padding:12px;color:#666;text-align:center'>אין Reels השבוע</td></tr>"

    reels_section = ""
    if reel_summary.get("reels_this_week"):
        reels_section = f"""
  <h2 style="color:#f77737;margin-top:32px">🎬 Reels</h2>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
    {''.join(f'<div style="background:#1a1a1a;padding:14px 20px;border-radius:8px;text-align:center;min-width:80px"><div style="font-size:24px;font-weight:bold;color:#c8a96e">{v}</div><div style="color:#888;font-size:12px">{lbl}</div></div>' for v,lbl in [(reel_summary['reels_this_week'],'Reels'),(reel_summary['total_plays'],'צפיות'),(reel_summary['avg_watch_time'],'שנ׳ צפייה ממוצע'),(reel_summary['total_shares'],'שיתופים'),(reel_summary['total_saved'],'שמירות')])}
  </div>
  <table style="width:100%;border-collapse:collapse;background:#111;border-radius:8px;overflow:hidden">
    <thead><tr style="background:#1a1a1a;color:#c8a96e">
      <th style="padding:10px 12px;text-align:right">תאריך</th>
      <th style="padding:10px 12px;text-align:right">כיתוב</th>
      <th style="padding:10px 12px">צפיות</th>
      <th style="padding:10px 12px">שיתופים</th>
      <th style="padding:10px 12px">שמירות</th>
    </tr></thead>
    <tbody>{reel_rows()}</tbody>
  </table>"""

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

  {reels_section}

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


def generate_ai_recommendations(ig_posts, ig_account, fb_pages_data, reel_summary):
    """יוצר המלצות AI מבוססות על ביצועי השבוע."""
    if not ANTHROPIC_KEY:
        return ["אין ANTHROPIC_API_KEY — המלצות לא זמינות"]

    ig_total_likes    = sum(p.get("like_count", 0) for p in ig_posts)
    ig_total_comments = sum(p.get("comments_count", 0) for p in ig_posts)
    ig_best = max(ig_posts, key=lambda p: p.get("like_count", 0), default=None)
    ig_n = len(ig_posts)
    ig_followers = ig_account.get("followers_count", 0)
    ig_avg = round(ig_total_likes / ig_n, 1) if ig_n else 0

    fb_summary = ""
    for page in fb_pages_data:
        fb_summary += f"\n  {page['name']}: {page['fans']} עוקבים, {page['posts_this_week']} פוסטים, {page['total_likes']} לייקים"

    reels_summary_text = "none this week"
    if reel_summary.get("reels_this_week"):
        best_reel = reel_summary.get("best_reel", {})
        reels_summary_text = (
            f"{reel_summary['reels_this_week']} reels, {reel_summary['total_plays']} total plays, "
            f"avg watch time {reel_summary['avg_watch_time']}s, {reel_summary['total_shares']} shares, "
            f"{reel_summary['total_saved']} saves. Best reel ({best_reel.get('plays', 0)} plays): "
            f"{best_reel.get('caption', '')[:120] or 'none'}"
        )

    summary = f"""Weekly social media performance for Amit Erez Photography (Israeli photographer):

Instagram (@amitphotos.com):
- Followers: {ig_followers}
- Posts this week: {ig_n}
- Total likes: {ig_total_likes}
- Avg likes/post: {ig_avg}
- Total comments: {ig_total_comments}
- Best post ({ig_best.get('like_count', 0) if ig_best else 0} likes): {(ig_best.get('caption') or '')[:120] if ig_best else 'none'}

Instagram Reels this week: {reels_summary_text}

Facebook pages:{fb_summary or ' none configured'}"""

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=800,
            messages=[{"role": "user", "content": f"""{summary}

Based on this data, provide exactly 4 actionable recommendations in Hebrew for next week.
Each recommendation should be specific, practical, and based on the actual numbers above.
At least one recommendation must address Instagram Reels/video performance specifically (watch time, plays, shares/saves vs. static posts) when reel data is present above.
Return ONLY the 4 recommendations, each on its own line, separated by a line containing exactly "|||" and nothing else.
No numbering, no markdown, no explanation before or after — just the 4 lines with the separator between them."""}],
        )
        text = msg.content[0].text.strip()
        result = [part.strip() for part in text.split("|||") if part.strip()]
        if not result:
            raise ValueError("תוצאה לא תקינה מה-AI")
        return result
    except Exception as e:
        print(f"⚠️  AI recommendations נכשל: {e}")
        return [f"שגיאה בייצור המלצות: {e}"]


def _append_to_history(report):
    """מוסיף שורת סיכום לקובץ ההיסטוריה השבועית."""
    history_file = ROOT / "data" / "social_history.json"
    history = []
    if history_file.exists():
        try:
            history = json.loads(history_file.read_text(encoding="utf-8"))
            if not isinstance(history, list):
                history = []
        except Exception:
            history = []

    week_key = report.get("week_ending", "")
    # אל תוסיף שורה כפולה לאותו שבוע
    if any(h.get("week_ending") == week_key for h in history):
        print(f"ℹ️  היסטוריה: שבוע {week_key} כבר קיים, דולג")
        return

    ig = report.get("ig", {})
    first_fb = (report.get("fb_pages") or [{}])[0]
    reels = report.get("reels", {})
    row = {
        "week_ending":    week_key,
        "generated_at":   report.get("generated_at", ""),
        "ig_followers":   ig.get("followers"),
        "ig_posts":       ig.get("posts_this_week"),
        "ig_likes":       ig.get("total_likes"),
        "ig_comments":    ig.get("total_comments"),
        "ig_avg_likes":   ig.get("avg_likes_per_post"),
        "ig_engagement":  ig.get("engagement_rate"),
        "fb_fans":        first_fb.get("fans"),
        "fb_posts":       first_fb.get("posts_this_week"),
        "fb_likes":       first_fb.get("total_likes"),
        "reels_count":    reels.get("reels_this_week"),
        "reels_plays":    reels.get("total_plays"),
        "reels_avg_watch_time": reels.get("avg_watch_time"),
        "reels_shares":   reels.get("total_shares"),
        "reels_saved":    reels.get("total_saved"),
    }
    history.append(row)
    # שמור עם הישן קודם (סדר כרונולוגי)
    history_file.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"📈 היסטוריה: נוסף שבוע {week_key} ({len(history)} שבועות סה\"כ)")


def save_social_report(ig_posts, ig_account, fb_pages_data, recommendations, reel_summary):
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
        "reels":          reel_summary,
        "prev":           prev,
        "recommendations": recommendations,
    }

    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"💾 דוח נשמר ל-{out}")

    # צבור היסטוריה שבועית
    _append_to_history(report)


def main():
    if not RESEND_KEY:
        print("❌ חסר RESEND_API_KEY")
        sys.exit(1)

    print("📊 אוסף נתוני Instagram...")
    ig_posts   = fetch_ig_insights()
    ig_account = fetch_ig_account_insights()

    print("🎬 אוסף נתוני Reels...")
    reel_summary = build_reel_summary(ig_posts)
    print(f"   {reel_summary['reels_this_week']} reels, {reel_summary['total_plays']} צפיות סה\"כ")

    print("📘 אוסף נתוני Facebook...")
    pages = get_fb_pages()
    if not pages:
        print("⚠️  לא הוגדרו עמודי פייסבוק (FACEBOOK_PAGE_IDS / FACEBOOK_PAGE_ID חסרים)")
    fb_pages_data = [build_fb_page_block(label, pid) for label, pid in pages]

    print("🤖 מייצר המלצות AI...")
    recommendations = generate_ai_recommendations(ig_posts, ig_account, fb_pages_data, reel_summary)
    for i, r in enumerate(recommendations, 1):
        print(f"   {i}. {r}")

    print("💾 שומר דוח JSON...")
    save_social_report(ig_posts, ig_account, fb_pages_data, recommendations, reel_summary)

    print("✉️  בונה דוח...")
    html = build_html_report(ig_posts, ig_account, fb_pages_data, reel_summary)

    week_str = datetime.now().strftime("%d/%m/%Y")
    subject  = f"📊 דוח שבועי סושיאל — {week_str}"

    print("📤 שולח מייל...")
    result = send_email(subject, html)
    print(f"✅ דוח נשלח! ID: {result.get('id', '')}")


if __name__ == "__main__":
    main()
