import pytest

from fxai.risk.sizing import floor_to_step, loss_per_lot, size_position
from tests.conftest import eurusd_spec, usdjpy_spec


@pytest.mark.parametrize("x,step,expected", [
    (0.129999, 0.01, 0.12),
    (0.13, 0.01, 0.13),
    (0.3, 0.1, 0.3),  # 0.3/0.1 = 2.9999999999999996 in binary float
    (1.0, 0.01, 1.0),
    (0.0099, 0.01, 0.0),
    (2.57, 0.05, 2.55),
    (7.0, 1.0, 7.0),
    (-1.0, 0.01, 0.0),
])
def test_floor_to_step(x, step, expected):
    assert floor_to_step(x, step) == expected


def test_eurusd_quarter_percent_risk():
    spec = eurusd_spec()
    # 10k equity * 0.25% = 25 USD; stop 20 pips (0.0020) -> 200 USD/lot -> 0.125 -> 0.12 lots
    r = size_position(spec, 1.10000, 1.09800, 25.0)
    assert r.ok and r.volume == 0.12
    assert r.risk_money == pytest.approx(24.0)
    assert r.risk_money <= 25.0


def test_commission_and_slippage_reduce_size():
    spec = eurusd_spec()
    lpl = loss_per_lot(spec, 1.10000, 1.09800, commission_per_lot_rt=7.0, slippage_points=5)
    assert lpl == pytest.approx(200 + 5 + 7)
    r = size_position(spec, 1.10000, 1.09800, 25.0, commission_per_lot_rt=7.0, slippage_points=5)
    assert r.volume == 0.11
    assert r.risk_money <= 25.0


def test_jpy_pair_uses_broker_tick_value():
    spec = usdjpy_spec(price=150.0)  # 0.6667 USD per 0.001 tick per lot
    # 30 pip stop = 0.30 JPY -> 300 ticks * 0.6667 = 200 USD per lot
    r = size_position(spec, 150.000, 149.700, 25.0)
    assert r.ok and r.volume == 0.12


def test_min_lot_exceeding_budget_skips_trade():
    spec = eurusd_spec(min_lot=0.1)
    # budget 10 USD, 50 pip stop = 500 USD/lot -> 0.02 lots < min 0.1 -> skip, never round up
    r = size_position(spec, 1.10000, 1.09500, 10.0)
    assert not r.ok
    assert "minimum lot" in r.reason


def test_max_lot_clamp():
    spec = eurusd_spec(max_lot=0.5)
    r = size_position(spec, 1.10000, 1.09990, 10_000.0)
    assert r.ok and r.volume == 0.5


def test_config_max_lot_clamp():
    r = size_position(eurusd_spec(), 1.10000, 1.09990, 10_000.0, max_lot_cfg=1.234)
    assert r.volume == 1.23


@pytest.mark.parametrize("kw,reason", [
    (dict(tick_value=0.0), "tick value"),
    (dict(lot_step=0.0), "lot step"),
])
def test_missing_broker_data_refuses(kw, reason):
    r = size_position(eurusd_spec(**kw), 1.1, 1.09, 25.0)
    assert not r.ok and reason in r.reason


def test_zero_distance_refused():
    assert not size_position(eurusd_spec(), 1.1, 1.1, 25.0).ok


def test_no_budget_refused():
    assert not size_position(eurusd_spec(), 1.1, 1.09, 0.0).ok
