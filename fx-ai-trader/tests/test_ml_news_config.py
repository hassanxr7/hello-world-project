from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

from fxai.config import AppConfig, NewsConfig
from fxai.ml.model import LogisticModel
from fxai.ml.registry import ModelRegistry
from fxai.ml.train import calibration_table, evaluate, train_final, walk_forward
from fxai.news import Calendar
from fxai.storage import Storage
from fxai.strategy import FEATURES

ROOT = Path(__file__).resolve().parents[1]
UTC = timezone.utc


def fake_dataset(n=900, seed=0, signal=1.5):
    rng = np.random.default_rng(seed)
    t = pd.date_range("2015-01-05", periods=n, freq="36h", tz="UTC")
    X = rng.normal(size=(n, len(FEATURES)))
    p = 1 / (1 + np.exp(-(signal * X[:, 0] - 0.5)))
    y = (rng.random(n) < p).astype(int)
    df = pd.DataFrame(X, columns=FEATURES)
    df["label"] = y
    df["r_net"] = np.where(y == 1, 1.8, -1.0)
    df["t_decision"] = t
    df["t_exit"] = t + pd.Timedelta(hours=20)
    df["key"] = [f"k{i}" for i in range(n)]
    df["symbol"] = "EURUSD"
    return df


def test_walk_forward_purges_overlapping_labels():
    ds = fake_dataset()
    ds.loc[:, "t_exit"] = ds["t_decision"] + pd.Timedelta(days=30)  # long label horizon
    folds, oos = walk_forward(ds, pd.Timestamp("2016-01-01", tz="UTC"), embargo=pd.Timedelta(hours=72))
    for f in folds:
        start = pd.Timestamp(f.test_start, tz="UTC")
        n_ok = int((ds["t_exit"] < start - pd.Timedelta(hours=72)).sum())
        assert f.n_train == n_ok  # nothing whose outcome was unknown at fold start
    assert oos["t_decision"].min() >= pd.Timestamp("2016-01-01", tz="UTC")


def test_model_with_real_signal_passes_and_noise_fails():
    good = fake_dataset(signal=2.0)
    f, o = walk_forward(good, pd.Timestamp("2016-01-01", tz="UTC"))
    rep = evaluate(f, o)
    assert rep["brier_skill"] > 0 and rep["auc"] > 0.65 and rep["approvable"]
    noise = fake_dataset(signal=0.0, seed=3)
    noise["r_net"] = np.where(noise["label"] == 1, 0.5, -1.0)
    f2, o2 = walk_forward(noise, pd.Timestamp("2016-01-01", tz="UTC"))
    assert not evaluate(f2, o2)["approvable"]


def test_calibration_table_bins():
    p = np.linspace(0.05, 0.95, 500)
    y = (np.random.default_rng(1).random(500) < p).astype(int)
    tab = calibration_table(p, y)
    assert sum(b["n"] for b in tab) == 500
    assert max(abs(b["mean_pred"] - b["observed"]) for b in tab) < 0.12


def test_registry_approval_gate_and_hash_check(tmp_path):
    st = Storage(tmp_path / "db.sqlite")
    reg = ModelRegistry(tmp_path / "models", st)
    good = fake_dataset(signal=2.0)
    f, o = walk_forward(good, pd.Timestamp("2016-01-01", tz="UTC"))
    rep = evaluate(f, o)
    m = train_final(good, rep, "trend_pullback-1.0.0", "synthetic")
    path, sha = reg.save_candidate(m, rep)
    assert reg.load_approved() is None
    reg.approve(m.version, "tester")
    loaded = reg.load_approved()
    assert loaded.version == m.version and loaded.calibrated == rep["calibrated"]
    approved_path = Path(st.approved_model()["path"])
    approved_path.write_text(approved_path.read_text().replace('"threshold"', '"threshold" ', 1))
    with pytest.raises(ValueError, match="hash mismatch"):
        reg.load_approved()
    # a failing model can never be approved
    bad_rep = {**rep, "approvable": False, "gates": {"brier_skill_positive": False}}
    m2 = train_final(good, bad_rep, "x", "synthetic")
    reg.save_candidate(m2, bad_rep)
    with pytest.raises(PermissionError):
        reg.approve(m2.version, "tester")


def test_model_json_is_not_executable(tmp_path):
    p = tmp_path / "m.json"
    p.write_text('{"format": "pickle"}')
    with pytest.raises(ValueError):
        LogisticModel.load(p)


def test_calendar_none_is_inactive_and_csv_blocks(tmp_path):
    now = datetime(2026, 11, 6, 13, 10, tzinfo=UTC)
    cal = Calendar(NewsConfig())
    assert not cal.status(now)["active"] and cal.blocking_reason(("EUR", "USD"), now) is None
    f = tmp_path / "cal.csv"
    f.write_text("time_utc,currency,impact,title\n2026-11-06T13:30:00Z,USD,high,Non-Farm Payrolls\n"
                 "2026-11-06T13:30:00Z,JPY,low,Minor\nbad,row,x,y\n")
    cal = Calendar(NewsConfig(provider="csv", csv_path=str(f)))
    assert "Non-Farm" in cal.blocking_reason(("EUR", "USD"), now)
    assert cal.blocking_reason(("AUD", "JPY"), now) is None  # low impact ignored
    assert cal.blocking_reason(("EUR", "USD"), datetime(2026, 11, 6, 15, 0, tzinfo=UTC)) is None
    assert "malformed" in cal.status(now)["detail"]
    req = Calendar(NewsConfig(provider="csv", csv_path=str(tmp_path / "missing.csv"), require_feed=True))
    assert "unavailable" in req.blocking_reason(("EUR", "USD"), now)


def test_example_config_is_valid_and_safe():
    raw = yaml.safe_load((ROOT / "config" / "config.example.yaml").read_text())
    cfg = AppConfig.model_validate(raw)
    assert cfg.mode == "demo" and not cfg.live_enabled
    assert cfg.risk.risk_per_trade_pct == 0.25 and cfg.risk.max_total_risk_pct == 1.0
    assert cfg.risk.max_open_positions == 3 and cfg.risk.max_daily_loss_pct == 2.0
    assert cfg.risk.max_entries_per_day == 20 and cfg.ml.enabled is False and cfg.llm.mode == "off"
    env = (ROOT / "config" / ".env.example").read_text()
    for line in env.splitlines():
        if "=" in line and not line.startswith("#"):
            assert line.split("=", 1)[1].strip() == ""  # no secrets in the template
