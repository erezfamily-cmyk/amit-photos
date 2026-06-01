#!/usr/bin/env python3
"""
Generate English translations for photo_analyses rows.
Reads each analysis from Cloudflare D1 via the Worker API,
calls Claude to produce English versions, then writes them back.

Usage:
  python src/generate_analyses_en.py
"""

import json
import os
import sys
import time
import requests
import anthropic

WORKER_URL = "https://amitphotos.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
CLAUDE_MODEL = "claude-haiku-4-5-20251001"

client = anthropic.Anthropic()


def get_analyses():
    resp = requests.get(
        f"{WORKER_URL}/api/analyses",
        headers={"X-Admin-Password": ADMIN_PASSWORD},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def patch_analysis(photo_id, title_en, composition_html_en, camera_json_en):
    resp = requests.put(
        f"{WORKER_URL}/api/analyses/{photo_id}",
        headers={
            "X-Admin-Password": ADMIN_PASSWORD,
            "Content-Type": "application/json",
        },
        json={
            "title_en": title_en,
            "composition_html_en": composition_html_en,
            "camera_json_en": json.dumps(camera_json_en),
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


SYSTEM_PROMPT = """You are a photography educator translating Hebrew photo analysis content into English.
Produce clean, natural English — do not translate literally word-for-word.
Keep all HTML tags intact (only translate the text inside them).
Return a JSON object with exactly these keys: title_en, composition_html_en, camera_json_en.
camera_json_en has the same structure as camera_json but with English explanations."""

def translate_analysis(row):
    camera_json = row.get("camera_json") or "{}"
    composition_html = row.get("composition_html") or ""
    title_he = row.get("title") or ""

    user_msg = f"""Translate the following Hebrew photo analysis content into English.

Title (Hebrew): {title_he}

Composition HTML (Hebrew):
{composition_html}

Camera JSON (Hebrew explanations):
{camera_json}

Return a JSON object with keys: title_en (string), composition_html_en (HTML string), camera_json_en (object with same structure as camera JSON but English explanations).
Return ONLY valid JSON, no markdown fences."""

    msg = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )
    raw = msg.content[0].text.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]
    return json.loads(raw)


def main():
    if not ADMIN_PASSWORD:
        print("ERROR: set ADMIN_PASSWORD env variable")
        sys.exit(1)

    analyses = get_analyses()
    print(f"Found {len(analyses)} analyses")

    for row in analyses:
        photo_id = row.get("photo_id") or row.get("id")
        if not photo_id:
            continue

        # Skip if already translated
        if row.get("title_en"):
            print(f"  SKIP {photo_id} — already has title_en")
            continue

        print(f"  Translating {photo_id}: {row.get('title', '')[:50]}")
        try:
            result = translate_analysis(row)
            patch_analysis(
                photo_id,
                result["title_en"],
                result["composition_html_en"],
                result["camera_json_en"],
            )
            print(f"    -> {result['title_en'][:60]}")
        except Exception as e:
            print(f"    ERROR: {e}")

        time.sleep(1)  # Rate-limit courtesy

    print("Done.")


if __name__ == "__main__":
    main()
