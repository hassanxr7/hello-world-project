"""Strategy registry: one place that maps config names to classes."""

from __future__ import annotations

from typing import Any

from .base import StrategyBase
from .donchian_trend import DonchianTrend
from .london_breakout import LondonBreakout
from .pullback_rejection import PullbackRejection
from .range_reversion import RangeReversion
from .trend_pullback import TrendPullbackStrategy
from .vol_breakout import VolBreakout

REGISTRY: dict[str, type[StrategyBase]] = {
    cls.name: cls for cls in (TrendPullbackStrategy, DonchianTrend, RangeReversion, LondonBreakout,
                              PullbackRejection, VolBreakout)
}
STRATEGY_NAMES = tuple(REGISTRY)


def build_strategy(cfg: Any) -> StrategyBase:
    """Instantiate the configured strategy with config overrides (params, timeframes, exits)."""
    sc = cfg.strategy
    cls = REGISTRY[sc.name]
    exits = cfg.exits.apply(cls.default_exits) if cfg.exits is not None else None
    return cls(params=sc.params, exits=exits, entry_tf=sc.decision_timeframe, trend_tf=sc.trend_timeframe)


def make_strategy(name: str, params: dict[str, Any] | None = None, **kw: Any) -> StrategyBase:
    return REGISTRY[name](params=params, **kw)
