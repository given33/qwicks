from __future__ import annotations

import argparse
import json
from pathlib import Path

from .mimo import DEFAULT_MIMO_BASE_URL, DEFAULT_MIMO_MODEL


USER_ROOT = r"C:\Users\28219"
WARP_DATA = Path(USER_ROOT) / "AppData" / "Roaming" / "warp" / "Warp" / "data"
HOME_WARP = Path(USER_ROOT) / ".warp"
DESKTOP_LAUNCHER = Path(USER_ROOT) / "Desktop" / "Open-Teamflow-Workflow.cmd"
GLOBAL_CODEX_AGENTS = Path(USER_ROOT) / ".codex" / "AGENTS.md"
GLOBAL_CLAUDE_SOUL = Path(USER_ROOT) / ".claude" / "soul.md"
LAUNCH_NAME = "Teamflow V2 MCP"


def build_claude_mcp_config(root: Path | str) -> dict:
    root = Path(root)
    return {
        "mcpServers": {
            "teamflow-v2": {
                "type": "stdio",
                "command": "python",
                "args": [str(root / "mimo_mcp_server.py")],
                "env": {
                    "TEAMFLOW_ROOT": str(root),
                    "PYTHONPATH": str(root / "src"),
                    "MIMO_BASE_URL": DEFAULT_MIMO_BASE_URL,
                    "MIMO_MODEL": DEFAULT_MIMO_MODEL,
                },
            }
        }
    }


def build_start_commands(root: Path | str) -> dict[str, str]:
    root = Path(root)
    scripts = root / "scripts"
    return {
        "codex": build_pane_command(scripts / "start-codex-pane.ps1"),
        "dashboard": build_pane_command(scripts / "start-dashboard-pane.ps1"),
        "claude": build_pane_command(scripts / "start-claude-worker-pane.ps1"),
    }


def build_pane_command(script_path: Path) -> str:
    return f'powershell -NoProfile -ExecutionPolicy Bypass -File "{script_path}"'


def build_warp_launch_yaml(root: Path | str) -> str:
    root = Path(root)
    commands = build_start_commands(root)
    workspace = str(root / "workspace").replace("\\", "/")
    return f"""name: {LAUNCH_NAME}
active_window_index: 0
windows:
  - active_tab_index: 0
    tabs:
      - title: {LAUNCH_NAME}
        color: cyan
        layout:
          split_direction: horizontal
          panes:
            - cwd: {workspace}
              title: Codex
              is_focused: true
              commands:
                - exec: {commands["codex"]}
            - cwd: {workspace}
              title: Dashboard
              commands:
                - exec: {commands["dashboard"]}
            - cwd: {workspace}
              title: Claude Worker
              commands:
                - exec: {commands["claude"]}
"""


def build_tab_toml(root: Path | str) -> str:
    root = Path(root)
    commands = build_start_commands(root)
    workspace = str(root / "workspace").replace("\\", "/")
    return f'''name = "{LAUNCH_NAME}"
title = "{LAUNCH_NAME}"
color = "cyan"

[[panes]]
id = "root"
split = "horizontal"
children = ["codex", "dashboard", "claude-worker"]

[[panes]]
id = "codex"
type = "terminal"
directory = "{workspace}"
commands = ["{escape_toml(commands["codex"])}"]
is_focused = true

[[panes]]
id = "dashboard"
type = "terminal"
directory = "{workspace}"
commands = ["{escape_toml(commands["dashboard"])}"]

[[panes]]
id = "claude-worker"
type = "terminal"
directory = "{workspace}"
commands = ["{escape_toml(commands["claude"])}"]
'''


def build_workflow_yaml(root: Path | str) -> str:
    root = Path(root)
    return f'''name: Open Teamflow Agent Workflow
command: powershell -NoProfile -ExecutionPolicy Bypass -File "{root}\\start-teamflow-v2.ps1" -Restart -Warp
description: Open the Teamflow V2 Codex/Dashboard/Claude Worker MCP workspace in Warp.
tags:
  - teamflow
  - mcp
  - mimo
  - codex
  - claude
'''


