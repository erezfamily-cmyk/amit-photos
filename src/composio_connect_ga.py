#!/usr/bin/env python3
"""
חיבור חד-פעמי של Google Analytics ל-Composio.
הרץ פעם אחת מהמחשב שלך:
  pip install composio-core
  COMPOSIO_API_KEY=your_key python src/composio_connect_ga.py
"""

import os, sys
from composio import ComposioToolSet, App

COMPOSIO_API_KEY = os.environ.get("COMPOSIO_API_KEY", "")
ENTITY_ID        = os.environ.get("COMPOSIO_ENTITY_ID", "amit")

if not COMPOSIO_API_KEY:
    print("❌ חסר: COMPOSIO_API_KEY")
    sys.exit(1)

toolset = ComposioToolSet(api_key=COMPOSIO_API_KEY)
entity  = toolset.get_entity(ENTITY_ID)

print(f"🔗 מחבר Google Analytics לentity '{ENTITY_ID}'...")
request = entity.initiate_connection(app=App.GOOGLEANALYTICS)
print(f"\n✅ פתח את הקישור הזה בדפדפן ואשר את הגישה:\n\n  {request.redirectUrl}\n")
print("אחרי האישור — לחץ Enter להמשך...")
input()

# בדוק שהחיבור הצליח
try:
    conn = entity.get_connection(app=App.GOOGLEANALYTICS)
    print(f"✅ חובר בהצלחה! Connection ID: {conn.id}")
except Exception as e:
    print(f"⚠️  בדוק שאישרת גישה בדפדפן: {e}")
