"""Command lifecycle, idempotency and reconciliation (Python side).

Guarantees
- One OPEN command per signal id, enforced by a UNIQUE index in SQLite, so a
  restart or a bug cannot submit the same signal twice.
- The command row is written (QUEUED) BEFORE the command file is created
  (write-ahead), then marked SENT.
- An entry whose outcome is unknown (timeout, ambiguous broker error, lost
  result file) is NEVER re-sent. It is reconciled against the broker's open
  orders and history (matching the "FXAI|<tag>" comment) until it is found
  (-> FILLED) or the reconcile window expires (-> NOT_FOUND).
- Entries count toward the daily cap only once they are confirmed FILLED.
  Failed attempts, modifications and partial closes are counted separately.

Status flow for OPEN:
  QUEUED -> SENT -> FILLED | REJECTED | EXPIRED | DUPLICATE
                 -> UNKNOWN/UNACKED -> FILLED (reconciled) | NOT_FOUND
         -> SEND_FAILED (file never written)   SENT -> WITHDRAWN (deleted before pickup)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable

from ..bridge.file_bridge import FileBridge
from ..bridge.protocol import BridgeState, make_command, order_comment, signal_tag
from ..domain import RiskDecision, TradeIntent
from ..storage import Storage
from ..timeutil import utcnow

INFLIGHT = ("QUEUED", "SENT", "UNACKED", "UNKNOWN")
TERMINAL = ("FILLED", "REJECTED", "EXPIRED", "DUPLICATE", "NOT_FOUND", "SEND_FAILED", "WITHDRAWN", "DONE", "ERROR")


@dataclass
class FillEvent:
    seq: int
    signal_id: str
    symbol: str
    ticket: int
    reconciled: bool


class OrderManager:
    def __init__(self, storage: Storage, bridge: FileBridge, magic: int, ttl_s: int, ack_timeout_s: int,
                 reconcile_timeout_s: int = 180, clock: Callable[[], datetime] = utcnow):
        self.st = storage
        self.bridge = bridge
        self.magic = magic
        self.ttl_s = ttl_s
        self.ack_timeout_s = ack_timeout_s
        self.reconcile_timeout_s = reconcile_timeout_s
        self.clock = clock

    # ------------------------------------------------------------------ submit
    def submit_open(self, intent: TradeIntent, decision: RiskDecision, day_id: str, slippage_points: int,
                    max_dev_points: int) -> int | None:
        if self.st.open_command_for_signal(intent.signal_id) is not None:
            self.st.log_event("warning", "orders", "DUPLICATE_SIGNAL", f"signal {intent.signal_id} already submitted")
            return None
        seq = self.st.next_command_seq()
        cmd = make_command(
            "OPEN", seq, int(self.clock().timestamp()), self.ttl_s, id=intent.signal_id,
            tag=signal_tag(intent.signal_id), symbol=intent.symbol, side=intent.side.value, volume=decision.volume,
            sl=intent.stop_loss, tp=intent.take_profit, ref=intent.entry_price, maxdev=max_dev_points,
            maxrisk=round(decision.planned_risk_money * 1.0, 2), slip=slippage_points, magic=self.magic,
            **{k: v for k, v in intent.exit_params.items()})
        payload = {**cmd, "planned_risk": decision.planned_risk_money, "comment": order_comment(intent.signal_id)}
        try:
            self.st.insert_command(seq, "OPEN", payload, intent.signal_id, intent.symbol, day_id, "QUEUED")
        except Exception as e:  # UNIQUE violation -> duplicate prevented
            self.st.log_event("warning", "orders", "DUPLICATE_SIGNAL", f"{intent.signal_id}: {e}")
            return None
        return self._send(seq, cmd)

    def submit_control(self, ctype: str, day_id: str | None = None, symbol: str | None = None,
                       signal_id: str | None = None, **fields) -> int | None:
        seq = self.st.next_command_seq()
        cmd = make_command(ctype, seq, int(self.clock().timestamp()), max(self.ttl_s, 60), **fields)
        self.st.insert_command(seq, ctype, cmd, signal_id, symbol, day_id, "QUEUED")
        return self._send(seq, cmd)

    def _send(self, seq: int, cmd: dict) -> int | None:
        try:
            self.bridge.send(cmd)
        except Exception as e:
            # The file was never created, so the EA cannot act on it.
            self.st.update_command(seq, "SEND_FAILED", {"error": str(e)})
            self.st.log_event("error", "orders", "SEND_FAILED", f"seq {seq}: {e}")
            return None
        self.st.update_command(seq, "SENT", sent=True)
        return seq

    # ------------------------------------------------------------------ inflight view
    def inflight_entries(self) -> list[dict]:
        return [c for c in self.st.commands_by_status(*INFLIGHT) if c["type"] == "OPEN"]

    def inflight_symbols_and_risk(self) -> tuple[set[str], float]:
        rows = self.inflight_entries()
        return {r["symbol"] for r in rows}, sum(float(r["payload"].get("planned_risk", 0)) for r in rows)

    # ------------------------------------------------------------------ results
    def process_results(self, on_fill: Callable[[FillEvent, dict], None],
                        on_counter: Callable[[str], None]) -> list[dict]:
        applied = []
        for res in self.bridge.poll_results():
            try:
                seq = int(res["seq"])
            except (KeyError, ValueError):
                continue
            cmd = self.st.command(seq)
            if cmd is None:
                self.st.log_event("warning", "orders", "UNKNOWN_RESULT", f"result for unknown seq {seq}", res)
                continue
            status = res.get("status", "ERROR")
            ticket = int(res.get("ticket", 0) or 0) or None
            prev = cmd["status"]
            if prev in ("FILLED", "DONE"):
                continue  # idempotent: a result file may be read twice
            if cmd["type"] == "OPEN":
                if status == "FILLED":
                    self.st.update_command(seq, "FILLED", res, ticket)
                    on_fill(FillEvent(seq, cmd["signal_id"], cmd["symbol"], ticket or 0, False), cmd)
                elif status == "UNKNOWN":
                    self.st.update_command(seq, "UNKNOWN", res)
                    self.st.log_event("error", "orders", "AMBIGUOUS", f"seq {seq} outcome unknown - reconciling", res)
                elif status == "DUPLICATE":
                    self.st.update_command(seq, "DUPLICATE", res, ticket)
                else:
                    self.st.update_command(seq, status if status in TERMINAL else "ERROR", res)
                    on_counter("failed")
                    self.st.log_event("warning", "orders", f"OPEN_{status}", res.get("msg", ""), res)
            else:
                final = "DONE" if status == "DONE" else (status if status in TERMINAL else "ERROR")
                self.st.update_command(seq, final, res, ticket)
                if final == "DONE" and cmd["type"] == "MODIFY":
                    on_counter("modification")
                if final == "DONE" and cmd["type"] == "CLOSE" and float(cmd["payload"].get("volume", 0) or 0) > 0:
                    on_counter("partial_close")
            applied.append(res)
        return applied

    # ------------------------------------------------------------------ timeouts & reconciliation
    def reconcile(self, state: BridgeState | None, on_fill: Callable[[FillEvent, dict], None],
                  on_counter: Callable[[str], None]) -> None:
        now = self.clock().timestamp()
        for cmd in self.st.commands_by_status("SENT", "UNACKED", "UNKNOWN"):
            created = float(cmd["payload"].get("created", now))
            age = now - created
            seq = cmd["seq"]
            if cmd["status"] in ("SENT", "UNACKED") and self.bridge.command_pending(seq):
                # The EA has not consumed the file. Once it is past its TTL the EA would
                # reject it anyway; deleting it makes that certain.
                if age > float(cmd["payload"].get("ttl", self.ttl_s)) + 5 and self.bridge.withdraw(seq):
                    self.st.update_command(seq, "WITHDRAWN", {"msg": "EA did not pick up the command"})
                    self.st.log_event("warning", "orders", "WITHDRAWN", f"seq {seq} withdrawn (EA not consuming)")
                elif cmd["status"] == "SENT" and age >= self.ack_timeout_s:
                    self.st.update_command(seq, "UNACKED", {"msg": "EA has not consumed the command"})
                continue
            if cmd["status"] == "SENT":
                if age < self.ack_timeout_s:
                    continue
                self.st.update_command(seq, "UNACKED", {"msg": "no result within ack timeout"})
                self.st.log_event("warning", "orders", "UNACKED", f"seq {seq} has no result after {age:.0f}s")
            if cmd["type"] != "OPEN":
                if age > self.reconcile_timeout_s:
                    self.st.update_command(seq, "ERROR", {"msg": "no result for control command"})
                continue
            if state is None:
                continue
            tag = cmd["payload"].get("tag") or signal_tag(cmd["signal_id"])
            ticket = self.find_ticket(state, tag)
            if ticket:
                self.st.update_command(seq, "FILLED", {"reconciled": True}, ticket)
                self.st.log_event("warning", "orders", "RECONCILED", f"seq {seq} found at broker as #{ticket}")
                on_fill(FillEvent(seq, cmd["signal_id"], cmd["symbol"], ticket, True), cmd)
            elif age > self.reconcile_timeout_s and state.ea.last_cmd_seq >= seq:
                self.st.update_command(seq, "NOT_FOUND", {"msg": "not at broker after reconcile window"})
                self.st.log_event("error", "orders", "NOT_FOUND", f"seq {seq} ({cmd['signal_id']}) not found; not retried")
                on_counter("failed")

    def find_ticket(self, state: BridgeState, tag: str) -> int | None:
        needle = "FXAI|" + tag
        for p in state.positions:
            if p.magic == self.magic and needle in p.comment:
                return p.ticket
        for h in state.history:
            if h.magic == self.magic and needle in h.comment:
                return h.ticket
        return None
