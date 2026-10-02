#!/usr/bin/env python3
"""
GA4 Weekly Analysis
שולח ניתוח שבועי של Google Analytics עם המלצות מ-Claude.
"""

import os, sys, json
from datetime import date, timedelta
import requests
import anthropic

# ===== הגדרות =====
GA4_PROPERTY_ID  = os.environ.get("GA4_PROPERTY_ID", "")
GA_REFRESH_TOKEN = os.environ.get("GA_REFRESH_TOKEN", "")
GA_CLIENT_ID     = os.environ.get("GA_CLIENT_ID", "")
GA_CLIENT_SECRET = os.environ.get("GA_CLIENT_SECRET", "")
RESEND_KEY       = os.environ.get("RESEND_API_KEY", "")
ANTHROPIC_KEY    = os.environ.get("ANTHROPIC_API_KEY", "").strip()
REPORT_EMAIL     = os.environ.get("REPORT_EMAIL", "erez.family@gmail.com")
FROM_EMAIL       = os.environ.get("FROM_EMAIL", "Amit Photos <contact@amitphotos.com>")
WORKER_URL       = os.environ.get("WORKER_URL", "https://amitphotos.com")
ADMIN_PASSWORD   = os.environ.get("ADMIN_PASSWORD", "")

GA4_API_BASE = "https://analyticsdata.googleapis.com/v1beta"

ACQUISITION_EXPERIMENT_CAMPAIGNS = {
    "202610_freeguide_photo_tips": {
        "label": "Free Guide", "primary_event": "guide_request_success", "secondary_event": "generate_lead"
    },
    "202610_licensing_personal": {
        "label": "Personal Licensing", "primary_event": "licensing_personal_interest", "secondary_event": "purchase_intent"
    },
    "202610_b2b_outreach": {
        "label": "B2B Wall Art", "primary_event": "b2b_contact_start", "secondary_event": "contact_form_success"
    },
}

HEBREW_CHANNELS = {
    "Organic Search": "חיפוש אורגני",
    "Direct":         "כניסה ישירה",
    "Social":         "רשתות חברתיות",
    "Referral":       "הפניות",
    "Email":          "מייל",
    "Paid Search":    "פרסום ממומן",
    "Organic Social": "סושיאל אורגני",
    "Unassigned":     "לא מוגדר",
}


def get_access_token():
    """מחדש access token מ-refresh token."""
    resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id":     GA_CLIENT_ID,
            "client_secret": GA_CLIENT_SECRET,
            "refresh_token": GA_REFRESH_TOKEN,
            "grant_type":    "refresh_token",
        },
        timeout=15,
    )
    if not resp.ok:
        print(f"❌ OAuth error {resp.status_code}: {resp.text[:200]}")
        sys.exit(1)
    token = resp.json().get("access_token")
    if not token:
        print(f"❌ לא התקבל access_token: {resp.json()}")
        sys.exit(1)
    return token


def run_report(token, body):
    url  = f"{GA4_API_BASE}/properties/{GA4_PROPERTY_ID}:runReport"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=body,
        timeout=30,
    )
    if not resp.ok:
        print(f"⚠️  GA4 API error {resp.status_code}: {resp.text[:300]}")
        return None
    return resp.json()


def parse_rows(data, metric_keys, dim_key=None):
    if not data or "rows" not in data:
        return []
    rows = []
    for row in data["rows"]:
        dims    = [d["value"] for d in row.get("dimensionValues", [])]
        metrics = [m["value"] for m in row.get("metricValues", [])]
        entry   = {}
        if dim_key and dims:
            entry[dim_key] = dims[0]
        for i, k in enumerate(metric_keys):
            entry[k] = metrics[i] if i < len(metrics) else "0"
        rows.append(entry)
    return rows


def format_duration(seconds):
    """Human-readable GA duration; input is seconds, never minutes."""
    try:
        total = max(0, int(round(float(seconds))))
    except (TypeError, ValueError):
        return "0 שניות"
    minutes, secs = divmod(total, 60)
    if minutes:
        return f"{minutes}:{secs:02d} דקות"
    return f"{secs} שניות"


