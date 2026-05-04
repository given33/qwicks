import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
TAURI = ROOT / "src-tauri"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_tauri_desktop_project_files_exist():
    for path in [
        WEB / "package.json",
        ROOT / "package.json",
        WEB / "src" / "App.jsx",
        WEB / "src" / "tauriClient.js",
        WEB / "src" / "mockStatus.js",
        TAURI / "Cargo.toml",
        TAURI / "tauri.conf.json",
        TAURI / "src" / "main.rs",
        TAURI / "src" / "lib.rs",
        TAURI / "teamflow-mcp" / "src" / "main.rs",
        ROOT / "scripts" / "start-teamflow-desktop.ps1",
        ROOT / "scripts" / "build-teamflow-desktop.ps1",
    ]:
        assert path.exists(), f"missing desktop file: {path}"


def test_main_binary_uses_windows_gui_subsystem_for_release():
    main_rs = read(TAURI / "src" / "main.rs")
    assert 'windows_subsystem = "windows"' in main_rs


def test_package_scripts_use_tauri_desktop_as_default():
    package = json.loads(read(ROOT / "package.json"))
    web_package = json.loads(read(WEB / "package.json"))

    assert package["name"] == "teamflow-desktop-root"
    assert "prepare:sidecar" in package["scripts"]
    assert "tauri dev" in package["scripts"]["dev"]
    assert "prepare:sidecar" in package["scripts"]["build"]
    assert "tauri build" in package["scripts"]["build"]
    assert package["scripts"]["web:build"] == "npm --prefix web run web:build"

    assert web_package["name"] == "teamflow-desktop"
    assert web_package["scripts"]["dev"] == "npm --prefix .. run dev"
    assert web_package["scripts"]["build"] == "npm --prefix .. run build"
    assert web_package["scripts"]["web:build"] == "vite build"
    assert "@tauri-apps/api" in web_package["dependencies"]
    assert "@tauri-apps/cli" in package["devDependencies"]


def test_tauri_config_is_desktop_app_and_bundles_mcp_sidecar():
    config = json.loads(read(TAURI / "tauri.conf.json"))

    assert config["productName"] == "Teamflow Desktop"
    assert config["identifier"] == "local.teamflow.desktop"
    assert config["build"]["beforeBuildCommand"] == "npm run web:build"
    assert config["bundle"]["active"] is True
    assert config["bundle"]["targets"] == ["msi", "nsis"]
    assert any("teamflow-mcp" in item for item in config["bundle"]["externalBin"])
    assert "warp" not in json.dumps(config).lower()


def test_build_script_prepares_sidecar_and_bootstraps_cargo_path():
    build_script = read(ROOT / "scripts" / "build-teamflow-desktop.ps1")
    start_script = read(ROOT / "scripts" / "start-teamflow-desktop.ps1")

    for script in [build_script, start_script]:
        assert r"C:\Users\28219\.cargo\bin" in script
        assert "cargo" in script
        assert "Node.js/npm" in script

    assert "teamflow-mcp-x86_64-pc-windows-msvc.exe" in build_script
    assert "cargo build --manifest-path" in build_script
    assert "npx tauri build" in build_script or "npm run build" in build_script


def test_rust_backend_exposes_required_tauri_commands_and_schema():
    rust = read(TAURI / "src" / "lib.rs")

    for command in [
        "create_run",
        "list_runs_grouped",
        "switch_run",
        "delete_run",
        "get_status",
        "get_realtime_config",
        "get_realtime_events",
        "run_realtime_benchmark",
        "set_codex_model_provider",
        "send_codex_message",
        "interrupt_codex_session",
        "start_claude_worker",
        "pause_worker",
        "resume_worker",
        "cancel_task",
        "continue_task",
        "retry_task_with_instruction",
        "mark_task_completed",
        "terminate_task_and_codex",
        "open_diagnostics",
        "export_tasks_json",
    ]:
        assert f"fn {command}" in rust or f"async fn {command}" in rust
        assert command in rust

    for table in [
        "agent_sessions",
        "agent_messages",
        "raw_transcripts",
        "process_events",
    ]:
        assert table in rust

    for status in [
        "PENDING",
        "IN_PROGRESS",
        "LOCAL_FAILED",
        "REVIEW_PENDING",
        "MIMO_REJECTED",
        "COMPLETED",
        "DEGRADED_PASS",
        "BLOCKED",
        "CANCELLED",
    ]:
        assert status in rust

    for text in [
        "当前没有 active run",
        "后台 CLI 会话已启动",
        "缺少启动命令",
        "会话信息",
        "本地验证",
        "MiMo 审查",
        "会话已闲置超过 30 分钟，Codex 已休眠释放资源。",
        "Codex 常驻桥接会话",
    ]:
        assert text in rust

    for kind in [
        "thinking",
        "tool_call",
        "command",
        "file_action",
        "task_action",
        "review",
        "error",
        "done",
        "status",
        "teamflow_realtime",
    ]:
        assert kind in rust

    for token in [
        "CodexModelProvider",
        "codexModelSelection",
        "mimo-v2.5-pro",
        "https://token-plan-cn.xiaomimimo.com/v1",
        "MIMO_API_KEY",
    ]:
        assert token in rust


