"""Child process entrypoint. Input/output are one JSON document on stdio."""
import builtins
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from strategy_api import Bar, Signal, StrategyBase  # noqa: E402


def _limits():
    if sys.platform != "win32":
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
        resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))


SAFE_BUILTINS = {name: getattr(builtins, name) for name in (
    "__build_class__", "abs", "all", "any", "bool", "dict", "enumerate",
    "float", "int", "isinstance", "len", "list", "max", "min", "range",
    "reversed", "round", "set", "sorted", "str", "sum", "tuple", "zip",
    "Exception", "ValueError", "ZeroDivisionError",
)}


def main():
    _limits()
    payload = json.load(sys.stdin)
    namespace = {"__builtins__": SAFE_BUILTINS, "__name__": "custom_strategy",
                 "StrategyBase": StrategyBase, "Signal": Signal, "Bar": Bar, "math": math}
    code = compile(payload["source"], "<custom_strategy>", "exec")
    exec(code, namespace)
    cls = namespace["CustomStrategy"]
    if not isinstance(cls, type) or not issubclass(cls, StrategyBase) or cls is StrategyBase:
        raise ValueError("CustomStrategy 必须继承 StrategyBase")
    strategy = cls()
    history = []
    signals = []
    for raw in payload["bars"]:
        if not raw.get("is_final", True):
            signals.append("HOLD")
            continue
        bar = Bar(time=int(raw["time"]), session_date=str(raw["session_date"]),
                  end_time=int(raw.get("end_time", raw["time"])),
                  end_session_date=str(raw.get("end_session_date", raw["session_date"])),
                  open=float(raw["open"]), high=float(raw["high"]),
                  low=float(raw["low"]), close=float(raw["close"]),
                  volume=float(raw["volume"]) if raw.get("volume") is not None else None)
        history.append(bar)
        signal = strategy.on_bar(tuple(history))
        if not isinstance(signal, Signal):
            raise ValueError(f"第 {len(signals) + 1} 根 K 线的 on_bar 必须返回 Signal.BUY / SELL / HOLD")
        signals.append(signal.value)
    json.dump({"signals": signals}, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        json.dump({"error": f"策略执行失败：{str(exc)[:240]}"}, sys.stdout)
