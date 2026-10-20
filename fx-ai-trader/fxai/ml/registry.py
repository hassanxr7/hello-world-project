"""Model registry: candidate -> (human) approval -> live use.

- ``save_candidate`` writes the JSON model + its evaluation report and records
  the SHA-256 in the database with status "candidate".
- ``approve`` is a deliberate human action (CLI ``fxai model approve``). It is
  refused unless every walk-forward gate passed, and it is audited.
- The live service only loads the single approved model and verifies the
  file hash; it never trains or modifies models (no live self-modification).
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from ..storage import Storage
from .model import LogisticModel, file_sha256


class ModelRegistry:
    def __init__(self, root: str | Path, storage: Storage):
        self.root = Path(root)
        self.storage = storage

    def save_candidate(self, model: LogisticModel, report: dict) -> tuple[Path, str]:
        path = self.root / "candidates" / f"{model.version}.json"
        sha = model.save(path)
        (self.root / "candidates" / f"{model.version}.report.json").write_text(
            json.dumps(report, indent=2, default=str), encoding="utf-8")
        self.storage.register_model(model.version, str(path), sha, report)
        return path, sha

    def approve(self, version: str, approved_by: str) -> Path:
        rows = self.storage.query("SELECT * FROM models WHERE version=?", (version,))
        if not rows:
            raise ValueError(f"unknown model version {version}")
        rec = rows[0]
        report = json.loads(rec["metrics"] or "{}")
        if not report.get("approvable"):
            failed = [k for k, v in report.get("gates", {}).items() if not v]
            raise PermissionError(f"model {version} failed evaluation gates {failed}; approval refused")
        src = Path(rec["path"])
        if file_sha256(src) != rec["sha256"]:
            raise ValueError("candidate file changed since evaluation; approval refused")
        dst = self.root / "approved" / src.name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        with self.storage.tx() as c:
            c.execute("UPDATE models SET path=? WHERE version=?", (str(dst), version))
        self.storage.approve_model(version, approved_by)
        return dst

    def load_approved(self) -> LogisticModel | None:
        rec = self.storage.approved_model()
        if rec is None:
            return None
        return LogisticModel.load(rec["path"], expected_sha256=rec["sha256"])
