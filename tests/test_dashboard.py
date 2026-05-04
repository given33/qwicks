import sys
from pathlib import Path

from rich.console import Console

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from teamflow_v2.controller import TeamflowController
from teamflow_v2.dashboard import event_type_label, render_dashboard, status_label, task_label


def test_dashboard_status_labels_are_chinese():
    assert status_label("PENDING") == "待领取"
    assert status_label("IN_PROGRESS") == "执行中"
    assert status_label("COMPLETED") == "已完成"
    assert status_label("CANCELLED") == "已取消"


def test_dashboard_event_and_task_labels_are_chinese():
    assert task_label("task-001") == "任务 001"
    assert task_label(None) == "-"
    assert event_type_label("task_delegated") == "Codex 已派发"
    assert event_type_label("task_claimed") == "Claude 已领取"
    assert event_type_label("local_review_recorded") == "本地验证记录"
    assert event_type_label("mimo_review_recorded") == "MiMo 审查记录"
    assert event_type_label("delegate_wait_timeout") == "Codex 等待超时"


def test_dashboard_render_contains_chinese_titles_and_task_labels(tmp_path):
    controller = TeamflowController(tmp_path)
    task = controller.store.append_task(
        title="中文化任务",
        goal="显示中文",
        scope="dashboard",
        acceptance_criteria=["中文可见"],
        verify_commands=[{"command": f"{sys.executable} -c \"print('ok')\"", "cwd": ".", "timeout": 5}],
        max_attempts=3,
    )
    controller.store.add_event(
        "claude_worker_task_detected",
        task_id=task["id"],
        agent="claude-worker",
        message="检测到待执行任务",
    )

    console = Console(record=True, width=120)
    console.print(render_dashboard(controller.get_status()))
    rendered = console.export_text()

    assert "Teamflow V2 任务中控" in rendered
    assert "当前会话" in rendered
    assert "任务列表" in rendered
    assert "最近事件 / MiMo 审查" in rendered
    assert "当前目标" in rendered
    assert "当前任务" in rendered
    assert "任务 001" in rendered
    assert "待领取" in rendered
    assert "Claude Worker 已检测到任务" in rendered
    assert "娴ｇ姵" not in rendered
    assert "閻" not in rendered


def test_dashboard_state_hash_changes_only_when_state_changes(tmp_path):
    controller = TeamflowController(tmp_path)
    initial = controller.store.dashboard_state_hash()

    controller.store.append_task(
        title="Hash task",
        goal="Change hash",
        scope="dashboard",
        acceptance_criteria=["hash changes"],
        verify_commands=[{"command": f"{sys.executable} -c \"print('ok')\"", "cwd": ".", "timeout": 5}],
        max_attempts=3,
    )

    changed = controller.store.dashboard_state_hash()
    same_again = controller.store.dashboard_state_hash()

    assert changed != initial
    assert same_again == changed