def sync_launch_files(root: Path | str) -> None:
    root = Path(root)
    runtime = root / "runtime"
    workspace = root / "workspace"
    runtime.mkdir(parents=True, exist_ok=True)
    workspace.mkdir(parents=True, exist_ok=True)
    from .store import TeamflowStore

    TeamflowStore(root).export_tasks_json()
    (runtime / "claude-mcp.json").write_text(
        json.dumps(build_claude_mcp_config(root), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    sync_pane_scripts(root)
    sync_workspace_rules(root)

    launch_yaml = build_warp_launch_yaml(root)
    tab_toml = build_tab_toml(root)
    workflow_yaml = build_workflow_yaml(root)
    for directory in [
        WARP_DATA / "launch_configurations",
        HOME_WARP / "launch_configurations",
        WARP_DATA / "tab_configs",
        HOME_WARP / "tab_configs",
        WARP_DATA / "workflows",
        HOME_WARP / "workflows",
    ]:
        directory.mkdir(parents=True, exist_ok=True)
    for directory in [WARP_DATA / "launch_configurations", HOME_WARP / "launch_configurations"]:
        for name in ["teamflow-v2-mcp.yaml", "teamflow-supervisor.yaml", "codex_claude_workflow.yaml"]:
            (directory / name).write_text(launch_yaml, encoding="utf-8")
    for directory in [WARP_DATA / "tab_configs", HOME_WARP / "tab_configs"]:
        for name in ["teamflow-v2-mcp.toml", "teamflow-supervisor.toml", "codex_claude_workflow.toml", "startup_config.toml"]:
            (directory / name).write_text(tab_toml, encoding="utf-8")
    for directory in [WARP_DATA / "workflows", HOME_WARP / "workflows"]:
        for name in ["teamflow-v2.yaml", "teamflow.yaml"]:
            (directory / name).write_text(workflow_yaml, encoding="utf-8")
    DESKTOP_LAUNCHER.parent.mkdir(parents=True, exist_ok=True)
    DESKTOP_LAUNCHER.write_text(build_desktop_launcher(root), encoding="utf-8")


def sync_pane_scripts(root: Path | str) -> None:
    root = Path(root)
    scripts = root / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    scripts_to_write = {
        "teamflow-env.ps1": build_teamflow_env_script(root),
        "start-codex-pane.ps1": build_codex_pane_script(),
        "start-dashboard-pane.ps1": build_dashboard_pane_script(),
        "start-dashboard-rich.ps1": build_dashboard_rich_script(),
        "start-claude-worker-pane.ps1": build_claude_worker_pane_script(),
        "start-claude-interactive.ps1": build_claude_interactive_script(),
    }
    for name, content in scripts_to_write.items():
        (scripts / name).write_text(content, encoding="utf-8")


def build_teamflow_env_script(root: Path | str) -> str:
    root = Path(root)
    workspace = root / "workspace"
    src = root / "src"
    npm_bin = Path(USER_ROOT) / "AppData" / "Roaming" / "npm"
    return f"""$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$env:TEAMFLOW_ROOT = {quote_ps(str(root))}
$env:TEAMFLOW_WORKDIR = {quote_ps(str(workspace))}
$env:USER_ROOT = {quote_ps(USER_ROOT)}
$env:PYTHONPATH = {quote_ps(str(src))}
$env:MIMO_BASE_URL = {quote_ps(DEFAULT_MIMO_BASE_URL)}
$env:MIMO_MODEL = {quote_ps(DEFAULT_MIMO_MODEL)}
$env:ANTHROPIC_BASE_URL = {quote_ps(DEFAULT_MIMO_BASE_URL)}
$env:ANTHROPIC_MODEL = {quote_ps(DEFAULT_MIMO_MODEL)}

$teamflowNpmBin = {quote_ps(str(npm_bin))}
if ((Test-Path $teamflowNpmBin) -and (($env:PATH -split ';') -notcontains $teamflowNpmBin)) {{
  $env:PATH = "$teamflowNpmBin;$env:PATH"
}}

if (-not $env:TEAMFLOW_WORKER_POLL_SECONDS) {{ $env:TEAMFLOW_WORKER_POLL_SECONDS = '2' }}
if (-not $env:TEAMFLOW_WORKER_IDLE_LOG_SECONDS) {{ $env:TEAMFLOW_WORKER_IDLE_LOG_SECONDS = '60' }}
if (-not $env:TEAMFLOW_WORKER_CLAUDE_TIMEOUT_SECONDS) {{ $env:TEAMFLOW_WORKER_CLAUDE_TIMEOUT_SECONDS = '7200' }}

function Get-TeamflowSecret {{
  param([string[]]$Names)
  foreach ($name in $Names) {{
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($value) {{ return $value }}
  }}
  foreach ($name in $Names) {{
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if ($value) {{ return $value }}
  }}
  foreach ($name in $Names) {{
    $value = [Environment]::GetEnvironmentVariable($name, 'Machine')
    if ($value) {{ return $value }}
  }}
  return $null
}}

$teamflowKey = Get-TeamflowSecret @('MIMO_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'XIAOMI_MIMO_API_KEY', 'MIMO_KEY')
if ($teamflowKey) {{
  $env:MIMO_API_KEY = $teamflowKey
  $env:ANTHROPIC_AUTH_TOKEN = $teamflowKey
}}

New-Item -ItemType Directory -Force -Path $env:TEAMFLOW_ROOT | Out-Null
New-Item -ItemType Directory -Force -Path $env:TEAMFLOW_WORKDIR | Out-Null

$activeRunPath = Join-Path $env:TEAMFLOW_ROOT 'runtime\\active-run.json'
if (Test-Path $activeRunPath) {{
  try {{
    $activeRun = Get-Content -Raw $activeRunPath | ConvertFrom-Json
    if ($activeRun.currentRunId) {{
      $env:TEAMFLOW_RUN_ID = [string]$activeRun.currentRunId
    }}
  }} catch {{
    $env:TEAMFLOW_RUN_ID = $null
  }}
}}

function global:New-TeamflowRun {{
  $payload = python -c "import json; from teamflow_v2.store import create_active_run; print(json.dumps(create_active_run(r'$env:TEAMFLOW_ROOT'), ensure_ascii=False))"
  if ($LASTEXITCODE -ne 0) {{
    throw 'Failed to create Teamflow run'
  }}
  $createdRun = $payload | ConvertFrom-Json
  $env:TEAMFLOW_RUN_ID = [string]$createdRun.currentRunId
  return $env:TEAMFLOW_RUN_ID
}}
"""


def build_codex_pane_script() -> str:
    return f""". "$PSScriptRoot\\teamflow-env.ps1"
Set-Location $env:TEAMFLOW_WORKDIR
& codex -C $env:TEAMFLOW_WORKDIR --add-dir {quote_ps(USER_ROOT)} --dangerously-bypass-approvals-and-sandbox
"""


def build_dashboard_pane_script() -> str:
    return """. "$PSScriptRoot\\teamflow-env.ps1"
Set-Location $env:TEAMFLOW_ROOT

$apiCommand = ". `"$PSScriptRoot\\teamflow-env.ps1`"; python (Join-Path `$env:TEAMFLOW_ROOT 'dashboard.py') --api-only"
Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $apiCommand) | Out-Null

$webRoot = Join-Path $env:TEAMFLOW_ROOT 'web'
Set-Location $webRoot
if (-not (Test-Path (Join-Path $webRoot 'node_modules'))) {
  npm install
}
Start-Process 'http://127.0.0.1:5173'
npm run dev
"""


def build_dashboard_rich_script() -> str:
    return """. "$PSScriptRoot\\teamflow-env.ps1"
Set-Location $env:TEAMFLOW_WORKDIR
& python (Join-Path $env:TEAMFLOW_ROOT 'dashboard.py')
"""


def build_claude_worker_pane_script() -> str:
    return """. "$PSScriptRoot\\teamflow-env.ps1"
Set-Location $env:TEAMFLOW_WORKDIR
& python -m teamflow_v2.claude_worker
"""


def build_claude_interactive_script() -> str:
    return f""". "$PSScriptRoot\\teamflow-env.ps1"
Set-Location $env:TEAMFLOW_WORKDIR
$mcpConfig = Join-Path $env:TEAMFLOW_ROOT 'runtime\\claude-mcp.json'
& claude --add-dir {quote_ps(USER_ROOT)} --permission-mode bypassPermissions --mcp-config $mcpConfig --strict-mcp-config -n 'Claude Teamflow V2 Interactive'
"""


def sync_workspace_rules(root: Path | str) -> None:
    root = Path(root)
    workspace = root / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    for name, content in build_workspace_rule_files().items():
        (workspace / name).write_text(content, encoding="utf-8")


def build_workspace_rule_files() -> dict[str, str]:
    soul = build_teamflow_soul()
    return {
        "AGENTS.md": build_codex_agents_md(),
        "CLAUDE.md": build_claude_md(soul),
        "soul.md": soul,
    }


def build_codex_agents_md() -> str:
    return """# Teamflow V2 Codex Rules

你是 Teamflow V2 架构师，只在当前 Teamflow Workflow 工作区内遵守这些规则。

## 工作方式
- 用户在 Codex pane 输入项目目标时，先在内部拆成 5-8 个低耦合、可验证、范围清晰的原子步骤。
- 默认必须使用 `teamflow-v2` MCP 的 `delegate_task_and_wait(...)`，一次只派发一个任务，并等待 Claude 完成后再派发下一个任务。
- `plan_tasks(project_goal, tasks)` 只作为兼容批量规划工具保留；除非用户明确要求批量计划，不要一次性把多个任务全部放进队列。
- 每个任务必须包含 `title`、`goal`、`scope`、`acceptanceCriteria`、`verifyCommands`。
- `verifyCommands` 必须是可在本地执行的验证命令，并带清晰 cwd/timeout 设计。
- 不直接编辑 `runtime/tasks.json`，它只是 SQLite 的导出快照。
- 不绕过 MCP 修改任务状态，不伪造审查结论。
- `delegate_task_and_wait` 返回 `TIMEOUT` 后，必须先调用 `get_status()` 检查该任务最新状态；如果需要接管或改派，必须先调用 `cancel_task(task_id, reason, agent="codex")`。
- 输出默认使用中文，必要的代码、命令、状态枚举保持原文。

## 规划质量
- 任务应能被 Claude 独立领取和完成，避免跨任务写同一批文件。
- 每个任务的验收标准要能被本地验证或 MiMo 逻辑审查判断。
- 发现需求不清时先说明假设；能安全推进时给出明确计划并使用 MCP 落库。
"""


def build_claude_md(soul: str) -> str:
    return f"""# Teamflow V2 Claude Rules

你是 Teamflow V2 执行者，只在当前 Teamflow Workflow 工作区内遵守这些规则。

## 必须遵守的执行顺序
- 先通过 `teamflow-v2` MCP 调用 `get_task(agent="claude")` 领取任务。
- 只能修改当前领取任务 scope 内的文件。
- 完成实现后必须调用 `submit_review(task_id, summary, changed_files, commands_run)`。
- 如果结果是 `LOCAL_FAILED` 或 `MIMO_REJECTED`，必须根据反馈原地修复并重新提交。
- 如果结果是 `COMPLETED`，可以继续领取下一项任务。
- 如果结果是 `DEGRADED_PASS`，必须明确提示“本地验证通过，但 MiMo 审查降级未完成”。
- 如果结果提示最后一次尝试机会，必须停止机械重试，重新审视代码逻辑、命令输出和审查反馈。
- 如果任务状态为 `CANCELLED` 或 `BLOCKED`，必须立即停止旧任务，不再提交旧任务结果，并调用 `get_task` 领取最新任务。
- 禁止绕过 MCP 流程直接修改任务状态或 `runtime/tasks.json`。
- 输出默认使用中文，必要的代码、命令、状态枚举保持原文。

## Teamflow 兼容 Soul
{soul}
"""


def build_teamflow_soul() -> str:
    return """# Teamflow V2 Soul

这是 Teamflow Workflow 专属的本地规则层，只适用于 `D:\\MCP\\teamflow\\workspace`。

## 共享原则
- SQLite 是唯一真值。
- `runtime/tasks.json` 是从 SQLite 导出的只读快照，只用于观察和排障。
- Codex 是架构师，负责通过 MCP 规划任务。
- Claude 是执行者，负责通过 MCP 领取任务、实现任务、提交审查。
- MiMo 只做逻辑审查；本地验证由 MCP 拦截层先运行。
- 任何 agent 都不能绕过 MCP 直接修改任务状态。
- 不保存、不输出、不传播 API key 或其他凭据。

## MCP 流程
- 规划：Codex 调用 `plan_tasks(project_goal, tasks)`。
- 顺序派发：Codex 默认调用 `delegate_task_and_wait(...)`，一次只派发一个任务并等待终态。
- 接管取消：Codex 在超时或改派前调用 `cancel_task(task_id, reason, agent="codex")`。
- 领取：Claude 调用 `get_task(agent="claude")`。
- 审查：Claude 调用 `submit_review(task_id, summary, changed_files, commands_run)`。
- 查询：Codex、Claude 或 Dashboard 可调用 `get_status()` 观察状态。

## 结果处理
- `LOCAL_FAILED`：本地验证失败，Claude 修复后重新提交。
- `MIMO_REJECTED`：MiMo 逻辑审查拒绝，Claude 按建议修复。
- `COMPLETED`：任务完成。
- `DEGRADED_PASS`：本地验证通过但 MiMo 不可用，必须明确标记风险。
- `CANCELLED`：任务已由 Codex 或中控接管取消，Claude 必须停止旧任务。
- `BLOCKED`：任务达到最大尝试次数或被强制阻塞，Claude 必须等待 Codex 重新派发。
"""


def build_desktop_launcher(root: Path | str) -> str:
    root = Path(root)
    return f'''@echo off
setlocal
title Open Teamflow V2 MCP Workflow
echo Starting Teamflow V2 MCP Workflow in Warp...
powershell -NoProfile -ExecutionPolicy Bypass -File "{root}\\start-teamflow-v2.ps1" -Restart -Warp
if errorlevel 1 (
  echo.
  echo Teamflow V2 failed to start. Check the error above.
  pause
  exit /b 1
)
exit /b 0
'''


def quote_ps(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def escape_toml(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=r"D:\MCP\teamflow")
    parser.add_argument("--sync", action="store_true")
    args = parser.parse_args()
    if args.sync:
        sync_launch_files(args.root)
    else:
        print(build_warp_launch_yaml(args.root))


if __name__ == "__main__":
    main()
