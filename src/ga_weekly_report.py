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
FROM_EMAIL       = os.environ.get("FROM_EMAIL", "Amit Photos <amit@amitphotos.com>")

GA4_API_BASE = "https://analyticsdata.googleapis.com/v1beta"

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

    sr = summary_raw.get("rows", []) if summary_raw else []
    pr = prev_raw.get("rows", []) if prev_raw else []
    def s(i): return sr[0]["metricValues"][i]["value"] if sr else "0"
    def p(i): return pr[0]["metricValues"][i]["value"] if pr else "0"

    sources = parse_rows(sources_raw, ["sessions"], "מקור")
    for r in sources:
        r["מקור"] = HEBREW_CHANNELS.get(r["מקור"], r["מקור"])

    return {
        "period": f"{start} → {end}",
        "summary": {
            "sessions": s(0), "activeUsers": s(1), "pageViews": s(2),
            "bounceRate": f"{float(s(3)) * 100:.1f}%",
            "avgSessionSec": f"{float(s(4)):.0f}", "newUsers": s(5),
        },
        "prev_week": {"sessions": p(0), "activeUsers": p(1), "pageViews": p(2)},
        "top_pages": parse_rows(pages_raw, ["צפיות", "sessions"], "עמוד"),
        "sources":   sources,
        "devices":   parse_rows(devices_raw, ["sessions"], "מכשיר"),
        "countries": parse_rows(countries_raw, ["sessions"], "ארץ"),
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
        f"זמן ממוצע בסשן: {s['avgSessionSec']} שניות",
        f"משתמשים חדשים:   {s['newUsers']}",
        "", "--- עמודים הכי פופולריים ---",
    ]
    for i, r in enumerate(data["top_pages"][:8], 1):
        lines.append(f"  {i}. {r['עמוד']}  — {r['צפיות']} צפיות")
    lines += ["", "--- מקורות תנועה ---"]
    for r in data["sources"]:
        lines.append(f"  {r['מקור']}: {r['sessions']} סשנים")
    lines += ["", "--- מכשירים ---"]
    for r in data["devices"]:
        lines.append(f"  {r['מכשיר']}: {r['sessions']} סשנים")
    lines += ["", "--- ארצות ---"]
    for r in data["countries"]:
        lines.append(f"  {r['ארץ']}: {r['sessions']} סשנים")
    return "\n".join(lines)


def generate_analysis(data_summary):
    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
    msg = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=1000,
        system="""אתה יועץ SEO ושיווק דיגיטלי לאתר הצילום amitphotos.com.
אתה מנתח נתוני Google Analytics שבועיים ומציע המלצות ספציפיות ומעשיות.
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
    {card("זמן ממוצע", s['avgSessionSec'] + "ש׳")}
  </div>
  <div style="padding:0 24px 20px">
    <h2 style="color:#2c3e50;margin:0 0 10px;font-size:1em">ניתוח והמלצות — Claude</h2>
    <div style="background:#f8f9fa;border-right:4px solid #3498db;padding:14px 16px;border-radius:0 8px 8px 0;line-height:1.7;color:#333;font-size:.92em">
      {analysis.replace(chr(10), "<br>")}
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
    missing = [v for v, k in [("GA4_PROPERTY_ID", GA4_PROPERTY_ID), ("GA_REFRESH_TOKEN", GA_REFRESH_TOKEN),
                               ("GA_CLIENT_ID", GA_CLIENT_ID), ("GA_CLIENT_SECRET", GA_CLIENT_SECRET),
                               ("ANTHROPIC_API_KEY", ANTHROPIC_KEY), ("RESEND_API_KEY", RESEND_KEY)] if not k]
    if missing:
        print(f"❌ חסרים: {', '.join(missing)}")
        sys.exit(1)

    print("🔐 מתחבר ל-Google Analytics דרך Composio...")
    token = get_access_token()

    print("📊 שולף נתונים מ-GA4...")
    data = fetch_ga4_data(token)
    print(build_data_summary(data))

    print("\n🤖 Claude מנתח נתונים...")
    analysis = generate_analysis(build_data_summary(data))
    print(f"\n--- ניתוח ---\n{analysis}\n")

    print("📧 שולח מייל...")
    send_email(f"📊 דוח GA שבועי — {date.today().strftime('%d.%m.%Y')}", build_html_email(data, analysis))


if __name__ == "__main__":
    main()
