"""Deterministic tests of the M1 fill simulator on hand-built price paths."""

import numpy as np
import pandas as pd
import pytest

from fxai.backtest.costs import CostModel
from fxai.backtest.fills import SymbolArrays, simulate_trade
from fxai.config import ExitConfig

PIP = 0.0001
PT = 0.00001


def arrays(ohlc: list[tuple[float, float, float, float]], spread_pips: float = 0.0, start="2024-01-02 10:00") -> SymbolArrays:
    idx = pd.date_range(start, periods=len(ohlc), freq="1min", tz="UTC")
    df = pd.DataFrame(ohlc, columns=["open", "high", "low", "close"], index=idx)
    costs = CostModel(spread_pips={"EURUSD": spread_pips}, slippage_entry_pips=0, slippage_stop_pips=0)
    a = SymbolArrays.from_m1("EURUSD", df, costs, PIP, PT)
    a.spread[:] = spread_pips * PIP  # flat spread, ignore hour multipliers
    return a


NO_COST = CostModel(slippage_entry_pips=0, slippage_stop_pips=0)
EX = ExitConfig(take_profit_r=2.0, breakeven_enabled=False, trailing_enabled=False, max_hold_hours=48)


def test_long_hits_tp():
    a = arrays([(1.1000, 1.1005, 1.0995, 1.1004), (1.1004, 1.1021, 1.1003, 1.1020)])
    p = simulate_trade(a, 0, +1, 1.0990, EX, NO_COST, atr_at_entry=0.001)
    assert p.reason == "tp" and p.exit == pytest.approx(1.1020) and p.r_gross == pytest.approx(2.0)


def test_long_hits_sl():
    a = arrays([(1.1000, 1.1002, 1.0995, 1.0996), (1.0996, 1.0997, 1.0989, 1.0990)])
    p = simulate_trade(a, 0, +1, 1.0990, EX, NO_COST, 0.001)
    assert p.reason == "sl" and p.r_gross == pytest.approx(-1.0)


def test_ambiguous_bar_assumes_stop_first():
    a = arrays([(1.1000, 1.1001, 1.0999, 1.1000), (1.1000, 1.1025, 1.0985, 1.1000)])
    p = simulate_trade(a, 0, +1, 1.0990, EX, NO_COST, 0.001)
    assert p.reason == "sl" and p.ambiguous_bars == 1 and p.r_gross == pytest.approx(-1.0)


def test_gap_through_stop_fills_at_open():
    a = arrays([(1.1000, 1.1001, 1.0999, 1.1000), (1.0980, 1.0985, 1.0975, 1.0980)])
    p = simulate_trade(a, 0, +1, 1.0990, EX, NO_COST, 0.001)
    assert p.reason == "sl_gap" and p.exit == pytest.approx(1.0980) and p.r_gross == pytest.approx(-2.0)


def test_short_uses_ask_and_spread():
    # 1 pip spread: short enters at bid = mid - 0.5 pip, exits at ask = mid + 0.5 pip
    a = arrays([(1.1000, 1.1001, 1.0999, 1.1000), (1.1000, 1.1001, 1.0950, 1.0960)], spread_pips=1.0)
    p = simulate_trade(a, 0, -1, 1.10095, EX, NO_COST, 0.001)
    assert p.entry == pytest.approx(1.09995)
    assert p.risk_dist == pytest.approx(0.0010)
    assert p.reason == "tp" and p.exit == pytest.approx(1.09995 - 0.0020)


def test_spread_alone_can_stop_out_long():
    # mid low 1.09905 never reaches 1.0990, but bid (mid - 1 pip) does
    a = arrays([(1.1000, 1.1001, 1.0999, 1.1000), (1.1000, 1.1000, 1.09905, 1.0995)], spread_pips=2.0)
    p = simulate_trade(a, 0, +1, 1.0990, EX, NO_COST, 0.001)
    assert p.reason == "sl"


def test_breakeven_moves_after_close_and_exits():
    ex = ExitConfig(take_profit_r=2.0, breakeven_enabled=True, breakeven_trigger_r=1.0, breakeven_offset_points=10,
                    trailing_enabled=False)
    a = arrays([(1.1000, 1.1001, 1.0999, 1.1000),
                (1.1000, 1.1011, 1.1000, 1.1008),  # +1.1R high -> BE armed at close
                (1.1008, 1.1009, 1.0995, 1.0996)])  # falls back through entry+1pip
    p = simulate_trade(a, 0, +1, 1.0990, ex, NO_COST, 0.001)
    assert p.reason == "breakeven" and p.exit == pytest.approx(1.1001)
    assert p.sl_at(int(a.t[2])) == pytest.approx(1.1001)


def test_trailing_never_widens():
    ex = ExitConfig(take_profit_r=5.0, breakeven_enabled=False, trailing_enabled=True, trailing_start_r=1.0,
                    trailing_atr_mult=1.0)
    bars = [(1.1000, 1.1001, 1.0999, 1.1000), (1.1000, 1.1015, 1.1000, 1.1014),
            (1.1014, 1.1014, 1.1010, 1.1011), (1.1011, 1.1030, 1.1010, 1.1029), (1.1029, 1.1029, 1.1010, 1.1012)]
    p = simulate_trade(arrays(bars), 0, +1, 1.0990, ex, NO_COST, atr_at_entry=0.0005)
    sls = [v for _, v in p.sl_changes]
    assert sls == sorted(sls)  # monotonic for a long
    assert p.reason == "trail" and p.exit == pytest.approx(1.1024)


def test_time_stop():
    ex = ExitConfig(take_profit_r=10.0, breakeven_enabled=False, max_hold_hours=1 / 60 * 3)
    bars = [(1.1, 1.1001, 1.0999, 1.1)] * 10
    p = simulate_trade(arrays(bars), 0, +1, 1.0990, ex, NO_COST, 0.001)
    assert p.reason == "time" and p.i_exit == 3


def test_slippage_is_adverse():
    costs = CostModel(slippage_entry_pips=0.2, slippage_stop_pips=0.5)
    a = arrays([(1.1000, 1.1002, 1.0995, 1.0996), (1.0996, 1.0997, 1.0989, 1.0990)])
    p = simulate_trade(a, 0, +1, 1.0990, EX, costs, 0.001)
    assert p.entry == pytest.approx(1.1000 + 0.2 * PIP)
    assert p.exit == pytest.approx(1.0990 - 0.5 * PIP)


def test_swap_counted_at_ny_rollover():
    # 21:58 UTC on a Wednesday in January = 16:58 NY; rollover at 22:00 UTC (17:00 NY) is triple
    bars = [(1.1, 1.1001, 1.0999, 1.1)] * 5
    a = arrays(bars, start="2024-01-03 21:58")
    assert a.rollover.tolist() == [0, 0, 3.0, 0, 0]
    ex = ExitConfig(take_profit_r=10.0, breakeven_enabled=False, max_hold_hours=1 / 60 * 4)
    p = simulate_trade(a, 0, +1, 1.0990, ex, NO_COST, 0.001)
    assert p.swap_nights == 3.0
