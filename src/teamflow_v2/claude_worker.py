from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

from .controller import TeamflowController
from .store import BLOCKING_STATUSES, CLAIMABLE_STATUSES


Runner = Callable[..., Any]


def find_claimable_task(controller: TeamflowController) -> dict[str, Any] | None:
    tasks = controller.get_status().get("tasks", [])
    if any(task.get("status") in BLOCKING_STATUSES for task in tasks):
        return None
    for task in tasks:
        if task.get("status") in CLAIMABLE_STATUSES:
            return task
    return None


def run_worker_once(controller: TeamflowController, *, runner: Runner = subprocess.run) -> bool:
    task = find_claimable_task(controller)
    if task is None:
        return False

    task_id = task["id"]
    controller.store.add_event(
        "claude_worker_task_detected",
        task_id=task_id,
        agent="claude-worker",
        message=f"Claude Worker 已检测到任务 {task_id}，正在启动 Claude Code",
        payload={"status": task["status"], "title": task["title"]},
    )
    command = build_claude_command(controller, task)
    timeout_seconds = int(os.environ.get("TEAMFLOW_WORKER_CLAUDE_TIMEOUT_SECONDS", "7200"))
    try:
        completed = runner(
            command,
            cwd=str(controller.store.workspace),
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired:
        controller.store.add_event(
            "claude_worker_timeout",
            task_id=task_id,
            agent="claude-worker",
            message=f"Claude Code 执行超过 {timeout_seconds} 秒，Worker 将继续等待下一轮状态变化",
            payload={"timeoutSeconds": timeout_seconds},
        )
        return True
    except FileNotFoundError:
        controller.store.add_event(
            "claude_worker_error",
            task_id=task_id,
            agent="claude-worker",
            message="未找到 Claude Code CLI，请确认 claude 命令已安装并在 PATH 中，或设置 TEAMFLOW_CLAUDE_BIN",
            payload={"command": command[0]},
        )
        return True

    return_code = completed if isinstance(completed, int) else getattr(completed, "returncode", 0)
    if return_code:
        controller.store.add_event(
            "claude_worker_error",
            task_id=task_id,
            agent="claude-worker",
            message=f"Claude Code 本轮退出码为 {return_code}",
            payload={"returnCode": return_code},
        )
    else:
        controller.store.add_event(
            "claude_worker_run_finished",
            task_id=task_id,
            agent="claude-worker",
            message=f"Claude Code 本轮执行结束: {task_id}",
        )
    return True


def build_claude_command(controller: TeamflowController, task: dict[str, Any]) -> list[str]:
    user_root = os.environ.get("USER_ROOT", r"C:\Users\28219")
    mcp_config = controller.root / "runtime" / "claude-mcp.json"
    prompt = build_claude_prompt(task)
    return [
        resolve_claude_bin(),
        "--add-dir",
        user_root,
        "--permission-mode",
        "bypassPermissions",
        "--mcp-config",
        str(mcp_config),
        "--strict-mcp-config",
        "-p",
        prompt,
    ]


def resolve_claude_bin() -> str:
    explicit = os.environ.get("TEAMFLOW_CLAUDE_BIN")
    if explicit:
        return explicit
    for candidate in ("claude.cmd", "claude.exe", "claude"):
        found = shutil.which(candidate)
        if found:
            return found
    return "claude"


def build_claude_prompt(task: dict[str, Any]) -> str:
    return f"""你是 Teamflow V2 自动 Worker，本轮只处理当前会话中最优先的可领取任务。

必须严格按以下顺序执行：
1. 通过 `teamflow-v2` MCP 调用 `get_task(agent="claude")` 领取任务。
2. 如果没有任务，直接说明没有可执行任务并退出。
3. 如果领取到任务，只在任务 scope 内修改文件。
4. 完成后调用 `submit_review(task_id, summary, changed_files, commands_run)`。
5. 如果返回 `LOCAL_FAILED` 或 `MIMO_REJECTED`，根据反馈修复并重新提交。
6. 如果返回 `CANCELLED`、`BLOCKED` 或状态机异常，立即停止旧任务并退出本轮。
7. 如果返回 `COMPLETED` 或 `DEGRADED_PASS`，输出最终摘要并退出本轮。

Worker 看到的候选任务：
- 会话：{task.get("runId")}
- 编号：{task.get("id")}
- 标题：{task.get("title")}
- 当前状态：{task.get("status")}
- 目标：{task.get("goal")}

不要直接编辑 `runtime/tasks.json`，不要绕过 MCP 修改任务状态。默认使用中文输出。
"""


def run_worker_loop(root: Path | str | None = None) -> None:
    teamflow_root = Path(root or os.environ.get("TEAMFLOW_ROOT", r"D:\MCP\teamflow"))
    controller = TeamflowController(teamflow_root)
    poll_seconds = float(os.environ.get("TEAMFLOW_WORKER_POLL_SECONDS", "2"))
    idle_log_seconds = float(os.environ.get("TEAMFLOW_WORKER_IDLE_LOG_SECONDS", "60"))
    last_idle_log = 0.0

    controller.store.add_event("claude_worker_started", agent="claude-worker", message="Claude Worker 已启动")
    print("Claude Worker 已启动，正在等待 Codex 派发当前会话任务。", flush=True)

    while True:
        ran = run_worker_once(controller)
        if ran:
            last_idle_log = time.time()
            time.sleep(max(0.1, poll_seconds))
            continue

        now = time.time()
        if now - last_idle_log >= idle_log_seconds:
            print("Claude Worker 空闲：当前会话暂无待领取任务。", flush=True)
            controller.store.add_event("claude_worker_idle", agent="claude-worker", message="当前会话暂无待领取任务")
            last_idle_log = now
        time.sleep(max(0.1, poll_seconds))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=os.environ.get("TEAMFLOW_ROOT", r"D:\MCP\teamflow"))
    args = parser.parse_args()
    run_worker_loop(args.root)


if __name__ == "__main__":
    main()
