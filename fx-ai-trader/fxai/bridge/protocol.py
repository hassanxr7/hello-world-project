"""File-based MT4 <-> Python protocol (version 1). Full spec: docs/PROTOCOL.md.

Why files: MT4 (MQL4) has no native sockets, WebRequest() blocks the EA thread
and is unavailable in the Strategy Tester, and DLL-based ZeroMQ/pipes need
"Allow DLL imports" (often disallowed on VPS/prop setups and a security risk).
The terminal's shared ``Common\\Files`` folder is reachable from MQL4 via
FILE_COMMON with no DLLs. Writers create a temp file and atomically rename it;
readers only consume complete files.

Layout under <Common>/Files/FXAI/<login>/:
  state.json            EA -> Py   snapshot, rewritten ~1/s
  bars/<SYM>_<TF>.csv   EA -> Py   completed bars, rewritten on each new bar
  cmd/<seq>.cmd         Py -> EA   one command per file (KV line)
  res/<seq>.res         EA -> Py   one result per processed command (KV line)
  py_heartbeat.txt      Py -> EA   Python liveness
  estop.flag            any -> EA  presence = emergency stop request

Command/result line format:  k=v|k=v|...|end=1   (ASCII; values may not
contain '|', '=' or newlines; a missing ``end=1`` means truncated -> ignored).
"""

from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .. import PROTOCOL_VERSION
from ..domain import AccountSnapshot, BalanceOperation, ClosedTrade, Position, Quote, Side, SymbolSpec
from ..risk import EALimits
from ..timeutil import from_epoch, server_offset_seconds

CMD_TYPES = {"OPEN", "MODIFY", "CLOSE", "CLOSE_ALL", "CANCEL_PENDING", "ESTOP", "PAUSE", "RESUME", "PING"}
RESULT_STATUSES = {"FILLED", "REJECTED", "UNKNOWN", "EXPIRED", "DUPLICATE", "DONE", "ERROR"}
COMMENT_PREFIX = "FXAI|"


class ProtocolError(ValueError):
    pass


def signal_tag(signal_id: str) -> str:
    """10-char base32 tag stored in the MT4 order comment ("FXAI|<tag>", 15 chars;
    MT4 comments are limited to 31 characters and brokers may append to them)."""
    digest = hashlib.sha256(signal_id.encode()).digest()
    return base64.b32encode(digest).decode()[:10]


def order_comment(signal_id: str) -> str:
    return COMMENT_PREFIX + signal_tag(signal_id)


def kv_text(s: str, limit: int = 200) -> str:
    """Make free text (messages) safe for a KV field: '|' -> '/', '=' -> ':', no newlines."""
    return str(s).replace("|", "/").replace("=", ":").replace("\r", " ").replace("\n", " ")[:limit]


def encode_kv(d: dict[str, Any]) -> str:
    parts = []
    for k, v in d.items():
        if isinstance(v, float):
            s = repr(round(v, 10))
        elif isinstance(v, bool):
            s = "1" if v else "0"
        else:
            s = str(v)
        if any(ch in s for ch in "|=\r\n") or any(ch in k for ch in "|=\r\n"):
            raise ProtocolError(f"illegal character in {k}={s!r}")
        parts.append(f"{k}={s}")
    parts.append("end=1")
    return "|".join(parts)


def decode_kv(line: str) -> dict[str, str]:
    line = line.strip()
    out: dict[str, str] = {}
    for part in line.split("|"):
        if "=" not in part:
            raise ProtocolError(f"malformed field {part!r}")
        k, v = part.split("=", 1)
        out[k] = v
    if out.get("end") != "1":
        raise ProtocolError("truncated record (no end=1)")
    out.pop("end")
    return out


def make_command(ctype: str, seq: int, created_gmt: int, ttl_s: int, **fields: Any) -> dict[str, Any]:
    if ctype not in CMD_TYPES:
        raise ProtocolError(f"unknown command type {ctype}")
    return {"v": PROTOCOL_VERSION, "seq": seq, "type": ctype, "created": created_gmt, "ttl": ttl_s, **fields}


