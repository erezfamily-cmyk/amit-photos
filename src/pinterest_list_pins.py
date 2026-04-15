#!/usr/bin/env python3
"""מציג את כל הפינים והלוחות בחשבון Pinterest."""

import os, sys, requests

TOKEN = os.environ.get("PINTEREST_ACCESS_TOKEN", "").strip()
if not TOKEN:
    print("❌ חסר PINTEREST_ACCESS_TOKEN")
    sys.exit(1)

API = "https://api.pinterest.com/v5"

# לוחות
boards = requests.get(f"{API}/boards", headers={"Authorization": f"Bearer {TOKEN}"}, params={"page_size": 100}, timeout=15).json()
print(f"\n📋 לוחות ({len(boards.get('items', []))}):")
for b in boards.get("items", []):
    print(f"  • {b['name']} (ID: {b['id']})")

# פינים
pins = requests.get(f"{API}/pins", headers={"Authorization": f"Bearer {TOKEN}"}, params={"page_size": 25}, timeout=15).json()
print(f"\n📌 פינים אחרונים ({len(pins.get('items', []))}):")
for p in pins.get("items", []):
    print(f"  • {p.get('title','(ללא כותרת)')} — https://pinterest.com/pin/{p['id']}")
