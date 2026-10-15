#!/usr/bin/env python3
"""Check that the admin social calendar matches active GitHub Actions crons."""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEDULE_FILE = ROOT / "data" / "social_schedule.json"
WORKFLOWS_DIR = ROOT / ".github" / "workflows"


def workflow_crons(path):
    lines = path.read_text(encoding="utf-8").splitlines()
    in_schedule = False
    crons = []
    for line in lines:
        if line == "  schedule:":
            in_schedule = True
            continue
        if in_schedule and line.strip() and not line.startswith("    "):
            break
        if in_schedule:
            match = re.match(r"^    - cron:\s*['\"](.+?)['\"]\s*$", line)
            if match:
                crons.append(match.group(1))
    return crons


def main():
    schedule = json.loads(SCHEDULE_FILE.read_text(encoding="utf-8"))
    errors = []
    seen = set()
    for item in schedule.get("items", []):
        workflow = item.get("workflow", "")
        if not workflow or workflow in seen:
            errors.append(f"missing or duplicate workflow entry: {workflow!r}")
            continue
        seen.add(workflow)
        path = WORKFLOWS_DIR / workflow
        if not path.is_file():
            errors.append(f"workflow not found: {workflow}")
            continue
        expected = item.get("cron", [])
        if not isinstance(expected, list):
            errors.append(f"cron must be a list: {workflow}")
            continue
        actual = workflow_crons(path)
        if actual != expected:
            errors.append(f"{workflow}: calendar says {expected!r}, workflow has {actual!r}")

    if errors:
        print("Social schedule mismatch:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Social schedule matches {len(seen)} GitHub Actions workflows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
