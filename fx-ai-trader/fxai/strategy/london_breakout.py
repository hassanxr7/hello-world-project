"""S3 london_breakout: first decisive break of the Asian range after the London open.

Hypothesis: the London open releases the overnight range; the direction of the
first decisive break has a small continuation tendency.

Entry (M15, completed bars): Asian range = high/low of bars opening 00:00-06:59
UTC. Between 07:00 and 10:00 UTC the first M15 close above the range high ->
BUY (below the low -> SELL); one trade per symbol per day. Range must be
0.5-2.0 x ATR(14, H1). Stop = opposite side of the range (capped at 2.5 ATR),
target = 1 x range height from the entry reference, forced exit at 16:00 UTC,
no break-even.
"""

from __future__ import annotations

from typing import ClassVar

import numpy as np
import pandas as pd

from ..analysis.indicators import atr
from ..config import ExitConfig
from .base import StrategyBase, StrategyParamsBase, mark


class LondonBreakoutParams(StrategyParamsBase):
    asian_start_hour: int = 0
    asian_end_hour: int = 7
    window_end_hour: int = 10
    exit_hour: int = 16
    min_range_atr: float = 0.5
    max_range_atr: float = 2.0
    max_stop_atr: float = 2.5
    atr_period: int = 14


class LondonBreakout(StrategyBase):
    name: ClassVar[str] = "london_breakout"
    version: ClassVar[str] = "1.0.0"
    default_entry_tf: ClassVar[str] = "M15"
    default_trend_tf: ClassVar[str] = "H1"
    default_exits: ClassVar[ExitConfig] = ExitConfig(take_profit_r=1.0, breakeven_enabled=False, trailing_enabled=False,
                                                     max_hold_hours=9)
    Params = LondonBreakoutParams
    features: ClassVar[list[str]] = ["range_atr", "adx_trend", "trend_strength", "break_margin_atr", "vol_ratio"]
    ignores_session_window: ClassVar[bool] = True
    setup_ttl_bars: ClassVar[int] = 12

    @property
    def warmup_bars(self) -> int:
        return 96 * 2

    def compute(self, entry: pd.DataFrame, trend: pd.DataFrame, session_window: str = "00:00-24:00") -> pd.DataFrame:
        p = self.p
        f = pd.DataFrame(index=entry.index)
        for c in ("open", "high", "low", "close", "close_time"):
            f[c] = entry[c]
        f["atr_e"] = atr(entry, p.atr_period)
        f = self.attach_trend(f, trend)  # H1 regime + ATR(14, H1) as tr_atr
        idx = pd.DatetimeIndex(f.index)
        day = idx.normalize()
        hour = idx.hour
        asian = (hour >= p.asian_start_hour) & (hour < p.asian_end_hour)
        hi = f["high"].where(asian).groupby(day).cummax().groupby(day).ffill()
        lo = f["low"].where(asian).groupby(day).cummin().groupby(day).ffill()
        f["range_hi"], f["range_lo"] = hi, lo
        f["range_h"] = hi - lo
        ct = pd.DatetimeIndex(f["close_time"])
        in_window = (ct.hour * 60 + ct.minute > p.asian_end_hour * 60) & (ct.hour * 60 + ct.minute <= p.window_end_hour * 60)
        weekday = (ct.weekday < 5)
        f["r_window"] = np.asarray(in_window & weekday)
        f["r_session"] = f["r_window"]
        f["range_atr"] = f["range_h"] / f["tr_atr"]
        f["r_range"] = (f["range_atr"] >= p.min_range_atr) & (f["range_atr"] <= p.max_range_atr)
        above = f["close"] > f["range_hi"]
        below = f["close"] < f["range_lo"]
        f["r_break_l"] = above & ~above.shift(1, fill_value=False)
        f["r_break_s"] = below & ~below.shift(1, fill_value=False)
        warm = f[["atr_e", "tr_atr", "range_hi", "range_lo"]].notna().all(axis=1)
        raw_l = warm & f["r_window"] & f["r_range"] & f["r_break_l"]
        raw_s = warm & f["r_window"] & f["r_range"] & f["r_break_s"]
        raw = raw_l | raw_s
        nth = raw.astype(int).groupby(day).cumsum()
        first = raw & (nth == 1)  # one trade per symbol per day
        long_sig, short_sig = first & raw_l, first & raw_s
        tr_atr = f["tr_atr"]
        sl_l = np.maximum(f["range_lo"], f["close"] - p.max_stop_atr * tr_atr)
        sl_s = np.minimum(f["range_hi"], f["close"] + p.max_stop_atr * tr_atr)
        f["sl"] = np.where(long_sig, sl_l, np.where(short_sig, sl_s, np.nan))
        f["tp"] = np.where(long_sig, f["close"] + f["range_h"], np.where(short_sig, f["close"] - f["range_h"], np.nan))
        f["signal"] = np.where(long_sig, 1, np.where(short_sig, -1, 0))
        exit_at = pd.DatetimeIndex(day) + pd.Timedelta(hours=p.exit_hour)
        f["deadline"] = pd.Series(np.where(long_sig | short_sig, exit_at.asi8, np.nan), index=f.index)
        f["deadline"] = pd.to_datetime(f["deadline"], utc=True)
        # watchlist: valid range during the window, no break yet (trigger levels = range edges)
        watch = warm & f["r_window"] & f["r_range"] & ~above & ~below & (nth == 0)
        f["candidate_side"] = np.where(watch, np.where(f["close"] >= (hi + lo) / 2, 1, -1), 0)
        f["trigger_level"] = np.where(f["candidate_side"] > 0, f["range_hi"], np.where(f["candidate_side"] < 0, f["range_lo"], np.nan))
        f["invalidation"] = np.where(f["candidate_side"] > 0, f["range_lo"], np.where(f["candidate_side"] < 0, f["range_hi"], np.nan))
        side = np.where(f["signal"] != 0, f["signal"], np.where(f["candidate_side"] != 0, f["candidate_side"], 1))
        f["adx_trend"] = f["tr_adx"]
        f["trend_strength"] = side * (f["tr_ema_f"] - f["tr_ema_s"]) / f["tr_atr"]
        f["break_margin_atr"] = np.where(side > 0, (f["close"] - f["range_hi"]) / tr_atr, (f["range_lo"] - f["close"]) / tr_atr)
        f["vol_ratio"] = f["tr_vol_ratio"]
        return f

    def explain(self, row: pd.Series) -> list[str]:
        p = self.p
        out = []
        if pd.isna(row.get("range_hi")):
            out.append("WAIT: Asian range not formed yet (00:00-07:00 UTC)")
            return out
        out.append(f"Asian range {row['range_lo']:.5f}-{row['range_hi']:.5f} = {row['range_atr']:.2f} ATR(H1); "
                   f"size {p.min_range_atr}-{p.max_range_atr} ATR: {mark(bool(row['r_range']))}")
        out.append(f"breakout window {p.asian_end_hour:02d}:00-{p.window_end_hour:02d}:00 UTC: {mark(bool(row['r_window']))}")
        if row["signal"] > 0:
            out.append(f"BUY: first M15 close above the range high; stop {row['sl']:.5f}, target {row['tp']:.5f} "
                       f"(1x range), forced exit {p.exit_hour:02d}:00 UTC")
        elif row["signal"] < 0:
            out.append(f"SELL: first M15 close below the range low; stop {row['sl']:.5f}, target {row['tp']:.5f} "
                       f"(1x range), forced exit {p.exit_hour:02d}:00 UTC")
        elif row["candidate_side"] != 0:
            out.append(f"watching: price inside the range; trigger = M15 close beyond {row['trigger_level']:.5f}")
            out.append("WAIT: no break yet")
        else:
            out.append("WAIT: outside the breakout window, range filter failed, or today's trade already taken")
        return out

    def invalidation_notes(self, row: pd.Series) -> list[str]:
        return [f"price back inside the range beyond the stop {row['sl']:.5f}",
                f"window closes at {self.p.window_end_hour:02d}:00 UTC; position closed by {self.p.exit_hour:02d}:00 UTC"]
