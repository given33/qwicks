import json
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from teamflow_v2.controller import TeamflowController
from teamflow_v2.mimo import ReviewDecision


def atomic_tasks(count=5):
    return [
        {
            "title": f"Task {index}",
            "goal": f"Implement slice {index}",
            "scope": f"Only slice {index}",
            "acceptanceCriteria": [f"slice {index} is verified"],
            "verifyCommands": [
                {
                    "command": f"{sys.executable} -c \"print('ok-{index}')\"",
                    "cwd": ".",
                    "timeout": 5,
                }
            ],
        }
        for index in range(1, count + 1)
    ]


def test_plan_tasks_writes_sqlite_and_exports_tasks_json(tmp_path):
    controller = TeamflowController(tmp_path)

    result = controller.plan_tasks("Build V2", atomic_tasks())

    assert result["status"] == "ok"
    snapshot = json.loads((tmp_path / "runtime" / "tasks.json").read_text(encoding="utf-8"))
    assert snapshot["projectGoal"] == "Build V2"
    assert len(snapshot["tasks"]) == 5
    assert snapshot["tasks"][0]["status"] == "PENDING"

    with sqlite3.connect(tmp_path / "runtime" / "teamflow.sqlite3") as conn:
        count = conn.execute("select count(*) from tasks").fetchone()[0]
    assert count == 5


def test_status_and_tasks_json_filter_to_current_run(tmp_path):
    legacy = TeamflowController(tmp_path, run_id="legacy")
    legacy.store.append_task(
        title="Old leftover task",
        goal="Should stay historical",
        scope="legacy",
        acceptance_criteria=["hidden from current run"],
        verify_commands=[{"command": f"{sys.executable} -c \"print('legacy')\"", "cwd": ".", "timeout": 5}],
        max_attempts=3,
    )

    current = TeamflowController(tmp_path, run_id="run-current")
    task = current.store.append_task(
        title="Current run task",
        goal="Visible now",
        scope="current",
        acceptance_criteria=["visible"],
        verify_commands=[{"command": f"{sys.executable} -c \"print('current')\"", "cwd": ".", "timeout": 5}],
        max_attempts=3,
    )

    status = current.get_status()
    snapshot = json.loads((tmp_path / "runtime" / "tasks.json").read_text(encoding="utf-8"))

    assert status["currentRunId"] == "run-current"
    assert [item["title"] for item in status["tasks"]] == ["Current run task"]
    assert task["id"] == "task-001"
    assert snapshot["currentRunId"] == "run-current"
    assert [item["title"] for item in snapshot["tasks"]] == ["Current run task"]


def test_plan_tasks_requires_five_to_eight_atomic_tasks(tmp_path):
    controller = TeamflowController(tmp_path)

    with pytest.raises(ValueError, match="5-8"):
        controller.plan_tasks("Too small", atomic_tasks(4))


def test_get_task_claims_each_pending_task_once_under_concurrency(tmp_path):
    controller = TeamflowController(tmp_path)
    controller.plan_tasks("Build V2", atomic_tasks())

    with ThreadPoolExecutor(max_workers=8) as pool:
        claimed = list(pool.map(lambda _: controller.get_task("claude"), range(8)))

    task_ids = [item["task"]["id"] for item in claimed if item["task"]]
    assert task_ids == ["task-001"]
    assert claimed.count({"task": None, "message": "no pending task"}) == 7


def test_submit_review_local_failure_rejects_without_mimo_call(tmp_path):
    controller = TeamflowController(tmp_path)
    tasks = atomic_tasks()
    tasks[0]["verifyCommands"] = [
        {"command": f"{sys.executable} -c \"import sys; sys.exit(7)\"", "cwd": ".", "timeout": 5}
    ]
    controller.plan_tasks("Build V2", tasks)
    task = controller.get_task("claude")["task"]

    class Reviewer:
        calls = 0

        def review(self, *_args, **_kwargs):
            self.calls += 1
            return ReviewDecision(status="PASS", summary="ok", suggestions=[])

    reviewer = Reviewer()
    result = controller.submit_review(
        task["id"],
        summary="finished",
        changed_files=["demo.py"],
        commands_run=["manual check"],
        reviewer=reviewer,
    )

    assert result["status"] == "LOCAL_FAILED"
    assert reviewer.calls == 0
    assert "exit code 7" in result["localVerification"]["summary"]


