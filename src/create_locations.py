"""
יוצר 7 מקומות חדשים דרך admin API.
הרצה: python src/create_locations.py
"""
import urllib.request, urllib.parse, json, time

BASE = "https://amitphotos.com"
HEADERS = {"X-Admin-Password": "Hadas2409", "Content-Type": "application/json"}

LOCATIONS = [
    {"title": "מסגד שייח זאיד, אבו דאבי", "region": "חו\"ל — אמירויות"},
    {"title": "הדולומיטים, איטליה",         "region": "חו\"ל — איטליה"},
    {"title": "ספארי טנזניה",               "region": "חו\"ל — אפריקה"},
    {"title": "מנזרי מטאורה, יוון",          "region": "חו\"ל — יוון"},
    {"title": "כנרת",                        "region": "צפון"},
    {"title": "הר חרמון בשלג",              "region": "צפון"},
    {"title": "גנים בהאי, חיפה",            "region": "צפון"},
]

for loc in LOCATIONS:
    body = json.dumps(loc).encode()
    req = urllib.request.Request(f"{BASE}/api/admin/locations", data=body,
        headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read())
            print(f"OK {d['title']} slug={d['id']} wt={bool(d.get('when_to_visit'))}")
    except Exception as e:
        print(f"ERR {loc['title']}: {e}")
    time.sleep(4)
