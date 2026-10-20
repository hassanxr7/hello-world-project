"""Historical data loaders.

Supported sources
- Oanda M1 CSV files from the public FutureSharks/financial-data repository
  (columns time,close,high,low,open,volume; UTC; mid prices; no spread).
- MT4 exports produced by mql4/Scripts/FXAI_ExportHistory.mq4
  (time,open,high,low,close,volume,spread; broker server time; bid prices).
- Generic CSV with time,open,high,low,close[,volume][,spread] in UTC.

All loaders return a frame indexed by bar OPEN time (tz-aware UTC) with float
columns open/high/low/close and optional volume/spread, plus ``price_basis``
in ``df.attrs`` ("mid" or "bid").
"""

from __future__ import annotations

import hashlib
import pickle
from pathlib import Path

import pandas as pd

OANDA_NAMES = {"EURUSD": "EUR_USD", "GBPUSD": "GBP_USD", "USDCAD": "USD_CAD", "AUDUSD": "AUD_USD",
               "USDJPY": "USD_JPY", "USDCHF": "USD_CHF", "NZDUSD": "NZD_USD"}


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    df.index = pd.DatetimeIndex(df.index).as_unit("ns")
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df = df.dropna(subset=["open", "high", "low", "close"])
    df = df[(df[["open", "high", "low", "close"]] > 0).all(axis=1)]
    # Repair rare OHLC inconsistencies (high below open/close etc.).
    df["high"] = df[["high", "open", "close"]].max(axis=1)
    df["low"] = df[["low", "open", "close"]].min(axis=1)
    return df


def load_oanda_m1(root: str | Path, symbol: str, years: range | list[int],
                  cache_dir: str | Path | None = None) -> pd.DataFrame:
    root = Path(root)
    pair = OANDA_NAMES[symbol]
    files: list[Path] = []
    for y in years:
        d = root / pair / str(y)
        if d.is_dir():
            files.extend(sorted(d.glob(f"oanda-{pair}-{y}-*.csv")))
    if not files:
        raise FileNotFoundError(f"no Oanda files for {symbol} under {root}")
    key = hashlib.sha256("|".join(f"{f}:{f.stat().st_size}" for f in files).encode()).hexdigest()[:16]
    cache = Path(cache_dir) / f"{symbol}_{key}.pkl" if cache_dir else None
    if cache and cache.is_file():
        with cache.open("rb") as fh:
            return pickle.load(fh)
    parts = []
    for f in files:
        x = pd.read_csv(f, usecols=["time", "open", "high", "low", "close", "volume"])
        parts.append(x)
    df = pd.concat(parts, ignore_index=True)
    df["time"] = pd.to_datetime(df["time"], utc=True)
    df = df.set_index("time").astype({"open": float, "high": float, "low": float, "close": float, "volume": float})
    df.index.name = "open_time"
    df = _clean(df)
    df.attrs["price_basis"] = "mid"
    df.attrs["source"] = f"oanda M1 via FutureSharks/financial-data ({len(files)} files)"
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        with cache.open("wb") as fh:
            pickle.dump(df, fh)
    return df


def load_mt4_export(path: str | Path, server_utc_offset_hours: float) -> pd.DataFrame:
    """Load a CSV written by FXAI_ExportHistory.mq4. MT4 bars are BID prices in
    broker server time; ``spread`` is in points (0 if the broker does not store it)."""
    df = pd.read_csv(path)
    df["time"] = pd.to_datetime(df["time"], format="%Y.%m.%d %H:%M") - pd.Timedelta(hours=server_utc_offset_hours)
    df["time"] = df["time"].dt.tz_localize("UTC")
    df = df.set_index("time").astype(float)
    df.index.name = "open_time"
    df = _clean(df)
    df.attrs["price_basis"] = "bid"
    df.attrs["source"] = f"MT4 export {Path(path).name}"
    return df


def load_generic_csv(path: str | Path, price_basis: str = "mid") -> pd.DataFrame:
    df = pd.read_csv(path)
    df["time"] = pd.to_datetime(df["time"], utc=True)
    df = df.set_index("time").astype(float)
    df.index.name = "open_time"
    df = _clean(df)
    df.attrs["price_basis"] = price_basis
    df.attrs["source"] = f"CSV {Path(path).name}"
    return df
