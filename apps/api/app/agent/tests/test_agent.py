"""Deterministic unit tests. SQLite is isolated here; production integration uses PostgreSQL."""
import json
import os
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.agent.client import ModelClient, ModelError, validate_url
from app.agent.models import Conversation, Message
from app.agent import service, tools


@pytest.fixture
def db():
    from sqlalchemy.pool import StaticPool
    url = os.getenv("TEST_DATABASE_URL")
    engine = create_engine(url) if url else create_engine("sqlite://", poolclass=StaticPool,
                                                          connect_args={"check_same_thread": False})
    Conversation.__table__.create(engine, checkfirst=True)
    Message.__table__.create(engine, checkfirst=True)
    with engine.connect() as connection:
        transaction = connection.begin()
        with Session(connection, expire_on_commit=False, join_transaction_mode="create_savepoint") as session:
            yield session
        transaction.rollback()
    engine.dispose()


class Client:
    def __init__(self, responses):
        self.responses, self.seen = iter(responses), []

    def complete(self, messages, definitions):
        self.seen.append(json.loads(json.dumps(messages)))
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response


def call(name="list_indices", args="{}", call_id="one"):
    return {"role": "assistant", "content": None, "tool_calls": [
        {"id": call_id, "type": "function", "function": {"name": name, "arguments": args}}]}


def test_url_exact_allowlist(monkeypatch):
    monkeypatch.setenv("AGENT_ALLOWED_BASE_URLS", "https://model.example/v1,http://localhost:11434/v1")
    assert validate_url("https://model.example/v1/") == "https://model.example/v1"
    for bad in ("https://model.example.evil/v1", "https://model.example/v1?key=abc",
                "https://model.example@evil/v1", "http://169.254.169.254", "https://model.example/v1/other"):
        with pytest.raises(ModelError):
            validate_url(bad)


def test_tool_call_limit_and_dedup(db, monkeypatch):
    executions = []
    monkeypatch.setattr(tools, "execute", lambda *args: executions.append(args) or {"id": "saved"})
    fake = Client([call("create_strategy", '{"name":"demo"}'),
                   call("create_strategy", '{"name":"demo"}', "two"), {"content": "已保存"}])
    answer, traces = service.run_loop(db, fake, [], {}, "", max_tools=2)
    assert answer == "已保存" and len(traces) == 2 and len(executions) == 1
    with pytest.raises(ModelError, match="上限"):
        service.run_loop(db, Client([call(), call()]), [], {}, "", max_tools=1)


def test_round_limit(db, monkeypatch):
    monkeypatch.setattr(tools, "execute", lambda *args: [])
    with pytest.raises(ModelError, match="轮次上限"):
        service.run_loop(db, Client([call()]), [], {}, "", max_rounds=1)


def test_conversation_isolation_key_redaction_and_history(db):
    a, b = Conversation(), Conversation(title="其他对话")
    db.add_all([a, b]); db.commit()
    db.add(Message(conversation_id=b.id, role="user", content="另一会话的独有内容")); db.commit()
    first = Client([{"content": "凭据 supersecret 不应保存"}])
    service.send(db, a, "研究 supersecret", {}, first, "supersecret")
    second = Client([{"content": "继续研究"}])
    result = service.send(db, a, "继续", {}, second, "supersecret")
    assert len(result["messages"]) == 4
    dump = json.dumps(result, default=str, ensure_ascii=False)
    sent = json.dumps(second.seen, ensure_ascii=False)
    assert "supersecret" not in dump + sent
    assert "另一会话的独有内容" not in sent
    assert "研究 [凭据已隐藏]" in sent


def test_completed_tools_survive_upstream_failure(db, monkeypatch):
    c = Conversation(); db.add(c); db.commit()
    monkeypatch.setattr(tools, "execute", lambda *args: {"id": "strategy-1"})
    fake = Client([call("create_strategy"), ModelError("模型服务不可用")])
    with pytest.raises(ModelError):
        service.send(db, c, "保存策略", {}, fake, "secret")
    result = service.detail(db, c)
    assert result["messages"][-1]["tool_calls"][0]["result"]["id"] == "strategy-1"
    assert "不可用" in result["messages"][-1]["content"]
    assert c.running_until is None


def test_concurrent_run_rejected(db):
    c = Conversation(); db.add(c); db.commit()
    assert service.acquire(db, c.id)
    with pytest.raises(ModelError, match="正在生成"):
        service.send(db, c, "hello", {}, Client([]), "secret")


def test_unknown_and_invalid_tool_parameters(db):
    # Imported lazily so this also verifies the production service integration surface.
    for name, args in [("delete_everything", "{}"), ("list_indices", '{"extra":1}'),
                       ("get_market_bars", '{"index_id":"csi300","interval":"year"}'),
                       ("create_strategy", '{"name":"bad","type":"MA","fast":80,"slow":20}')]:
        with pytest.raises((ValueError, TypeError)):
            tools.execute(db, name, args)


def test_large_tool_result_keeps_backtest_metrics():
    result = service.compact_result({"id": "a", "metrics": {"return": "0.10"},
                                     "equity": [{"value": "12345"}] * 3000})
    assert result["metrics"]["return"] == "0.10"
    assert result["omitted_for_context"][0]["field"] == "equity"
    nested = service.compact_result({"id": "a", "result": {"metrics": {"return": "0.10"},
                                   "data_snapshot": [{"close": "100"}] * 4000}})
    assert nested["result"]["metrics"]["return"] == "0.10"
    assert "data_snapshot" not in nested["result"]


def test_transport_errors_do_not_reflect_credentials(monkeypatch):
    import httpx
    class Failing:
        def __init__(self, **kwargs):
            pass
        def __enter__(self):
            raise httpx.ConnectError("secretcredential")
        def __exit__(self, *args):
            pass
    monkeypatch.setattr(httpx, "Client", Failing)
    with pytest.raises(ModelError) as error:
        ModelClient("https://api.openai.com/v1", "secretcredential", "a").complete([], [])
    assert "secretcredential" not in str(error.value)


def test_http_roundtrip_and_failed_request_preserves_history(db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.db import get_db
    from app.agent import router as routes
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as client:
        created = client.post("/api/conversations", json={"title": "研究策略"})
        assert created.status_code == 201
        cid = created.json()["id"]
        fake = Client([{"content": "已研究，请调整周期。"}])
        monkeypatch.setattr(routes, "ModelClient", lambda *args: fake)
        body = {"message": "研究 MA", "model": "example", "api_key": "private-secret",
                "base_url": "https://api.openai.com/v1", "context": {"index_id": "csi300"}}
        response = client.post(f"/api/conversations/{cid}/messages", json=body)
        assert response.status_code == 200 and len(response.json()["messages"]) == 2
        assert "private-secret" not in response.text
        monkeypatch.setattr(routes, "ModelClient", lambda *args: Client([ModelError("模型服务不可用")]))
        failed = client.post(f"/api/conversations/{cid}/messages", json=body)
        assert failed.status_code == 502
        history = client.get(f"/api/conversations/{cid}").json()
        assert len(history["messages"]) == 4 and "不可用" in history["messages"][-1]["content"]
