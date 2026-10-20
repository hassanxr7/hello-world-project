"""Random-entry permutation test.

Question: do a strategy's entry signals carry information, or would random
entries with the SAME exit rules, the same stop sizes, the same symbols and
the same hours of day do equally well?

For each permutation, every real signal is replaced by a random completed bar
of the same symbol in the same UTC hour (and, when available, the same trend
regime), with the same side and the same stop distance in ATR units. The trade
is then simulated with the same exits and costs. The distribution of the mean
net R across permutations is the null distribution; the p-value is the share
of permutations whose mean is at least as good as the real signals' mean.

This is the multiple-testing control for the research programme: with K
pre-declared strategy ideas, a candidate must clear p < 0.05 / K (Bonferroni).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..backtest.costs import CostModel
from ..backtest.engine import PortfolioBacktest
from ..backtest.fills import simulate_trade
from ..config import ExitConfig
from ..symbols import KNOWN_MAJORS

CONTRACT = 100_000.0
NS = 1_000_000_000


def r_net_of_path(path, symbol: str, costs: CostModel, account_ccy: str = "USD") -> float:
    base, quote, digits = KNOWN_MAJORS[symbol]
    point = 10.0 ** -digits
    pip = point * 10 if digits in (3, 5) else point
    vpu = CONTRACT if quote == account_ccy else CONTRACT / path.entry
    commission_r = costs.commission_per_lot_rt / (path.risk_dist * vpu)
    swap_r = path.swap_nights * costs.swap_pips_per_night * costs.swap_multiplier * pip / path.risk_dist
    return path.r_gross - commission_r + swap_r


def simulate_signals(bt: PortfolioBacktest, sig: pd.DataFrame, exits: ExitConfig, costs: CostModel) -> pd.DataFrame:
    """Per-signal isolated simulation. ``sig`` needs key, symbol, time, side, sl, atr_e."""
    rows = []
    for r in sig.itertuples(index=False):
        a = bt._arrays[r.symbol]
        ts = pd.Timestamp(r.time).value
        i0 = a.index_at_or_after(ts)
        if i0 >= len(a.t) or a.t[i0] - ts > 5 * 60 * NS:
            continue
        p = simulate_trade(a, i0, int(r.side), float(r.sl), exits, costs, float(r.atr_e))
        if p is None:
            continue
        rows.append({"key": r.key, "symbol": r.symbol, "time": r.time, "side": r.side, "r_net": r_net_of_path(p, r.symbol, costs),
                     "r_gross": p.r_gross, "reason": p.reason, "mfe_r": p.mfe_r, "mae_r": p.mae_r,
                     "hold_h": (p.t_exit - p.t_entry) / 3600e9})
    return pd.DataFrame(rows)


@dataclass
class PermutationResult:
    n_signals: int
    real_mean_r: float
    null_means: np.ndarray
    p_value: float
    z_score: float
    real_by_symbol: dict[str, float]

    def summary(self) -> dict:
        return {"n_signals": self.n_signals, "real_mean_r": round(self.real_mean_r, 4),
                "null_mean_r": round(float(self.null_means.mean()), 4), "null_sd": round(float(self.null_means.std()), 4),
                "z_score": round(self.z_score, 2), "p_value": round(self.p_value, 4), "n_perm": int(len(self.null_means)),
                "real_by_symbol": {k: round(v, 4) for k, v in self.real_by_symbol.items()}}


def random_entry_test(bt: PortfolioBacktest, signals: pd.DataFrame, exits: ExitConfig, costs: CostModel,
                      n_perm: int = 100, seed: int = 0, match_regime: bool = True,
                      start: pd.Timestamp | None = None, end: pd.Timestamp | None = None) -> PermutationResult:
    rng = np.random.default_rng(seed)
    sig = signals.copy()
    if start is not None:
        sig = sig[sig["time"] >= start]
    if end is not None:
        sig = sig[sig["time"] < end]
    real = simulate_signals(bt, sig, exits, costs)
    real_mean = float(real["r_net"].mean()) if len(real) else float("nan")

    # Candidate pools: completed bars per symbol, keyed by (hour, regime-or-"*")
    pools: dict[str, dict[tuple, np.ndarray]] = {}
    frames: dict[str, pd.DataFrame] = {}
    for sym in sig["symbol"].unique():
        f = bt._frames[sym]
        ok = f["atr_e"].notna() & f["close"].notna()
        if "r_session" in f:
            ok &= f["r_session"].astype(bool)
        if start is not None:
            ok &= f["close_time"] >= start
        if end is not None:
            ok &= f["close_time"] < end
        sub = f[ok]
        frames[sym] = sub
        hours = pd.DatetimeIndex(sub["close_time"]).hour.to_numpy()
        reg = sub["tr_regime"].astype(str).to_numpy() if ("tr_regime" in sub and match_regime) else np.full(len(sub), "*")
        d: dict[tuple, np.ndarray] = {}
        for h in np.unique(hours):
            for g in np.unique(reg):
                idx = np.flatnonzero((hours == h) & (reg == g))
                if len(idx):
                    d[(int(h), str(g))] = idx
            d[(int(h), "*")] = np.flatnonzero(hours == h)
        pools[sym] = d

    sig_hours = pd.DatetimeIndex(sig["time"]).hour.to_numpy()
    sig_reg = sig["regime"].astype(str).to_numpy() if ("regime" in sig and match_regime) else np.full(len(sig), "*")
    stop_atr = ((sig["ref_close"] - sig["sl"]).abs() / sig["atr_e"]).to_numpy() if "ref_close" in sig else np.full(len(sig), 1.5)
    sides = sig["side"].to_numpy()
    syms = sig["symbol"].to_numpy()

    null_means = np.empty(n_perm)
    for k in range(n_perm):
        rows = []
        for j in range(len(sig)):
            sym = syms[j]
            d = pools[sym]
            pool = d.get((int(sig_hours[j]), sig_reg[j]))
            if pool is None or len(pool) < 5:
                pool = d.get((int(sig_hours[j]), "*"))
            if pool is None or len(pool) == 0:
                continue
            i = int(rng.choice(pool))
            row = frames[sym].iloc[i]
            side = int(sides[j])
            close, atr_e = float(row["close"]), float(row["atr_e"])
            sl = close - side * stop_atr[j] * atr_e
            rows.append({"key": f"perm{k}-{j}", "symbol": sym, "time": row["close_time"], "side": side, "sl": sl, "atr_e": atr_e})
        sim = simulate_signals(bt, pd.DataFrame(rows), exits, costs)
        null_means[k] = float(sim["r_net"].mean()) if len(sim) else np.nan
    null_means = null_means[np.isfinite(null_means)]
    p = float((null_means >= real_mean).mean()) if len(null_means) else float("nan")
    sd = float(null_means.std()) if len(null_means) > 1 else float("nan")
    z = (real_mean - float(null_means.mean())) / sd if sd and sd > 0 else float("nan")
    by_sym = real.groupby("symbol")["r_net"].mean().to_dict() if len(real) else {}
    return PermutationResult(len(real), real_mean, null_means, p, z, by_sym)
