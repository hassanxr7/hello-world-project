"""S1 donchian_trend: multi-week channel breakout with an ATR trailing stop.

Hypothesis: time-series momentum over weeks is the best-documented FX anomaly;
the v1 baseline traded a horizon (hours) closest to a random walk.

Entry (H4, completed bars): first close above the highest high of the prior
55 bars (long) / below the lowest low (short). Initial stop 2 x ATR(14, H4).
Exit: 3 x ATR trailing stop from entry, no fixed target (20R cap), 30-day
maximum hold, no break-even. D1 regime is attached for reporting and for
regime-matched permutation tests only. All hours; weekends excluded.
Parameters fixed a priori (docs/RESEARCH_PLAN_v2.md).
"""

from __future__ import annotations

from typing import ClassVar

import numpy as np
import pandas as pd

from ..analysis.indicators import atr
from ..config import ExitConfig
from .base import StrategyBase, StrategyParamsBase, mark, session_mask


class DonchianParams(StrategyParamsBase):
    channel_bars: int = 55
    atr_period: int = 14
    stop_atr: float = 2.0
    watch_zone_atr: float = 0.5  # watchlist: within this distance of the channel edge


class DonchianTrend(StrategyBase):
    name: ClassVar[str] = "donchian_trend"
    version: ClassVar[str] = "1.0.0"
    default_entry_tf: ClassVar[str] = "H4"
    default_trend_tf: ClassVar[str] = "D1"
    default_exits: ClassVar[ExitConfig] = ExitConfig(take_profit_r=20.0, breakeven_enabled=False, trailing_enabled=True,
                                                     trailing_start_r=0.0, trailing_atr_mult=3.0, max_hold_hours=720)
    Params = DonchianParams
    features: ClassVar[list[str]] = ["adx_trend", "trend_strength", "channel_width_atr", "dist_to_edge_atr", "vol_ratio"]
    ignores_session_window: ClassVar[bool] = True
    setup_ttl_bars: ClassVar[int] = 6

    @property
    def warmup_bars(self) -> int:
        return self.p.channel_bars + self.p.atr_period + 5

    def compute(self, entry: pd.DataFrame, trend: pd.DataFrame, session_window: str = "00:00-24:00") -> pd.DataFrame:
        p = self.p
        f = pd.DataFrame(index=entry.index)
        for c in ("open", "high", "low", "close", "close_time"):
            f[c] = entry[c]
        f["atr_e"] = atr(entry, p.atr_period)
        f["ch_hi"] = f["high"].shift(1).rolling(p.channel_bars).max()
        f["ch_lo"] = f["low"].shift(1).rolling(p.channel_bars).min()
        f = self.attach_trend(f, trend)
        a = f["atr_e"]
        brk_up = f["close"] > f["ch_hi"]
        brk_dn = f["close"] < f["ch_lo"]
        f["r_first_up"] = brk_up & ~brk_up.shift(1, fill_value=False)
        f["r_first_dn"] = brk_dn & ~brk_dn.shift(1, fill_value=False)
        f["r_session"] = session_mask(f["close_time"], "00:00-24:00", "23:59").to_numpy()  # weekends only
        warm = f[["atr_e", "ch_hi", "ch_lo"]].notna().all(axis=1)
        long_sig = warm & f["r_first_up"] & f["r_session"]
        short_sig = warm & f["r_first_dn"] & f["r_session"]
        f["sl_l"] = f["close"] - p.stop_atr * a
        f["sl_s"] = f["close"] + p.stop_atr * a
        f["signal"] = np.where(long_sig, 1, np.where(short_sig, -1, 0))
        f["sl"] = np.where(long_sig, f["sl_l"], np.where(short_sig, f["sl_s"], np.nan))
        near_up = warm & ~brk_up & (f["close"] >= f["ch_hi"] - p.watch_zone_atr * a) & f["r_session"]
        near_dn = warm & ~brk_dn & (f["close"] <= f["ch_lo"] + p.watch_zone_atr * a) & f["r_session"]
        f["candidate_side"] = np.where(near_up, 1, np.where(near_dn, -1, 0))
        f["trigger_level"] = np.where(near_up, f["ch_hi"], np.where(near_dn, f["ch_lo"], np.nan))
        f["invalidation"] = np.where(near_up, f["close"] - p.stop_atr * a, np.where(near_dn, f["close"] + p.stop_atr * a, np.nan))
        side = np.where(f["signal"] != 0, f["signal"], np.where(f["candidate_side"] != 0, f["candidate_side"], 1))
        f["adx_trend"] = f["tr_adx"]
        f["trend_strength"] = side * (f["tr_ema_f"] - f["tr_ema_s"]) / f["tr_atr"]
        f["channel_width_atr"] = (f["ch_hi"] - f["ch_lo"]) / a
        f["dist_to_edge_atr"] = np.where(side > 0, (f["ch_hi"] - f["close"]) / a, (f["close"] - f["ch_lo"]) / a)
        f["vol_ratio"] = f["tr_vol_ratio"]
        return f

    def explain(self, row: pd.Series) -> list[str]:
        p = self.p
        out = [f"D1 regime {row['tr_regime']} (ADX {row['tr_adx']:.1f}); {p.channel_bars}-bar H4 channel "
               f"{row['ch_lo']:.5f}-{row['ch_hi']:.5f} ({row['channel_width_atr']:.1f} ATR wide)"]
        if row["signal"] > 0:
            out.append(f"BUY: first H4 close above the channel high; stop {row['sl']:.5f} ({p.stop_atr} ATR), "
                       f"trailing {self.exits.trailing_atr_mult} ATR, max hold {self.exits.max_hold_hours / 24:.0f} days")
        elif row["signal"] < 0:
            out.append(f"SELL: first H4 close below the channel low; stop {row['sl']:.5f} ({p.stop_atr} ATR), "
                       f"trailing {self.exits.trailing_atr_mult} ATR, max hold {self.exits.max_hold_hours / 24:.0f} days")
        elif row["candidate_side"] != 0:
            edge = "high" if row["candidate_side"] > 0 else "low"
            out.append(f"watching: close within {row['dist_to_edge_atr']:.2f} ATR of the channel {edge} "
                       f"({row['trigger_level']:.5f}); trigger = H4 close beyond it")
            out.append("WAIT: no breakout yet")
        else:
            out.append(f"WAIT: close inside the channel ({row['dist_to_edge_atr']:.1f} ATR from the nearer edge); "
                       f"weekend/session {mark(bool(row['r_session']))}")
        return out

    def invalidation_notes(self, row: pd.Series) -> list[str]:
        return [f"price beyond the initial stop {row['sl']:.5f}",
                f"a close back inside the channel before the next bar would cancel an unexecuted signal"]
