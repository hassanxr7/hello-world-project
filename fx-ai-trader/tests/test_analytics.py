"""Reporting: actual period figures, drawdown, risk allowance, the evidence gate and the
block-bootstrap forecast, the target scenario arithmetic, and the dashboard labels."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import pytest

from fxai.analytics import (INSUFFICIENT, assess_target, daily_returns_pct, drawdown, evidence_gate, forecast,
                            next_trading_days, period_summary, risk_allowance)
from fxai.analytics.forecast import block_bootstrap_sums
from fxai.analytics.scenario import daily_stats, observed_evidence, required_capital

UTC = timezone.utc


def trade(ticket, close, net, comm=-1.4, swap=0.0, r=0.5, sid="trend_pullback-1.0.0:EURUSD:x:BUY"):
    return {"ticket": ticket, "signal_id": sid, "symbol": "EURUSD", "side": "BUY", "volume": 0.1,
            "open_time": close, "close_time": close, "profit": net - comm - swap, "swap": swap, "commission": comm,
            "net_profit": net, "r_multiple": r, "status": "CLOSED"}


def test_period_summary_uses_the_trading_day_and_separates_costs():
    # New York 17:00 reset; a trading day is labelled by the date on which it STARTS (same as the EA):
    # 2026-10-20 17:00 NY .. 2026-10-21 17:00 NY is trading day "2026-10-20".
    rows = [trade(1, "2026-10-20T20:00:00+00:00", 10.0, swap=-0.5),   # 16:00 NY -> previous day 2026-10-19
            trade(2, "2026-10-20T22:00:00+00:00", -5.0),              # 18:00 NY -> day 2026-10-20
            trade(3, "2026-10-21T15:00:00+00:00", 7.0),               # 11:00 NY next morning -> day 2026-10-20
            trade(4, "2026-10-05T15:00:00+00:00", 3.0),               # same month, other week
            trade(5, "2026-09-30T15:00:00+00:00", 99.0),              # previous month
            {**trade(6, "2026-10-21T15:30:00+00:00", 1.0), "status": "OPEN"}]  # open: ignored
    now = datetime(2026, 10, 21, 16, 0, tzinfo=UTC)
    p = period_summary(rows, now, "America/New_York", 17)
    assert p["kind"] == "actual" and p["trading_day"] == "2026-10-20"
    assert p["today"]["trades"] == 2 and p["today"]["net"] == pytest.approx(2.0)
    assert p["week"]["trades"] == 3 and p["month"]["trades"] == 4 and p["all"]["trades"] == 5
    assert p["today"]["commission"] == pytest.approx(-2.8)
    assert p["week"]["swap"] == pytest.approx(-0.5)
    assert p["today"]["gross"] == pytest.approx(2.0 + 2.8)


def test_drawdown_and_allowance():
    eq = [{"equity": v} for v in (100, 110, 99, 105)]
    d = drawdown(eq)
    assert d["max_pct"] == pytest.approx(10.0) and d["current_pct"] == pytest.approx(round(5 / 110 * 100, 2))
    a = risk_allowance(10_000, 9_900, 0.0, 2.0, 50.0)
    assert a["limit_money"] == 200 and a["used_money"] == 100 and a["remaining_before_halt"] == 100
    assert a["remaining_if_all_stops_hit"] == 50 and "gaps" in a["note"]
    # a deposit is not a profit and a withdrawal is not a loss
    assert risk_allowance(10_000, 10_900, 1_000.0, 2.0, 0.0)["used_money"] == 100


def test_next_trading_days():
    mon = datetime(2026, 10, 19, 12, tzinfo=UTC)
    fri = datetime(2026, 10, 23, 12, tzinfo=UTC)
    assert next_trading_days(mon) == {"tomorrow": 1, "rest_of_week": 4, "rest_of_month": 9}
    assert next_trading_days(fri)["rest_of_week"] == 0


def test_forecast_refuses_without_evidence():
    g = evidence_gate(None, "trend_pullback-1.0.0", 500, 400)
    out = forecast(pd.Series([0.1] * 400), {"tomorrow": 1}, 10_000, 500, g)
    assert not out["ok"] and out["message"] == INSUFFICIENT == "Insufficient evidence for a reliable estimate."
    assert "horizons" not in out
    # validation for ANOTHER version does not count; too small a sample does not count
    v = {"passed": True, "strategy_version": "donchian_trend-1.0.0"}
    assert not evidence_gate(v, "trend_pullback-1.0.0", 500, 400).ok
    v2 = {"passed": True, "strategy_version": "trend_pullback-1.0.0"}
    assert not evidence_gate(v2, "trend_pullback-1.0.0", 60, 400).ok
    assert not evidence_gate(v2, "trend_pullback-1.0.0", 500, 50).ok
    assert evidence_gate(v2, "trend_pullback-1.0.0", 500, 400).ok


def test_forecast_ranges_with_evidence():
    rng = np.random.default_rng(1)
    x = rng.normal(0.03, 0.4, 300)
    x[rng.random(300) < 0.3] = 0.0  # no-trade days are part of the sample
    v = {"passed": True, "strategy_version": "s-1"}
    g = evidence_gate(v, "s-1", 400, 300)
    out = forecast(pd.Series(x), {"tomorrow": 1, "rest_of_week": 4, "rest_of_month": 20}, 10_000, 400, g)
    assert out["ok"] and out["kind"] == "forecast"
    for h in out["horizons"].values():
        assert h["downside"] <= h["central"] <= h["upside"]
        assert 0 < h["p_loss"] < 1
    assert out["horizons"]["tomorrow"]["p_no_trades"] == pytest.approx(0.3, abs=0.05)
    assert any("losses are possible" in a for a in out["assumptions"])


def test_block_bootstrap_keeps_serial_dependence():
    rng = np.random.default_rng(0)
    e = rng.normal(0, 1, 2000)
    x = np.empty_like(e)
    x[0] = e[0]
    for i in range(1, len(e)):
        x[i] = 0.7 * x[i - 1] + e[i]  # strongly autocorrelated daily results
    iid = block_bootstrap_sums(x, 20, 4000, block=1, seed=1).std()
    blk = block_bootstrap_sums(x, 20, 4000, block=20, seed=1).std()
    assert blk > 1.5 * iid  # i.i.d. resampling would understate multi-day risk


def test_daily_returns_include_days_without_trades():
    rows = [trade(1, "2026-10-19T15:00:00+00:00", 10.0), trade(2, "2026-10-22T15:00:00+00:00", -20.0)]
    eq = [{"ts": f"2026-10-{d}T01:00:00+00:00", "equity": 1000.0} for d in (19, 20, 21, 22)]
    s = daily_returns_pct(rows, eq, "UTC", 0)
    assert list(s.round(3)) == [1.0, 0.0, 0.0, -2.0]


def test_scenario_arithmetic_and_honesty(tmp_path):
    assert required_capital(15, 0.25, 0.1, 2) == pytest.approx(30_000)
    assert required_capital(15, 0.25, -0.05, 2) is None
    st = daily_stats(10_000, 0.25, 0.1, 4, r_sd=1.2)
    assert st["mean"] == pytest.approx(10.0) and st["sd"] == pytest.approx(60.0)
    d = tmp_path / "exp" / "dev-x-1"
    d.mkdir(parents=True)
    (d / "result.json").write_text(json.dumps({"id": "dev-x-1", "stage": "dev", "strategy": "x-1", "passed": False,
                                               "stats": {"expectancy_r": -0.04, "trades": 800},
                                               "yearly": {str(y): 0 for y in range(2007, 2015)}}))
    ev = observed_evidence(tmp_path / "exp")
    assert ev["best_expectancy_r"] == -0.04 and not ev["any_passed"]
    a = assess_target(5_000, "USD", (15.0, 230.0), 0.25, 0.25, 2.0, ev, (0.1,), (1, 20))
    assert a["kind"] == "scenario" and "not a forecast" in a["label"]
    text = " ".join(a["conclusions"])
    assert "LOSS" in text and "not an option" in text and "0.30%-4.60%" in text
    row1 = [r for r in a["grid"] if r["trades_per_day"] == 1][0]
    assert row1["risk_pct_needed_for_target_low"] == pytest.approx(3.0) and row1["within_risk_limit"] is False
    # no capital: still useful (capital needed per case), and says so
    b = assess_target(None, "USD", (15.0, 230.0), 0.25, 0.25, 2.0, ev, (0.1,), (2,))
    assert b["grid"][0]["capital_for_target_low"] == 30_000 and "mean_per_day" not in b["grid"][0]


def test_dashboard_reports_are_labelled(tmp_path):
    from fastapi.testclient import TestClient
    from fxai.config import AppConfig
    from fxai.dashboard.app import create_app
    from fxai.dashboard.auth import hash_password
    from fxai.storage import Storage
    from tests.test_dashboard import PW, SECRET, login
    cfg = AppConfig.model_validate({"bridge": {"root": str(tmp_path / "FXAI"), "account": "900001"},
                                    "reporting": {"aspirational_daily_target": [15, 230],
                                                  "experiments_dir": str(tmp_path / "none"),
                                                  "validation_status_path": str(tmp_path / "vs.json")}})
    st = Storage(tmp_path / "db.sqlite")
    st.write_status({"service": {"mode": "demo"}, "block_reasons": [],
                     "account": {"equity": 10_000, "balance": 10_000, "currency": "USD", "server_offset_s": 7200},
                     "pnl": {"day_start_equity": 10_000, "net_flows": 0}, "limits": {"max_daily_loss_pct": 2.0},
                     "exposure": {"open_risk": 25.0}})
    c = TestClient(create_app(cfg, st, password_hash=hash_password(PW), secret_key=SECRET))
    assert c.get("/api/watchlist.csv").status_code == 401 and c.get("/api/report.json").status_code == 401
    login(c)
    rep = c.get("/api/status").json()["reports"]
    assert rep["performance"]["kind"] == "actual" and rep["drawdown"]["kind"] == "actual"
    assert rep["forecast"]["kind"] == "forecast" and rep["forecast"]["message"] == INSUFFICIENT
    assert rep["scenario"]["kind"] == "scenario" and rep["scenario"]["target"] == [15.0, 230.0]
    assert rep["research"]["kind"] == "simulated"
    assert rep["allowance"]["remaining_if_all_stops_hit"] == 175.0
    assert c.get("/api/watchlist.csv").text.startswith("id,symbol")
    assert json.loads(c.get("/api/report.json").text)["reports"]["forecast"]["ok"] is False