def fetch_ga4_data(token):
    today  = date.today()
    start  = (today - timedelta(days=7)).strftime("%Y-%m-%d")
    end    = today.strftime("%Y-%m-%d")
    dr     = [{"startDate": start, "endDate": end}]

    summary_raw = run_report(token, {
        "dateRanges": dr,
        "metrics": [
            {"name": "sessions"}, {"name": "activeUsers"},
            {"name": "screenPageViews"}, {"name": "bounceRate"},
            {"name": "averageSessionDuration"}, {"name": "newUsers"},
            {"name": "engagementRate"}, {"name": "engagedSessions"},
        ],
    })
    pages_raw = run_report(token, {
        "dateRanges": dr,
        "dimensions": [{"name": "pagePath"}],
        "metrics": [{"name": "screenPageViews"}, {"name": "sessions"}],
        "orderBys": [{"metric": {"metricName": "screenPageViews"}, "desc": True}],
        "limit": 10,
    })
    sources_raw = run_report(token, {
        "dateRanges": dr,
        "dimensions": [{"name": "sessionDefaultChannelGrouping"}],
        "metrics": [{"name": "sessions"}],
        "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
        "limit": 8,
    })
    campaigns_raw = run_report(token, {
        "dateRanges": dr,
        "dimensions": [
            {"name": "sessionSource"},
            {"name": "sessionMedium"},
            {"name": "sessionCampaignName"},
        ],
        "metrics": [{"name": "sessions"}, {"name": "activeUsers"}],
        "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
        "limit": 20,
    })
    landing_pages_raw = run_report(token, {
        "dateRanges": dr,
        "dimensions": [{"name": "landingPagePlusQueryString"}],
        "metrics": [{"name": "sessions"}, {"name": "activeUsers"}],
        "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
        "limit": 10,
    })
    devices_raw = run_report(token, {
        "dateRanges": dr,
        "dimensions": [{"name": "deviceCategory"}],
        "metrics": [{"name": "sessions"}],
        "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
    })
    countries_raw = run_report(token, {
        "dateRanges": dr,
        "dimensions": [{"name": "country"}],
        "metrics": [{"name": "sessions"}],
        "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
        "limit": 5,
    })
    prev_start = (today - timedelta(days=14)).strftime("%Y-%m-%d")
    prev_end   = (today - timedelta(days=8)).strftime("%Y-%m-%d")
    prev_raw = run_report(token, {
        "dateRanges": [{"startDate": prev_start, "endDate": prev_end}],
        "metrics": [{"name": "sessions"}, {"name": "activeUsers"}, {"name": "screenPageViews"}],
    })
    ux_event_names = [
        "purchase_intent", "photo_view", "add_size", "purchase", "generate_lead", "guide_request_success",
        "print_intent", "print_type_selected", "print_checkout",
        "hero_gallery_click", "hero_sale_click", "hero_guide_click", "nav_click",
        "gallery_filter", "scroll_25", "scroll_50", "scroll_75", "scroll_90",
        "contact_intent", "photo_contact_click", "contact_form_success", "language_change", "content_link_click",
        "licensing_personal_interest", "licensing_commercial_contact",
        "b2b_intent", "b2b_package_select", "b2b_contact_start",
        "nav_home_click", "nav_gallery_click", "nav_sale_click", "nav_camera_click",
        "nav_locations_click", "nav_purchase_info_click", "nav_newsletter_click",
        "nav_contact_click", "nav_more_click", "nav_games_click", "nav_videos_click",
        "nav_learn_click", "nav_gear_click",
    ]
    events_raw = run_report(token, {
        "dateRanges": dr,
        "dimensions": [{"name": "eventName"}],
        "metrics": [{"name": "eventCount"}],
        "dimensionFilter": {
            "filter": {
                "fieldName": "eventName",
                "inListFilter": {"values": ux_event_names},
            }
        },
        "orderBys": [{"metric": {"metricName": "eventCount"}, "desc": True}],
    })
    ux_by_page_raw = run_report(token, {
        "dateRanges": dr,
        "dimensions": [{"name": "eventName"}, {"name": "pagePath"}],
        "metrics": [{"name": "eventCount"}],
        "dimensionFilter": {
            "filter": {
                "fieldName": "eventName",
                "inListFilter": {"values": ux_event_names},
            }
        },
        "orderBys": [{"metric": {"metricName": "eventCount"}, "desc": True}],
        "limit": 50,
    })
    experiment_events_raw = run_report(token, {
        "dateRanges": dr,
        "dimensions": [{"name": "eventName"}, {"name": "sessionCampaignName"}],
        "metrics": [{"name": "eventCount"}],
        "dimensionFilter": {
            "andGroup": {
                "expressions": [
                    {"filter": {"fieldName": "eventName", "inListFilter": {"values": ux_event_names}}},
                    {"filter": {"fieldName": "sessionCampaignName", "inListFilter": {"values": list(ACQUISITION_EXPERIMENT_CAMPAIGNS)}}},
                ]
            }
        },
        "orderBys": [{"metric": {"metricName": "eventCount"}, "desc": True}],
        "limit": 100,
    })

    sr = summary_raw.get("rows", []) if summary_raw else []
    pr = prev_raw.get("rows", []) if prev_raw else []
    def s(i): return sr[0]["metricValues"][i]["value"] if sr else "0"
    def p(i): return pr[0]["metricValues"][i]["value"] if pr else "0"

    sources = parse_rows(sources_raw, ["sessions"], "מקור")
    for r in sources:
        r["מקור"] = HEBREW_CHANNELS.get(r["מקור"], r["מקור"])

    campaigns = []
    for row in (campaigns_raw or {}).get("rows", []):
        dims = row.get("dimensionValues", [])
        metrics = row.get("metricValues", [])
        campaigns.append({
            "source": dims[0]["value"] if len(dims) > 0 else "",
            "medium": dims[1]["value"] if len(dims) > 1 else "",
            "campaign": dims[2]["value"] if len(dims) > 2 else "",
            "sessions": metrics[0]["value"] if len(metrics) > 0 else "0",
            "activeUsers": metrics[1]["value"] if len(metrics) > 1 else "0",
        })

    events = parse_rows(events_raw, ["count"], "event")
    events_by_name = {r["event"]: r["count"] for r in events}
    ux_by_page = []
    for row in (ux_by_page_raw or {}).get("rows", []):
        dims = row.get("dimensionValues", [])
        metrics = row.get("metricValues", [])
        ux_by_page.append({
            "event": dims[0]["value"] if len(dims) > 0 else "",
            "עמוד": dims[1]["value"] if len(dims) > 1 else "",
            "count": metrics[0]["value"] if metrics else "0",
        })

    experiment_events = []
    for row in (experiment_events_raw or {}).get("rows", []):
        dims = row.get("dimensionValues", [])
        metrics = row.get("metricValues", [])
        experiment_events.append({
            "event": dims[0]["value"] if len(dims) > 0 else "",
            "campaign": dims[1]["value"] if len(dims) > 1 else "",
            "count": metrics[0]["value"] if metrics else "0",
        })

    return {
        "period": f"{start} → {end}",
        "summary": {
            "sessions": s(0), "activeUsers": s(1), "pageViews": s(2),
            "bounceRate": f"{float(s(3)) * 100:.1f}%",
            "avgSessionSec": f"{float(s(4)):.0f}", "newUsers": s(5),
            "engagementRate": f"{float(s(6)) * 100:.1f}%",
            "engagedSessions": s(7),
        },
        "prev_week": {"sessions": p(0), "activeUsers": p(1), "pageViews": p(2)},
        "top_pages": parse_rows(pages_raw, ["צפיות", "sessions"], "עמוד"),
        "landing_pages": parse_rows(landing_pages_raw, ["sessions", "activeUsers"], "עמוד נחיתה"),
        "sources":   sources,
        "campaigns": campaigns,
        "devices":   parse_rows(devices_raw, ["sessions"], "מכשיר"),
        "countries": parse_rows(countries_raw, ["sessions"], "ארץ"),
        "funnel_events": events_by_name,
        "ux_by_page": ux_by_page,
        "experiment_events": experiment_events,
    }


