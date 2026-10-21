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
from social_photo_map import build_post_lookup, build_post_metadata_lookup
from social_caption_quality import analyze_caption_set
from social_decision_engine import build_decision_support, latest_ga_snapshot, load_json
from social_business_audit import facebook_duplicates, build_social_business_audit
from social_optimization import build_optimization_policy, load_policy, save_policy

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
DATA_FETCH_FAILURES = {}
MEDIA_INSIGHT_WARNINGS = []


def record_fetch_failure(source, error):
    """Record a safe source/status summary without logging request URLs or tokens."""
    response = getattr(error, "response", None)
    status = getattr(response, "status_code", None)
    DATA_FETCH_FAILURES[source] = f"HTTP {status}" if status else type(error).__name__

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


def build_content_quality_summary(ig_posts, fb_pages_data):
    """Measure caption hygiene so editorial changes can be tracked week to week."""
    return {
        "instagram": analyze_caption_set(p.get("caption") or "" for p in ig_posts),
        "facebook_pages": {
            page.get("name") or page.get("label") or "Facebook": page.get("content_quality", {})
            for page in fb_pages_data
        },
        "instagram_editorial_performance": build_editorial_performance(
            ig_posts, "instagram", "like_count", "comments_count",
        ),
        "facebook_editorial_performance": {
            page.get("name") or page.get("label") or "Facebook": page.get("editorial_performance", {})
            for page in fb_pages_data
        },
    }


def build_editorial_performance(posts, platform, likes_key, comments_key):
    """Aggregate results only for posts saved with an explicit editorial angle."""
    metadata = build_post_metadata_lookup()
    totals = {}
    for post in posts:
        row = metadata.get((platform, str(post.get("id", ""))), {})
        angle = row.get("content_angle")
        if not angle:
            continue
        bucket = totals.setdefault(angle, {"posts": 0, "likes": 0, "comments": 0, "reach": 0, "saved": 0, "shares": 0, "posts_with_reach": 0, "full_interactions": 0, "posts_with_full_metrics": 0})
        likes = post.get(likes_key, 0) or 0
        comments = post.get(comments_key, 0) or 0
        if isinstance(likes, dict):
            likes = likes.get("summary", {}).get("total_count", 0)
        if isinstance(comments, dict):
            comments = comments.get("summary", {}).get("total_count", 0)
        bucket["posts"] += 1
        bucket["likes"] += likes
        bucket["comments"] += comments
        insights = post.get("insights", {})
        if insights.get("reach") is not None:
            bucket["reach"] += insights.get("reach", 0) or 0
            bucket["posts_with_reach"] += 1
        if insights.get("reach") is not None and "saved" in insights and "shares" in insights:
            bucket["saved"] += insights.get("saved", 0) or 0
            bucket["shares"] += insights.get("shares", 0) or 0
            bucket["full_interactions"] += likes + comments + (insights.get("saved", 0) or 0) + (insights.get("shares", 0) or 0)
            bucket["posts_with_full_metrics"] += 1
    for bucket in totals.values():
        interactions = bucket["likes"] + bucket["comments"]
        bucket["avg_interactions"] = round(interactions / bucket["posts"], 1)
        bucket["engagement_rate_by_reach"] = round(bucket["full_interactions"] / bucket["reach"], 4) if bucket["reach"] and bucket["posts_with_full_metrics"] == bucket["posts"] else None
    return totals


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
        record_fetch_failure("instagram_media", e)
        print("⚠️  Instagram media request failed; report will mark this source unavailable")
        return []


# מדדים ספציפיים ל-Reels (Graph API v21.0). מטא שינתה את "plays" ל-"views" — הפונקציה
# נכשלת בשקט ומחזירה {} אם מדד לא תקין (כמו שאר קריאות ה-API בקובץ), לא קורסת את הדוח כולו.
REEL_METRICS = "views,reach,saved,shares,total_interactions,ig_reels_avg_watch_time"
POST_METRICS = "reach,saved,shares,total_interactions"
REEL_FALLBACK_METRICS = "views,reach,saved,shares,total_interactions"


def is_reel(post):
    return post.get("media_product_type") == "REELS" or post.get("media_type") == "VIDEO"


