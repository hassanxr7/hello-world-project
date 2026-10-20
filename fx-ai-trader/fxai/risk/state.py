"""Persistent risk state: daily counters, halts, emergency stop, cooldowns.

Persisted to SQLite after every change so a restart resumes with the same
counters. The EA keeps its own copy (GlobalVariables + file) and is the final
authority; when both are available the stricter view wins (e.g. the larger
entry count, either side's emergency stop).

Daily loss (documented in docs/RISK.md):

    daily_pnl      = equity_now - day_start_equity - net_cash_flows_today
    daily_loss_pct = max(0, -daily_pnl) / day_start_equity * 100

equity includes floating P&L, swaps and commissions; deposits/withdrawals and
credit operations since the reset are removed so they neither trigger nor mask
a loss.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any

from ..timeutil import as_utc

_KEY = "risk_state"


def daily_loss_pct(equity: float, day_start_equity: float, net_flows: float) -> float:
    if day_start_equity <= 0:
        return 0.0
    pnl = equity - day_start_equity - net_flows
    return max(0.0, -pnl) / day_start_equity * 100.0


@dataclass
class RiskState:
    day_id: str = ""
    day_start_equity: float = 0.0
    net_flows_today: float = 0.0
    entries_today: int = 0
    failed_attempts_today: int = 0
    modifications_today: int = 0
    partial_closes_today: int = 0
    daily_loss_halt: bool = False
    daily_loss_handled: bool = False  # pending-cancel / close-all already issued
    halt_reason: str = ""
    estop: bool = False
    estop_reason: str = ""
    paused: bool = False
    consecutive_losses: int = 0
    pause_until: str | None = None  # ISO UTC; consecutive-loss pause
    last_entry_time: dict[str, str] = field(default_factory=dict)
    last_loss_time: dict[str, str] = field(default_factory=dict)
    seen_closed_tickets: list[int] = field(default_factory=list)
    seen_flow_tickets: list[int] = field(default_factory=list)

    # -- persistence -------------------------------------------------------------
    @classmethod
    def load(cls, storage: Any) -> "RiskState":
        raw = storage.kv_get(_KEY)
        if not raw:
            return cls()
        known = {k: v for k, v in raw.items() if k in cls.__dataclass_fields__}
        return cls(**known)

    def save(self, storage: Any) -> None:
        # Bound the de-duplication lists.
        self.seen_closed_tickets = self.seen_closed_tickets[-2000:]
        self.seen_flow_tickets = self.seen_flow_tickets[-500:]
        storage.kv_set(_KEY, asdict(self))

    # -- day handling --------------------------------------------------------------
    def roll_if_needed(self, day_id: str, equity: float) -> bool:
        """Start a new trading day. Emergency stop and pause are NOT cleared."""
        if day_id == self.day_id:
            return False
        self.day_id = day_id
        self.day_start_equity = equity
        self.net_flows_today = 0.0
        self.entries_today = 0
        self.failed_attempts_today = 0
        self.modifications_today = 0
        self.partial_closes_today = 0
        self.daily_loss_halt = False
        self.daily_loss_handled = False
        self.halt_reason = ""
        return True

    def add_cash_flow(self, ticket: int, amount: float) -> bool:
        if ticket in self.seen_flow_tickets:
            return False
        self.seen_flow_tickets.append(ticket)
        self.net_flows_today += amount
        return True

    def current_daily_loss_pct(self, equity: float) -> float:
        return daily_loss_pct(equity, self.day_start_equity, self.net_flows_today)

    def check_daily_loss(self, equity: float, limit_pct: float) -> bool:
        """Latch the halt when the threshold is reached. Returns True on a new trigger."""
        if self.daily_loss_halt:
            return False
        loss = self.current_daily_loss_pct(equity)
        if loss >= limit_pct:
            self.daily_loss_halt = True
            self.halt_reason = f"daily loss {loss:.2f}% >= {limit_pct:.2f}%"
            return True
        return False

    # -- counters -------------------------------------------------------------------
    def record_entry(self, symbol: str, when: datetime) -> None:
        self.entries_today += 1
        self.last_entry_time[symbol] = as_utc(when).isoformat()

    def record_failed_attempt(self) -> None:
        self.failed_attempts_today += 1

    def record_modification(self) -> None:
        self.modifications_today += 1

    def record_partial_close(self) -> None:
        self.partial_closes_today += 1

    def record_closed_trade(self, ticket: int, symbol: str, net_profit: float, when: datetime,
                            max_consecutive: int, pause_minutes: int) -> bool:
        """Update loss streak / cooldown once per ticket. Returns True if a
        consecutive-loss pause was started."""
        if ticket in self.seen_closed_tickets:
            return False
        self.seen_closed_tickets.append(ticket)
        if net_profit < 0:
            self.consecutive_losses += 1
            self.last_loss_time[symbol] = as_utc(when).isoformat()
            if self.consecutive_losses >= max_consecutive:
                self.pause_until = (as_utc(when) + timedelta(minutes=pause_minutes)).isoformat()
                self.consecutive_losses = 0
                return True
        else:
            self.consecutive_losses = 0
        return False

    # -- queries -----------------------------------------------------------------------
    def in_loss_pause(self, now: datetime) -> bool:
        return bool(self.pause_until) and as_utc(now) < datetime.fromisoformat(self.pause_until)  # type: ignore[arg-type]

    def minutes_since(self, mapping: dict[str, str], symbol: str, now: datetime) -> float | None:
        t = mapping.get(symbol)
        if not t:
            return None
        return (as_utc(now) - datetime.fromisoformat(t)).total_seconds() / 60.0
