"""Bounded model transports; credentials never enter stored payloads."""
import json
import os
import time
from urllib.parse import urlsplit

import httpx


# Fixed provider origins are available without server-side configuration. Additional
# self-hosted OpenAI-compatible origins still require an explicit allowlist entry.
PROVIDER_BASE_URLS = frozenset({
    "https://api.openai.com/v1",
    "https://api.anthropic.com/v1",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
    "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1",
    "https://api.deepseek.com",
    "https://api.minimax.cn/v1",
    "https://api.minimax.io/v1",
})


class ModelError(Exception):
    pass


def validate_url(base_url: str) -> str:
    url = base_url.rstrip("/")
    parsed = urlsplit(url)
    allowed = PROVIDER_BASE_URLS | {x.strip().rstrip("/") for x in os.getenv(
        "AGENT_ALLOWED_BASE_URLS", "").split(",") if x.strip()}
    if (url not in allowed or parsed.scheme not in {"https", "http"}
            or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise ModelError("模型服务地址不在内置提供商或服务器 AGENT_ALLOWED_BASE_URLS 允许列表中。")
    return url


def anthropic_request(messages: list, tools: list, model: str) -> dict:
    system, conversation = [], []
    for message in messages:
        role = message["role"]
        if role == "system":
            system.append(message["content"])
        elif role == "tool":
            block = {"type": "tool_result", "tool_use_id": message["tool_call_id"],
                     "content": message["content"]}
            if conversation and conversation[-1]["role"] == "user" and isinstance(conversation[-1]["content"], list):
                conversation[-1]["content"].append(block)
            else:
                conversation.append({"role": "user", "content": [block]})
        elif role == "assistant" and message.get("tool_calls"):
            blocks = []
            if message.get("content"):
                blocks.append({"type": "text", "text": message["content"]})
            for call in message["tool_calls"]:
                blocks.append({"type": "tool_use", "id": call["id"],
                               "name": call["function"]["name"],
                               "input": json.loads(call["function"]["arguments"])})
            conversation.append({"role": "assistant", "content": blocks})
        else:
            conversation.append({"role": role, "content": message["content"]})
    return {"model": model, "max_tokens": 1800, "thinking": {"type": "disabled"},
            "system": "\n".join(system),
            "messages": conversation,
            "tools": [{"name": tool["function"]["name"],
                       "description": tool["function"]["description"],
                       "input_schema": tool["function"]["parameters"]} for tool in tools],
            "tool_choice": {"type": "auto"}}


def anthropic_message(payload: dict) -> dict:
    blocks = payload["content"]
    if not isinstance(blocks, list):
        raise ValueError()
    content, calls = [], []
    for block in blocks:
        if block["type"] == "text":
            content.append(block["text"])
        elif block["type"] == "tool_use":
            calls.append({"id": block["id"], "type": "function", "function": {
                "name": block["name"], "arguments": json.dumps(block["input"], ensure_ascii=False)}})
    return {"content": "\n".join(content), "tool_calls": calls}


class ModelClient:
    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = validate_url(base_url)
        if self.base_url in {"https://api.minimax.cn/v1", "https://api.minimax.io/v1"} and model != "MiniMax-M3":
            raise ModelError("当前 MiniMax 接入仅支持 MiniMax-M3；其他型号的思考内容与工具回合尚未适配。")
        self.api_key = api_key
        self.model = model

    def complete(self, messages: list, tools: list) -> dict:
        try:
            deadline = time.monotonic() + 45
            native = self.base_url == "https://api.anthropic.com/v1"
            endpoint = "/messages" if native else "/chat/completions"
            headers = ({"x-api-key": self.api_key, "anthropic-version": "2023-06-01"}
                       if native else {"Authorization": "Bearer " + self.api_key})
            body = (anthropic_request(messages, tools, self.model) if native else
                    {"model": self.model, "messages": messages,
                     "tools": tools, "tool_choice": "auto", "max_tokens": 1800})
            if self.base_url == "https://api.openai.com/v1":
                # The default reasoning model uses the current Chat Completions limit field.
                body["max_completion_tokens"] = 3000
                body.pop("max_tokens")
            if self.base_url == "https://api.deepseek.com":
                # Thinking mode requires replaying private reasoning on each tool round.
                # This bounded agent intentionally keeps only user-visible context.
                body["thinking"] = {"type": "disabled"}
            if self.base_url in {"https://api.minimax.cn/v1", "https://api.minimax.io/v1"}:
                body["max_completion_tokens"] = body.pop("max_tokens")
                body["thinking"] = {"type": "disabled"}
            # No redirects or proxy environment: a configured origin is the sole destination.
            with httpx.Client(timeout=40, follow_redirects=False, trust_env=False) as client:
                with client.stream("POST", self.base_url + endpoint,
                                   headers=headers, json=body) as response:
                    if response.status_code >= 300:
                        raise ModelError(f"模型服务请求失败（HTTP {response.status_code}），请检查模型配置与额度。")
                    data = bytearray()
                    for chunk in response.iter_bytes():
                        if time.monotonic() > deadline:
                            raise ModelError("模型响应超时，请重试。")
                        data.extend(chunk)
                        if len(data) > 1_000_000:
                            raise ModelError("模型响应超过大小限制。")
                    payload = json.loads(data)
            message = anthropic_message(payload) if native else payload["choices"][0]["message"]
            if not isinstance(message, dict):
                raise ValueError()
            return message
        except ModelError:
            raise
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
            # Never propagate vendor body, request headers, exception URL or credentials.
            raise ModelError("模型服务不可用或响应格式不兼容，请检查配置后重试。") from None
