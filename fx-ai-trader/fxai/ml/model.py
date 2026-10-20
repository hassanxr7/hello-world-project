"""A deliberately simple, inspectable model: L2-regularised logistic regression
used as a *meta-filter* on baseline signals (it can only remove trades).

Models are serialised as plain JSON (coefficients, scaler, imputation values,
metadata) - never pickle - so loading a model file cannot execute code, and
the SHA-256 of the file is checked against the approval record before use.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

MODEL_FORMAT = "fxai-logreg-v1"


@dataclass
class LogisticModel:
    version: str
    features: list[str]
    impute: list[float]
    mean: list[float]
    scale: list[float]
    coef: list[float]
    intercept: float
    threshold: float
    strategy_version: str
    calibrated: bool = False  # True only if out-of-sample calibration passed the gate
    metadata: dict[str, Any] = field(default_factory=dict)
    format: str = MODEL_FORMAT

    def _matrix(self, rows: list[dict[str, float]] | np.ndarray) -> np.ndarray:
        if isinstance(rows, np.ndarray):
            x = rows.astype(float)
        else:
            x = np.array([[float(r.get(f, np.nan)) for f in self.features] for r in rows], dtype=float)
        imp = np.asarray(self.impute)
        bad = ~np.isfinite(x)
        x[bad] = np.take(imp, np.nonzero(bad)[1])
        return (x - np.asarray(self.mean)) / np.asarray(self.scale)

    def predict_proba(self, rows: list[dict[str, float]] | np.ndarray) -> np.ndarray:
        z = self._matrix(rows) @ np.asarray(self.coef) + self.intercept
        return 1.0 / (1.0 + np.exp(-np.clip(z, -50, 50)))

    def score_one(self, features: dict[str, float]) -> float:
        return float(self.predict_proba([features])[0])

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, sort_keys=True, default=float)

    def save(self, path: str | Path) -> str:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        data = self.to_json().encode()
        p.write_bytes(data)
        return hashlib.sha256(data).hexdigest()

    @classmethod
    def load(cls, path: str | Path, expected_sha256: str | None = None) -> "LogisticModel":
        data = Path(path).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if expected_sha256 is not None and digest != expected_sha256:
            raise ValueError(f"model file hash mismatch ({digest[:12]} != {expected_sha256[:12]}); refusing to load")
        raw = json.loads(data)
        if raw.get("format") != MODEL_FORMAT:
            raise ValueError("unsupported model format")
        n = len(raw["features"])
        for k in ("impute", "mean", "scale", "coef"):
            if len(raw[k]) != n:
                raise ValueError(f"model field {k} has wrong length")
        if any(s <= 0 for s in raw["scale"]):
            raise ValueError("model scale must be positive")
        return cls(**raw)


def file_sha256(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
