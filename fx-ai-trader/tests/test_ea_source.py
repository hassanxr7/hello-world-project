"""Static consistency checks between the MQL4 EA source and the Python side.

These do NOT compile the EA (no MetaEditor here). They catch drift: protocol
fields the parser needs but the EA does not emit, input defaults that differ
from the documented/emulated ones, unhandled command types, unbalanced braces.
"""

import re
from pathlib import Path

import pytest

from fxai.bridge.ea_emulator import EAInputs
from fxai.bridge.protocol import CMD_TYPES
from fxai.config import AppConfig
from fxai.strategy import build_strategy

ROOT = Path(__file__).resolve().parents[1]
EA = (ROOT / "mql4" / "Experts" / "FXAI_Bridge.mq4").read_text(encoding="utf-8")
SCRIPT = (ROOT / "mql4" / "Scripts" / "FXAI_ExportHistory.mq4").read_text(encoding="utf-8")


def strip_comments_and_strings(src: str) -> str:
    src = re.sub(r"//[^\n]*", "", src)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r'"(?:\\.|[^"\\])*"', '""', src)
    src = re.sub(r"'(?:\\.|[^'\\])'", "''", src)
    return src


@pytest.mark.parametrize("src", [EA, SCRIPT], ids=["ea", "script"])
def test_balanced_delimiters(src):
    code = strip_comments_and_strings(src)
    for o, c in ("{}", "()", "[]"):
        assert code.count(o) == code.count(c), f"unbalanced {o}{c}"


def inputs() -> dict[str, str]:
    out = {}
    for m in re.finditer(r"^\s*input\s+\w+\s+(\w+)\s*=\s*([^;]+);", EA, re.M):
        out[m.group(1)] = m.group(2).strip().strip('"')
    return out


def test_input_defaults_match_python_mirror_and_config():
    inp, e, cfg = inputs(), EAInputs(), AppConfig()
    ex = build_strategy(cfg).exits
    num = {k: float(v) for k, v in inp.items() if re.fullmatch(r"-?\d+(\.\d+)?", v)}
    assert inp["EnableTrading"] == "false" and inp["AllowLiveAccount"] == "false"  # safe defaults
    assert int(num["MagicNumber"]) == e.magic == cfg.bridge.magic_number
    assert num["MaxRiskPerTradePct"] == e.max_risk_per_trade_pct == cfg.risk.risk_per_trade_pct
    assert num["MaxTotalRiskPct"] == e.max_total_risk_pct == cfg.risk.max_total_risk_pct
    assert num["MaxOpenPositions"] == e.max_open_positions == cfg.risk.max_open_positions
    assert num["MaxEntriesPerDay"] == e.max_entries_per_day == cfg.risk.max_entries_per_day == 20
    assert num["MaxDailyLossPct"] == e.max_daily_loss_pct == cfg.risk.max_daily_loss_pct
    assert num["RiskTolerancePct"] == e.risk_tolerance_pct
    assert num["MaxCommandAgeSec"] == e.max_command_age_s == cfg.bridge.command_ttl_s
    assert num["PyHeartbeatTimeoutSec"] == e.py_heartbeat_timeout_s
    assert num["BreakEvenTriggerR"] == e.breakeven_trigger_r == ex.breakeven_trigger_r
    assert num["BreakEvenOffsetPoints"] == e.breakeven_offset_points == ex.breakeven_offset_points
    assert num["MaxHoldHours"] == e.max_hold_hours == ex.max_hold_hours
    assert inp["TrailingEnabled"] == ("true" if ex.trailing_enabled else "false")
    assert inp["EStopPolicy"] == "POLICY_CLOSE_ALL" and cfg.risk.emergency_stop_policy == "close_all"
    assert inp["DailyLossPolicy"] == "POLICY_HOLD_PROTECTED" and cfg.risk.daily_loss_policy == "hold_protected"


def test_state_json_has_every_field_the_parser_reads():
    required = [
        "v", "seq", "time", "server", "gmt", "account", "login", "currency", "balance", "equity", "margin",
        "free_margin", "leverage", "is_demo", "trade_allowed", "connected", "ea", "version", "master",
        "trading_enabled", "live_allowed", "estop", "paused", "halted", "halt_reason", "day_id",
        "day_start_equity", "net_flows", "daily_loss_pct", "entries_today", "failed_today",
        "modifications_today", "partial_closes_today", "py_heartbeat_age", "last_cmd_seq", "limits",
        "risk_per_trade_pct", "total_risk_pct", "max_positions", "max_entries", "symbols", "name", "canonical",
        "base", "profit_ccy", "bid", "ask", "tick_time", "digits", "point", "tick_size", "tick_value",
        "contract_size", "min_lot", "max_lot", "lot_step", "stop_level", "freeze_level", "margin_required",
        "magic", "reset_zone", "reset_hour", "bar_timeframes", "bars_to_export", "symbol_suffix",
        "orders", "ticket", "symbol", "type", "lots", "open_price", "open_time", "sl", "tp", "profit", "swap",
        "commission", "magic", "comment", "history", "close_time", "close_price", "events",
    ]
    missing = [k for k in required if f'\\"{k}\\":' not in EA]
    assert not missing, missing


def test_every_command_type_is_handled():
    for t in CMD_TYPES:
        assert f'"{t}"' in EA, t


def test_result_fields_and_statuses():
    for f in ("|seq=", "|type=", "|status=", "|id=", "|ticket=", "|err=", "|msg=", "|end=1"):
        assert f in EA
    for s in ("FILLED", "REJECTED", "UNKNOWN", "EXPIRED", "DUPLICATE", "DONE", "ERROR"):
        assert f'"{s}"' in EA


def test_dst_rules_match_python_port():
    # Same constants as fxai.timeutil.us_dst_utc_bounds / eu_dst_utc_bounds
    assert "NthSunday(s.year, 3, 2) + 7 * 3600" in EA
    assert "NthSunday(s.year, 11, 1) + 6 * 3600" in EA
    assert "LastSunday(s.year, 3) + 3600" in EA and "LastSunday(s.year, 10) + 3600" in EA


def test_safety_invariants_present():
    assert "persisted BEFORE OrderSend" in EA  # write-ahead pending marker
    assert "will NOT retry" in EA
    assert "stop may not be removed or widened" in EA
    assert "OrderMagicNumber() == MagicNumber" in EA  # manual trades untouched
    assert "#property strict" in EA
    code = strip_comments_and_strings(EA)
    assert "#import" not in code  # no DLL imports
    assert "WebRequest" not in code


def test_exit_policy_bounds_match_python():
    from fxai.bridge.protocol import EXIT_KEYS, EXIT_RANGES, TRAIL_DIST_MAX_FRACTION
    var = {"hold_h": "xh", "be_r": "xbr", "be_pts": "xbp", "trail_r": "xtr"}
    for k, (lo, hi) in EXIT_RANGES.items():
        assert f"{var[k]} >= {lo:g} && {var[k]} <= {hi:g}" in EA, k
    assert f"xtd <= {TRAIL_DIST_MAX_FRACTION:g} * price" in EA
    for k in EXIT_KEYS:
        assert f'KV(k, v, "{k}"' in EA, k
    assert "exit policy persisted BEFORE OrderSend" in EA
    assert EA.count("MoveExitsToTicket(tag,") == 2  # on fill and on reconciliation


def test_bar_export_default_matches_emulator():
    assert inputs()["BarTimeframes"] == ",".join(EAInputs().bars_timeframes)
