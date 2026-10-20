from datetime import datetime, timedelta, timezone

import pytest

from fxai.risk import RiskState
from fxai.timeutil import (in_window, rule_based_local, server_offset_seconds, trading_day_id,
                           trading_day_start_utc, zone_local)

UTC = timezone.utc


@pytest.mark.parametrize("zone", ["America/New_York", "Europe/London"])
def test_rule_based_dst_matches_zoneinfo(zone):
    """The EA's hard-coded DST rules must agree with the IANA database (2008-2037)."""
    t = datetime(2008, 1, 1, tzinfo=UTC)
    end = datetime(2038, 1, 1, tzinfo=UTC)
    mismatches = 0
    while t < end:
        if rule_based_local(t, zone) != zone_local(t, zone):
            mismatches += 1
        t += timedelta(minutes=30)
    assert mismatches == 0


def test_ny_17_reset_day_ids():
    # 2026-10-20 is a Tuesday, EDT (UTC-4). 17:00 NY = 21:00 UTC.
    before = datetime(2026, 10, 20, 20, 59, tzinfo=UTC)
    after = datetime(2026, 10, 20, 21, 0, tzinfo=UTC)
    assert trading_day_id(before, "America/New_York", 17) == "2026-10-19"
    assert trading_day_id(after, "America/New_York", 17) == "2026-10-20"
    assert trading_day_start_utc(after, "America/New_York", 17) == after


def test_server_zone_reset():
    off = server_offset_seconds(1_000_000_000 + 3 * 3600 + 7, 1_000_000_000)
    assert off == 3 * 3600
    t = datetime(2026, 10, 20, 20, 59, tzinfo=UTC)  # 23:59 server (GMT+3)
    assert trading_day_id(t, "server", 0, off) == "2026-10-20"
    assert trading_day_id(t + timedelta(minutes=1), "server", 0, off) == "2026-10-21"
    assert trading_day_start_utc(t + timedelta(minutes=1), "server", 0, off) == t + timedelta(minutes=1)


def test_in_window():
    assert in_window(datetime(2026, 1, 1, 7, 0, tzinfo=UTC), "07:00-20:00")
    assert not in_window(datetime(2026, 1, 1, 20, 0, tzinfo=UTC), "07:00-20:00")
    assert in_window(datetime(2026, 1, 1, 23, 0, tzinfo=UTC), "22:00-02:00")


def test_risk_state_persists_and_rolls(storage):
    st = RiskState()
    assert st.roll_if_needed("2026-10-20", 10_000)
    st.record_entry("EURUSD", datetime(2026, 10, 20, 9, tzinfo=UTC))
    st.record_failed_attempt()
    st.estop = True
    st.paused = True
    st.check_daily_loss(9_700, 2.0)
    st.save(storage)

    re = RiskState.load(storage)
    assert re.entries_today == 1 and re.failed_attempts_today == 1
    assert re.estop and re.daily_loss_halt
    # New day: counters and the daily halt reset, emergency stop and pause do NOT
    assert re.roll_if_needed("2026-10-21", 9_700)
    assert re.entries_today == 0 and not re.daily_loss_halt
    assert re.estop and re.paused
    assert not re.roll_if_needed("2026-10-21", 9_000)  # idempotent within a day


def test_cash_flow_dedup():
    st = RiskState(); st.roll_if_needed("d", 10_000)
    assert st.add_cash_flow(5, 1000)
    assert not st.add_cash_flow(5, 1000)
    assert st.net_flows_today == 1000


def test_command_seq_monotonic_and_unique_signal(storage):
    a = storage.next_command_seq(); b = storage.next_command_seq()
    assert b == a + 1
    storage.insert_command(a, "OPEN", {"x": 1}, "SIG1", "EURUSD", "d")
    with pytest.raises(Exception):
        storage.insert_command(b, "OPEN", {"x": 1}, "SIG1", "EURUSD", "d")  # duplicate signal rejected by DB
    storage.insert_command(b, "CLOSE", {"x": 1}, "SIG1", "EURUSD", "d")  # non-OPEN may share a signal


def test_decision_dedup(storage):
    t = datetime(2026, 10, 20, 10, 15, tzinfo=UTC)
    assert storage.record_decision("EURUSD", t, "WAIT", "RANGE", "v1", None, ["x"])
    assert not storage.record_decision("EURUSD", t, "BUY", "RANGE", "v1", None, ["x"])
