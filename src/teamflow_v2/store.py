from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


TASK_STATUSES = {
    "PENDING",
    "IN_PROGRESS",
    "LOCAL_FAILED",
    "REVIEW_PENDING",
    "MIMO_REJECTED",
    "COMPLETED",
    "DEGRADED_PASS",
    "BLOCKED",
    "CANCELLED",
}
CLAIMABLE_STATUSES = ("PENDING", "LOCAL_FAILED", "MIMO_REJECTED")
BLOCKING_STATUSES = ("IN_PROGRESS", "REVIEW_PENDING", "DEGRADED_PASS", "BLOCKED")
DONE_STATUSES = ("COMPLETED", "BLOCKED", "CANCELLED")
LEGACY_RUN_ID = "legacy"
DEFAULT_RUN_ID = "run-default"


class TeamflowStore:
    def __init__(self, root: Path | str, *, run_id: str | None = None) -> None:
        self.root = Path(root)
        self.runtime = self.root / "runtime"
        self.workspace = self.root / "workspace"
        self.db_path = self.runtime / "teamflow.sqlite3"
        self.tasks_json_path = self.runtime / "tasks.json"
        self.active_run_path = self.runtime / "active-run.json"
        self.runtime.mkdir(parents=True, exist_ok=True)
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.run_id = run_id or os.environ.get("TEAMFLOW_RUN_ID") or read_active_run_id(self.root) or DEFAULT_RUN_ID
        self.initialize()

    def initialize(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                create table if not exists meta (
                  key text primary key,
                  value text not null
                );
                create table if not exists runs (
                  id text primary key,
                  created_at text not null,
                  updated_at text not null,
                  project_goal text not null default ''
                );
                """
            )
            self._migrate_tasks_table(conn)
            self._migrate_events_table(conn)
            self._migrate_reviews_table(conn)
            self._ensure_column(conn, "tasks", "max_attempts", "integer not null default 3")
            conn.executescript(
                """
                create index if not exists idx_tasks_status_id on tasks(run_id, status, id);
                create index if not exists idx_events_id on events(run_id, id);
                create index if not exists idx_events_task_id_id on events(run_id, task_id, id);
                create index if not exists idx_reviews_task_id_id on reviews(run_id, task_id, id);
                """
            )
            self._ensure_run(conn, self.run_id)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("pragma journal_mode=wal")
            conn.execute("pragma synchronous=normal")
            conn.execute("pragma foreign_keys=on")
            yield conn
        finally:
            conn.close()

    def reset_plan(self, project_goal: str, tasks: list[dict[str, Any]]) -> None:
        now = utc_now()
        with self.connect() as conn:
            conn.execute("begin immediate")
            conn.execute("delete from tasks where run_id=?", (self.run_id,))
            conn.execute("delete from events where run_id=?", (self.run_id,))
            conn.execute("delete from reviews where run_id=?", (self.run_id,))
            self._ensure_run(conn, self.run_id)
            conn.execute("update runs set project_goal=?, updated_at=? where id=?", (project_goal, now, self.run_id))
            conn.execute(
                "insert into meta(key, value) values('updated_at', ?) "
                "on conflict(key) do update set value=excluded.value",
                (now,),
            )
            for index, task in enumerate(tasks, start=1):
                conn.execute(
                    """
                    insert into tasks(
                      run_id, id, title, goal, scope, acceptance_criteria, verify_commands,
                      status, assigned_agent, attempts, max_attempts, last_error, created_at, updated_at
                    ) values (?, ?, ?, ?, ?, ?, ?, 'PENDING', null, 0, 3, null, ?, ?)
                    """,
                    (
                        self.run_id,
                        f"task-{index:03d}",
                        task["title"],
                        task["goal"],
                        task["scope"],
                        json.dumps(task["acceptanceCriteria"], ensure_ascii=False),
                        json.dumps(task["verifyCommands"], ensure_ascii=False),
                        now,
                        now,
                    ),
                )
            self._append_event(conn, "tasks_planned", message=f"Planned {len(tasks)} tasks", payload={"projectGoal": project_goal})
            conn.execute("commit")
        self.export_tasks_json()

    def append_task(
        self,
        *,
        title: str,
        goal: str,
        scope: str,
        acceptance_criteria: list[str],
        verify_commands: list[dict[str, Any]],
        max_attempts: int = 3,
    ) -> dict[str, Any]:
        now = utc_now()
        with self.connect() as conn:
            conn.execute("begin immediate")
            self._ensure_run(conn, self.run_id)
            rows = conn.execute("select id from tasks where run_id=?", (self.run_id,)).fetchall()
            next_number = next_task_number([str(row["id"]) for row in rows])
            task_id = f"task-{next_number:03d}"
            conn.execute(
                """
                insert into tasks(
                  run_id, id, title, goal, scope, acceptance_criteria, verify_commands,
                  status, assigned_agent, attempts, max_attempts, last_error, created_at, updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, 'PENDING', null, 0, ?, null, ?, ?)
                """,
                (
                    self.run_id,
                    task_id,
                    title,
                    goal,
                    scope,
                    json.dumps(acceptance_criteria, ensure_ascii=False),
                    json.dumps(verify_commands, ensure_ascii=False),
                    max(1, int(max_attempts)),
                    now,
                    now,
                ),
            )
            conn.execute("update runs set updated_at=? where id=?", (now, self.run_id))
            self._append_event(conn, "task_delegated", task_id=task_id, agent="codex", message=f"Codex delegated {task_id}", payload={"title": title})
            conn.execute("commit")
        self.export_tasks_json()
        task = self.get_task(task_id)
        if task is None:
            raise RuntimeError(f"Task was not written: {task_id}")
        return task

    def claim_next_task(self, agent: str) -> dict[str, Any] | None:
        now = utc_now()
        with self.connect() as conn:
            conn.execute("begin immediate")
            blocker = conn.execute(
                f"select id from tasks where run_id=? and status in ({','.join('?' for _ in BLOCKING_STATUSES)}) order by id limit 1",
                (self.run_id, *BLOCKING_STATUSES),
            ).fetchone()
            if blocker is not None:
                conn.execute("commit")
                return None
            row = conn.execute(
                f"select * from tasks where run_id=? and status in ({','.join('?' for _ in CLAIMABLE_STATUSES)}) order by id limit 1",
                (self.run_id, *CLAIMABLE_STATUSES),
            ).fetchone()
            if row is None:
                conn.execute("commit")
                return None
            attempts = int(row["attempts"]) + 1
            conn.execute(
                """
                update tasks
                set status='IN_PROGRESS', assigned_agent=?, attempts=?, updated_at=?
                where run_id=? and id=?
                """,
                (agent, attempts, now, self.run_id, row["id"]),
            )
            conn.execute("update runs set updated_at=? where id=?", (now, self.run_id))
            self._append_event(conn, "task_claimed", task_id=row["id"], agent=agent, message=f"{agent} claimed {row['id']}")
            conn.execute("commit")
        self.export_tasks_json()
        return self.get_task(row["id"])

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("select * from tasks where run_id=? and id=?", (self.run_id, task_id)).fetchone()
            return row_to_task(row) if row else None

    def update_task_status(self, task_id: str, status: str, *, last_error: str | None = None) -> None:
        if status not in TASK_STATUSES:
            raise ValueError(f"Unknown status: {status}")
        now = utc_now()
        with self.connect() as conn:
            conn.execute("begin immediate")
            conn.execute(
                "update tasks set status=?, last_error=?, updated_at=? where run_id=? and id=?",
                (status, last_error, now, self.run_id, task_id),
            )
            conn.execute("update runs set updated_at=? where id=?", (now, self.run_id))
            self._append_event(conn, "task_status_changed", task_id=task_id, message=f"{task_id} -> {status}", payload={"status": status, "lastError": last_error})
            conn.execute("commit")
        self.export_tasks_json()

    def cancel_task(self, task_id: str, reason: str, *, agent: str = "codex") -> dict[str, Any]:
        task = self.get_task(task_id)
        if task is None:
            raise ValueError(f"Unknown task: {task_id}")
        if task["status"] in DONE_STATUSES:
            return task
        now = utc_now()
        with self.connect() as conn:
            conn.execute("begin immediate")
            conn.execute(
                "update tasks set status='CANCELLED', last_error=?, updated_at=? where run_id=? and id=?",
                (reason, now, self.run_id, task_id),
            )
            conn.execute("update runs set updated_at=? where id=?", (now, self.run_id))
            self._append_event(conn, "task_cancelled", task_id=task_id, agent=agent, message=reason, payload={"reason": reason})
            conn.execute("commit")
        self.export_tasks_json()
        task = self.get_task(task_id)
        if task is None:
            raise RuntimeError(f"Task disappeared after cancel: {task_id}")
        return task

    def add_review(self, task_id: str, kind: str, status: str, summary: str, payload: dict[str, Any]) -> None:
        now = utc_now()
        with self.connect() as conn:
            conn.execute("begin immediate")
            conn.execute(
                "insert into reviews(run_id, at, task_id, kind, status, summary, payload) values (?, ?, ?, ?, ?, ?, ?)",
                (self.run_id, now, task_id, kind, status, summary, json.dumps(payload, ensure_ascii=False)),
            )
            conn.execute("update runs set updated_at=? where id=?", (now, self.run_id))
            self._append_event(conn, f"{kind}_review_recorded", task_id=task_id, message=summary, payload={"status": status})
            conn.execute("commit")

    def add_event(
        self,
        event_type: str,
        *,
        task_id: str | None = None,
        agent: str | None = None,
        message: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        now = utc_now()
        with self.connect() as conn:
            conn.execute("begin immediate")
            self._ensure_run(conn, self.run_id)
            conn.execute("update runs set updated_at=? where id=?", (now, self.run_id))
            self._append_event(conn, event_type, task_id=task_id, agent=agent, message=message, payload=payload)
            conn.execute("commit")

    def task_reviews(self, task_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [
                row_to_review(row)
                for row in conn.execute("select * from reviews where run_id=? and task_id=? order by id", (self.run_id, task_id)).fetchall()
            ]

    def task_events(self, task_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [
                row_to_event(row)
                for row in conn.execute("select * from events where run_id=? and task_id=? order by id desc limit ?", (self.run_id, task_id, limit)).fetchall()
            ][::-1]

    def latest_review_payload(self, task_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("select * from reviews where run_id=? and task_id=? order by id desc limit 1", (self.run_id, task_id)).fetchone()
        return row_to_review(row)["payload"] if row else {}

    def dashboard_state_hash(self) -> str:
        with self.connect() as conn:
            tasks = [
                tuple(row)
                for row in conn.execute("select id, status, updated_at from tasks where run_id=? order by id", (self.run_id,)).fetchall()
            ]
            latest_event = conn.execute("select id from events where run_id=? order by id desc limit 1", (self.run_id,)).fetchone()
            latest_review = conn.execute("select id from reviews where run_id=? order by id desc limit 1", (self.run_id,)).fetchone()
            total = conn.execute("select count(*) as count from tasks where run_id=?", (self.run_id,)).fetchone()["count"]
            done = conn.execute(
                "select count(*) as count from tasks where run_id=? and status='COMPLETED'",
                (self.run_id,),
            ).fetchone()["count"]
        snapshot = {
            "runId": self.run_id,
            "tasks": tasks,
            "latestEventId": latest_event["id"] if latest_event else None,
            "latestReviewId": latest_review["id"] if latest_review else None,
            "progressPercent": round((done / total) * 100) if total else 0,
        }
        return hashlib.md5(json.dumps(snapshot, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()

    def status_snapshot(self, *, event_limit: int = 20) -> dict[str, Any]:
        with self.connect() as conn:
            tasks = [row_to_task(row) for row in conn.execute("select * from tasks where run_id=? order by id", (self.run_id,)).fetchall()]
            project_goal = self.run_project_goal(conn)
            events = [
                row_to_event(row)
                for row in conn.execute("select * from events where run_id=? order by id desc limit ?", (self.run_id, event_limit)).fetchall()
            ][::-1]
            reviews = [
                row_to_review(row)
                for row in conn.execute("select * from reviews where run_id=? order by id desc limit 10", (self.run_id,)).fetchall()
            ][::-1]
        counts = {status: 0 for status in TASK_STATUSES}
        for task in tasks:
            counts[task["status"]] = counts.get(task["status"], 0) + 1
        total = len(tasks)
        done = counts.get("COMPLETED", 0)
        exception = (
            counts.get("LOCAL_FAILED", 0)
            + counts.get("MIMO_REJECTED", 0)
            + counts.get("DEGRADED_PASS", 0)
            + counts.get("BLOCKED", 0)
        )
        counts["total"] = total
        current = current_task_for(tasks)
        workflow_metrics = {
            "totalTasks": total,
            "completedTasks": done,
            "exceptionTasks": exception,
            "progressPercent": round((done / total) * 100) if total else 0,
            "deliveryProgress": done,
            "currentGoal": (current or {}).get("goal") or (current or {}).get("title") or project_goal,
            "currentTaskId": (current or {}).get("id", ""),
            "currentTaskTitle": (current or {}).get("title", ""),
        }
        dashboard_pipeline = {
            "pending": tasks,
            "developing": [
                task
                for task in tasks
                if task["status"] in {"IN_PROGRESS", "LOCAL_FAILED", "MIMO_REJECTED", "BLOCKED"}
            ],
            "review": [
                task
                for task in tasks
                if task["status"] in {"REVIEW_PENDING", "COMPLETED", "DEGRADED_PASS", "CANCELLED"}
            ],
        }
        claude_timeline_source = [
            event
            for event in events
            if event.get("agent") == "claude" or "review" in str(event.get("type", ""))
        ]
        return {
            "currentRunId": self.run_id,
            "projectGoal": project_goal,
            "counts": counts,
            "progressPercent": workflow_metrics["progressPercent"],
            "currentTask": current,
            "tasks": tasks,
            "events": events,
            "reviews": reviews,
            "workflowMetrics": workflow_metrics,
            "dashboardPipeline": dashboard_pipeline,
            "claudeTimelineSource": claude_timeline_source,
            "tasksJson": str(self.tasks_json_path),
            "database": str(self.db_path),
        }

    def export_tasks_json(self) -> dict[str, Any]:
        snapshot = self.status_snapshot(event_limit=50)
        data = {
            "currentRunId": self.run_id,
            "projectGoal": snapshot["projectGoal"],
            "exportedAt": utc_now(),
            "sourceOfTruth": "sqlite",
            "database": str(self.db_path),
            "tasks": snapshot["tasks"],
            "counts": snapshot["counts"],
            "progressPercent": snapshot["progressPercent"],
        }
        self.tasks_json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return data

    def meta_value(self, conn: sqlite3.Connection, key: str) -> str | None:
        row = conn.execute("select value from meta where key=?", (key,)).fetchone()
        return str(row["value"]) if row else None

    def run_project_goal(self, conn: sqlite3.Connection) -> str:
        row = conn.execute("select project_goal from runs where id=?", (self.run_id,)).fetchone()
        return str(row["project_goal"]) if row else ""

    def _migrate_tasks_table(self, conn: sqlite3.Connection) -> None:
        if not table_exists(conn, "tasks"):
            self._create_tasks_table(conn)
            return
        columns = {row["name"] for row in conn.execute("pragma table_info(tasks)").fetchall()}
        pk_columns = [row["name"] for row in sorted(conn.execute("pragma table_info(tasks)").fetchall(), key=lambda row: row["pk"]) if row["pk"]]
        if "run_id" in columns and pk_columns == ["run_id", "id"]:
            return
        old_name = f"tasks_migrate_{uuid.uuid4().hex[:8]}"
        conn.execute(f"alter table tasks rename to {old_name}")
        self._create_tasks_table(conn)
        old_columns = {row["name"] for row in conn.execute(f"pragma table_info({old_name})").fetchall()}
        run_expr = "coalesce(run_id, 'legacy')" if "run_id" in old_columns else "'legacy'"
        max_attempts_expr = "max_attempts" if "max_attempts" in old_columns else "3"
        conn.execute(
            f"""
            insert into tasks(
              run_id, id, title, goal, scope, acceptance_criteria, verify_commands,
              status, assigned_agent, attempts, max_attempts, last_error, created_at, updated_at
            )
            select {run_expr}, id, title, goal, scope, acceptance_criteria, verify_commands,
                   status, assigned_agent, attempts, {max_attempts_expr}, last_error, created_at, updated_at
            from {old_name}
            """
        )
        conn.execute(f"drop table {old_name}")
        self._ensure_run(conn, LEGACY_RUN_ID)

    def _migrate_events_table(self, conn: sqlite3.Connection) -> None:
        if not table_exists(conn, "events"):
            conn.execute(
                """
                create table events (
                  id integer primary key autoincrement,
                  run_id text not null,
                  at text not null,
                  type text not null,
                  task_id text,
                  agent text,
                  message text,
                  payload text not null
                )
                """
            )
            return
        columns = {row["name"] for row in conn.execute("pragma table_info(events)").fetchall()}
        if "run_id" not in columns:
            conn.execute("alter table events add column run_id text not null default 'legacy'")
            self._ensure_run(conn, LEGACY_RUN_ID)

    def _migrate_reviews_table(self, conn: sqlite3.Connection) -> None:
        if not table_exists(conn, "reviews"):
            conn.execute(
                """
                create table reviews (
                  id integer primary key autoincrement,
                  run_id text not null,
                  at text not null,
                  task_id text not null,
                  kind text not null,
                  status text not null,
                  summary text not null,
                  payload text not null
                )
                """
            )
            return
        columns = {row["name"] for row in conn.execute("pragma table_info(reviews)").fetchall()}
        if "run_id" not in columns:
            conn.execute("alter table reviews add column run_id text not null default 'legacy'")
            self._ensure_run(conn, LEGACY_RUN_ID)

    def _create_tasks_table(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            """
            create table tasks (
              run_id text not null,
              id text not null,
              title text not null,
              goal text not null,
              scope text not null,
              acceptance_criteria text not null,
              verify_commands text not null,
              status text not null,
              assigned_agent text,
              attempts integer not null default 0,
              max_attempts integer not null default 3,
              last_error text,
              created_at text not null,
              updated_at text not null,
              primary key(run_id, id)
            )
            """
        )

    def _ensure_column(self, conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
        columns = {row["name"] for row in conn.execute(f"pragma table_info({table})").fetchall()}
        if column not in columns:
            conn.execute(f"alter table {table} add column {column} {definition}")

    def _ensure_run(self, conn: sqlite3.Connection, run_id: str) -> None:
        now = utc_now()
        conn.execute(
            "insert into runs(id, created_at, updated_at, project_goal) values (?, ?, ?, '') "
            "on conflict(id) do nothing",
            (run_id, now, now),
        )

    def _append_event(
        self,
        conn: sqlite3.Connection,
        event_type: str,
        *,
        task_id: str | None = None,
        agent: str | None = None,
        message: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        conn.execute(
            "insert into events(run_id, at, type, task_id, agent, message, payload) values (?, ?, ?, ?, ?, ?, ?)",
            (self.run_id, utc_now(), event_type, task_id, agent, message, json.dumps(payload or {}, ensure_ascii=False)),
        )


def row_to_task(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "runId": row["run_id"],
        "id": row["id"],
        "title": row["title"],
        "goal": row["goal"],
        "scope": row["scope"],
        "acceptanceCriteria": json.loads(row["acceptance_criteria"]),
        "verifyCommands": json.loads(row["verify_commands"]),
        "status": row["status"],
        "assignedAgent": row["assigned_agent"],
        "attempts": row["attempts"],
        "maxAttempts": row["max_attempts"],
        "lastError": row["last_error"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def row_to_event(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "runId": row["run_id"],
        "at": row["at"],
        "type": row["type"],
        "taskId": row["task_id"],
        "agent": row["agent"],
        "message": row["message"],
        "payload": json.loads(row["payload"]),
    }


def row_to_review(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "runId": row["run_id"],
        "at": row["at"],
        "taskId": row["task_id"],
        "kind": row["kind"],
        "status": row["status"],
        "summary": row["summary"],
        "payload": json.loads(row["payload"]),
    }


def current_task_for(tasks: list[dict[str, Any]]) -> dict[str, Any] | None:
    priorities = [
        "IN_PROGRESS",
        "REVIEW_PENDING",
        "MIMO_REJECTED",
        "LOCAL_FAILED",
        "BLOCKED",
        "DEGRADED_PASS",
        "PENDING",
    ]
    for status in priorities:
        task = next((item for item in tasks if item.get("status") == status), None)
        if task is not None:
            return task
    return None


def create_active_run(root: Path | str) -> dict[str, Any]:
    root = Path(root)
    runtime = root / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    run_id = f"run-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    payload = {"currentRunId": run_id, "createdAt": utc_now()}
    (runtime / "active-run.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    TeamflowStore(root, run_id=run_id).export_tasks_json()
    return payload


def read_active_run_id(root: Path | str) -> str | None:
    path = Path(root) / "runtime" / "active-run.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    value = payload.get("currentRunId") or payload.get("runId")
    return str(value) if value else None


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute("select name from sqlite_master where type='table' and name=?", (table,)).fetchone()
    return row is not None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def next_task_number(task_ids: list[str]) -> int:
    numbers: list[int] = []
    for task_id in task_ids:
        if task_id.startswith("task-"):
            try:
                numbers.append(int(task_id.split("-", 1)[1]))
            except ValueError:
                continue
    return (max(numbers) if numbers else 0) + 1
