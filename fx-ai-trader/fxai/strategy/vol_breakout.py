"""S5 vol_breakout: volatility-compression breakout in the direction of the daily trend.

Hypothesis: compression (inside bar / narrowest range of 4) precedes expansion;
breaking out of the compressed range with the daily trend captures the expansion.

Entry (H4, completed bars): the previous bar is an inside bar (its range inside
the bar before it; mother range = that earlier bar) or an NR4 bar (narrowest of
the last four; mother range = itself). Signal when the current bar closes beyond
the mother range in the direction of the D1 trend (EMA50 vs EMA200).
Stop = other side of the mother range, floored at 0.75 ATR(14, H4) and capped at
2.5 ATR. Target 2R, max hold 72 h, no break-even.
"""

from __future__ import annotations

from typing import ClassVar

import numpy as np
import pandas as pd

from ..analysis.indicators import atr
from ..config import ExitConfig
from .base import StrategyBase, StrategyParamsBase, mark, session_mask


class VolBreakoutParams(StrategyParamsBase):
    atr_period: int = 14
    nr_bars: int = 4
    min_stop_atr: float = 0.75
    max_stop_atr: float = 2.5


class VolBreakout(StrategyBase):
    name: ClassVar[str] = "vol_breakout"
    version: ClassVar[str] = "1.0.0"
    default_entry_tf: ClassVar[str] = "H4"
    default_trend_tf: ClassVar[str] = "D1"
    default_exits: ClassVar[ExitConfig] = ExitConfig(take_profit_r=2.0, breakeven_enabled=False, trailing_enabled=False,
                                                     max_hold_hours=72)
    Params = VolBreakoutParams
    features: ClassVar[list[str]] = ["adx_trend", "trend_strength", "mother_range_atr", "compression_ratio", "stop_atr", "vol_ratio"]
    ignores_session_window: ClassVar[bool] = True
    setup_ttl_bars: ClassVar[int] = 2

    @property
    def warmup_bars(self) -> int:
        return self.p.atr_period * 3

    def compute(self, entry: pd.DataFrame, trend: pd.DataFrame, session_window: str = "00:00-24:00") -> pd.DataFrame:
        p = self.p
        f = pd.DataFrame(index=entry.index)
        for c in ("open", "high", "low", "close", "close_time"):
            f[c] = entry[c]
        f["atr_e"] = atr(entry, p.atr_period)
        f = self.attach_trend(f, trend)
        a = f["atr_e"]
        rng = f["high"] - f["low"]
        h1, l1, h2, l2 = f["high"].shift(1), f["low"].shift(1), f["high"].shift(2), f["low"].shift(2)
        inside = (h1 < h2) & (l1 > l2)  # previous bar inside the one before
        nr = rng.shift(1) <= rng.shift(1).rolling(p.nr_bars).min()  # previous bar narrowest of last nr_bars
        f["r_compression"] = inside | nr
        f["mother_hi"] = np.where(inside, h2, h1)
        f["mother_lo"] = np.where(inside, l2, l1)
        f["mother_range_atr"] = (f["mother_hi"] - f["mother_lo"]) / a
        f["compression_ratio"] = rng.shift(1) / rng.shift(1).rolling(p.nr_bars + 6).mean()
        f["r_trend_l"] = f["tr_ema_f"] > f["tr_ema_s"]
        f["r_trend_s"] = f["tr_ema_f"] < f["tr_ema_s"]
        f["r_break_l"] = f["close"] > f["mother_hi"]
        f["r_break_s"] = f["close"] < f["mother_lo"]
        f["r_session"] = session_mask(f["close_time"], "00:00-24:00", "23:59").to_numpy()
        sl_l = np.minimum(np.maximum(f["mother_lo"], f["close"] - p.max_stop_atr * a), f["close"] - p.min_stop_atr * a)
        sl_s = np.maximum(np.minimum(f["mother_hi"], f["close"] + p.max_stop_atr * a), f["close"] + p.min_stop_atr * a)
        f["sl_l"], f["sl_s"] = sl_l, sl_s
        warm = f[["atr_e", "tr_ema_s", "mother_hi"]].notna().all(axis=1) & rng.shift(2).notna()
        long_sig = warm & f["r_compression"] & f["r_trend_l"] & f["r_break_l"] & f["r_session"]
        short_sig = warm & f["r_compression"] & f["r_trend_s"] & f["r_break_s"] & f["r_session"]
        f["signal"] = np.where(long_sig, 1, np.where(short_sig, -1, 0))
        f["sl"] = np.where(long_sig, sl_l, np.where(short_sig, sl_s, np.nan))
        # watchlist: the CURRENT bar is a compression bar -> next bar may break it
        cur_inside = (f["high"] < h1) & (f["low"] > l1)
        cur_nr = rng <= rng.rolling(p.nr_bars).min()
        watch = warm & (cur_inside | cur_nr) & (f["r_trend_l"] | f["r_trend_s"]) & f["r_session"]
        f["candidate_side"] = np.where(watch, np.where(f["r_trend_l"], 1, -1), 0)
        cur_hi = np.where(cur_inside, h1, f["high"])
        cur_lo = np.where(cur_inside, l1, f["low"])
        f["trigger_level"] = np.where(f["candidate_side"] > 0, cur_hi, np.where(f["candidate_side"] < 0, cur_lo, np.nan))
        f["invalidation"] = np.where(f["candidate_side"] > 0, cur_lo, np.where(f["candidate_side"] < 0, cur_hi, np.nan))
        side = np.where(f["signal"] != 0, f["signal"], np.where(f["candidate_side"] != 0, f["candidate_side"],
                                                                 np.where(f["r_trend_s"], -1, 1)))
        f["adx_trend"] = f["tr_adx"]
        f["trend_strength"] = side * (f["tr_ema_f"] - f["tr_ema_s"]) / f["tr_atr"]
        f["stop_atr"] = np.where(side > 0, (f["close"] - sl_l) / a, (sl_s - f["close"]) / a)
        f["vol_ratio"] = f["tr_vol_ratio"]
        return f

    def explain(self, row: pd.Series) -> list[str]:
        out = [f"D1 trend: EMA50 {'>' if row['tr_ema_f'] > row['tr_ema_s'] else '<'} EMA200 (regime {row['tr_regime']})",
               f"previous H4 bar compressed (inside bar or NR{self.p.nr_bars}): {mark(bool(row['r_compression']))}; "
               f"mother range {row['mother_lo']:.5f}-{row['mother_hi']:.5f} ({row['mother_range_atr']:.2f} ATR)"]
        if row["signal"] > 0:
            out.append(f"BUY: close above the mother range with the daily uptrend; stop {row['sl']:.5f} "
                       f"({row['stop_atr']:.2f} ATR), target {self.exits.take_profit_r}R, max hold {self.exits.max_hold_hours:.0f} h")
        elif row["signal"] < 0:
            out.append(f"SELL: close below the mother range with the daily downtrend; stop {row['sl']:.5f} "
                       f"({row['stop_atr']:.2f} ATR), target {self.exits.take_profit_r}R, max hold {self.exits.max_hold_hours:.0f} h")
        elif row["candidate_side"] != 0:
            out.append(f"watching: this bar is a compression bar; trigger = next H4 close beyond {row['trigger_level']:.5f} "
                       f"({'up' if row['candidate_side'] > 0 else 'down'} with the daily trend)")
            out.append("WAIT: no breakout yet")
        else:
            out.append("WAIT: no compression/breakout with the daily trend")
        return out

    def invalidation_notes(self, row: pd.Series) -> list[str]:
        return [f"price beyond the stop {row['sl']:.5f} (other side of the mother range)",
                "D1 EMA50/EMA200 order flipping"]
