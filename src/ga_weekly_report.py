#!/usr/bin/env python3
"""
GA4 Weekly Analysis
שולח ניתוח שבועי של Google Analytics עם המלצות לשיפור מ-Claude.
"""

import os, sys, json, base64
from datetime import date, timedelta
import requests
import anthropic

# ===== הגדרות =====
GA4_PROPERTY_ID   = os.environ.get("GA4_PROPERTY_ID", "")
GA_CREDS_JSON     = os.environ.get("GA_SERVICE_ACCOUNT_JSON", "")
RESEND_KEY        = os.environ.get("RESEND_API_KEY", "")
ANTHROPIC_KEY     = os.environ.get("ANTHROPIC_API_KEY", "").strip()
REPORT_EMAIL      = os.environ.get("REPORT_EMAIL", "erez.family@gmail.com")
FROM_EMAIL        = os.environ.get("FROM_EMAIL", "Amit Photos <amit@amitphotos.com>")

GA4_API_BASE = "https://analyticsdata.googleapis.com/v1beta"

HEBREW_CHANNELS = {
    "Organic Search":  "חיפוש אורגני",
    "Direct":          "כניסה ישירה",
    "Social":          "רשתות חברתיות",
    "Referral":        "הפניות",
    "Email":           "מייל",
    "Paid Search":     "פרסום ממומן",
    "Organic Social":  "סושיאל אורגני",
    "Unassigned":      "לא מוגדר",
}


def get_access_token():
    """מייצר access token מ-service account credentials."""
    try:
        from google.oauth2 import service_account
        import google.auth.transport.requests as ga_transport
    except ImportError:
        print("❌ חסר: pip install google-auth")
        sys.exit(1)

    raw = GA_CREDS_JSON.strip()
    try:
        # ניסיון base64 decode
        creds_dict = json.loads(base64.b64decode(raw).decode())
    except Exception:
        creds_dict = json.loads(raw)

    scopes = ["https://www.googleapis.com/auth/analytics.readonly"]
    creds = service_account.Credentials.from_service_account_info(creds_dict, scopes=scopes)
    creds.refresh(ga_transport.Request())
    return creds.token


def run_report(token, body):
    """מריץ GA4 Data API runReport."""
    url = f"{GA4_API_BASE}/properties/{GA4_PROPERTY_ID}:runReport"
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
    """ממיר תוצאות GA4 לרשימת דיקשנריז."""
    if not data or "rows" not in data:
        return []
    rows = []
    for row in data["rows"]:
        dims = [d["value"] for d in row.get("dimensionValues", [])]
        metrics = [m["value"] for m in row.get("metricValues", [])]
        entry = {}
        if dim_key and dims:
            entry[dim_key] = dims[0]
        for i, k in enumerate(metric_keys):
            entry[k] = metrics[i] if i < len(metrics) else "0"
        rows.append(entry)
    return rows