def test_submit_review_pass_and_reject_follow_mimo_decision(tmp_path):
    controller = TeamflowController(tmp_path)
    controller.plan_tasks("Build V2", atomic_tasks())
    first = controller.get_task("claude")["task"]
    assert controller.get_task("claude")["task"] is None

    class PassReviewer:
        def review(self, *_args, **_kwargs):
            return ReviewDecision(status="PASS", summary="looks aligned", suggestions=[])

    class RejectReviewer:
        def review(self, *_args, **_kwargs):
            return ReviewDecision(status="REJECT", summary="scope drift", suggestions=["stay in scope"])

    passed = controller.submit_review(first["id"], "done", [], [], reviewer=PassReviewer())
    second = controller.get_task("claude")["task"]
    rejected = controller.submit_review(second["id"], "done", [], [], reviewer=RejectReviewer())

    assert passed["status"] == "COMPLETED"
    assert rejected["status"] == "MIMO_REJECTED"
    assert rejected["mimo"]["suggestions"] == ["stay in scope"]


def test_submit_review_degrades_after_mimo_retries_are_exhausted(tmp_path):
    controller = TeamflowController(tmp_path, mimo_max_retries=2)
    controller.plan_tasks("Build V2", atomic_tasks())
    task = controller.get_task("claude")["task"]

    class FailingReviewer:
        calls = 0

        def review(self, *_args, **_kwargs):
            self.calls += 1
            raise RuntimeError("mimo timeout")

    reviewer = FailingReviewer()
    result = controller.submit_review(task["id"], "done", [], [], reviewer=reviewer)

    assert result["status"] == "DEGRADED_PASS"
    assert reviewer.calls == 2
    assert result["mimo"]["error"] == "mimo timeout"
    status = controller.get_status()
    assert status["workflowMetrics"]["completedTasks"] == 0
    assert status["workflowMetrics"]["exceptionTasks"] == 1
    assert status["progressPercent"] == 0
    assert controller.get_task("claude")["task"] is None


def test_status_reports_progress_and_recent_review_events(tmp_path):
    controller = TeamflowController(tmp_path)
    controller.plan_tasks("Build V2", atomic_tasks())
    task = controller.get_task("claude")["task"]

    status = controller.get_status()

    assert status["counts"]["total"] == 5
    assert status["counts"]["IN_PROGRESS"] == 1
    assert status["progressPercent"] == 0
    assert status["workflowMetrics"]["totalTasks"] == 5
    assert status["workflowMetrics"]["completedTasks"] == 0
    assert len(status["dashboardPipeline"]["pending"]) == 5
    assert status["dashboardPipeline"]["developing"][0]["id"] == task["id"]
    assert status["currentTask"]["id"] == task["id"]
    assert status["events"][-1]["type"] == "task_claimed"


def test_sqlite_connection_uses_wal_and_normal_synchronous(tmp_path):
    controller = TeamflowController(tmp_path)

    with controller.store.connect() as conn:
        journal_mode = conn.execute("pragma journal_mode").fetchone()[0]
        synchronous = conn.execute("pragma synchronous").fetchone()[0]
        indexes = {row["name"] for row in conn.execute("pragma index_list(tasks)").fetchall()}

    assert journal_mode.lower() == "wal"
    assert synchronous == 1
    assert "idx_tasks_status_id" in indexes


