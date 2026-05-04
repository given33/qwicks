from __future__ import annotations

import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from rich.console import Group
from rich.live import Live
from rich.panel import Panel
from rich.progress import BarColumn, Progress, TextColumn
from rich.table import Table

from .controller import TeamflowController


STATUS_LABELS = {
    "PENDING": "待领取",
    "IN_PROGRESS": "执行中",
    "LOCAL_FAILED": "本地验证失败",
    "REVIEW_PENDING": "审查中",
    "MIMO_REJECTED": "MiMo 打回",
    "COMPLETED": "已完成",
    "DEGRADED_PASS": "降级通过",
    "BLOCKED": "已阻塞",
    "CANCELLED": "已取消",
    "INVALID_STATE": "状态异常",
}

EVENT_TYPE_LABELS = {
    "tasks_planned": "Codex 已规划",
    "task_delegated": "Codex 已派发",
    "delegate_wait_started": "Codex 开始等待",
    "delegate_wait_completed": "Codex 等待结束",
    "delegate_wait_timeout": "Codex 等待超时",
    "task_claimed": "Claude 已领取",
    "task_status_changed": "任务状态变化",
    "task_cancelled": "任务已取消",
    "local_review_recorded": "本地验证记录",
    "mimo_review_recorded": "MiMo 审查记录",
    "claude_worker_task_detected": "Claude Worker 已检测到任务",
    "claude_worker_started": "Claude Worker 已启动",
    "claude_worker_idle": "Claude Worker 空闲",
    "claude_worker_run_finished": "Claude Worker 本轮结束",
    "claude_worker_error": "Claude Worker 异常",
    "claude_worker_timeout": "Claude Worker 超时",
}

REVIEW_KIND_LABELS = {
    "local": "本地验证",
    "mimo": "MiMo 审查",
}


def run_dashboard(root: Path | str | None = None, *, host: str = "127.0.0.1", port: int = 8765, api_only: bool = False) -> None:
    teamflow_root = Path(root or os.environ.get("TEAMFLOW_ROOT", r"D:\MCP\teamflow"))
    controller = TeamflowController(teamflow_root)
    server = start_status_server(controller, host, port)
    if api_only:
        print(f"Teamflow Dashboard API is running at http://{host}:{port}/status", flush=True)
        try:
            while True:
                time.sleep(3600)
        finally:
            server.shutdown()
        return
    try:
        last_hash = ""
        with Live(render_dashboard(controller.get_status()), refresh_per_second=2, screen=False) as live:
            while True:
                current_hash = controller.store.dashboard_state_hash()
                if current_hash != last_hash:
                    live.update(render_dashboard(controller.get_status()))
                    last_hash = current_hash
                time.sleep(1)
    finally:
        server.shutdown()


