#!/usr/bin/env python3
"""Check that the admin social calendar matches active GitHub Actions crons."""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEDULE_FILE = ROOT / "data" / "social_schedule.json"
WORKFLOWS_DIR = ROOT / ".github" / "workflows"
REQUIRED_WORKFLOWS = {
    "instagram-story.yml",
    "pinterest-daily.yml",
    "instagram-post.yml",
    "threads-post.yml",
    "camera-edu-post.yml",
    "location-social-post.yml",
    "redbubble-social-post.yml",
    "zazzle-social-post.yml",
    "youtube-post.yml",
    "youtube-tutorial.yml",
    "facebook-post.yml",
    "week-photo-social.yml",
    "puzzle-social-post.yml",
    "quiz-social-post.yml",
}


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


def cron_occurrences(cron):
    """Expand the simple fixed-time weekly crons used by social publishers."""
    parts = cron.split()
    if len(parts) != 5:
        raise ValueError(f"unsupported cron: {cron!r}")
    minute, hour, day_of_month, month, day_of_week = parts
    if day_of_month != "*" or month != "*" or not minute.isdigit() or not hour.isdigit():
        raise ValueError(f"social cron must use a fixed UTC time and weekly cadence: {cron!r}")
    days = range(7) if day_of_week == "*" else [int(day) % 7 for day in day_of_week.split(",")]
    return [(day, int(hour) * 60 + int(minute)) for day in days]


def validate_pacing(schedule):
    policies = schedule.get("policies", {})
    daily_limits = policies.get("daily_limits", {})
    minimum_gaps = policies.get("minimum_gap_hours", {})
    events = []
    errors = []

    for item in schedule.get("items", []):
        if item.get("status") != "מתוזמן":
            continue
        channels = item.get("channels")
        counts = item.get("posts_per_run")
        if not isinstance(channels, list) or not channels:
            errors.append(f"{item.get('workflow')}: scheduled item is missing channels")
            continue
        if not isinstance(counts, dict):
            errors.append(f"{item.get('workflow')}: scheduled item is missing posts_per_run")
            continue
        for cron in item.get("cron", []):
            try:
                occurrences = cron_occurrences(cron)
            except ValueError as error:
                errors.append(str(error))
                continue
            for day, minute in occurrences:
                for channel in channels:
                    count = counts.get(channel)
                    if not isinstance(count, int) or count < 1:
                        errors.append(f"{item.get('workflow')}: invalid post count for {channel}")
                        continue
                    events.append((channel, day, minute, count, item.get("workflow")))

    for channel, limit in daily_limits.items():
        for day in range(7):
            day_events = [event for event in events if event[0] == channel and event[1] == day]
            total = sum(event[3] for event in day_events)
            if total > limit:
                workflows = ", ".join(event[4] for event in day_events)
                errors.append(f"{channel} day {day}: {total} posts exceed daily limit {limit} ({workflows})")

    for channel, gap_hours in minimum_gaps.items():
        channel_events = sorted(
            (day * 1440 + minute, workflow)
            for event_channel, day, minute, _count, workflow in events
            if event_channel == channel
        )
        if len(channel_events) < 2:
            continue
        wrapped = channel_events + [(channel_events[0][0] + 7 * 1440, channel_events[0][1])]
        for (left_time, left_workflow), (right_time, right_workflow) in zip(wrapped, wrapped[1:]):
            gap_minutes = right_time - left_time
            if gap_minutes < gap_hours * 60:
                errors.append(
                    f"{channel}: {left_workflow} and {right_workflow} are only "
                    f"{gap_minutes / 60:g}h apart; minimum is {gap_hours}h"
                )
    return errors


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

    missing = REQUIRED_WORKFLOWS - seen
    if missing:
        errors.append(f"calendar is missing publishing workflows: {', '.join(sorted(missing))}")
    errors.extend(validate_pacing(schedule))

    if errors:
        print("Social schedule mismatch:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Social schedule and pacing match {len(seen)} GitHub Actions workflows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
