"""Deterministic, evidence-based decisions for the weekly social report."""

from __future__ import annotations

import json
from pathlib import Path
from statistics import median


def _number(value, default=0):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else default


def _confidence(post_count):
    if post_count >= 30:
        return "high"
    if post_count >= 15:
        return "medium"
    return "low"


def load_json(path, default):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
        return value
    except (OSError, ValueError, TypeError):
        return default


def latest_ga_snapshot(ga_reports):
    reports = ga_reports if isinstance(ga_reports, list) else ga_reports.get("reports", []) if isinstance(ga_reports, dict) else []
    return reports[-1] if reports else {}


def build_baseline(history, weeks=8):
    """Use the account's own recent complete weeks as its baseline."""
    valid = [
        row for row in history
        if isinstance(row, dict) and _number(row.get("ig_posts")) > 0
        and row.get("ig_avg_likes") is not None
    ][-weeks:]
    post_count = sum(_number(row.get("ig_posts")) for row in valid)
    if not valid:
        return {"weeks": 0, "posts": 0, "confidence": "low"}
    return {
        "weeks": len(valid),
        "posts": post_count,
        "confidence": _confidence(post_count),
        "median_posts_per_week": round(median(_number(row.get("ig_posts")) for row in valid), 1),
        "median_likes_per_post": round(median(_number(row.get("ig_avg_likes")) for row in valid), 1),
        "median_follower_engagement_rate": round(median(_number(row.get("ig_engagement")) for row in valid), 4),
    }


def _decision(decision_id, tier, title, action, evidence, measure, confidence):
    return {
        "id": decision_id,
        "tier": tier,
        "title": title,
        "action": action,
        "evidence": evidence,
        "measure": measure,
        "confidence": confidence,
    }


