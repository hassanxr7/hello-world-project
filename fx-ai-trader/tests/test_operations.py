"""Operations layer: candlestick patterns (causal, in context), watchlist lifecycle,
pair assessment / attention ranking, and the service's once-a-minute scan."""

from __future__ import annotations

from datetime import timedelta

import numpy as np
import pandas as pd
import pytest

from fxai.analysis.bars import resample
from fxai.analysis.candles import PATTERNS, candle_frame, read_latest
from fxai.analysis.scanner import assess_pair, rank
from fxai.execution.watchlist import Watchlist
from fxai.storage import Storage
from fxai.strategy import TrendPullbackStrategy
from fxai.strategy.base import Setup
from tests.test_pipeline import first_signal_time, make
from tests.test_strategy import synthetic_m1


def bars_from(ohlc: list[tuple[float, float, float, float]], start="2024-01-02 00:00") -> pd.DataFrame:
    idx = pd.date_range(start, periods=len(ohlc), freq="1h", tz="UTC")
    df = pd.DataFrame(ohlc, columns=["open", "high", "low", "close"], index=idx)
    df["close_time"] = idx + pd.Timedelta(hours=1)
    return df


def flat(n: int, px: float = 1.1000, w: float = 0.0010) -> list[tuple[float, float, float, float]]:
    rng = np.random.default_rng(0)
    out = []
    for _ in range(n):
        o = px + rng.normal(0, 0.0002)
        c = o + rng.normal(0, 0.0003)
        out.append((o, max(o, c) + w / 2, min(o, c) - w / 2, c))
    return out


# --------------------------------------------------------------------------- candles
@pytest.mark.parametrize("last,pattern", [
    ([(1.1010, 1.1012, 1.0995, 1.0998), (1.0996, 1.1020, 1.0994, 1.1015)], "engulf_bull"),
    ([(1.1000, 1.1004, 1.0970, 1.1002)], "pin_bull"),
    ([(1.1000, 1.1030, 1.0998, 1.0999)], "pin_bear"),
    ([(1.0990, 1.1030, 1.0970, 1.1000), (1.0998, 1.1010, 1.0985, 1.1004)], "inside"),
    ([(1.1000, 1.1015, 1.0985, 1.10002)], "doji"),
    ([(1.1000, 1.1031, 1.0999, 1.1030)], "strong_bull"),
    ([(1.1030, 1.1032, 1.1005, 1.1008), (1.1007, 1.1010, 1.1002, 1.1006), (1.1006, 1.1030, 1.1005, 1.1028)],
     "morning_star"),
])
def test_patterns_detected(last, pattern):
    f = candle_frame(bars_from(flat(40) + last))
    assert bool(f[pattern].iloc[-1]), (pattern, f[PATTERNS].iloc[-1].to_dict())


def test_candles_are_causal():
    m1 = synthetic_m1(n_days=20, seed=5)
    b = resample(m1, "H1")
    full = candle_frame(b)
    for k in (60, 150, 300, len(b) - 1):
        part = candle_frame(b.iloc[: k + 1])
        assert (part[PATTERNS].iloc[-1] == full[PATTERNS].iloc[k]).all()


def test_pattern_context_notes():
    # a decline into a swing low, then a bullish pin bar back at that low, in an H4 up-trend
    seq = flat(30, 1.1050)
    seq += [(1.1050 - i * 0.0005, 1.1052 - i * 0.0005, 1.1040 - i * 0.0005, 1.1045 - i * 0.0005) for i in range(8)]
    seq += [(1.1012, 1.1020, 1.1005, 1.1018), (1.1018, 1.1025, 1.1015, 1.1022), (1.1022, 1.1028, 1.1018, 1.1020),
            (1.1020, 1.1022, 1.1012, 1.1015)]
    seq += [(1.1014, 1.1017, 1.0990, 1.1016)]  # pin bar probing just below the swing low at 1.1005
    r = read_latest(bars_from(seq), trend="TREND_UP")
    assert "pin_bull" in r.patterns and r.direction == 1
    text = " ".join(r.notes)
    assert "with the higher-timeframe trend" in text
    assert "no execution authority" in r.notes[-1]


# --------------------------------------------------------------------------- watchlist
T = pd.Timestamp("2026-10-20 10:00", tz="UTC")


