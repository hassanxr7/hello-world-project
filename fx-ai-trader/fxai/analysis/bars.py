"""Bar utilities: resampling, completeness and causal multi-timeframe alignment.

Bars are indexed by their OPEN time (UTC) and carry a ``close_time`` column.
A bar is usable only once ``close_time <= now``. Higher-timeframe values are
joined onto lower-timeframe rows by *close time* (merge_asof backward), so an
M15 row closing at 10:15 only sees the H1 bar that closed at or before 10:15.
"""

from __future__ import annotations

from datetime import datetime

import pandas as pd

TF_MINUTES = {"M1": 1, "M5": 5, "M15": 15, "M30": 30, "H1": 60, "H4": 240, "D1": 1440}


def resample(m1: pd.DataFrame, tf: str) -> pd.DataFrame:
    minutes = TF_MINUTES[tf]
    if minutes == 1:
        out = m1.copy()
    else:
        agg = {"open": "first", "high": "max", "low": "min", "close": "last"}
        if "volume" in m1:
            agg["volume"] = "sum"
        if "spread" in m1:
            agg["spread"] = "mean"
        out = m1.resample(f"{minutes}min", label="left", closed="left").agg(agg).dropna(subset=["open"])
    out["close_time"] = out.index + pd.Timedelta(minutes=minutes)
    return out


def complete_only(df: pd.DataFrame, now: datetime) -> pd.DataFrame:
    return df[df["close_time"] <= pd.Timestamp(now)]


def align_higher(lower: pd.DataFrame, higher: pd.DataFrame, cols: list[str], prefix: str) -> pd.DataFrame:
    """Attach the latest *completed* higher-TF values to each lower-TF row."""
    left = lower.reset_index().rename(columns={lower.index.name or "index": "open_time"})
    right = higher[cols + ["close_time"]].reset_index(drop=True).rename(
        columns={c: f"{prefix}{c}" for c in cols} | {"close_time": f"{prefix}close_time"})
    left = left.sort_values("close_time")
    right = right.sort_values(f"{prefix}close_time")
    merged = pd.merge_asof(left, right, left_on="close_time", right_on=f"{prefix}close_time", direction="backward")
    return merged.set_index("open_time")


def validate_bars(df: pd.DataFrame) -> list[str]:
    """Basic integrity checks for bars received from the broker."""
    problems = []
    if df.empty:
        return ["no bars"]
    if not df.index.is_monotonic_increasing:
        problems.append("bars not in time order")
    if df.index.has_duplicates:
        problems.append("duplicate bar times")
    bad = (df["high"] < df[["open", "close"]].max(axis=1)) | (df["low"] > df[["open", "close"]].min(axis=1))
    if bad.any():
        problems.append(f"{int(bad.sum())} bars with inconsistent OHLC")
    if (df[["open", "high", "low", "close"]] <= 0).any().any():
        problems.append("non-positive prices")
    return problems