def fetch_ga4_data(token):
    """שולף את כל הדוחות מ-GA4 לשבוע האחרון."""
    today = date.today()
    start = (today - timedelta(days=7)).strftime("%Y-%m-%d")
    end   = today.strftime("%Y-%m-%d")
    date_range = [{"startDate": start, "endDate": end}]

    # 1. מדדי בסיס
    summary_raw = run_report(token, {
        "dateRanges": date_range,
        "metrics": [
            {"name": "sessions"},
            {"name": "activeUsers"},
            {"name": "screenPageViews"},
            {"name": "bounceRate"},
            {"name": "averageSessionDuration"},
            {"name": "newUsers"},
        ],
    })

    # 2. עמודים הכי נצפים
    pages_raw = run_report(token, {
        "dateRanges": date_range,
        "dimensions": [{"name": "pagePath"}],
        "metrics": [{"name": "screenPageViews"}, {"name": "sessions"}],
        "orderBys": [{"metric": {"metricName": "screenPageViews"}, "desc": True}],
        "limit": 10,
    })

    # 3. מקורות תנועה
    sources_raw = run_report(token, {
        "dateRanges": date_range,
        "dimensions": [{"name": "sessionDefaultChannelGrouping"}],
        "metrics": [{"name": "sessions"}],
        "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
        "limit": 8,
    })

    # 4. מכשירים
    devices_raw = run_report(token, {
        "dateRanges": date_range,
        "dimensions": [{"name": "deviceCategory"}],
        "metrics": [{"name": "sessions"}],
        "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
    })

    # 5. ארצות
    countries_raw = run_report(token, {
        "dateRanges": date_range,
        "dimensions": [{"name": "country"}],
        "metrics": [{"name": "sessions"}],
        "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
        "limit": 5,
    })

    # 6. השוואה לשבוע הקודם
    prev_start = (today - timedelta(days=14)).strftime("%Y-%m-%d")
    prev_end   = (today - timedelta(days=8)).strftime("%Y-%m-%d")
    prev_raw = run_report(token, {
        "dateRanges": [{"startDate": prev_start, "endDate": prev_end}],
        "metrics": [{"name": "sessions"}, {"name": "activeUsers"}, {"name": "screenPageViews"}],
    })

    # parse
    summary_rows = summary_raw.get("rows", []) if summary_raw else []
    def s(i): return summary_rows[0]["metricValues"][i]["value"] if summary_rows else "0"

    prev_rows = prev_raw.get("rows", []) if prev_raw else []
    def p(i): return prev_rows[0]["metricValues"][i]["value"] if prev_rows else "0"

    pages   = parse_rows(pages_raw,   ["צפיות", "sessions"], "עמוד")
    sources = parse_rows(sources_raw, ["sessions"],           "מקור")
    devices = parse_rows(devices_raw, ["sessions"],           "מכשיר")
    countries = parse_rows(countries_raw, ["sessions"],       "ארץ")

    # תרגום מקורות לעברית
    for r in sources:
        r["מקור"] = HEBREW_CHANNELS.get(r["מקור"], r["מקור"])

    return {
        "period": f"{start} → {end}",
        "summary": {
            "sessions":          s(0),
            "activeUsers":       s(1),
            "pageViews":         s(2),
            "bounceRate":        f"{float(s(3)) * 100:.1f}%",
            "avgSessionSec":     f"{float(s(4)):.0f}",
            "newUsers":          s(5),
        },
        "prev_week": {
            "sessions":  p(0),
            "activeUsers": p(1),
            "pageViews": p(2),
        },
        "top_pages":   pages,
        "sources":     sources,
        "devices":     devices,
        "countries":   countries,
    }


def delta_str(curr, prev):
    """מחשב שינוי בין שבועות ומחזיר מחרוזת כמו +12% ↑"""
    try:
        c, p = float(curr), float(prev)
        if p == 0:
            return ""
        pct = (c - p) / p * 100
        arrow = "↑" if pct >= 0 else "↓"
        return f"{arrow} {abs(pct):.0f}%"
    except Exception:
        return ""


def build_data_summary(data):
    """בונה סיכום טקסטואלי לשליחה ל-Claude."""
    s   = data["summary"]
    p   = data["prev_week"]
    lines = [
        f"תקופה: {data['period']}",
        "",
        "--- סיכום שבוע ---",
        f"סשנים:           {s['sessions']}  {delta_str(s['sessions'], p['sessions'])}",
        f"משתמשים פעילים:  {s['activeUsers']}  {delta_str(s['activeUsers'], p['activeUsers'])}",
        f"צפיות עמוד:      {s['pageViews']}  {delta_str(s['pageViews'], p['pageViews'])}",
        f"Bounce rate:     {s['bounceRate']}",
        f"זמן ממוצע בסשן: {s['avgSessionSec']} שניות",
        f"משתמשים חדשים:   {s['newUsers']}",
        "",
        "--- עמודים הכי פופולריים ---",
    ]
    for i, row in enumerate(data["top_pages"][:8], 1):
        lines.append(f"  {i}. {row['עמוד']}  — {row['צפיות']} צפיות")

    lines += ["", "--- מקורות תנועה ---"]
    for row in data["sources"]:
        lines.append(f"  {row['מקור']}: {row['sessions']} סשנים")

    lines += ["", "--- מכשירים ---"]
    for row in data["devices"]:
        lines.append(f"  {row['מכשיר']}: {row['sessions']} סשנים")

    lines += ["", "--- ארצות ---"]
    for row in data["countries"]:
        lines.append(f"  {row['ארץ']}: {row['sessions']} סשנים")

    return "\n".join(lines)


