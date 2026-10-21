"""Opportunity scan: one causal, explainable assessment per pair, at least once per minute.

For each enabled pair the scan reads completed bars only and reports:
  trend and multi-timeframe alignment (entry TF EMA20 slope, trend-TF regime, D1 EMA50/200)
  momentum (RSI14, 24-bar move in ATR), volatility (ATR percentile, trend-TF vol ratio)
  structure (nearest confirmed support/resistance), candlestick picture in context,
  breakout/reversal location (20-bar range), spread now vs limit and vs ATR, session,
  execution quality from our own recent fills, currency exposure / correlation with open
  positions, and economic events ONLY when a verified calendar feed is configured.

The attention score (0-100) ranks where the strategy is closest to acting and the
conditions are cleanest. It is an UNVALIDATED HEURISTIC for prioritising the operator's
attention and the order in which simultaneous signals are checked; it never opens a trade
and never overrides the strategy or the risk engine.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from .candles import read_latest
from .indicators import atr, ema, rsi
from .sessions import active_sessions, is_weekend_closed


@dataclass
class PairView:
    symbol: str
    at: str
    status: str  # ok | no data | stale | market closed
    score: float = 0.0
    attention: list[str] = field(default_factory=list)  # why it scores what it scores
    signal: str | None = None  # BUY / SELL on the latest completed bar
    trend: dict[str, Any] = field(default_factory=dict)
    momentum: dict[str, Any] = field(default_factory=dict)
    volatility: dict[str, Any] = field(default_factory=dict)
    structure: dict[str, Any] = field(default_factory=dict)
    candles: dict[str, Any] = field(default_factory=dict)
    spread: dict[str, Any] = field(default_factory=dict)
    session: dict[str, Any] = field(default_factory=dict)
    execution: dict[str, Any] = field(default_factory=dict)
    exposure: dict[str, Any] = field(default_factory=dict)
    events: dict[str, Any] = field(default_factory=dict)
    setup: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _r(x, n=3):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), n)


def assess_pair(symbol: str, now: datetime, entry: pd.DataFrame | None, frame: pd.DataFrame | None,
                daily: pd.DataFrame | None = None, quote: tuple[float, float, datetime] | None = None,
                point: float = 0.00001, max_spread_points: float | None = None, in_window: bool = True,
                setup: dict | None = None, holding: bool = False, exposure_note: str | None = None,
                correlated_with: list[str] | None = None, events: dict | None = None,
                execution: dict | None = None, quote_max_age_s: float = 30.0) -> PairView:
    """``entry`` = completed entry-TF bars; ``frame`` = the active strategy's computed frame on them
    (provides the trend-TF regime columns ``tr_*`` and the signal); ``daily`` = completed D1 bars."""
    now_t = pd.Timestamp(now)
    v = PairView(symbol, now_t.isoformat(), "ok")
    v.session = {"active": active_sessions(now_t.to_pydatetime()), "in_strategy_window": bool(in_window)}
    v.events = events or {"source": None, "note": "no verified economic calendar configured - events not assessed"}
    v.execution = execution or {"note": "no fills yet"}
    if is_weekend_closed(now_t.to_pydatetime()):
        v.status = "market closed"
        v.attention = ["market closed (weekend)"]
        return v
    if entry is None or frame is None or len(entry) < 30 or frame.empty:
        v.status = "no data"
        v.attention = ["not enough completed bars from the EA yet"]
        return v
    last = frame.iloc[-1]
    close_t = pd.Timestamp(last["close_time"])
    tf = entry["close_time"].iloc[-1] - entry["close_time"].iloc[-2]
    if now_t - close_t > 2 * tf:
        v.status = "stale"
        v.attention = [f"latest completed bar closed {close_t} - data stale or market closed"]
        return v

    c = entry["close"]
    a_series = atr(entry, 14)
    a = float(a_series.iloc[-1])
    # ---- trend / multi-timeframe
    e20 = ema(c, 20)
    slope_e = float((e20.iloc[-1] - e20.iloc[-6]) / a) if a > 0 else 0.0
    regime = str(last.get("tr_regime", "UNKNOWN"))
    d1_bias = None
    if daily is not None and len(daily) >= 210:
        d_f, d_s = ema(daily["close"], 50).iloc[-1], ema(daily["close"], 200).iloc[-1]
        d1_bias = "up" if d_f > d_s else "down"
    dirs = [1 if slope_e > 0.1 else (-1 if slope_e < -0.1 else 0),
            1 if regime == "TREND_UP" else (-1 if regime == "TREND_DOWN" else 0)]
    if d1_bias:
        dirs.append(1 if d1_bias == "up" else -1)
    align = "aligned up" if all(d == 1 for d in dirs) else ("aligned down" if all(d == -1 for d in dirs) else "mixed")
    v.trend = {"trend_tf_regime": regime, "adx": _r(last.get("tr_adx"), 1), "trend_slope": _r(last.get("tr_slope")),
               "entry_ema20_slope_atr": _r(slope_e), "d1_bias": d1_bias, "alignment": align}
    # ---- momentum / volatility
    r14 = float(rsi(c, 14).iloc[-1])
    move24 = float((c.iloc[-1] - c.iloc[-25]) / a) if len(c) > 25 and a > 0 else None
    tail = a_series.dropna().tail(250)
    pct = float((tail <= a).mean()) if len(tail) >= 50 else None
    v.momentum = {"rsi14": _r(r14, 1), "move_24_bars_atr": _r(move24, 2)}
    v.volatility = {"atr": _r(a, 6), "atr_percentile_250": _r(pct, 2), "trend_vol_ratio": _r(last.get("tr_vol_ratio"), 2)}
    # ---- structure, candles, breakout / reversal location
    cr = read_latest(entry, trend=regime)
    v.candles = cr.as_dict()
    prior = entry.iloc[-21:-1]
    hi20, lo20 = float(prior["high"].max()), float(prior["low"].min())
    loc = ("breaking the 20-bar high" if c.iloc[-1] > hi20 else "breaking the 20-bar low" if c.iloc[-1] < lo20
           else "inside the 20-bar range")
    v.structure = {"support": cr.support, "resistance": cr.resistance, "dist_support_atr": cr.dist_support_atr,
                   "dist_resistance_atr": cr.dist_resistance_atr, "range_position": cr.range_position,
                   "location": loc}
    # ---- spread / execution
    if quote is not None:
        bid, ask, qt = quote
        sp_pts = (ask - bid) / point
        age = (now_t - pd.Timestamp(qt)).total_seconds()
        v.spread = {"points": _r(sp_pts, 1), "limit_points": max_spread_points, "share_of_atr_pct": _r((ask - bid) / a * 100, 1) if a > 0 else None,
                    "quote_age_s": _r(age, 0)}
    else:
        v.spread = {"points": None, "note": "no quote"}
    v.setup = setup
    sig = int(last.get("signal", 0) or 0)
    v.signal = "BUY" if sig > 0 else "SELL" if sig < 0 else None
    v.exposure = {"holding_position": holding, "currency_exposure": exposure_note,
                  "correlated_open_positions": correlated_with or []}
    v.score, v.attention = _score(v, pct, quote_max_age_s)
    return v


def _score(v: PairView, atr_pct: float | None, quote_max_age_s: float) -> tuple[float, list[str]]:
    s, why = 10.0, []
    if v.signal:
        s += 50
        why.append(f"{v.signal} signal on the latest completed bar")
    if v.setup:
        st = float(v.setup.get("stage") or 0)
        s += 30 * st
        why.append(f"{'BUY' if v.setup['side'] > 0 else 'SELL'} setup {st:.0%} formed"
                   + (f", trigger {v.setup['trigger_level']:.5g}" if v.setup.get("trigger_level") else ""))
    if v.trend.get("alignment") != "mixed":
        s += 10
        why.append(f"timeframes {v.trend['alignment']}")
    if atr_pct is not None:
        if atr_pct >= 0.95:
            s -= 10
            why.append(f"volatility abnormally high (ATR at the {atr_pct:.0%} percentile)")
        elif atr_pct <= 0.05:
            s -= 5
            why.append(f"volatility unusually low (ATR at the {atr_pct:.0%} percentile)")
    sp = v.spread
    if sp.get("points") is not None:
        lim = sp.get("limit_points")
        if lim and sp["points"] > lim:
            s -= 30
            why.append(f"spread {sp['points']} pts above the {lim} pt limit - entries blocked")
        elif (sp.get("share_of_atr_pct") or 0) > 10:
            s -= 15
            why.append(f"spread is {sp['share_of_atr_pct']}% of ATR (expensive)")
        if (sp.get("quote_age_s") or 0) > quote_max_age_s:
            s -= 30
            why.append(f"quote {sp['quote_age_s']:.0f}s old")
    else:
        s -= 30
        why.append("no quote")
    if not v.session["in_strategy_window"]:
        s -= 20
        why.append("outside the strategy's session window")
    if v.exposure.get("holding_position"):
        s -= 30
        why.append("already holding a position (max 1 per symbol)")
    if v.exposure.get("correlated_open_positions"):
        s -= 10
        why.append("correlated with open positions: " + ", ".join(v.exposure["correlated_open_positions"]))
    if v.events.get("blocking"):
        s -= 40
        why.append(f"event blackout: {v.events['blocking']}")
    for n in v.candles.get("notes", [])[:-1]:
        if "no named pattern" not in n:
            why.append("candles: " + n)
    if not why:
        why.append("nothing notable")
    return max(0.0, min(100.0, round(s, 1))), why


def rank(views: list[PairView]) -> list[PairView]:
    """Highest attention first; ties broken by symbol for a deterministic order."""
    return sorted(views, key=lambda x: (-x.score, x.symbol))
