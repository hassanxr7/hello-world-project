"""Trade-path simulation at M1 resolution.

Fill rules (conservative where the data cannot tell us what happened):
- Entry: market order at the OPEN of the first M1 bar after the signal bar
  closes, at ask (BUY) / bid (SELL) plus adverse entry slippage.
- Stops are checked against the closing side (bid for longs, ask for shorts).
- Gap through the stop at a bar open: filled at the open (worse than SL) plus slippage.
- **Intrabar ambiguity**: M1 bars do not reveal the order of high and low. If a
  bar touches both stop and target, the STOP is assumed to fill first. Such
  bars are counted and reported.
- Take-profit fills exactly at the TP price (no positive slippage assumed).
- Break-even / trailing updates are computed at each M1 close and only take
  effect from the next bar (the real EA reacts tick-by-tick; this is slightly
  pessimistic for winners and is documented).
- Time stop: closed at the bar close (bid/ask) minus stop slippage.
- Swap is charged at each 17:00 New York rollover held, triple on Wednesdays.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import ExitConfig
from .costs import CostModel


@dataclass
class SymbolArrays:
    symbol: str
    pip_size: float
    point: float
    t: np.ndarray  # int64 ns, bar open times
    o: np.ndarray  # mid (or bid, see basis) prices
    h: np.ndarray
    lo: np.ndarray
    c: np.ndarray
    spread: np.ndarray  # price units
    rollover: np.ndarray  # swap multiplier applied when this bar is the first of a new FX day
    basis: str = "mid"

    @classmethod
    def from_m1(cls, symbol: str, m1: pd.DataFrame, costs: CostModel, pip_size: float, point: float) -> "SymbolArrays":
        idx = pd.DatetimeIndex(m1.index).as_unit("ns")  # pandas 3 may parse at us/s resolution
        hours = idx.hour.to_numpy()
        if "spread" in m1 and m1["spread"].gt(0).any():
            spread = m1["spread"].to_numpy() * point * costs.spread_multiplier
        else:
            spread = costs.spread_series(symbol, hours, pip_size)
        ny = idx.tz_convert("America/New_York")
        day = (ny - pd.Timedelta(hours=17)).normalize()
        new_day = np.r_[False, day[1:] != day[:-1]]
        # Weekday (NY) of the rollover: Wednesday 17:00 -> 3x (weekend financing)
        mult = np.where(new_day, np.where(ny.weekday == 2, 3.0, 1.0), 0.0)
        return cls(symbol, pip_size, point, idx.asi8.copy(), m1["open"].to_numpy(float), m1["high"].to_numpy(float),
                   m1["low"].to_numpy(float), m1["close"].to_numpy(float), spread.astype(float), mult,
                   m1.attrs.get("price_basis", "mid"))

    def bid_ask(self, i: int) -> tuple[float, float, float, float, float, float, float, float]:
        s = self.spread[i]
        if self.basis == "bid":
            bo, bh, bl, bc = self.o[i], self.h[i], self.lo[i], self.c[i]
        else:
            half = s / 2.0
            bo, bh, bl, bc = self.o[i] - half, self.h[i] - half, self.lo[i] - half, self.c[i] - half
        return bo, bh, bl, bc, bo + s, bh + s, bl + s, bc + s

    def index_at_or_after(self, ts_ns: int) -> int:
        return int(np.searchsorted(self.t, ts_ns, side="left"))


@dataclass
class TradePath:
    symbol: str
    side: int
    i_entry: int
    i_exit: int
    t_entry: int
    t_exit: int
    entry: float
    exit: float
    initial_sl: float
    tp: float
    risk_dist: float
    reason: str
    ambiguous_bars: int
    swap_nights: float
    mfe_r: float
    mae_r: float
    be_time: int | None
    entry_spread: float
    exit_spread: float
    # per-bar mark-to-market (price units * side), aligned to t[i_entry:i_exit+1]
    mtm: np.ndarray
    sl_changes: list[tuple[int, float]]

    @property
    def r_gross(self) -> float:
        return (self.exit - self.entry) * self.side / self.risk_dist if self.risk_dist > 0 else 0.0

    def sl_at(self, ts_ns: int) -> float:
        sl = self.initial_sl
        for t, v in self.sl_changes:
            if t <= ts_ns:
                sl = v
        return sl


def simulate_trade(a: SymbolArrays, i0: int, side: int, sl: float, exits: ExitConfig, costs: CostModel,
                   atr_at_entry: float, stop_level: float = 0.0) -> TradePath | None:
    n = len(a.t)
    if i0 >= n:
        return None
    bo, bh, bl, bc, ao, ah, al, ac = a.bid_ask(i0)
    eslip, sslip = costs.entry_slip(a.pip_size), costs.stop_slip(a.pip_size)
    entry = ao + eslip if side > 0 else bo - eslip
    risk = (entry - sl) * side
    if risk <= 0:
        return None  # price already beyond the stop at entry - signal invalid
    tp = entry + side * exits.take_profit_r * risk
    max_ns = int(exits.max_hold_hours * 3600e9)
    be_level = entry + side * exits.breakeven_offset_points * a.point
    be_done = False
    cur_sl = sl
    ambiguous = 0
    swap_n = 0.0
    mfe = mae = 0.0
    be_time = None
    sl_changes: list[tuple[int, float]] = []
    mtm = []
    reason = "end_of_data"
    exit_px = None
    i = i0
    while i < n:
        if i > i0:
            bo, bh, bl, bc, ao, ah, al, ac = a.bid_ask(i)
            swap_n += a.rollover[i]
        if side > 0:
            fav, adv = bh - entry, entry - bl
            gap_sl = i > i0 and bo <= cur_sl
            hit_sl = bl <= cur_sl
            hit_tp = bh >= tp
        else:
            fav, adv = entry - al, ah - entry
            gap_sl = i > i0 and ao >= cur_sl
            hit_sl = ah >= cur_sl
            hit_tp = al <= tp
        mfe = max(mfe, fav / risk)
        mae = max(mae, adv / risk)
        sl_reason = "sl" if cur_sl == sl else ("breakeven" if be_done and cur_sl == be_level else "trail")
        if gap_sl:
            exit_px = (bo - sslip) if side > 0 else (ao + sslip)
            reason = sl_reason + "_gap"
        elif hit_sl:
            if hit_tp:
                ambiguous += 1
            exit_px = (cur_sl - sslip) if side > 0 else (cur_sl + sslip)
            reason = sl_reason
        elif hit_tp:
            exit_px = tp
            reason = "tp"
        elif a.t[i] - a.t[i0] >= max_ns:
            exit_px = (bc - sslip) if side > 0 else (ac + sslip)
            reason = "time"
        if exit_px is not None:
            mtm.append((exit_px - entry) * side)
            break
        mtm.append(((bc if side > 0 else ac) - entry) * side)
        # stop management at bar close (effective from next bar)
        close_px = bc if side > 0 else ac
        if exits.breakeven_enabled and not be_done and mfe >= exits.breakeven_trigger_r:
            if (be_level - cur_sl) * side > 0 and (close_px - be_level) * side > stop_level:
                cur_sl = be_level
                be_done = True
                be_time = int(a.t[i])
                sl_changes.append((int(a.t[i]), cur_sl))
        if exits.trailing_enabled and mfe >= exits.trailing_start_r:
            cand = close_px - side * exits.trailing_atr_mult * atr_at_entry
            if (cand - cur_sl) * side > 0 and (close_px - cand) * side > stop_level:
                cur_sl = cand
                sl_changes.append((int(a.t[i]), cur_sl))
        i += 1
    if exit_px is None:
        i = n - 1
        exit_px = (a.bid_ask(i)[3] if side > 0 else a.bid_ask(i)[7])
    return TradePath(a.symbol, side, i0, i, int(a.t[i0]), int(a.t[i]), entry, float(exit_px), sl, tp, risk, reason,
                     ambiguous, swap_n, mfe, mae, be_time, float(a.spread[i0]), float(a.spread[i]),
                     np.asarray(mtm, dtype=float), sl_changes)
