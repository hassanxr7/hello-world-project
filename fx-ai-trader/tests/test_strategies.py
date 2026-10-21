"""Every registered strategy: causality (no look-ahead), valid stops/targets, explanations,
watchlist setups; plus the fast fill simulator against the bar-by-bar reference."""

import numpy as np
import pandas as pd
import pytest

from fxai.analysis.bars import resample
from fxai.backtest.costs import CostModel
from fxai.backtest.fills import SymbolArrays, simulate_trade, simulate_trade_fast
from fxai.config import AppConfig, ExitConfig
from fxai.domain import Action
from fxai.strategy.base import REQUIRED_COLUMNS
from fxai.strategy.registry import REGISTRY, build_strategy
from tests.test_strategy import synthetic_m1


@pytest.fixture(scope="module")
def m1():
    return synthetic_m1(n_days=420, seed=3)  # D1-trend strategies need 200+ daily bars of warm-up


def bars(m1, strat):
    e, t = resample(m1, strat.entry_tf), resample(m1, strat.trend_tf)
    last = m1.index[-1] + pd.Timedelta(minutes=1)
    return e[e["close_time"] <= last], t[t["close_time"] <= last]


@pytest.mark.parametrize("name", list(REGISTRY))
def test_output_contract_and_stops(m1, name):
    strat = REGISTRY[name]()
    e, t = bars(m1, strat)
    f = strat.compute(e, t, "00:00-24:00")
    for c in REQUIRED_COLUMNS + strat.features:
        assert c in f.columns, c
    s = f[f["signal"] != 0]
    assert len(s) > 0, f"{name}: synthetic market produced no signal"
    longs, shorts = s[s["signal"] > 0], s[s["signal"] < 0]
    assert (longs["sl"] < longs["close"]).all() and (shorts["sl"] > shorts["close"]).all()
    if "tp" in f:
        tl, ts = longs.dropna(subset=["tp"]), shorts.dropna(subset=["tp"])
        assert (tl["tp"] > tl["close"]).all() and (ts["tp"] < ts["close"]).all()
    assert f["candidate_side"].isin([-1, 0, 1]).all()
    if "deadline" in f:
        d = pd.to_datetime(s["deadline"], utc=True)
        ok = d.notna()
        assert ok.all(), f"{name}: signal without deadline"
        ahead = d - s["close_time"]
        assert (ahead > pd.Timedelta(0)).all() and (ahead < pd.Timedelta(days=3)).all(), (name, ahead.describe())


@pytest.mark.parametrize("name", list(REGISTRY))
def test_no_lookahead(m1, name):
    strat = REGISTRY[name]()
    e, t = bars(m1, strat)
    full = strat.compute(e, t, "00:00-24:00")
    rng = np.random.default_rng(1)
    warm = max(strat.warmup_bars, 300)
    sig_rows = np.flatnonzero(full["signal"].to_numpy() != 0)
    cand_rows = np.flatnonzero(full["candidate_side"].to_numpy() != 0)
    cuts = np.unique(np.r_[rng.choice(np.arange(warm, len(e) - 1), 12, replace=False),
                           sig_rows[sig_rows > warm][:10], cand_rows[cand_rows > warm][:5]])
    cols = ["signal", "sl", "candidate_side", "tr_regime", "atr_e"] + [c for c in ("tp", "deadline", "invalidation") if c in full]
    for k in cuts:
        t_close = e["close_time"].iloc[k]
        part = strat.compute(e.iloc[: k + 1], t[t["close_time"] <= t_close], "00:00-24:00")
        a, b = part.iloc[-1], full.iloc[k]
        for c in cols:
            av, bv = a[c], b[c]
            if pd.isna(av) and pd.isna(bv):
                continue
            if isinstance(av, (float, np.floating)):
                assert av == pytest.approx(bv), (name, k, c, av, bv)
            else:
                assert av == bv, (name, k, c, av, bv)


@pytest.mark.parametrize("name", list(REGISTRY))
def test_decide_latest_and_explanations(m1, name):
    strat = REGISTRY[name]()
    e, t = bars(m1, strat)
    full = strat.compute(e, t, "00:00-24:00")
    k = int(np.flatnonzero(full["signal"].to_numpy() != 0)[-1])
    tc = e["close_time"].iloc[k]
    out = strat.decide_latest("EURUSD", e.iloc[: k + 1], t[t["close_time"] <= tc], "00:00-24:00", tc.to_pydatetime())
    assert out.action in (Action.BUY, Action.SELL)
    assert out.stop_loss is not None and out.reasons and out.invalidation
    assert any(("BUY" in r or "SELL" in r) for r in out.reasons)
    # WAIT bar explains itself too
    j = int(np.flatnonzero(full["signal"].to_numpy() == 0)[-1])
    tj = e["close_time"].iloc[j]
    w = strat.decide_latest("EURUSD", e.iloc[: j + 1], t[t["close_time"] <= tj], "00:00-24:00", tj.to_pydatetime())
    assert w.action is Action.WAIT and any("WAIT" in r for r in w.reasons)


