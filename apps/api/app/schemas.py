from datetime import date
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

class StrictInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

class StrategyInput(StrictInput):
    name: str = Field(min_length=1,max_length=100)
    type: Literal['MA','EMA','RSI']
    period: Literal['day','week','month'] = 'day'
    fast: int = Field(default=20,ge=2,le=250)
    slow: int = Field(default=60,ge=3,le=500)
    lower: float = Field(default=30,ge=1,le=99)
    upper: float = Field(default=70,ge=1,le=99)
    description: str = Field(default='',max_length=2000)
    @model_validator(mode='after')
    def validate_ranges(self):
        if (self.type != 'RSI' and self.fast >= self.slow) or self.lower >= self.upper: raise ValueError('短周期必须小于长周期，低阈值必须小于高阈值')
        return self

class CodeStrategyInput(StrictInput):
    name: str = Field(min_length=1,max_length=100)
    type: Literal['CODE'] = 'CODE'
    period: Literal['day','week','month'] = 'day'
    lookback: int = Field(default=100,ge=2,le=500)
    source: str = Field(min_length=1,max_length=20000)
    description: str = Field(default='',max_length=2000)

    @model_validator(mode='after')
    def validate_code(self):
        from .code_strategy import validate_source
        validate_source(self.source)
        return self

class TradeInput(StrictInput):
    idempotency_key: str = Field(min_length=8,max_length=100)
    ticker: str = Field(pattern=r'^\d{6}$')
    side: Literal['buy','sell']
    quantity: Decimal = Field(gt=0,le=100000000,decimal_places=8)
    price: Decimal = Field(gt=0,le=1000000,decimal_places=8)
    fee: Decimal = Field(default=Decimal('0'),ge=0,le=1000000,decimal_places=8)

class AdjustmentInput(StrictInput):
    ticker: str = Field(pattern=r'^\d{6}$')
    quantity: Decimal = Field(ge=0,le=100000000,decimal_places=8)
    cost: Decimal = Field(ge=0,le=1000000,decimal_places=8)

class BacktestInput(StrictInput):
    strategy_id: str
    index_id: str
    start: date
    end: date
    capital: Decimal = Field(default=Decimal('100000'),gt=0,le=1000000000)
    fee: Decimal = Field(default=Decimal('0.03'),ge=0,le=5)
    slippage: Decimal = Field(default=Decimal('0.05'),ge=0,le=5)
    @model_validator(mode='after')
    def dates(self):
        if self.start >= self.end or (self.end-self.start).days > 7305 or self.end > date.today(): raise ValueError('请选择不超过20年且不晚于今日的有效日期区间')
        return self