def test_delegate_task_and_wait_returns_completed_with_affected_files(tmp_path):
    controller = TeamflowController(tmp_path)
    result_holder = {}

    def delegate():
        result_holder["result"] = controller.delegate_task_and_wait(
            title="Create auth module",
            goal="Implement auth",
            scope="auth.py only",
            acceptance_criteria=["auth works"],
            verify_commands=[{"command": f"{sys.executable} -c \"print('ok')\"", "cwd": ".", "timeout": 5}],
            timeout_seconds=5,
            poll_seconds=0.05,
        )

    thread = threading.Thread(target=delegate)
    thread.start()
    wait_for(lambda: controller.get_status()["counts"]["PENDING"] == 1)
    task = controller.get_task("claude")["task"]

    class PassReviewer:
        def review(self, *_args, **_kwargs):
            return ReviewDecision(status="PASS", summary="aligned", suggestions=[])

    controller.submit_review(task["id"], "implemented auth", ["auth.py"], ["pytest"], reviewer=PassReviewer())
    thread.join(timeout=5)

    result = result_holder["result"]
    assert result["status"] == "COMPLETED"
    assert result["taskId"] == task["id"]
    assert result["affectedFiles"] == ["auth.py"]
    assert result["commandsRun"] == ["pytest"]
    assert "成功完成" in result["message"]


def test_delegate_task_and_wait_timeout_does_not_modify_task_status(tmp_path):
    controller = TeamflowController(tmp_path)

    result = controller.delegate_task_and_wait(
        title="Slow task",
        goal="Wait",
        scope="workspace",
        acceptance_criteria=["done"],
        verify_commands=[{"command": f"{sys.executable} -c \"print('ok')\"", "cwd": ".", "timeout": 5}],
        timeout_seconds=0.05,
        poll_seconds=0.01,
    )

    assert result["status"] == "TIMEOUT"
    assert controller.store.get_task(result["taskId"])["status"] == "PENDING"


def test_cancelled_task_rejects_submit_review_without_verification_or_mimo(tmp_path):
    controller = TeamflowController(tmp_path)
    task = controller.store.append_task(
        title="Cancel me",
        goal="Should stop",
        scope="workspace",
        acceptance_criteria=["not submitted"],
        verify_commands=[{"command": f"{sys.executable} -c \"import sys; sys.exit(9)\"", "cwd": ".", "timeout": 5}],
        max_attempts=3,
    )
    controller.get_task("claude")
    controller.cancel_task(task["id"], "timeout", agent="codex")

    class Reviewer:
        calls = 0

        def review(self, *_args, **_kwargs):
            self.calls += 1
            return ReviewDecision(status="PASS", summary="should not run", suggestions=[])

    reviewer = Reviewer()
    result = controller.submit_review(task["id"], "late submit", [], [], reviewer=reviewer)

    assert result["status"] == "CANCELLED"
    assert reviewer.calls == 0
    assert result["remainingAttempts"] == 0
    assert "已被 Codex 架构师接管并取消" in result["message"]


def test_submit_review_warns_on_final_attempt_and_blocks_after_max_attempts(tmp_path):
    controller = TeamflowController(tmp_path)
    task = controller.store.append_task(
        title="Retry task",
        goal="Fail twice",
        scope="workspace",
        acceptance_criteria=["passes eventually"],
        verify_commands=[{"command": f"{sys.executable} -c \"import sys; sys.exit(7)\"", "cwd": ".", "timeout": 5}],
        max_attempts=2,
    )

    first = controller.get_task("claude")["task"]
    first_result = controller.submit_review(first["id"], "first fail", [], [])
    assert first_result["status"] == "LOCAL_FAILED"
    assert first_result["remainingAttempts"] == 1
    assert "最后一次尝试机会" in first_result["warning"]

    second = controller.get_task("claude")["task"]
    second_result = controller.submit_review(second["id"], "second fail", [], [])
    assert second_result["status"] == "BLOCKED"
    assert second_result["remainingAttempts"] == 0
    assert controller.store.get_task(task["id"])["status"] == "BLOCKED"


def test_submit_review_rejects_illegal_terminal_state(tmp_path):
    controller = TeamflowController(tmp_path)
    controller.plan_tasks("Build V2", atomic_tasks())
    task = controller.get_task("claude")["task"]
    controller.store.update_task_status(task["id"], "COMPLETED")

    result = controller.submit_review(task["id"], "late", [], [])

    assert result["status"] == "INVALID_STATE"
    assert "状态机异常" in result["message"]


def wait_for(predicate, *, timeout=3):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("condition was not met before timeout")