def test_mcp_sidecar_exposes_teamflow_tools():
    sidecar_main = read(TAURI / "teamflow-mcp" / "src" / "main.rs")
    sidecar_lib = read(TAURI / "teamflow-mcp" / "src" / "lib.rs")
    sidecar = sidecar_main + "\n" + sidecar_lib

    for tool in [
        "delegate_task_and_wait",
        "cancel_task",
        "get_task",
        "submit_review",
        "get_status",
        "export_tasks_json",
        "plan_tasks",
    ]:
        assert tool in sidecar

    assert "teamflow_mcp::run();" in sidecar_main
    assert "Content-Length" in sidecar
    assert "tools/list" in sidecar
    assert "tools/call" in sidecar
    assert "rusqlite" in sidecar
    assert "未知 Teamflow MCP 工具" in sidecar


def test_react_ui_is_three_column_desktop_chat_workspace():
    app = read(WEB / "src" / "App.jsx")

    for text in [
        "Codex 架构师",
        "任务中控",
        "Claude 执行者",
        "诊断",
        "会话信息",
        "关键动作",
        "本地验证",
        "MiMo 审查",
        "标准错误",
        "原始 CLI 输出",
        "continue_task",
        "retry_task_with_instruction",
        "mark_task_completed",
        "terminate_task_and_codex",
        "send_codex_message",
        "start_claude_worker",
        "open_diagnostics",
    ]:
        assert text in app

    assert "/api/status" not in app
    assert "warp://launch" not in app
    assert "whitespace-nowrap" not in app
    assert "text-ellipsis" not in app
    assert "truncate" not in app


def test_codex_model_switch_ui_is_present_without_secret_leak():
    app = read(WEB / "src" / "App.jsx")
    client = read(WEB / "src" / "tauriClient.js")
    mock_status = read(WEB / "src" / "mockStatus.js")
    combined = app + "\n" + client + "\n" + mock_status

    for token in [
        "CodexModelSwitch",
        "set_codex_model_provider",
        "codexModelSelection",
        "默认 GPT-5.5",
        "MiMo V2.5 Pro",
        "mimo-v2.5-pro",
    ]:
        assert token in combined

    assert "tp-" not in combined
    assert "Codex 正在运行中，请先中断当前轮次再切换模型。" not in combined


def test_mock_status_and_client_are_clean_utf8_chinese():
    mock_status = read(WEB / "src" / "mockStatus.js")
    tauri_client = read(WEB / "src" / "tauriClient.js")

    for text in [
        "\u6784\u5efa Teamflow Desktop \u4e09\u680f\u5de5\u4f5c\u53f0\uff0c\u5b8c\u6574\u5c55\u793a\u4efb\u52a1\u3001\u5ba1\u67e5\u548c\u8bca\u65ad\u4fe1\u606f\u3002",
        "\u8fd9\u662f\u4e00\u4e2a\u7528\u4e8e\u9a8c\u8bc1\u6d88\u606f\u5217\u4e0d\u4f1a\u622a\u65ad\u7684\u8d85\u957f MiMo \u5ba1\u67e5\u6587\u672c",
        "\u7b49\u5f85\u4f60\u8f93\u5165\u9879\u76ee\u76ee\u6807",
        "Codex \u9884\u89c8\u4f1a\u8bdd",
    ]:
        assert text in mock_status or text in tauri_client

    for broken in ["閺嬭埖鐎", "娴犺濮", "鐠囧﹥鏌", "瀹稿弶甯撮弨", "閿涙"]:
        assert broken not in mock_status
        assert broken not in tauri_client


def test_desktop_launcher_does_not_start_warp():
    script = read(ROOT / "scripts" / "start-teamflow-desktop.ps1")
    desktop = Path(r"C:\Users\28219\Desktop\Open-Teamflow-Workflow.cmd")
    desktop_text = read(desktop) if desktop.exists() else ""

    assert "npm run dev" in script or "tauri dev" in script or "tauri build" in script
    assert "warp://launch" not in script.lower()
    assert "start-teamflow-v2.ps1" not in desktop_text
    assert "start-teamflow-desktop.ps1" in desktop_text
    assert "warp://launch" not in desktop_text.lower()


def test_desktop_launcher_is_dev_fallback_not_formal_product_entry():
    desktop_text = read(Path(r"C:\Users\28219\Desktop\Open-Teamflow-Workflow.cmd"))

    assert "development fallback" in desktop_text.lower()
    assert "Teamflow Desktop Installer" in desktop_text
