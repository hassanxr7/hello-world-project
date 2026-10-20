"""Python emulator of the MT4 EA's side of the file protocol.

This mirrors mql4/Experts/FXAI_Bridge.mq4 step by step (same inputs, same
guard order, same persistence rules) on top of ``SimBroker``. It exists so
that the Python service, bridge and order manager can be integration-tested
end to end, and for paper trading without MT4.

It is NOT a substitute for testing the real EA in MetaTrader 4: MQL4
compilation, broker behaviour and terminal file locking can only be verified
there (see docs/VERIFICATION.md).
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

from .. import PROTOCOL_VERSION
from ..analysis.bars import TF_MINUTES, resample
from ..analysis.indicators import atr
from ..execution.sim_broker import (ERR_INVALID_STOPS, NOT_EXECUTED_RETRYABLE, OP_BUY, OP_SELL, SimBroker,
                                    is_ambiguous)
from ..timeutil import as_utc, trading_day_id
from .file_bridge import atomic_write
from .protocol import COMMENT_PREFIX, ProtocolError, decode_kv, encode_kv, kv_text

EA_VERSION = "1.0.0-emulator"


@dataclass
class EAInputs:
    magic: int = 7340001
    symbols: list[str] = field(default_factory=lambda: ["EURUSD", "GBPUSD", "USDJPY", "USDCAD", "AUDUSD",
                                                         "USDCHF", "NZDUSD"])
    enable_trading: bool = False
    allow_live_account: bool = False
    max_risk_per_trade_pct: float = 0.25
    max_total_risk_pct: float = 1.0
    max_open_positions: int = 3
    max_entries_per_day: int = 20
    max_daily_loss_pct: float = 2.0
    risk_tolerance_pct: float = 10.0
    max_spread_points: int = 50
    max_quote_age_s: int = 30
    max_slippage_points: int = 10
    max_command_age_s: int = 15
    py_heartbeat_timeout_s: int = 30
    daily_loss_policy: str = "hold"  # hold | close_all
    estop_policy: str = "close_all"  # close_all | hold
    reset_zone: str = "server"
    reset_hour: int = 0
    breakeven_enabled: bool = True
    breakeven_trigger_r: float = 1.0
    breakeven_offset_points: int = 10
    trailing_enabled: bool = False
    trailing_start_r: float = 1.5
    trailing_atr_mult: float = 2.0
    trailing_tf: str = "H1"
    max_hold_hours: float = 48
    allow_two_step_sl: bool = True
    max_entry_retries: int = 2
    reconcile_window_s: int = 60
    bars_timeframes: list[str] = field(default_factory=lambda: ["M15", "H1", "H4"])
    bars_count: int = 800
    server_offset_hours: float = 2.0  # emulator only: broker server time = UTC + offset


class EAEmulator:
    def __init__(self, root: str | Path, broker: SimBroker, inputs: EAInputs | None = None,
                 m1: dict[str, pd.DataFrame] | None = None):
        self.root = Path(root)
        self.b = broker
        self.inp = inputs or EAInputs()
        self.m1 = m1 or {}
        for d in ("cmd", "res", "bars"):
            (self.root / d).mkdir(parents=True, exist_ok=True)
        self.gv_path = self.root / ".ea_globalvars.json"  # emulates MT4 GlobalVariables (persist across restarts)
        self.gv: dict = self._load_gv()
        self.events: list[dict] = []
        self.seq = 0
        self._last_bar: dict[tuple[str, str], int] = {}
        self.now: datetime | None = None

    # ------------------------------------------------------------------ persistence
    def _load_gv(self) -> dict:
        if self.gv_path.is_file():
            return json.loads(self.gv_path.read_text())
        return {"day": "", "dse": 0.0, "flows": 0.0, "flow_tickets": [], "entries": 0, "failed": 0, "mods": 0,
                "partials": 0, "halt": False, "halt_reason": "", "estop": False, "paused": False,
                "last_seq": 0, "tags": {}, "r": {}, "pending_reconcile": {}}

    def _save_gv(self) -> None:
        atomic_write(self.gv_path, json.dumps(self.gv))

    # ------------------------------------------------------------------ helpers
    @property
    def offset_s(self) -> int:
        return int(self.inp.server_offset_hours * 3600)

    def server_epoch(self, t: datetime) -> int:
        return int(as_utc(t).timestamp()) + self.offset_s

    def log(self, level: str, code: str, msg: str) -> None:
        self.events.append({"t": int(self.now.timestamp()) if self.now else 0, "level": level, "code": code, "msg": msg})
        self.events = self.events[-30:]

    def system_orders(self) -> list:
        return [o for o in self.b.orders.values() if o.magic == self.inp.magic]

    def find_by_tag(self, tag: str):
        needle = COMMENT_PREFIX + tag
        for o in list(self.b.orders.values()) + self.b.history:
            if o.magic == self.inp.magic and needle in o.comment:
                return o
        t = self.gv["tags"].get(tag)
        if t:
            for o in list(self.b.orders.values()) + self.b.history:
                if o.ticket == t:
                    return o
        return None

    def py_heartbeat_age(self) -> float:
        p = self.root / "py_heartbeat.txt"
        try:
            hb = decode_kv(p.read_text())
            return self.now.timestamp() - int(hb["gmt"])
        except (FileNotFoundError, ProtocolError, KeyError, ValueError):
            return 1e9

    def order_risk(self, o) -> float:
        if o.sl <= 0:
            return math.inf
        dist = (o.open_price - o.sl) * (1 if o.type == OP_BUY else -1)
        return max(0.0, dist) * self.b.spec(o.symbol).value_per_price_unit * o.lots

    def daily_loss_pct(self) -> float:
        dse = self.gv["dse"]
        if dse <= 0:
            return 0.0
        pnl = self.b.equity - dse - self.gv["flows"]
        return max(0.0, -pnl) / dse * 100

    def write_result(self, seq: int, **f) -> None:
        if "msg" in f:
            f["msg"] = kv_text(f["msg"])
        atomic_write(self.root / "res" / f"{seq:012d}.res",
                     encode_kv({"v": PROTOCOL_VERSION, "seq": seq, **f, "time": self.server_epoch(self.now)}))

    # ------------------------------------------------------------------ main timer
    def step(self, now: datetime) -> None:
        self.now = as_utc(now)
        self._day_roll()
        self._cash_flows()
        if (self.root / "estop.flag").exists() and not self.gv["estop"]:
            policy = self.inp.estop_policy
            try:
                policy = decode_kv((self.root / "estop.flag").read_text()).get("policy", policy)
            except ProtocolError:
                pass
            self._estop(policy, "estop.flag present")
        self._daily_loss_check()
        self._manage_positions()
        self._process_commands()
        self._reconcile_pending()
        self._write_bars()
        self._write_state()
        self._save_gv()

    def _day_roll(self) -> None:
        day = trading_day_id(self.now, self.inp.reset_zone, self.inp.reset_hour, self.offset_s)
        if day != self.gv["day"]:
            self.gv.update(day=day, dse=self.b.equity, flows=0.0, entries=0, failed=0, mods=0, partials=0,
                           halt=False, halt_reason="")
            self.log("info", "DAY_ROLL", f"new trading day {day}, start equity {self.b.equity:.2f}")

    def _cash_flows(self) -> None:
        for h in self.b.history:
            if h.type in (6, 7) and h.ticket not in self.gv["flow_tickets"]:
                self.gv["flow_tickets"].append(h.ticket)
                if h.close_time is None or trading_day_id(h.close_time, self.inp.reset_zone, self.inp.reset_hour,
                                                          self.offset_s) == self.gv["day"]:
                    self.gv["flows"] += h.profit

    def _daily_loss_check(self) -> None:
        if self.gv["halt"]:
            return
        loss = self.daily_loss_pct()
        if loss >= self.inp.max_daily_loss_pct:
            self.gv["halt"] = True
            self.gv["halt_reason"] = f"daily loss {loss:.2f}% >= {self.inp.max_daily_loss_pct}%"
            self.log("critical", "DAILY_LOSS_HALT", self.gv["halt_reason"])
            self._cancel_pending()
            if self.inp.daily_loss_policy == "close_all":
                self._close_all("daily_loss")

    def _estop(self, policy: str, reason: str) -> None:
        self.gv["estop"] = True
        self.log("critical", "ESTOP", f"{reason}; policy={policy}")
        self._cancel_pending()
        if policy == "close_all":
            self._close_all("estop")

    def _cancel_pending(self) -> None:
        for o in self.system_orders():
            if o.type > 1:
                self.b.orders.pop(o.ticket, None)

    def _close_all(self, why: str) -> None:
        for o in self.system_orders():
            err = self.b.order_close(o.ticket)
            self.log("warning" if err else "info", "CLOSE_ALL", f"{why} ticket {o.ticket} err {err}")

    def _manage_positions(self) -> None:
        inp = self.inp
        for o in self.system_orders():
            spec = self.b.spec(o.symbol)
            bid, ask, _ = self.b.quotes[o.symbol]
            long = o.type == OP_BUY
            px = bid if long else ask
            if o.sl <= 0:
                self.log("critical", "UNPROTECTED", f"ticket {o.ticket} has no SL - closing")
                self.b.order_close(o.ticket)
                continue
            r = self.gv["r"].get(str(o.ticket))
            if not r:
                r = abs(o.open_price - o.sl)
                self.gv["r"][str(o.ticket)] = r
            prof = (px - o.open_price) * (1 if long else -1)
            sign = 1 if long else -1
            new_sl = o.sl
            if inp.breakeven_enabled and r > 0 and prof >= inp.breakeven_trigger_r * r:
                be = round(o.open_price + sign * inp.breakeven_offset_points * spec.point, spec.digits)
                if (be - new_sl) * sign > 0:
                    new_sl = be
            if inp.trailing_enabled and r > 0 and prof >= inp.trailing_start_r * r:
                a = self._atr(o.symbol)
                if a:
                    cand = round(px - sign * inp.trailing_atr_mult * a, spec.digits)
                    if (cand - new_sl) * sign > 0:
                        new_sl = cand
            lvl = spec.stop_level_points * spec.point
            if new_sl != o.sl and (px - new_sl) * sign > lvl:  # never widen; respect stop level
                err = self.b.order_modify(o.ticket, new_sl, o.tp)
                if err == 0:
                    self.gv["mods"] += 1
            if (self.now - as_utc(o.open_time)).total_seconds() >= inp.max_hold_hours * 3600:
                self.b.order_close(o.ticket, reason="[time]")
                self.log("info", "TIME_EXIT", f"ticket {o.ticket} max hold reached")

    def _atr(self, symbol: str) -> float | None:
        m1 = self.m1.get(symbol)
        if m1 is None:
            return None
        end_i = m1.index.searchsorted(pd.Timestamp(self.now), side="left")
        start_i = m1.index.searchsorted(pd.Timestamp(self.now) - pd.Timedelta(days=30))
        bars = resample(m1.iloc[start_i:end_i], self.inp.trailing_tf)
        bars = bars[bars["close_time"] <= self.now]
        if len(bars) < 20:
            return None
        return float(atr(bars, 14).iloc[-1])

    # ------------------------------------------------------------------ commands
    def _process_commands(self) -> None:
        files = sorted((self.root / "cmd").glob("*.cmd"))
        for p in files:
            try:
                cmd = decode_kv(p.read_text())
                seq = int(cmd["seq"])
            except (ProtocolError, KeyError, ValueError) as e:
                self.log("error", "BAD_CMD", f"{p.name}: {e}")
                p.unlink(missing_ok=True)
                continue
            if seq <= self.gv["last_seq"]:
                p.unlink(missing_ok=True)
                self.write_result(seq, type=cmd.get("type", "?"), status="DUPLICATE", msg="seq already processed")
                continue
            try:
                self._handle(cmd, seq)
            finally:
                self.gv["last_seq"] = seq
                self._save_gv()
                p.unlink(missing_ok=True)

    def _handle(self, cmd: dict, seq: int) -> None:
        typ = cmd.get("type", "")
        age = self.now.timestamp() - int(cmd.get("created", 0))
        ttl = min(int(cmd.get("ttl", self.inp.max_command_age_s)), self.inp.max_command_age_s)
        if typ == "OPEN" and age > ttl:
            self.write_result(seq, type=typ, id=cmd.get("id", ""), status="EXPIRED", msg=f"command age {age:.0f}s")
            return
        if typ == "OPEN":
            self._open(cmd, seq)
        elif typ == "MODIFY":
            t = int(cmd["ticket"])
            o = self.b.orders.get(t)
            if o is None or o.magic != self.inp.magic:
                self.write_result(seq, type=typ, status="REJECTED", msg="not a system order")
                return
            sl = float(cmd["sl"])
            sign = 1 if o.type == OP_BUY else -1
            if sl <= 0 or (o.sl > 0 and (sl - o.sl) * sign < 0):
                self.write_result(seq, type=typ, status="REJECTED", msg="stop may not be removed or widened")
                return
            err = self.b.order_modify(t, sl, float(cmd.get("tp", o.tp)))
            if err == 0:
                self.gv["mods"] += 1
            self.write_result(seq, type=typ, ticket=t, status="DONE" if err == 0 else "REJECTED", err=err)
        elif typ == "CLOSE":
            t = int(cmd["ticket"])
            o = self.b.orders.get(t)
            if o is None or o.magic != self.inp.magic:
                self.write_result(seq, type=typ, status="REJECTED", msg="not a system order")
                return
            lots = float(cmd.get("volume", 0)) or None
            err = self.b.order_close(t, lots)
            if err == 0 and lots:
                self.gv["partials"] += 1
            self.write_result(seq, type=typ, ticket=t, status="DONE" if err == 0 else "REJECTED", err=err)
        elif typ == "CLOSE_ALL":
            self._close_all(cmd.get("reason", "command"))
            self.write_result(seq, type=typ, status="DONE")
        elif typ == "CANCEL_PENDING":
            self._cancel_pending()
            self.write_result(seq, type=typ, status="DONE")
        elif typ == "ESTOP":
            if cmd.get("action") == "clear":
                if cmd.get("confirm") != "CLEAR" or (self.root / "estop.flag").exists():
                    self.write_result(seq, type=typ, status="REJECTED", msg="clear needs confirm=CLEAR and no estop.flag")
                    return
                self.gv["estop"] = False
                self.log("warning", "ESTOP_CLEARED", "emergency stop cleared by command")
            else:
                self._estop(cmd.get("policy", self.inp.estop_policy), "command")
            self.write_result(seq, type=typ, status="DONE")
        elif typ in ("PAUSE", "RESUME"):
            self.gv["paused"] = typ == "PAUSE"
            self.write_result(seq, type=typ, status="DONE")
        elif typ == "PING":
            self.write_result(seq, type=typ, status="DONE")
        else:
            self.write_result(seq, type=typ, status="ERROR", msg="unknown type")

    def _guard(self, cmd: dict) -> str | None:
        """Hard limits checked by the EA for every entry. Returns a reason or None."""
        inp, b = self.inp, self.b
        sym = cmd["symbol"]
        if not inp.enable_trading:
            return "EnableTrading=false"
        if not b.is_demo and not inp.allow_live_account:
            return "live account and AllowLiveAccount=false"
        if self.gv["estop"]:
            return "emergency stop active"
        if self.gv["paused"]:
            return "paused"
        if self.gv["halt"]:
            return "daily loss halt"
        if self.py_heartbeat_age() > inp.py_heartbeat_timeout_s:
            return "python heartbeat stale"
        if not b.connected or not b.trade_allowed:
            return "terminal not connected / trading not allowed"
        if self.gv["entries"] >= inp.max_entries_per_day:
            return f"daily entry cap {inp.max_entries_per_day}"
        sys_orders = self.system_orders()
        if len(sys_orders) >= inp.max_open_positions:
            return "max open positions"
        if any(o.symbol == sym for o in sys_orders):
            return "position already open on symbol"
        if sym not in b.quotes or sym not in inp.symbols:
            return "symbol not available"
        spec = b.spec(sym)
        bid, ask, t = b.quotes[sym]
        if (self.now - as_utc(t)).total_seconds() > inp.max_quote_age_s:
            return "stale quote"
        if (ask - bid) / spec.point > inp.max_spread_points:
            return "spread above EA limit"
        side = cmd["side"]
        sl, vol = float(cmd["sl"]), float(cmd["volume"])
        px = ask if side == "BUY" else bid
        if sl <= 0 or (side == "BUY" and sl >= bid) or (side == "SELL" and sl <= ask):
            return "invalid or missing stop-loss"
        close_px = bid if side == "BUY" else ask
        if abs(close_px - sl) < spec.stop_level_points * spec.point:
            return "stop-loss inside broker stop level"
        if abs(px - float(cmd["ref"])) / spec.point > float(cmd.get("maxdev", 20)):
            return "price moved beyond max deviation"
        risk = vol * abs(px - sl) * spec.value_per_price_unit
        tol = 1 + inp.risk_tolerance_pct / 100
        cap = min(float(cmd.get("maxrisk", math.inf)), b.equity * inp.max_risk_per_trade_pct / 100) * tol
        if risk > cap:
            return f"planned risk {risk:.2f} > EA cap {cap:.2f}"
        open_risk = sum(self.order_risk(o) for o in sys_orders)
        if open_risk + risk > b.equity * inp.max_total_risk_pct / 100 * tol:
            return "total risk above EA cap"
        return None

    def _open(self, cmd: dict, seq: int) -> None:
        sid, tag = cmd.get("id", ""), cmd.get("tag", "")
        found = self.find_by_tag(tag)
        if found is not None or tag in self.gv["tags"]:
            self.write_result(seq, type="OPEN", id=sid, status="DUPLICATE", ticket=found.ticket if found else 0,
                              msg="signal already executed")
            return
        reason = self._guard(cmd)
        if reason:
            self.gv["failed"] += 1
            self.write_result(seq, type="OPEN", id=sid, status="REJECTED", err=0, msg=reason)
            self.log("warning", "OPEN_REJECTED", f"{sid}: {reason}")
            return
        sym, side = cmd["symbol"], cmd["side"]
        op = OP_BUY if side == "BUY" else OP_SELL
        vol, sl, tp = float(cmd["volume"]), float(cmd["sl"]), float(cmd.get("tp", 0))
        comment = COMMENT_PREFIX + tag
        self.gv["pending_reconcile"][tag] = {"seq": seq, "id": sid, "since": self.now.timestamp(), "sl": sl, "tp": tp}
        self._save_gv()  # in-flight marker persisted BEFORE sending
        attempts = 0
        two_step = False
        while True:
            attempts += 1
            bid, ask, _ = self.b.quotes[sym]
            px = ask if op == OP_BUY else bid
            ticket, err = self.b.order_send(sym, op, vol, px, int(cmd.get("slip", self.inp.max_slippage_points)),
                                            0.0 if two_step else sl, 0.0 if two_step else tp, comment, self.inp.magic)
            if ticket > 0:
                break
            if err == ERR_INVALID_STOPS and self.inp.allow_two_step_sl and not two_step:
                two_step = True
                continue
            if err in NOT_EXECUTED_RETRYABLE and attempts <= self.inp.max_entry_retries:
                if self.find_by_tag(tag) is not None:  # paranoia: never duplicate
                    break
                if self._guard(cmd):
                    break
                continue
            break
        o = self.b.orders.get(ticket) if ticket > 0 else None
        if o is None and ticket <= 0 and is_ambiguous(err):
            o = self.find_by_tag(tag)
            if o is None:
                self.write_result(seq, type="OPEN", id=sid, status="UNKNOWN", err=err, attempts=attempts,
                                  msg="ambiguous result - reconciling, will NOT retry")
                self.log("error", "OPEN_AMBIGUOUS", f"{sid} err {err}")
                return
        if o is None:
            self.gv["pending_reconcile"].pop(tag, None)
            self.gv["failed"] += 1
            self.write_result(seq, type="OPEN", id=sid, status="REJECTED", err=err, attempts=attempts,
                              msg="broker rejected")
            return
        if two_step:
            ok = False
            for _ in range(3):
                if self.b.order_modify(o.ticket, sl, tp) == 0:
                    ok = True
                    break
            if not ok:
                self.b.order_close(o.ticket, reason="[noSL]")
                self.gv["pending_reconcile"].pop(tag, None)
                self.gv["tags"][tag] = o.ticket
                self.gv["entries"] += 1
                self.write_result(seq, type="OPEN", id=sid, status="REJECTED", ticket=o.ticket,
                                  msg="stop-loss could not be attached - position closed immediately")
                self.log("critical", "PROTECTION_FAILED", f"ticket {o.ticket} closed: SL could not be set")
                return
        self._confirm_fill(seq, sid, tag, o, attempts)

    def _confirm_fill(self, seq: int, sid: str, tag: str, o, attempts: int) -> None:
        self.gv["pending_reconcile"].pop(tag, None)
        self.gv["tags"][tag] = o.ticket
        self.gv["r"][str(o.ticket)] = abs(o.open_price - o.sl) if o.sl > 0 else 0.0
        self.gv["entries"] += 1
        self.write_result(seq, type="OPEN", id=sid, status="FILLED", ticket=o.ticket, price=o.open_price,
                          volume=o.lots, sl=o.sl, tp=o.tp, attempts=attempts)

    def _reconcile_pending(self) -> None:
        for tag, info in list(self.gv["pending_reconcile"].items()):
            o = self.find_by_tag(tag)
            if o is not None:
                self.gv["pending_reconcile"].pop(tag)
                self.gv["tags"][tag] = o.ticket
                self.gv["entries"] += 1
                self.log("warning", "RECONCILED", f"{info['id']} found as ticket {o.ticket}")
            elif self.now.timestamp() - info["since"] > self.inp.reconcile_window_s:
                self.gv["pending_reconcile"].pop(tag)
                self.gv["failed"] += 1
                self.log("error", "NOT_FOUND", f"{info['id']} not found after reconcile window")

    # ------------------------------------------------------------------ outputs
    def _write_bars(self) -> None:
        now = pd.Timestamp(self.now)
        for sym, m1 in self.m1.items():
            end_i = m1.index.searchsorted(now, side="left")
            if end_i == 0:
                continue
            for tf in self.inp.bars_timeframes:
                minutes = TF_MINUTES[tf]
                last_open = now.floor(f"{minutes}min") - pd.Timedelta(minutes=minutes)
                key = (sym, tf)
                if self._last_bar.get(key) == last_open.value:
                    continue  # no newly completed bar: nothing to rewrite
                start_i = m1.index.searchsorted(last_open - pd.Timedelta(minutes=minutes * (self.inp.bars_count + 5)))
                bars = resample(m1.iloc[start_i:end_i], tf)
                bars = bars[bars["close_time"] <= pd.Timestamp(self.now)].tail(self.inp.bars_count)
                if bars.empty:
                    continue
                out = pd.DataFrame({
                    "time": (bars.index.as_unit("s").asi8 + self.offset_s),
                    "open": bars["open"], "high": bars["high"], "low": bars["low"], "close": bars["close"],
                    "volume": bars.get("volume", 0), "spread": 0})
                atomic_write(self.root / "bars" / f"{sym}_{tf}.csv", out.to_csv(index=False))
                self._last_bar[key] = last_open.value

    def _write_state(self) -> None:
        self.seq += 1
        b, inp = self.b, self.inp
        now_s = self.server_epoch(self.now)
        syms = []
        for s in inp.symbols:
            if s not in b.specs:
                continue
            sp = b.spec(s)
            q = b.quotes.get(s)
            syms.append({
                "name": sp.broker_name, "canonical": s, "base": sp.base, "profit_ccy": sp.quote,
                "bid": q[0] if q else 0, "ask": q[1] if q else 0,
                "tick_time": self.server_epoch(q[2]) if q else 0, "digits": sp.digits, "point": sp.point,
                "tick_size": sp.tick_size, "tick_value": sp.tick_value, "contract_size": sp.contract_size,
                "min_lot": sp.min_lot, "max_lot": sp.max_lot, "lot_step": sp.lot_step,
                "stop_level": sp.stop_level_points, "freeze_level": sp.freeze_level_points,
                "margin_required": sp.margin_per_lot, "trade_allowed": sp.trade_allowed and s not in b.closed_symbols,
                "swap_long": 0, "swap_short": 0})

        def order_dict(o) -> dict:
            d = {"ticket": o.ticket, "symbol": b.specs[o.symbol].broker_name if o.symbol in b.specs else o.symbol,
                 "type": o.type, "lots": o.lots, "open_price": o.open_price,
                 "open_time": self.server_epoch(o.open_time), "sl": o.sl, "tp": o.tp,
                 "profit": b._floating(o) if o.ticket in b.orders else o.profit,
                 "swap": o.swap, "commission": o.commission, "magic": o.magic, "comment": o.comment}
            if o.close_time is not None:
                d["close_time"] = self.server_epoch(o.close_time)
                d["close_price"] = o.close_price
            return d

        state = {
            "v": PROTOCOL_VERSION, "seq": self.seq,
            "time": {"server": now_s, "gmt": int(self.now.timestamp()), "local": int(self.now.timestamp())},
            "account": {"login": b.login, "server": "SimBroker-Demo", "company": "fxai simulator",
                        "currency": b.account_currency, "leverage": b.leverage, "balance": b.balance,
                        "equity": b.equity, "margin": b.margin, "free_margin": b.equity - b.margin,
                        "is_demo": b.is_demo, "trade_allowed": b.trade_allowed, "connected": b.connected},
            "ea": {"version": EA_VERSION, "master": True, "trading_enabled": inp.enable_trading,
                   "live_allowed": inp.allow_live_account, "estop": self.gv["estop"], "paused": self.gv["paused"],
                   "halted": self.gv["halt"], "halt_reason": self.gv["halt_reason"], "day_id": self.gv["day"],
                   "day_start_equity": self.gv["dse"], "net_flows": self.gv["flows"],
                   "daily_loss_pct": self.daily_loss_pct(), "entries_today": self.gv["entries"],
                   "failed_today": self.gv["failed"], "modifications_today": self.gv["mods"],
                   "partial_closes_today": self.gv["partials"], "py_heartbeat_age": self.py_heartbeat_age(),
                   "last_cmd_seq": self.gv["last_seq"],
                   "limits": {"risk_per_trade_pct": inp.max_risk_per_trade_pct,
                              "total_risk_pct": inp.max_total_risk_pct, "max_positions": inp.max_open_positions,
                              "max_entries": inp.max_entries_per_day, "daily_loss_pct": inp.max_daily_loss_pct}},
            "symbols": syms,
            "orders": [order_dict(o) for o in b.orders.values()],
            "history": [order_dict(o) for o in b.history[-200:]],
            "events": self.events[-20:],
        }
        atomic_write(self.root / "state.json", json.dumps(state))


def inputs_dict(inp: EAInputs) -> dict:
    return asdict(inp)


def replay_quotes(m1: dict[str, pd.DataFrame], spreads_points: dict[str, float], points: dict[str, float],
                  t: pd.Timestamp) -> dict[str, tuple[float, float]]:
    """Bid/ask at minute ``t`` from mid-price M1 data (last close at or before t)."""
    out = {}
    for s, df in m1.items():
        i = df.index.searchsorted(t, side="right") - 1
        if i < 0:
            continue
        mid = float(df["close"].iloc[i])
        half = spreads_points.get(s, 10) * points[s] / 2
        out[s] = (mid - half, mid + half)
    return out


__all__ = ["EAEmulator", "EAInputs", "replay_quotes", "inputs_dict", "timedelta"]
