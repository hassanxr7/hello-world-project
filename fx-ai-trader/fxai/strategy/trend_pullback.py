"""Baseline strategy v1: trend-timeframe regime + entry-timeframe pullback-resumption.

Timeframes are configurable: H1 entries / H4 trend (default) or M15 / H1.
Below, "H1" means the trend timeframe and "M15" the entry timeframe.

Deliberately small and explainable. Parameters were fixed a priori from common
practice (EMA 50/200, ADX 20, ATR 14, RSI 14, 2R target) and were NOT tuned on
the evaluation data. Validation showed NO edge (docs/VALIDATION.md); the audit
in docs/STRATEGY_AUDIT.md explains why.

Rules (all evaluated on COMPLETED bars):

Regime (trend TF)   see fxai/analysis/regime.py
Entry (entry TF), long side (short is the mirror image)
  pullback   some bar in the last `pullback_lookback` bars had low <= EMA20 + tol*ATR
  resumption close > EMA20, bullish candle, close > previous high
  momentum   rsi_long_min <= RSI14 <= rsi_long_max
  extension  (close - EMA20) / ATR <= max_extension_atr
  stop       below the pullback low - buffer*ATR, widened to >= min_stop_atr*ATR,
             WAIT if wider than max_stop_atr*ATR
  room       nearest confirmed trend-TF swing resistance >= min_room_r * stop distance away
  session    close time inside the symbol's UTC window; no Friday entries after cutoff
Target: take_profit_r * stop distance from the actual entry price.
"""

from __future__ import annotations

from typing import ClassVar

import numpy as np
import pandas as pd

from ..analysis.indicators import atr, ema, rolling_median, rsi
from ..analysis.regime import RegimeParams
from ..analysis.structure import find_swings, nearest_levels
from ..config import ExitConfig
from ..domain import Regime
from .base import Setup, StrategyBase, StrategyParamsBase, mark, session_mask

NAME = "trend_pullback"
VERSION = "1.0.0"

FEATURES = [
    "adx_trend", "trend_strength", "slope_trend", "vol_ratio", "rsi_side", "ext_atr", "stop_atr", "room_r",
    "body_ratio", "hour_sin", "hour_cos", "ret_24h_atr", "atr_entry_ratio", "pullback_depth",
]


class TrendPullbackParams(StrategyParamsBase):
    atr_period: int = 14
    adx_period: int = 14
    adx_min: float = 20.0
    ema_fast: int = 50  # trend timeframe
    ema_slow: int = 200  # trend timeframe
    ema_slope_bars: int = 5
    vol_ratio_max: float = 2.0
    vol_median_window: int = 500
    ema_entry: int = 20
    pullback_lookback: int = 6
    pullback_atr_tol: float = 0.25
    rsi_period: int = 14
    rsi_long_min: float = 50.0
    rsi_long_max: float = 70.0
    max_extension_atr: float = 1.0
    stop_buffer_atr: float = 0.2
    min_stop_atr: float = 1.0
    max_stop_atr: float = 2.5
    min_room_r: float = 1.0
    swing_lookback_bars: int = 200  # trend-timeframe bars
    fractal_n: int = 3
    friday_cutoff_utc: str = "18:00"


