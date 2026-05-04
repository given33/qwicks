from __future__ import annotations

import base64
import hashlib
import argparse
import os
import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any


DEFAULT_MIMO_BASE_URL = "https://token-plan-cn.xiaomimimo.com/anthropic"
DEFAULT_MIMO_MODEL = "mimo-v2.5-pro"
ANTHROPIC_VERSION = "2023-06-01"
OPENAI_CHAT_COMPLETIONS_PATH = "/chat/completions"
MIMO_KEY_ENV_NAMES = (
    "MIMO_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "XIAOMI_MIMO_API_KEY",
    "MIMO_KEY",
)


@dataclass(frozen=True)
class ReviewDecision:
    status: str
    summary: str
    suggestions: list[str] = field(default_factory=list)
    raw: str = ""

    def normalized_status(self) -> str:
        value = self.status.upper().strip()
        if value in {"PASS", "APPROVE", "APPROVED"}:
            return "PASS"
        if value in {"REJECT", "REJECTED", "FAIL", "FAILED"}:
            return "REJECT"
        return "REJECT"


class MimoReviewer:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        timeout: float = 60,
    ) -> None:
        self.base_url = base_url or os.environ.get("MIMO_BASE_URL", DEFAULT_MIMO_BASE_URL)
        self.api_key = api_key or get_mimo_api_key()
        self.model = model or os.environ.get("MIMO_MODEL", DEFAULT_MIMO_MODEL)
        self.timeout = timeout

    def review(self, payload: dict[str, Any]) -> ReviewDecision:
        if not self.api_key:
            raise RuntimeError("MiMo API key is not configured; set one of: " + ", ".join(MIMO_KEY_ENV_NAMES))

        response = post_mimo_review(
            base_url=self.base_url,
            api_key=self.api_key,
            model=self.model,
            payload=payload,
            timeout=self.timeout,
        )
        content = extract_mimo_text(response)
        return parse_review_decision(content)


def build_anthropic_messages_payload(model: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": model,
        "max_tokens": 2048,
        "temperature": 0,
        "system": (
            "You are Xiaomi MiMo acting as Teamflow's reviewer. "
            "Return a concise verdict: PASS or REJECT, followed by evidence and fix suggestions."
        ),
        "messages": [
            {
                "role": "user",
                "content": build_review_prompt(payload),
            }
        ],
    }


def build_openai_chat_payload(model: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": model,
        "temperature": 0,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are Xiaomi MiMo acting as Teamflow's reviewer. "
                    "Return a concise verdict: PASS or REJECT, followed by evidence and fix suggestions."
                ),
            },
            {
                "role": "user",
                "content": build_review_prompt(payload),
            },
        ],
    }


def get_mimo_api_key() -> str | None:
    for name in MIMO_KEY_ENV_NAMES:
        value = os.environ.get(name)
        if value:
            return value
    return None


def post_anthropic_messages(*, base_url: str, api_key: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
    url = base_url.rstrip("/") + "/v1/messages"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "content-type": "application/json",
            "anthropic-version": ANTHROPIC_VERSION,
            "x-api-key": api_key,
            "authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"MiMo Anthropic API HTTP {error.code}: {mask_secret(detail, api_key)[:1000]}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"MiMo Anthropic API request failed: {error.reason}") from error


