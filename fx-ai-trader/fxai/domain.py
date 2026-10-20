"""Core domain types shared by the live service, the simulator and the backtester."""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


class Side(str, enum.Enum):
    BUY = "BUY"
    SELL = "SELL"

    @property
    def sign(self) -> int:
        return 1 if self is Side.BUY else -1

    @staticmethod
    def from_sign(s: int) -> "Side":
        if s > 0:
            return Side.BUY
        if s < 0:
            return Side.SELL
        raise ValueError("sign 0 has no side")


class Action(str, enum.Enum):
    BUY = "BUY"
    SELL = "SELL"
    WAIT = "WAIT"


class Regime(str, enum.Enum):
    TREND_UP = "TREND_UP"
    TREND_DOWN = "TREND_DOWN"
    RANGE = "RANGE"
    VOLATILE = "VOLATILE"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class SymbolSpec:
    """Contract specification. In live mode every numeric field comes from the
    broker via the EA (MarketInfo); defaults are only used in simulation."""

    canonical: str  # e.g. EURUSD
    broker_name: str  # e.g. EURUSD.r
    base: str
    quote: str
    digits: int
    point: float
    tick_size: float
    tick_value: float  # account currency per tick_size move per 1.0 lot
    contract_size: float
    min_lot: float
    max_lot: float
    lot_step: float
    stop_level_points: int = 0
    freeze_level_points: int = 0
    margin_per_lot: float = 0.0  # account currency required per 1.0 lot
    trade_allowed: bool = True
    swap_long_points: float = 0.0
    swap_short_points: float = 0.0

    @property
    def pip_size(self) -> float:
        # 5/3-digit quoting: one pip = 10 points. 4/2-digit: pip = point.
        return self.point * 10 if self.digits in (3, 5) else self.point

    @property
    def value_per_price_unit(self) -> float:
        """Account-currency P&L of a 1.0 price move for 1.0 lot."""
        if self.tick_size <= 0:
            return 0.0
        return self.tick_value / self.tick_size

    def round_price(self, price: float) -> float:
        ts = self.tick_size if self.tick_size > 0 else self.point
        return round(round(price / ts) * ts, self.digits)


@dataclass(frozen=True)
class Quote:
    symbol: str
    bid: float
    ask: float
    time_utc: datetime  # time of last tick (converted to UTC)

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2.0

    @property
    def spread(self) -> float:
        return self.ask - self.bid


@dataclass(frozen=True)
class AccountSnapshot:
    login: int
    currency: str
    balance: float
    equity: float
    margin: float
    free_margin: float
    leverage: int = 100
    is_demo: bool = True
    trade_allowed: bool = True
    connected: bool = True
    server: str = ""
    company: str = ""

    @property
    def floating_pnl(self) -> float:
        return self.equity - self.balance

    @property
    def margin_level_pct(self) -> float:
        return (self.equity / self.margin * 100.0) if self.margin > 0 else float("inf")


@dataclass(frozen=True)
class Position:
    ticket: int
    symbol: str  # canonical
    side: Side
    volume: float
    open_price: float
    open_time_utc: datetime
    sl: float
    tp: float
    profit: float = 0.0  # floating profit in account currency (excl. swap/commission)
    swap: float = 0.0
    commission: float = 0.0
    magic: int = 0
    comment: str = ""
    system_owned: bool = True

    @property
    def net_profit(self) -> float:
        return self.profit + self.swap + self.commission


@dataclass(frozen=True)
class ClosedTrade:
    ticket: int
    symbol: str
    side: Side
    volume: float
    open_price: float
    close_price: float
    open_time_utc: datetime
    close_time_utc: datetime
    sl: float
    tp: float
    profit: float
    swap: float
    commission: float
    magic: int = 0
    comment: str = ""
    system_owned: bool = True

    @property
    def net_profit(self) -> float:
        return self.profit + self.swap + self.commission


@dataclass(frozen=True)
class BalanceOperation:
    """Deposit (+), withdrawal (-) or credit operation reported by the broker."""

    ticket: int
    time_utc: datetime
    amount: float
    kind: str = "balance"  # balance | credit
    comment: str = ""


@dataclass
class TradeIntent:
    """A proposal to open a position. Volume is decided only by the risk engine."""

    signal_id: str
    symbol: str
    side: Side
    entry_price: float  # reference price (ask for BUY, bid for SELL)
    stop_loss: float
    take_profit: float
    strategy: str
    strategy_version: str
    bar_time_utc: datetime
    created_utc: datetime
    reasons: list[str] = field(default_factory=list)
    features: dict[str, float] = field(default_factory=dict)
    ml_score: float | None = None
    ml_model_version: str | None = None

    @property
    def stop_distance(self) -> float:
        return abs(self.entry_price - self.stop_loss)


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str = ""
    value: Any = None
    limit: Any = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "passed": self.passed,
            "detail": self.detail,
            "value": self.value,
            "limit": self.limit,
        }


@dataclass
class RiskDecision:
    approved: bool
    volume: float = 0.0
    planned_risk_money: float = 0.0
    planned_risk_pct: float = 0.0
    checks: list[CheckResult] = field(default_factory=list)

    @property
    def blocking_reasons(self) -> list[str]:
        return [f"{c.name}: {c.detail}" for c in self.checks if not c.passed]

    def as_dict(self) -> dict[str, Any]:
        return {
            "approved": self.approved,
            "volume": self.volume,
            "planned_risk_money": round(self.planned_risk_money, 2),
            "planned_risk_pct": round(self.planned_risk_pct, 4),
            "checks": [c.as_dict() for c in self.checks],
        }