def setup(side=1, created=T, ttl_h=3, inv=1.0950, stage=0.8, strat="trend_pullback-1.0.0") -> Setup:
    return Setup("EURUSD", strat, side, stage, created, created + pd.Timedelta(hours=ttl_h), 1.1010, inv,
                 {"regime": True, "trigger": False}, ["evidence"])


def test_watchlist_lifecycle(tmp_path):
    st = Storage(tmp_path / "w.sqlite")
    wl = Watchlist(st)
    v = "trend_pullback-1.0.0"
    wl.refresh("EURUSD", v, [setup()], T.to_pydatetime(), 1.1000, T)
    a = st.watch_active("EURUSD")
    assert len(a) == 1 and a[0]["status"] == "active" and a[0]["confirmations"] == 1
    # re-confirmed by the next bar: refreshed (one row), expiry extended
    t2 = T + pd.Timedelta(hours=1)
    wl.refresh("EURUSD", v, [setup(created=t2, stage=0.9)], t2.to_pydatetime(), 1.1001, t2)
    a = st.watch_active("EURUSD")
    assert len(a) == 1 and a[0]["confirmations"] == 2 and a[0]["stage"] == 0.9
    assert pd.Timestamp(a[0]["expires"]) == t2 + pd.Timedelta(hours=3)
    # same bar seen again on the next scan: no extra confirmation
    wl.refresh("EURUSD", v, [setup(created=t2, stage=0.9)], (t2 + pd.Timedelta(minutes=1)).to_pydatetime(), 1.1001, t2)
    assert st.watch_active("EURUSD")[0]["confirmations"] == 2
    # price crosses the invalidation level -> invalidated
    notes = wl.refresh("EURUSD", v, [], (t2 + pd.Timedelta(minutes=2)).to_pydatetime(), 1.0949, t2)
    assert not st.watch_active("EURUSD") and "invalidation" in notes[0]
    # a new setup that is never re-confirmed expires
    t3 = T + pd.Timedelta(hours=5)
    wl.refresh("EURUSD", v, [setup(created=t3, ttl_h=1)], t3.to_pydatetime(), 1.1000, t3)
    notes = wl.refresh("EURUSD", v, [], (t3 + pd.Timedelta(hours=1, minutes=1)).to_pydatetime(), 1.1000, t3)
    assert "not re-confirmed" in notes[0]
    # trigger: a signal on the same side closes the setup as triggered with the signal id
    t4 = T + pd.Timedelta(hours=8)
    wl.refresh("EURUSD", v, [setup(created=t4)], t4.to_pydatetime(), 1.1000, t4)
    t5 = t4 + pd.Timedelta(hours=1)
    wl.refresh("EURUSD", v, [], t5.to_pydatetime(), 1.1012, t5, signal=(1, "SIG-1"))
    rows = {r["status"] for r in st.watch_recent()}
    assert rows == {"invalidated", "expired", "triggered"}
    trig = [r for r in st.watch_recent() if r["status"] == "triggered"][0]
    assert trig["signal_id"] == "SIG-1"
    # conditions gone on a newer bar -> invalidated; a strategy change also invalidates
    t6 = t5 + pd.Timedelta(hours=1)
    wl.refresh("EURUSD", v, [setup(created=t6)], t6.to_pydatetime(), 1.1000, t6)
    t7 = t6 + pd.Timedelta(hours=1)
    notes = wl.refresh("EURUSD", v, [], t7.to_pydatetime(), 1.1000, t7)
    assert "conditions no longer met" in notes[0]
    wl.refresh("EURUSD", v, [setup(created=t7)], t7.to_pydatetime(), 1.1000, t7)
    notes = wl.refresh("EURUSD", "donchian_trend-1.0.0", [], t7.to_pydatetime(), 1.1000, t7)
    assert "strategy changed" in notes[0]
    # a setup already past its expiry when first seen (e.g. after downtime) is never listed
    wl.refresh("EURUSD", v, [setup(created=T, ttl_h=1)], (T + pd.Timedelta(hours=30)).to_pydatetime(), 1.1, T)
    assert not st.watch_active("EURUSD")


