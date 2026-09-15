from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import String, Numeric, JSON, DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base

def uid(): return str(uuid4())
def now(): return datetime.now(timezone.utc)

class Setting(Base):
    __tablename__ = 'settings'
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)

class Account(Base):
    __tablename__ = 'accounts'
    id: Mapped[int] = mapped_column(primary_key=True)
    cash: Mapped[object] = mapped_column(Numeric(28,8), default=100000)

class Position(Base):
    __tablename__ = 'positions'
    ticker: Mapped[str] = mapped_column(String(20), primary_key=True)
    quantity: Mapped[object] = mapped_column(Numeric(28,8), default=0)
    cost: Mapped[object] = mapped_column(Numeric(28,8), default=0)

class Ledger(Base):
    __tablename__ = 'ledger'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class Strategy(Base):
    __tablename__ = 'strategies'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    version: Mapped[int] = mapped_column(Integer, default=1)
    config: Mapped[dict] = mapped_column(JSON)

class StrategyVersion(Base):
    __tablename__ = 'strategy_versions'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    snapshot: Mapped[dict] = mapped_column(JSON)

class Backtest(Base):
    __tablename__ = 'backtests'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    status: Mapped[str] = mapped_column(String(20))
    result: Mapped[dict] = mapped_column(JSON)
