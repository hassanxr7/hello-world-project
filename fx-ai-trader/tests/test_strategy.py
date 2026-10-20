import numpy as np
import pandas as pd
import pytest

from fxai.analysis.bars import align_higher, resample, validate_bars
from fxai.analysis.indicators import atr, rsi
from fxai.analysis.structure import find_swings, nearest_levels
from fxai.config import AppConfig
from fxai.domain import Action
from fxai.strategy import TrendPullbackStrategy


def synthetic_m1(n_days=60, seed=7, drift=0.0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2024-01-01", periods=n_days * 1440, freq="1min", tz="UTC")
    idx = idx[idx.weekday < 5]
    regime = np.sin(np.arange(len(idx)) / 6000.0)  # slow alternating trends
    ret = rng.normal(0, 0.00012, len(idx)) + drift + regime * 0.00002
    close = 1.10 * np.exp(np.cumsum(ret))
    open_ = np.r_[close[0], close[:-1]]
    spread = np.abs(rng.normal(0, 0.00008, len(idx)))
    high = np.maximum(open_, close) + spread
    low = np.minimum(open_, close) - spread
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": 1.0},
                        index=pd.DatetimeIndex(idx, name="open_time"))


@pytest.fixture(scope="module")
def bars():
    m1 = synthetic_m1()
    return resample(m1, "M15"), resample(m1, "H1")


@pytest.fixture(scope="module")
def strat():
    cfg = AppConfig()
    return TrendPullbackStrategy()


def test_indicators_basic():
    df = pd.DataFrame({"high": [2.0] * 50, "low": [1.0] * 50, "close": [1.5] * 50})
    assert atr(df, 14).iloc[-1] == pytest.approx(1.0)
    up = pd.Series(np.arange(1, 60, dtype=float))
    assert rsi(up, 14).iloc[-1] == pytest.approx(100.0)
    assert rsi(-up, 14).iloc[-1] == pytest.approx(0.0)


def test_resample_and_alignment_is_causal(bars):
    m15, h1 = bars
    assert (m15["close_time"] - m15.index == pd.Timedelta(minutes=15)).all()
    al = align_higher(m15[["close", "close_time"]], h1, ["close"], "h1_")
    # every attached H1 bar closed at or before the M15 close
    ok = al["h1_close_time"].isna() | (al["h1_close_time"] <= al["close_time"])
    assert ok.all()
    assert not validate_bars(m15)


def test_swings_are_confirmed_late(bars):
    _, h1 = bars
    sw = find_swings(h1, 3)
    assert len(sw) > 10
    # confirmation is exactly n bars after the swing bar closes
    first = sw.iloc[0]
    pos = h1.index.get_loc(first["bar_time"])
    assert first["confirmed_at"] == h1["close_time"].iloc[pos + 3]
    res, sup = nearest_levels(sw, first["bar_time"], 1.0, pd.Timedelta(days=30))
    assert res is None and sup is None  # nothing is confirmed at the swing's own bar


def test_no_lookahead(bars, strat):
    """Signals computed on truncated history must equal those computed on the full history."""
    m15, h1 = bars
    full = strat.compute(m15, h1, "00:00-24:00")
    rng = np.random.default_rng(1)
    cut_points = rng.choice(np.arange(3000, len(m15) - 1), 25, replace=False)
    sig_rows = np.flatnonzero(full["candidate_side"].to_numpy() != 0)
    cut_points = np.r_[cut_points, sig_rows[(sig_rows > 3000)][:15]]
    cols = ["signal", "sl", "candidate_side", "tr_regime", "room_r", "rsi", "atr_e"]
    for k in cut_points:
        t_close = m15["close_time"].iloc[k]
        part = strat.compute(m15.iloc[: k + 1], h1[h1["close_time"] <= t_close], "00:00-24:00")
        a, b = part.iloc[-1][cols], full.iloc[k][cols]
        for c in cols:
            if pd.isna(a[c]) and pd.isna(b[c]):
                continue
            assert a[c] == pytest.approx(b[c]) if isinstance(a[c], float) else a[c] == b[c], (k, c, a[c], b[c])


def test_signals_have_valid_stops(bars, strat):
    m15, h1 = bars
    f = strat.compute(m15, h1, "00:00-24:00")
    s = f[f["signal"] != 0]
    assert len(s) > 0
    longs, shorts = s[s["signal"] > 0], s[s["signal"] < 0]
    assert (longs["sl"] < longs["close"]).all() and (shorts["sl"] > shorts["close"]).all()
    p = strat.p
    dist = (s["close"] - s["sl"]).abs() / s["atr_e"]
    assert (dist >= p.min_stop_atr - 1e-9).all() and (dist <= p.max_stop_atr + 1e-9).all()


def test_decide_latest_wait_when_stale(bars, strat):
    m15, h1 = bars
    late = m15["close_time"].iloc[-1] + pd.Timedelta(hours=3)
    out = strat.decide_latest("EURUSD", m15, h1, "00:00-24:00", late.to_pydatetime())
    assert out.action is Action.WAIT and "stale" in out.reasons[0]


def test_decide_latest_insufficient_history(strat, bars):
    m15, h1 = bars
    out = strat.decide_latest("EURUSD", m15.iloc[:30], h1.iloc[:30], "00:00-24:00",
                              m15["close_time"].iloc[29].to_pydatetime())
    assert out.action is Action.WAIT and "insufficient history" in out.reasons[0]


def test_decide_latest_explains(bars, strat):
    m15, h1 = bars
    f = strat.compute(m15, h1, "00:00-24:00")
    k = int(np.flatnonzero(f["signal"].to_numpy() != 0)[-1])
    t = m15["close_time"].iloc[k]
    out = strat.decide_latest("EURUSD", m15.iloc[: k + 1], h1[h1["close_time"] <= t], "00:00-24:00",
                              t.to_pydatetime())
    assert out.action in (Action.BUY, Action.SELL)
    assert out.stop_loss is not None and any("all conditions met" in r for r in out.reasons)
    assert set(out.features) >= {"adx_trend", "stop_atr", "room_r"}


def test_session_filter_blocks_outside_window(bars, strat):
    m15, h1 = bars
    f = strat.compute(m15, h1, "07:00-20:00")
    s = f[f["signal"] != 0]
    hours = pd.DatetimeIndex(s["close_time"]).hour
    assert ((hours >= 7) & (hours < 20)).all()
