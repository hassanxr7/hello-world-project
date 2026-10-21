"""Evidence-gated P&L forecast ranges (FORECAST, never presented as a promise or a target).

A range is produced only when every evidence check passes:
  1. the running strategy version has a passed validation record
     (reports/validation_status.json, research plan v2 stage 3 + demo forward test);
  2. the sample is the account's OWN forward results for that strategy version;
  3. at least ``min_trades`` closed trades and ``min_days`` trading days in the sample.

Otherwise the result is exactly "Insufficient evidence for a reliable estimate." plus the
failed checks. The aspirational profit target is never an input here.

Method: moving-block bootstrap of daily returns (% of equity), INCLUDING days without trades,
so that losing streaks, quiet periods and day-to-day dependence in the sample are preserved
(block length ~ n^(1/3), between 3 and 20 days). Output per horizon: downside (10th pct),
central (median), upside (90th pct), the probability of a loss and of no trades at all,
with the sample size and assumptions. It cannot know about regime changes the sample did not
contain, and it does not model gaps beyond what the sample saw.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

INSUFFICIENT = "Insufficient evidence for a reliable estimate."


@dataclass
class EvidenceGate:
    ok: bool
    checks: list[dict[str, Any]] = field(default_factory=list)


def evidence_gate(validation: dict | None, strategy_version: str, n_trades: int, n_days: int,
                  min_trades: int = 100, min_days: int = 120) -> EvidenceGate:
    v = validation or {}
    checks = [
        {"check": "validated strategy", "ok": bool(v.get("passed")) and v.get("strategy_version") == strategy_version,
         "detail": (f"validation record passed for {strategy_version}" if v.get("passed") and
                    v.get("strategy_version") == strategy_version else
                    f"no passed validation record for {strategy_version} (reports/validation_status.json)")},
        {"check": "forward sample: closed trades", "ok": n_trades >= min_trades, "detail": f"{n_trades} / {min_trades}"},
        {"check": "forward sample: trading days", "ok": n_days >= min_days, "detail": f"{n_days} / {min_days}"},
    ]
    return EvidenceGate(all(c["ok"] for c in checks), checks)


def block_bootstrap_sums(x: np.ndarray, horizon: int, n_boot: int = 5000, block: int | None = None,
                         seed: int = 0) -> np.ndarray:
    """Sums over ``horizon`` days of a moving-block bootstrap of ``x`` (circular blocks)."""
    n = len(x)
    if n == 0 or horizon <= 0:
        return np.zeros(n_boot)
    b = block or int(min(20, max(3, round(n ** (1 / 3)))))
    rng = np.random.default_rng(seed)
    k = math.ceil(horizon / b)
    starts = rng.integers(0, n, size=(n_boot, k))
    idx = (starts[..., None] + np.arange(b)) % n  # (n_boot, k, b)
    paths = x[idx.reshape(n_boot, -1)[:, :horizon]]
    return paths.sum(axis=1)


def forecast(daily_pct: pd.Series, horizons: dict[str, int], equity: float, n_trades: int,
             gate: EvidenceGate, n_boot: int = 5000, seed: int = 0) -> dict[str, Any]:
    out: dict[str, Any] = {"kind": "forecast", "ok": gate.ok, "checks": gate.checks}
    if not gate.ok:
        out["message"] = INSUFFICIENT
        return out
    x = daily_pct.to_numpy(dtype=float)
    n = len(x)
    block = int(min(20, max(3, round(n ** (1 / 3)))))
    zero_days = float((x == 0).mean())
    res = {}
    for name, h in horizons.items():
        if h <= 0:
            res[name] = {"days": 0, "note": "no trading days left in this period"}
            continue
        s = block_bootstrap_sums(x, h, n_boot, block, seed)
        q10, q50, q90 = np.percentile(s, [10, 50, 90])
        res[name] = {"days": int(h),
                     "downside_pct": round(float(q10), 3), "central_pct": round(float(q50), 3),
                     "upside_pct": round(float(q90), 3),
                     "downside": round(float(q10) / 100 * equity, 2), "central": round(float(q50) / 100 * equity, 2),
                     "upside": round(float(q90) / 100 * equity, 2),
                     "p_loss": round(float((s < 0).mean()), 3), "p_no_trades": round(float((s == 0).mean()), 3)}
    out["horizons"] = res
    out["assumptions"] = [
        f"sample: {n} trading days, {n_trades} closed trades of this strategy version on this account",
        f"moving-block bootstrap, block {block} days, {n_boot} resamples; {zero_days:.0%} of sample days had no trades",
        "assumes the next period resembles the sample; regime changes, gaps and broker changes are not modelled",
        "ranges are 10th / 50th / 90th percentiles: 1 period in 5 falls outside them; losses are possible in every horizon",
    ]
    return out
