from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def test_web_dashboard_project_files_exist():
    for path in [
        WEB / "package.json",
        WEB / "vite.config.js",
        WEB / "tailwind.config.js",
        WEB / "src" / "App.jsx",
        WEB / "src" / "mockStatus.js",
        WEB / "src" / "index.css",
    ]:
        assert path.exists(), f"missing {path}"


def test_web_dashboard_does_not_use_truncation_classes():
    forbidden = ["truncate", "text-ellipsis", "whitespace-nowrap"]
    checked = []
    for path in [WEB / "src" / "App.jsx", WEB / "src" / "index.css"]:
        text = path.read_text(encoding="utf-8")
        checked.append(path.name)
        for token in forbidden:
            assert token not in text, f"{token} appears in {path}"
    assert checked


def test_web_dashboard_mock_contains_long_message_and_wrapping_classes():
    app = (WEB / "src" / "App.jsx").read_text(encoding="utf-8")
    mock = (WEB / "src" / "mockStatus.js").read_text(encoding="utf-8")

    assert "break-words" in app
    assert "break-all" in app
    assert "whitespace-pre-wrap" in app
    assert "overflow-hidden" in app
    assert "min-w-0" in app
    assert "[overflow-wrap:anywhere]" in app
    assert "overflow-y-auto" in app
    assert len(mock) > 1200


def test_web_dashboard_contains_json_protocol_parser_and_item_merge_hooks():
    app = (WEB / "src" / "App.jsx").read_text(encoding="utf-8")

    for token in [
        "function parseLogEntry(",
        "function normalizeEvent(",
        "function mapToTimelineItem(",
        "sourceItemId",
        "item.started",
        "item.completed",
        "turn.started",
        "turn.completed",
        "thread.started",
        "thread.completed",
    ]:
        assert token in app, f"missing parser token: {token}"

    assert "const parsed = parseLogEntry(merged.text);" in app
    assert "const mergeKey = `${merged.runId || \"\"}|${merged.agent || \"\"}|${merged.sourceItemId}`;" in app


def test_web_dashboard_pipeline_and_intervention_tokens_exist():
    app = (WEB / "src" / "App.jsx").read_text(encoding="utf-8")

    for token in [
        "任务流水线",
        "人工干预",
        "待处理",
        "开发中",
        "本地验证中",
        "逻辑评审中",
        "已被打回",
        "已交付",
        "已阻塞",
        "已取消",
        "继续",
        "修改并重试",
        "标记完成",
        "终止",
        "continue_task",
        "retry_task_with_instruction",
        "mark_task_completed",
        "terminate_task_and_codex",
    ]:
        assert token in app


def test_web_dashboard_realtime_event_pipeline_tokens_exist():
    app = (WEB / "src" / "App.jsx").read_text(encoding="utf-8")
    client = (WEB / "src" / "tauriClient.js").read_text(encoding="utf-8")

    for token in [
        "teamflow_realtime",
        "applyRealtimeEnvelope",
        "bootstrapRealtimeStream",
        "get_realtime_config",
        "get_realtime_events",
        "run_realtime_benchmark",
        "latency_probe",
        "summarizeLatency",
        "50",
    ]:
        assert token in app or token in client, f"missing realtime token: {token}"


def test_web_dashboard_mock_codex_bridge_state_updates_after_send_and_interrupt():
    client = (WEB / "src" / "tauriClient.js").read_text(encoding="utf-8")

    for token in [
        "updateMockCodexBridge({",
        'codexState: "RUNNING"',
        'codexState: "INTERRUPTED"',
        "interruptRequested: true",
        "activeCodexSessionId: sessionId",
    ]:
        assert token in client, f"missing mock bridge token: {token}"


def test_web_dashboard_suppresses_benign_codex_protocol_warnings_from_intervention_cards():
    app = (WEB / "src" / "App.jsx").read_text(encoding="utf-8")

    for token in [
        "function isBenignAgentWarning(",
        "codex_protocol::openai_models",
        "Model personality requested",
        "isBenignAgentWarning(message)",
        "hasBlockedTaskForMessage",
    ]:
        assert token in app, f"missing benign warning guard token: {token}"

    assert "需要你介入" not in app
    assert "deriveInterventionCard(" not in app


def test_session_sidebar_keeps_current_blank_run_visible_and_shows_summary_time_only():
    app = (WEB / "src" / "App.jsx").read_text(encoding="utf-8")

    for token in [
        "function ensureCurrentRunVisible(",
        "currentRunPlaceholder",
        "summary: summarizeRunForSidebar(run)",
        "time: formatDateTime(run.lastActivityAt || run.updatedAt || run.createdAt || \"\")",
        "currentRunGroup",
        'groups={ensureCurrentRunVisible(runGroups, status)}',
        'group.key === "current-run"',
    ]:
        assert token in app, f"missing current run sidebar token: {token}"

    normalize_source = app.split("function normalizeBackendRunGroups", 1)[1].split("function summarizeRunForSidebar", 1)[0]
    assert ".filter((run) => run?.runId)" in normalize_source
    assert "Number(run.total || 0)" not in normalize_source

    run_item_source = app.split("function RunListItem", 1)[1].split("function DeleteConfirmDialog", 1)[0]
    assert "run.summary" in run_item_source
    assert "run.time" in run_item_source
    assert "runStatusLabel(run.status)" not in run_item_source


def test_frontend_uses_safe_clone_fallback_for_webview2():
    app = (WEB / "src" / "App.jsx").read_text(encoding="utf-8")
    client = (WEB / "src" / "tauriClient.js").read_text(encoding="utf-8")

    for source in [app, client]:
        assert "function cloneData(value)" in source
        assert 'typeof structuredClone === "function"' in source
        assert "JSON.parse(JSON.stringify(value))" in source

    assert "structuredClone(" not in app.replace("structuredClone(value)", "")


def test_toolbar_is_rendered_only_in_agent_panel_not_as_browser_global():
    app = (WEB / "src" / "App.jsx").read_text(encoding="utf-8")
    agent_panel_source = app.split("function AgentPanel", 1)[1].split("function CodexModelSwitch", 1)[0]
    claude_panel_source = app.split("function ClaudeReadonlyPanel", 1)[1].split("function ReadOnlyCard", 1)[0]

    assert "toolbar = null" in agent_panel_source
    assert "{toolbar ? <div" in agent_panel_source
    assert "{toolbar" not in claude_panel_source
