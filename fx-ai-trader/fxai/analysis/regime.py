"""Shared trend-timeframe regime classification (used by several strategies and
by the random-entry permutation test for regime matching).

VOLATILE   ATR / rolling-median ATR > vol_ratio_max
TREND_UP   ADX >= adx_min, EMA_fast > EMA_slow, close > EMA_fast, EMA_fast rising
TREND_DOWN mirror image
RANGE      otherwise
UNKNOWN    indicators not warmed up
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..domain import Regime
from .indicators import adx, atr, ema, rolling_median


@dataclass(frozen=True)
class RegimeParams:
    atr_period: int = 14
    adx_period: int = 14
    adx_min: float = 20.0
    ema_fast: int = 50
    ema_slow: int = 200
    ema_slope_bars: int = 5
    vol_ratio_max: float = 2.0
    vol_median_window: int = 500

    @property
    def warmup_bars(self) -> int:
        return self.ema_slow + 20


def regime_frame(bars: pd.DataFrame, p: RegimeParams = RegimeParams()) -> pd.DataFrame:
    out = pd.DataFrame(index=bars.index)
    out["close_time"] = bars["close_time"]
    out["close"] = bars["close"]
    out["high"] = bars["high"]
    out["low"] = bars["low"]
    out["atr"] = atr(bars, p.atr_period)
    out["adx"] = adx(bars, p.adx_period)["adx"]
    out["ema_f"] = ema(bars["close"], p.ema_fast)
    out["ema_s"] = ema(bars["close"], p.ema_slow)
    out["slope"] = (out["ema_f"] - out["ema_f"].shift(p.ema_slope_bars)) / out["atr"]
    out["vol_ratio"] = out["atr"] / rolling_median(out["atr"], p.vol_median_window)
    up = (out["adx"] >= p.adx_min) & (out["ema_f"] > out["ema_s"]) & (out["close"] > out["ema_f"]) & (out["slope"] > 0)
    dn = (out["adx"] >= p.adx_min) & (out["ema_f"] < out["ema_s"]) & (out["close"] < out["ema_f"]) & (out["slope"] < 0)
    regime = np.where(up, Regime.TREND_UP.value, np.where(dn, Regime.TREND_DOWN.value, Regime.RANGE.value))
    regime = np.where(out["vol_ratio"] > p.vol_ratio_max, Regime.VOLATILE.value, regime)
    unknown = out[["adx", "ema_s", "slope", "vol_ratio"]].isna().any(axis=1)
    out["regime"] = np.where(unknown, Regime.UNKNOWN.value, regime)
    return out


REGIME_COLS = ["regime", "adx", "ema_f", "ema_s", "slope", "vol_ratio", "atr", "close"]