def fetch_media_insights(post):
    """Fetch reach-based metrics, retrying with a minimal metric set when Meta differs by media type."""
    metric_sets = [REEL_METRICS, REEL_FALLBACK_METRICS, "views,reach", "reach"] if is_reel(post) else [POST_METRICS, "reach,saved,shares", "reach"]
    for metrics in metric_sets:
        try:
            resp = requests.get(f"{GRAPH_API}/{post['id']}/insights", params={
                "metric": metrics,
                "access_token": IG_TOKEN,
            }, timeout=15)
            resp.raise_for_status()
            out = {}
            for item in resp.json().get("data", []):
                values = item.get("values", [])
                out[item.get("name")] = values[0].get("value", 0) if values else 0
            return out
        except Exception:
            continue
    MEDIA_INSIGHT_WARNINGS.append(str(post.get("id", "")))
    print(f"⚠️  Media insights unavailable for {post.get('id', '')}")
    return {}


def enrich_ig_posts(ig_posts):
    for post in ig_posts:
        post["insights"] = fetch_media_insights(post)
    return ig_posts


def build_reel_summary(ig_posts):
    """מרכז מדדי Reels לשבוע: סה\"כ צפיות/שיתופים/שמירות + הרילס המוביל."""
    post_lookup = build_post_lookup()
    reels = [p for p in ig_posts if is_reel(p)]
    for p in reels:
        p["reel_metrics"] = p.get("insights", {})

    n = len(reels)
    view_posts = [p for p in reels if "views" in p["reel_metrics"]]
    reach_posts = [p for p in reels if "reach" in p["reel_metrics"]]
    share_posts = [p for p in reels if "shares" in p["reel_metrics"]]
    saved_posts = [p for p in reels if "saved" in p["reel_metrics"]]
    total_plays   = sum(p["reel_metrics"].get("views", 0) for p in view_posts) if view_posts else None
    total_reach   = sum(p["reel_metrics"].get("reach", 0) for p in reach_posts) if reach_posts else None
    total_shares  = sum(p["reel_metrics"].get("shares", 0) for p in share_posts) if share_posts else None
    total_saved   = sum(p["reel_metrics"].get("saved", 0) for p in saved_posts) if saved_posts else None
    watch_times   = [p["reel_metrics"].get("ig_reels_avg_watch_time", 0) for p in reels if p["reel_metrics"].get("ig_reels_avg_watch_time")]
    avg_watch_ms  = round(sum(watch_times) / len(watch_times), 1) if watch_times else None
    avg_watch_seconds = round(avg_watch_ms / 1000, 1) if avg_watch_ms is not None else None
    best = max(reels, key=lambda p: p["reel_metrics"].get("views") or 0, default=None)

    return {
        "reels_this_week": n,
        "total_plays":     total_plays,
        "total_reach":     total_reach,
        "total_shares":    total_shares,
        "total_saved":     total_saved,
        "metric_coverage": {
            "views": len(view_posts),
            "reach": len(reach_posts),
            "shares": len(share_posts),
            "saved": len(saved_posts),
        },
        "avg_watch_time":  avg_watch_seconds,
        "avg_watch_time_seconds": avg_watch_seconds,
        "avg_watch_time_ms": avg_watch_ms,
        "top_reels": [
            {
                "post_id": p.get("id", ""),
                "photo_id": post_lookup.get(("instagram", str(p.get("id", ""))), ""),
                "caption": (p.get("caption") or "")[:100].replace("\n", " "),
                "plays":   p["reel_metrics"].get("views"),
                "reach":   p["reel_metrics"].get("reach"),
                "shares":  p["reel_metrics"].get("shares"),
                "saved":   p["reel_metrics"].get("saved"),
                "date":    (p.get("timestamp") or "")[:10],
            }
            for p in sorted(reels, key=lambda p: p["reel_metrics"].get("views", 0), reverse=True)[:5]
        ],
        "best_reel": {
            "post_id": best.get("id", "") if best else "",
            "photo_id": post_lookup.get(("instagram", str(best.get("id", ""))), "") if best else "",
            "caption": (best.get("caption") or "")[:120] if best else "",
            "plays":   best["reel_metrics"].get("views") if best else None,
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
        record_fetch_failure("instagram_account", e)
        print("⚠️  Instagram account request failed; report will mark this source unavailable")
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
        record_fetch_failure(f"facebook_posts:{page_id}", e)
        print(f"⚠️  Facebook posts request failed for page {page_id}")
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
        record_fetch_failure(f"facebook_page:{page_id}", e)
        print(f"⚠️  Facebook page-info request failed for page {page_id}")
        return {}


def build_fb_page_block(label, page_id):
    """מחזיר dict מלא לעמוד פייסבוק אחד."""
    post_lookup = build_post_lookup()
    print(f"  📘 שולף עמוד: {label} ({page_id})")
    posts    = fetch_fb_page_posts(page_id)
    info     = fetch_fb_page_info(page_id)
    posts_available = f"facebook_posts:{page_id}" not in DATA_FETCH_FAILURES
    page_available = f"facebook_page:{page_id}" not in DATA_FETCH_FAILURES
    fans     = info.get("fan_count", 0) if page_available else None
    name     = info.get("name") or label
    n        = len(posts)
    # כשה-API נכשל (token חסר הרשאות קריאה), נשתמש ב-git כ-fallback לספירת פוסטים
    if n == 0 and not posts:
        n = count_fb_posts_from_git()

    total_likes    = sum(p.get("reactions", {}).get("summary", {}).get("total_count", 0) for p in posts) if posts_available else None
    total_comments = sum(p.get("comments",  {}).get("summary", {}).get("total_count", 0) for p in posts) if posts_available else None
    best = max(posts, key=lambda p: p.get("reactions", {}).get("summary", {}).get("total_count", 0), default=None)
    top5 = sorted(posts, key=lambda p: p.get("reactions", {}).get("summary", {}).get("total_count", 0), reverse=True)[:5]

    return {
        "label":   label,
        "name":    name,
        "page_id": page_id,
        "fans":    fans,
        "posts_this_week":    n if posts_available else None,
        "suspected_duplicates": facebook_duplicates(posts) if posts_available else [],
        "total_likes":        total_likes,
        "total_comments":     total_comments,
        "avg_likes_per_post": round(total_likes / n, 1) if posts_available and n else (0 if posts_available else None),
        "engagement_rate":    round((total_likes + total_comments) / (n * max(fans, 1)), 4) if posts_available and page_available and n else (0 if posts_available and page_available else None),
        "top_posts": [
            {
                "post_id":  p.get("id", ""),
                "photo_id": post_lookup.get(("facebook", str(p.get("id", ""))), ""),
                "message":  (p.get("message") or "")[:100].replace("\n", " "),
                "likes":    p.get("reactions", {}).get("summary", {}).get("total_count", 0),
                "comments": p.get("comments",  {}).get("summary", {}).get("total_count", 0),
                "date":     (p.get("created_time") or "")[:10],
            }
            for p in top5
        ],
        "photo_performance": [
            {
                "post_id": p.get("id", ""),
                "photo_id": post_lookup.get(("facebook", str(p.get("id", ""))), ""),
                "likes": p.get("reactions", {}).get("summary", {}).get("total_count", 0),
                "comments": p.get("comments", {}).get("summary", {}).get("total_count", 0),
                "date": (p.get("created_time") or "")[:10],
            }
            for p in posts
            if post_lookup.get(("facebook", str(p.get("id", ""))), "")
        ],
        "best_post": {
            "post_id": best.get("id", "") if best else "",
            "photo_id": post_lookup.get(("facebook", str(best.get("id", ""))), "") if best else "",
            "message": (best.get("message") or "")[:120] if best else "",
            "likes":   best.get("reactions", {}).get("summary", {}).get("total_count", 0) if best else 0,
            "date":    (best.get("created_time") or "")[:10] if best else "",
        },
        "content_quality": analyze_caption_set(p.get("message") or "" for p in posts),
        "editorial_performance": build_editorial_performance(
            posts, "facebook", "reactions", "comments",
        ),
    }


# ===== Report builder =====

def build_html_report(ig_posts, ig_account, fb_pages_data, reel_summary, content_quality=None, decision_support=None, business_audit=None):
    week_str = datetime.now().strftime("%d/%m/%Y")

    ig_media_available = "instagram_media" not in DATA_FETCH_FAILURES
    ig_account_available = "instagram_account" not in DATA_FETCH_FAILURES
    ig_total_likes = sum(p.get("like_count", 0) for p in ig_posts) if ig_media_available else None
    ig_total_comments = sum(p.get("comments_count", 0) for p in ig_posts) if ig_media_available else None
    ig_best = max(ig_posts, key=lambda p: p.get("like_count", 0), default=None) if ig_media_available else None
    ig_followers = ig_account.get("followers_count") if ig_account_available else None
    ig_reached_posts = [p for p in ig_posts if p.get("insights", {}).get("reach") is not None]
    ig_reach = sum(p["insights"].get("reach", 0) or 0 for p in ig_reached_posts) if ig_reached_posts else None
    save_metric_posts = [p for p in ig_reached_posts if "saved" in p["insights"]]
    share_metric_posts = [p for p in ig_reached_posts if "shares" in p["insights"]]
    ig_saves = sum(p["insights"].get("saved", 0) or 0 for p in save_metric_posts) if save_metric_posts else None
    ig_shares = sum(p["insights"].get("shares", 0) or 0 for p in share_metric_posts) if share_metric_posts else None
    full_engagement_posts = [p for p in ig_reached_posts if "saved" in p["insights"] and "shares" in p["insights"]]
    full_engagement_reach = sum(p["insights"].get("reach", 0) or 0 for p in full_engagement_posts)
    ig_reach_rate = (
        sum((p.get("like_count", 0) or 0) + (p.get("comments_count", 0) or 0)
            + (p["insights"].get("saved", 0) or 0) + (p["insights"].get("shares", 0) or 0)
            for p in full_engagement_posts) / full_engagement_reach
    ) if full_engagement_reach and len(full_engagement_posts) == len(ig_posts) else None

    def display_metric(value):
        return "—" if value is None else value

    def post_rows_ig(posts):
        if not ig_media_available:
            return "<tr><td colspan='4' style='padding:12px;color:#f2c879;text-align:center'>נתוני Instagram לא זמינים</td></tr>"
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
        page_id = page.get("page_id", "")
        page_available = f"facebook_page:{page_id}" not in DATA_FETCH_FAILURES
        posts_available = f"facebook_posts:{page_id}" not in DATA_FETCH_FAILURES
        fans  = page.get("fans", 0) if page_available else None
        posts = page.get("posts_this_week", 0) if posts_available else None
        likes = page.get("total_likes", 0) if posts_available else None
        comms = page.get("total_comments", 0) if posts_available else None
        best  = page.get("best_post", {})
        best_text = ""
        if best.get("message"):
            best_text = f"<p>⭐ <strong>הפוסט הטוב ביותר:</strong> {best['message'][:80]}… ({best.get('likes',0)} לייקים)</p>"
        return f"""
  <h2 style="color:#1877f2;margin-top:32px">📘 {name}</h2>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
    {''.join(f'<div style="background:#1a1a1a;padding:14px 20px;border-radius:8px;text-align:center;min-width:80px"><div style="font-size:24px;font-weight:bold;color:#c8a96e">{display_metric(v)}</div><div style="color:#888;font-size:12px">{lbl}</div></div>' for v,lbl in [(fans,'עוקבים'),(posts,'פוסטים'),(likes,'לייקים'),(comms,'תגובות')])}
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
                <td style="padding:6px 12px;border-bottom:1px solid #333;text-align:center">▶️ {display_metric(r['plays'])}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #333;text-align:center">🔁 {display_metric(r['shares'])}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #333;text-align:center">🔖 {display_metric(r['saved'])}</td>
            </tr>"""
        return rows or "<tr><td colspan='5' style='padding:12px;color:#666;text-align:center'>אין Reels השבוע</td></tr>"

    reels_section = ""
    if reel_summary.get("reels_this_week"):
        reels_section = f"""
  <h2 style="color:#f77737;margin-top:32px">🎬 Reels</h2>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
    {''.join(f'<div style="background:#1a1a1a;padding:14px 20px;border-radius:8px;text-align:center;min-width:80px"><div style="font-size:24px;font-weight:bold;color:#c8a96e">{display_metric(v)}</div><div style="color:#888;font-size:12px">{lbl}</div></div>' for v,lbl in [(reel_summary['reels_this_week'],'Reels'),(reel_summary['total_plays'],'צפיות'),(reel_summary['avg_watch_time'],'שנ׳ צפייה ממוצע'),(reel_summary['total_shares'],'שיתופים'),(reel_summary['total_saved'],'שמירות')])}
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

    data_warning = ""
    if DATA_FETCH_FAILURES:
        sources = ", ".join(DATA_FETCH_FAILURES)
        data_warning = (
            "<p style='padding:12px;border:1px solid #8b5e20;color:#f2c879;border-radius:8px'>"
            f"הדוח חלקי. מקורות נתונים לא זמינים: {sources}. אין להסיק מכך שנתוני המעורבות הם אפס."
            "</p>"
        )

    quality = (content_quality or {}).get("instagram", {})
    quality_section = ""
    if quality.get("posts_checked"):
        quality_section = f"""
  <h2 style="color:#c8a96e;margin-top:32px">✍️ איכות התוכן</h2>
  <p style="color:#aaa;line-height:1.7">
    נבדקו {quality.get('posts_checked', 0)} כיתובים באינסטגרם:
    {quality.get('missing_or_hashtag_only', 0)} ריקים או מבוססי hashtags בלבד,
    {quality.get('duplicate_hashtag_posts', 0)} עם hashtags כפולים,
    וממוצע של {quality.get('avg_caption_chars', 0)} תווים לכיתוב קריא.
  </p>"""

    decisions = (decision_support or {}).get("decisions", [])
    decision_section = ""
    if decisions:
        primary = decisions[0]
        confidence_labels = {"low": "נמוכה", "medium": "בינונית", "high": "גבוהה"}
        decision_section = f"""
  <div style="margin:28px 0;padding:18px;border:1px solid #c8a96e;border-radius:8px;background:#111">
    <div style="color:#c8a96e;font-size:12px">החלטה לשבוע הבא · רמת ביטחון {confidence_labels.get(primary.get('confidence'), 'נמוכה')}</div>
    <h2 style="margin:8px 0;color:#f0ede8">{primary.get('title', '')}</h2>
    <p style="line-height:1.6"><strong>פעולה:</strong> {primary.get('action', '')}</p>
    <p style="line-height:1.6;color:#aaa"><strong>הראיה:</strong> {primary.get('evidence', '')}</p>
    <p style="line-height:1.6;color:#aaa"><strong>איך נדע:</strong> {primary.get('measure', '')}</p>
  </div>"""

    ga_audit = (business_audit or {}).get("ga", {})
    duplicate_count = len((business_audit or {}).get("facebook_duplicate_candidates", []))
    audit_section = ""
    if business_audit:
        checkout_label = {
            "disabled": "התשלומים כבויים בכוונה; אפס אירועי checkout אינו תקלה בפני עצמו",
            "enabled": "התשלומים פעילים; יש לאמת את המשפך",
            "unknown": "סטטוס התשלומים לא אומת; אין להסיק מסקנות מאפס אירועי checkout",
        }.get(ga_audit.get("checkout_state"), "מצב תשלומים לא ידוע")
        duplicate_label = (
            f"{duplicate_count} זוגות/קבוצות של פרסומי Facebook עם כיתוב זהה באותו יום — לבדיקה ידנית"
            if duplicate_count else "לא זוהתה כפילות מדויקת במדגם הפוסטים שה-API החזיר"
        )
        audit_section = f"""
  <div style="margin:18px 0;padding:16px;border:1px solid #555;border-radius:8px;background:#171717">
    <h2 style="margin:0 0 8px;color:#c8a96e">בקרת פרסום ומדדים עסקיים (קריאה בלבד)</h2>
    <p>{duplicate_label}</p>
    <p>לידים/פניות/עניין ברישוי ב-3 דוחות GA אחרונים:
       {ga_audit.get('qualified_action_events', 'לא זמין')} אירועים,
       מתוך {ga_audit.get('sessions', 'לא זמין')} סשנים.
       אין בכך אישור לשיוך המרות לפוסט מסוים.</p>
    <p>{checkout_label}</p>
    <p style="color:#bbb">עד לאימות מקור הפרסומים ונתוני ההמרות,
       אין המלצה להגדיל נפח או לשנות את יעדי ההפצה אוטומטית.</p>
  </div>"""

    return f"""<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><title>דוח שבועי — עמית ארז</title></head>
<body style="background:#0a0a0a;color:#f0ede8;font-family:Arial,sans-serif;padding:32px;max-width:640px;margin:0 auto">
  <h1 style="color:#c8a96e;border-bottom:1px solid #333;padding-bottom:12px">📊 דוח סושיאל מדיה שבועי</h1>
  <p style="color:#888">שבוע שהסתיים ב-{week_str}</p>
  {data_warning}
  {decision_section}
  {audit_section}

  <h2 style="color:#e1306c;margin-top:32px">📸 Instagram</h2>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
    {''.join(f'<div style="background:#1a1a1a;padding:14px 20px;border-radius:8px;text-align:center;min-width:80px"><div style="font-size:24px;font-weight:bold;color:#c8a96e">{display_metric(v)}</div><div style="color:#888;font-size:12px">{lbl}</div></div>' for v,lbl in [(ig_followers,'עוקבים'),(len(ig_posts) if ig_media_available else None,'פוסטים'),(ig_reach,'חשיפות בכל הפוסטים'),(ig_total_likes,'לייקים'),(ig_total_comments,'תגובות'),(ig_saves,'שמירות'),(ig_shares,'שיתופים'),(round(ig_reach_rate*100,2) if ig_reach_rate is not None else None,'מעורבות לפי חשיפה %')])}
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

  {quality_section}

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


def generate_ai_recommendations(ig_posts, ig_account, fb_pages_data, reel_summary, content_quality=None):
    """יוצר המלצות AI מבוססות על ביצועי השבוע."""
    if DATA_FETCH_FAILURES:
        print("ℹ️  המלצות AI הושהו בגלל נתוני API חסרים")
        return ["המלצות אוטומטיות הושהו השבוע: אחד ממקורות נתוני הרשתות לא היה זמין. יש לבדוק את סטטוס איסוף הנתונים לפני הסקת מסקנות."]
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
    quality_summary = json.dumps(content_quality or {}, ensure_ascii=False)

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=800,
            messages=[{"role": "user", "content": f"""{summary}

Caption quality diagnostics: {quality_summary}

Based on this data, provide exactly 4 actionable recommendations in Hebrew for next week.
Each recommendation should be specific, practical, and based on the actual numbers above.
At least one recommendation must address Instagram Reels/video performance specifically (watch time, plays, shares/saves vs. static posts) when reel data is present above.
When caption diagnostics show missing text or duplicate hashtags, address that directly. Do not infer content performance from volume alone.
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
    if report.get("data_quality", {}).get("status") != "complete":
        print("ℹ️  היסטוריה לא עודכנה: הדוח מכיל מקורות נתונים חסרים")
        return
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
        "ig_follower_engagement": ig.get("follower_engagement_rate"),
        "ig_reach":       ig.get("total_reach"),
        "ig_reach_engagement": ig.get("engagement_rate_by_reach"),
        "ig_saved":       ig.get("total_saved"),
        "ig_shares":      ig.get("total_shares"),
        "fb_fans":        first_fb.get("fans"),
        "fb_posts":       first_fb.get("posts_this_week"),
        "fb_likes":       first_fb.get("total_likes"),
        "reels_count":    reels.get("reels_this_week"),
        "reels_plays":    reels.get("total_plays"),
        "reels_avg_watch_time": reels.get("avg_watch_time"),
        "reels_shares":   reels.get("total_shares"),
        "reels_saved":    reels.get("total_saved"),
        "primary_decision_id": report.get("decision_support", {}).get("primary_decision_id"),
        "optimization_experiment": report.get("optimization_policy", {}).get("active", {}).get("decision_id"),
    }
    history.append(row)
    # שמור עם הישן קודם (סדר כרונולוגי)
    history_file.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"📈 היסטוריה: נוסף שבוע {week_key} ({len(history)} שבועות סה\"כ)")


def save_social_report(ig_posts, ig_account, fb_pages_data, recommendations, reel_summary, content_quality=None):
    """שומר דוח JSON לשימוש האדמין."""
    post_lookup = build_post_lookup()
    out = ROOT / "data" / "social_report.json"

    # שמור נתוני שבוע קודם להשוואה
    prev = {}
    if out.exists():
        try:
            old = json.loads(out.read_text(encoding="utf-8"))
            prev = {} if old.get("data_quality", {}).get("status") == "partial" else {
                "ig_followers":      old.get("ig", {}).get("followers"),
                "ig_posts_this_week": old.get("ig", {}).get("posts_this_week"),
                "ig_total_likes":    old.get("ig", {}).get("total_likes"),
                "fb_fans":           old.get("fb", {}).get("fans"),
                "fb_posts_this_week": old.get("fb", {}).get("posts_this_week"),
                "fb_total_likes":    old.get("fb", {}).get("total_likes"),
            }
        except Exception:
            pass

    ig_media_available = "instagram_media" not in DATA_FETCH_FAILURES
    ig_account_available = "instagram_account" not in DATA_FETCH_FAILURES
    ig_best = max(ig_posts, key=lambda p: p.get("like_count", 0), default=None) if ig_media_available else None
    ig_total_likes    = sum(p.get("like_count", 0) for p in ig_posts) if ig_media_available else None
    ig_total_comments = sum(p.get("comments_count", 0) for p in ig_posts) if ig_media_available else None
    ig_followers      = ig_account.get("followers_count", 0) if ig_account_available else None
    ig_n              = len(ig_posts) if ig_media_available else None
    ig_sorted = sorted(ig_posts, key=lambda p: p.get("like_count", 0), reverse=True)[:5] if ig_media_available else []
    insight_posts = [p for p in ig_posts if p.get("insights", {}).get("reach") is not None]
    ig_total_reach = sum(p["insights"].get("reach", 0) or 0 for p in insight_posts) if insight_posts else None
    saved_posts = [p for p in insight_posts if "saved" in p.get("insights", {})]
    shared_posts = [p for p in insight_posts if "shares" in p.get("insights", {})]
    ig_total_saved = sum(p["insights"].get("saved", 0) or 0 for p in saved_posts) if saved_posts else None
    ig_total_shares = sum(p["insights"].get("shares", 0) or 0 for p in shared_posts) if shared_posts else None
    full_engagement_posts = [p for p in insight_posts if "saved" in p["insights"] and "shares" in p["insights"]]
    full_engagement_reach = sum(p["insights"].get("reach", 0) or 0 for p in full_engagement_posts)
    reach_interactions = sum(
        (p.get("like_count", 0) or 0) + (p.get("comments_count", 0) or 0)
        + (p["insights"].get("saved", 0) or 0) + (p["insights"].get("shares", 0) or 0)
        for p in full_engagement_posts
    ) if full_engagement_posts else None

    # fb backward-compat: aggregate or use first page
    first_fb = fb_pages_data[0] if fb_pages_data else {}

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "week_ending":  datetime.now().strftime("%d/%m/%Y"),
        "data_quality": {
            "status": "partial" if DATA_FETCH_FAILURES else "complete",
            "failed_sources": DATA_FETCH_FAILURES,
            "media_insights": {
                "posts_available": len(insight_posts),
                "posts_requested": len(ig_posts),
                "coverage": round(len(insight_posts) / len(ig_posts), 2) if ig_posts else None,
                "saved_posts_available": len(saved_posts),
                "shared_posts_available": len(shared_posts),
                "unavailable_post_ids": MEDIA_INSIGHT_WARNINGS,
            },
        },
        "ig": {
            "followers":          ig_followers,
            "media_count":        ig_account.get("media_count", 0) if ig_account_available else None,
            "posts_this_week":    ig_n,
            "total_likes":        ig_total_likes,
            "total_comments":     ig_total_comments,
            "avg_likes_per_post": round(ig_total_likes / ig_n, 1) if ig_media_available and ig_n else (0 if ig_media_available else None),
            "total_reach":        ig_total_reach,
            "total_saved":        ig_total_saved,
            "total_shares":       ig_total_shares,
            "engagement_rate_by_reach": round(reach_interactions / full_engagement_reach, 4) if full_engagement_reach and len(full_engagement_posts) == len(ig_posts) else None,
            "follower_engagement_rate": round((ig_total_likes + ig_total_comments) / (ig_n * max(ig_followers, 1)), 4) if ig_media_available and ig_account_available and ig_n else (0 if ig_media_available and ig_account_available else None),
            "engagement_rate":    round((ig_total_likes + ig_total_comments) / (ig_n * max(ig_followers, 1)), 4) if ig_media_available and ig_account_available and ig_n else (0 if ig_media_available and ig_account_available else None),
            "editorial_performance": build_editorial_performance(
                ig_posts, "instagram", "like_count", "comments_count",
            ) if ig_media_available else {},
            "top_posts": [
                {
                    "post_id":  p.get("id", ""),
                    "photo_id": post_lookup.get(("instagram", str(p.get("id", ""))), ""),
                    "caption":  (p.get("caption") or "")[:100].replace("\n", " "),
                    "likes":    p.get("like_count", 0),
                    "comments": p.get("comments_count", 0),
                    "reach":    p.get("insights", {}).get("reach"),
                    "saved":    p.get("insights", {}).get("saved"),
                    "shares":   p.get("insights", {}).get("shares"),
                    "date":     (p.get("timestamp") or "")[:10],
                }
                for p in ig_sorted
            ],
            "photo_performance": [
                {
                    "post_id": p.get("id", ""),
                    "photo_id": post_lookup.get(("instagram", str(p.get("id", ""))), ""),
                    "likes": p.get("like_count", 0),
                    "comments": p.get("comments_count", 0),
                    "date": (p.get("timestamp") or "")[:10],
                }
                for p in ig_posts if ig_media_available
                if post_lookup.get(("instagram", str(p.get("id", ""))), "")
            ],
            "best_post": {
                "post_id": ig_best.get("id", "") if ig_best else "",
                "photo_id": post_lookup.get(("instagram", str(ig_best.get("id", ""))), "") if ig_best else "",
                "caption": (ig_best.get("caption") or "")[:120] if ig_best else "",
                "likes":   ig_best.get("like_count", 0) if ig_best else None,
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
        "content_quality": content_quality or {},
        "prev":           prev,
        "recommendations": recommendations,
    }

    history = load_json(ROOT / "data" / "social_history.json", [])
    ga_reports = load_json(ROOT / "data" / "ga_reports.json", [])
    ga_report = latest_ga_snapshot(ga_reports)
    report["business_audit"] = build_social_business_audit(report, ga_reports)
    report["decision_support"] = build_decision_support(report, history, ga_report)
    policy = build_optimization_policy(report, report["decision_support"], load_policy())
    report["optimization_policy"] = policy
    save_policy(policy)

    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"💾 דוח נשמר ל-{out}")

    # צבור היסטוריה שבועית
    _append_to_history(report)
    return report


def main():
    DATA_FETCH_FAILURES.clear()
    MEDIA_INSIGHT_WARNINGS.clear()
    if not RESEND_KEY:
        print("❌ חסר RESEND_API_KEY")
        sys.exit(1)

    print("📊 אוסף נתוני Instagram...")
    ig_posts   = fetch_ig_insights()
    ig_account = fetch_ig_account_insights()

    print("📐 אוסף reach, שמירות ושיתופים לכל פוסט...")
    enrich_ig_posts(ig_posts)

    print("🎬 אוסף נתוני Reels...")
    reel_summary = build_reel_summary(ig_posts)
    print(f"   {reel_summary['reels_this_week']} reels, {reel_summary['total_plays']} צפיות סה\"כ")

    print("📘 אוסף נתוני Facebook...")
    pages = get_fb_pages()
    if not pages:
        print("⚠️  לא הוגדרו עמודי פייסבוק (FACEBOOK_PAGE_IDS / FACEBOOK_PAGE_ID חסרים)")
    fb_pages_data = [build_fb_page_block(label, pid) for label, pid in pages]
    content_quality = build_content_quality_summary(ig_posts, fb_pages_data)

    print("🤖 מייצר המלצות AI...")
    recommendations = generate_ai_recommendations(
        ig_posts, ig_account, fb_pages_data, reel_summary, content_quality,
    )
    for i, r in enumerate(recommendations, 1):
        print(f"   {i}. {r}")

    print("💾 שומר דוח JSON...")
    report = save_social_report(
        ig_posts, ig_account, fb_pages_data, recommendations, reel_summary, content_quality,
    )

    print("✉️  בונה דוח...")
    html = build_html_report(
        ig_posts, ig_account, fb_pages_data, reel_summary, content_quality,
        report.get("decision_support"),
        report.get("business_audit"),
    )

    week_str = datetime.now().strftime("%d/%m/%Y")
    subject  = f"📊 דוח שבועי סושיאל — {week_str}"

    print("📤 שולח מייל...")
    result = send_email(subject, html)
    print(f"✅ דוח נשלח! ID: {result.get('id', '')}")


if __name__ == "__main__":
    main()
