"""
fill_descriptions.py
--------------------
ממלא תיאורים חסרים לתמונות ב-D1 באמצעות Claude Sonnet Vision.

הרצה:
  python src/fill_descriptions.py            # ממלא עד 50 תמונות
  python src/fill_descriptions.py --all      # ממלא הכל (איטי)
  python src/fill_descriptions.py --dry-run  # רק מציג, לא שומר
"""
import os, sys, json, time
import requests
import anthropic

SITE_URL      = "https://amitphotos.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
ANTHROPIC_KEY  = os.environ.get("ANTHROPIC_API_KEY", "").strip()
BATCH_SIZE     = 200 if "--all" in sys.argv else 50
DRY_RUN        = "--dry-run" in sys.argv

def login():
    r = requests.post(f"{SITE_URL}/api/login", json={"password": ADMIN_PASSWORD}, timeout=15)
    if r.ok:
        return r.json().get("token", "")
    print(f"❌ התחברות נכשלה: {r.status_code}")
    sys.exit(1)

def generate_description(client, photo):
    img_url = photo.get("url") or photo.get("thumbnail") or ""
    if img_url.startswith("/"):
        img_url = f"{SITE_URL}{img_url}"

    category = photo.get("category", "")
    title    = photo.get("title", "")

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=120,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "url", "url": img_url}},
                {"type": "text", "text": f"""תמונת צילום של הצלם עמית ארז.
כותרת: {title}
קטגוריה: {category}

כתוב תיאור קצר בעברית — משפט אחד עד שניים (עד 120 תווים).
תאר מה רואים בתמונה בצורה ציורית ומעניינת.
החזר רק את הטקסט, ללא פיסוק מיותר."""}
            ]
        }]
    )
    return msg.content[0].text.strip().replace("\n", " ")

def main():
    sys.stdout.reconfigure(encoding="utf-8")

    if not ANTHROPIC_KEY:
        print("❌ חסר ANTHROPIC_API_KEY")
        sys.exit(1)
    if not ADMIN_PASSWORD and not DRY_RUN:
        print("❌ חסר ADMIN_PASSWORD")
        sys.exit(1)

    print("📥 טוען תמונות...")
    r = requests.get(f"{SITE_URL}/api/photos", timeout=30)
    r.raise_for_status()
    all_photos = r.json()

    to_fill = [p for p in all_photos if not (p.get("description") or "").strip()][:BATCH_SIZE]
    print(f"📋 {len(to_fill)} תמונות ללא תיאור (מתוך {len(all_photos)})")

    if not to_fill:
        print("✅ כל התמונות כבר יש להן תיאור!")
        return

    token = login() if not DRY_RUN else ""
    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

    ok, fail = 0, 0
    for i, photo in enumerate(to_fill):
        title = photo.get("title") or photo.get("id")
        print(f"[{i+1}/{len(to_fill)}] {title}...", end=" ", flush=True)

        try:
            desc = generate_description(client, photo)
            if DRY_RUN:
                print(f"\n  [dry-run] {desc}")
                ok += 1
                continue

            patch = requests.patch(
                f"{SITE_URL}/api/photos",
                json={"id": photo["id"], "title": photo.get("title",""), "category": photo.get("category",""), "description": desc},
                headers={"X-Session-Token": token},
                timeout=15,
            )
            if patch.ok:
                print(f"✓")
                ok += 1
            else:
                print(f"✗ ({patch.status_code})")
                fail += 1
        except Exception as e:
            print(f"✗ ({e})")
            fail += 1

        time.sleep(0.5)

    print(f"\n✅ הושלמו: {ok} | ✗ נכשלו: {fail}")

if __name__ == "__main__":
    main()