def fetch_subscriber_summary(days=7):
    """מושך סיכום מצרפי בלבד לפי source — ללא אימיילים/PII."""
    if not ADMIN_PASSWORD:
        print("⚠️ ADMIN_PASSWORD חסר — מדלג על subscriber source summary")
        return None
    try:
        resp = requests.get(
            f"{WORKER_URL}/api/admin/subscriber-summary",
            params={"days": days},
            headers={"X-Admin-Password": ADMIN_PASSWORD},
            timeout=15,
        )
        if resp.ok:
            return resp.json()
        print(f"⚠️ subscriber-summary החזיר {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"⚠️ subscriber-summary נכשל: {e}")
    return None


def fetch_photo_analytics():
    """מושך ביצועי תמונות אמיתיים מ-D1 ל-30 יום, לפי photo_id."""
    if not ADMIN_PASSWORD:
        print("⚠️ ADMIN_PASSWORD חסר — מדלג על photo analytics מול D1")
        return None
    try:
        resp = requests.get(
            f"{WORKER_URL}/api/admin/photo-analytics",
            headers={"X-Admin-Password": ADMIN_PASSWORD},
            timeout=15,
        )
        if resp.ok:
            data = resp.json()
            return {
                "window_days": 30,
                "views": data.get("views", []),
                "intents": data.get("intents", []),
                "purchases": data.get("purchases", []),
            }
        print(f"⚠️ photo-analytics החזיר {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"⚠️ photo-analytics נכשל: {e}")
    return None


def fetch_revenue_summary(days=7):
    """מושך הכנסות אמיתיות מאומתות מ-D1 (/api/admin/revenue-summary) — לא ספירת events מ-GA
    (שיורים בצד לקוח בלי קשר אם התשלום בפועל הצליח בשרת). כשל כאן לא אמור לעצור את הדוח כולו —
    שאר הדוח (GA, ניתוח) עדיין בעל ערך גם בלי זה."""
    if not ADMIN_PASSWORD:
        print("⚠️ ADMIN_PASSWORD חסר — מדלג על אימות הכנסות מול D1")
        return None
    try:
        resp = requests.get(
            f"{WORKER_URL}/api/admin/revenue-summary",
            params={"days": days},
            headers={"X-Admin-Password": ADMIN_PASSWORD},
            timeout=15,
        )
        if resp.ok:
            return resp.json()
        print(f"⚠️ revenue-summary החזיר {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"⚠️ revenue-summary נכשל: {e}")
    return None


def build_acquisition_experiment_scorecard(data):
    """Build a deterministic scorecard for the three frozen Acquisition Experiment 01 campaigns."""
    campaign_rows = {row.get("campaign"): row for row in data.get("campaigns", []) or []}
    event_counts = {}
    for row in data.get("experiment_events", []) or []:
        key = (row.get("campaign", ""), row.get("event", ""))
        event_counts[key] = event_counts.get(key, 0) + _safe_int(row.get("count"))

    paths = []
    for campaign, cfg in ACQUISITION_EXPERIMENT_CAMPAIGNS.items():
        campaign_row = campaign_rows.get(campaign, {})
        sessions = _safe_int(campaign_row.get("sessions"))
        primary = event_counts.get((campaign, cfg["primary_event"]), 0)
        secondary = event_counts.get((campaign, cfg["secondary_event"]), 0)
        paths.append({
            "campaign": campaign,
            "label": cfg["label"],
            "sessions": sessions,
            "active_users": _safe_int(campaign_row.get("activeUsers")),
            "primary_event": cfg["primary_event"],
            "primary_count": primary,
            "primary_rate_pct": _rate_pct(primary, sessions),
            "secondary_event": cfg["secondary_event"],
            "secondary_count": secondary,
            "status": "not_started" if sessions == 0 else "measuring",
        })

    return {
        "experiment": "Acquisition Experiment 01",
        "window_status": "not_started" if all(p["sessions"] == 0 for p in paths) else "measuring",
        "paths": paths,
    }


def build_data_summary(data):
    s, p = data["summary"], data["prev_week"]
    def delta(c, pv):
        try:
            pct = (float(c) - float(pv)) / float(pv) * 100 if float(pv) else 0
            return f"{'↑' if pct >= 0 else '↓'} {abs(pct):.0f}%"
        except: return ""

    lines = [
        f"תקופה: {data['period']}", "",
        "--- סיכום שבוע ---",
        f"סשנים:           {s['sessions']}  {delta(s['sessions'], p['sessions'])}",
        f"משתמשים פעילים:  {s['activeUsers']}  {delta(s['activeUsers'], p['activeUsers'])}",
        f"צפיות עמוד:      {s['pageViews']}  {delta(s['pageViews'], p['pageViews'])}",
        f"Bounce rate:     {s['bounceRate']}",
        f"Engagement rate: {s.get('engagementRate', 'לא זמין')}",
        f"סשנים מעורבים:   {s.get('engagedSessions', 'לא זמין')}",
        f"זמן ממוצע בסשן: {format_duration(s['avgSessionSec'])}",
        f"משתמשים חדשים:   {s['newUsers']}",
        "", "--- עמודים הכי פופולריים ---",
    ]
    for i, r in enumerate(data["top_pages"][:8], 1):
        lines.append(f"  {i}. {r['עמוד']}  — {r['צפיות']} צפיות")
    lines += ["", "--- עמודי נחיתה ---"]
    for i, r in enumerate(data.get("landing_pages", [])[:8], 1):
        lines.append(f"  {i}. {r['עמוד נחיתה']} — {r['sessions']} סשנים")
    lines += ["", "--- מקורות תנועה ---"]
    for r in data["sources"]:
        lines.append(f"  {r['מקור']}: {r['sessions']} סשנים")
    lines += ["", "--- Source / Medium / Campaign ---"]
    campaigns = data.get("campaigns", [])
    if campaigns:
        for r in campaigns[:12]:
            campaign = r.get("campaign") or "(not set)"
            lines.append(
                f"  {r.get('source','(direct)')} / {r.get('medium','(none)')} / {campaign}: "
                f"{r.get('sessions','0')} סשנים"
            )
    else:
        lines.append("  אין נתוני campaign")
    scorecard = data.get("acquisition_experiment") or build_acquisition_experiment_scorecard(data)
    lines += ["", "--- Acquisition Experiment 01 ---"]
    lines.append(f"  status: {scorecard.get('window_status', 'not_started')}")
    for path in scorecard.get("paths", []):
        rate = path.get("primary_rate_pct")
        rate_text = "—" if rate is None else f"{rate}%"
        lines.append(
            f"  {path['label']}: sessions={path['sessions']}, {path['primary_event']}={path['primary_count']} "
            f"({rate_text}), {path['secondary_event']}={path['secondary_count']}"
        )

    lines += ["", "--- מכשירים ---"]
    for r in data["devices"]:
        lines.append(f"  {r['מכשיר']}: {r['sessions']} סשנים")
    lines += ["", "--- ארצות ---"]
    for r in data["countries"]:
        lines.append(f"  {r['ארץ']}: {r['sessions']} סשנים")
    lines += ["", "--- משפך מכירה דיגיטלית (buy modal) ---"]
    fe = data["funnel_events"]
    lines.append(f"  צפיות בתמונה (photo_view):        {fe.get('photo_view', '0')}")
    lines.append(f"  פתיחת מודל קנייה (purchase_intent): {fe.get('purchase_intent', '0')}")
    lines.append(f"  בחירת גודל/מוצר (add_size):        {fe.get('add_size', '0')}")
    lines.append(f"  רכישה שהושלמה (purchase):          {fe.get('purchase', '0')}")
    lines += ["", "--- משפך הזמנת הדפסה (print modal / Gelato) ---"]
    lines.append(f"  פתיחת מודל הדפסה (print_intent):        {fe.get('print_intent', '0')}")
    lines.append(f"  בחירת סוג הדפסה (print_type_selected):  {fe.get('print_type_selected', '0')}")
    lines.append(f"  מעבר לתשלום (print_checkout):           {fe.get('print_checkout', '0')}")
    lines += ["", "--- התנהגות וחוויית משתמש ---"]
    for event, label in [
        ("hero_gallery_click", "CTA גלריה ב-Hero"),
        ("hero_guide_click", "CTA מדריך ב-Hero"),
        ("nav_click", "לחיצות ניווט"),
        ("gallery_filter", "שימוש בפילטר גלריה"),
        ("scroll_25", "גלילה 25%"), ("scroll_50", "גלילה 50%"),
        ("scroll_75", "גלילה 75%"), ("scroll_90", "גלילה 90%"),
        ("guide_request_success", "בקשות מדריך מוצלחות"),
        ("generate_lead", "לידים חדשים/משודרגים"),
        ("contact_intent", "כוונת יצירת קשר"),
        ("photo_contact_click", "פנייה מתוך תמונה"),
        ("contact_form_success", "טופסי קשר שנשלחו"),
        ("licensing_personal_interest", "עניין ברישוי אישי"),
        ("licensing_commercial_contact", "פניות רישוי מסחרי"),
        ("b2b_intent", "עניין B2B"),
        ("b2b_package_select", "בחירת חבילת B2B"),
        ("b2b_contact_start", "תחילת פנייה B2B"),
        ("language_change", "החלפת שפה"),
    ]:
        lines.append(f"  {label}: {fe.get(event, '0')}")

    lines += ["", "--- התנהגות לפי עמוד ---"]
    ux_by_page = data.get("ux_by_page", [])
    if ux_by_page:
        for row in ux_by_page[:20]:
            lines.append(f"  {row['עמוד'] or '/'} — {row['event']}: {row['count']}")
    else:
        lines.append("  אין עדיין אירועי UX לפי עמוד")

    sub = data.get("subscriber_summary")
    lines += ["", "--- לידים לפי מקור (D1 aggregate, ללא PII) ---"]
    if sub is None:
        lines.append("  לא זמין")
    else:
        totals = sub.get("totals", {})
        lines.append(
            f"  סה\"כ subscribers: {totals.get('total_subscribers', 0)} | "
            f"marketing opt-in: {totals.get('marketing_subscribers', 0)} | "
            f"opt-out: {totals.get('non_marketing_subscribers', 0)} | "
            f"unknown legacy: {totals.get('unknown_marketing_consent', 0)}"
        )
        for row in sub.get("period_new_by_source", []):
            lines.append(
                f"  {row.get('source','unknown')}: total={row.get('total',0)}, "
                f"marketing={row.get('marketing_opt_in',0)}, "
                f"no-marketing={row.get('marketing_opt_out',0)}, "
                f"unknown={row.get('marketing_unknown',0)}"
            )
        opt_in_rows = sub.get("period_marketing_opt_ins_by_source", [])
        if opt_in_rows:
            lines.append("  opt-ins/upgrades בתקופה לפי מקור:")
            for row in opt_in_rows:
                lines.append(f"    {row.get('source','unknown')}: {row.get('count',0)}")

    rev = data.get("revenue")
    lines += ["", "--- אימות הכנסות מול D1 (לא רק ספירת events מ-GA) ---"]
    if rev is None:
        lines.append("  לא זמין (ADMIN_PASSWORD חסר או שגיאת חיבור — ראה אזהרה למעלה)")
    else:
        lines.append(f"  מצב תשלומים באתר: {'פעיל' if rev['payments_enabled'] else 'כבוי (PAYMENTS_ENABLED=false)'}")
        lines.append(f"  רכישות דיגיטליות מאומתות בשרת: {rev['digital']['count']}  |  הכנסה: ₪{rev['digital']['revenue_ils']}")
        lines.append(f"  הזמנות הדפסה מאומתות בשרת:     {rev['print']['total_count']}  |  הכנסה: ₪{rev['print']['total_revenue_ils']}")
        for row in rev["print"]["by_status"]:
            lines.append(f"    - {row['status']}: {row['count']} הזמנות, ₪{row.get('revenue') or 0}")
    return "\n".join(lines)


def _safe_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _rate_pct(numerator, denominator):
    if not denominator:
        return None
    return round((numerator / denominator) * 100, 1)


def build_business_review(data):
    """Deterministic weekly scorecard: one next experiment, with sample-size guardrails."""
    sessions = _safe_int(data.get("summary", {}).get("sessions"))
    funnel = data.get("funnel_events", {}) or {}
    photo_views = _safe_int(funnel.get("photo_view"))
    purchase_intent = _safe_int(funnel.get("purchase_intent"))
    print_intent = _safe_int(funnel.get("print_intent"))
    add_size = _safe_int(funnel.get("add_size"))
    guide_requests = _safe_int(funnel.get("guide_request_success"))
    leads = _safe_int(funnel.get("generate_lead"))

    direct_sessions = 0
    for row in data.get("sources", []) or []:
        label = str(row.get("מקור", "")).strip().lower()
        if label in {"כניסה ישירה", "direct", "direct traffic"}:
            direct_sessions += _safe_int(row.get("sessions"))

    subscriber_summary = data.get("subscriber_summary") or {}
    source_rows = subscriber_summary.get("period_new_by_source", []) or []
    new_subscribers = sum(_safe_int(r.get("total")) for r in source_rows)
    marketing_opt_ins = sum(_safe_int(r.get("marketing_opt_in")) for r in source_rows)
    period_marketing_opt_ins = sum(
        _safe_int(r.get("count"))
        for r in subscriber_summary.get("period_marketing_opt_ins_by_source", []) or []
    )

    review = {
        "sample": {
            "sessions": sessions,
            "new_subscribers": new_subscribers,
            "directional_only": new_subscribers < 20,
            "note": (
                "Directional only — fewer than 20 new subscribers in the measured period."
                if new_subscribers < 20
                else "Enough subscriber volume for a first source-level comparison; continue validating over 28 days."
            ),
        },
        "kpis": {
            "direct_share_pct": _rate_pct(direct_sessions, sessions),
            "lead_rate_pct": _rate_pct(leads, sessions),
            "guide_request_rate_pct": _rate_pct(guide_requests, sessions),
            "new_subscriber_marketing_opt_in_pct": _rate_pct(marketing_opt_ins, new_subscribers),
            "period_marketing_opt_ins": period_marketing_opt_ins,
            "digital_intent_pct": _rate_pct(purchase_intent, photo_views),
            "digital_selection_pct": _rate_pct(add_size, purchase_intent),
            "print_intent_pct": _rate_pct(print_intent, photo_views),
        },
        "next_action": "",
        "reason": "",
    }

    direct_share = review["kpis"]["direct_share_pct"]
    if direct_share is not None and direct_share > 70 and sessions >= 20:
        review["next_action"] = (
            "Run one attribution experiment this week: every new social/newsletter share should use a deep link "
            "to a specific photo, collection or free guide with UTM tags; avoid homepage links by default."
        )
        review["reason"] = (
            f"Direct traffic is {direct_share}% of sessions, so acquisition attribution is still the largest "
            "measurement constraint before choosing a monetization channel."
        )
    elif guide_requests >= 5 and leads < guide_requests:
        review["next_action"] = (
            "Test one clearer marketing opt-in value proposition on the free-guide flow, without changing "
            "privacy consent or making marketing consent mandatory."
        )
        review["reason"] = (
            "Guide requests are converting into fewer marketing leads; the lead magnet is working, but owned-audience "
            "conversion needs a focused copy/value test."
        )
    elif photo_views >= 20 and purchase_intent > print_intent:
        review["next_action"] = (
            "Prepare the smallest digital licensing MVP definition: 2–3 license tiers, deliverables and test prices; "
            "do not enable production payments yet."
        )
        review["reason"] = (
            f"Digital purchase intent ({purchase_intent}) is currently above print intent ({print_intent}) "
            "with enough photo-view activity for a directional product hypothesis."
        )
    elif print_intent >= 3 and print_intent >= purchase_intent:
        review["next_action"] = (
            "Design a curated print reservation test for 3–5 photos before investing further in full Gelato checkout."
        )
        review["reason"] = "Print intent is recurring enough to justify a demand-validation experiment, not a full store build."
    else:
        review["next_action"] = (
            "Keep measurement stable for another week and focus on increasing qualified traffic rather than adding a new commerce feature."
        )
        review["reason"] = "Current conversion counts are still too small for a reliable channel decision."

    return review


def generate_analysis(data_summary):
    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=2000,
        system="""אתה יועץ SEO ושיווק דיגיטלי לאתר amitphotos.com — גלריית fine art photography של עמית ארז.
האתר מוכר הדפסות אמנות ותמונות דיגיטליות להורדה, ומציע מדריכי צילום חינוכיים.
הקהל: אנשים שאוהבים אמנות צילומית, מעצבי פנים, קונים רגשיים — לא מחפשים צלם לאירועים.
הכנסות מגיעות מ: מכירות דיגיטל (PayPal), הדפסות (Gelato), affiliate (Adorama/Skylum).
אתה מנתח נתוני Google Analytics שבועיים ומציע המלצות ספציפיות ומעשיות לגלריית fine art.
שים לב לשני משפכים נפרדים: מכירה דיגיטלית (photo_view → purchase_intent → add_size → purchase)
ומכירת הדפסה פיזית דרך Gelato (print_intent → print_type_selected → print_checkout → הזמנה
מושלמת ב-print_orders).
בנתונים מופיע גם סעיף "אימות הכנסות מול D1" — אלו מספרים אמיתיים מהשרת (לא רק events בצד
לקוח שיכולים להירשם גם אם התשלום בפועל נכשל). שים לב במיוחד למצב מתג התשלומים: אם כתוב
"כבוי (PAYMENTS_ENABLED=false)" — אל תפרש רכישות=0 כבעיית שיווק או כשל במשפך, זו מדיניות
מכוונת של בעל האתר ולא משהו לתקן. אם התשלומים פעילים ויש פער משמעותי בין ספירת ה-events
ב-GA (purchase_intent/purchase) לבין המספרים המאומתים מ-D1 — זה ממצא אמיתי וחשוב לציין.
כותב בעברית, ישיר, ללא כותרות מפוצצות. נותן 3-5 המלצות מה לעשות השבוע.""",
        messages=[{"role": "user", "content": f"""נתוני אנליטיקס שבועיים של amitphotos.com:

{data_summary}

ספק:
1. 2 משפטים על מה קרה השבוע
2. 3-5 המלצות ספציפיות ומעשיות לשבוע הבא
3. הזהר מבעיה אחת שרואים בנתונים (אם יש)

כתוב בעברית, ישיר."""}],
    )
    return msg.content[0].text.strip()


def build_business_review_html(review):
    if not review:
        return ""
    k = review.get("kpis", {})
    sample = review.get("sample", {})
    def fmt(v):
        return "—" if v is None else f"{v}%"
    return f"""
  <div style="padding:0 24px 20px">
    <h2 style="color:#2c3e50;margin:0 0 8px;font-size:1em">Business Review — החלטה אחת לשבוע הבא</h2>
    <div style="background:#fff8e8;border-right:4px solid #c8a96e;padding:14px 16px;border-radius:0 8px 8px 0;line-height:1.65;color:#333;font-size:.92em">
      <strong>{review.get('next_action','')}</strong><br>
      <span style="color:#666">{review.get('reason','')}</span>
      <div style="margin-top:10px;color:#777;font-size:.84em">
        Direct: {fmt(k.get('direct_share_pct'))} · Lead rate: {fmt(k.get('lead_rate_pct'))} ·
        Guide request rate: {fmt(k.get('guide_request_rate_pct'))} ·
        New-subscriber marketing opt-in: {fmt(k.get('new_subscriber_marketing_opt_in_pct'))} ·
        Weekly marketing opt-ins/upgrades: {k.get('period_marketing_opt_ins', 0)} ·
        Digital intent: {fmt(k.get('digital_intent_pct'))} ·
        Print intent: {fmt(k.get('print_intent_pct'))}<br>
        Sample: {sample.get('sessions',0)} sessions / {sample.get('new_subscribers',0)} new subscribers.
        {sample.get('note','')}
      </div>
    </div>
  </div>"""


def build_acquisition_experiment_html(scorecard):
    if not scorecard:
        return ""
    rows = ""
    for path in scorecard.get("paths", []):
        rate = path.get("primary_rate_pct")
        rate_text = "—" if rate is None else f"{rate}%"
        rows += (
            f'<tr><td style="padding:6px 8px">{path["label"]}</td>'
            f'<td style="padding:6px 8px;text-align:right">{path["sessions"]}</td>'
            f'<td style="padding:6px 8px;text-align:right">{path["primary_event"]}: {path["primary_count"]} ({rate_text})</td>'
            f'<td style="padding:6px 8px;text-align:right">{path["secondary_event"]}: {path["secondary_count"]}</td></tr>'
        )
    return f"""
  <div style="padding:0 24px 20px">
    <h2 style="color:#2c3e50;margin:0 0 8px;font-size:1em">Acquisition Experiment 01 — {scorecard.get('window_status','not_started')}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:.86em">
      <tr style="background:#f0f2f5"><th style="padding:6px 8px;text-align:right">Path</th><th>Sessions</th><th>Primary</th><th>Secondary</th></tr>
      {rows}
    </table>
  </div>"""


def build_revenue_html(rev, card):
    """סעיף אימות הכנסות אמיתי מ-D1 בגוף המייל — לא זמין בעדינות (לא שובר את שאר המייל) אם
    revenue-summary נכשל."""
    if rev is None:
        return ('<div style="padding:0 24px 20px"><h2 style="color:#2c3e50;margin:0 0 8px;font-size:1em">'
                'אימות הכנסות מול D1</h2><div style="color:#999;font-size:.85em">לא זמין השבוע '
                '(ADMIN_PASSWORD חסר או שגיאת חיבור)</div></div>')
    status_label = "🟢 פעיל" if rev["payments_enabled"] else "🔴 כבוי (PAYMENTS_ENABLED=false)"
    return f"""
  <div style="padding:0 24px 20px">
    <h2 style="color:#2c3e50;margin:0 0 8px;font-size:1em">אימות הכנסות מול D1 — מצב תשלומים: {status_label}</h2>
    <div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;display:flex;gap:10px;flex-wrap:wrap">
      {card("רכישות דיגיטליות מאומתות", rev['digital']['count'])}
      {card("הכנסה דיגיטלית", f"₪{rev['digital']['revenue_ils']}")}
      {card("הזמנות הדפסה מאומתות", rev['print']['total_count'])}
      {card("הכנסת הדפסה", f"₪{rev['print']['total_revenue_ils']}")}
    </div>
  </div>"""


def build_html_email(data, analysis):
    s, p = data["summary"], data["prev_week"]

    def delta_color(c, pv):
        try:
            pct = (float(c) - float(pv)) / float(pv) * 100 if float(pv) else 0
            return ("#27ae60" if pct >= 0 else "#e74c3c", f"{'↑' if pct >= 0 else '↓'} {abs(pct):.0f}%")
        except: return ("#888", "")

    def card(label, value, prev_val=""):
        col, d = delta_color(value, prev_val)
        badge = f' <span style="color:{col};font-size:.85em">{d}</span>' if d else ""
        return (f'<div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;margin:6px;'
                f'display:inline-block;min-width:140px;text-align:center">'
                f'<div style="font-size:1.6em;font-weight:700;color:#2c3e50">{value}{badge}</div>'
                f'<div style="font-size:.78em;color:#888;margin-top:4px">{label}</div></div>')

    pages_rows = "".join(
        f'<tr><td style="padding:5px 8px;color:#555">{r["עמוד"]}</td>'
        f'<td style="padding:5px 8px;text-align:right;font-weight:600">{r["צפיות"]}</td></tr>'
        for r in data["top_pages"][:8]
    )
    sources_rows = "".join(
        f'<tr><td style="padding:5px 8px;color:#555">{r["מקור"]}</td>'
        f'<td style="padding:5px 8px;text-align:right;font-weight:600">{r["sessions"]}</td></tr>'
        for r in data["sources"]
    )
    campaign_rows = "".join(
        f'<tr><td style="padding:5px 8px;color:#555">{r.get("source","")} / {r.get("medium","")}</td>'
        f'<td style="padding:5px 8px;color:#555">{r.get("campaign") or "(not set)"}</td>'
        f'<td style="padding:5px 8px;text-align:right;font-weight:600">{r.get("sessions","0")}</td></tr>'
        for r in data.get("campaigns", [])[:10]
    )

    return f"""<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>דוח GA שבועי — amitphotos.com</title></head>
<body style="font-family:Arial,sans-serif;background:#f0f2f5;margin:0;padding:16px">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
  <div style="background:#2c3e50;color:#fff;padding:24px 28px">
    <h1 style="margin:0;font-size:1.3em">📊 דוח Google Analytics שבועי</h1>
    <p style="margin:6px 0 0;opacity:.7;font-size:.9em">{data['period']} — amitphotos.com</p>
  </div>
  <div style="padding:20px 24px">
    <h2 style="color:#2c3e50;margin:0 0 12px;font-size:1em">סיכום שבוע</h2>
    {card("סשנים", s['sessions'], p['sessions'])}
    {card("משתמשים פעילים", s['activeUsers'], p['activeUsers'])}
    {card("צפיות", s['pageViews'], p['pageViews'])}
    {card("משתמשים חדשים", s['newUsers'])}
    {card("Bounce rate", s['bounceRate'])}
    {card("Engagement rate", s.get('engagementRate', 'לא זמין'))}
    {card("סשנים מעורבים", s.get('engagedSessions', 'לא זמין'))}
    {card("זמן ממוצע", format_duration(s['avgSessionSec']))}
  </div>
  {build_business_review_html(data.get('business_review'))}
  {build_acquisition_experiment_html(data.get('acquisition_experiment'))}
  <div style="padding:0 24px 20px">
    <h2 style="color:#2c3e50;margin:0 0 10px;font-size:1em">ניתוח והמלצות — Claude</h2>
    <div style="background:#f8f9fa;border-right:4px solid #3498db;padding:14px 16px;border-radius:0 8px 8px 0;line-height:1.7;color:#333;font-size:.92em">
      {analysis.replace(chr(10), "<br>")}
    </div>
  </div>
  <div style="padding:0 24px 20px">
    <h2 style="color:#2c3e50;margin:0 0 8px;font-size:1em">התנהגות וחוויית משתמש</h2>
    <div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;display:flex;gap:10px;flex-wrap:wrap">
      {card("CTA גלריה", data['funnel_events'].get('hero_gallery_click', '0'))}
      {card("CTA מדריך", data['funnel_events'].get('hero_guide_click', '0'))}
      {card("לחיצות ניווט", data['funnel_events'].get('nav_click', '0'))}
      {card("פילטרים", data['funnel_events'].get('gallery_filter', '0'))}
      {card("גלילה 50%", data['funnel_events'].get('scroll_50', '0'))}
      {card("גלילה 90%", data['funnel_events'].get('scroll_90', '0'))}
      {card("לידים", data['funnel_events'].get('generate_lead', '0'))}
      {card("יצירת קשר", data['funnel_events'].get('contact_intent', '0'))}
      {card("עניין ברישוי אישי", data['funnel_events'].get('licensing_personal_interest', '0'))}
      {card("פניות רישוי מסחרי", data['funnel_events'].get('licensing_commercial_contact', '0'))}
      {card("עניין B2B", data['funnel_events'].get('b2b_intent', '0'))}
      {card("פניות B2B", data['funnel_events'].get('b2b_contact_start', '0'))}
    </div>
  </div>
  <div style="padding:0 24px 20px">
    <h2 style="color:#2c3e50;margin:0 0 8px;font-size:1em">משפך מכירה דיגיטלית (buy modal)</h2>
    <div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;display:flex;gap:10px;flex-wrap:wrap">
      {card("צפיות בתמונה", data['funnel_events'].get('photo_view', '0'))}
      {card("פתיחת מודל קנייה", data['funnel_events'].get('purchase_intent', '0'))}
      {card("בחירת גודל", data['funnel_events'].get('add_size', '0'))}
      {card("רכישה הושלמה", data['funnel_events'].get('purchase', '0'))}
    </div>
  </div>
  <div style="padding:0 24px 20px">
    <h2 style="color:#2c3e50;margin:0 0 8px;font-size:1em">משפך הזמנת הדפסה (print modal / Gelato)</h2>
    <div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;display:flex;gap:10px;flex-wrap:wrap">
      {card("פתיחת מודל הדפסה", data['funnel_events'].get('print_intent', '0'))}
      {card("בחירת סוג הדפסה", data['funnel_events'].get('print_type_selected', '0'))}
      {card("מעבר לתשלום", data['funnel_events'].get('print_checkout', '0'))}
    </div>
  </div>
  {build_revenue_html(data.get('revenue'), card)}
  <div style="padding:0 24px 20px;display:flex;gap:20px;flex-wrap:wrap">
    <div style="flex:1;min-width:220px">
      <h2 style="color:#2c3e50;margin:0 0 8px;font-size:1em">עמודים פופולריים</h2>
      <table style="width:100%;border-collapse:collapse;font-size:.88em">
        <tr style="background:#f0f2f5"><th style="padding:6px 8px;text-align:right;color:#555">עמוד</th><th style="padding:6px 8px;text-align:right;color:#555">צפיות</th></tr>
        {pages_rows}
      </table>
    </div>
    <div style="flex:1;min-width:180px">
      <h2 style="color:#2c3e50;margin:0 0 8px;font-size:1em">מקורות תנועה</h2>
      <table style="width:100%;border-collapse:collapse;font-size:.88em">
        <tr style="background:#f0f2f5"><th style="padding:6px 8px;text-align:right;color:#555">מקור</th><th style="padding:6px 8px;text-align:right;color:#555">סשנים</th></tr>
        {sources_rows}
      </table>
    </div>
  </div>
  <div style="padding:0 24px 20px">
    <h2 style="color:#2c3e50;margin:0 0 8px;font-size:1em">Campaign attribution</h2>
    <table style="width:100%;border-collapse:collapse;font-size:.86em">
      <tr style="background:#f0f2f5">
        <th style="padding:6px 8px;text-align:right;color:#555">Source / Medium</th>
        <th style="padding:6px 8px;text-align:right;color:#555">Campaign</th>
        <th style="padding:6px 8px;text-align:right;color:#555">Sessions</th>
      </tr>
      {campaign_rows or '<tr><td colspan="3" style="padding:8px;color:#999">אין עדיין נתוני campaign</td></tr>'}
    </table>
  </div>
  <div style="background:#f8f9fa;padding:14px 24px;text-align:center;color:#aaa;font-size:.78em">
    נשלח אוטומטית מ-amitphotos.com • <a href="https://amitphotos.com" style="color:#3498db">amitphotos.com</a>
  </div>
</div>
</body></html>"""


def send_email(subject, html_body):
    resp = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {RESEND_KEY}", "Content-Type": "application/json"},
        json={"from": FROM_EMAIL, "to": [REPORT_EMAIL], "subject": subject, "html": html_body},
        timeout=30,
    )
    if not resp.ok:
        print(f"❌ Resend error {resp.status_code}: {resp.text}")
        sys.exit(1)
    print(f"✅ מייל נשלח: {resp.json().get('id')}")


def save_report(data, analysis, reports_file=None):
    """שומר את הדוח ל-data/ga_reports.json לתצוגה באדמין."""
    from pathlib import Path
    reports_file = Path(reports_file) if reports_file else Path(__file__).parent.parent / "data" / "ga_reports.json"
    reports = []
    if reports_file.exists():
        try:
            reports = json.loads(reports_file.read_text(encoding="utf-8"))
        except Exception:
            reports = []

    s = data["summary"]
    p = data["prev_week"]
    def delta(c, pv):
        try:
            pct = (float(c) - float(pv)) / float(pv) * 100 if float(pv) else 0
            return f"{'↑' if pct >= 0 else '↓'}{abs(pct):.0f}%"
        except: return ""

    reports.append({
        "date":    date.today().strftime("%d.%m.%Y"),
        "period":  data["period"],
        "summary": {
            "sessions":       s["sessions"],
            "activeUsers":    s["activeUsers"],
            "pageViews":      s["pageViews"],
            "bounceRate":     s["bounceRate"],
            "avgSessionSec":  s["avgSessionSec"],
            "newUsers":       s.get("newUsers", "0"),
            "engagementRate": s.get("engagementRate"),
            "engagedSessions": s.get("engagedSessions"),
            "delta_sessions": delta(s["sessions"], p["sessions"]),
            "delta_users":    delta(s["activeUsers"], p["activeUsers"]),
            "delta_views":    delta(s["pageViews"], p["pageViews"]),
        },
        "top_pages": data["top_pages"][:5],
        "landing_pages": data.get("landing_pages", [])[:5],
        "sources":   data["sources"][:5],
        "campaigns": data.get("campaigns", [])[:20],
        "devices":   data.get("devices", []),
        "countries": data.get("countries", [])[:5],
        "funnel_events": data["funnel_events"],
        "ux_by_page": data.get("ux_by_page", [])[:50],
        "subscriber_summary": data.get("subscriber_summary"),
        "business_review": data.get("business_review"),
        "acquisition_experiment": data.get("acquisition_experiment"),
        "experiment_events": data.get("experiment_events", []),
        "revenue":   data.get("revenue"),
        "photo_analytics": data.get("photo_analytics"),
        "analysis":  analysis,
    })

    # שמור רק 12 דוחות אחרונים
    reports = reports[-12:]
    reports_file.write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    print("💾 נשמר ל-data/ga_reports.json")


def main():
    missing = [v for v, k in [("GA4_PROPERTY_ID", GA4_PROPERTY_ID), ("GA_REFRESH_TOKEN", GA_REFRESH_TOKEN),
                               ("GA_CLIENT_ID", GA_CLIENT_ID), ("GA_CLIENT_SECRET", GA_CLIENT_SECRET),
                               ("ANTHROPIC_API_KEY", ANTHROPIC_KEY), ("RESEND_API_KEY", RESEND_KEY)] if not k]
    if missing:
        print(f"❌ חסרים: {', '.join(missing)}")
        sys.exit(1)

    print("🔐 מתחבר ל-Google Analytics...")
    token = get_access_token()

    print("📊 שולף נתונים מ-GA4...")
    data = fetch_ga4_data(token)

    print("👥 מושך לידים לפי מקור מ-D1...")
    data["subscriber_summary"] = fetch_subscriber_summary()

    print("💰 מאמת הכנסות מול D1...")
    data["revenue"] = fetch_revenue_summary()

    print("🖼️ מושך ביצועי תמונות מ-D1...")
    data["photo_analytics"] = fetch_photo_analytics()

    data["business_review"] = build_business_review(data)
    data["acquisition_experiment"] = build_acquisition_experiment_scorecard(data)
    print(build_data_summary(data))
    print("\n📌 החלטה עסקית לשבוע הבא:")
    print("  " + data["business_review"]["next_action"])
    print("  סיבה: " + data["business_review"]["reason"])

    print("\n🤖 Claude מנתח נתונים...")
    analysis = generate_analysis(build_data_summary(data))
    print(f"\n--- ניתוח ---\n{analysis}\n")

    save_report(data, analysis)

    print("📧 שולח מייל...")
    send_email(f"📊 דוח GA שבועי — {date.today().strftime('%d.%m.%Y')}", build_html_email(data, analysis))


if __name__ == "__main__":
    main()
