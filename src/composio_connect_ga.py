#!/usr/bin/env python3
"""
חיבור חד-פעמי של Google Analytics ל-Composio (v3 API).
"""

import os, sys, time
import requests

API_BASE  = "https://backend.composio.dev/api/v3"
ENTITY_ID = "amit"

api_key = os.environ.get("COMPOSIO_API_KEY", "").strip()
if not api_key:
    api_key = input("הדבק את Composio API key שלך: ").strip()

headers = {"x-api-key": api_key, "Content-Type": "application/json"}


def get_integration_id():
    """מוצא את ה-integrationId של Google Analytics."""
    resp = requests.get(
        f"{API_BASE}/integrations",
        headers=headers,
        params={"appName": "googleanalytics", "limit": 5},
        timeout=15,
    )
    if not resp.ok:
        print(f"❌ שגיאה {resp.status_code}: {resp.text[:300]}")
        sys.exit(1)
    items = resp.json().get("items", [])
    if not items:
        print("❌ לא נמצאה אינטגרציה של Google Analytics — ייתכן שצריך להוסיף אותה ב-Composio Dashboard")
        sys.exit(1)
    return items[0]["id"]


def initiate_connection(integration_id):
    resp = requests.post(
        f"{API_BASE}/connectedAccounts",
        headers=headers,
        json={
            "integrationId": integration_id,
            "entityId": ENTITY_ID,
            "data": {},
        },
        timeout=30,
    )
    if not resp.ok:
        print(f"❌ שגיאה {resp.status_code}: {resp.text[:300]}")
        sys.exit(1)
    data = resp.json()
    return data.get("id"), data.get("redirectUrl") or data.get("redirectUri")


def check_status(conn_id):
    resp = requests.get(f"{API_BASE}/connectedAccounts/{conn_id}", headers=headers, timeout=15)
    if not resp.ok:
        return None
    return resp.json().get("status")


print("🔍 מחפש אינטגרציה של Google Analytics...")
integration_id = get_integration_id()
print(f"✅ נמצאה integration: {integration_id}")

print("🔗 יוצר חיבור...")
conn_id, redirect_url = initiate_connection(integration_id)

if redirect_url:
    print(f"\n🔗 פתח את הקישור הזה בדפדפן ואשר גישה ל-Google Analytics:\n\n  {redirect_url}\n")
    input("אחרי האישור — לחץ Enter להמשך...")
else:
    print(f"⚠️  לא התקבל redirect URL. conn_id: {conn_id}")

for i in range(12):
    s = check_status(conn_id)
    if s == "ACTIVE":
        print(f"✅ חובר בהצלחה! Connection ID: {conn_id}")
        sys.exit(0)
    print(f"  [{i+1}/12] סטטוס: {s} — ממתין 3 שניות...")
    time.sleep(3)

print("⚠️  החיבור טרם אושר. נסה להריץ שוב.")
