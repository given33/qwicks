import json
import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from teamflow_v2.mimo import (
    DEFAULT_MIMO_BASE_URL,
    DEFAULT_MIMO_MODEL,
    MimoReviewer,
    build_anthropic_messages_payload,
    extract_anthropic_text,
    post_anthropic_messages,
)


def test_mimo_reviewer_defaults_to_xiaomi_anthropic_token_plan(monkeypatch):
    monkeypatch.delenv("MIMO_BASE_URL", raising=False)
    monkeypatch.delenv("MIMO_MODEL", raising=False)
    monkeypatch.delenv("MIMO_API_KEY", raising=False)
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "secret-from-env")

    reviewer = MimoReviewer()

    assert reviewer.base_url == DEFAULT_MIMO_BASE_URL
    assert reviewer.model == DEFAULT_MIMO_MODEL
    assert reviewer.api_key == "secret-from-env"


def test_mimo_reviewer_accepts_common_key_aliases(monkeypatch):
    monkeypatch.delenv("MIMO_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-api-key")

    assert MimoReviewer().api_key == "anthropic-api-key"

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("XIAOMI_MIMO_API_KEY", "xiaomi-mimo-key")

    assert MimoReviewer().api_key == "xiaomi-mimo-key"


def test_anthropic_messages_payload_contains_review_prompt():
    payload = build_anthropic_messages_payload(
        "mimo-test",
        {
            "task": {"title": "Build parser"},
            "summary": "done",
            "changedFiles": ["parser.py"],
            "commandsRun": ["pytest"],
            "localVerification": {"status": "PASSED"},
            "diff": "diff --git a/parser.py b/parser.py",
        },
    )

    assert payload["model"] == "mimo-test"
    assert payload["messages"][0]["role"] == "user"
    assert "Build parser" in payload["messages"][0]["content"]
    assert "VERDICT: PASS|REJECT" in payload["messages"][0]["content"]


def test_post_anthropic_messages_uses_messages_endpoint_and_headers(monkeypatch):
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps({"content": [{"type": "text", "text": "VERDICT: PASS"}]}).encode("utf-8")

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["headers"] = dict(request.header_items())
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    result = post_anthropic_messages(
        base_url="https://token-plan-cn.xiaomimimo.com/anthropic/",
        api_key="secret-token",
        body={"model": "mimo", "messages": []},
        timeout=12,
    )

    assert captured["url"] == "https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages"
    assert captured["headers"]["X-api-key"] == "secret-token"
    assert captured["headers"]["Anthropic-version"] == "2023-06-01"
    assert captured["body"]["model"] == "mimo"
    assert captured["timeout"] == 12
    assert result["content"][0]["text"] == "VERDICT: PASS"


def test_post_anthropic_messages_masks_secrets_in_http_errors(monkeypatch):
    secret = "tp-c1example-secret"

    class ErrorBody:
        def read(self):
            return f'{{"error":"invalid key {secret}"}}'.encode("utf-8")

        def close(self):
            pass

    def fake_urlopen(_request, timeout):
        assert timeout == 1
        raise urllib.error.HTTPError(
            url="https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages",
            code=401,
            msg="Unauthorized",
            hdrs={},
            fp=ErrorBody(),
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    with pytest.raises(RuntimeError) as error:
        post_anthropic_messages(
            base_url="https://token-plan-cn.xiaomimimo.com/anthropic",
            api_key=secret,
            body={"model": "mimo"},
            timeout=1,
        )

    message = str(error.value)
    assert secret not in message
    assert "[redacted]" in message


def test_extract_anthropic_text_concatenates_text_blocks():
    response = {
        "content": [
            {"type": "text", "text": "VERDICT: PASS"},
            {"type": "tool_use", "name": "ignored"},
            {"type": "text", "text": "SUMMARY: ok"},
        ]
    }

    assert extract_anthropic_text(response) == "VERDICT: PASS\nSUMMARY: ok"
