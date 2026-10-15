"""Turn weekly findings into one controlled instruction for content generators."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).parent.parent
POLICY_FILE = ROOT / "data" / "social_optimization_policy.json"

AUTOMATIONS = {
    "fix-caption-hygiene": {
        "applies_to": ["instagram:post", "facebook:post", "threads:post"],
        "instruction_he": "ודא שהטקסט כולל פתיח ספציפי לתמונה, הקשר קצר והזמנה אחת לפעולה; אסור להחזיר טקסט ריק או hashtags בלבד.",
        "max_runs": 2,
    },
    "reel-save-share-test": {
        "applies_to": ["instagram:reel"],
        "instruction_he": "זהו ניסוי מדידה פעיל: סיים בקריאה טבעית אחת בלבד לשמור את הרילס או לשתף אותו עם אדם שהנושא מתאים לו.",
        "max_runs": 2,
    },
    "collect-editorial-angle-sample": {
        "applies_to": ["instagram:post", "facebook:post", "threads:post"],
        "instruction_he": "שמור בקפדנות על זווית התוכן שנבחרה לפוסט כדי שאפשר יהיה להשוות בין סוגי התוכן לאחר הצטברות המדגם.",
        "max_runs": 4,
    },
}


def load_policy(path=POLICY_FILE):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _result(decision_id, report):
    if report.get("data_quality", {}).get("status") == "partial":
        return None, "הדוח חלקי; ההערכה ממתינה לאיסוף נתונים מלא"
    if decision_id == "fix-caption-hygiene":
        quality = report.get("content_quality", {}).get("instagram", {})
        checked = quality.get("posts_checked", 0) or 0
        missing = quality.get("missing_or_hashtag_only", 0) or 0
        if checked < 3:
            return None, f"נדרשים לפחות 3 כיתובים למדידה; נבדקו {checked}"
        return missing == 0, f"נבדקו {checked} כיתובים; חסרים או hashtags בלבד: {missing}"
    if decision_id == "collect-editorial-angle-sample":
        angles = report.get("ig", {}).get("editorial_performance", {})
        ready = sum(1 for row in angles.values() if (row.get("posts", 0) or 0) >= 3)
        tracked = sum(row.get("posts", 0) or 0 for row in angles.values())
        if tracked < 6:
            return None, f"נדרשים לפחות 6 פוסטים עם זווית מתויגת; נמדדו {tracked}"
        return ready >= 2, f"סוגי תוכן עם 3 פוסטים לפחות: {ready}"
    return False, "אין מדד הערכה אוטומטי"


def build_optimization_policy(report, decision_support, previous=None):
    """Select one automation, and evaluate the previous run before continuing it."""
    previous = previous or {}
    previous_active = previous.get("active", {})
    outcomes = list(previous.get("outcomes", []))[-9:]
    previous_id = previous_active.get("decision_id")

    if previous_id in AUTOMATIONS and previous_active.get("status") == "collecting":
        if previous_id == "reel-save-share-test":
            reels = report.get("reels", {})
            current_reels = int(reels.get("reels_this_week", 0) or 0)
            metric_coverage = reels.get("metric_coverage", {})
            if (current_reels == 0 or metric_coverage.get("shares", 0) < current_reels * 0.8
                    or metric_coverage.get("saved", 0) < current_reels * 0.8):
                active = {**previous_active, "last_evidence": "אין כיסוי מדידה מספיק ל-Reels; הניסוי ממתין למדדים תקינים"}
                return _policy_document(report, active, outcomes)
            weekly_actions = (reels.get("total_shares", 0) or 0) + (reels.get("total_saved", 0) or 0)
            cumulative_actions = int(previous_active.get("cumulative_actions", 0)) + weekly_actions
            reels_observed = int(previous_active.get("reels_observed", 0)) + int(reels.get("reels_this_week", 0) or 0)
            runs = int(previous_active.get("runs", 1)) + 1
            evidence = f"ב-{reels_observed} Reels נמדדו {cumulative_actions} שמירות ושיתופים"
            if cumulative_actions >= 3 or reels_observed >= 3:
                outcomes.append({
                    "decision_id": previous_id,
                    "title": previous_active.get("title", previous_id),
                    "status": "successful" if cumulative_actions >= 3 else "failed",
                    "runs": runs,
                    "evidence": evidence,
                    "completed_at": report.get("generated_at"),
                })
                previous_id = None
            else:
                active = {
                    **previous_active,
                    "runs": runs,
                    "cumulative_actions": cumulative_actions,
                    "reels_observed": reels_observed,
                    "last_evidence": evidence,
                }
                return _policy_document(report, active, outcomes)

        if previous_id in AUTOMATIONS:
            succeeded, evidence = _result(previous_id, report)
            runs = int(previous_active.get("runs", 1)) + (1 if succeeded is not None else 0)
            max_runs = AUTOMATIONS[previous_id]["max_runs"]
            if succeeded is True or runs >= max_runs:
                outcomes.append({
                    "decision_id": previous_id,
                    "title": previous_active.get("title", previous_id),
                    "status": "successful" if succeeded is True else "failed",
                    "runs": runs,
                    "evidence": evidence,
                    "completed_at": report.get("generated_at"),
                })
                previous_id = None
            else:
                active = {**previous_active, "runs": runs, "last_evidence": evidence}
                return _policy_document(report, active, outcomes)

    completed_ids = {row.get("decision_id") for row in outcomes[-3:]}
    candidate = next((
        row for row in decision_support.get("decisions", [])
        if row.get("id") in AUTOMATIONS and row.get("id") not in completed_ids
    ), None)
    active = {}
    if candidate:
        automation = AUTOMATIONS[candidate["id"]]
        active = {
            "decision_id": candidate["id"],
            "title": candidate.get("title", ""),
            "status": "collecting",
            "runs": 1,
            "started_at": report.get("generated_at"),
            "instruction_he": automation["instruction_he"],
            "applies_to": automation["applies_to"],
            "success_measure": candidate.get("measure", ""),
        }
    return _policy_document(report, active, outcomes)


def _policy_document(report, active, outcomes):
    return {
        "version": 1,
        "generated_at": report.get("generated_at") or datetime.now(timezone.utc).isoformat(),
        "mode": "one_experiment_at_a_time",
        "active": active,
        "outcomes": outcomes,
    }


def save_policy(policy, path=POLICY_FILE):
    Path(path).write_text(json.dumps(policy, ensure_ascii=False, indent=2), encoding="utf-8")


def guidance_for_prompt(platform, content_type="post", path=POLICY_FILE):
    active = load_policy(path).get("active", {})
    if active.get("status") != "collecting":
        return ""
    if f"{platform}:{content_type}" not in active.get("applies_to", []):
        return ""
    return "\n\nהנחיית שיפור אוטומטית מהדוח השבועי:\n" + active.get("instruction_he", "")
