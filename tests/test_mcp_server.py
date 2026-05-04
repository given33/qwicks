import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from teamflow_v2.mcp_server import create_mcp_server


def test_mcp_server_exposes_required_teamflow_tools(tmp_path):
    server = create_mcp_server(tmp_path)

    tool_names = set(server._tool_manager._tools.keys())
    assert {
        "plan_tasks",
        "delegate_task_and_wait",
        "cancel_task",
        "get_task",
        "submit_review",
        "get_status",
        "export_tasks_json",
    }.issubset(tool_names)
