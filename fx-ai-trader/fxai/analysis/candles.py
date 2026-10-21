"""Candlestick structure and patterns, read in context.

Everything is computed on COMPLETED bars only. Each pattern is reported with the context
that decides whether it means anything: the higher-timeframe trend, where the bar sits
relative to confirmed support/resistance (in ATR units) and where it closed within the
recent range.

Status: descriptive analysis for the dashboard, the watchlist and the decision log.
A pattern on its own has NO execution authority. Only rules that are part of a strategy
which passed the documented validation may open trades (``pullback_rejection`` uses a
wick-rejection rule and is under evaluation in research plan v2).

Definitions (body = |close-open|, range = high-low, wicks measured from the body):
  doji              body <= 10 % of range, range >= 0.3 ATR
  bullish pin bar   lower wick >= 2x body and >= 60 % of range, close in the upper third
  bearish pin bar   mirror image
  bullish engulfing previous bar bearish, this bar bullish, body covers the previous body
  bearish engulfing mirror image
  inside bar        high < previous high and low > previous low
  outside bar       high > previous high and low < previous low
  strong bull/bear  body >= 80 % of range and range >= 1 ATR (momentum candle)
  morning star      bar-2 bearish (body >= 0.6 ATR), bar-1 small (body <= 0.3 ATR),
                    this bar bullish closing above the middle of bar-2's body
  evening star      mirror image
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .indicators import atr
from .structure import find_swings, nearest_levels

PATTERNS = ["doji", "pin_bull", "pin_bear", "engulf_bull", "engulf_bear", "inside", "outside",
            "strong_bull", "strong_bear", "morning_star", "evening_star"]
DIRECTION = {"pin_bull": 1, "engulf_bull": 1, "strong_bull": 1, "morning_star": 1,
             "pin_bear": -1, "engulf_bear": -1, "strong_bear": -1, "evening_star": -1,
             "doji": 0, "inside": 0, "outside": 0}
LABEL = {"doji": "doji", "pin_bull": "bullish pin bar", "pin_bear": "bearish pin bar",
         "engulf_bull": "bullish engulfing", "engulf_bear": "bearish engulfing", "inside": "inside bar",
         "outside": "outside bar", "strong_bull": "strong bullish candle", "strong_bear": "strong bearish candle",
         "morning_star": "morning star", "evening_star": "evening star"}


def candle_frame(bars: pd.DataFrame, atr_period: int = 14) -> pd.DataFrame:
    """Vectorised pattern flags for every bar (each flag uses only that bar and earlier bars)."""
    o, h, lo, c = bars["open"], bars["high"], bars["low"], bars["close"]
    a = atr(bars, atr_period)
    body = (c - o).abs()
    rng = (h - lo).replace(0, np.nan)
    up_w = h - np.maximum(o, c)
    lo_w = np.minimum(o, c) - lo
    bull, bear = c > o, c < o
    po, pc, ph, pl = o.shift(1), c.shift(1), h.shift(1), lo.shift(1)
    f = pd.DataFrame(index=bars.index)
    f["atr"] = a
    f["body_atr"] = body / a
    f["range_atr"] = rng / a
    f["close_loc"] = (c - lo) / rng  # 0 = closed at the low, 1 = at the high
    f["doji"] = (body <= 0.1 * rng) & (rng >= 0.3 * a)
    f["pin_bull"] = (lo_w >= 2 * body) & (lo_w >= 0.6 * rng) & (f["close_loc"] >= 2 / 3)
    f["pin_bear"] = (up_w >= 2 * body) & (up_w >= 0.6 * rng) & (f["close_loc"] <= 1 / 3)
    f["engulf_bull"] = bull & (pc < po) & (o <= pc) & (c >= po) & (body > (pc - po).abs())
    f["engulf_bear"] = bear & (pc > po) & (o >= pc) & (c <= po) & (body > (pc - po).abs())
    f["inside"] = (h < ph) & (lo > pl)
    f["outside"] = (h > ph) & (lo < pl)
    f["strong_bull"] = bull & (body >= 0.8 * rng) & (rng >= a)
    f["strong_bear"] = bear & (body >= 0.8 * rng) & (rng >= a)
    o2, c2 = o.shift(2), c.shift(2)
    small1 = (c.shift(1) - o.shift(1)).abs() <= 0.3 * a
    f["morning_star"] = (c2 < o2) & ((o2 - c2) >= 0.6 * a) & small1 & bull & (c > (o2 + c2) / 2)
    f["evening_star"] = (c2 > o2) & ((c2 - o2) >= 0.6 * a) & small1 & bear & (c < (o2 + c2) / 2)
    for p in PATTERNS:
        f[p] = f[p].fillna(False).astype(bool) & a.notna()
    return f


@dataclass
class CandleRead:
    """The latest completed bar's candlestick picture, in context."""

    bar_close: pd.Timestamp | None
    patterns: list[str] = field(default_factory=list)  # pattern keys on the latest bar
    direction: int = 0  # +1 bullish, -1 bearish, 0 neutral/conflicting
    range_position: float | None = None  # close within the last `range_bars` bars, 0..1
    support: float | None = None
    resistance: float | None = None
    dist_support_atr: float | None = None
    dist_resistance_atr: float | None = None
    trend: str = "UNKNOWN"
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"bar_close": str(self.bar_close) if self.bar_close is not None else None, "patterns": self.patterns,
                "labels": [LABEL[p] for p in self.patterns], "direction": self.direction,
                "range_position": self.range_position, "support": self.support, "resistance": self.resistance,
                "dist_support_atr": self.dist_support_atr, "dist_resistance_atr": self.dist_resistance_atr,
                "trend": self.trend, "notes": self.notes}


