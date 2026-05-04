import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from teamflow_v2.claude_worker import find_claimable_task, resolve_claude_bin, run_worker_once
from teamflow_v2.controller import TeamflowController


def test_worker_does_not_run_claude_when_no_claimable_task(tmp_path):
    controller = TeamflowController(tmp_path)
    calls = []

    ran = run_worker_once(controller, runner=lambda *_args, **_kwargs: calls.append("called"))

    assert ran is False
    assert calls == []


def test_worker_detects_pending_task_records_event_and_invokes_runner(tmp_path):
    controller = TeamflowController(tmp_path)
    task = controller.store.append_task(
        title="Worker task",
        goal="Run Claude",
        scope="workspace",
        acceptance_criteria=["runner called"],
        verify_commands=[{"command": f"{sys.executable} -c \"print('ok')\"", "cwd": ".", "timeout": 5}],
        max_attempts=3,
    )
    calls = []

    def fake_runner(command, **kwargs):
        calls.append({"command": command, "kwargs": kwargs})
        return 0

    ran = run_worker_once(controller, runner=fake_runner)

    assert ran is True
    assert len(calls) == 1
    assert "claude" in calls[0]["command"][0]
    events = controller.store.task_events(task["id"])
    assert any(event["type"] == "claude_worker_task_detected" for event in events)


def test_find_claimable_task_ignores_in_progress_and_completed(tmp_path):
    controller = TeamflowController(tmp_path)
    controller.store.append_task(
        title="Claimable",
        goal="Find me",
        scope="workspace",
        acceptance_criteria=["found"],
        verify_commands=[{"command": f"{sys.executable} -c \"print('ok')\"", "cwd": ".", "timeout": 5}],
        max_attempts=3,
    )

    assert find_claimable_task(controller)["title"] == "Claimable"
    controller.get_task("claude")
    assert find_claimable_task(controller) is None


def test_worker_ignores_legacy_tasks_when_current_run_is_empty(tmp_path):
    legacy = TeamflowController(tmp_path, run_id="legacy")
    legacy.store.append_task(
        title="Legacy task",
        goal="Do not run",
        scope="legacy",
        acceptance_criteria=["ignored"],
        verify_commands=[{"command": f"{sys.executable} -c \"print('legacy')\"", "cwd": ".", "timeout": 5}],
        max_attempts=3,
    )
    current = TeamflowController(tmp_path, run_id="run-current")
    calls = []

    ran = run_worker_once(current, runner=lambda *_args, **_kwargs: calls.append("called"))

    assert ran is False
    assert calls == []


def test_worker_prefers_windows_claude_cmd(tmp_path, monkeypatch):
    fake_bin_dir = tmp_path / "bin"
    fake_bin_dir.mkdir()
    claude_cmd = fake_bin_dir / "claude.cmd"
    claude_cmd.write_text("@echo off\n", encoding="utf-8")
    monkeypatch.delenv("TEAMFLOW_CLAUDE_BIN", raising=False)
    monkeypatch.setenv("PATH", str(fake_bin_dir))

    assert resolve_claude_bin() == str(claude_cmd)
