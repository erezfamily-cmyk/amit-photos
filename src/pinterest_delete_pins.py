#!/usr/bin/env python3
"""מוצא ומוחק פינים ספציפיים מ-Pinterest לפי מילות מפתח בכותרת."""

import os, sys, requests, time

TOKEN = os.environ.get("PINTEREST_ACCESS_TOKEN", "").strip()
if not TOKEN:
    print("❌ חסר PINTEREST_ACCESS_TOKEN")
    sys.exit(1)

API = "https://api.pinterest.com/v5"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
KEYWORDS = ["מקדונלד", "happy", "golden arches"]

def get_all_boards():
    boards = []
    bookmark = None
    while True:
        params = {"page_size": 100}
        if bookmark:
            params["bookmark"] = bookmark
        r = requests.get(f"{API}/boards", headers=HEADERS, params=params, timeout=15)
        data = r.json()
        print(f"  boards response: {data}")
        items = data.get("items", [])
        boards.extend(items)
        bookmark = data.get("bookmark")
        if not bookmark or not items:
            break
    return boards

def get_pins_for_board(board_id):
    pins = []
    bookmark = None
    while True:
        params = {"page_size": 100}
        if bookmark:
            params["bookmark"] = bookmark
        r = requests.get(f"{API}/boards/{board_id}/pins", headers=HEADERS, params=params, timeout=15)
        data = r.json()
        items = data.get("items", [])
        pins.extend(items)
        bookmark = data.get("bookmark")
        if not bookmark or not items:
            break
    return pins

def get_user_pins():
    pins = []
    bookmark = None
    while True:
        params = {"page_size": 100}
        if bookmark:
            params["bookmark"] = bookmark
        r = requests.get(f"{API}/pins", headers=HEADERS, params=params, timeout=15)
        data = r.json()
        print(f"  /pins response (first 200 chars): {str(data)[:200]}")
        items = data.get("items", [])
        pins.extend(items)
        bookmark = data.get("bookmark")
        if not bookmark or not items:
            break
    return pins

def is_target(pin):
    title = (pin.get("title") or "").lower()
    desc = (pin.get("description") or "").lower()
    text = title + " " + desc
    return any(k in text for k in KEYWORDS)

def delete_pin(pin_id):
    r = requests.delete(f"{API}/pins/{pin_id}", headers=HEADERS, timeout=15)
    return r.status_code == 204

print("🔍 מחפש לוחות...")
boards = get_all_boards()
print(f"📋 נמצאו {len(boards)} לוחות")

all_pins = []

for board in boards:
    print(f"  📌 {board['name']} ({board['id']})")
    pins = get_pins_for_board(board["id"])
    all_pins.extend(pins)
    print(f"     → {len(pins)} פינים")

# גם פינים ישירים של המשתמש
print("\n🔍 מחפש פינים ישירים...")
user_pins = get_user_pins()
for p in user_pins:
    if p not in all_pins:
        all_pins.append(p)

print(f"\n📌 סה\"כ פינים: {len(all_pins)}")

targets = [p for p in all_pins if is_target(p)]
print(f"\n🎯 פינים למחיקה: {len(targets)}")
for p in targets:
    print(f"  • [{p['id']}] {p.get('title','')}")

if not targets:
    print("✅ לא נמצאו פינים למחיקה")
    sys.exit(0)

deleted = 0
for p in targets:
    pid = p["id"]
    title = p.get("title", "")
    ok = delete_pin(pid)
    if ok:
        print(f"  ✅ נמחק: {title} ({pid})")
        deleted += 1
    else:
        print(f"  ❌ שגיאה במחיקת: {title} ({pid})")
    time.sleep(0.5)

print(f"\n{'✅' if deleted == len(targets) else '⚠️'} נמחקו {deleted}/{len(targets)} פינים")
