from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from .client import ModelClient, ModelError, validate_url
from .models import Conversation
from .service import detail, send

router = APIRouter(tags=["agent"])


class CreateConversation(BaseModel):
    title: str = Field(default="新对话", min_length=1, max_length=120)


class Context(BaseModel):
    model_config = ConfigDict(extra="forbid")
    index_id: str | None = Field(default=None, max_length=60)
    backtest_id: str | None = Field(default=None, max_length=60)


class SendMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=8000)
    model: str = Field(default="", max_length=120)
    base_url: str = Field(default="", max_length=500)
    api_key: SecretStr = Field(default=SecretStr(""))
    context: Context | None = None


def find(db, conversation_id):
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(404, "对话不存在。")
    return conversation


@router.get("/conversations")
def list_conversations(db: Session = Depends(get_db)):
    return [{"id": c.id, "title": c.title, "created_at": c.created_at, "updated_at": c.updated_at}
            for c in db.scalars(select(Conversation).order_by(Conversation.updated_at.desc())).all()]


@router.post("/conversations", status_code=201)
def create_conversation(body: CreateConversation = CreateConversation(), db: Session = Depends(get_db)):
    conversation = Conversation(title=body.title)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return detail(db, conversation)


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str, db: Session = Depends(get_db)):
    return detail(db, find(db, conversation_id))


@router.post("/conversations/{conversation_id}/messages")
def send_message(conversation_id: str, body: SendMessage, db: Session = Depends(get_db)):
    conversation = find(db, conversation_id)
    key = body.api_key.get_secret_value()
    if not key.strip() or not body.model.strip() or not body.base_url.strip():
        raise HTTPException(422, "请填写模型、允许的服务地址和 API Key；Key 仅在本次请求使用。")
    try:
        validate_url(body.base_url)
    except ModelError as error:
        raise HTTPException(422, str(error)) from None
    try:
        result = send(db, conversation, body.message,
                      body.context.model_dump(exclude_none=True) if body.context else {},
                      ModelClient(body.base_url, key, body.model), key)
        return {**result, "run_status": "completed"}
    except ModelError as error:
        raise HTTPException(409 if "正在生成" in str(error) else 502, str(error)) from None
