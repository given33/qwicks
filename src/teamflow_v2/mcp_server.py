from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

from .controller import TeamflowController


def create_mcp_server(root: Path | str | None = None) -> FastMCP:
    teamflow_root = Path(root or os.environ.get("TEAMFLOW_ROOT", r"D:\MCP\teamflow"))
    controller = TeamflowController(teamflow_root)
    mcp = FastMCP("teamflow-v2")

    @mcp.tool()
    def plan_tasks(project_goal: str, tasks: list[dict[str, Any]]) -> dict[str, Any]:
        """Codex writes the project task plan through the SQLite-backed Teamflow controller."""
        return controller.plan_tasks(project_goal, tasks)

    @mcp.tool()
    def delegate_task_and_wait(
        title: str,
        goal: str,
        scope: str,
        acceptanceCriteria: list[str],
        verifyCommands: list[dict[str, Any]],
        timeoutSeconds: float = 3600,
        pollSeconds: float = 2,
        maxAttempts: int = 3,
    ) -> dict[str, Any]:
        """Codex delegates one task and blocks until Claude completes, blocks, degrades, or times out."""
        return controller.delegate_task_and_wait(
            title,
            goal,
            scope,
            acceptanceCriteria,
            verifyCommands,
            timeout_seconds=timeoutSeconds,
            poll_seconds=pollSeconds,
            max_attempts=maxAttempts,
        )

    @mcp.tool()
    def cancel_task(task_id: str, reason: str, agent: str = "codex") -> dict[str, Any]:
        """Cancel a non-terminal task before Codex takes over or redelegates."""
        return controller.cancel_task(task_id, reason, agent)

    @mcp.tool()
    def get_task(agent: str = "claude") -> dict[str, Any]:
        """Claim the next pending task atomically."""
        return controller.get_task(agent)

    @mcp.tool()
    def submit_review(
        task_id: str,
        summary: str,
        changed_files: list[str] | None = None,
        commands_run: list[str] | None = None,
    ) -> dict[str, Any]:
        """Submit task work for local verification and MiMo review."""
        return controller.submit_review(task_id, summary, changed_files or [], commands_run or [])

    @mcp.tool()
    def get_status() -> dict[str, Any]:
        """Read current task board, progress, reviews, and recent events."""
        return controller.get_status()

    @mcp.tool()
    def export_tasks_json() -> dict[str, Any]:
        """Export a read-only tasks.json snapshot from SQLite."""
        return controller.export_tasks_json()

    return mcp


def main() -> None:
    create_mcp_server().run(transport="stdio")


if __name__ == "__main__":
    main()
