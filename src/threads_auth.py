#!/usr/bin/env python3
"""
threads_auth.py
---------------
קבלת THREADS_USER_ID + THREADS_ACCESS_TOKEN ושמירתם כ-GitHub Secrets.

הרצה:
  python src/threads_auth.py
"""

import sys
import webbrowser
import requests

APP_ID     = "1497426498458643"  # Threads app ID (מה-Threads section ב-App Settings)
APP_SECRET = input("Threads app secret (לחץ Show ליד 'Threads app secret'): ").strip()

REDIRECT_URI = "https://localhost"
SCOPE = "threads_basic,threads_content_publish,threads_read_engagement"

auth_url = (
    f"https://www.threads.net/oauth/authorize"
    f"?client_id={APP_ID}"
    f"&redirect_uri={REDIRECT_URI}"
    f"&scope={SCOPE}"
    f"&response_type=code"
)

print(f"\n🌐 פותח דפדפן לאישור Threads...\n{auth_url}\n")
webbrowser.open(auth_url)

print("אחרי האישור הדפדפן ינסה לפתוח https://localhost?code=XXXX (יכשל — זה בסדר).")
redirect = input("הדבק כאן את ה-URL המלא מסרגל הכתובות: ").strip()

# Extract code
if "code=" not in redirect:
    print("❌ לא נמצא code ב-URL")
    sys.exit(1)
code = redirect.split("code=")[1].split("&")[0]
print(f"✓ code: {code[:20]}...")

# Exchange code for short-lived token
r = requests.post("https://graph.threads.net/oauth/access_token", data={
    "client_id":     APP_ID,
    "client_secret": APP_SECRET,
    "grant_type":    "authorization_code",
    "redirect_uri":  REDIRECT_URI,
    "code":          code,
})
if not r.ok:
    print(f"❌ שגיאה בהחלפת קוד: {r.text}")
    sys.exit(1)

data = r.json()
short_token = data.get("access_token", "")
user_id     = str(data.get("user_id", ""))

if not short_token:
    print(f"❌ לא התקבל access_token: {data}")
    sys.exit(1)

print(f"✓ User ID: {user_id}")
print(f"✓ Short-lived token: {short_token[:30]}...")

# Exchange for long-lived token (60 days)
r2 = requests.get("https://graph.threads.net/access_token", params={
    "grant_type":        "th_exchange_token",
    "client_secret":     APP_SECRET,
    "access_token":      short_token,
})
if not r2.ok:
    print(f"⚠️  לא הצלחתי לקבל long-lived token ({r2.text}) — משתמש ב-short-lived")
    long_token = short_token
else:
    long_token = r2.json().get("access_token", short_token)
    expires    = r2.json().get("expires_in", 0)
    print(f"✓ Long-lived token ({expires // 86400} ימים): {long_token[:30]}...")

# Verify token works
r3 = requests.get(f"https://graph.threads.net/v1.0/{user_id}", params={
    "fields": "id,username,name",
    "access_token": long_token,
})
if r3.ok:
    profile = r3.json()
    print(f"\n✅ חשבון: @{profile.get('username', '')} ({profile.get('name', '')})")
else:
    print(f"⚠️  אימות חשבון נכשל: {r3.text}")

# Save to GitHub secrets
print("\n💾 שומר ב-GitHub Secrets...")
try:
    import subprocess
    subprocess.run(["gh", "secret", "set", "THREADS_USER_ID",   "--body", user_id],    check=True)
    subprocess.run(["gh", "secret", "set", "THREADS_ACCESS_TOKEN", "--body", long_token], check=True)
    print("✅ THREADS_USER_ID ו-THREADS_ACCESS_TOKEN נשמרו ב-GitHub!")
except Exception as e:
    print(f"⚠️  לא הצלחתי לשמור אוטומטית ({e})")
    print(f"\nבצע ידנית:\ngh secret set THREADS_USER_ID --body \"{user_id}\"")
    print(f"gh secret set THREADS_ACCESS_TOKEN --body \"{long_token}\"")

print("\n🎉 הכל מוכן — הוורקפלו יפעל בשני/חמישי ב-18:00 ישראל.")
