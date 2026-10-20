"""Performance statistics. Everything reported is computed from simulated trades;
nothing here predicts future performance."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd


def _streak(signs: np.ndarray, target: int) -> int:
    best = cur = 0
    for s in signs:
        cur = cur + 1 if s == target else 0
        best = max(best, cur)
    return best


def compute_stats(trades: pd.DataFrame, equity_hourly: pd.Series, initial: float, t0: pd.Timestamp,
                  t1: pd.Timestamp, max_dd: float, max_dd_pct: float, daily: pd.DataFrame | None = None) -> dict:
    years = max((t1 - t0).total_seconds() / (365.25 * 86400), 1e-9)
    n = len(trades)
    out: dict = {"period_start": str(t0), "period_end": str(t1), "years": round(years, 2), "trades": n,
                 "initial_balance": initial}
    if n == 0:
        out.update({"net_profit": 0.0, "return_pct": 0.0, "max_drawdown_pct": 0.0})
        return out
    net = trades["net"]
    wins, losses = net[net > 0], net[net <= 0]
    final = initial + float(net.sum())
    gp, gl = float(wins.sum()), float(-losses.sum())
    out.update({
        "net_profit": round(float(net.sum()), 2),
        "final_balance": round(final, 2),
        "return_pct": round((final / initial - 1) * 100, 2),
        "cagr_pct": round(((final / initial) ** (1 / years) - 1) * 100, 2) if final > 0 else -100.0,
        "max_drawdown": round(max_dd, 2),
        "max_drawdown_pct": round(max_dd_pct * 100, 2),
        "profit_factor": round(gp / gl, 3) if gl > 0 else math.inf,
        "win_rate_pct": round(len(wins) / n * 100, 2),
        "expectancy_per_trade": round(float(net.mean()), 2),
        "expectancy_r": round(float(trades["r_multiple"].mean()), 3),
        "avg_win_r": round(float(trades.loc[net > 0, "r_multiple"].mean()), 3) if len(wins) else 0.0,
        "avg_loss_r": round(float(trades.loc[net <= 0, "r_multiple"].mean()), 3) if len(losses) else 0.0,
        "trades_per_year": round(n / years, 1),
        "avg_hold_hours": round(float(trades["hold_hours"].mean()), 2),
        "max_consecutive_losses": _streak(np.where(net.to_numpy() > 0, 1, -1), -1),
        "max_consecutive_wins": _streak(np.where(net.to_numpy() > 0, 1, -1), 1),
        "costs": {
            "spread": round(float(trades["spread_cost"].sum()), 2),
            "commission": round(float(-trades["commission"].sum()), 2),
            "swap": round(float(-trades["swap"].sum()), 2),
            "slippage": round(float(trades["slippage_cost"].sum()), 2),
        },
        "exit_reasons": trades["reason"].value_counts().to_dict(),
        "ambiguous_bars_total": int(trades["ambiguous_bars"].sum()),
        "trades_with_ambiguous_bar": int((trades["ambiguous_bars"] > 0).sum()),
    })
    gross_cost = sum(out["costs"].values())
    out["costs"]["total"] = round(gross_cost, 2)
    out["costs"]["pct_of_gross_profit"] = round(gross_cost / gp * 100, 1) if gp > 0 else None
    # exposure: fraction of time with >= 1 open position
    iv = sorted(zip(trades["entry_time"], trades["exit_time"]))
    covered = 0.0
    cur_s, cur_e = None, None
    for s, e in iv:
        if cur_e is None or s > cur_e:
            if cur_e is not None:
                covered += (cur_e - cur_s).total_seconds()
            cur_s, cur_e = s, e
        else:
            cur_e = max(cur_e, e)
    if cur_e is not None:
        covered += (cur_e - cur_s).total_seconds()
    out["exposure_pct"] = round(covered / (t1 - t0).total_seconds() * 100, 2)
    # monthly & yearly (closed-trade P&L by exit month)
    by_m = trades.set_index("exit_time")["net"].resample("ME").sum()
    out["months"] = int(len(by_m))
    out["losing_months"] = int((by_m < 0).sum())
    out["worst_month"] = round(float(by_m.min()), 2)
    out["best_month"] = round(float(by_m.max()), 2)
    yearly = trades.set_index("exit_time")["net"].resample("YE").sum()
    out["yearly_net"] = {str(k.year): round(float(v), 2) for k, v in yearly.items()}
    out["by_symbol"] = {s: {"trades": int(len(g)), "net": round(float(g["net"].sum()), 2),
                            "expectancy_r": round(float(g["r_multiple"].mean()), 3),
                            "win_rate_pct": round(float((g["net"] > 0).mean() * 100), 1)}
                        for s, g in trades.groupby("symbol")}
    # daily Sharpe-like ratio from hourly equity (informational)
    d = equity_hourly.resample("1D").last().dropna()
    r = d.pct_change().dropna()
    r = r[r != 0]
    out["daily_return_sharpe_annualised"] = round(float(r.mean() / r.std() * math.sqrt(252)), 3) if len(r) > 20 and r.std() > 0 else None
    if daily is not None and len(daily):
        out["max_entries_in_a_day"] = int(daily["entries"].max())
    return out


def monthly_table(trades: pd.DataFrame) -> pd.DataFrame:
    if trades.empty:
        return pd.DataFrame()
    m = trades.set_index("exit_time")["net"].resample("ME").sum()
    df = pd.DataFrame({"year": m.index.year, "month": m.index.month, "net": m.values})
    return df.pivot(index="year", columns="month", values="net").round(0)