def read_latest(bars: pd.DataFrame, trend: str = "UNKNOWN", range_bars: int = 20, swing_n: int = 3,
                level_lookback_bars: int = 200, near_atr: float = 0.5) -> CandleRead:
    """Describe the latest completed bar of ``bars`` (must contain close_time) in context."""
    if len(bars) < 30:
        return CandleRead(None, notes=["not enough bars for candlestick context"])
    f = candle_frame(bars)
    last = f.iloc[-1]
    row = bars.iloc[-1]
    close_t = pd.Timestamp(row["close_time"])
    a = float(last["atr"]) if pd.notna(last["atr"]) else None
    pats = [p for p in PATTERNS if bool(last[p])]
    dirs = {DIRECTION[p] for p in pats} - {0}
    direction = dirs.pop() if len(dirs) == 1 else 0
    win = bars.iloc[-range_bars:]
    hi, lo = float(win["high"].max()), float(win["low"].min())
    pos = round((float(row["close"]) - lo) / (hi - lo), 2) if hi > lo else None
    tf = bars["close_time"].iloc[-1] - bars["close_time"].iloc[-2]
    swings = find_swings(bars.iloc[-(level_lookback_bars + 2 * swing_n):], swing_n)
    res, sup = nearest_levels(swings, close_t, float(row["close"]), tf * level_lookback_bars)
    out = CandleRead(close_t, pats, direction, pos, sup, res, trend=trend)
    if a and sup is not None:
        out.dist_support_atr = round((float(row["low"]) - sup) / a, 2)
    if a and res is not None:
        out.dist_resistance_atr = round((res - float(row["high"])) / a, 2)
    out.notes = _context_notes(out, near_atr)
    return out


def _context_notes(r: CandleRead, near_atr: float) -> list[str]:
    notes = []
    if not r.patterns:
        notes.append("no named pattern on the latest completed bar")
    for p in r.patterns:
        d, label = DIRECTION[p], LABEL[p]
        where = []
        if d > 0 and r.dist_support_atr is not None and r.dist_support_atr <= near_atr:
            where.append(f"at support ({r.dist_support_atr:+.2f} ATR from swing low {r.support:.5g})")
        if d < 0 and r.dist_resistance_atr is not None and r.dist_resistance_atr <= near_atr:
            where.append(f"at resistance ({r.dist_resistance_atr:+.2f} ATR from swing high {r.resistance:.5g})")
        if d != 0 and r.trend in ("TREND_UP", "TREND_DOWN"):
            with_trend = (d > 0) == (r.trend == "TREND_UP")
            where.append("with the higher-timeframe trend" if with_trend else "against the higher-timeframe trend")
        if d != 0 and r.range_position is not None:
            if (d > 0 and r.range_position <= 0.25) or (d < 0 and r.range_position >= 0.75):
                where.append("at the extreme of the recent range (reversal location)")
            elif (d > 0 and r.range_position >= 0.75) or (d < 0 and r.range_position <= 0.25):
                where.append("closing near the range extreme in its own direction (breakout/continuation location)")
        if p == "inside":
            where.append("volatility contraction")
        notes.append(f"{label}" + (": " + "; ".join(where) if where else " (no supporting context)"))
    notes.append("context only - candlestick patterns have no execution authority on their own")
    return notes
