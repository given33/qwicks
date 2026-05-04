from __future__ import annotations

import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class CommandResult:
    command: str
    cwd: str
    timeout: int
    exit_code: int | None
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool = False


@dataclass
class VerificationResult:
    status: str
    summary: str
    commands: list[CommandResult] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "summary": self.summary,
            "commands": [command.__dict__ for command in self.commands],
        }


def run_verify_commands(commands: list[dict[str, Any]], *, workspace: Path) -> VerificationResult:
    results: list[CommandResult] = []
    if not commands:
        return VerificationResult(status="FAILED", summary="No verifyCommands were provided.", commands=[])

    for spec in commands:
        command = str(spec.get("command", "")).strip()
        if not command:
            return VerificationResult(status="FAILED", summary="verifyCommands contains an empty command.", commands=results)
        timeout = int(spec.get("timeout", 30))
        cwd = resolve_cwd(workspace, str(spec.get("cwd", ".")))
        cwd.mkdir(parents=True, exist_ok=True)
        started = time.monotonic()
        try:
            completed = subprocess.run(
                command,
                cwd=str(cwd),
                shell=True,
                text=True,
                capture_output=True,
                timeout=timeout,
            )
            duration = int((time.monotonic() - started) * 1000)
            result = CommandResult(
                command=command,
                cwd=str(cwd),
                timeout=timeout,
                exit_code=completed.returncode,
                stdout=trim_output(completed.stdout),
                stderr=trim_output(completed.stderr),
                duration_ms=duration,
            )
        except subprocess.TimeoutExpired as error:
            duration = int((time.monotonic() - started) * 1000)
            result = CommandResult(
                command=command,
                cwd=str(cwd),
                timeout=timeout,
                exit_code=None,
                stdout=trim_output(error.stdout or ""),
                stderr=trim_output(error.stderr or ""),
                duration_ms=duration,
                timed_out=True,
            )
        results.append(result)
        if result.timed_out:
            return VerificationResult(status="FAILED", summary=f"Command timed out after {timeout}s: {command}", commands=results)
        if result.exit_code != 0:
            return VerificationResult(status="FAILED", summary=f"Command failed with exit code {result.exit_code}: {command}", commands=results)

    return VerificationResult(status="PASSED", summary="All verifyCommands passed.", commands=results)


def resolve_cwd(workspace: Path, cwd: str) -> Path:
    path = Path(cwd)
    if path.is_absolute():
        return path
    return workspace / path


def trim_output(value: str, limit: int = 12000) -> str:
    text = value or ""
    if len(text) <= limit:
        return text
    return text[-limit:]