def start_status_server(controller: TeamflowController, host: str, port: int) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - stdlib API
            if self.path in {"/", "/status"}:
                self._send_json(controller.get_status())
                return
            if self.path in {"/tasks.json", "/api/tasks.json"}:
                self._send_json(controller.export_tasks_json())
                return
            self.send_response(404)
            self.end_headers()

        def log_message(self, _format: str, *_args: Any) -> None:
            return

        def _send_json(self, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("access-control-allow-origin", "*")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer((host, port), Handler)
    thread = threading.Thread(target=server.serve_forever, name="teamflow-dashboard-http", daemon=True)
    thread.start()
    return server


def render_dashboard(status: dict[str, Any]) -> Group:
    return Group(
        Panel(render_overview(status), title="Teamflow V2 任务中控", border_style="cyan"),
        Panel(render_tasks_table(status), title="任务列表", border_style="blue"),
        Panel(render_events_table(status), title="最近事件 / MiMo 审查", border_style="magenta"),
    )


def render_overview(status: dict[str, Any]) -> Group:
    progress = Progress(
        TextColumn("[bold]总体进度"),
        BarColumn(bar_width=40),
        TextColumn("{task.percentage:>3.0f}%"),
        expand=False,
    )
    progress.add_task("overall", total=100, completed=status.get("progressPercent", 0))
    counts = status.get("counts", {})
    current = pick_current_task(status)
    current_goal = status.get("projectGoal") or (current.get("goal") if current else "") or "等待 Codex 派发任务"
    current_task = f"{task_label(current.get('id'))} {current.get('title', '')}".strip() if current else "-"
    return Group(
        f"当前会话: {status.get('currentRunId') or '-'}",
        f"当前目标: {current_goal}",
        f"当前任务: {current_task}",
        (
            f"已完成: {counts.get('COMPLETED', 0)} | "
            f"降级通过: {counts.get('DEGRADED_PASS', 0)} | "
            f"本地失败: {counts.get('LOCAL_FAILED', 0)} | "
            f"MiMo 打回: {counts.get('MIMO_REJECTED', 0)} | "
            f"已取消: {counts.get('CANCELLED', 0)} | "
            f"已阻塞: {counts.get('BLOCKED', 0)}"
        ),
        progress,
        f"SQLite 数据库: {status.get('database')}",
        f"任务快照: {status.get('tasksJson')}",
    )


def pick_current_task(status: dict[str, Any]) -> dict[str, Any] | None:
    current = status.get("currentTask")
    if current:
        return current
    tasks = status.get("tasks", [])
    for state in ["PENDING", "LOCAL_FAILED", "MIMO_REJECTED", "REVIEW_PENDING", "BLOCKED", "DEGRADED_PASS", "COMPLETED", "CANCELLED"]:
        found = next((task for task in tasks if task.get("status") == state), None)
        if found:
            return found
    return None


def render_tasks_table(status: dict[str, Any]) -> Table:
    table = Table(expand=True)
    table.add_column("编号", width=10)
    table.add_column("状态", width=16)
    table.add_column("执行者", width=14)
    table.add_column("标题")
    table.add_column("尝试", justify="right", width=8)
    for task in status.get("tasks", []):
        table.add_row(
            task_label(task.get("id")),
            style_status(task.get("status", "")),
            agent_label(task.get("assignedAgent")),
            task.get("title", ""),
            str(task.get("attempts", 0)),
        )
    return table


def render_events_table(status: dict[str, Any]) -> Table:
    table = Table(expand=True)
    table.add_column("时间", width=20)
    table.add_column("类型", width=26)
    table.add_column("任务", width=10)
    table.add_column("消息")
    rows = status.get("events", [])[-8:]
    for event in rows:
        table.add_row(
            event.get("at", ""),
            event_type_label(event.get("type", "")),
            task_label(event.get("taskId")),
            event.get("message") or "",
        )
    for review in status.get("reviews", [])[-4:]:
        table.add_row(
            review.get("at", ""),
            f"{review_kind_label(review.get('kind', ''))}: {review_status_label(review.get('status', ''))}",
            task_label(review.get("taskId")),
            review.get("summary") or "",
        )
    return table


def style_status(status: str) -> str:
    colors = {
        "PENDING": "white",
        "IN_PROGRESS": "yellow",
        "LOCAL_FAILED": "red",
        "REVIEW_PENDING": "cyan",
        "MIMO_REJECTED": "red",
        "COMPLETED": "green",
        "DEGRADED_PASS": "bold yellow",
        "BLOCKED": "red",
        "CANCELLED": "red",
    }
    return f"[{colors.get(status, 'white')}]{status_label(status)}[/]"


def status_label(status: str) -> str:
    return STATUS_LABELS.get(status, status or "-")


def event_type_label(event_type: str) -> str:
    return EVENT_TYPE_LABELS.get(event_type, event_type or "-")


def task_label(task_id: str | None) -> str:
    if not task_id:
        return "-"
    if task_id.startswith("task-"):
        suffix = task_id.split("-", 1)[1]
        return f"任务 {suffix}"
    return task_id


def agent_label(agent: str | None) -> str:
    if not agent:
        return "-"
    labels = {
        "codex": "Codex",
        "claude": "Claude",
        "claude-worker": "Claude Worker",
    }
    return labels.get(agent, agent)


def review_kind_label(kind: str) -> str:
    return REVIEW_KIND_LABELS.get(kind, kind or "-")


def review_status_label(status: str) -> str:
    labels = {
        "PASSED": "通过",
        "FAILED": "失败",
        "PASS": "通过",
        "REJECT": "拒绝",
        "UNAVAILABLE": "不可用",
    }
    return labels.get(status, status or "-")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=os.environ.get("TEAMFLOW_ROOT", r"D:\MCP\teamflow"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--api-only", action="store_true")
    args = parser.parse_args()
    run_dashboard(args.root, host=args.host, port=args.port, api_only=args.api_only)


if __name__ == "__main__":
    main()
