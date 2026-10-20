"""Full validation run: the pre-declared protocol from docs/RESEARCH_LOG.md.

Produces reports/validation/<timestamp>/ with
  REPORT.md, summary.json, trades_<label>.csv, equity_<label>.svg
Everything in it is computed from the simulation on the supplied data; it is
historical evidence only and not a forecast.
"""

from __future__ import annotations

import json
import platform
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import AppConfig
from ..ml.dataset import build_dataset
from ..ml.train import evaluate, walk_forward
from .costs import CostModel
from .engine import BacktestResult, PortfolioBacktest
from .metrics import monthly_table

DEV_END = pd.Timestamp("2018-01-01", tz="UTC")
WF_START = pd.Timestamp("2016-07-01", tz="UTC")

VARIANTS = {"V2_H1_H4": ("H1", "H4"), "V1_M15_H1": ("M15", "H1")}


def equity_svg(eq: pd.Series, title: str, initial: float) -> str:
    """Single-series line chart (series-1 blue, 2px, recessive grid, no legend)."""
    if eq.empty:
        return ""
    d = eq.resample("1D").last().dropna()
    W, H, L, R, T, B = 900, 300, 70, 16, 34, 30
    x = np.arange(len(d))
    lo, hi = float(min(d.min(), initial)), float(max(d.max(), initial))
    span = hi - lo or 1.0
    step = 10 ** np.floor(np.log10(span / 4))
    step = next(s * step for s in (1, 2, 2.5, 5, 10) if span / (s * step) <= 4)
    ticks = np.arange(np.floor(lo / step) * step, hi + step, step)
    y0, y1 = ticks[0], ticks[-1]

    def X(i: float) -> float:
        return L + i / max(1, len(d) - 1) * (W - L - R)

    def Y(v: float) -> float:
        return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B)

    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="system-ui, sans-serif">',
             f'<rect width="{W}" height="{H}" fill="#fcfcfb"/>',
             f'<text x="{L}" y="20" font-size="14" font-weight="600" fill="#0b0b0b">{title}</text>']
    for t in ticks:
        parts.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(t):.1f}" y2="{Y(t):.1f}" stroke="#e1e0d9" stroke-width="1"/>')
        parts.append(f'<text x="{L - 8}" y="{Y(t) + 4:.1f}" font-size="11" fill="#898781" text-anchor="end">{t:,.0f}</text>')
    parts.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(initial):.1f}" y2="{Y(initial):.1f}" stroke="#c3c2b7" '
                 f'stroke-width="1" stroke-dasharray="4 4"/>')
    for i in (0, len(d) - 1):
        anchor = "start" if i == 0 else "end"
        parts.append(f'<text x="{X(i):.1f}" y="{H - 8}" font-size="11" fill="#898781" text-anchor="{anchor}">'
                     f'{d.index[i]:%Y-%m-%d}</text>')
    path = "".join(f"{'M' if i == 0 else 'L'}{X(i):.1f},{Y(v):.1f}" for i, v in zip(x, d.to_numpy()))
    parts.append(f'<path d="{path}" fill="none" stroke="#2a78d6" stroke-width="2" stroke-linejoin="round"/>')
    parts.append(f'<text x="{W - R}" y="{Y(float(d.iloc[-1])) - 6:.1f}" font-size="11" fill="#52514e" '
                 f'text-anchor="end">{float(d.iloc[-1]):,.0f}</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def _row(label: str, s: dict) -> str:
    c = s.get("costs", {})
    return (f"| {label} | {s.get('trades', 0)} | {s.get('return_pct', 0):+.1f} | {s.get('max_drawdown_pct', 0):.1f} | "
            f"{s.get('profit_factor', 0):.2f} | {s.get('win_rate_pct', 0):.1f} | {s.get('expectancy_r', 0):+.3f} | "
            f"{s.get('expectancy_per_trade', 0):+.2f} | {s.get('exposure_pct', 0):.1f} | {c.get('total', 0):,.0f} | "
            f"{s.get('losing_months', 0)}/{s.get('months', 0)} |")


HEADER = ("| Run | Trades | Net % | Max DD % | PF | Win % | Exp. R | Exp. $/trade | Exposure % | Costs $ | Losing months |\n"
          "|---|---|---|---|---|---|---|---|---|---|---|")


def run_validation(m1: dict[str, pd.DataFrame], out_root: str | Path, data_desc: str) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(out_root) / stamp
    out.mkdir(parents=True, exist_ok=True)
    summary: dict = {"generated_utc": stamp, "data": data_desc, "python": platform.python_version(),
                     "symbols": sorted(m1), "variants": {}}
    md: list[str] = []
    base_costs = CostModel()
    zero = CostModel(spread_pips={k: 0.0 for k in base_costs.spread_pips}, commission_per_lot_rt=0.0,
                     slippage_entry_pips=0.0, slippage_stop_pips=0.0, swap_pips_per_night=0.0)

    for name, (dtf, ttf) in VARIANTS.items():
        cfg = AppConfig.model_validate({"strategy": {"decision_timeframe": dtf, "trend_timeframe": ttf}})
        bt = PortfolioBacktest(cfg, m1, base_costs)
        bt.prepare()
        paths = bt.trade_paths(base_costs)
        v: dict = {"timeframes": [dtf, ttf], "signals": int(len(bt.signals)), "runs": {}}
        runs: dict[str, BacktestResult] = {
            "dev_2015_2017": bt.run(paths=paths, end=DEV_END, label=f"{name} dev"),
            "holdout_2018_2020": bt.run(paths=paths, start=DEV_END, label=f"{name} holdout"),
            "full_period": bt.run(paths=paths, label=f"{name} full"),
        }
        zpaths = bt.trade_paths(zero)
        runs["full_zero_cost"] = bt.run(costs=zero, paths=zpaths, label=f"{name} gross (zero costs)")
        bt.trade_paths(base_costs)  # restore arrays for subsequent runs
        for k, r in runs.items():
            v["runs"][k] = r.stats
            r.trades.to_csv(out / f"trades_{name}_{k}.csv", index=False)
        (out / f"equity_{name}_full.svg").write_text(
            equity_svg(runs["full_period"].equity_hourly, f"{name} equity, full period, default costs (USD)", 10_000.0))
        v["rejections_full"] = runs["full_period"].rejections
        v["halts_full"] = [{"time": str(h["time"]), "loss_pct": round(h["loss_pct"], 2)} for h in runs["full_period"].halts]
        v["monthly_full"] = monthly_table(runs["full_period"].trades).fillna(0).to_dict()

        # cost sensitivity (full period) - reported, not optimised
        sens = {}
        for label, cm in {"spread x1.5": base_costs.scaled(spread=1.5), "spread x2": base_costs.scaled(spread=2.0),
                          "slippage x2": base_costs.scaled(slippage=2.0), "commission x1.5": base_costs.scaled(commission=1.5),
                          "swap x2": base_costs.scaled(swap=2.0)}.items():
            p = bt.trade_paths(cm)
            sens[label] = bt.run(costs=cm, paths=p, label=label).stats
        bt.trade_paths(base_costs)
        v["cost_sensitivity"] = sens

        # walk-forward ML meta-filter + OOS portfolio comparison
        ds = build_dataset(bt.signals, paths, base_costs)
        folds, oos = walk_forward(ds, WF_START, strategy_version=bt.strategy.full_version)
        rep = evaluate(folds, oos)
        v["ml_walk_forward"] = {k: val for k, val in rep.items() if k != "folds"}
        v["ml_folds"] = rep.get("folds", [])
        if not oos.empty:
            taken = set(oos.loc[oos["taken"], "key"])
            allk = set(oos["key"])
            base_oos = bt.run(paths=paths, start=WF_START, allowed_keys=allk, label=f"{name} baseline OOS")
            ml_oos = bt.run(paths=paths, start=WF_START, allowed_keys=taken, label=f"{name} ML-filtered OOS")
            v["ml_portfolio_oos"] = {"baseline": base_oos.stats, "ml_filtered": ml_oos.stats}
        summary["variants"][name] = v

    # parameter sensitivity on the default variant (full period) - for information only
    param_sens = {}
    for label, patch in {"TP 1.5R": {"exits": {"take_profit_r": 1.5}}, "TP 3R": {"exits": {"take_profit_r": 3.0}},
                         "break-even off": {"exits": {"breakeven_enabled": False}},
                         "trailing on": {"exits": {"trailing_enabled": True}},
                         "ADX min 25": {"strategy": {"params": {"adx_min": 25.0}}},
                         "room filter off": {"strategy": {"params": {"min_room_r": 0.0}}}}.items():
        raw = {"strategy": {"decision_timeframe": "H1", "trend_timeframe": "H4"}}
        for k, val in patch.items():
            if k == "strategy":
                raw["strategy"] = {**raw["strategy"], **val}
            else:
                raw[k] = val
        cfg = AppConfig.model_validate(raw)
        b2 = PortfolioBacktest(cfg, m1, base_costs)
        b2.prepare()
        param_sens[label] = b2.run(label=label).stats
    summary["parameter_sensitivity_V2"] = param_sens

    (out / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    _write_markdown(out, summary, data_desc, base_costs)
    return out


def _write_markdown(out: Path, s: dict, data_desc: str, costs: CostModel) -> None:
    md = [f"# Validation report ({s['generated_utc']})", "",
          "> **Historical simulation only.** These numbers come from a simulator applied to past data with the cost "
          "assumptions listed below. They are not live results, they do not predict future performance, and the "
          "strategy has **not** shown a positive edge on this data.", "",
          f"- Data: {data_desc}", f"- Symbols: {', '.join(s['symbols'])}",
          "- Initial balance 10,000 USD; default risk settings (0.25 %/trade, 1 % total, 3 positions, 2 % daily loss, "
          "20 entries/day); same `RiskEngine` code as live.",
          f"- Costs: {json.dumps(costs.describe()['spread_pips'])} pips base spread (x session multipliers), "
          f"commission {costs.commission_per_lot_rt} USD/lot round turn, entry slippage {costs.slippage_entry_pips} pip, "
          f"stop/forced-exit slippage {costs.slippage_stop_pips} pip, swap {costs.swap_pips_per_night} pip/night "
          "(triple Wednesday).",
          "- Fills: M1 bars; when one M1 bar touches both stop and target the stop is assumed first; gaps fill at the "
          "open; break-even/trailing take effect from the next bar.", ""]
    for name, v in s["variants"].items():
        md += [f"## {name} ({v['timeframes'][0]} entries / {v['timeframes'][1]} trend) - {v['signals']} baseline signals", "",
               HEADER]
        for k, st in v["runs"].items():
            md.append(_row(k, st))
        md += ["", "**Cost sensitivity (full period):**", "", HEADER]
        for k, st in v["cost_sensitivity"].items():
            md.append(_row(k, st))
        full = v["runs"]["full_period"]
        md += ["", f"Yearly net (full period, USD): {full.get('yearly_net')}",
               f"Worst month {full.get('worst_month')} USD, best month {full.get('best_month')} USD, "
               f"max consecutive losses {full.get('max_consecutive_losses')}, daily-loss halts {len(v['halts_full'])}.",
               f"Exit reasons: {full.get('exit_reasons')}. Bars with stop/target ambiguity: "
               f"{full.get('ambiguous_bars_total')} (in {full.get('trades_with_ambiguous_bar')} trades).",
               f"Risk-engine rejections (full period): {v['rejections_full']}", "",
               f"![equity](equity_{name}_full.svg)", ""]
        ml = v["ml_walk_forward"]
        md += ["**ML meta-filter, chronological walk-forward (6-month folds from 2016-07, purged, embargo 72 h):**", "",
               f"- OOS rows {ml.get('n_oos')}, AUC {ml.get('auc')}, Brier {ml.get('brier')} vs base-rate Brier "
               f"{ml.get('brier_ref')} (skill {ml.get('brier_skill')}), folds with positive skill "
               f"{ml.get('folds_with_positive_skill')}, max calibration error {ml.get('max_calibration_error')} "
               f"({'calibrated' if ml.get('calibrated') else 'NOT calibrated'}).",
               f"- Per-signal expectancy (R, net): unfiltered {ml.get('exp_r_unfiltered')}, filtered "
               f"{ml.get('exp_r_filtered')} ({ml.get('n_taken')} of {ml.get('n_oos')} taken).",
               f"- Approval gates: {ml.get('gates')} -> **{'approvable' if ml.get('approvable') else 'NOT approvable'}**.", ""]
        if "ml_portfolio_oos" in v:
            md += ["Portfolio comparison on the same out-of-sample period:", "", HEADER,
                   _row("baseline OOS", v["ml_portfolio_oos"]["baseline"]),
                   _row("ML-filtered OOS", v["ml_portfolio_oos"]["ml_filtered"]), ""]
    md += ["## Parameter sensitivity (V2, full period - information only, not used to select anything)", "", HEADER]
    for k, st in s["parameter_sensitivity_V2"].items():
        md.append(_row(k, st))
    md += ["", "## Reading this report", "",
           "- `dev_2015_2017` was used for the pre-declared variant selection; `holdout_2018_2020` was not used for any "
           "decision. `full_zero_cost` removes all costs to show the gross edge of the rules.",
           "- Exposure = share of time with at least one open position. Expectancy R is net P&L divided by the risk "
           "engine's planned risk per trade.",
           "- Realised losses can exceed planned stop risk (gaps, slippage); see `sl_gap` exits.", ""]
    (out / "REPORT.md").write_text("\n".join(md), encoding="utf-8")