class TrendPullbackStrategy(StrategyBase):
    name: ClassVar[str] = NAME
    version: ClassVar[str] = VERSION
    default_entry_tf: ClassVar[str] = "H1"
    default_trend_tf: ClassVar[str] = "H4"
    default_exits: ClassVar[ExitConfig] = ExitConfig(take_profit_r=2.0, breakeven_enabled=True, breakeven_trigger_r=1.0,
                                                     breakeven_offset_points=10, trailing_enabled=False, max_hold_hours=48)
    Params = TrendPullbackParams
    features: ClassVar[list[str]] = FEATURES
    setup_ttl_bars: ClassVar[int] = 6

    @property
    def regime_params(self) -> RegimeParams:  # type: ignore[override]
        p = self.p
        return RegimeParams(p.atr_period, p.adx_period, p.adx_min, p.ema_fast, p.ema_slow, p.ema_slope_bars,
                            p.vol_ratio_max, p.vol_median_window)

    @property
    def trend_warmup_bars(self) -> int:
        return self.p.ema_slow + 20

    # ------------------------------------------------------------------------------
    def compute(self, m15: pd.DataFrame, h1: pd.DataFrame, session_window: str = "00:00-24:00") -> pd.DataFrame:
        """Vectorised evaluation for every completed entry-timeframe bar (used by backtest and live).

        ``m15`` holds the ENTRY timeframe bars and ``h1`` the TREND timeframe bars.
        Column prefixes: ``tr_`` = trend timeframe, ``atr_e`` = entry-timeframe ATR.
        """
        p = self.p
        entry_min = int(round((m15["close_time"] - m15.index).median().total_seconds() / 60)) if len(m15) else 15
        trend_min = int(round((h1["close_time"] - h1.index).median().total_seconds() / 60)) if len(h1) else 60
        f = pd.DataFrame(index=m15.index)
        for c in ("open", "high", "low", "close", "close_time"):
            f[c] = m15[c]
        f["atr_e"] = atr(m15, p.atr_period)
        f["ema20"] = ema(m15["close"], p.ema_entry)
        f["rsi"] = rsi(m15["close"], p.rsi_period)
        f = self.attach_trend(f, h1)

        a = f["atr_e"]
        L = p.pullback_lookback
        touch_l = f["low"] <= f["ema20"] + p.pullback_atr_tol * a
        touch_s = f["high"] >= f["ema20"] - p.pullback_atr_tol * a
        f["r_pullback_l"] = touch_l.astype(float).rolling(L, min_periods=1).max() > 0
        f["r_pullback_s"] = touch_s.astype(float).rolling(L, min_periods=1).max() > 0
        f["r_resume_l"] = (f["close"] > f["ema20"]) & (f["close"] > f["open"]) & (f["close"] > f["high"].shift(1))
        f["r_resume_s"] = (f["close"] < f["ema20"]) & (f["close"] < f["open"]) & (f["close"] < f["low"].shift(1))
        f["r_rsi_l"] = (f["rsi"] >= p.rsi_long_min) & (f["rsi"] <= p.rsi_long_max)
        f["r_rsi_s"] = (f["rsi"] <= 100 - p.rsi_long_min) & (f["rsi"] >= 100 - p.rsi_long_max)
        f["ext_l"] = (f["close"] - f["ema20"]) / a
        f["ext_s"] = (f["ema20"] - f["close"]) / a
        f["r_ext_l"] = f["ext_l"] <= p.max_extension_atr
        f["r_ext_s"] = f["ext_s"] <= p.max_extension_atr

        low_l = f["low"].rolling(L, min_periods=1).min()
        high_l = f["high"].rolling(L, min_periods=1).max()
        sl_l = low_l - p.stop_buffer_atr * a
        sl_s = high_l + p.stop_buffer_atr * a
        sl_l = np.minimum(sl_l, f["close"] - p.min_stop_atr * a)
        sl_s = np.maximum(sl_s, f["close"] + p.min_stop_atr * a)
        f["sl_l"], f["sl_s"] = sl_l, sl_s
        f["stop_atr_l"] = (f["close"] - sl_l) / a
        f["stop_atr_s"] = (sl_s - f["close"]) / a
        f["r_stop_l"] = f["stop_atr_l"] <= p.max_stop_atr
        f["r_stop_s"] = f["stop_atr_s"] <= p.max_stop_atr
        f["r_session"] = session_mask(f["close_time"], session_window, p.friday_cutoff_utc).to_numpy()

        f["r_regime_l"] = f["tr_regime"] == Regime.TREND_UP.value
        f["r_regime_s"] = f["tr_regime"] == Regime.TREND_DOWN.value
        warm = f[["atr_e", "ema20", "rsi"]].notna().all(axis=1)
        base_l = warm & f["r_regime_l"] & f["r_pullback_l"] & f["r_resume_l"] & f["r_rsi_l"] & f["r_ext_l"] & f["r_stop_l"] & f["r_session"]
        base_s = warm & f["r_regime_s"] & f["r_pullback_s"] & f["r_resume_s"] & f["r_rsi_s"] & f["r_ext_s"] & f["r_stop_s"] & f["r_session"]

        # Room to structure - computed only where everything else passed.
        f["room_r"] = np.nan
        f["r_room"] = False
        cand = f.index[base_l | base_s]
        if len(cand):
            swings = find_swings(h1, p.fractal_n)
            lookback = pd.Timedelta(minutes=p.swing_lookback_bars * trend_min)
            for t in cand:
                row = f.loc[t]
                is_long = bool(base_l.loc[t])
                close = float(row["close"])
                dist = close - float(row["sl_l"]) if is_long else float(row["sl_s"]) - close
                res, sup = nearest_levels(swings, row["close_time"], close, lookback)
                lvl = res if is_long else sup
                room = (abs(lvl - close) / dist) if (lvl is not None and dist > 0) else np.inf
                f.at[t, "room_r"] = room
                f.at[t, "r_room"] = room >= p.min_room_r

        long_sig = base_l & f["r_room"]
        short_sig = base_s & f["r_room"]
        f["signal"] = np.where(long_sig, 1, np.where(short_sig, -1, 0))
        f["sl"] = np.where(long_sig, f["sl_l"], np.where(short_sig, f["sl_s"], np.nan))
        # Watchlist candidate: regime + pullback seen, waiting for the resumption bar.
        watch_l = warm & f["r_regime_l"] & f["r_pullback_l"] & f["r_session"] & ~long_sig
        watch_s = warm & f["r_regime_s"] & f["r_pullback_s"] & f["r_session"] & ~short_sig
        f["candidate_side"] = np.where(watch_l, 1, np.where(watch_s, -1, 0))
        f["invalidation"] = np.where(watch_l, f["sl_l"], np.where(watch_s, f["sl_s"], np.nan))
        self._features(f, entry_min)
        return f

    def _features(self, f: pd.DataFrame, entry_min: int) -> None:
        side = np.where(f["candidate_side"] != 0, f["candidate_side"], np.where(f["tr_regime"] == Regime.TREND_DOWN.value, -1, 1))
        side = np.where(f["signal"] != 0, f["signal"], side)
        a = f["atr_e"]
        f["adx_trend"] = f["tr_adx"]
        f["trend_strength"] = side * (f["tr_ema_f"] - f["tr_ema_s"]) / f["tr_atr"]
        f["slope_trend"] = side * f["tr_slope"]
        f["rsi_side"] = np.where(side > 0, f["rsi"], 100 - f["rsi"])
        f["ext_atr"] = np.where(side > 0, f["ext_l"], f["ext_s"])
        f["stop_atr"] = np.where(side > 0, f["stop_atr_l"], f["stop_atr_s"])
        rng = (f["high"] - f["low"]).replace(0, np.nan)
        f["body_ratio"] = ((f["close"] - f["open"]).abs() / rng).fillna(0.0)
        ct = pd.DatetimeIndex(f["close_time"])
        hr = ct.hour + ct.minute / 60.0
        f["hour_sin"] = np.sin(2 * np.pi * hr / 24.0)
        f["hour_cos"] = np.cos(2 * np.pi * hr / 24.0)
        f["ret_24h_atr"] = side * (f["close"] - f["close"].shift(max(1, 1440 // entry_min))) / a
        f["atr_entry_ratio"] = a / rolling_median(a, 480)
        low_l = f["low"].rolling(self.p.pullback_lookback, min_periods=1).min()
        high_l = f["high"].rolling(self.p.pullback_lookback, min_periods=1).max()
        f["pullback_depth"] = np.where(side > 0, (f["ema20"] - low_l) / a, (high_l - f["ema20"]) / a)
        f["room_r"] = f["room_r"].clip(upper=5.0)
        f["vol_ratio"] = f["tr_vol_ratio"]

    # ------------------------------------------------------------------------------
    def explain(self, row: pd.Series) -> list[str]:
        p = self.p
        reg = row["tr_regime"]
        out = [f"trend-TF regime {reg} (ADX {row['tr_adx']:.1f}, EMA{p.ema_fast} "
               f"{'>' if row['tr_ema_f'] > row['tr_ema_s'] else '<'} EMA{p.ema_slow}, "
               f"slope {row['tr_slope']:+.2f} ATR, vol ratio {row['tr_vol_ratio']:.2f})"]
        if reg not in (Regime.TREND_UP.value, Regime.TREND_DOWN.value):
            out.append("WAIT: no qualifying trend regime")
            return out
        s = "l" if reg == Regime.TREND_UP.value else "s"
        word = "long" if s == "l" else "short"
        out.append(f"session window: {mark(bool(row['r_session']))}")
        out.append(f"pullback to EMA{p.ema_entry} zone within {p.pullback_lookback} bars: {mark(bool(row[f'r_pullback_{s}']))}")
        out.append(f"{word} resumption candle (close beyond EMA and prior bar extreme): {mark(bool(row[f'r_resume_{s}']))}")
        out.append(f"RSI {row['rsi']:.1f} in {word} band: {mark(bool(row[f'r_rsi_{s}']))}")
        out.append(f"extension {row[f'ext_{s}']:.2f} ATR <= {p.max_extension_atr}: {mark(bool(row[f'r_ext_{s}']))}")
        out.append(f"stop {row[f'stop_atr_{s}']:.2f} ATR <= {p.max_stop_atr}: {mark(bool(row[f'r_stop_{s}']))}")
        if pd.notna(row.get("room_r")):
            out.append(f"room to trend-TF structure {row['room_r']:.2f}R >= {p.min_room_r}R: {mark(bool(row['r_room']))}")
        if row["signal"] == 0:
            out.append("WAIT: at least one entry condition failed")
        else:
            out.append(f"{'BUY' if row['signal'] > 0 else 'SELL'}: all conditions met; "
                       f"stop {row['sl']:.5f}, target {self.exits.take_profit_r}R")
        return out

    def invalidation_notes(self, row: pd.Series) -> list[str]:
        s = "l" if row["signal"] > 0 else "s"
        return [f"price beyond the stop {row['sl']:.5f} (pullback extreme ± buffer)",
                "trend-TF regime no longer TREND_" + ("UP" if s == "l" else "DOWN"),
                f"signal older than the entry bar + TTL (bar closed {pd.Timestamp(row['close_time']):%H:%M} UTC)"]

    def setups(self, f: pd.DataFrame, symbol: str) -> list[Setup]:
        if f.empty:
            return []
        row = f.iloc[-1]
        side = int(row["candidate_side"])
        if side == 0:
            return []
        s = "l" if side > 0 else "s"
        conds = {"regime": bool(row[f"r_regime_{s}"]), "pullback": bool(row[f"r_pullback_{s}"]),
                 "resumption candle": bool(row[f"r_resume_{s}"]), "rsi": bool(row[f"r_rsi_{s}"]),
                 "not extended": bool(row[f"r_ext_{s}"]), "stop size": bool(row[f"r_stop_{s}"]),
                 "session": bool(row["r_session"])}
        stage = sum(conds.values()) / len(conds)
        bar_min = int((pd.Timestamp(row["close_time"]) - pd.Timestamp(f.index[-1])).total_seconds() // 60)
        created = pd.Timestamp(row["close_time"])
        trigger = float(row["high"]) if side > 0 else float(row["low"])  # resumption needs a close beyond the prior extreme
        return [Setup(symbol, self.full_version, side, stage, created, created + pd.Timedelta(minutes=bar_min * self.setup_ttl_bars),
                      trigger, float(row["invalidation"]), conds, self.explain(row))]
