from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Any

from .mimo import MimoReviewer, ReviewDecision
from .store import TeamflowStore
from .verifier import VerificationResult, run_verify_commands


class TeamflowController:
    def __init__(self, root: Path | str, *, mimo_max_retries: int = 3, run_id: str | None = None) -> None:
        self.root = Path(root)
        self.store = TeamflowStore(self.root, run_id=run_id)
        self.mimo_max_retries = max(1, int(mimo_max_retries))

    def plan_tasks(self, project_goal: str, tasks: list[dict[str, Any]]) -> dict[str, Any]:
        validate_tasks(tasks)
        self.store.reset_plan(project_goal, tasks)
        snapshot = self.store.export_tasks_json()
        return {"status": "ok", "tasksWritten": len(tasks), "tasksJson": str(self.store.tasks_json_path), "snapshot": snapshot}

    def get_task(self, agent: str) -> dict[str, Any]:
        task = self.store.claim_next_task(agent)
        if task is None:
            return {"task": None, "message": "no pending task"}
        return {"task": task, "message": f"claimed {task['id']}"}

    def delegate_task_and_wait(
        self,
        title: str,
        goal: str,
        scope: str,
        acceptance_criteria: list[str],
        verify_commands: list[dict[str, Any]],
        *,
        timeout_seconds: float = 3600,
        poll_seconds: float = 2,
        max_attempts: int = 3,
    ) -> dict[str, Any]:
        validate_task_payload(
            {
                "title": title,
                "goal": goal,
                "scope": scope,
                "acceptanceCriteria": acceptance_criteria,
                "verifyCommands": verify_commands,
            },
            1,
        )
        task = self.store.append_task(
            title=title,
            goal=goal,
            scope=scope,
            acceptance_criteria=acceptance_criteria,
            verify_commands=verify_commands,
            max_attempts=max_attempts,
        )
        task_id = task["id"]
        self.store.add_event("delegate_wait_started", task_id=task_id, agent="codex", message=f"Codex waiting for {task_id}")
        deadline = time.time() + max(0, float(timeout_seconds))
        interval = max(0.01, float(poll_seconds))
        while time.time() < deadline:
            current = self.store.get_task(task_id)
            if current and current["status"] in {"COMPLETED", "DEGRADED_PASS", "BLOCKED", "CANCELLED"}:
                result = self._delegation_result(current)
                self.store.add_event(
                    "delegate_wait_completed",
                    task_id=task_id,
                    agent="codex",
                    message=result["message"],
                    payload={"status": result["status"]},
                )
                return result
            time.sleep(interval)
        current = self.store.get_task(task_id)
        result = self._delegation_result(current, status_override="TIMEOUT")
        self.store.add_event("delegate_wait_timeout", task_id=task_id, agent="codex", message=result["message"], payload={"status": "TIMEOUT"})
        return result

    def cancel_task(self, task_id: str, reason: str, agent: str = "codex") -> dict[str, Any]:
        task = self.store.cancel_task(task_id, reason, agent=agent)
        return {"status": task["status"], "taskId": task_id, "task": task, "message": f"任务 {task_id} 已取消：{reason}"}

    def submit_review(
        self,
        task_id: str,
        summary: str,
        changed_files: list[str],
        commands_run: list[str],
        *,
        reviewer: Any | None = None,
    ) -> dict[str, Any]:
        task = self.store.get_task(task_id)
        if task is None:
            raise ValueError(f"Unknown task: {task_id}")
        state_guard = self._submit_state_guard(task)
        if state_guard:
            return state_guard

        local = run_verify_commands(task["verifyCommands"], workspace=self.store.workspace)
        self.store.add_review(
            task_id,
            "local",
            local.status,
            local.summary,
            {
                **local.as_dict(),
                "changedFiles": changed_files,
                "commandsRun": commands_run,
                "workerSummary": summary,
            },
        )
        if local.status != "PASSED":
            failed = self._record_failed_attempt(task, "LOCAL_FAILED", local.summary)
            return {
                "status": failed["status"],
                "task": self.store.get_task(task_id),
                "localVerification": local.as_dict(),
                "mimo": None,
                **failed,
            }

        self.store.update_task_status(task_id, "REVIEW_PENDING")
        payload = {
            "task": task,
            "summary": summary,
            "changedFiles": changed_files,
            "commandsRun": commands_run,
            "localVerification": local.as_dict(),
            "diff": collect_git_diff(self.store.workspace),
        }
        decision, error = self._review_with_retries(reviewer or MimoReviewer(), payload)
        if decision:
            normalized = decision.normalized_status()
            self.store.add_review(
                task_id,
                "mimo",
                normalized,
                decision.summary,
                {
                    "suggestions": decision.suggestions,
                    "raw": decision.raw,
                    "changedFiles": changed_files,
                    "commandsRun": commands_run,
                    "workerSummary": summary,
                },
            )
            if normalized == "PASS":
                self.store.update_task_status(task_id, "COMPLETED")
                status = "COMPLETED"
                failed = attempt_payload(self.store.get_task(task_id))
            else:
                failed = self._record_failed_attempt(self.store.get_task(task_id), "MIMO_REJECTED", decision.summary)
                status = failed["status"]
            return {
                "status": status,
                "task": self.store.get_task(task_id),
                "localVerification": local.as_dict(),
                "mimo": {
                    "status": normalized,
                    "summary": decision.summary,
                    "suggestions": decision.suggestions,
                },
                **failed,
            }

        self.store.add_review(task_id, "mimo", "UNAVAILABLE", str(error), {"error": str(error), "attempts": self.mimo_max_retries})
        self.store.update_task_status(task_id, "DEGRADED_PASS", last_error=f"MiMo unavailable after retries: {error}")
        current = self.store.get_task(task_id)
        return {
            "status": "DEGRADED_PASS",
            "task": current,
            "localVerification": local.as_dict(),
            "mimo": {
                "status": "UNAVAILABLE",
                "error": str(error),
                "attempts": self.mimo_max_retries,
            },
            **attempt_payload(current),
        }

    def get_status(self) -> dict[str, Any]:
        return self.store.status_snapshot()

    def export_tasks_json(self) -> dict[str, Any]:
        return self.store.export_tasks_json()

    def _review_with_retries(self, reviewer: Any, payload: dict[str, Any]) -> tuple[ReviewDecision | None, Exception | None]:
        last_error: Exception | None = None
        for _attempt in range(1, self.mimo_max_retries + 1):
            try:
                decision = reviewer.review(payload)
                return decision, None
            except Exception as error:  # noqa: BLE001 - captured for explicit degradation.
                last_error = error
        return None, last_error

    def _submit_state_guard(self, task: dict[str, Any]) -> dict[str, Any] | None:
        if task["status"] == "CANCELLED":
            return {
                "status": "CANCELLED",
                "task": task,
                "localVerification": None,
                "mimo": None,
                "attempts": task.get("attempts", 0),
                "maxAttempts": task.get("maxAttempts", 0),
                "remainingAttempts": 0,
                "warning": "",
                "message": "⛔ 提交失败：该任务已被 Codex 架构师接管并取消。请立即停止当前工作，并调用 get_task 领取最新任务。",
            }
        allowed = {"IN_PROGRESS", "LOCAL_FAILED", "MIMO_REJECTED", "REVIEW_PENDING"}
        if task["status"] not in allowed:
            return {
                "status": "INVALID_STATE",
                "task": task,
                "localVerification": None,
                "mimo": None,
                "attempts": task.get("attempts", 0),
                "maxAttempts": task.get("maxAttempts", 0),
                "remainingAttempts": 0,
                "warning": "",
                "message": f"⛔ 状态机异常，当前状态 {task['status']} 不允许提交审查。",
            }
        return None

    def _record_failed_attempt(self, task: dict[str, Any], status: str, feedback: str) -> dict[str, Any]:
        attempts = int(task.get("attempts", 0))
        max_attempts = int(task.get("maxAttempts", 3))
        remaining = max_attempts - attempts
        if remaining <= 0:
            self.store.update_task_status(task["id"], "BLOCKED", last_error=feedback)
            return {
                "status": "BLOCKED",
                "attempts": attempts,
                "maxAttempts": max_attempts,
                "remainingAttempts": 0,
                "warning": "",
                "message": "⛔ 任务已达最大尝试次数，已被强制阻塞。请停止执行，等待 Codex 重新派发指令。",
            }
        self.store.update_task_status(task["id"], status, last_error=feedback)
        warning = ""
        if remaining == 1:
            warning = (
                "🚨 【架构师严重警告】：这是该任务的最后一次尝试机会！如果再次失败，"
                "任务将被强制阻塞（BLOCKED）并移交架构师重新评估。请务必停止机械重试，仔细审视代码逻辑与反馈意见！"
            )
        return {
            "status": status,
            "attempts": attempts,
            "maxAttempts": max_attempts,
            "remainingAttempts": remaining,
            "warning": warning,
            "message": f"❌ 审查被拒绝！请根据反馈立刻修改：\n{feedback}" + (f"\n\n{warning}" if warning else ""),
        }

    def _delegation_result(self, task: dict[str, Any] | None, *, status_override: str | None = None) -> dict[str, Any]:
        task_id = task["id"] if task else ""
        status = status_override or (task["status"] if task else "TIMEOUT")
        context = self._task_result_context(task_id)
        messages = {
            "COMPLETED": "✅ 任务成功完成！这是 Worker 的最终反馈，请据此继续下发下一个任务。",
            "DEGRADED_PASS": "⚠️ 任务降级通过：本地验证成功，但 MiMo 审查未完成。请据此继续下发。",
            "BLOCKED": "❌ 任务彻底阻塞！请架构师重新分析情况，调整方案后再派发新任务。",
            "CANCELLED": "⛔ 任务已取消，等待架构师重新派发。",
            "TIMEOUT": "🚨 任务执行超时，系统无响应，请进行人工干预。",
        }
        return {
            "status": "BLOCKED" if status == "CANCELLED" else status,
            "taskId": task_id,
            "message": messages.get(status, messages["TIMEOUT"]),
            "task": task,
            **context,
        }

    def _task_result_context(self, task_id: str) -> dict[str, Any]:
        reviews = self.store.task_reviews(task_id) if task_id else []
        events = self.store.task_events(task_id, limit=20) if task_id else []
        affected_files: list[str] = []
        commands_run: list[str] = []
        worker_summary = ""
        local_verification = None
        mimo_review = None
        for review in reviews:
            payload = review.get("payload", {})
            affected_files = payload.get("changedFiles") or affected_files
            commands_run = payload.get("commandsRun") or commands_run
            worker_summary = payload.get("workerSummary") or worker_summary
            if review["kind"] == "local":
                local_verification = payload
            if review["kind"] == "mimo":
                mimo_review = review
        return {
            "affectedFiles": affected_files,
            "commandsRun": commands_run,
            "workerSummary": worker_summary,
            "localVerification": local_verification,
            "mimoReview": mimo_review,
            "events": events,
        }


