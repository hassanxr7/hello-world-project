from datetime import timedelta

import pytest

from fxai.config import AppConfig
from fxai.domain import Position, Side, TradeIntent
from fxai.risk import EALimits, EffectiveLimits, RiskEngine, RiskState, daily_loss_pct
from tests.conftest import NOW, account, make_ctx, quote


def intent(symbol="EURUSD", side=Side.BUY, entry=1.10008, sl=1.09808, tp=1.10408, sid="S1"):
    return TradeIntent(signal_id=sid, symbol=symbol, side=side, entry_price=entry, stop_loss=sl, take_profit=tp,
                       strategy="t", strategy_version="v1", bar_time_utc=NOW, created_utc=NOW)


def pos(ticket, symbol="EURUSD", side=Side.BUY, vol=0.1, op=1.1, sl=1.098, system=True):
    return Position(ticket=ticket, symbol=symbol, side=side, volume=vol, open_price=op,
                    open_time_utc=NOW - timedelta(hours=1), sl=sl, tp=0.0, system_owned=system)


def failed(dec):
    return {c.name for c in dec.checks if not c.passed}


@pytest.fixture
def engine(cfg):
    return RiskEngine(cfg.risk)


def test_clean_approval(cfg, engine):
    d = engine.evaluate(intent(), make_ctx(cfg))
    assert d.approved, d.blocking_reasons
    assert d.volume == 0.11  # 25 USD / (200 + 5 slippage + 7 commission)
    assert d.planned_risk_pct <= 0.25


def test_every_check_recorded(cfg, engine):
    d = engine.evaluate(intent(), make_ctx(cfg))
    names = {c.name for c in d.checks}
    for n in ["emergency_stop", "daily_loss", "daily_entry_cap", "spread", "quote_fresh", "stop_loss_present",
              "position_size", "currency_exposure", "margin", "max_open_positions", "total_risk"]:
        assert n in names


def test_missing_stop_loss_rejected(cfg, engine):
    d = engine.evaluate(intent(sl=0.0), make_ctx(cfg))
    assert not d.approved and "stop_loss_present" in failed(d)


def test_wrong_side_stop_rejected(cfg, engine):
    d = engine.evaluate(intent(sl=1.1050), make_ctx(cfg))
    assert "stop_loss_present" in failed(d)


def test_emergency_stop_blocks(cfg, engine):
    st = RiskState(); st.roll_if_needed("d", 10_000); st.estop = True
    assert "emergency_stop" in failed(engine.evaluate(intent(), make_ctx(cfg, state=st)))
    # EA-side estop also blocks even if Python state is clear
    assert "emergency_stop" in failed(engine.evaluate(intent(), make_ctx(cfg, ea_estop=True)))


def test_daily_entry_cap(cfg, engine):
    st = RiskState(); st.roll_if_needed("d", 10_000); st.entries_today = 20
    assert "daily_entry_cap" in failed(engine.evaluate(intent(), make_ctx(cfg, state=st)))
    # EA count wins when higher
    st2 = RiskState(); st2.roll_if_needed("d", 10_000); st2.entries_today = 3
    assert "daily_entry_cap" in failed(engine.evaluate(intent(), make_ctx(cfg, state=st2, ea_entries_today=20)))


def test_failed_attempts_do_not_consume_entries(cfg, engine):
    st = RiskState(); st.roll_if_needed("d", 10_000)
    for _ in range(50):
        st.record_failed_attempt()
        st.record_modification()
        st.record_partial_close()
    assert st.entries_today == 0
    assert engine.evaluate(intent(), make_ctx(cfg, state=st)).approved


def test_daily_loss_blocks_and_counts_floating(cfg, engine):
    st = RiskState(); st.roll_if_needed("d", 10_000)
    # equity (incl. floating) fell 2.1%
    d = engine.evaluate(intent(), make_ctx(cfg, state=st, account=account(equity=9_790, balance=10_000)))
    assert "daily_loss" in failed(d)


def test_deposit_does_not_mask_loss():
    # start 10k, deposit 5k, then lose 300 -> equity 14.7k. Loss must be 3%, not a gain.
    assert daily_loss_pct(14_700, 10_000, 5_000) == pytest.approx(3.0)
    # withdrawal of 2k is not a loss
    assert daily_loss_pct(8_000, 10_000, -2_000) == 0.0


