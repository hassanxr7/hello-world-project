"""Technical indicators (vectorised, causal: value at bar i uses bars <= i only).

Wilder smoothing is used for ATR/ADX/RSI to match MetaTrader's built-ins.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def wilder(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev_close).abs(),
        (df["low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    tr.iloc[0] = df["high"].iloc[0] - df["low"].iloc[0]
    return tr


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    return wilder(true_range(df), n)


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = wilder(d.clip(lower=0.0), n)
    dn = wilder((-d).clip(lower=0.0), n)
    rs = up / dn.replace(0.0, np.nan)
    out = 100.0 - 100.0 / (1.0 + rs)
    out = out.where(dn != 0.0, 100.0)
    return out.where(up.notna())


def adx(df: pd.DataFrame, n: int = 14) -> pd.DataFrame:
    """Returns columns plus_di, minus_di, adx."""
    up = df["high"].diff()
    dn = -df["low"].diff()
    plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
    tr = wilder(true_range(df), n)
    pdi = 100.0 * wilder(pd.Series(plus_dm, index=df.index), n) / tr
    mdi = 100.0 * wilder(pd.Series(minus_dm, index=df.index), n) / tr
    denom = (pdi + mdi).replace(0.0, np.nan)
    dx = 100.0 * (pdi - mdi).abs() / denom
    return pd.DataFrame({"plus_di": pdi, "minus_di": mdi, "adx": wilder(dx.fillna(0.0), n)}, index=df.index)


def rolling_median(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=max(20, n // 5)).median()
