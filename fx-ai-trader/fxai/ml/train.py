"""Chronological walk-forward training and evaluation of the meta-filter.

Protocol (fixed before any results were seen):
- Expanding window. Test folds are consecutive ``fold_months`` blocks starting
  at ``first_test_start``.
- Purging + embargo: a training row is used only if its trade had EXITED at
  least ``embargo`` before the test fold starts (no label overlaps the test).
- Imputation, standardisation and the model are fit on training rows only.
- Model: L2 logistic regression, C fixed at 0.5 (not tuned).
- Decision threshold: the training-set base rate (take a signal only if the
  model rates it above the average historical success rate). Fixed rule.

Approval gates (all must pass): >= 200 out-of-sample rows; pooled Brier skill
score > 0 and positive in >= 60% of folds; out-of-sample filtered expectancy
> 0 and > unfiltered expectancy. Calibration (max reliability-bin error <= 0.10
on bins with >= 30 rows) decides whether the score may be shown as a probability.
"""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score

from ..strategy import FEATURES
from .model import LogisticModel

C_REG = 0.5


@dataclass
class FoldResult:
    test_start: str
    test_end: str
    n_train: int
    n_test: int
    base_rate_train: float
    base_rate_test: float
    auc: float | None
    brier: float
    brier_ref: float
    brier_skill: float
    logloss: float
    threshold: float
    n_taken: int
    exp_r_all: float
    exp_r_taken: float | None


def fit_logreg(x: np.ndarray, y: np.ndarray, c: float = C_REG) -> tuple[list, list, list, list, float]:
    impute = np.nanmedian(x, axis=0)
    impute = np.where(np.isfinite(impute), impute, 0.0)
    xi = np.where(np.isfinite(x), x, impute)
    mean = xi.mean(axis=0)
    scale = xi.std(axis=0)
    scale = np.where(scale > 1e-12, scale, 1.0)
    z = (xi - mean) / scale
    clf = LogisticRegression(C=c, max_iter=2000)
    clf.fit(z, y)
    return impute.tolist(), mean.tolist(), scale.tolist(), clf.coef_[0].tolist(), float(clf.intercept_[0])


def _model(version: str, fit, threshold: float, strategy_version: str, meta: dict, features: list[str] | None = None) -> LogisticModel:
    impute, mean, scale, coef, intercept = fit
    return LogisticModel(version=version, features=list(features or FEATURES), impute=impute, mean=mean, scale=scale, coef=coef,
                         intercept=intercept, threshold=threshold, strategy_version=strategy_version, metadata=meta)


def calibration_table(p: np.ndarray, y: np.ndarray, bins: int = 5) -> list[dict]:
    if len(p) == 0:
        return []
    edges = np.unique(np.quantile(p, np.linspace(0, 1, bins + 1)))
    idx = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, len(edges) - 2)
    out = []
    for b in range(len(edges) - 1):
        m = idx == b
        if m.sum() == 0:
            continue
        out.append({"bin": b, "lo": float(edges[b]), "hi": float(edges[b + 1]), "n": int(m.sum()),
                    "mean_pred": float(p[m].mean()), "observed": float(y[m].mean())})
    return out


def walk_forward(ds: pd.DataFrame, first_test_start: pd.Timestamp, fold_months: int = 6,
                 embargo: pd.Timedelta = pd.Timedelta(hours=72), min_train: int = 150,
                 strategy_version: str = "", features: list[str] | None = None) -> tuple[list[FoldResult], pd.DataFrame]:
    FEATS = list(features or FEATURES)
    end = ds["t_decision"].max() + pd.Timedelta(seconds=1)
    starts = pd.date_range(first_test_start, end, freq=f"{fold_months}MS")
    if len(starts) == 0 or starts[0] != first_test_start:
        starts = pd.DatetimeIndex([first_test_start]).append(starts)
    folds: list[FoldResult] = []
    oos_parts = []
    for i, ts in enumerate(starts):
        te = starts[i + 1] if i + 1 < len(starts) else end
        test = ds[(ds["t_decision"] >= ts) & (ds["t_decision"] < te)]
        train = ds[ds["t_exit"] < ts - embargo]
        if len(test) == 0 or len(train) < min_train or train["label"].nunique() < 2:
            continue
        xtr, ytr = train[FEATS].to_numpy(float), train["label"].to_numpy(int)
        xte, yte = test[FEATS].to_numpy(float), test["label"].to_numpy(int)
        fit = fit_logreg(xtr, ytr)
        base = float(ytr.mean())
        m = _model("wf", fit, base, strategy_version, {}, FEATS)
        p = m.predict_proba(xte)
        brier = float(np.mean((p - yte) ** 2))
        brier_ref = float(np.mean((base - yte) ** 2))
        taken = p >= base
        folds.append(FoldResult(
            test_start=str(ts.date()), test_end=str(pd.Timestamp(te).date()), n_train=len(train), n_test=len(test),
            base_rate_train=round(base, 4), base_rate_test=round(float(yte.mean()), 4),
            auc=round(float(roc_auc_score(yte, p)), 4) if len(np.unique(yte)) == 2 else None,
            brier=round(brier, 5), brier_ref=round(brier_ref, 5),
            brier_skill=round(1 - brier / brier_ref, 4) if brier_ref > 0 else 0.0,
            logloss=round(float(log_loss(yte, np.clip(p, 1e-6, 1 - 1e-6), labels=[0, 1])), 4),
            threshold=round(base, 4), n_taken=int(taken.sum()),
            exp_r_all=round(float(test["r_net"].mean()), 4),
            exp_r_taken=round(float(test.loc[taken, "r_net"].mean()), 4) if taken.any() else None,
        ))
        part = test[["key", "symbol", "t_decision", "label", "r_net"]].copy()
        part["prob"] = p
        part["threshold"] = base
        part["taken"] = taken
        oos_parts.append(part)
    oos = pd.concat(oos_parts, ignore_index=True) if oos_parts else pd.DataFrame()
    return folds, oos


