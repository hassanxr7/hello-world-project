"""S2 range_reversion: fade a 2-sigma extension in a RANGE regime.

Hypothesis: short-horizon FX returns show negative autocorrelation when no
trend is present.

Entry (H1, completed bars): close below the lower Bollinger band (20, 2 sigma)
with RSI(14) < 30 while the H4 regime is RANGE -> BUY; mirror for SELL.
Stop 1.5 x ATR(14, H1) beyond the signal bar's extreme. Target = Bollinger
middle at signal time, required to be at least 0.8R away. Max hold 24 h, no
break-even, no trailing. Session: the symbol's window.
"""

from __future__ import annotations

from typing import ClassVar

import numpy as np
import pandas as pd

from ..analysis.indicators import atr, rsi
from ..config import ExitConfig
from ..domain import Regime
from .base import StrategyBase, StrategyParamsBase, mark, session_mask


class RangeReversionParams(StrategyParamsBase):
    bb_period: int = 20
    bb_sigma: float = 2.0
    rsi_period: int = 14
    rsi_low: float = 30.0
    rsi_high: float = 70.0
    atr_period: int = 14
    stop_atr: float = 1.5
    min_target_r: float = 0.8


class RangeReversion(StrategyBase):
    name: ClassVar[str] = "range_reversion"
    version: ClassVar[str] = "1.0.0"
    default_entry_tf: ClassVar[str] = "H1"
    default_trend_tf: ClassVar[str] = "H4"
    default_exits: ClassVar[ExitConfig] = ExitConfig(take_profit_r=1.0, breakeven_enabled=False, trailing_enabled=False,
                                                     max_hold_hours=24)
    Params = RangeReversionParams
    features: ClassVar[list[str]] = ["adx_trend", "bb_z", "rsi_side", "target_r", "stop_atr", "vol_ratio"]
    setup_ttl_bars: ClassVar[int] = 2

    @property
    def warmup_bars(self) -> int:
        return max(self.p.bb_period, self.p.rsi_period, self.p.atr_period) + 10

    def compute(self, entry: pd.DataFrame, trend: pd.DataFrame, session_window: str = "00:00-24:00") -> pd.DataFrame:
        p = self.p
        f = pd.DataFrame(index=entry.index)
        for c in ("open", "high", "low", "close", "close_time"):
            f[c] = entry[c]
        f["atr_e"] = atr(entry, p.atr_period)
        f["rsi"] = rsi(entry["close"], p.rsi_period)
        mid = f["close"].rolling(p.bb_period).mean()
        sd = f["close"].rolling(p.bb_period).std(ddof=0)
        f["bb_mid"], f["bb_up"], f["bb_lo"] = mid, mid + p.bb_sigma * sd, mid - p.bb_sigma * sd
        f["bb_z"] = (f["close"] - mid) / sd.replace(0, np.nan)
        f = self.attach_trend(f, trend)
        a = f["atr_e"]
        f["r_session"] = session_mask(f["close_time"], session_window).to_numpy()
        f["r_regime"] = f["tr_regime"] == Regime.RANGE.value
        f["r_band_l"] = f["close"] < f["bb_lo"]
        f["r_band_s"] = f["close"] > f["bb_up"]
        f["r_rsi_l"] = f["rsi"] < p.rsi_low
        f["r_rsi_s"] = f["rsi"] > p.rsi_high
        f["sl_l"] = f["low"] - p.stop_atr * a
        f["sl_s"] = f["high"] + p.stop_atr * a
        risk_l = f["close"] - f["sl_l"]
        risk_s = f["sl_s"] - f["close"]
        f["target_r_l"] = (f["bb_mid"] - f["close"]) / risk_l
        f["target_r_s"] = (f["close"] - f["bb_mid"]) / risk_s
        f["r_target_l"] = f["target_r_l"] >= p.min_target_r
        f["r_target_s"] = f["target_r_s"] >= p.min_target_r
        warm = f[["atr_e", "rsi", "bb_mid", "tr_adx"]].notna().all(axis=1)
        long_sig = warm & f["r_regime"] & f["r_band_l"] & f["r_rsi_l"] & f["r_target_l"] & f["r_session"]
        short_sig = warm & f["r_regime"] & f["r_band_s"] & f["r_rsi_s"] & f["r_target_s"] & f["r_session"]
        f["signal"] = np.where(long_sig, 1, np.where(short_sig, -1, 0))
        f["sl"] = np.where(long_sig, f["sl_l"], np.where(short_sig, f["sl_s"], np.nan))
        f["tp"] = np.where(long_sig | short_sig, f["bb_mid"], np.nan)
        watch_l = warm & f["r_regime"] & f["r_band_l"] & ~long_sig & f["r_session"]
        watch_s = warm & f["r_regime"] & f["r_band_s"] & ~short_sig & f["r_session"]
        f["candidate_side"] = np.where(watch_l, 1, np.where(watch_s, -1, 0))
        f["invalidation"] = np.where(watch_l, f["sl_l"], np.where(watch_s, f["sl_s"], np.nan))
        side = np.where(f["signal"] != 0, f["signal"], np.where(f["candidate_side"] != 0, f["candidate_side"],
                                                                 np.where(f["bb_z"] < 0, 1, -1)))
        f["adx_trend"] = f["tr_adx"]
        f["rsi_side"] = np.where(side > 0, f["rsi"], 100 - f["rsi"])
        f["target_r"] = np.where(side > 0, f["target_r_l"], f["target_r_s"])
        f["stop_atr"] = np.where(side > 0, risk_l / a, risk_s / a)
        f["vol_ratio"] = f["tr_vol_ratio"]
        return f

    def explain(self, row: pd.Series) -> list[str]:
        p = self.p
        out = [f"H4 regime {row['tr_regime']} (ADX {row['tr_adx']:.1f}); RANGE required: {mark(bool(row['r_regime']))}",
               f"close z-score vs Bollinger({p.bb_period}, {p.bb_sigma}σ): {row['bb_z']:+.2f}; RSI {row['rsi']:.1f}"]
        if not row["r_regime"]:
            out.append("WAIT: not a ranging regime")
            return out
        s = "l" if row["bb_z"] < 0 else "s"
        word = "long" if s == "l" else "short"
        out.append(f"session window: {mark(bool(row['r_session']))}")
        out.append(f"close beyond the {'lower' if s == 'l' else 'upper'} band: {mark(bool(row[f'r_band_{s}']))}")
        out.append(f"RSI {'<' if s == 'l' else '>'} {p.rsi_low if s == 'l' else p.rsi_high}: {mark(bool(row[f'r_rsi_{s}']))}")
        out.append(f"target (band middle {row['bb_mid']:.5f}) = {row[f'target_r_{s}']:.2f}R >= {p.min_target_r}R: "
                   f"{mark(bool(row[f'r_target_{s}']))}")
        if row["signal"] == 0:
            out.append("WAIT: at least one condition failed")
        else:
            out.append(f"{'BUY' if s == 'l' else 'SELL'} ({word} fade): stop {row['sl']:.5f}, target {row['tp']:.5f}, "
                       f"max hold {self.exits.max_hold_hours:.0f} h")
        return out

    def invalidation_notes(self, row: pd.Series) -> list[str]:
        return [f"price beyond the stop {row['sl']:.5f}", "H4 regime turning into a trend",
                "a further close beyond the band on the next bar (momentum, not exhaustion)"]