def test_daily_loss_headroom(cfg, engine):
    st = RiskState(); st.roll_if_needed("d", 10_000)
    # 1.9% down: headroom = 200 - 190 = 10 USD < 0.5 * 24.5 -> refused
    d = engine.evaluate(intent(), make_ctx(cfg, state=st, account=account(equity=9_810, balance=10_000)))
    assert "risk_budget" in failed(d)
    # 1.8% down: headroom 20 USD >= 50% of normal budget -> allowed, but sized to the headroom
    d = engine.evaluate(intent(), make_ctx(cfg, state=st, account=account(equity=9_820, balance=10_000)))
    assert d.approved and d.planned_risk_money <= 20.0 + 1e-9
    d = engine.evaluate(intent(), make_ctx(cfg, state=st, account=account(equity=9_810, balance=10_000)))
    assert "risk_budget" in failed(d)


def test_max_positions_and_one_per_symbol(cfg, engine):
    ps = [pos(1, "EURUSD"), pos(2, "GBPUSD", sl=1.298, op=1.3), pos(3, "AUDUSD", side=Side.SELL, op=0.7, sl=0.702)]
    d = engine.evaluate(intent(symbol="USDJPY", entry=150.010, sl=149.700, tp=150.6), make_ctx(cfg, positions=ps))
    assert "max_open_positions" in failed(d)
    d2 = engine.evaluate(intent(), make_ctx(cfg, positions=[pos(1, "EURUSD")]))
    assert "one_position_per_symbol" in failed(d2)
    d3 = engine.evaluate(intent(), make_ctx(cfg, inflight_symbols={"EURUSD"}))
    assert "one_position_per_symbol" in failed(d3)


def test_manual_positions_not_counted_as_system(cfg, engine):
    manual = pos(9, "EURUSD", system=False)
    d = engine.evaluate(intent(), make_ctx(cfg, positions=[manual]))
    assert "one_position_per_symbol" not in failed(d)


def test_unprotected_system_position_blocks(cfg, engine):
    d = engine.evaluate(intent(symbol="GBPUSD", entry=1.3001, sl=1.2981, tp=1.3041),
                        make_ctx(cfg, positions=[pos(1, "EURUSD", sl=0.0)]))
    assert "all_positions_protected" in failed(d)


def test_stale_quote(cfg, engine):
    q = {"EURUSD": quote(age_s=120)}
    d = engine.evaluate(intent(), make_ctx(cfg, quotes=q))
    assert "quote_fresh" in failed(d)


def test_spread_filters(cfg, engine):
    q = {"EURUSD": quote(bid=1.10000, ask=1.10040)}  # 40 points
    assert "spread" in failed(engine.evaluate(intent(entry=1.1004, sl=1.0984, tp=1.1044), make_ctx(cfg, quotes=q)))
    # tight stop: 8-point spread vs 40-point stop = 20% > 15%
    d = engine.evaluate(intent(sl=1.09968, tp=1.10100), make_ctx(cfg))
    assert "spread_to_stop" in failed(d)


def test_total_risk_downsizes_or_refuses(cfg, engine):
    # Short GBPUSD (long USD) so the currency check does not interfere with this test.
    # existing positions risking 0.9% -> remaining 0.1% = 10 USD < 50% of 25 -> refused
    ps = [pos(1, "GBPUSD", side=Side.SELL, op=1.3, sl=1.31, vol=0.09)]  # 0.01 * 100000 * 0.09 = 90 USD
    d = engine.evaluate(intent(), make_ctx(cfg, positions=ps))
    assert "risk_budget" in failed(d)
    # 0.8% open -> 20 USD remaining >= 12.5 -> allowed but down-sized
    ps = [pos(1, "GBPUSD", side=Side.SELL, op=1.3, sl=1.31, vol=0.08)]
    d = engine.evaluate(intent(), make_ctx(cfg, positions=ps))
    assert d.approved, d.blocking_reasons
    assert d.planned_risk_money <= 20.0 + 1e-9


def test_breakeven_position_has_zero_risk(cfg, engine):
    ps = [pos(1, "GBPUSD", op=1.3, sl=1.3001, vol=0.5)]  # SL beyond entry
    d = engine.evaluate(intent(), make_ctx(cfg, positions=ps))
    assert d.approved, d.blocking_reasons


def test_currency_exposure_blocks_stacked_usd_shorts(cfg, engine):
    # long EURUSD and long GBPUSD (each 0.25%) = USD -0.5%; adding long AUDUSD -> USD -0.75% > 0.5%
    ps = [pos(1, "EURUSD", vol=0.125, sl=1.098), pos(2, "GBPUSD", op=1.3, sl=1.298, vol=0.125)]
    d = engine.evaluate(intent(symbol="AUDUSD", entry=0.7001, sl=0.6981, tp=0.7041), make_ctx(cfg, positions=ps))
    assert "currency_exposure" in failed(d)
    # A trade that reduces USD exposure (short AUDUSD = long USD) is allowed
    d2 = engine.evaluate(intent(symbol="AUDUSD", side=Side.SELL, entry=0.7000, sl=0.7020, tp=0.6960),
                         make_ctx(cfg, positions=ps))
    assert "currency_exposure" not in failed(d2)


