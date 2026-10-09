#!/usr/bin/env python3
"""
פוסט חד-פעמי לאינסטגרם — Acquisition Experiment 01, מסלול B2B (עיצוב קירות לחללים עסקיים).
כיתוב קבוע (לא נוצר ע"י AI) כדי לא לשנות משתנים באמצע הניסוי.
ברירת מחדל: dry-run. פרסום אמיתי רק עם CONFIRM_PUBLISH=yes.
"""
import os
import sys

import requests

import instagram_post as ip
from social_photo_map import save_social_photo_mapping

PHOTO_ID = os.environ.get("B2B_PHOTO_ID", "1m-UcZQ6_zJ0hGmzkGEmNweDBs2wr492x")  # "ספירלה של אור" (צילום מופשט), ציון ביקורת 94

CAPTION = """צילום אמנותי לקירות של חללים עסקיים 🖼️

משרדים, קליניקות, מסעדות ומלונות — אני בוחר ומתאים תמונה לחלל שלכם, בגודל ובסגנון שעובדים איתו.

יש פרויקט (קיים או עתידי)? כתבו לי בהודעה פרטית, או היכנסו לקישור בביו.

#wallart #interiordesign #officedesign #fineartphotography #israeliphotographer #photography #designinspiration"""


def main():
    r = requests.get(f"{ip.SITE_URL}/api/photos", timeout=30)
    r.raise_for_status()
    photo = next((p for p in r.json() if p["id"] == PHOTO_ID), None)
    if not photo:
        print(f"❌ התמונה {PHOTO_ID} לא נמצאה ב-API החי")
        sys.exit(1)
    print(f"📸 {photo['title']} ({photo.get('category')})\n--- כיתוב ---\n{CAPTION}\n-------------")
    if os.environ.get("CONFIRM_PUBLISH") != "yes":
        print("ℹ️ dry-run — לא פורסם. להרצה אמיתית: CONFIRM_PUBLISH=yes")
        return
    if not ip.IG_USER_ID or not ip.ACCESS_TOKEN:
        print("❌ חסרים INSTAGRAM_USER_ID / INSTAGRAM_PAGE_TOKEN")
        sys.exit(1)
    post_id = ip.post_to_instagram(photo, CAPTION)
    print(f"✅ פורסם. Instagram post ID: {post_id}")
    save_social_photo_mapping("instagram", post_id, photo["id"])


if __name__ == "__main__":
    main()