def build_decision_support(report, history, ga_report=None):
    """Return prioritized decisions with explicit evidence and success criteria."""
    ig = report.get("ig", {})
    reels = report.get("reels", {})
    quality = report.get("content_quality", {}).get("instagram", {})
    baseline = build_baseline(history)
    current_posts = _number(ig.get("posts_this_week"))
    tracked_posts = baseline.get("posts", 0) + current_posts
    confidence = _confidence(tracked_posts)
    metrics_coverage = report.get("data_quality", {}).get("media_insights", {}).get("coverage")
    if metrics_coverage is not None and metrics_coverage < 0.8:
        confidence = "low"
    decisions = []

    if report.get("data_quality", {}).get("status") == "partial":
        decisions.append(_decision(
            "restore-data-collection", "quick_win", "להחזיר את איסוף הנתונים לפעולה",
            "לטפל במקורות ה-API שנכשלו לפני שינוי בתדירות או בסוג התוכן.",
            "הדוח חלקי ולכן ערך אפס יכול להיות נתון חסר.",
            "הצלחה: הדוח הבא מסומן complete וכל מקורות הנתונים נטענים.", "high",
        ))

    missing = _number(quality.get("missing_or_hashtag_only"))
    checked = _number(quality.get("posts_checked"))
    if missing:
        decisions.append(_decision(
            "fix-caption-hygiene", "quick_win", "לתקן כיתובים חסרים לפני הפרסום הבא",
            "להוסיף לכל פוסט פתיח קצר, הקשר לתמונה והזמנה אחת לפעולה.",
            f"{missing} מתוך {checked} כיתובים שנבדקו היו ריקים או hashtags בלבד.",
            "הצלחה בשבוע הבא: 0 כיתובים ריקים או מבוססי hashtags בלבד.", "high",
        ))

    ga = ga_report or {}
    review = ga.get("business_review", {})
    direct_share = _number(review.get("kpis", {}).get("direct_share_pct"), None)
    sessions = _number(review.get("sample", {}).get("sessions"))
    if direct_share is not None and direct_share >= 70 and sessions >= 30:
        decisions.append(_decision(
            "improve-social-attribution", "quick_win", "למדוד אילו פוסטים מביאים ביקורים לאתר",
            "להשתמש בכל שיתוף בקישור עמוק לדף הרלוונטי עם UTM שכולל פלטפורמה, סוג תוכן ומזהה פוסט.",
            f"{direct_share:.1f}% מתוך {sessions} ביקורים נרשמו כתנועה ישירה, ולכן קשה לשייך תוצאות לפוסט מסוים.",
            "הצלחה בתוך שבועיים: לפחות ביקור אחד מקמפיין UTM לכל פוסט עם קישור, וירידה בחלקה של תנועה ישירה.",
            "medium" if sessions < 100 else "high",
        ))

    current_avg = _number(ig.get("avg_likes_per_post"), None)
    baseline_avg = baseline.get("median_likes_per_post")
    baseline_volume = baseline.get("median_posts_per_week")
    if current_avg is not None and baseline_avg and baseline.get("weeks", 0) >= 6:
        change = (current_avg - baseline_avg) / baseline_avg
        if change <= -0.25 and current_posts >= baseline_volume:
            decisions.append(_decision(
                "test-lower-volume", "experiment", "לבדוק אם פחות פרסומים משפרים ביצוע לפוסט",
                f"במשך שבועיים לפרסם {max(1, round(baseline_volume))} פוסטים בשבוע ולשמור על איכות הכיתוב והנושא.",
                f"השבוע הממוצע היה {current_avg:.1f} לייקים לפוסט, {abs(change) * 100:.0f}% מתחת לחציון האישי {baseline_avg:.1f}, עם {current_posts} פוסטים.",
                f"הצלחה: ממוצע של לפחות {baseline_avg:.1f} לייקים לפוסט בלי ירידה בביקורי UTM. כישלון: פחות מ-{current_avg:.1f}.",
                confidence,
            ))

    reel_count = _number(reels.get("reels_this_week"))
    reel_coverage = reels.get("metric_coverage", {})
    action_metrics_available = (
        reel_count > 0
        and reel_coverage.get("shares", 0) >= reel_count * 0.8
        and reel_coverage.get("saved", 0) >= reel_count * 0.8
    )
    shares_saves = _number(reels.get("total_shares")) + _number(reels.get("total_saved"))
    if reel_count >= 3 and action_metrics_available and shares_saves == 0:
        decisions.append(_decision(
            "reel-save-share-test", "experiment", "לבדוק קריאה ממוקדת לשמירה או לשיתוף ב-Reels",
            "בשלושת ה-Reels הבאים להוסיף בסוף קריאה אחת שמתאימה לתוכן: לשמור למסלול עתידי או לשתף עם חובב צילום.",
            f"פורסמו {reel_count} Reels השבוע ולא נמדדו בהם שמירות או שיתופים.",
            "הצלחה: לפחות 3 שמירות ושיתופים יחד בשלושת ה-Reels. כישלון: 0; במקרה כזה מחליפים את הפתיח או הנושא.",
            "low" if reel_count < 15 else "medium",
        ))

    angles = ig.get("editorial_performance", {})
    ready_angles = {name: row for name, row in angles.items() if _number(row.get("posts")) >= 3}
    angle_posts = sum(_number(row.get("posts")) for row in angles.values())
    if not ready_angles:
        decisions.append(_decision(
            "collect-editorial-angle-sample", "strategic", "לבנות מדגם להשוואת סוגי התוכן",
            "לסמן מראש כל פוסט כ'סיפור', 'טכניקה', 'שיחה' או 'מדריך', ולהגיע לפחות ל-3 פוסטים בכל סוג לפני בחירת מנצח.",
            f"יש כרגע {angle_posts} פוסטים מסומנים, ואין עדיין סוג תוכן עם 3 פוסטים להשוואה.",
            "הצלחה: לפחות 3 פוסטים בשני סוגי תוכן, ואז משווים מעורבות לפי חשיפה וביקורי UTM.", "low",
        ))

    decisions = decisions[:4]
    if not decisions:
        decisions.append(_decision(
            "keep-measurement-stable", "strategic", "לשמור על המדידה יציבה עוד שבוע",
            "להמשיך באותה מתכונת פרסום ולאסוף reach, שמירות, שיתופים וביקורי UTM לפני שינוי נוסף.",
            f"המדגם המצטבר כולל {tracked_posts} פוסטים ולא נמצא שינוי גדול מול הבסיס האישי.",
            "לבחון מחדש בדוח הבא; שינוי יבוצע רק אם מדד אחד יזוז ב-25% לפחות או יתקבלו 15 פוסטים.", confidence,
        ))

    primary = decisions[0]
    return {
        "method": "own_baseline_v1",
        "sample": {
            "current_posts": current_posts,
            "tracked_posts": tracked_posts,
            "history_weeks": baseline.get("weeks", 0),
            "confidence": confidence,
            "metrics_coverage": metrics_coverage,
            "note": (
                f"מדדי פוסט זמינים ל-{metrics_coverage * 100:.0f}% מהפרסומים; הביטחון מוגבל."
                if metrics_coverage is not None and metrics_coverage < 0.8 else
                "מסקנות מתחת ל-15 פוסטים הן כיווניות בלבד." if tracked_posts < 15 else
                "הביטחון מבוסס על המדגם המצטבר בחשבון."
            ),
        },
        "baseline": baseline,
        "primary_decision_id": primary["id"],
        "decisions": decisions,
    }
