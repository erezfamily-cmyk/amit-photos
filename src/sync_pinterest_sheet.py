#!/usr/bin/env python3
"""Safely reconcile posted IDs in the editorial Google Sheet with repository state.

The CSV and JSON in GitHub are authoritative for publication. This script only
sets posted=TRUE in the Sheet; it never clears a user's existing TRUE value.
"""

import csv
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
QUEUE_FILE = ROOT / "data" / "pinterest_queue.csv"
POSTED_FILE = ROOT / "data" / "pinterest_posted.json"
SPREADSHEET_ID = "1qo4DFRzL1lnp3reqDHNADpMj6C67IVSRz1uIYz9CnRc"
SHEET_NAME = "pinterest_queue.csv"
SHEETS_API = f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}"
CHECK_ONLY = "--check" in sys.argv


def plan_updates(sheet_values, queue_rows, posted_ids):
    if not sheet_values or sheet_values[0][:7] != [
        "id", "title", "category", "description", "image_url", "link", "posted"
    ]:
        raise ValueError("Sheet header changed; refusing to update cells")
    ids = [row[0] for row in sheet_values[1:] if row and row[0]]
    queue_ids = {row["id"] for row in queue_rows}
    if len(ids) != len(set(ids)) or set(ids) != queue_ids:
        raise ValueError("Sheet and repository queue IDs differ; refusing partial sync")
    updates = []
    for row_number, row in enumerate(sheet_values[1:], start=2):
        if row and row[0] in posted_ids and (len(row) < 7 or str(row[6]).upper() != "TRUE"):
            updates.append({
                "range": f"'{SHEET_NAME}'!G{row_number}",
                "values": [["TRUE"]],
            })
    return updates


def main():
    from sync_drive_curation import get_drive_session

    with QUEUE_FILE.open(encoding="utf-8-sig", newline="") as handle:
        queue_rows = list(csv.DictReader(handle))
    posted_ids = set(json.loads(POSTED_FILE.read_text(encoding="utf-8")))
    session, scopes = get_drive_session()
    if session is None:
        raise RuntimeError("Existing Google token has no Drive scope")
    response = session.get(
        f"{SHEETS_API}/values:batchGet",
        params={"ranges": f"'{SHEET_NAME}'!A1:G500"},
        timeout=30,
    )
    response.raise_for_status()
    values = response.json()["valueRanges"][0].get("values", [])
    updates = plan_updates(values, queue_rows, posted_ids)
    print(f"Sheet rows={len(values)-1}; repo rows={len(queue_rows)}; "
          f"posted IDs={len(posted_ids)}; missing TRUE updates={len(updates)}")
    if CHECK_ONLY:
        return
    if not updates:
        return
    response = session.post(
        f"{SHEETS_API}/values:batchUpdate",
        json={"valueInputOption": "RAW", "data": updates},
        timeout=30,
    )
    response.raise_for_status()
    if response.json().get("totalUpdatedCells") != len(updates):
        raise RuntimeError("Google Sheets updated an unexpected number of cells")
    print(f"Updated {len(updates)} posted flags in Google Sheet")


if __name__ == "__main__":
    main()
