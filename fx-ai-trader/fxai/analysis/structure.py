"""Market structure: confirmed swing highs/lows and nearby support/resistance.

A fractal swing high at bar i (high[i] is the max of bars i-n..i+n) can only
be known after bar i+n has closed. ``confirmed_at`` records that bar, and all
queries use only swings confirmed at or before the query time (no look-ahead).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Swing:
    price: float
    kind: str  # "high" | "low"
    bar_time: pd.Timestamp
    confirmed_at: pd.Timestamp  # close time of bar i+n


def find_swings(df: pd.DataFrame, n: int = 3) -> pd.DataFrame:
    """Return a frame of swings with columns price, kind, confirmed_at (sorted by confirmation)."""
    h = df["high"].to_numpy()
    lo = df["low"].to_numpy()
    close_t = df["close_time"].to_numpy()
    idx = df.index
    rows = []
    for i in range(n, len(df) - n):
        win_h = h[i - n:i + n + 1]
        win_l = lo[i - n:i + n + 1]
        if h[i] == win_h.max() and np.argmax(win_h) == n:
            rows.append((h[i], "high", idx[i], close_t[i + n]))
        if lo[i] == win_l.min() and np.argmin(win_l) == n:
            rows.append((lo[i], "low", idx[i], close_t[i + n]))
    out = pd.DataFrame(rows, columns=["price", "kind", "bar_time", "confirmed_at"])
    return out.sort_values("confirmed_at").reset_index(drop=True)


def nearest_levels(swings: pd.DataFrame, at: pd.Timestamp, price: float,
                   lookback: pd.Timedelta) -> tuple[float | None, float | None]:
    """Nearest confirmed swing-high resistance above and swing-low support below
    ``price`` using swings confirmed in (at - lookback, at]."""
    if swings.empty:
        return None, None
    known = swings[(swings["confirmed_at"] <= at) & (swings["bar_time"] > at - lookback)]
    above = known[(known["kind"] == "high") & (known["price"] > price)]["price"]
    below = known[(known["kind"] == "low") & (known["price"] < price)]["price"]
    return (float(above.min()) if len(above) else None, float(below.max()) if len(below) else None)