def evaluate(folds: list[FoldResult], oos: pd.DataFrame) -> dict:
    if oos.empty:
        return {"n_oos": 0, "gates": {"enough_data": False}, "approvable": False, "calibrated": False}
    p, y = oos["prob"].to_numpy(), oos["label"].to_numpy()
    # Pooled reference: each fold's own training base rate.
    brier = float(np.mean((p - y) ** 2))
    brier_ref = float(np.mean((oos["threshold"].to_numpy() - y) ** 2))
    bss = 1 - brier / brier_ref if brier_ref > 0 else 0.0
    cal = calibration_table(p, y)
    cal_err = max((abs(b["mean_pred"] - b["observed"]) for b in cal if b["n"] >= 30), default=1.0)
    exp_all = float(oos["r_net"].mean())
    exp_taken = float(oos.loc[oos["taken"], "r_net"].mean()) if oos["taken"].any() else float("nan")
    frac_pos = float(np.mean([f.brier_skill > 0 for f in folds])) if folds else 0.0
    gates = {
        "enough_data": len(oos) >= 200,
        "brier_skill_positive": bss > 0,
        "brier_skill_positive_in_60pct_folds": frac_pos >= 0.6,
        "filtered_expectancy_positive": bool(np.isfinite(exp_taken) and exp_taken > 0),
        "filtered_beats_unfiltered": bool(np.isfinite(exp_taken) and exp_taken > exp_all),
    }
    return {
        "n_oos": int(len(oos)), "n_folds": len(folds), "oos_base_rate": round(float(y.mean()), 4),
        "auc": round(float(roc_auc_score(y, p)), 4) if len(np.unique(y)) == 2 else None,
        "brier": round(brier, 5), "brier_ref": round(brier_ref, 5), "brier_skill": round(bss, 4),
        "folds_with_positive_skill": round(frac_pos, 3),
        "calibration": cal, "max_calibration_error": round(cal_err, 4), "calibrated": cal_err <= 0.10,
        "exp_r_unfiltered": round(exp_all, 4), "exp_r_filtered": round(exp_taken, 4) if np.isfinite(exp_taken) else None,
        "n_taken": int(oos["taken"].sum()), "win_rate_unfiltered": round(float(y.mean()), 4),
        "win_rate_filtered": round(float(oos.loc[oos["taken"], "label"].mean()), 4) if oos["taken"].any() else None,
        "gates": gates, "approvable": all(gates.values()),
        "folds": [asdict(f) for f in folds],
    }


def train_final(ds: pd.DataFrame, report: dict, strategy_version: str, data_desc: str,
                features: list[str] | None = None) -> LogisticModel:
    """Fit on ALL rows (the walk-forward report above is its out-of-sample evidence)."""
    FEATS = list(features or FEATURES)
    x, y = ds[FEATS].to_numpy(float), ds["label"].to_numpy(int)
    fit = fit_logreg(x, y)
    base = float(y.mean())
    h = hashlib.sha256(pd.util.hash_pandas_object(ds[["key", "label"] + FEATS], index=False).values.tobytes()).hexdigest()
    version = f"meta-{pd.Timestamp.now(tz='UTC'):%Y%m%d%H%M%S}-{h[:8]}"
    meta = {
        "dataset_sha256": h, "rows": int(len(ds)), "base_rate": round(base, 4),
        "train_period": [str(ds["t_decision"].min()), str(ds["t_decision"].max())],
        "label": "1 if per-signal R net of spread, slippage, commission and swap > 0",
        "features": FEATS, "model": f"L2 logistic regression C={C_REG}",
        "threshold_rule": "training base rate", "data": data_desc,
        "walk_forward": {k: v for k, v in report.items() if k != "folds"},
        "folds": report.get("folds", []),
    }
    m = _model(version, fit, base, strategy_version, meta, FEATS)
    m.calibrated = bool(report.get("calibrated", False))
    return m