def generate_analysis(data_summary):
    """Claude מנתח את הנתונים ומציע המלצות."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

    msg = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=1000,
        system="""אתה יועץ SEO ושיווק דיגיטלי לאתר הצילום amitphotos.com.
אתה מנתח נתוני Google Analytics שבועיים ומציע המלצות ספציפיות ומעשיות.

הסגנון שלך:
- ישיר ותכליתי — לא מבזבז מילים
- כותב בעברית
- נותן 3-5 המלצות ספציפיות (לא כלליות) מה לעשות השבוע
- מזהה הזדמנויות ובעיות בנתונים
- מדבר על amitphotos.com ועל עמית ארז הצלם""",
        messages=[{
            "role": "user",
            "content": f"""נתוני אנליטיקס שבועיים של amitphotos.com:

{data_summary}

ספק:
1. 2 משפטים על מה קרה השבוע (עלייה/ירידה, מה בולט)
2. 3-5 המלצות ספציפיות ומעשיות לשבוע הבא
3. הזהר מבעיה אחת שרואים בנתונים (אם יש)

כתוב בעברית, ישיר, ללא כותרות מפוצצות.""",
        }],
    )
    return msg.content[0].text.strip()


def build_html_email(data, analysis):
    """בונה HTML למייל."""
    s = data["summary"]
    p = data["prev_week"]

    def card(label, value, prev_val=""):
        d = delta_str(value, prev_val)
        color = "#27ae60" if "↑" in d else ("#e74c3c" if "↓" in d else "#888")
        badge = f' <span style="color:{color};font-size:.85em">{d}</span>' if d else ""
        return f"""<div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;margin:6px;display:inline-block;min-width:140px;text-align:center">
  <div style="font-size:1.6em;font-weight:700;color:#2c3e50">{value}{badge}</div>
  <div style="font-size:.78em;color:#888;margin-top:4px">{label}</div>
</div>"""

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

    analysis_html = analysis.replace("\n", "<br>")

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
    <div style="display:flex;flex-wrap:wrap;gap:0">
      {card("סשנים", s['sessions'], p['sessions'])}
      {card("משתמשים פעילים", s['activeUsers'], p['activeUsers'])}
      {card("צפיות", s['pageViews'], p['pageViews'])}
      {card("משתמשים חדשים", s['newUsers'])}
      {card("Bounce rate", s['bounceRate'])}
      {card("זמן ממוצע", s['avgSessionSec'] + "ש׳")}
    </div>
  </div>

  <div style="padding:0 24px 20px">
    <h2 style="color:#2c3e50;margin:0 0 10px;font-size:1em">ניתוח והמלצות — Claude</h2>
    <div style="background:#f8f9fa;border-right:4px solid #3498db;padding:14px 16px;border-radius:0 8px 8px 0;line-height:1.7;color:#333;font-size:.92em">
      {analysis_html}
    </div>
  </div>

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


def main():
    if not GA4_PROPERTY_ID:
        print("❌ חסר: GA4_PROPERTY_ID")
        sys.exit(1)
    if not GA_CREDS_JSON:
        print("❌ חסר: GA_SERVICE_ACCOUNT_JSON")
        sys.exit(1)
    if not ANTHROPIC_KEY:
        print("❌ חסר: ANTHROPIC_API_KEY")
        sys.exit(1)
    if not RESEND_KEY:
        print("❌ חסר: RESEND_API_KEY")
        sys.exit(1)

    print("🔐 מתחבר ל-Google Analytics...")
    token = get_access_token()

    print("📊 שולף נתונים מ-GA4...")
    data = fetch_ga4_data(token)
    data_summary = build_data_summary(data)
    print(data_summary)

    print("\n🤖 Claude מנתח נתונים...")
    analysis = generate_analysis(data_summary)
    print(f"\n--- ניתוח ---\n{analysis}\n")

    print("📧 שולח מייל...")
    today_str = date.today().strftime("%d.%m.%Y")
    html = build_html_email(data, analysis)
    send_email(f"📊 דוח GA שבועי — {today_str}", html)


if __name__ == "__main__":
    main()
