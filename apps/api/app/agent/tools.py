import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmptyInput(StrictInput):
    pass


class BarsInput(StrictInput):
    index_id: str = Field(min_length=1, max_length=60)
    interval: Literal["minute", "day", "week", "month"] = "day"


class BacktestInput(StrictInput):
    backtest_id: str = Field(min_length=1, max_length=60)


def specifications():
    from app.schemas import StrategyInput
    return {
        "list_indices": ("查看实际支持的指数目录。", EmptyInput),
        "get_market_bars": ("读取行情及来源、时间和不可用原因，不提供合成数据。", BarsInput),
        "list_strategies": ("查看已保存策略及版本。", EmptyInput),
        "create_strategy": ("新增并持久保存参数化策略。仅在用户要求创建/保存策略时使用；研究请求先讨论参数。", StrategyInput),
        "get_backtest": ("读取指定回测状态与不可变结果快照；解读只依据已计算指标。", BacktestInput),
    }


def definitions():
    return [{"type": "function", "function": {"name": name, "description": desc,
             "parameters": schema.model_json_schema()}}
            for name, (desc, schema) in specifications().items()]


def execute(db, name: str, arguments: str):
    from app import services, market
    from app.catalog import INDICES
    specs = specifications()
    if name not in specs:
        raise ValueError("不支持的工具。")
    raw = json.loads(arguments)
    schema = specs[name][1]
    if not isinstance(raw, dict) or set(raw) - set(schema.model_fields):
        raise ValueError("工具参数含未知字段。")
    args = schema.model_validate(raw)
    if name == "list_indices":
        return INDICES
    if name == "list_strategies":
        return services.list_strategies(db)
    if name == "create_strategy":
        return services.create_strategy(db, args)
    if name == "get_backtest":
        return services.get_backtest(db, args.backtest_id)
    result = market.get_bars(args.index_id, args.interval)
    # Recent bars suffice for discussion. Full data remains available through market API.
    return {**result, "bars": result.get("bars", [])[-30:],
            "indicators": {k: v[-30:] if isinstance(v, list) else v
                           for k, v in result.get("indicators", {}).items()},
            "context_note": "仅返回最近30根K线及指标，完整历史请到行情页面查看。"}