# ----------------------------------------------------------------------------- state
@dataclass
class EAStatus:
    version: str
    instance_master: bool
    trading_enabled: bool
    live_allowed: bool
    estop: bool
    paused: bool
    halted: bool
    halt_reason: str
    day_id: str
    day_start_equity: float
    net_flows: float
    daily_loss_pct: float
    entries_today: int
    failed_today: int
    modifications_today: int
    partial_closes_today: int
    py_heartbeat_age: float
    last_cmd_seq: int
    limits: EALimits | None
    magic: int | None = None
    reset_zone: str | None = None
    reset_hour: int | None = None
    bar_timeframes: list[str] = field(default_factory=list)
    bars_to_export: int | None = None
    symbol_prefix: str | None = None
    symbol_suffix: str | None = None


@dataclass
class BridgeState:
    seq: int
    server_time: int
    gmt_time: int
    offset_s: int
    account: AccountSnapshot
    ea: EAStatus
    specs: dict[str, SymbolSpec]
    quotes: dict[str, Quote]
    positions: list[Position]
    history: list[ClosedTrade]
    balance_ops: list[BalanceOperation]
    events: list[dict[str, Any]] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def gmt_dt(self) -> datetime:
        return from_epoch(self.gmt_time)


def _f(d: dict, k: str, default: float = 0.0) -> float:
    v = d.get(k, default)
    return float(v) if v is not None else default


