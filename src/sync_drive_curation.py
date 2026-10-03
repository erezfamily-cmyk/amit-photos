"""
sync_drive_curation.py
----------------------
Synchronizes owner curation decisions with Google Drive organization.

HIDE:
  - move source image from Portfolio to a hidden folder outside Portfolio
  - remember the exact original parent so the operation is reversible

Unhide (KEEP / KEEP_SECONDARY / decision removed):
  - move the image back to its original Drive parent

This script intentionally does not permanently delete Drive files.
DELETE remains handled by the site's tombstone/archive policy.

Required env:
  GOOGLE_TOKEN_JSON
  ADMIN_PASSWORD

Optional env:
  WORKER_URL (default https://amitphotos.com)
  PORTFOLIO_FOLDER_ID
  DRIVE_HIDDEN_FOLDER_ID
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

ROOT = Path(__file__).parent.parent
STATE_FILE = ROOT / "data" / "drive-curation-state.json"
LAST_SCAN_FILE = ROOT / "data" / "last_scan.json"

WORKER_URL = os.environ.get("WORKER_URL", "https://amitphotos.com").rstrip("/")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
PORTFOLIO_FOLDER_ID = os.environ.get("PORTFOLIO_FOLDER_ID", "1LpmT9PNKjCq5kb_GReuavkJPPbeMawMW")
HIDDEN_FOLDER_ID = os.environ.get("DRIVE_HIDDEN_FOLDER_ID", "1LxJF0lQecSZ5EFxTHu0Njr616CEaOmf5")

DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
DRIVE_API = "https://www.googleapis.com/drive/v3"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_state():
    if not STATE_FILE.exists():
        return {"version": 1, "hidden": {}}
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("state must be an object")
        data.setdefault("version", 1)
        data.setdefault("hidden", {})
        return data
    except Exception as exc:
        raise RuntimeError(f"invalid {STATE_FILE}: {exc}") from exc


def save_state(state):
    STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def get_drive_session():
    raw = os.environ.get("GOOGLE_TOKEN_JSON", "").strip()
    if not raw:
        raise RuntimeError("GOOGLE_TOKEN_JSON is missing")

    info = json.loads(raw)
    creds = Credentials.from_authorized_user_info(info)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())

    # Existing production credentials were historically read-only. Do not
    # break the daily photo workflow while waiting for one-time re-authorization.
    if not creds.has_scopes([DRIVE_SCOPE]):
        scopes = set(creds.scopes or info.get("scopes") or [])
        return None, scopes

    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {creds.token}"})
    return session, set(creds.scopes or [])


def api_get(session, path, params=None):
    res = session.get(f"{DRIVE_API}/{path}", params=params, timeout=30)
    res.raise_for_status()
    return res.json()


def api_patch(session, file_id, *, add_parent, remove_parent):
    res = session.patch(
        f"{DRIVE_API}/files/{file_id}",
        params={
            "addParents": add_parent,
            "removeParents": remove_parent,
            "fields": "id,name,parents",
            "supportsAllDrives": "true",
        },
        json={},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()


def file_metadata(session, file_id):
    return api_get(
        session,
        f"files/{file_id}",
        {
            "fields": "id,name,parents,trashed",
            "supportsAllDrives": "true",
        },
    )


def parent_ids(session, folder_id):
    meta = api_get(
        session,
        f"files/{folder_id}",
        {"fields": "id,parents", "supportsAllDrives": "true"},
    )
    return meta.get("parents") or []


def is_descendant_of_portfolio(session, folder_id):
    """Walk ancestors defensively; true only when Portfolio is in the chain."""
    seen = set()
    stack = [folder_id]
    while stack:
        current = stack.pop()
        if current == PORTFOLIO_FOLDER_ID:
            return True
        if current in seen or current in ("root", ""):
            continue
        seen.add(current)
        stack.extend(parent_ids(session, current))
    return False


def fetch_decisions():
    if not ADMIN_PASSWORD:
        raise RuntimeError("ADMIN_PASSWORD is missing")
    res = requests.get(
        f"{WORKER_URL}/api/admin/curation-decisions",
        headers={"X-Admin-Password": ADMIN_PASSWORD},
        timeout=30,
    )
    res.raise_for_status()
    return res.json().get("decisions", {})


def main():
    decisions = fetch_decisions()
    state = load_state()

    session, scopes = get_drive_session()
    if session is None:
        print(
            "PENDING: Google Drive write scope is not authorized. "
            "HIDE remains applied on the website; Drive move will resume after one-time re-authorization."
        )
        print("Current scopes:", ", ".join(sorted(scopes)) or "(unknown)")
        return 0

    hidden = state["hidden"]
    changed = False
    moved = restored = skipped = 0

    # Apply new HIDE decisions.
    for photo_id, payload in decisions.items():
        if not isinstance(payload, dict) or payload.get("decision") != "HIDE":
            continue
        if photo_id in hidden:
            continue

        try:
            meta = file_metadata(session, photo_id)
        except requests.HTTPError as exc:
            print(f"WARN {photo_id}: metadata failed: {exc}")
            skipped += 1
            continue

        if meta.get("trashed"):
            print(f"WARN {photo_id}: source is trashed; skipping")
            skipped += 1
            continue

        parents = meta.get("parents") or []
        if HIDDEN_FOLDER_ID in parents:
            # Already hidden by a previous/manual operation. Without a recorded
            # original parent, do not guess where to restore it later.
            print(f"WARN {photo_id}: already in Hidden without recorded source parent; skipping state adoption")
            skipped += 1
            continue

        source_parent = None
        for parent in parents:
            try:
                if is_descendant_of_portfolio(session, parent):
                    source_parent = parent
                    break
            except requests.HTTPError:
                continue

        if not source_parent:
            print(f"SKIP {photo_id}: no verified Portfolio parent")
            skipped += 1
            continue

        result = api_patch(
            session,
            photo_id,
            add_parent=HIDDEN_FOLDER_ID,
            remove_parent=source_parent,
        )
        hidden[photo_id] = {
            "filename": result.get("name") or meta.get("name") or "",
            "source_parent_id": source_parent,
            "hidden_folder_id": HIDDEN_FOLDER_ID,
            "hidden_at": now_iso(),
        }
        changed = True
        moved += 1
        print(f"HIDE moved {photo_id}: {hidden[photo_id]['filename']}")

    # Restore anything that is no longer HIDE.
    for photo_id in list(hidden):
        payload = decisions.get(photo_id)
        if isinstance(payload, dict) and payload.get("decision") == "HIDE":
            continue

        record = hidden[photo_id]
        source_parent = record.get("source_parent_id")
        if not source_parent:
            print(f"WARN {photo_id}: cannot restore; source parent missing")
            skipped += 1
            continue

        try:
            meta = file_metadata(session, photo_id)
        except requests.HTTPError as exc:
            print(f"WARN {photo_id}: restore metadata failed: {exc}")
            skipped += 1
            continue

        parents = meta.get("parents") or []
        if HIDDEN_FOLDER_ID not in parents:
            # It may have been restored manually; only clear state when the
            # original parent is actually present.
            if source_parent in parents:
                del hidden[photo_id]
                changed = True
            else:
                print(f"WARN {photo_id}: neither Hidden nor original parent; leaving state untouched")
                skipped += 1
            continue

        api_patch(
            session,
            photo_id,
            add_parent=source_parent,
            remove_parent=HIDDEN_FOLDER_ID,
        )
        del hidden[photo_id]
        changed = True
        restored += 1
        print(f"RESTORE moved {photo_id} back to {source_parent}")

    state["last_sync_at"] = now_iso()
    state["last_summary"] = {
        "moved_to_hidden": moved,
        "restored": restored,
        "skipped": skipped,
    }
    if changed or not STATE_FILE.exists():
        save_state(state)

    # Parent moves do not reliably advance Drive modifiedTime. Force the next
    # portfolio agent run to rescan so photos.json immediately reflects both
    # HIDE removals and restored KEEP decisions.
    if moved or restored:
        LAST_SCAN_FILE.unlink(missing_ok=True)

    print(
        f"Drive curation sync complete: moved={moved}, restored={restored}, "
        f"skipped={skipped}, tracked_hidden={len(hidden)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
