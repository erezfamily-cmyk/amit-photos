from pathlib import Path
import subprocess
import os

SCRIPT = Path(__file__).parent.parent / "scripts" / "push_generated_changes.sh"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout.strip()


def repositories(tmp_path):
    remote = tmp_path / "remote.git"
    git(tmp_path, "init", "--bare", "--initial-branch=main", str(remote))
    first = tmp_path / "first"
    git(tmp_path, "clone", str(remote), str(first))
    git(first, "config", "user.name", "Test")
    git(first, "config", "user.email", "test@example.invalid")
    (first / "state.json").write_text('baseline\n')
    git(first, "add", "state.json")
    git(first, "commit", "-m", "baseline")
    git(first, "push", "origin", "main")
    second = tmp_path / "second"
    git(tmp_path, "clone", str(remote), str(second))
    git(second, "config", "user.name", "Test")
    git(second, "config", "user.email", "test@example.invalid")
    return remote, first, second


def commit(cwd, path, content):
    (cwd / path).write_text(content)
    git(cwd, "add", path)
    git(cwd, "commit", "-m", "generated change")


def test_push_rebases_unrelated_remote_commit_without_losing_either(tmp_path):
    remote, first, second = repositories(tmp_path)
    commit(first, "state.json", "restored\n")
    commit(second, "other.json", "other workflow\n")
    git(second, "push", "origin", "main")
    result = subprocess.run(["bash", str(SCRIPT)], cwd=first, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert git(tmp_path, "--git-dir", str(remote), "show", "main:state.json") == "restored"
    assert git(tmp_path, "--git-dir", str(remote), "show", "main:other.json") == "other workflow"


def test_push_conflict_fails_and_preserves_remote_and_local_state(tmp_path):
    remote, first, second = repositories(tmp_path)
    commit(first, "state.json", "local restoration\n")
    local_sha = git(first, "rev-parse", "HEAD")
    commit(second, "state.json", "new remote decision\n")
    git(second, "push", "origin", "main")
    remote_sha = git(second, "rev-parse", "HEAD")
    result = subprocess.run(["bash", str(SCRIPT)], cwd=first, capture_output=True, text=True)
    assert result.returncode != 0
    assert "refusing to overwrite" in result.stderr
    assert git(first, "rev-parse", "HEAD") == local_sha
    assert git(tmp_path, "--git-dir", str(remote), "rev-parse", "main") == remote_sha
    assert (first / "state.json").read_text() == "local restoration\n"
    assert not (first / ".git" / "rebase-merge").exists()


def test_repeated_push_rejection_exits_failure_after_five_attempts(tmp_path):
    remote, first, _ = repositories(tmp_path)
    before = git(tmp_path, "--git-dir", str(remote), "rev-parse", "main")
    commit(first, "state.json", "local restoration\n")
    attempts = tmp_path / "attempts"
    hook = remote / "hooks" / "pre-receive"
    hook.write_text(f'#!/bin/sh\necho rejected >> "{attempts}"\nexit 1\n')
    hook.chmod(0o755)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    sleep = bin_dir / "sleep"
    sleep.write_text('#!/bin/sh\nexit 0\n')
    sleep.chmod(0o755)
    env = {**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"]}
    result = subprocess.run(["bash", str(SCRIPT)], cwd=first, env=env,
                            capture_output=True, text=True)
    assert result.returncode != 0
    assert "after five push attempts" in result.stderr
    assert len(attempts.read_text().splitlines()) == 5
    assert git(tmp_path, "--git-dir", str(remote), "rev-parse", "main") == before
