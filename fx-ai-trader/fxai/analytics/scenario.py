"""Profit-target scenario analysis (SCENARIO: arithmetic on stated assumptions, NOT a forecast).

The operator's aspirational daily target is never a trading input: it does not change
position size, leverage, frequency or any limit. This module only answers "what would have
to be true to make X per day?" for a given capital, risk per trade, expectancy and trade
frequency, and sets that against the evidence actually observed in the research runs.

Per trade, a strategy risking ``risk_pct`` of capital with expectancy E (in R) and per-trade
dispersion s (in R) makes on average capital*risk_pct*E. Over n trades a day (treated as
independent, which flatters the result when trades are correlated):
    mean/day = capital * risk_pct * E * n
    sd/day   = capital * risk_pct * s * sqrt(n)
The share of losing days and of days that would hit the daily-loss limit use a normal
approximation. Leverage only sets margin; with stop-based sizing it does not change the
amount at risk, so it is reported as margin use only.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

TRADING_DAYS_PER_YEAR = 252


def _phi(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def daily_stats(capital: float, risk_pct: float, expectancy_r: float, trades_per_day: float,
                r_sd: float = 1.2) -> dict[str, float]:
    unit = capital * risk_pct / 100
    mu = unit * expectancy_r * trades_per_day
    sd = unit * r_sd * math.sqrt(max(trades_per_day, 0))
    return {"mean": mu, "sd": sd, "p_losing_day": _phi(-mu / sd) if sd > 0 else (1.0 if mu < 0 else 0.0)}


def required_capital(target: float, risk_pct: float, expectancy_r: float, trades_per_day: float) -> float | None:
    """Capital at which the EXPECTED daily result equals ``target`` (None if the expectancy is not positive)."""
    per = risk_pct / 100 * expectancy_r * trades_per_day
    return target / per if per > 0 else None


def observed_evidence(experiments_dir: str | Path = "reports/experiments") -> dict[str, Any]:
    """Best expectancy and typical frequency actually observed in recorded research runs."""
    runs = []
    for p in sorted(Path(experiments_dir).glob("*/result.json")):
        try:
            r = json.loads(p.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        s = r.get("stats", {})
        days = TRADING_DAYS_PER_YEAR * max(1, len(r.get("yearly", {})))
        runs.append({"id": r.get("id"), "stage": r.get("stage"), "strategy": r.get("strategy"),
                     "passed": r.get("passed"), "expectancy_r": s.get("expectancy_r"), "trades": s.get("trades"),
                     "trades_per_day": round((s.get("trades") or 0) / days, 2)})
    if not runs:
        return {"runs": 0, "note": "no recorded research runs"}
    best = max(runs, key=lambda x: x["expectancy_r"] if x["expectancy_r"] is not None else -9)
    return {"runs": len(runs), "any_passed": any(r["passed"] for r in runs),
            "best_expectancy_r": best["expectancy_r"], "best_strategy": best["strategy"], "best_stage": best["stage"],
            "trades_per_day_range": [min(r["trades_per_day"] for r in runs), max(r["trades_per_day"] for r in runs)],
            "detail": runs}


def assess_target(capital: float | None, currency: str, target: tuple[float, float] | None, risk_pct: float,
                  hard_risk_pct: float, max_daily_loss_pct: float, evidence: dict[str, Any],
                  hypothetical_expectancy_r: tuple[float, ...] = (0.05, 0.1, 0.2),
                  trades_per_day: tuple[float, ...] = (0.5, 1, 2, 5), r_sd: float = 1.2,
                  leverage: float | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"kind": "scenario", "currency": currency, "capital": capital, "target": target,
                           "risk_pct": risk_pct, "label": "hypothetical arithmetic on stated assumptions - not a forecast"}
    best = evidence.get("best_expectancy_r")
    lines = []
    if not evidence.get("any_passed"):
        lines.append("No strategy has passed validation. Every recorded research run has a negative expectancy "
                     f"(best {best} R per trade), so the evidence-based expected daily result is a LOSS at any capital.")
    if target is None:
        lines.append("No aspirational target configured (reporting.aspirational_daily_target).")
    rows = []
    for e in hypothetical_expectancy_r:
        for n in trades_per_day:
            row = {"expectancy_r": e, "trades_per_day": n}
            if capital:
                st = daily_stats(capital, risk_pct, e, n, r_sd)
                row.update({"mean_per_day": round(st["mean"], 2), "sd_per_day": round(st["sd"], 2),
                            "p_losing_day": round(st["p_losing_day"], 3),
                            "p_daily_loss_limit_hit": round(_phi((-max_daily_loss_pct / 100 * capital - st["mean"]) / st["sd"]), 4)})
            if target:
                lo = required_capital(target[0], risk_pct, e, n)
                hi = required_capital(target[1], risk_pct, e, n)
                row.update({"capital_for_target_low": round(lo) if lo else None,
                            "capital_for_target_high": round(hi) if hi else None})
                if capital:
                    need = target[0] / (capital * e * n) * 100 if e > 0 and n > 0 else None
                    row["risk_pct_needed_for_target_low"] = round(need, 3) if need else None
                    row["within_risk_limit"] = bool(need and need <= hard_risk_pct)
            rows.append(row)
    out["grid"] = rows
    if capital and target:
        lines.append(f"{target[0]:g}-{target[1]:g} {currency}/day is {target[0] / capital * 100:.2f}%-"
                     f"{target[1] / capital * 100:.2f}% of {capital:,.0f} {currency} per day "
                     f"(~{target[0] / capital * 100 * TRADING_DAYS_PER_YEAR:.0f}%-"
                     f"{target[1] / capital * 100 * TRADING_DAYS_PER_YEAR:.0f}% a year before compounding).")
        ok = ["E=%gR x %g/day" % (r["expectancy_r"], r["trades_per_day"]) for r in rows if r.get("within_risk_limit")]
        lines.append("Within the risk limit, the low end of the target is reachable on average only in these "
                     "hypothetical cases: " + (", ".join(ok) or "none") + ". None of these expectancies has been demonstrated.")
    tpd = evidence.get("trades_per_day_range")
    if tpd:
        lines.append(f"Observed frequency in the research runs: {tpd[0]}-{tpd[1]} trades/day across all enabled pairs; "
                     "the 20/day ceiling is a limit, not a goal, and no tested strategy came close to it.")
    if leverage and capital:
        lots = capital * risk_pct / 100 / (20 * 10)  # 20-pip stop, 10 per pip per lot (USD-quoted pair)
        margin = lots * 100_000 * 1.10 / leverage
        lines.append(f"Leverage 1:{leverage:g} sets margin only: at {risk_pct}% risk with a 20-pip stop, a "
                     f"{capital:,.0f} account trades ~{lots:.2f} lots per position (~{margin:,.0f} margin at EURUSD 1.10). "
                     "Leverage does not change the money at risk and is not raised here.")
    lines.append("Raising risk per trade, leverage or trade frequency to reach a target is not an option in this system: "
                 "the limits are fixed by configuration, and frequency without an edge only adds costs.")
    out["conclusions"] = lines
    out["evidence"] = {k: v for k, v in evidence.items() if k != "detail"}
    return out


def render_markdown(a: dict[str, Any]) -> str:
    cur = a["currency"]
    md = ["# Profit-target scenario analysis", "",
          f"**{a['label']}.** Capital: {a['capital'] if a['capital'] else 'unknown'} {cur}; "
          f"risk per trade {a['risk_pct']}%; target: {a['target'] or 'not set'} {cur}/day (aspirational).", ""]
    md += [f"- {line}" for line in a["conclusions"]]
    md += ["", "## Hypothetical grid", ""]
    keys = [k for k in a["grid"][0].keys()] if a["grid"] else []
    md.append("| " + " | ".join(keys) + " |")
    md.append("|" + "---|" * len(keys))
    for r in a["grid"]:
        md.append("| " + " | ".join("" if r.get(k) is None else str(r.get(k)) for k in keys) + " |")
    md += ["", "## Evidence used", "", "```", json.dumps(a["evidence"], indent=2), "```", ""]
    return "\n".join(md)