def post_openai_chat_completions(*, base_url: str, api_key: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
    url = base_url.rstrip("/") + OPENAI_CHAT_COMPLETIONS_PATH
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {api_key}",
            "x-api-key": api_key,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"MiMo OpenAI API HTTP {error.code}: {mask_secret(detail, api_key)[:1000]}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"MiMo OpenAI API request failed: {error.reason}") from error


def post_mimo_review(*, base_url: str, api_key: str, model: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    normalized = normalize_mimo_base_url(base_url)
    if is_anthropic_base_url(normalized):
        return post_anthropic_messages(
            base_url=normalized,
            api_key=api_key,
            body=build_anthropic_messages_payload(model, payload),
            timeout=timeout,
        )
    return post_openai_chat_completions(
        base_url=normalized,
        api_key=api_key,
        body=build_openai_chat_payload(model, payload),
        timeout=timeout,
    )


def chat_completion(*, base_url: str, api_key: str, model: str, messages: list[dict[str, Any]], timeout: float = 60) -> dict[str, Any]:
    normalized = normalize_mimo_base_url(base_url)
    body = {"model": model, "temperature": 0, "messages": messages}
    if is_anthropic_base_url(normalized):
        response = post_anthropic_messages(base_url=normalized, api_key=api_key, body=body, timeout=timeout)
        return {"text": extract_mimo_text(response), "raw": response}
    response = post_openai_chat_completions(base_url=normalized, api_key=api_key, body=body, timeout=timeout)
    return {"text": extract_mimo_text(response), "raw": response}


def mask_secret(text: str, api_key: str | None = None) -> str:
    masked = text
    if api_key:
        masked = masked.replace(api_key, "[redacted]")
    return re.sub(r"tp-[A-Za-z0-9_-]{12,}", "[redacted]", masked)


def extract_anthropic_text(response: dict[str, Any]) -> str:
    chunks = []
    for item in response.get("content", []):
        if isinstance(item, dict) and item.get("type") == "text":
            chunks.append(str(item.get("text", "")))
    if chunks:
        return "\n".join(chunks)
    return str(response)


def extract_mimo_text(response: dict[str, Any]) -> str:
    if isinstance(response, dict):
        if isinstance(response.get("content"), list):
            return extract_anthropic_text(response)
        choices = response.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0] if isinstance(choices[0], dict) else {}
            message = first.get("message") if isinstance(first, dict) else {}
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, list):
                    chunks = []
                    for item in content:
                        if isinstance(item, dict) and item.get("type") == "text":
                            chunks.append(str(item.get("text", "")))
                    if chunks:
                        return "\n".join(chunks)
                if isinstance(content, str):
                    return content
            text = first.get("text")
            if isinstance(text, str) and text.strip():
                return text
    return str(response)


def _cli_chat() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("MIMO_BASE_URL", DEFAULT_MIMO_BASE_URL))
    parser.add_argument("--api-key", default=get_mimo_api_key())
    parser.add_argument("--model", default=os.environ.get("MIMO_MODEL", DEFAULT_MIMO_MODEL))
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()
    if not args.api_key:
        print("MiMo API key is not configured", file=sys.stderr)
        return 2
    payload = json.load(sys.stdin)
    messages = payload.get("messages") if isinstance(payload, dict) else []
    if not isinstance(messages, list):
        messages = []
    result = chat_completion(
        base_url=args.base_url,
        api_key=args.api_key,
        model=args.model,
        messages=messages,
        timeout=args.timeout,
    )
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


def normalize_mimo_base_url(base_url: str) -> str:
    url = base_url.strip().rstrip("/")
    if url.endswith("/v1"):
        return url
    if url.endswith("/anthropic"):
        return url
    return url


def is_anthropic_base_url(base_url: str) -> bool:
    return base_url.rstrip("/").endswith("/anthropic")


def build_review_prompt(payload: dict[str, Any]) -> str:
    return "\n".join(
        [
            "Review this task against the architecture intent.",
            "",
            f"Task: {payload.get('task', {})}",
            "",
            f"Claude summary: {payload.get('summary', '')}",
            f"Changed files: {payload.get('changedFiles', [])}",
            f"Commands run by Claude: {payload.get('commandsRun', [])}",
            "",
            "Local verification:",
            str(payload.get("localVerification", "")),
            "",
            "Diff:",
            str(payload.get("diff", ""))[:20000],
            "",
            "Return format:",
            "VERDICT: PASS|REJECT",
            "SUMMARY: one paragraph",
            "SUGGESTIONS: bullet list if rejected",
        ]
    )


def parse_review_decision(content: str) -> ReviewDecision:
    text = content.strip()
    upper = text.upper()
    status = "PASS" if "VERDICT: PASS" in upper or upper.startswith("PASS") else "REJECT"
    suggestions: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(("-", "*")):
            suggestions.append(stripped.lstrip("-* ").strip())
    return ReviewDecision(status=status, summary=text[:2000], suggestions=suggestions, raw=text)


if __name__ == "__main__":
    raise SystemExit(_cli_chat())
