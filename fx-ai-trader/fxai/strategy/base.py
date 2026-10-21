"""Strategy interface shared by the backtester, the research tooling and the live service.

A strategy is a pure function of completed bars:

    compute(entry_bars, trend_bars, session_window) -> DataFrame (one row per entry-TF bar)

Required output columns: ``close``, ``close_time``, ``atr_e`` (entry-TF ATR),
``tr_regime`` (trend-TF regime label), ``signal`` (+1 / -1 / 0), ``sl`` (stop
price where signal != 0), ``candidate_side`` (+1/-1 when the main conditions are
met but a final condition failed, else 0), ``r_session`` (bool), plus every name
in ``features``. Optional: ``tp`` (take-profit price), ``deadline`` (UTC time
after which the position must be closed), ``stage`` (setup progress 0..1) and
``invalidation`` (price that voids the setup) for the watchlist.

Everything must be causal: a row may only use bars that CLOSED at or before its
own close time. ``tests/test_strategies.py`` recomputes every strategy on
truncated history to enforce this.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, ClassVar

import pandas as pd
from pydantic import BaseModel, ConfigDict

from ..analysis.bars import align_higher
from ..analysis.regime import REGIME_COLS, RegimeParams, regime_frame
from ..config import ExitConfig
from ..domain import Action, Regime
from ..timeutil import parse_hours_window

REQUIRED_COLUMNS = ["close", "close_time", "atr_e", "tr_regime", "signal", "sl", "candidate_side", "r_session"]


class StrategyParamsBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


@dataclass
class Setup:
    """A partially formed opportunity for the watchlist."""

    symbol: str
    strategy: str
    side: int  # +1 / -1
    stage: float  # 0..1 share of conditions met
    created: pd.Timestamp  # bar close that produced it
    expires: pd.Timestamp
    trigger_level: float | None
    invalidation: float | None
    conditions: dict[str, bool]
    evidence: list[str]


@dataclass
class StrategyOutput:
    symbol: str
    action: Action
    bar_open_time: pd.Timestamp | None
    bar_close_time: pd.Timestamp | None
    regime: Regime
    reasons: list[str]
    entry_ref: float | None = None
    stop_loss: float | None = None
    take_profit_r: float = 2.0
    take_profit_price: float | None = None
    deadline: pd.Timestamp | None = None
    invalidation: list[str] = field(default_factory=list)
    features: dict[str, float] = field(default_factory=dict)
    setup: Setup | None = None
    atr_entry: float | None = None  # entry-timeframe ATR at the signal bar (fixed trailing distance)


def session_mask(close_time: pd.Series, session_window: str, friday_cutoff_utc: str = "18:00",
                 block_weekend: bool = True) -> pd.Series:
    ct = pd.DatetimeIndex(close_time)
    mins = ct.hour * 60 + ct.minute
    s0, s1 = parse_hours_window(session_window)
    in_win = (mins >= s0) & (mins < s1) if s0 <= s1 else ((mins >= s0) | (mins < s1))
    fc_h, fc_m = (int(x) for x in friday_cutoff_utc.split(":"))
    fri_late = (ct.weekday == 4) & (mins >= fc_h * 60 + fc_m)
    weekend = (ct.weekday == 5) | (ct.weekday == 6)
    ok = in_win & ~fri_late
    if block_weekend:
        ok &= ~weekend
    return pd.Series(ok, index=close_time.index)


class StrategyBase:
    name: ClassVar[str] = "base"
    version: ClassVar[str] = "0.0.0"
    default_entry_tf: ClassVar[str] = "H1"
    default_trend_tf: ClassVar[str] = "H4"
    default_exits: ClassVar[ExitConfig] = ExitConfig()
    Params: ClassVar[type[StrategyParamsBase]] = StrategyParamsBase
    features: ClassVar[list[str]] = []
    ignores_session_window: ClassVar[bool] = False  # trend-following holds through sessions
    regime_params: ClassVar[RegimeParams] = RegimeParams()

    def __init__(self, params: dict[str, Any] | None = None, exits: ExitConfig | None = None,
                 entry_tf: str | None = None, trend_tf: str | None = None):
        self.p = self.Params.model_validate(params or {})
        self.exits = exits or self.default_exits
        self.entry_tf = entry_tf or self.default_entry_tf
        self.trend_tf = trend_tf or self.default_trend_tf

    # -- identity ---------------------------------------------------------------
    @property
    def full_version(self) -> str:
        return f"{self.name}-{self.version}"

    @property
    def warmup_bars(self) -> int:
        """Entry-TF bars needed before the first decision."""
        return 60

    @property
    def trend_warmup_bars(self) -> int:
        return self.regime_params.warmup_bars

    # -- helpers ------------------------------------------------------------------
    def trend_frame(self, trend_bars: pd.DataFrame) -> pd.DataFrame:
        return regime_frame(trend_bars, self.regime_params)

    def attach_trend(self, f: pd.DataFrame, trend_bars: pd.DataFrame) -> pd.DataFrame:
        f.index.name = "open_time"
        return align_higher(f, self.trend_frame(trend_bars), REGIME_COLS, "tr_")

    # -- to implement ---------------------------------------------------------------
    def compute(self, entry: pd.DataFrame, trend: pd.DataFrame, session_window: str = "00:00-24:00") -> pd.DataFrame:
        raise NotImplementedError

    def explain(self, row: pd.Series) -> list[str]:
        raise NotImplementedError

    def invalidation_notes(self, row: pd.Series) -> list[str]:
        """What would void the opportunity (shown with every BUY/SELL)."""
        return []

    def setups(self, f: pd.DataFrame, symbol: str) -> list[Setup]:
        """Watchlist candidates from the latest computed row. Default: a candidate
        row (main conditions met, final one pending) becomes a setup."""
        if f.empty:
            return []
        row = f.iloc[-1]
        side = int(row.get("candidate_side", 0) or 0)
        if side == 0 or int(row.get("signal", 0) or 0) != 0:
            return []
        conds = {c[2:]: bool(row[c]) for c in f.columns if c.startswith("r_") and c != "r_session"}
        stage = sum(conds.values()) / max(1, len(conds))
        bar_minutes = int((pd.Timestamp(row["close_time"]) - pd.Timestamp(f.index[-1])).total_seconds() // 60)
        return [Setup(symbol, self.full_version, side, stage, pd.Timestamp(row["close_time"]),
                      pd.Timestamp(row["close_time"]) + pd.Timedelta(minutes=bar_minutes * self.setup_ttl_bars),
                      None, float(row["invalidation"]) if "invalidation" in row and pd.notna(row.get("invalidation")) else None,
                      conds, self.explain(row))]

    setup_ttl_bars: ClassVar[int] = 3

    # -- generic decision ---------------------------------------------------------------
    def decide_latest(self, symbol: str, entry: pd.DataFrame, trend: pd.DataFrame, session_window: str,
                      now: datetime) -> StrategyOutput:
        if len(entry) < self.warmup_bars or len(trend) < self.trend_warmup_bars:
            return StrategyOutput(symbol, Action.WAIT, None, None, Regime.UNKNOWN,
                                  [f"insufficient history (entry TF {len(entry)}, trend TF {len(trend)} bars)"])
        f = self.compute(entry, trend, session_window)
        row = f.iloc[-1]
        bar_open = f.index[-1]
        close_t = pd.Timestamp(row["close_time"])
        regime = Regime(row["tr_regime"]) if isinstance(row["tr_regime"], str) else Regime.UNKNOWN
        age_min = (pd.Timestamp(now) - close_t).total_seconds() / 60.0
        tf_min = (close_t - pd.Timestamp(bar_open)).total_seconds() / 60.0
        if age_min > 2 * tf_min:
            return StrategyOutput(symbol, Action.WAIT, bar_open, close_t, regime,
                                  [f"latest completed entry bar is {age_min:.0f} min old - data stale or market closed"])
        reasons = self.explain(row)
        feats = {k: float(row[k]) for k in self.features if k in row and pd.notna(row[k])}
        setups = self.setups(f, symbol)
        if int(row["signal"]) == 0:
            return StrategyOutput(symbol, Action.WAIT, bar_open, close_t, regime, reasons, features=feats,
                                  setup=setups[0] if setups else None)
        action = Action.BUY if row["signal"] > 0 else Action.SELL
        tp_price = float(row["tp"]) if "tp" in row and pd.notna(row.get("tp")) else None
        deadline = pd.Timestamp(row["deadline"]) if "deadline" in row and pd.notna(row.get("deadline")) else None
        atr_e = float(row["atr_e"]) if pd.notna(row.get("atr_e")) else None
        return StrategyOutput(symbol, action, bar_open, close_t, regime, reasons, float(row["close"]), float(row["sl"]),
                              self.exits.take_profit_r, tp_price, deadline, self.invalidation_notes(row), feats,
                              atr_entry=atr_e)


def mark(ok: bool) -> str:
    return "pass" if ok else "FAIL"