# --------------------------------------------------------------------------- scanner
@pytest.fixture(scope="module")
def frames():
    m1 = synthetic_m1(n_days=60, seed=11)
    s = TrendPullbackStrategy(entry_tf="M15", trend_tf="H1")
    e, t = resample(m1, "M15"), resample(m1, "H1")
    f = s.compute(e, t, "00:00-24:00")
    return e, f


def test_assess_pair_reports_every_dimension(frames):
    e, f = frames
    now = pd.Timestamp(e["close_time"].iloc[-1]) + pd.Timedelta(seconds=5)
    q = (1.1, 1.10008, now.to_pydatetime())
    v = assess_pair("EURUSD", now.to_pydatetime(), e, f, None, q, 0.00001, 25, True)
    assert v.status == "ok" and 0 <= v.score <= 100 and v.attention
    for k in ("alignment", "trend_tf_regime"):
        assert k in v.trend
    assert {"rsi14"} <= set(v.momentum) and "atr_percentile_250" in v.volatility
    assert "location" in v.structure and "notes" in v.candles and "points" in v.spread
    assert "no verified economic calendar" in v.events["note"]
    # wide spread and an existing position are penalised with reasons
    w = assess_pair("EURUSD", now.to_pydatetime(), e, f, None, (1.1, 1.1004, now.to_pydatetime()), 0.00001, 25,
                    True, holding=True)
    assert w.score < v.score and any("above the 25 pt limit" in r for r in w.attention)
    assert any("already holding" in r for r in w.attention)
    assert [x.symbol for x in rank([w, v])][0] == "EURUSD" and rank([w, v])[0] is v


def test_assess_pair_stale_and_closed(frames):
    e, f = frames
    late = pd.Timestamp(e["close_time"].iloc[-1]) + pd.Timedelta(hours=3)
    if late.weekday() >= 5:
        late += pd.Timedelta(days=7 - late.weekday())
    v = assess_pair("EURUSD", late.to_pydatetime(), e, f)
    assert v.status in ("stale", "market closed") and v.score == 0
    sat = pd.Timestamp("2026-10-24 12:00", tz="UTC")
    assert assess_pair("EURUSD", sat.to_pydatetime(), e, f).status == "market closed"
    assert assess_pair("EURUSD", late.to_pydatetime(), None, None).status in ("no data", "market closed")


# --------------------------------------------------------------------------- service integration
def test_service_scans_every_minute_and_publishes_watchlist(tmp_path):
    market = synthetic_m1(n_days=70, seed=11)
    market.attrs["price_basis"] = "mid"
    t_close, _ = first_signal_time(market)
    clock, broker, ea, svc, st = make(tmp_path, market, t_close - pd.Timedelta(seconds=58))  # weekday, bars fresh
    scans = []
    for _ in range(130):  # a bit over two minutes of 1-second steps
        ea.step(clock())
        svc.step()
        if svc.scan.get("at") and (not scans or scans[-1] != svc.scan["at"]):
            scans.append(svc.scan["at"])
        clock.advance(1)
        bid, ask, _ = broker.quotes["EURUSD"]
        broker.set_quote("EURUSD", bid, ask, clock())
    assert len(scans) >= 3  # at start, +60 s, +120 s
    status = st.read_status()
    pairs = status["scan"]["pairs"]
    assert pairs and pairs[0]["symbol"] == "EURUSD" and pairs[0]["status"] == "ok"
    assert "watchlist" in status and isinstance(status["watchlist"], list)
    assert status["service"]["decision_tf"] == "M15"


def test_simultaneous_signals_are_ranked(tmp_path):
    from fxai.domain import Action, Regime
    from fxai.strategy.base import StrategyOutput
    market = synthetic_m1(n_days=70, seed=11)
    market.attrs["price_basis"] = "mid"
    clock, broker, ea, svc, st = make(tmp_path, market, market.index[-1] - pd.Timedelta(days=3))
    ea.step(clock())
    svc.step()
    state = svc.state
    a = StrategyOutput("EURUSD", Action.BUY, None, None, Regime.TREND_UP, [], entry_ref=1.1, stop_loss=1.0990)
    b = StrategyOutput("EURUSD", Action.BUY, None, None, Regime.TREND_UP, [], entry_ref=1.1, stop_loss=1.0999)
    # same attention -> the one whose spread costs less per R comes first
    assert svc.rank_candidates(state, [b, a])[0] is a