def test_correlation_limit(cfg, engine):
    corr = {("EURUSD", "GBPUSD"): 0.85, ("EURUSD", "AUDUSD"): 0.8}
    ps = [pos(1, "GBPUSD", op=1.3, sl=1.299, vol=0.01), pos(2, "AUDUSD", op=0.7, sl=0.699, vol=0.01)]
    d = engine.evaluate(intent(), make_ctx(cfg, positions=ps, correlations=corr))
    assert "correlation" in failed(d)


def test_margin_check(cfg, engine):
    d = engine.evaluate(intent(), make_ctx(cfg, account=account(equity=10_000, margin=2_950)))
    assert "margin" in failed(d)


def test_live_account_requires_explicit_enable(cfg, engine):
    d = engine.evaluate(intent(), make_ctx(cfg, account=account(is_demo=False)))
    assert "live_gate" in failed(d)
    d2 = engine.evaluate(intent(), make_ctx(cfg, account=account(is_demo=False), live_enabled=True))
    assert d2.approved


def test_cooldowns_and_loss_streak(cfg, engine):
    st = RiskState(); st.roll_if_needed("d", 10_000)
    st.record_entry("EURUSD", NOW - timedelta(minutes=10))
    assert "reentry_cooldown" in failed(engine.evaluate(intent(), make_ctx(cfg, state=st)))
    st = RiskState(); st.roll_if_needed("d", 10_000)
    for i in range(3):
        st.record_closed_trade(100 + i, "GBPUSD", -10.0, NOW - timedelta(minutes=5), 3, 240)
    assert "consecutive_loss_pause" in failed(engine.evaluate(intent(), make_ctx(cfg, state=st)))
    # same ticket is not counted twice
    st2 = RiskState(); st2.roll_if_needed("d", 10_000)
    for _ in range(5):
        st2.record_closed_trade(1, "GBPUSD", -10.0, NOW, 3, 240)
    assert st2.consecutive_losses == 1


def test_news_blackout(cfg, engine):
    d = engine.evaluate(intent(), make_ctx(cfg, news_block="USD high-impact event in 10 min"))
    assert "news_blackout" in failed(d)


def test_bridge_unhealthy_blocks(cfg, engine):
    d = engine.evaluate(intent(), make_ctx(cfg, bridge_healthy=False, bridge_detail="EA heartbeat stale"))
    assert "bridge_health" in failed(d)


def test_entry_deviation(cfg, engine):
    d = engine.evaluate(intent(entry=1.10100, sl=1.0990, tp=1.105), make_ctx(cfg))
    assert "entry_price_deviation" in failed(d)


def test_effective_limits_strictest_wins(cfg):
    lim = EffectiveLimits.combine(cfg.risk, cfg.hard_limits,
                                  overrides={"risk_per_trade_pct": 5.0, "max_entries_per_day": 10},
                                  ea=EALimits(0.2, 1.0, 2, 20, 2.0))
    assert lim.risk_per_trade_pct == 0.2  # override clamped to hard 0.5, then EA 0.2
    assert lim.max_entries_per_day == 10
    assert lim.max_open_positions == 2


def test_config_rejects_unsafe_values():
    with pytest.raises(Exception):
        AppConfig.model_validate({"risk": {"max_entries_per_day": 25}})
    with pytest.raises(Exception):
        AppConfig.model_validate({"risk": {"risk_per_trade_pct": 0.8}})  # > hard limit 0.5
    with pytest.raises(Exception):
        AppConfig.model_validate({"symbols": {"enabled": ["XAUUSD"]}})  # unknown without explicit spec
    ok = AppConfig.model_validate({"symbols": {"enabled": ["XAUUSD"], "custom": {
        "XAUUSD": {"base": "XAU", "quote": "USD", "digits": 2, "max_spread_points": 50}}}})
    assert "XAUUSD" in ok.symbols.resolve()


def test_live_requires_both_flags():
    assert not AppConfig.model_validate({"mode": "live"}).live_enabled
    assert not AppConfig.model_validate({"live_trading_acknowledged": True}).live_enabled
    assert AppConfig.model_validate({"mode": "live", "live_trading_acknowledged": True}).live_enabled
