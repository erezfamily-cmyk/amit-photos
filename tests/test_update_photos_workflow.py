"""
Found live (30.9.2026): a Drive photo (DSC_9287.jpg, Georgia) silently disappeared from every
import run — never in data/photos.json, never in data/copyright_flagged.json either. Root cause:
agent_photos.py writes copyright-flagged photos to data/copyright_flagged.json (so they're
excluded from future re-analysis), but update-photos.yml's commit step only ever staged
data/photos.json and sitemap.xml — the flag was written to the ephemeral CI runner's filesystem
and never persisted back to the repo. Every run since the flagging mechanism was added has been
silently losing its own state, and any newly-flagged photo gets silently dropped and re-analyzed
(wasting an API call) on every subsequent run, forever.
"""
from pathlib import Path

WORKFLOW = Path(__file__).parent.parent / ".github" / "workflows" / "update-photos.yml"


def test_copyright_flagged_json_is_committed_alongside_photos_json():
    text = WORKFLOW.read_text(encoding="utf-8")
    git_add_lines = [line for line in text.splitlines() if line.strip().startswith("git add ")]
    assert git_add_lines, "no 'git add' line found in update-photos.yml — has the commit step moved?"
    assert any("copyright_flagged.json" in line for line in git_add_lines), (
        "data/copyright_flagged.json must be committed by the same step that commits "
        "data/photos.json, or the copyright-flag state is silently lost every run"
    )


def test_change_detection_also_considers_copyright_flagged_json():
    # committing the file (above) is not enough on its own — if the only thing that changed in a
    # run is a newly-flagged photo, the "did anything change" check must still trigger the commit/
    # deploy steps, or the fix above never actually fires.
    text = WORKFLOW.read_text(encoding="utf-8")
    diff_lines = [line for line in text.splitlines() if "git diff --staged --quiet" in line]
    assert diff_lines, "no 'git diff --quiet' change-detection line found — has it moved?"
    assert any("copyright_flagged.json" in line for line in diff_lines), (
        "the changed-detection step must also watch data/copyright_flagged.json, or a run where "
        "only a new copyright flag was written will report changed=false and skip the commit"
    )


def test_update_photos_workflow_is_serialized():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "concurrency:" in text
    assert "group: update-photos-${{ github.ref }}" in text
    assert "cancel-in-progress: false" in text


def test_worker_google_secrets_sync_happens_after_deploy():
    text = WORKFLOW.read_text(encoding="utf-8")
    deploy = text.index("Deploy ל-Cloudflare")
    secret_sync = text.index("סנכרון GOOGLE_CREDENTIALS/GOOGLE_TOKEN ל-Cloudflare Worker secrets")
    assert deploy < secret_sync
    block = text[secret_sync:]
    assert "if: steps.changes.outputs.changed == 'true' || github.event_name == 'workflow_dispatch'" in block
