"""
fill_titles.py
--------------
ממלא כותרות AI רק לתמונות שיש להן שם קובץ גנרי בלבד.
הרצה: python src/fill_titles.py
"""
import json, re, base64, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_FILE = ROOT / "data" / "photos.json"

def is_generic_title(title):
    if not title:
        return True
    return bool(re.match(r'^(IMG|DSC|DSCN|MJH|greece|P|PIC|photo|image)[_\-]?\S*$', title, re.IGNORECASE))

def generate_title(file_id, category):
    import anthropic, requests
    try:
        res = requests.get(f"https://drive.google.com/thumbnail?id={file_id}&sz=w600", timeout=15)
        if not res.ok:
            return None
        img_b64 = base64.standard_b64encode(res.content).decode("utf-8")
        client = anthropic.Anthropic()
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=30,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": img_b64}},
                {"type": "text", "text": (
                    f"זוהי תמונה מגלריית הצילום של הצלם עמית ארז, קטגוריה: {category}.\n"
                    "תן לתמונה כותרת קצרה ויפה בעברית — 2 עד 4 מילים בלבד.\n"
                    "החזר רק את הכותרת, ללא פיסוק נוסף."
                )},
            ]}],
        )
        return msg.content[0].text.strip().strip('"').strip("'")
    except Exception as e:
        print(f" ⚠️({e})", end="", flush=True)
        return None

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("❌ חסר ANTHROPIC_API_KEY")
        sys.exit(1)

    with open(DATA_FILE, encoding="utf-8") as f:
        photos = json.load(f)

    to_fill = [p for p in photos if is_generic_title(p.get("title", ""))]
    print(f"🔍 נמצאו {len(to_fill)} תמונות ללא כותרת")

    updated = 0
    for i, p in enumerate(to_fill):
        print(f"[{i+1}/{len(to_fill)}] {p['title']} ({p.get('category','')})...", end=" ", flush=True)
        title = generate_title(p["id"], p.get("category", ""))
        if title:
            p["title"] = title
            updated += 1
            print(f"✓ {title}")
        else:
            print("—")

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(photos, f, ensure_ascii=False, indent=2)

    print(f"\n✅ עודכנו {updated} כותרות → data/photos.json")

if __name__ == "__main__":
    main()