@pytest.mark.parametrize("name", list(REGISTRY))
def test_setups_have_expiry_and_conditions(m1, name):
    strat = REGISTRY[name]()
    e, t = bars(m1, strat)
    full = strat.compute(e, t, "00:00-24:00")
    rows = np.flatnonzero(full["candidate_side"].to_numpy() != 0)
    if not len(rows):
        pytest.skip("no setup in synthetic data")
    k = int(rows[-1])
    sub = full.iloc[: k + 1]
    setups = strat.setups(sub, "EURUSD")
    assert setups, name
    s = setups[0]
    assert s.expires > s.created and 0 <= s.stage <= 1 and s.conditions and s.evidence
    assert s.side in (-1, 1)


def test_registry_and_config_build():
    cfg = AppConfig.model_validate({"strategy": {"name": "donchian_trend"}})
    s = build_strategy(cfg)
    assert s.entry_tf == "H4" and s.trend_tf == "D1" and s.exits.trailing_enabled
    cfg2 = AppConfig.model_validate({"strategy": {"name": "range_reversion"}, "exits": {"max_hold_hours": 12}})
    assert build_strategy(cfg2).exits.max_hold_hours == 12
    with pytest.raises(Exception):
        AppConfig.model_validate({"strategy": {"name": "no_such_strategy"}})
    with pytest.raises(Exception):
        AppConfig.model_validate({"strategy": {"name": "donchian_trend", "params": {"bogus": 1}}})


# ------------------------------------------------------------------ fast simulator == reference
def random_arrays(seed: int, n: int = 3000) -> SymbolArrays:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2024-01-02 09:00", periods=n, freq="1min", tz="UTC")
    ret = rng.normal(0, 0.00015, n)
    close = 1.1 * np.exp(np.cumsum(ret))
    open_ = np.r_[close[0], close[:-1]]
    w = np.abs(rng.normal(0, 0.0001, n))
    df = pd.DataFrame({"open": open_, "high": np.maximum(open_, close) + w, "low": np.minimum(open_, close) - w,
                       "close": close}, index=idx)
    df.attrs["price_basis"] = "mid"
    return SymbolArrays.from_m1("EURUSD", df, CostModel(), 0.0001, 0.00001)


EXITS = [
    ExitConfig(take_profit_r=2.0, breakeven_enabled=True, breakeven_trigger_r=1.0, breakeven_offset_points=10, max_hold_hours=12),
    ExitConfig(take_profit_r=20.0, breakeven_enabled=False, trailing_enabled=True, trailing_start_r=0.0, trailing_atr_mult=2.0, max_hold_hours=30),
    ExitConfig(take_profit_r=1.0, breakeven_enabled=False, max_hold_hours=3),
    ExitConfig(take_profit_r=3.0, breakeven_enabled=True, breakeven_trigger_r=0.5, breakeven_offset_points=25,
               trailing_enabled=True, trailing_start_r=1.0, trailing_atr_mult=1.0, max_hold_hours=48),
]


@pytest.mark.parametrize("seed", range(6))
def test_fast_simulator_matches_reference(seed):
    a = random_arrays(seed)
    rng = np.random.default_rng(100 + seed)
    costs = CostModel()
    n_checked = 0
    for ex in EXITS:
        for _ in range(25):
            i0 = int(rng.integers(0, 2000))
            side = int(rng.choice([-1, 1]))
            atr_e = float(rng.uniform(0.0005, 0.002))
            px = a.c[i0]
            sl = px - side * rng.uniform(0.5, 2.5) * atr_e
            tp_price = (px + side * rng.uniform(0.5, 3.0) * atr_e) if rng.random() < 0.3 else None
            deadline = int(a.t[min(i0 + int(rng.integers(30, 600)), len(a.t) - 1)]) if rng.random() < 0.3 else None
            slow = simulate_trade(a, i0, side, sl, ex, costs, atr_e, tp_price=tp_price, deadline_ns=deadline)
            fast = simulate_trade_fast(a, i0, side, sl, ex, costs, atr_e, tp_price=tp_price, deadline_ns=deadline)
            assert (slow is None) == (fast is None)
            if slow is None:
                continue
            n_checked += 1
            assert fast.i_exit == slow.i_exit and fast.reason == slow.reason, (seed, ex, fast.reason, slow.reason)
            assert fast.exit == pytest.approx(slow.exit, abs=1e-12)
            assert fast.entry == pytest.approx(slow.entry) and fast.tp == pytest.approx(slow.tp)
            assert fast.mfe_r == pytest.approx(slow.mfe_r) and fast.mae_r == pytest.approx(slow.mae_r)
            assert fast.swap_nights == pytest.approx(slow.swap_nights)
            assert fast.ambiguous_bars == slow.ambiguous_bars
            assert np.allclose(fast.mtm, slow.mtm)
            assert fast.be_time == slow.be_time
            assert [round(v, 10) for _, v in fast.sl_changes] == [round(v, 10) for _, v in slow.sl_changes]
    assert n_checked > 50
