"""End-to-end tests: TradingService + FileBridge + OrderManager + SQLite <-> files
<-> EAEmulator + SimBroker. Everything runs over a real temporary directory
using the production protocol code. (The MQL4 EA itself must be verified in
MT4 - see docs/VERIFICATION.md.)"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from fxai.bridge.ea_emulator import EAEmulator, EAInputs
from fxai.bridge.file_bridge import FileBridge
from fxai.bridge.protocol import order_comment
from fxai.config import AppConfig
from fxai.domain import CheckResult, RiskDecision, Side, TradeIntent
from fxai.execution.order_manager import OrderManager
from fxai.execution.sim_broker import ERR_TRADE_TIMEOUT, OP_BUY, SimBroker
from fxai.service import TradingService
from fxai.storage import Storage
from tests.conftest import eurusd_spec, gbpusd_spec

UTC = timezone.utc
T0 = datetime(2026, 10, 20, 10, 0, 5, tzinfo=UTC)  # Tuesday


class Clock:
    def __init__(self, t: datetime):
        self.t = t

    def __call__(self) -> datetime:
        return self.t

    def advance(self, s: float) -> None:
        self.t += timedelta(seconds=s)


class Harness:
    def __init__(self, tmp_path, ea: EAInputs | None = None, cfg: dict | None = None, broker_kw: dict | None = None):
        self.clock = Clock(T0)
        self.root = tmp_path / "FXAI" / "900001"
        self.broker = SimBroker(specs={"EURUSD": eurusd_spec(stop_level_points=10), "GBPUSD": gbpusd_spec()},
                                **(broker_kw or {}))
        self.set_quotes(1.10000, 1.30000)
        self.inp = ea or EAInputs(enable_trading=True, symbols=["EURUSD", "GBPUSD"], bars_timeframes=[])
        self.ea = EAEmulator(self.root, self.broker, self.inp)
        base = {"symbols": {"enabled": ["EURUSD", "GBPUSD"]},
                "bridge": {"root": str(self.root.parent), "account": "900001", "magic_number": self.inp.magic}}
        self.cfg = AppConfig.model_validate({**base, **(cfg or {})})
        self.storage = Storage(tmp_path / "db.sqlite")
        self.bridge = FileBridge(self.root, self.inp.magic, clock=self.clock)
        self.svc = TradingService(self.cfg, self.storage, self.bridge, clock=self.clock)

    def set_quotes(self, eur_bid: float, gbp_bid: float, spread: float = 0.00008) -> None:
        t = getattr(self, "clock", Clock(T0))()
        self.broker.set_quote("EURUSD", eur_bid, eur_bid + spread, t)
        self.broker.set_quote("GBPUSD", gbp_bid, gbp_bid + spread * 1.5, t)

    def tick(self, n: int = 1, seconds: float = 1.0) -> None:
        """One second of wall time: EA timer, then Python loop."""
        for _ in range(n):
            self.ea.step(self.clock())
            self.svc.step()
            self.clock.advance(seconds)
            b = self.broker
            for s, (bid, ask, _) in list(b.quotes.items()):
                b.set_quote(s, bid, ask, self.clock())

    def restart_service(self) -> None:
        self.storage.close()
        self.storage = Storage(self.storage.path)
        self.svc = TradingService(self.cfg, self.storage, self.bridge, clock=self.clock)

    def restart_ea(self) -> None:
        self.ea = EAEmulator(self.root, self.broker, self.inp)

    def intent(self, sid: str = "S1", sym: str = "EURUSD", side: Side = Side.BUY, sl_pips: float = 20) -> TradeIntent:
        bid, ask, _ = self.broker.quotes[sym]
        e = ask if side is Side.BUY else bid
        sl = round(e - side.sign * sl_pips * 0.0001, 5)
        tp = round(e + side.sign * 2 * sl_pips * 0.0001, 5)
        return TradeIntent(sid, sym, side, e, sl, tp, "t", "v1", self.clock(), self.clock())

    def submit(self, sid: str = "S1", volume: float = 0.1, **kw) -> int | None:
        it = self.intent(sid, **kw)
        planned = volume * abs(it.entry_price - it.stop_loss) * 100_000  # USD-quoted pairs
        dec = RiskDecision(True, volume, planned, planned / 100, [CheckResult("x", True)])
        return self.svc.om.submit_open(it, dec, self.svc.risk.day_id or "d", 10, 20)


@pytest.fixture
def h(tmp_path):
    return Harness(tmp_path)


def status(h: Harness, seq: int) -> str:
    return h.storage.command(seq)["status"]


def system_orders(h: Harness) -> list:
    return [o for o in h.broker.orders.values() if o.magic == h.inp.magic]


# --------------------------------------------------------------------------- basic flow
def test_state_roundtrip_and_health(h):
    h.tick(2)
    st = h.storage.read_status()
    assert st["bridge"]["healthy"], st["bridge"]
    assert st["account"]["is_demo"] and st["account"]["equity"] == pytest.approx(10_000)
    assert st["ea"]["trading_enabled"] is True
    assert set(st["quotes"]) == {"EURUSD", "GBPUSD"}


def test_open_fill_counts_one_entry(h):
    h.tick()
    seq = h.submit()
    h.tick(2)
    assert status(h, seq) == "FILLED"
    o = system_orders(h)
    assert len(o) == 1 and o[0].sl > 0 and o[0].comment == order_comment("S1")
    assert h.svc.risk.entries_today == 1 and h.ea.gv["entries"] == 1
    assert h.storage.trade(o[0].ticket)["status"] == "OPEN"


def test_duplicate_signal_is_never_sent_twice(h):
    h.tick()
    assert h.submit("DUP") is not None
    assert h.submit("DUP") is None  # blocked by the DB unique index
    h.tick(3)
    assert len(system_orders(h)) == 1


def test_ea_rejects_duplicate_tag_even_if_python_db_lost(h, tmp_path):
    h.tick()
    h.submit("X1")
    h.tick(2)
    # Simulate a wiped Python database re-sending the same signal.
    h.storage = Storage(tmp_path / "fresh.sqlite")
    h.svc = TradingService(h.cfg, h.storage, h.bridge, clock=h.clock)
    h.svc.om.st.kv_set("cmd_seq", 100)
    seq = h.submit("X1")
    h.tick(2)
    assert status(h, seq) == "DUPLICATE"
    assert len(system_orders(h)) == 1


# --------------------------------------------------------------------------- ambiguity & retries
def test_ambiguous_but_executed_is_reconciled_not_retried(h):
    h.tick()
    h.broker.inject("send", ERR_TRADE_TIMEOUT, executed=True)
    seq = h.submit("AMB")
    h.tick(2)
    assert len(system_orders(h)) == 1  # exactly one order at the broker
    assert status(h, seq) in ("UNKNOWN", "FILLED")
    h.clock.advance(25)
    h.tick(3)
    assert status(h, seq) == "FILLED"
    assert h.svc.risk.entries_today == 1
    assert len(system_orders(h)) == 1


def test_ambiguous_not_executed_ends_not_found_without_retry(h):
    h.tick()
    h.broker.inject("send", ERR_TRADE_TIMEOUT, executed=False)
    seq = h.submit("AMB2")
    h.tick(2)
    assert status(h, seq) == "UNKNOWN"
    h.clock.advance(200)
    h.tick(2)
    assert status(h, seq) == "NOT_FOUND"
    assert len(system_orders(h)) == 0
    assert h.svc.risk.entries_today == 0 and h.svc.risk.failed_attempts_today == 1


def test_requote_is_retried_safely(h):
    h.tick()
    h.broker.inject("send", 138, executed=False)
    seq = h.submit("RQ")
    h.tick(2)
    assert status(h, seq) == "FILLED"
    assert len(system_orders(h)) == 1


def test_command_expires_if_ea_was_down(h):
    h.tick()
    seq = h.submit("OLD")
    h.clock.advance(60)  # EA did not run for a minute
    h.tick(2)
    assert status(h, seq) == "EXPIRED"
    assert not system_orders(h)


def test_withdrawn_when_ea_never_picks_up(h):
    h.tick()
    seq = h.submit("STUCK")
    for _ in range(40):  # Python keeps running, EA is frozen
        h.svc.step()
        h.clock.advance(1)
    assert status(h, seq) == "WITHDRAWN"
    h.tick(2)  # EA comes back: nothing to execute
    assert not system_orders(h)


# --------------------------------------------------------------------------- restarts
def test_restart_keeps_counters_and_estop(h):
    h.tick()
    h.submit("R1")
    h.tick(2)
    h.svc.risk.estop = True
    h.svc.risk.save(h.storage)
    h.restart_service()
    h.restart_ea()
    h.tick()
    assert h.svc.risk.entries_today == 1 and h.ea.gv["entries"] == 1
    assert h.svc.risk.estop


def test_restart_does_not_duplicate_decisions(h):
    t = datetime(2026, 10, 20, 10, 0, tzinfo=UTC)
    assert h.storage.record_decision("EURUSD", t, "WAIT", "RANGE", "v", None, ["a"])
    h.restart_service()
    assert h.storage.decision_exists("EURUSD", t, "v")


# --------------------------------------------------------------------------- stale data & failures
def test_stale_ea_snapshot_marks_bridge_unhealthy(h):
    h.tick()
    for _ in range(15):  # EA stops writing, Python continues
        h.svc.step()
        h.clock.advance(1)
    st = h.storage.read_status()
    assert not st["bridge"]["healthy"]
    assert any("bridge" in r for r in st["block_reasons"])


def test_stale_quote_blocked_by_risk_engine(h):
    h.tick()
    old = h.clock() - timedelta(seconds=120)
    h.broker.quotes["EURUSD"] = (1.1, 1.10008, old)
    h.ea.step(h.clock())
    state = h.bridge.read_state()
    dec = h.svc.engine.evaluate(h.intent("Q"), h.svc.context(state, h.clock()))
    assert not dec.approved and any(c.name == "quote_fresh" and not c.passed for c in dec.checks)


def test_python_down_ea_keeps_protecting(h):
    h.tick()
    h.submit("P1")
    h.tick(2)
    o = system_orders(h)[0]
    entry, sl = o.open_price, o.sl
    # Python stops. Price rallies +1.1R: EA alone moves the stop to break-even.
    h.set_quotes(entry + (entry - sl) * 1.1, 1.3)
    for _ in range(5):
        h.ea.step(h.clock())
        h.clock.advance(1)
    assert system_orders(h)[0].sl == pytest.approx(entry + 10 * 1e-5)
    # A command arriving while Python's heartbeat is stale is refused by the EA.
    h.clock.advance(60)
    seq = h.submit("P2", sym="GBPUSD")
    h.ea.step(h.clock())
    res = h.bridge.poll_results()
    assert res and res[0]["status"] == "REJECTED" and "heartbeat" in res[0]["msg"]
    assert h.storage.command(seq)["status"] == "SENT"


# --------------------------------------------------------------------------- daily reset & loss
def test_daily_reset_resets_counters(tmp_path):
    h = Harness(tmp_path, ea=EAInputs(enable_trading=True, symbols=["EURUSD", "GBPUSD"], bars_timeframes=[],
                                      reset_zone="UTC", reset_hour=0))
    h.tick()
    h.submit("D1")
    h.tick(2)
    assert h.svc.risk.entries_today == 1
    day1 = h.svc.risk.day_id
    h.clock.t = datetime(2026, 10, 21, 0, 0, 30, tzinfo=UTC)
    h.set_quotes(*[q[0] for q in h.broker.quotes.values()])
    h.tick(2)
    assert h.svc.risk.day_id != day1 and h.svc.risk.entries_today == 0 and h.ea.gv["entries"] == 0


def test_daily_loss_halts_and_closes_with_close_all_policy(tmp_path):
    # EA per-trade caps raised so a single 1-lot position can produce a >2 % floating loss.
    h = Harness(tmp_path, ea=EAInputs(enable_trading=True, symbols=["EURUSD", "GBPUSD"], bars_timeframes=[],
                                      daily_loss_policy="close_all", max_risk_per_trade_pct=5.0,
                                      max_total_risk_pct=10.0),
                cfg={"risk": {"daily_loss_policy": "close_all"}})
    h.tick()
    h.submit("L1", volume=1.0, sl_pips=40)
    h.tick(2)
    assert len(system_orders(h)) == 1
    h.set_quotes(1.0978, 1.3)  # ~ -230 USD floating on 1 lot = -2.3% equity
    h.tick(3)
    assert h.ea.gv["halt"] and h.svc.risk.daily_loss_halt
    assert not system_orders(h)
    st = h.storage.read_status()
    assert any("daily-loss halt" in r for r in st["block_reasons"])
    seq = h.submit("L2", sym="GBPUSD")
    h.tick(2)
    assert status(h, seq) == "REJECTED"


def test_deposit_does_not_trigger_or_mask_daily_loss(h):
    h.tick()
    h.broker.deposit(-2_500)  # withdrawal of 25 %
    h.tick(2)
    assert not h.ea.gv["halt"] and not h.svc.risk.daily_loss_halt
    assert h.svc.risk.net_flows_today == pytest.approx(-2_500)


# --------------------------------------------------------------------------- emergency stop & controls
def test_emergency_stop_from_dashboard_flattens_and_blocks(h):
    h.tick()
    h.submit("E1")
    manual_ticket, _ = h.broker.order_send("GBPUSD", OP_BUY, 0.1, h.broker.quotes["GBPUSD"][1], 5, 1.29, 0, "manual", 0)
    h.tick(2)
    h.storage.add_control("estop", {"policy": "close_all"}, "tester")
    h.tick(3)
    assert h.ea.gv["estop"] and h.svc.risk.estop
    assert not system_orders(h)
    assert manual_ticket in h.broker.orders  # manual trade untouched
    seq = h.submit("E2", sym="GBPUSD")
    h.tick(2)
    assert status(h, seq) == "REJECTED"
    # clearing requires the confirmation word
    h.storage.add_control("estop_clear", {"confirm": "nope"}, "tester")
    h.tick()
    assert h.svc.risk.estop
    h.storage.add_control("estop_clear", {"confirm": "CLEAR"}, "tester")
    h.tick(3)
    assert not h.svc.risk.estop and not h.ea.gv["estop"]


def test_estop_flag_file_works_without_python(h):
    h.tick()
    h.submit("F1")
    h.tick(2)
    h.bridge.set_estop_flag("close_all", "operator")
    h.ea.step(h.clock())  # only the EA runs
    assert h.ea.gv["estop"] and not system_orders(h)


def test_pause_and_limits_controls(h):
    h.tick()
    h.storage.add_control("pause", {}, "tester")
    h.storage.add_control("set_limits", {"risk_per_trade_pct": 5.0}, "tester")
    h.storage.add_control("set_limits", {"max_open_positions": 2}, "tester")
    h.tick(2)
    ctrls = {c["id"]: c for c in h.storage.recent_controls()}
    assert [c["status"] for c in sorted(ctrls.values(), key=lambda c: c["id"])] == ["applied", "rejected", "applied"]
    assert h.svc.risk.paused and h.ea.gv["paused"]
    assert h.svc.limits(h.bridge.read_state()).max_open_positions == 2


# --------------------------------------------------------------------------- protection
def test_two_step_stop_loss_on_market_execution_broker(tmp_path):
    h = Harness(tmp_path, broker_kw={"reject_stops_on_entry": True})
    h.tick()
    seq = h.submit("M1")
    h.broker.reject_stops_on_entry = True
    h.tick(2)
    assert status(h, seq) == "FILLED"
    o = system_orders(h)[0]
    assert o.sl > 0  # protection attached right after entry


def test_position_closed_if_stop_cannot_be_attached(tmp_path):
    h = Harness(tmp_path, broker_kw={"reject_stops_on_entry": True})
    h.tick()
    h.broker.inject("modify", 130, executed=False, times=3)
    seq = h.submit("M2")
    h.tick(2)
    assert status(h, seq) == "REJECTED"
    assert not system_orders(h)
    assert any(e["code"] == "PROTECTION_FAILED" for e in h.ea.events)


def test_ea_hard_cap_rejects_oversized_order(h):
    h.tick()
    seq = h.submit("BIG", volume=2.0)  # 2 lots * 20 pips = 400 USD = 4% > EA cap 0.25%
    h.tick(2)
    assert status(h, seq) == "REJECTED"
    assert "EA cap" in h.storage.command(seq)["result"]["msg"]


def test_ea_trading_disabled_by_default(tmp_path):
    h = Harness(tmp_path, ea=EAInputs(symbols=["EURUSD", "GBPUSD"], bars_timeframes=[]))
    h.tick()
    seq = h.submit("NOPE")
    h.tick(2)
    assert status(h, seq) == "REJECTED"
    assert any("EnableTrading" in r for r in h.storage.read_status()["block_reasons"])


def test_live_account_blocked_by_ea_without_flag(tmp_path):
    h = Harness(tmp_path, broker_kw={"is_demo": False})
    h.tick()
    seq = h.submit("LIVE")
    h.tick(2)
    assert status(h, seq) == "REJECTED"
    assert "live account" in h.storage.command(seq)["result"]["msg"]
