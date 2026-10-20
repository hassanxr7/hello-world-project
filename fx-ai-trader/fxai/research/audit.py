"""Diagnostic audit of a strategy's signals and trades: WHY does it lose?

Analyses
1. Signal-conditional forward returns (side-signed, in ATR units) at 1/2/4/8/24
   entry-timeframe bars after the signal, versus all bars in the same regime.
2. Random-entry permutation test with identical exits (do entries carry information?).
3. Exit-reason P&L decomposition and MFE/MAE "give-back" statistics.
4. Breakdown by hour, session, symbol, year, regime strength, stop size, room.
5. Exit-rule what-ifs on the same signals (break-even offset above cost, BE off,
   shorter time stop) - diagnostic only, not a selection.

Writes reports/research/audit_<ts>/AUDIT.md and audit.json.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ..backtest.costs import CostModel
from ..backtest.engine import PortfolioBacktest
from ..config import AppConfig, ExitConfig
from .permutation import random_entry_test, simulate_signals

HORIZONS = (1, 2, 4, 8, 24)


def forward_returns(bt: PortfolioBacktest, sig: pd.DataFrame) -> pd.DataFrame:
    """Mean side-signed forward move in ATR units after signals vs. all same-regime bars."""
    rows = []
    for sym, g in sig.groupby("symbol"):
        f = bt._frames[sym]
        close = f["close"].to_numpy()
        atr = f["atr_e"].to_numpy()
        ct = pd.DatetimeIndex(f["close_time"])
        pos = ct.get_indexer(pd.DatetimeIndex(g["time"]))
        ok = pos >= 0
        pos, side = pos[ok], g["side"].to_numpy()[ok]
        reg = f["tr_regime"].astype(str).to_numpy()
        for h in HORIZONS:
            valid = pos + h < len(close)
            fr = side[valid] * (close[pos[valid] + h] - close[pos[valid]]) / atr[pos[valid]]
            # baseline: every bar in the same regime, signed by the regime direction
            base_sign = np.where(reg == "TREND_UP", 1, np.where(reg == "TREND_DOWN", -1, 0))
            idx = np.flatnonzero((base_sign != 0) & np.isfinite(atr))
            idx = idx[idx + h < len(close)]
            br = base_sign[idx] * (close[idx + h] - close[idx]) / atr[idx]
            rows.append({"symbol": sym, "horizon_bars": h, "n": int(valid.sum()), "signal_mean_atr": float(np.nanmean(fr)),
                         "signal_t": float(np.nanmean(fr) / (np.nanstd(fr) / np.sqrt(max(1, valid.sum())))) if valid.sum() > 2 else np.nan,
                         "regime_bars_mean_atr": float(np.nanmean(br)), "hit_rate": float(np.nanmean(fr > 0))})
    return pd.DataFrame(rows)


def exit_decomposition(trades: pd.DataFrame) -> pd.DataFrame:
    if trades.empty:
        return pd.DataFrame()
    g = trades.groupby("reason")
    out = pd.DataFrame({"trades": g.size(), "net": g["net"].sum().round(2), "mean_r": g["r_multiple"].mean().round(3),
                        "share_of_trades_pct": (g.size() / len(trades) * 100).round(1)})
    return out.sort_values("net")


def give_back(trades: pd.DataFrame) -> dict:
    if trades.empty:
        return {}
    reached1 = trades["mfe_r"] >= 1.0
    reached2 = trades["mfe_r"] >= 2.0
    return {
        "pct_reaching_1R": round(float(reached1.mean() * 100), 1),
        "pct_reaching_2R": round(float(reached2.mean() * 100), 1),
        "pct_of_1R_reachers_ending_le_0": round(float((trades.loc[reached1, "net"] <= 0).mean() * 100), 1) if reached1.any() else None,
        "mean_mae_winners": round(float(trades.loc[trades["net"] > 0, "mae_r"].mean()), 3) if (trades["net"] > 0).any() else None,
        "mean_mae_losers": round(float(trades.loc[trades["net"] <= 0, "mae_r"].mean()), 3) if (trades["net"] <= 0).any() else None,
        "mean_mfe_losers": round(float(trades.loc[trades["net"] <= 0, "mfe_r"].mean()), 3) if (trades["net"] <= 0).any() else None,
    }


def breakdown(trades: pd.DataFrame, sig: pd.DataFrame) -> dict[str, pd.DataFrame]:
    if trades.empty:
        return {}
    t = trades.merge(sig[["key", "adx_trend", "stop_atr", "room_r", "ext_atr", "rsi_side", "trend_strength"]], on="key", how="left")
    t["hour"] = pd.DatetimeIndex(t["entry_time"]).hour
    t["year"] = pd.DatetimeIndex(t["entry_time"]).year
    t["session"] = pd.cut(t["hour"], [-1, 6, 11, 16, 23], labels=["asia 0-6", "london 7-11", "overlap 12-16", "ny late 17-23"])
    t["adx_bucket"] = pd.cut(t["adx_trend"], [0, 25, 30, 40, 100], labels=["20-25", "25-30", "30-40", "40+"])
    t["stop_bucket"] = pd.cut(t["stop_atr"], [0, 1.25, 1.75, 2.5], labels=["1.0-1.25 ATR", "1.25-1.75", "1.75-2.5"])
    t["room_bucket"] = pd.cut(t["room_r"].fillna(5), [0, 1.5, 2.5, 5.01], labels=["1-1.5R", "1.5-2.5R", "2.5R+"])
    out = {}
    for col in ("session", "symbol", "year", "adx_bucket", "stop_bucket", "room_bucket", "side", "regime"):
        g = t.groupby(col, observed=True)
        out[col] = pd.DataFrame({"trades": g.size(), "net": g["net"].sum().round(2), "mean_r": g["r_multiple"].mean().round(3),
                                 "win_pct": (g["net"].apply(lambda s: (s > 0).mean()) * 100).round(1)})
    return out


def exit_whatifs(bt: PortfolioBacktest, sig: pd.DataFrame, costs: CostModel, base: ExitConfig) -> pd.DataFrame:
    variants = {
        "as configured": base,
        "BE offset 25 pts (> round-trip cost)": base.model_copy(update={"breakeven_offset_points": 25}),
        "BE off": base.model_copy(update={"breakeven_enabled": False}),
        "time stop 24h": base.model_copy(update={"max_hold_hours": 24}),
        "TP 1R": base.model_copy(update={"take_profit_r": 1.0}),
        "TP 3R, BE off": base.model_copy(update={"take_profit_r": 3.0, "breakeven_enabled": False}),
    }
    rows = []
    for name, ex in variants.items():
        s = simulate_signals(bt, sig, ex, costs)
        rows.append({"variant": name, "n": len(s), "mean_r_net": round(float(s["r_net"].mean()), 4),
                     "mean_r_gross": round(float(s["r_gross"].mean()), 4), "win_pct": round(float((s["r_net"] > 0).mean() * 100), 1),
                     "pf": round(float(s.loc[s["r_net"] > 0, "r_net"].sum() / -s.loc[s["r_net"] <= 0, "r_net"].sum()), 3)
                     if (s["r_net"] <= 0).any() else np.inf})
    return pd.DataFrame(rows)


def run_audit(cfg: AppConfig, m1: dict[str, pd.DataFrame], start: pd.Timestamp, end: pd.Timestamp, out_root: str | Path,
              n_perm: int = 100, label: str = "") -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    slug = re.sub(r"[^A-Za-z0-9]+", "_", label or "strategy").strip("_")[:40]
    out = Path(out_root) / f"audit_{slug}_{stamp}"
    out.mkdir(parents=True, exist_ok=True)
    costs = CostModel()
    bt = PortfolioBacktest(cfg, m1, costs)
    sig_all = bt.prepare()
    paths = bt.trade_paths(costs)
    sig = sig_all[(sig_all["time"] >= start) & (sig_all["time"] < end)].reset_index(drop=True)
    res = bt.run(paths=paths, start=start, end=end, label="audit")
    trades = res.trades
    fr = forward_returns(bt, sig)
    perm = random_entry_test(bt, sig, bt.exits, costs, n_perm=n_perm, seed=1)
    perm_noreg = random_entry_test(bt, sig, bt.exits, costs, n_perm=max(20, n_perm // 2), seed=2, match_regime=False)
    dec = exit_decomposition(trades)
    gb = give_back(trades)
    br = breakdown(trades, sig)
    wi = exit_whatifs(bt, sig, costs, bt.exits)
    per_signal = simulate_signals(bt, sig, bt.exits, costs)

    summary = {
        "label": label or bt.strategy.full_version, "period": [str(start), str(end)], "symbols": bt.symbols,
        "signals": int(len(sig)), "portfolio_trades": int(len(trades)), "portfolio_stats": res.stats,
        "per_signal_mean_r_net": round(float(per_signal["r_net"].mean()), 4) if len(per_signal) else None,
        "per_signal_mean_r_gross": round(float(per_signal["r_gross"].mean()), 4) if len(per_signal) else None,
        "forward_returns": fr.round(4).to_dict(orient="records"),
        "permutation_matched_regime": perm.summary(), "permutation_hour_only": perm_noreg.summary(),
        "exit_decomposition": dec.reset_index().to_dict(orient="records"), "give_back": gb,
        "breakdown": {k: v.reset_index().to_dict(orient="records") for k, v in br.items()},
        "exit_whatifs": wi.to_dict(orient="records"),
    }
    (out / "audit.json").write_text(json.dumps(summary, indent=2, default=str))
    per_signal.to_csv(out / "per_signal.csv", index=False)
    _write_md(out, summary, fr, dec, br, wi)
    return out


def _md_table(df: pd.DataFrame) -> str:
    if df is None or len(df) == 0:
        return "(none)"
    df = df.reset_index() if df.index.name else df
    cols = list(df.columns)
    lines = ["| " + " | ".join(str(c) for c in cols) + " |", "|" + "---|" * len(cols)]
    for _, r in df.iterrows():
        lines.append("| " + " | ".join(f"{v:.4g}" if isinstance(v, float) else str(v) for v in r.tolist()) + " |")
    return "\n".join(lines)


def _write_md(out: Path, s: dict, fr: pd.DataFrame, dec: pd.DataFrame, br: dict, wi: pd.DataFrame) -> None:
    p, q = s["permutation_matched_regime"], s["permutation_hour_only"]
    ps = s["portfolio_stats"]
    md = [f"# Strategy audit: {s['label']}", "",
          f"Period {s['period'][0][:10]} to {s['period'][1][:10]}, symbols {', '.join(s['symbols'])}. "
          f"{s['signals']} signals, {s['portfolio_trades']} portfolio trades (default risk limits).", "",
          "## 1. Do the entries carry information? (random-entry permutation test)", "",
          f"- Real signals: mean net R per signal **{p['real_mean_r']:+.3f}** (gross {s['per_signal_mean_r_gross']:+.3f}).",
          f"- Random entries, same symbol / hour / regime / side / stop size / exits: mean net R "
          f"{p['null_mean_r']:+.3f} ± {p['null_sd']:.3f} over {p['n_perm']} permutations.",
          f"- z = {p['z_score']:+.2f}, p-value (real ≥ random) = **{p['p_value']:.3f}**. "
          f"Hour-only matching (no regime): null {q['null_mean_r']:+.3f}, p = {q['p_value']:.3f}.", "",
          "Reading: a p-value near 0.5 means the entry rules select bars no better than random bars at the same time of day in "
          "the same regime; the loss then comes from costs plus the exit structure, which random entries share.", "",
          "## 2. Forward returns after signals (side-signed, ATR units)", "", _md_table(fr.round(4)), "",
          "`regime_bars_mean_atr` is the same statistic for *every* bar in the same trend regime (signed by trend "
          "direction): it shows how much of any drift is just the regime, not the entry.", "",
          "## 3. Where the money goes (portfolio run)", "",
          f"Net {ps.get('net_profit')} USD over {ps.get('trades')} trades, PF {ps.get('profit_factor')}, "
          f"expectancy {ps.get('expectancy_r')} R, costs {ps.get('costs', {}).get('total')} USD "
          f"({ps.get('costs', {}).get('pct_of_gross_profit')} % of gross profit).", "",
          "By exit reason:", "", _md_table(dec), "", "Give-back:", "", "```", json.dumps(s["give_back"], indent=1), "```", ""]
    for name, df in br.items():
        md += [f"By {name}:", "", _md_table(df), ""]
    md += ["## 4. Exit-rule what-ifs on the same signals (per-signal, isolated; diagnostic only)", "", _md_table(wi), "",
           "These are NOT a parameter search for deployment: they show whether the loss is an exit artefact. If every variant "
           "stays negative, the entries themselves have no edge.", ""]
    (out / "AUDIT.md").write_text("\n".join(md), encoding="utf-8")
