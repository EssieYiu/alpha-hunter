"""Public contract for user authored, single index backtest strategies."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Sequence


@dataclass(frozen=True, slots=True)
class Bar:
    time: int
    session_date: str
    end_time: int
    end_session_date: str
    open: float
    high: float
    low: float
    close: float
    volume: float | None


class Signal(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class StrategyBase(ABC):
    @abstractmethod
    def on_bar(self, history: Sequence[Bar]) -> Signal:
        """Return a signal after the last completed bar in history closes.

        history contains only bars at or before the current completed period.
        BUY and SELL request an all-in/all-out fill at the next period's open.
        The backtest engine owns cash, positions, fees and execution timing.
        """
