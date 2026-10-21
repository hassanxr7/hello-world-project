"""ACTUAL account performance from the broker's own records (closed trades and equity
snapshots). Nothing here is simulated or forecast.

Periods follow the configured trading day (``daily_reset``), so "today" matches the daily
loss limit. Commission and swap are reported separately, as the broker charges them;
spread and slippage are inside the fill prices and are shown as the measured adverse
slippage versus the decision-time price (``Storage.execution_quality``).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import pandas as pd

from ..timeutil import trading_day_id


def closed_trades(rows: list[dict[str, Any]]) -> pd.DataFrame:
    cols = ["ticket", "symbol", "side", "volume", "open_time", "close_time", "profit", "swap", "commission",
            "net_profit", "r_multiple", "planned_risk"]
    df = pd.DataFrame([r for r in rows if r.get("status") == "CLOSED" and r.get("close_time")], columns=cols)
    if df.empty:
        return df
    df["close_time"] = pd.to_datetime(df["close_time"], utc=True, format="ISO8601")
    for c in ("profit", "swap", "commission", "net_profit", "r_multiple"):
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0) if c != "r_multiple" else pd.to_numeric(df[c], errors="coerce")
    return df.sort_values("close_time")


def _day_ids(df: pd.DataFrame, zone: str, hour: int, offset_s: int | None) -> pd.Series:
    return df["close_time"].map(lambda t: trading_day_id(t.to_pydatetime(), zone, hour, offset_s))


def _summ(g: pd.DataFrame) -> dict[str, Any]:
    if g.empty:
        return {"trades": 0, "net": 0.0, "gross": 0.0, "commission": 0.0, "swap": 0.0, "wins": 0, "losses": 0,
                "win_rate_pct": None, "expectancy_r": None, "best": None, "worst": None}
    r = g["r_multiple"].dropna()
    return {"trades": int(len(g)), "net": round(float(g["net_profit"].sum()), 2),
            "gross": round(float(g["profit"].sum()), 2), "commission": round(float(g["commission"].sum()), 2),
            "swap": round(float(g["swap"].sum()), 2), "wins": int((g["net_profit"] > 0).sum()),
            "losses": int((g["net_profit"] < 0).sum()),
            "win_rate_pct": round(float((g["net_profit"] > 0).mean() * 100), 1),
            "expectancy_r": round(float(r.mean()), 3) if len(r) else None,
            "best": round(float(g["net_profit"].max()), 2), "worst": round(float(g["net_profit"].min()), 2)}


def period_summary(rows: list[dict[str, Any]], now: datetime, zone: str, hour: int,
                   offset_s: int | None = None) -> dict[str, Any]:
    """Realized results for the current trading day, its ISO week, its month and all time."""
    df = closed_trades(rows)
    today = trading_day_id(now, zone, hour, offset_s)
    d = pd.Timestamp(today)
    wk, mo = d.isocalendar()[:2], (d.year, d.month)
    out: dict[str, Any] = {"kind": "actual", "trading_day": today}
    if df.empty:
        for k in ("today", "week", "month", "all"):
            out[k] = _summ(df)
        out["daily"] = []
        return out
    ids = pd.to_datetime(_day_ids(df, zone, hour, offset_s))
    iso = ids.dt.isocalendar()
    out["today"] = _summ(df[ids == d])
    out["week"] = _summ(df[(iso["year"] == wk[0]).to_numpy() & (iso["week"] == wk[1]).to_numpy()])
    out["month"] = _summ(df[(ids.dt.year == mo[0]) & (ids.dt.month == mo[1])])
    out["all"] = _summ(df)
    daily = df.groupby(ids.dt.date)["net_profit"].sum().tail(40)
    out["daily"] = [{"day": str(k), "net": round(float(v), 2)} for k, v in daily.items()]
    return out


def daily_returns_pct(rows: list[dict[str, Any]], equity_rows: list[dict[str, Any]], zone: str, hour: int,
                      offset_s: int | None = None) -> pd.Series:
    """Net P&L per trading day as % of that day's starting equity, INCLUDING days without trades
    (business days between the first and last record). Used by the forecast evidence gate."""
    df = closed_trades(rows)
    if df.empty or not equity_rows:
        return pd.Series(dtype=float)
    eq = pd.DataFrame(equity_rows)
    eq["ts"] = pd.to_datetime(eq["ts"], utc=True, format="ISO8601")
    eq["day"] = eq["ts"].map(lambda t: trading_day_id(t.to_pydatetime(), zone, hour, offset_s))
    start_eq = eq.sort_values("ts").groupby("day")["equity"].first()
    pnl = df.groupby(_day_ids(df, zone, hour, offset_s))["net_profit"].sum()
    days = pd.bdate_range(min(start_eq.index.min(), pnl.index.min()), max(start_eq.index.max(), pnl.index.max()))
    keys = [d.date().isoformat() for d in days]
    se = start_eq.reindex(keys).ffill().bfill()
    out = (pnl.reindex(keys).fillna(0.0) / se * 100).dropna()
    out.index = pd.to_datetime(out.index)
    return out


def drawdown(equity_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Current and maximum drawdown from the recorded equity curve (peak-to-trough, % of peak)."""
    if not equity_rows:
        return {"kind": "actual", "current_pct": None, "max_pct": None, "peak": None, "note": "no equity history yet"}
    e = pd.Series([float(r["equity"]) for r in equity_rows])
    peak = e.cummax()
    dd = (peak - e) / peak * 100
    return {"kind": "actual", "current_pct": round(float(dd.iloc[-1]), 2), "max_pct": round(float(dd.max()), 2),
            "peak": round(float(peak.iloc[-1]), 2), "current": round(float(e.iloc[-1]), 2)}


def risk_allowance(day_start_equity: float, equity: float, net_flows: float, limit_pct: float,
                   open_risk: float) -> dict[str, Any]:
    """How much more can be lost today before the daily-loss halt, and what the open stops put at risk.
    Gaps and slippage can make a stop-out lose more than the planned risk."""
    if not day_start_equity:
        return {"kind": "actual", "note": "day-start equity not known yet"}
    limit = day_start_equity * limit_pct / 100
    used = max(0.0, day_start_equity + net_flows - equity)  # realized + floating loss since the day started
    remaining = limit - used
    return {"kind": "actual", "limit_money": round(limit, 2), "limit_pct": limit_pct, "used_money": round(used, 2),
            "used_pct": round(used / day_start_equity * 100, 3), "remaining_before_halt": round(remaining, 2),
            "open_risk_at_stops": round(open_risk, 2), "remaining_if_all_stops_hit": round(remaining - open_risk, 2),
            "note": "stops can fill worse than planned on gaps or fast markets, so a loss can exceed these figures"}


def next_trading_days(now: datetime) -> dict[str, int]:
    """Trading days in each forecast horizon, counted from the next weekday."""
    d = pd.Timestamp(now).normalize().tz_localize(None) + timedelta(days=1)
    week_end = pd.Timestamp(now).normalize().tz_localize(None) + timedelta(days=(4 - now.weekday()) % 7)
    month_end = (pd.Timestamp(now).tz_localize(None) + pd.offsets.MonthEnd(0)).normalize()
    return {"tomorrow": 1,
            "rest_of_week": max(len(pd.bdate_range(d, week_end)), 0) if now.weekday() < 4 else 0,
            "rest_of_month": len(pd.bdate_range(d, month_end))}
