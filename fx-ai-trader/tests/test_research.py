"""Research tooling: per-signal simulation equals the portfolio engine's trade paths, the
random-entry null keeps the real exit structure (stop, target, deadline), and the test
has power (a look-ahead signal is detected) without false alarms on random signals."""

import numpy as np
import pandas as pd
import pytest

from fxai.backtest.costs import CostModel
from fxai.backtest.engine import PortfolioBacktest
from fxai.config import AppConfig
from fxai.research import permutation as perm
from tests.test_strategy import synthetic_m1


@pytest.fixture(scope="module")
def m1():
    a = synthetic_m1(n_days=420, seed=3)
    b = synthetic_m1(n_days=420, seed=4)
    b[["open", "high", "low", "close"]] *= 1.2  # a second, independent "GBPUSD"
    return {"EURUSD": a, "GBPUSD": b}


def make_bt(m1, name):
    bt = PortfolioBacktest(AppConfig.model_validate({"strategy": {"name": name}}), m1, CostModel())
    bt.prepare()
    return bt


@pytest.mark.parametrize("name", ["london_breakout", "range_reversion", "trend_pullback"])
def test_per_signal_simulation_matches_engine_paths(m1, name):
    bt = make_bt(m1, name)
    costs = CostModel()
    paths = bt.trade_paths(costs)
    per = perm.simulate_signals(bt, bt.signals, bt.exits, costs)
    assert len(per) == len(paths) > 0
    for r in per.itertuples(index=False):
        p = paths[r.key]
        assert r.reason == p.reason and r.r_gross == pytest.approx(p.r_gross)
    if name == "london_breakout":  # its fixed target and 16:00 deadline are really used
        assert {"tp", "time"} & set(per["reason"])


def test_random_entries_keep_target_and_deadline(m1, monkeypatch):
    bt = make_bt(m1, "london_breakout")
    costs = CostModel()
    bt.trade_paths(costs)
    sig = bt.signals
    captured = []
    real_sim = perm.simulate_signals

    def spy(bt_, s, exits, c):
        captured.append(s)
        return real_sim(bt_, s, exits, c)

    monkeypatch.setattr(perm, "simulate_signals", spy)
    perm.random_entry_test(bt, sig, bt.exits, costs, n_perm=2, seed=1)
    real, rand = captured[0], captured[1]
    assert len(rand) == len(real)
    stop_real = (real["ref_close"] - real["sl"]).abs().to_numpy()
    tp_r_real = ((real["tp"] - real["ref_close"]).abs().to_numpy() / stop_real)
    # random rows have no ref_close; their stop distance is |close - sl| where close = sl + side*dist
    for j in range(len(rand)):
        rr = rand.iloc[j]
        assert rr["side"] == real["side"].iloc[j]
        assert pd.Timestamp(rr["time"]).hour == pd.Timestamp(real["time"].iloc[j]).hour
        if np.isfinite(tp_r_real[j]):
            close = rr["sl"] + rr["side"] * abs(rr["sl"] - rr["tp"]) / (1 + tp_r_real[j])
            assert abs(rr["tp"] - close) / abs(close - rr["sl"]) == pytest.approx(tp_r_real[j], rel=1e-6)
        if pd.notna(real["deadline"].iloc[j]):
            assert rr["deadline"] - rr["time"] == real["deadline"].iloc[j] - real["time"].iloc[j]


def test_permutation_has_power_and_no_false_alarm(m1):
    bt = make_bt(m1, "trend_pullback")
    costs = CostModel()
    bt.trade_paths(costs)
    f = bt._frames["EURUSD"]
    ok = f["atr_e"].notna() & f["r_session"].astype(bool)
    cand = f[ok].iloc[::7].copy()
    fut = f["close"].shift(-6).reindex(cand.index)
    cand = cand[fut.notna()]
    fut = fut[fut.notna()]
    base = pd.DataFrame({"key": [f"x{i}" for i in range(len(cand))], "symbol": "EURUSD",
                         "time": cand["close_time"].to_numpy(), "ref_close": cand["close"].to_numpy(),
                         "atr_e": cand["atr_e"].to_numpy(), "regime": cand["tr_regime"].astype(str).to_numpy()})
    # Look-ahead "oracle": side = direction of the next 6 bars. Must be detected (p ~ 0).
    side = np.where(fut.to_numpy() > cand["close"].to_numpy(), 1, -1)
    oracle = base.assign(side=side, sl=base["ref_close"] - side * 1.5 * base["atr_e"]).iloc[:150]
    r = perm.random_entry_test(bt, oracle, bt.exits, costs, n_perm=30, seed=2)
    assert r.real_mean_r > 0.2 and r.p_value == 0.0
    # Coin-flip side: should not look significant.
    rng = np.random.default_rng(5)
    side = rng.choice([-1, 1], len(base))
    coin = base.assign(side=side, sl=base["ref_close"] - side * 1.5 * base["atr_e"]).iloc[:150]
    r2 = perm.random_entry_test(bt, coin, bt.exits, costs, n_perm=30, seed=3)
    assert r2.p_value > 0.01


def test_experiment_runner_records_everything(m1, tmp_path, monkeypatch, capsys):
    from fxai.__main__ import main
    from fxai.research import experiments as ex
    t0, t1 = m1["EURUSD"].index[0], m1["EURUSD"].index[-1]
    monkeypatch.setitem(ex.STAGES, "dev", (t0 + pd.Timedelta(days=250), t1))
    r = ex.run_experiment("london_breakout", m1, "dev", out_root=tmp_path, n_perm=5, label="london_breakout")
    d = tmp_path / r.id
    for f in ("result.json", "config.json", "trades.csv", "per_signal.csv"):
        assert (d / f).is_file()
    assert "london_breakout" in (tmp_path / "INDEX.md").read_text()
    assert {g.name for g in r.gates} >= {"permutation_p_bonferroni", "adverse_costs_positive", "max_drawdown"}
    got = ex.latest_result(tmp_path, "london_breakout", "dev")
    assert got["id"] == r.id and "code" in __import__("json").loads((d / "config.json").read_text())
    # later stages are refused for candidates without a passing development run (no data is even loaded)
    main(["experiment", "--data-root", str(tmp_path / "nowhere"), "--stage", "validation", "--out", str(tmp_path)])
    out = capsys.readouterr().out
    assert "refused" in out and "nothing to run" in out


def test_plan_v2_is_the_declared_set():
    from fxai.research.experiments import K_CANDIDATES, PLAN_V2
    from fxai.strategy.registry import REGISTRY
    assert len(PLAN_V2) == K_CANDIDATES == 6
    assert {n for _, n, _ in PLAN_V2} == set(REGISTRY)
