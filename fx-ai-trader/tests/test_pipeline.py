"""Full decision pipeline: EA-written bars (server time UTC+2) -> FileBridge ->
strategy -> risk engine -> order -> SimBroker fill, using a synthetic market."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from fxai.analysis.bars import resample
from fxai.bridge.ea_emulator import EAEmulator, EAInputs
from fxai.bridge.file_bridge import FileBridge
from fxai.config import AppConfig
from fxai.execution.sim_broker import SimBroker
from fxai.service import TradingService
from fxai.storage import Storage
from fxai.strategy import TrendPullbackStrategy
from tests.conftest import eurusd_spec
from tests.test_integration import Clock
from tests.test_strategy import synthetic_m1


@pytest.fixture(scope="module")
def market():
    m1 = synthetic_m1(n_days=70, seed=11)
    m1.attrs["price_basis"] = "mid"
    return m1


def make(tmp_path, m1, t, cfg_extra=None):
    clock = Clock(t.to_pydatetime())
    broker = SimBroker(specs={"EURUSD": eurusd_spec()}, commission_per_lot_rt=7.0)
    mid = float(m1["close"][m1.index < t].iloc[-1])
    broker.set_quote("EURUSD", mid - 0.00004, mid + 0.00004, clock())
    root = tmp_path / "FXAI" / "900001"
    inp = EAInputs(enable_trading=True, symbols=["EURUSD"], bars_timeframes=["M15", "H1"], bars_count=800)
    ea = EAEmulator(root, broker, inp, m1={"EURUSD": m1})
    cfg = AppConfig.model_validate({
        "symbols": {"enabled": ["EURUSD"], "overrides": {"EURUSD": {"trading_hours_utc": "00:00-24:00"}}},
        "strategy": {"decision_timeframe": "M15", "trend_timeframe": "H1"},
        "risk": {"cooldown_after_entry_min": 0}, **(cfg_extra or {})})
    st = Storage(tmp_path / "db.sqlite")
    svc = TradingService(cfg, st, FileBridge(root, inp.magic, clock=clock), clock=clock)
    return clock, broker, ea, svc, st


def first_signal_time(m1) -> tuple[pd.Timestamp, int]:
    cfg = AppConfig()
    s = TrendPullbackStrategy()
    f = s.compute(resample(m1, "M15"), resample(m1, "H1"), "00:00-24:00")
    sig = f[(f["signal"] != 0) & (f.index > f.index[0] + pd.Timedelta(days=40))]
    assert len(sig), "synthetic market produced no signal"
    return pd.Timestamp(sig["close_time"].iloc[0]), int(sig["signal"].iloc[0])


def test_strategy_signal_becomes_protected_order(tmp_path, market):
    t_close, side = first_signal_time(market)
    clock, broker, ea, svc, st = make(tmp_path, market, t_close + pd.Timedelta(seconds=2))
    for _ in range(3):
        ea.step(clock())
        svc.step()
        clock.advance(1)
        bid, ask, _ = broker.quotes["EURUSD"]
        broker.set_quote("EURUSD", bid, ask, clock())
    decisions = st.recent_decisions()
    assert decisions, "no decision recorded"
    d = decisions[0]
    assert d["action"] == ("BUY" if side > 0 else "SELL"), d["reasons"]
    assert d["bar_time"] == t_close.isoformat()
    orders = list(broker.orders.values())
    assert len(orders) == 1
    o = orders[0]
    assert o.sl > 0 and o.tp > 0
    risk = o.lots * abs(o.open_price - o.sl) * 100_000
    assert risk <= 10_000 * 0.0025 + 1e-6  # never above 0.25 % of equity
    # one decision per bar, even though the loop ran 3 times
    assert len([x for x in decisions if x["bar_time"] == t_close.isoformat()]) == 1
    sig = st.query("SELECT status FROM signals")
    assert sig and sig[0]["status"] in ("SUBMITTED", "FILLED")


def test_wait_decisions_are_recorded_with_reasons(tmp_path, market):
    t = pd.Timestamp(market.index[0] + pd.Timedelta(days=45)).floor("15min") + pd.Timedelta(seconds=2)
    clock, broker, ea, svc, st = make(tmp_path, market, t)
    ea.step(clock())
    svc.step()
    d = st.recent_decisions()
    assert d and d[0]["action"] in ("WAIT", "BUY", "SELL")
    assert d[0]["reasons"] and "regime" in d[0]["reasons"][0]


def test_ml_enabled_without_approved_model_blocks(tmp_path, market):
    t_close, _ = first_signal_time(market)
    clock, broker, ea, svc, st = make(tmp_path, market, t_close + pd.Timedelta(seconds=2),
                                      {"ml": {"enabled": True, "registry_dir": str(tmp_path / "models")}})
    ea.step(clock())
    svc.step()
    assert not broker.orders
    d = st.recent_decisions()[0]
    assert d["action"] == "WAIT" and any("no approved model" in r for r in d["reasons"])