def validate_tasks(tasks: list[dict[str, Any]]) -> None:
    if not 5 <= len(tasks) <= 8:
        raise ValueError("plan_tasks requires 5-8 atomic tasks")
    for index, task in enumerate(tasks, start=1):
        validate_task_payload(task, index)


def validate_task_payload(task: dict[str, Any], index: int) -> None:
    required = {"title", "goal", "scope", "acceptanceCriteria", "verifyCommands"}
    missing = sorted(required.difference(task))
    if missing:
        raise ValueError(f"task {index} is missing fields: {', '.join(missing)}")
    if not isinstance(task["acceptanceCriteria"], list) or not task["acceptanceCriteria"]:
        raise ValueError(f"task {index} acceptanceCriteria must be a non-empty list")
    if not isinstance(task["verifyCommands"], list) or not task["verifyCommands"]:
        raise ValueError(f"task {index} verifyCommands must be a non-empty list")


def attempt_payload(task: dict[str, Any] | None) -> dict[str, Any]:
    attempts = int(task.get("attempts", 0)) if task else 0
    max_attempts = int(task.get("maxAttempts", 0)) if task else 0
    return {
        "attempts": attempts,
        "maxAttempts": max_attempts,
        "remainingAttempts": max(0, max_attempts - attempts),
        "warning": "",
        "message": "",
    }


def collect_git_diff(workspace: Path) -> str:
    try:
        completed = subprocess.run(
            "git diff -- .",
            cwd=str(workspace),
            shell=True,
            text=True,
            capture_output=True,
            timeout=20,
        )
    except Exception:
        return ""
    if completed.returncode != 0:
        return ""
    return completed.stdout[-30000:]
