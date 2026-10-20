"""`fxai doctor` against real bridge files written by the EA emulator."""

import pandas as pd
import pytest

from fxai.bridge.ea_emulator import EAEmulator, EAInputs
from fxai.config import AppConfig
from fxai.doctor import format_report, run_doctor
from fxai.execution.sim_broker import SimBroker
from tests.conftest import eurusd_spec
from tests.test_strategy import synthetic_m1

ENV = {"FXAI_DASHBOARD_PASSWORD_HASH": "scrypt$x", "FXAI_SECRET_KEY": "k" * 40}


@pytest.fixture(scope="module")
def m1():
    return synthetic_m1(n_days=45, seed=5)


def setup(tmp_path, m1, cfg_extra=None, ea_kw=None, balance=10_000.0):
    now = pd.Timestamp(m1.index[-1]).floor("h") + pd.Timedelta(seconds=5)
    broker = SimBroker(specs={"EURUSD": eurusd_spec()}, balance=balance)
    mid = float(m1["close"].iloc[-120])
    broker.set_quote("EURUSD", mid - 0.00004, mid + 0.00004, now.to_pydatetime())
    root = tmp_path / "FXAI" / "900001"
    inp = EAInputs(**{"symbols": ["EURUSD"], "bars_timeframes": ["M15", "H1"], "bars_count": 800, **(ea_kw or {})})
    EAEmulator(root, broker, inp, m1={"EURUSD": m1}).step(now.to_pydatetime())
    raw = {"symbols": {"enabled": ["EURUSD"]}, "strategy": {"decision_timeframe": "M15", "trend_timeframe": "H1"},
           "bridge": {"root": str(tmp_path / "FXAI"), "account": "900001"},
           "daily_reset": {"zone": "server", "hour": 0}, "storage": {"db_path": str(tmp_path / "db.sqlite")}}
    for k, v in (cfg_extra or {}).items():
        raw[k] = {**raw.get(k, {}), **v}
    return AppConfig.model_validate(raw), now.to_pydatetime()


def by_name(checks):
    return {c.name: c for c in checks}


def test_healthy_setup_has_no_failures(tmp_path, m1):
    cfg, now = setup(tmp_path, m1)
    checks = run_doctor(cfg, now=now, env=ENV)
    assert not [c for c in checks if c.status == "FAIL"], format_report(checks)
    c = by_name(checks)
    assert c["magic number"].status == "PASS" and c["symbols"].status == "PASS"
    assert c["EURUSD H1 bars"].status in ("PASS", "WARN") and c["EURUSD min lot"].status == "PASS"
    report = format_report(checks)
    assert "scrypt" not in report and "k" * 40 not in report  # no secrets


def test_missing_ea(tmp_path):
    (tmp_path / "FXAI" / "900001").mkdir(parents=True)
    cfg = AppConfig.model_validate({"bridge": {"root": str(tmp_path / "FXAI"), "account": "900001"},
                                    "storage": {"db_path": str(tmp_path / "db.sqlite")}})
    c = by_name(run_doctor(cfg, env=ENV))
    assert c["EA state"].status == "FAIL" and "attached" in c["EA state"].detail


def test_magic_mismatch(tmp_path, m1):
    cfg, now = setup(tmp_path, m1, cfg_extra={"bridge": {"magic_number": 42}})
    assert by_name(run_doctor(cfg, now=now, env=ENV))["magic number"].status == "FAIL"


def test_symbol_not_exported(tmp_path, m1):
    cfg, now = setup(tmp_path, m1, cfg_extra={"symbols": {"enabled": ["EURUSD", "GBPUSD"]}})
    c = by_name(run_doctor(cfg, now=now, env=ENV))
    assert c["symbols"].status == "FAIL" and "GBPUSD" in c["symbols"].detail


def test_missing_timeframe(tmp_path, m1):
    cfg, now = setup(tmp_path, m1, ea_kw={"bars_timeframes": ["M15"]})
    checks = run_doctor(cfg, now=now, env=ENV)
    assert any(c.name == "bar timeframes" and c.status == "FAIL" for c in checks)


def test_account_too_small_for_min_lot(tmp_path, m1):
    cfg, now = setup(tmp_path, m1, balance=200.0)
    c = by_name(run_doctor(cfg, now=now, env=ENV))
    assert c["EURUSD min lot"].status == "WARN" and "SKIPPED" in c["EURUSD min lot"].detail


def test_missing_dashboard_secrets_warns(tmp_path, m1):
    cfg, now = setup(tmp_path, m1)
    assert by_name(run_doctor(cfg, now=now, env={}))["dashboard secrets"].status == "WARN"
