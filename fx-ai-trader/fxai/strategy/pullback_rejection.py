"""S4 pullback_rejection: enter AT the pullback on a rejection candle.

Hypothesis: the v1 baseline loses because it buys the resumption breakout
(extension); entering at the pullback itself, when a candle rejects the EMA20
zone, might have a better location.

Entry (H1, completed bars) in a TREND_UP H4 regime: the bar's low touches the
EMA20 +/- 0.25 ATR zone, it closes above the EMA20, its lower wick is >= 50 %
of its range and the close sits in the upper half of the bar. Stop below the
bar's low - 0.2 ATR (min 1 ATR, max 2.5 ATR). Target 2R, break-even at 1R
with +25 points (above round-trip cost), max hold 48 h. Mirror for shorts.
"""

from __future__ import annotations

from typing import ClassVar

import numpy as np
import pandas as pd

from ..analysis.indicators import atr, ema
from ..config import ExitConfig
from ..domain import Regime
from .base import StrategyBase, StrategyParamsBase, mark, session_mask


class PullbackRejectionParams(StrategyParamsBase):
    atr_period: int = 14
    ema_entry: int = 20
    zone_atr: float = 0.25
    min_wick_ratio: float = 0.5
    stop_buffer_atr: float = 0.2
    min_stop_atr: float = 1.0
    max_stop_atr: float = 2.5
    max_extension_atr: float = 1.0
    friday_cutoff_utc: str = "18:00"


