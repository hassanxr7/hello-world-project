"""Experiment runner: evaluates one strategy on one period against the pre-declared
gates (docs/RESEARCH_PLAN_v2.md) and records EVERYTHING in reports/experiments/.

An experiment id is <stage>-<strategy>-<timestamp>. The INDEX.md row is appended
whether the candidate passes or fails, so the number of trials is visible.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ..backtest.costs import CostModel
from ..backtest.engine import PortfolioBacktest
from ..config import AppConfig
from .permutation import random_entry_test, simulate_signals

K_CANDIDATES = 6  # pre-declared set size for the Bonferroni correction

STAGES = {
    "dev": (pd.Timestamp("2007-01-01", tz="UTC"), pd.Timestamp("2015-01-01", tz="UTC")),
    "validation": (pd.Timestamp("2015-01-01", tz="UTC"), pd.Timestamp("2018-01-01", tz="UTC")),
    "known": (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2020-05-15", tz="UTC")),
}


@dataclass
class Gate:
    name: str
    passed: bool
    value: Any
    threshold: Any


@dataclass
class ExperimentResult:
    id: str
    strategy: str
    stage: str
    period: tuple[str, str]
    stats: dict
    per_signal: dict
    permutation: dict
    yearly: dict
    adverse: dict
    gates: list[Gate] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(g.passed for g in self.gates)

    def as_dict(self) -> dict:
        return {"id": self.id, "strategy": self.strategy, "stage": self.stage, "period": self.period, "stats": self.stats,
                "per_signal": self.per_signal, "permutation": self.permutation, "yearly": self.yearly,
                "adverse": self.adverse, "gates": [g.__dict__ for g in self.gates], "passed": self.passed}


def dev_gates(r: ExperimentResult, stage: str) -> list[Gate]:
    s, ps, pm, yr, adv = r.stats, r.per_signal, r.permutation, r.yearly, r.adverse
    years = [v for v in yr.values()]
    n_pos = sum(1 for v in years if v > 0)
    worst_year_pct = min(years) / 10_000 * 100 if years else 0.0
    if stage == "dev":
        return [
            Gate("per_signal_expectancy_positive", ps.get("mean_r_net", -1) > 0, ps.get("mean_r_net"), "> 0"),
            Gate("profit_factor", s.get("profit_factor", 0) >= 1.10, s.get("profit_factor"), ">= 1.10"),
            Gate("trades", s.get("trades", 0) >= 150, s.get("trades"), ">= 150"),
            Gate("permutation_p_bonferroni", pm.get("p_value", 1) < 0.05 / K_CANDIDATES, pm.get("p_value"), f"< {0.05 / K_CANDIDATES:.4f}"),
            Gate("years_positive", n_pos >= 5 and worst_year_pct > -8, f"{n_pos}/{len(years)} positive, worst {worst_year_pct:.1f}%", ">= 5 of 8, worst > -8%"),
            Gate("adverse_costs_positive", adv.get("net_profit", -1) > 0, adv.get("net_profit"), "> 0 (spread x1.5, slippage x2)"),
            Gate("max_drawdown", s.get("max_drawdown_pct", 100) < 15, s.get("max_drawdown_pct"), "< 15%"),
        ]
    if stage == "validation":
        return [
            Gate("expectancy_positive", s.get("expectancy_r", -1) > 0, s.get("expectancy_r"), "> 0"),
            Gate("profit_factor", s.get("profit_factor", 0) >= 1.05, s.get("profit_factor"), ">= 1.05"),
            Gate("max_drawdown", s.get("max_drawdown_pct", 100) < 15, s.get("max_drawdown_pct"), "< 15%"),
            Gate("permutation_p", pm.get("p_value", 1) < 0.05, pm.get("p_value"), "< 0.05"),
        ]
    return []


def run_experiment(strategy_name: str, m1: dict[str, pd.DataFrame], stage: str, out_root: str | Path = "reports/experiments",
                   n_perm: int = 200, params: dict | None = None, timeframes: tuple[str, str] | None = None,
                   exits: dict | None = None, label: str | None = None, costs: CostModel | None = None,
                   warmup_days: int = 400) -> ExperimentResult:
    start, end = STAGES[stage]
    costs = costs or CostModel()
    raw: dict[str, Any] = {"strategy": {"name": strategy_name, "params": params or {}}}
    if timeframes:
        raw["strategy"]["decision_timeframe"], raw["strategy"]["trend_timeframe"] = timeframes
    if exits:
        raw["exits"] = exits
    cfg = AppConfig.model_validate(raw)
    # Only feed the data needed (warm-up before start, nothing after end) so a later period is never touched.
    lo = start - pd.Timedelta(days=warmup_days)
    data = {s: df[(df.index >= lo) & (df.index < end)] for s, df in m1.items()}
    bt = PortfolioBacktest(cfg, data, costs)
    bt.prepare()
    paths = bt.trade_paths(costs)
    res = bt.run(paths=paths, start=start, end=end, label=label or strategy_name)
    sig = bt.signals[(bt.signals["time"] >= start) & (bt.signals["time"] < end)]
    per = simulate_signals(bt, sig, bt.exits, costs)
    per_signal = {"n": int(len(per)), "mean_r_net": round(float(per["r_net"].mean()), 4) if len(per) else None,
                  "mean_r_gross": round(float(per["r_gross"].mean()), 4) if len(per) else None,
                  "win_pct": round(float((per["r_net"] > 0).mean() * 100), 1) if len(per) else None,
                  "by_symbol": {k: round(v, 4) for k, v in per.groupby("symbol")["r_net"].mean().items()} if len(per) else {},
                  "exit_reasons": per["reason"].value_counts().to_dict() if len(per) else {}}
    perm = random_entry_test(bt, sig, bt.exits, costs, n_perm=n_perm, seed=7).summary() if len(sig) >= 20 else {"p_value": None}
    yearly = {str(k): float(v) for k, v in res.stats.get("yearly_net", {}).items()}
    adverse_costs = costs.scaled(spread=1.5, slippage=2.0)
    apaths = bt.trade_paths(adverse_costs)
    adv = bt.run(costs=adverse_costs, paths=apaths, start=start, end=end, label="adverse").stats
    bt.trade_paths(costs)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    eid = f"{stage}-{strategy_name}-{stamp}"
    r = ExperimentResult(eid, bt.strategy.full_version, stage, (str(start.date()), str(end.date())), res.stats, per_signal,
                         perm, yearly, {k: adv.get(k) for k in ("net_profit", "profit_factor", "expectancy_r", "trades")})
    r.gates = dev_gates(r, stage)
    out = Path(out_root) / eid
    out.mkdir(parents=True, exist_ok=True)
    (out / "result.json").write_text(json.dumps(r.as_dict(), indent=2, default=str))
    (out / "config.json").write_text(json.dumps({"config": raw, "effective_exits": bt.exits.model_dump(),
                                                 "timeframes": [bt.strategy.entry_tf, bt.strategy.trend_tf],
                                                 "params": bt.strategy.p.model_dump(), "costs": costs.describe(),
                                                 "n_perm": n_perm, "symbols": bt.symbols}, indent=2, default=str))
    res.trades.to_csv(out / "trades.csv", index=False)
    per.to_csv(out / "per_signal.csv", index=False)
    _append_index(Path(out_root), r)
    return r


def _append_index(root: Path, r: ExperimentResult) -> None:
    idx = root / "INDEX.md"
    header = ("| id | stage | strategy | trades | net % | PF | exp. R | max DD % | per-signal R | perm. p | years + | adverse net | gates |\n"
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|\n")
    if not idx.exists():
        idx.write_text("# Experiment index (every run, including failures)\n\n" + header)
    s, pm = r.stats, r.permutation
    years = list(r.yearly.values())
    row = (f"| {r.id} | {r.stage} | {r.strategy} | {s.get('trades')} | {s.get('return_pct')} | {s.get('profit_factor')} | "
           f"{s.get('expectancy_r')} | {s.get('max_drawdown_pct')} | {r.per_signal.get('mean_r_net')} | {pm.get('p_value')} | "
           f"{sum(1 for v in years if v > 0)}/{len(years)} | {r.adverse.get('net_profit')} | "
           f"{'PASS' if r.passed else 'fail: ' + ', '.join(g.name for g in r.gates if not g.passed)} |\n")
    with idx.open("a") as fh:
        fh.write(row)


def summarize(results: list[ExperimentResult]) -> str:
    lines = ["| strategy | stage | trades | net % | PF | exp. R | max DD % | per-signal R | perm. p | years + | adverse | verdict |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in results:
        s, pm = r.stats, r.permutation
        years = list(r.yearly.values())
        lines.append(f"| {r.strategy} | {r.stage} | {s.get('trades')} | {s.get('return_pct')} | {s.get('profit_factor')} | "
                     f"{s.get('expectancy_r')} | {s.get('max_drawdown_pct')} | {r.per_signal.get('mean_r_net')} | "
                     f"{pm.get('p_value')} | {sum(1 for v in years if v > 0)}/{len(years)} | {r.adverse.get('net_profit')} | "
                     f"{'PASS' if r.passed else 'FAIL (' + ', '.join(g.name for g in r.gates if not g.passed) + ')'} |")
    return "\n".join(lines)
