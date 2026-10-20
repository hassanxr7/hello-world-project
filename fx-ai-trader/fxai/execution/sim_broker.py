"""Simulated MT4-style broker for tests and paper trading.

Implements MT4 order semantics closely enough to exercise the execution path:
integer tickets, OP_BUY/OP_SELL, SL/TP set on the order and triggered by the
broker, stop-level checks, requotes beyond the allowed slippage, margin
checks, partial closes that create a new ticket ("from #<ticket>"), balance
operations in history, and **failure injection** - including the ambiguous
case where the order is executed but the terminal reports an error (e.g. 128
trade timeout). It is a simulator: it does not model a real broker's dealing
desk, liquidity or latency.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime

from ..domain import SymbolSpec
from ..symbols import conversion_rate

OP_BUY, OP_SELL = 0, 1
ERR_NO_ERROR = 0
ERR_NO_RESULT = 1
ERR_COMMON = 2
ERR_SERVER_BUSY = 4
ERR_NO_CONNECTION = 6
ERR_TRADE_TIMEOUT = 128
ERR_INVALID_PRICE = 129
ERR_INVALID_STOPS = 130
ERR_INVALID_VOLUME = 131
ERR_MARKET_CLOSED = 132
ERR_TRADE_DISABLED = 133
ERR_NOT_ENOUGH_MONEY = 134
ERR_PRICE_CHANGED = 135
ERR_OFF_QUOTES = 136
ERR_REQUOTE = 138
ERR_FREEZE = 145
ERR_CONTEXT_BUSY = 146

# Errors after which the order was definitely NOT executed (safe to retry with a fresh price).
NOT_EXECUTED_RETRYABLE = {ERR_PRICE_CHANGED, ERR_OFF_QUOTES, ERR_REQUOTE, ERR_CONTEXT_BUSY}
NOT_EXECUTED_FINAL = {ERR_INVALID_PRICE, ERR_INVALID_STOPS, ERR_INVALID_VOLUME, ERR_MARKET_CLOSED,
                      ERR_TRADE_DISABLED, ERR_NOT_ENOUGH_MONEY}


def is_ambiguous(err: int) -> bool:
    """Outcome unknown: must reconcile before any retry."""
    return err not in NOT_EXECUTED_RETRYABLE and err not in NOT_EXECUTED_FINAL and err != ERR_NO_ERROR


@dataclass
class SimOrder:
    ticket: int
    symbol: str
    type: int
    lots: float
    open_price: float
    open_time: datetime
    sl: float
    tp: float
    magic: int
    comment: str
    commission: float = 0.0
    swap: float = 0.0
    close_price: float = 0.0
    close_time: datetime | None = None
    profit: float = 0.0


@dataclass
class Injection:
    op: str  # send | modify | close
    err: int
    executed: bool = False
    times: int = 1


@dataclass
class SimBroker:
    specs: dict[str, SymbolSpec]
    account_currency: str = "USD"
    balance: float = 10_000.0
    leverage: int = 100
    commission_per_lot_rt: float = 7.0
    fill_slippage_points: float = 0.0  # adverse slippage applied to market fills
    connected: bool = True
    trade_allowed: bool = True
    is_demo: bool = True
    login: int = 900001
    quotes: dict[str, tuple[float, float, datetime]] = field(default_factory=dict)
    orders: dict[int, SimOrder] = field(default_factory=dict)
    history: list[SimOrder] = field(default_factory=list)
    injections: list[Injection] = field(default_factory=list)
    closed_symbols: set[str] = field(default_factory=set)
    reject_stops_on_entry: bool = False  # emulate "market execution" brokers that refuse SL/TP on entry
    _next_ticket: int = 1000
    now: datetime | None = None

    # ---------------------------------------------------------------- market data
    def set_quote(self, symbol: str, bid: float, ask: float, t: datetime) -> None:
        self.quotes[symbol] = (bid, ask, t)
        self.now = t
        self._check_stops(symbol)

    def prices(self) -> dict[str, float]:
        return {s: (b + a) / 2 for s, (b, a, _) in self.quotes.items()}

    def spec(self, symbol: str) -> SymbolSpec:
        s = self.specs[symbol]
        try:
            rate = conversion_rate(s.quote, self.account_currency, self.prices())
            tv = s.tick_size * s.contract_size * rate
            base_rate = conversion_rate(s.base, self.account_currency, self.prices())
            margin = s.contract_size * base_rate / self.leverage
            return replace(s, tick_value=tv, margin_per_lot=margin)
        except KeyError:
            return s

    def _vpu(self, symbol: str) -> float:
        return self.spec(symbol).value_per_price_unit

    # ---------------------------------------------------------------- account
    def _floating(self, o: SimOrder) -> float:
        bid, ask, _ = self.quotes[o.symbol]
        px = bid if o.type == OP_BUY else ask
        return (px - o.open_price) * (1 if o.type == OP_BUY else -1) * o.lots * self._vpu(o.symbol)

    @property
    def equity(self) -> float:
        return self.balance + sum(self._floating(o) + o.swap + o.commission for o in self.orders.values())

    @property
    def margin(self) -> float:
        return sum(o.lots * self.spec(o.symbol).margin_per_lot for o in self.orders.values())

    def deposit(self, amount: float, comment: str = "deposit") -> int:
        self.balance += amount
        t = self._ticket()
        self.history.append(SimOrder(t, "", 6, 0.0, 0.0, self.now or datetime.now(), 0, 0, 0, comment,
                                     profit=amount, close_time=self.now))
        return t

    # ---------------------------------------------------------------- injection
    def inject(self, op: str, err: int, executed: bool = False, times: int = 1) -> None:
        self.injections.append(Injection(op, err, executed, times))

    def _take_injection(self, op: str) -> Injection | None:
        for inj in self.injections:
            if inj.op == op:
                inj.times -= 1
                if inj.times <= 0:
                    self.injections.remove(inj)
                return inj
        return None

    def _ticket(self) -> int:
        self._next_ticket += 1
        return self._next_ticket

    # ---------------------------------------------------------------- trading
    def _stops_ok(self, symbol: str, side: int, sl: float, tp: float) -> bool:
        s = self.specs[symbol]
        bid, ask, _ = self.quotes[symbol]
        lvl = s.stop_level_points * s.point
        ref = bid if side == OP_BUY else ask
        if sl > 0 and ((side == OP_BUY and sl > ref - lvl) or (side == OP_SELL and sl < ref + lvl)):
            return False
        if tp > 0 and ((side == OP_BUY and tp < ref + lvl) or (side == OP_SELL and tp > ref - lvl)):
            return False
        return True

    def order_send(self, symbol: str, cmd: int, volume: float, price: float, slippage_points: int,
                   sl: float, tp: float, comment: str, magic: int) -> tuple[int, int]:
        """Returns (ticket, error). ticket = -1 on failure."""
        inj = self._take_injection("send")
        if not self.connected:
            return -1, ERR_NO_CONNECTION
        if symbol not in self.quotes or symbol in self.closed_symbols:
            return -1, ERR_MARKET_CLOSED
        if not self.trade_allowed or not self.specs[symbol].trade_allowed:
            return -1, ERR_TRADE_DISABLED
        s = self.specs[symbol]
        steps = round(volume / s.lot_step, 6)
        if volume < s.min_lot - 1e-9 or volume > s.max_lot + 1e-9 or abs(steps - round(steps)) > 1e-6:
            return -1, ERR_INVALID_VOLUME
        bid, ask, t = self.quotes[symbol]
        cur = ask if cmd == OP_BUY else bid
        if abs(cur - price) > slippage_points * s.point + 1e-12:
            return -1, ERR_REQUOTE
        if not self._stops_ok(symbol, cmd, sl, tp):
            return -1, ERR_INVALID_STOPS
        if self.reject_stops_on_entry and (sl > 0 or tp > 0):
            return -1, ERR_INVALID_STOPS
        req_margin = volume * self.spec(symbol).margin_per_lot
        if self.equity - self.margin - req_margin <= 0:
            return -1, ERR_NOT_ENOUGH_MONEY
        if inj is not None and not inj.executed:
            return -1, inj.err
        fill = cur + (1 if cmd == OP_BUY else -1) * self.fill_slippage_points * s.point
        ticket = self._ticket()
        self.orders[ticket] = SimOrder(ticket, symbol, cmd, volume, round(fill, s.digits), t, sl, tp, magic,
                                       comment[:31], commission=-self.commission_per_lot_rt * volume)
        if inj is not None and inj.executed:
            return -1, inj.err  # executed, but the terminal reports an error (ambiguous)
        return ticket, ERR_NO_ERROR

    def order_modify(self, ticket: int, sl: float, tp: float) -> int:
        inj = self._take_injection("modify")
        if inj is not None and not inj.executed:
            return inj.err
        o = self.orders.get(ticket)
        if o is None:
            return ERR_INVALID_PRICE
        if abs(o.sl - sl) < 1e-12 and abs(o.tp - tp) < 1e-12:
            return ERR_NO_RESULT
        s = self.specs[o.symbol]
        bid, ask, _ = self.quotes[o.symbol]
        frz = s.freeze_level_points * s.point
        ref = bid if o.type == OP_BUY else ask
        if frz > 0 and ((o.sl > 0 and abs(ref - o.sl) <= frz) or (o.tp > 0 and abs(ref - o.tp) <= frz)):
            return ERR_FREEZE
        if not self._stops_ok(o.symbol, o.type, sl, tp):
            return ERR_INVALID_STOPS
        o.sl, o.tp = sl, tp
        return ERR_NO_ERROR

    def order_close(self, ticket: int, lots: float | None = None, reason: str = "") -> int:
        inj = self._take_injection("close")
        if inj is not None and not inj.executed:
            return inj.err
        o = self.orders.get(ticket)
        if o is None:
            return ERR_INVALID_PRICE
        bid, ask, t = self.quotes[o.symbol]
        px = bid if o.type == OP_BUY else ask
        self._close(o, px, t, lots, reason)
        return ERR_NO_ERROR

    def _close(self, o: SimOrder, px: float, t: datetime, lots: float | None = None, reason: str = "") -> None:
        lots = o.lots if lots is None or lots >= o.lots - 1e-9 else lots
        frac = lots / o.lots
        profit = (px - o.open_price) * (1 if o.type == OP_BUY else -1) * lots * self._vpu(o.symbol)
        closed = replace(o, lots=lots, close_price=px, close_time=t, profit=profit,
                         commission=o.commission * frac, swap=o.swap * frac,
                         comment=(o.comment + reason)[:31])
        self.balance += profit + closed.commission + closed.swap
        self.history.append(closed)
        del self.orders[o.ticket]
        if lots < o.lots - 1e-9:  # partial close: remainder gets a new ticket
            nt = self._ticket()
            self.orders[nt] = replace(o, ticket=nt, lots=round(o.lots - lots, 2), commission=o.commission * (1 - frac),
                                      swap=o.swap * (1 - frac), comment=f"from #{o.ticket}")

    def _check_stops(self, symbol: str) -> None:
        bid, ask, t = self.quotes[symbol]
        for o in list(self.orders.values()):
            if o.symbol != symbol:
                continue
            if o.type == OP_BUY:
                if o.sl > 0 and bid <= o.sl:
                    self._close(o, min(bid, o.sl) if bid < o.sl else o.sl, t, reason="[sl]")
                elif o.tp > 0 and bid >= o.tp:
                    self._close(o, o.tp, t, reason="[tp]")
            else:
                if o.sl > 0 and ask >= o.sl:
                    self._close(o, max(ask, o.sl) if ask > o.sl else o.sl, t, reason="[sl]")
                elif o.tp > 0 and ask <= o.tp:
                    self._close(o, o.tp, t, reason="[tp]")