class PullbackRejection(StrategyBase):
    name: ClassVar[str] = "pullback_rejection"
    version: ClassVar[str] = "1.0.0"
    default_entry_tf: ClassVar[str] = "H1"
    default_trend_tf: ClassVar[str] = "H4"
    default_exits: ClassVar[ExitConfig] = ExitConfig(take_profit_r=2.0, breakeven_enabled=True, breakeven_trigger_r=1.0,
                                                     breakeven_offset_points=25, trailing_enabled=False, max_hold_hours=48)
    Params = PullbackRejectionParams
    features: ClassVar[list[str]] = ["adx_trend", "trend_strength", "wick_ratio", "close_pos", "stop_atr", "ext_atr", "vol_ratio"]
    setup_ttl_bars: ClassVar[int] = 3

    @property
    def warmup_bars(self) -> int:
        return max(self.p.ema_entry, self.p.atr_period) * 3

    def compute(self, entry: pd.DataFrame, trend: pd.DataFrame, session_window: str = "00:00-24:00") -> pd.DataFrame:
        p = self.p
        f = pd.DataFrame(index=entry.index)
        for c in ("open", "high", "low", "close", "close_time"):
            f[c] = entry[c]
        f["atr_e"] = atr(entry, p.atr_period)
        f["ema20"] = ema(entry["close"], p.ema_entry)
        f = self.attach_trend(f, trend)
        a = f["atr_e"]
        rng = (f["high"] - f["low"]).replace(0, np.nan)
        f["wick_lo"] = (np.minimum(f["open"], f["close"]) - f["low"]) / rng
        f["wick_hi"] = (f["high"] - np.maximum(f["open"], f["close"])) / rng
        f["close_pos"] = (f["close"] - f["low"]) / rng  # 0 = at low, 1 = at high
        f["r_session"] = session_mask(f["close_time"], session_window, p.friday_cutoff_utc).to_numpy()
        f["r_regime_l"] = f["tr_regime"] == Regime.TREND_UP.value
        f["r_regime_s"] = f["tr_regime"] == Regime.TREND_DOWN.value
        f["r_touch_l"] = f["low"] <= f["ema20"] + p.zone_atr * a
        f["r_touch_s"] = f["high"] >= f["ema20"] - p.zone_atr * a
        f["r_close_l"] = (f["close"] > f["ema20"]) & (f["close_pos"] >= 0.5)
        f["r_close_s"] = (f["close"] < f["ema20"]) & (f["close_pos"] <= 0.5)
        f["r_wick_l"] = f["wick_lo"] >= p.min_wick_ratio
        f["r_wick_s"] = f["wick_hi"] >= p.min_wick_ratio
        f["ext_l"] = (f["close"] - f["ema20"]) / a
        f["ext_s"] = (f["ema20"] - f["close"]) / a
        f["r_ext_l"] = f["ext_l"] <= p.max_extension_atr
        f["r_ext_s"] = f["ext_s"] <= p.max_extension_atr
        sl_l = np.minimum(f["low"] - p.stop_buffer_atr * a, f["close"] - p.min_stop_atr * a)
        sl_s = np.maximum(f["high"] + p.stop_buffer_atr * a, f["close"] + p.min_stop_atr * a)
        f["sl_l"], f["sl_s"] = sl_l, sl_s
        f["stop_atr_l"] = (f["close"] - sl_l) / a
        f["stop_atr_s"] = (sl_s - f["close"]) / a
        f["r_stop_l"] = f["stop_atr_l"] <= p.max_stop_atr
        f["r_stop_s"] = f["stop_atr_s"] <= p.max_stop_atr
        warm = f[["atr_e", "ema20", "tr_adx", "close_pos"]].notna().all(axis=1)
        long_sig = warm & f["r_regime_l"] & f["r_touch_l"] & f["r_close_l"] & f["r_wick_l"] & f["r_ext_l"] & f["r_stop_l"] & f["r_session"]
        short_sig = warm & f["r_regime_s"] & f["r_touch_s"] & f["r_close_s"] & f["r_wick_s"] & f["r_ext_s"] & f["r_stop_s"] & f["r_session"]
        f["signal"] = np.where(long_sig, 1, np.where(short_sig, -1, 0))
        f["sl"] = np.where(long_sig, sl_l, np.where(short_sig, sl_s, np.nan))
        watch_l = warm & f["r_regime_l"] & f["r_touch_l"] & f["r_session"] & ~long_sig
        watch_s = warm & f["r_regime_s"] & f["r_touch_s"] & f["r_session"] & ~short_sig
        f["candidate_side"] = np.where(watch_l, 1, np.where(watch_s, -1, 0))
        f["invalidation"] = np.where(watch_l, sl_l, np.where(watch_s, sl_s, np.nan))
        side = np.where(f["signal"] != 0, f["signal"], np.where(f["candidate_side"] != 0, f["candidate_side"],
                                                                 np.where(f["r_regime_s"], -1, 1)))
        f["adx_trend"] = f["tr_adx"]
        f["trend_strength"] = side * (f["tr_ema_f"] - f["tr_ema_s"]) / f["tr_atr"]
        f["wick_ratio"] = np.where(side > 0, f["wick_lo"], f["wick_hi"])
        f["close_pos"] = np.where(side > 0, f["close_pos"], 1 - f["close_pos"])
        f["stop_atr"] = np.where(side > 0, f["stop_atr_l"], f["stop_atr_s"])
        f["ext_atr"] = np.where(side > 0, f["ext_l"], f["ext_s"])
        f["vol_ratio"] = f["tr_vol_ratio"]
        return f

    def explain(self, row: pd.Series) -> list[str]:
        p = self.p
        reg = row["tr_regime"]
        out = [f"H4 regime {reg} (ADX {row['tr_adx']:.1f}, slope {row['tr_slope']:+.2f} ATR)"]
        if reg not in (Regime.TREND_UP.value, Regime.TREND_DOWN.value):
            out.append("WAIT: no qualifying trend regime")
            return out
        s = "l" if reg == Regime.TREND_UP.value else "s"
        out.append(f"session window: {mark(bool(row['r_session']))}")
        out.append(f"bar touched the EMA{p.ema_entry} ± {p.zone_atr} ATR zone: {mark(bool(row[f'r_touch_{s}']))}")
        out.append(f"rejection wick {row['wick_ratio']:.2f} of range >= {p.min_wick_ratio}: {mark(bool(row[f'r_wick_{s}']))}")
        out.append(f"close back on the trend side of the EMA, in the trend-side half ({row['close_pos']:.2f}): "
                   f"{mark(bool(row[f'r_close_{s}']))}")
        out.append(f"extension {row[f'ext_{s}']:.2f} ATR <= {p.max_extension_atr}: {mark(bool(row[f'r_ext_{s}']))}")
        out.append(f"stop {row[f'stop_atr_{s}']:.2f} ATR <= {p.max_stop_atr}: {mark(bool(row[f'r_stop_{s}']))}")
        if row["signal"] == 0:
            out.append("WAIT: at least one condition failed")
        else:
            out.append(f"{'BUY' if s == 'l' else 'SELL'}: rejection at the pullback; stop {row['sl']:.5f}, "
                       f"target {self.exits.take_profit_r}R, BE at 1R (+{self.exits.breakeven_offset_points} pts)")
        return out

    def invalidation_notes(self, row: pd.Series) -> list[str]:
        return [f"price beyond the stop {row['sl']:.5f} (rejection bar extreme ± buffer)",
                "H4 regime no longer trending in the trade direction"]