def parse_state(text: str, magic: int) -> BridgeState:
    try:
        d = json.loads(text)
    except json.JSONDecodeError as e:
        raise ProtocolError(f"state.json is not valid JSON: {e}") from e
    if int(d.get("v", 0)) != PROTOCOL_VERSION:
        raise ProtocolError(f"protocol version mismatch: EA {d.get('v')} vs Python {PROTOCOL_VERSION}")
    t = d["time"]
    off = server_offset_seconds(int(t["server"]), int(t["gmt"]))

    def utc(server_epoch: Any) -> datetime:
        return from_epoch(int(server_epoch) - off)

    a = d["account"]
    account = AccountSnapshot(
        login=int(a["login"]), currency=str(a["currency"]), balance=_f(a, "balance"), equity=_f(a, "equity"),
        margin=_f(a, "margin"), free_margin=_f(a, "free_margin"), leverage=int(a.get("leverage", 0)),
        is_demo=bool(a.get("is_demo", True)), trade_allowed=bool(a.get("trade_allowed", False)),
        connected=bool(a.get("connected", False)), server=str(a.get("server", "")), company=str(a.get("company", "")))
    e = d["ea"]
    lim = e.get("limits")
    limits = EALimits(
        max_risk_per_trade_pct=_f(lim, "risk_per_trade_pct"), max_total_risk_pct=_f(lim, "total_risk_pct"),
        max_open_positions=int(lim["max_positions"]), max_entries_per_day=int(lim["max_entries"]),
        max_daily_loss_pct=_f(lim, "daily_loss_pct")) if lim else None
    ea = EAStatus(
        version=str(e.get("version", "?")), instance_master=bool(e.get("master", False)),
        trading_enabled=bool(e.get("trading_enabled", False)), live_allowed=bool(e.get("live_allowed", False)),
        estop=bool(e.get("estop", False)), paused=bool(e.get("paused", False)), halted=bool(e.get("halted", False)),
        halt_reason=str(e.get("halt_reason", "")), day_id=str(e.get("day_id", "")),
        day_start_equity=_f(e, "day_start_equity"), net_flows=_f(e, "net_flows"),
        daily_loss_pct=_f(e, "daily_loss_pct"), entries_today=int(e.get("entries_today", 0)),
        failed_today=int(e.get("failed_today", 0)), modifications_today=int(e.get("modifications_today", 0)),
        partial_closes_today=int(e.get("partial_closes_today", 0)),
        py_heartbeat_age=_f(e, "py_heartbeat_age", 1e9), last_cmd_seq=int(e.get("last_cmd_seq", 0)), limits=limits,
        magic=int(e["magic"]) if "magic" in e else None, reset_zone=e.get("reset_zone"),
        reset_hour=int(e["reset_hour"]) if "reset_hour" in e else None,
        bar_timeframes=[t.strip() for t in str(e.get("bar_timeframes", "")).split(",") if t.strip()],
        bars_to_export=int(e["bars_to_export"]) if "bars_to_export" in e else None,
        symbol_prefix=e.get("symbol_prefix"), symbol_suffix=e.get("symbol_suffix"))

    specs: dict[str, SymbolSpec] = {}
    quotes: dict[str, Quote] = {}
    for s in d.get("symbols", []):
        canon = str(s["canonical"])
        specs[canon] = SymbolSpec(
            canonical=canon, broker_name=str(s["name"]), base=str(s.get("base", canon[:3])),
            quote=str(s.get("profit_ccy", canon[3:6])), digits=int(s["digits"]), point=_f(s, "point"),
            tick_size=_f(s, "tick_size"), tick_value=_f(s, "tick_value"), contract_size=_f(s, "contract_size"),
            min_lot=_f(s, "min_lot"), max_lot=_f(s, "max_lot"), lot_step=_f(s, "lot_step"),
            stop_level_points=int(s.get("stop_level", 0)), freeze_level_points=int(s.get("freeze_level", 0)),
            margin_per_lot=_f(s, "margin_required"), trade_allowed=bool(s.get("trade_allowed", False)),
            swap_long_points=_f(s, "swap_long"), swap_short_points=_f(s, "swap_short"))
        if _f(s, "bid") > 0 and _f(s, "ask") > 0:
            quotes[canon] = Quote(canon, _f(s, "bid"), _f(s, "ask"), utc(s.get("tick_time", t["server"])))

    by_broker = {sp.broker_name: c for c, sp in specs.items()}

    def canon_of(name: str) -> str:
        return by_broker.get(name, name)

    positions = [
        Position(ticket=int(o["ticket"]), symbol=canon_of(str(o["symbol"])), side=Side.BUY if int(o["type"]) == 0 else Side.SELL,
                 volume=_f(o, "lots"), open_price=_f(o, "open_price"), open_time_utc=utc(o["open_time"]),
                 sl=_f(o, "sl"), tp=_f(o, "tp"), profit=_f(o, "profit"), swap=_f(o, "swap"),
                 commission=_f(o, "commission"), magic=int(o.get("magic", 0)), comment=str(o.get("comment", "")),
                 system_owned=int(o.get("magic", 0)) == magic)
        for o in d.get("orders", []) if int(o.get("type", -1)) in (0, 1)
    ]
    history, ops = [], []
    for h in d.get("history", []):
        typ = int(h.get("type", -1))
        if typ in (0, 1):
            history.append(ClosedTrade(
                ticket=int(h["ticket"]), symbol=canon_of(str(h["symbol"])), side=Side.BUY if typ == 0 else Side.SELL,
                volume=_f(h, "lots"), open_price=_f(h, "open_price"), close_price=_f(h, "close_price"),
                open_time_utc=utc(h["open_time"]), close_time_utc=utc(h["close_time"]), sl=_f(h, "sl"),
                tp=_f(h, "tp"), profit=_f(h, "profit"), swap=_f(h, "swap"), commission=_f(h, "commission"),
                magic=int(h.get("magic", 0)), comment=str(h.get("comment", "")),
                system_owned=int(h.get("magic", 0)) == magic))
        elif typ in (6, 7):
            ops.append(BalanceOperation(ticket=int(h["ticket"]), time_utc=utc(h["open_time"]), amount=_f(h, "profit"),
                                        kind="balance" if typ == 6 else "credit", comment=str(h.get("comment", ""))))
    return BridgeState(seq=int(d.get("seq", 0)), server_time=int(t["server"]), gmt_time=int(t["gmt"]), offset_s=off,
                       account=account, ea=ea, specs=specs, quotes=quotes, positions=positions, history=history,
                       balance_ops=ops, events=list(d.get("events", [])), raw=d)
