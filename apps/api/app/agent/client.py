"""Compatible chat-completions transport; credentials never enter stored payloads."""
import os
import time
from urllib.parse import urlsplit

import httpx


class ModelError(Exception):
    pass


def validate_url(base_url: str) -> str:
    url = base_url.rstrip("/")
    parsed = urlsplit(url)
    allowed = {x.strip().rstrip("/") for x in os.getenv(
        "AGENT_ALLOWED_BASE_URLS", "https://api.openai.com/v1").split(",") if x.strip()}
    if (url not in allowed or parsed.scheme not in {"https", "http"}
            or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise ModelError("模型服务地址未在服务器 AGENT_ALLOWED_BASE_URLS 允许列表中。")
    return url


class ModelClient:
    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = validate_url(base_url)
        self.api_key = api_key
        self.model = model

    def complete(self, messages: list, tools: list) -> dict:
        try:
            deadline = time.monotonic() + 45
            # No redirects or proxy environment: a configured origin is the sole destination.
            with httpx.Client(timeout=40, follow_redirects=False, trust_env=False) as client:
                with client.stream("POST", self.base_url + "/chat/completions",
                                   headers={"Authorization": "Bearer " + self.api_key},
                                   json={"model": self.model, "messages": messages,
                                         "tools": tools, "tool_choice": "auto", "max_tokens": 1800}) as response:
                    if response.status_code >= 300:
                        raise ModelError(f"模型服务请求失败（HTTP {response.status_code}），请检查模型配置与额度。")
                    data = bytearray()
                    for chunk in response.iter_bytes():
                        if time.monotonic() > deadline:
                            raise ModelError("模型响应超时，请重试。")
                        data.extend(chunk)
                        if len(data) > 1_000_000:
                            raise ModelError("模型响应超过大小限制。")
                    import json
                    payload = json.loads(data)
            message = payload["choices"][0]["message"]
            if not isinstance(message, dict):
                raise ValueError()
            return message
        except ModelError:
            raise
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
            # Never propagate vendor body, request headers, exception URL or credentials.
            raise ModelError("模型服务不可用或响应格式不兼容，请检查配置后重试。") from None
