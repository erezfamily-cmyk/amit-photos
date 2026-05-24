#!/usr/bin/env python3
"""
חיבור חד-פעמי של Google Analytics ל-Composio דרך REST API ישיר.
"""

import os, sys, json, time
import requests

API_BASE  = "https://backend.composio.dev/api/v1"
ENTITY_ID = "amit"

api_key = os.environ.get("COMPOSIO_API_KEY", "").strip()
if not api_key:
    api_key = input("הדבק את Composio API key שלך: ").strip()

headers = {"x-api-key": api_key, "Content-Type": "application/json"}


def initiate_connection():
    resp = requests.post(
        f"{API_BASE}/connectedAccounts",
        headers=headers,
        json={"appName": "googleanalytics", "entityId": ENTITY_ID},
        timeout=30,
    )
    if not resp.ok:
        print(f"❌ שגיאה {resp.status_code}: {resp.text[:300]}")
        sys.exit(1)
    data = resp.json()
    return data.get("connectionStatus"), data.get("redirectUrl"), data.get("id")


def check_connection(conn_id):
    resp = requests.get(f"{API_BASE}/connectedAccounts/{conn_id}", headers=headers, timeout=15)
    if not resp.ok:
        return None
    return resp.json().get("status")


status, redirect_url, conn_id = initiate_connection()
print(f"\n🔗 פתח את הקישור הזה בדפדפן ואשר גישה ל-Google Analytics:\n\n  {redirect_url}\n")
input("אחרי האישור — לחץ Enter להמשך...")

# בדוק שהחיבור הצליח
for _ in range(10):
    s = check_connection(conn_id)
    if s == "ACTIVE":
        print(f"✅ חובר בהצלחה! Connection ID: {conn_id}")
        sys.exit(0)
    print(f"  סטטוס: {s} — ממתין...")
    time.sleep(3)

print("⚠️  החיבור טרם אושר. נסה להריץ שוב.")
