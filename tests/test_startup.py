import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from teamflow_v2.launch import (
    build_claude_mcp_config,
    build_start_commands,
    build_warp_launch_yaml,
)


def test_claude_mcp_config_points_at_v2_stdio_server(tmp_path):
    config = build_claude_mcp_config(tmp_path)

    server = config["mcpServers"]["teamflow-v2"]
    assert server["type"] == "stdio"
    assert server["command"] == "python"
    assert "mimo_mcp_server.py" in server["args"][0]
    assert server["env"]["TEAMFLOW_ROOT"] == str(tmp_path)
    assert server["env"]["MIMO_BASE_URL"] == "https://token-plan-cn.xiaomimimo.com/anthropic"
    assert server["env"]["MIMO_MODEL"] == "mimo-v2.5-pro"


def test_start_commands_hide_environment_and_use_pane_scripts(tmp_path):
    commands = build_start_commands(tmp_path)

    assert commands["codex"].endswith('scripts\\start-codex-pane.ps1"')
    assert commands["dashboard"].endswith('scripts\\start-dashboard-pane.ps1"')
    assert commands["claude"].endswith('scripts\\start-claude-worker-pane.ps1"')
    for command in commands.values():
        assert "$env:" not in command
        assert "MIMO_BASE_URL" not in command
        assert "ANTHROPIC_BASE_URL" not in command
        assert "tp-" not in command


def test_warp_launch_yaml_has_three_panes_and_uses_claude_worker(tmp_path):
    yaml = build_warp_launch_yaml(tmp_path)

    assert "Teamflow V2 MCP" in yaml
    assert yaml.count("- cwd:") == 3
    assert "Dashboard" in yaml
    assert "Codex" in yaml
    assert "Claude Worker" in yaml
    assert "start-claude-worker-pane.ps1" in yaml
    assert "$env:" not in yaml
    assert "MIMO_BASE_URL" not in yaml
    assert "ANTHROPIC_BASE_URL" not in yaml
    assert "tp-" not in yaml


def test_main_startup_script_uses_shared_teamflow_env():
    script = (Path(__file__).resolve().parents[1] / "start-teamflow-v2.ps1").read_text(
        encoding="utf-8"
    )

    assert "scripts\\teamflow-env.ps1" in script
    assert "New-TeamflowRun" in script
    assert "active-run.json" not in script
    assert "https://token-plan-cn.xiaomimimo.com/anthropic" not in script
    assert "mimo-v2.5-pro" not in script
    assert "Resolve-TeamflowMimoKey" not in script


def test_sync_overwrites_legacy_warp_names_writes_scripts_and_workspace_rules(
    tmp_path, monkeypatch
):
    import teamflow_v2.launch as launch

    monkeypatch.setattr(launch, "WARP_DATA", tmp_path / "warp-data")
    monkeypatch.setattr(launch, "HOME_WARP", tmp_path / "home-warp")
    monkeypatch.setattr(
        launch,
        "DESKTOP_LAUNCHER",
        tmp_path / "Desktop" / "Open-Teamflow-Workflow.cmd",
    )
    global_codex = tmp_path / "global-codex" / "AGENTS.md"
    global_claude = tmp_path / "global-claude" / "soul.md"
    global_codex.parent.mkdir()
    global_claude.parent.mkdir()
    global_codex.write_text("global codex rules\n", encoding="utf-8")
    global_claude.write_text("global claude soul\n", encoding="utf-8")
    monkeypatch.setattr(launch, "GLOBAL_CODEX_AGENTS", global_codex)
    monkeypatch.setattr(launch, "GLOBAL_CLAUDE_SOUL", global_claude)

    launch.sync_launch_files(tmp_path / "teamflow")

    root = tmp_path / "teamflow"
    workspace = root / "workspace"
    scripts = root / "scripts"
    assert (root / "runtime" / "teamflow.sqlite3").exists()
    assert (root / "runtime" / "tasks.json").exists()
    assert (workspace / "AGENTS.md").exists()
    assert (workspace / "CLAUDE.md").exists()
    assert (workspace / "soul.md").exists()
    for name in [
        "teamflow-env.ps1",
        "start-codex-pane.ps1",
        "start-dashboard-pane.ps1",
        "start-dashboard-rich.ps1",
        "start-claude-worker-pane.ps1",
        "start-claude-interactive.ps1",
    ]:
        assert (scripts / name).exists()
    dashboard_script = (scripts / "start-dashboard-pane.ps1").read_text(encoding="utf-8")
    rich_script = (scripts / "start-dashboard-rich.ps1").read_text(encoding="utf-8")
    assert "npm run dev" in dashboard_script
    assert "Start-Process 'http://127.0.0.1:5173'" in dashboard_script
    assert "dashboard.py" in rich_script

    agents = (workspace / "AGENTS.md").read_text(encoding="utf-8")
    claude = (workspace / "CLAUDE.md").read_text(encoding="utf-8")
    soul = (workspace / "soul.md").read_text(encoding="utf-8")
    combined = agents + claude + soul
    assert "Teamflow V2 架构师" in agents
    assert "Teamflow V2 执行者" in claude
    assert "SQLite 是唯一真值" in soul
    assert "delegate_task_and_wait" in agents
    assert "cancel_task" in agents
    assert "tp-" not in combined
    assert "娴ｇ姵" not in combined
    assert "閻" not in combined
    assert global_codex.read_text(encoding="utf-8") == "global codex rules\n"
    assert global_claude.read_text(encoding="utf-8") == "global claude soul\n"

    legacy_workflow = (tmp_path / "warp-data" / "workflows" / "teamflow.yaml").read_text(
        encoding="utf-8"
    )
    legacy_launch = (
        tmp_path / "warp-data" / "launch_configurations" / "teamflow-supervisor.yaml"
    ).read_text(encoding="utf-8")
    desktop = (
        tmp_path / "Desktop" / "Open-Teamflow-Workflow.cmd"
    ).read_text(encoding="utf-8")

    assert "Teamflow V2 MCP" in legacy_launch
    assert "start-teamflow-v2.ps1" in legacy_workflow
    assert "start-teamflow-v2.ps1" in desktop
    assert "$env:" not in legacy_launch
    assert "tp-" not in legacy_launch
