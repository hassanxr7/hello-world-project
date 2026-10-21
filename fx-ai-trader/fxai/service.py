"""The trading service main loop (runs ~1x per second).

Each iteration:
 1. read the EA snapshot (account, quotes, positions, history, EA status)
 2. assess bridge health (EA heartbeat, connection, master instance, quote age)
 3. write the Python heartbeat (the EA blocks new entries if it goes stale)
 4. apply dashboard control requests (pause/resume/estop/limits/close-all)
 5. sync risk state and trades with the broker; process command results;
    reconcile unknown outcomes (never blind-retry)
 6. safety actions: daily-loss halt, emergency stop propagation
 7. for each symbol with a NEWLY COMPLETED entry-timeframe bar: strategy ->
    (news blackout) -> (ML meta-filter) -> risk engine -> (LLM review) ->
    risk engine again with fresh state -> submit; every decision (incl. WAIT
    and its reasons) is stored once per bar. Signals arriving in the same step
    are ranked (attention score, then spread cost per R) before the risk engine
    sees them, so the limits admit the best-conditioned ones first
 8. at least once per minute: opportunity scan of every pair (trend, structure,
    candles, volatility, spread, session, exposure, execution quality, events)
    and the watchlist lifecycle (active -> triggered / expired / invalidated)
 9. write the status snapshot for the dashboard

Monitoring runs every second; decisions only happen on completed bars.
Protective logic (SL on the broker, break-even/trailing, daily-loss halt,
emergency stop) lives in the EA and keeps working if this process stops.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

import numpy as np
import pandas as pd

from . import __version__
from .bridge.file_bridge import FileBridge
from .bridge.protocol import BridgeState, validate_exit_params
from .config import AppConfig
from .domain import Action, Side, TradeIntent
from .execution.order_manager import FillEvent, OrderManager
from .execution.tracker import TradeTracker
from .execution.watchlist import Watchlist
from .llm import LLMAnalyst, ReviewResult, apply_policy
from .ml import ModelRegistry
from .news import Calendar
from .risk import EffectiveLimits, RiskContext, RiskEngine, RiskState
from .risk.exposure import currency_exposure, exposure_items, position_risk_money, total_open_risk
from .analysis.scanner import assess_pair, rank
from .storage import Storage
from .strategy import StrategyOutput, build_strategy
from .timeutil import in_window, utcnow

log = logging.getLogger("fxai.service")


@dataclass
class PendingReview:
    future: Future
    intent: TradeIntent
    out: StrategyOutput
    submitted: float


class TradingService:
    def __init__(self, cfg: AppConfig, storage: Storage, bridge: FileBridge,
                 clock: Callable[[], datetime] = utcnow, analyst: LLMAnalyst | None = None,
                 calendar: Calendar | None = None, registry: ModelRegistry | None = None):
        self.cfg = cfg
        self.st = storage
        self.bridge = bridge
        self.clock = clock
        self.symbols = cfg.symbols.resolve()
        self.strategy = build_strategy(cfg)
        self.engine = RiskEngine(cfg.risk)
        self.om = OrderManager(storage, bridge, cfg.bridge.magic_number, cfg.bridge.command_ttl_s,
                               cfg.bridge.ack_timeout_s, clock=clock)
        self.tracker = TradeTracker(storage, cfg.risk)
        self.risk = RiskState.load(storage)
        self.calendar = calendar or Calendar(cfg.news)
        self.analyst = analyst or LLMAnalyst(cfg.llm, storage, clock=clock)
        self.registry = registry or ModelRegistry(cfg.ml.registry_dir, storage)
        self.model = None
        self.model_error = ""
        if cfg.ml.enabled:
            try:
                self.model = self.registry.load_approved()
                if self.model is None:
                    self.model_error = "ml.enabled but no approved model - entries blocked"
            except Exception as e:
                self.model_error = f"approved model failed to load: {e}"
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="llm")
        self.pending: dict[str, PendingReview] = {}
        self.last_decided: dict[str, pd.Timestamp] = {}
        self.latest: dict[str, dict[str, Any]] = {}
        self.state: BridgeState | None = None
        self.health: dict[str, Any] = {"healthy": False, "detail": "starting"}
        self.hb_seq = 0
        self.started = clock()
        self._last_equity_ts = 0.0
        self._estop_sent = False
        self._estop_clear_until = 0.0  # ignore the EA's stale estop flag while a clear is in flight
        self._corr: dict[tuple[str, str], float] | None = None
        self._corr_ts = 0.0
        self.loop_ms = 0.0
        self.watchlist = Watchlist(storage)
        self.scan: dict[str, Any] = {"at": None, "pairs": [], "note": "first scan pending"}
        self._last_scan_ts = 0.0
        self.st.log_event("info", "service", "START", f"fxai {__version__} mode={cfg.mode} "
                          f"strategy={self.strategy.full_version}")

    # ================================================================== loop
    def run_forever(self, stop: Callable[[], bool] = lambda: False) -> None:
        period = self.cfg.bridge.poll_interval_s
        while not stop():
            t0 = time.monotonic()
            try:
                self.step()
            except Exception as e:  # never let one bad iteration kill monitoring
                log.exception("step failed")
                self.st.log_event("error", "service", "STEP_EXCEPTION", repr(e)[:500])
            time.sleep(max(0.0, period - (time.monotonic() - t0)))

    def step(self) -> None:
        t0 = time.monotonic()
        now = self.clock()
        state = self.bridge.read_state()
        self.state = state
        self.health = self._health(state, now)
        self.hb_seq += 1
        try:
            self.bridge.write_heartbeat(self.hb_seq, self.cfg.mode, "ok" if self.health["healthy"] else "degraded")
        except OSError as e:
            self.st.log_event("warning", "bridge", "HEARTBEAT_WRITE", str(e))
        self._apply_controls(now)
        if state is not None:
            self._sync(state, now)
        self.om.process_results(self._on_fill, self._on_counter)
        self.om.reconcile(state, self._on_fill, self._on_counter)
        if state is not None:
            self._safety(state, now)
            if self.health["healthy"]:
                self._decide(state, now)
            self._process_reviews(state, now)
            if now.timestamp() - self._last_scan_ts >= self.cfg.strategy.scan_interval_s:
                self._last_scan_ts = now.timestamp()
                try:
                    self._scan(state, now)
                except Exception as e:  # the scan is advisory; never let it stop monitoring
                    log.exception("scan failed")
                    self.st.log_event("error", "scan", "SCAN_FAILED", repr(e)[:300])
        self.risk.save(self.st)
        self.loop_ms = (time.monotonic() - t0) * 1000
        self._write_status(state, now)

    # ================================================================== health
    def _health(self, state: BridgeState | None, now: datetime) -> dict[str, Any]:
        if state is None:
            return {"healthy": False, "detail": self.bridge.last_error or "no EA state", "state_age_s": None}
        age = now.timestamp() - state.gmt_time
        problems = []
        if age > self.cfg.bridge.ea_heartbeat_timeout_s:
            problems.append(f"EA snapshot is {age:.0f}s old")
        if not state.account.connected:
            problems.append("terminal not connected to broker")
        if not state.ea.instance_master:
            problems.append("EA instance is not the master (another chart holds the lock)")
        stale = [s for s, q in state.quotes.items() if s in self.symbols
                 and (now - q.time_utc).total_seconds() > self.cfg.risk.max_quote_age_s]
        detail = "; ".join(problems) if problems else "ok"
        return {"healthy": not problems, "detail": detail, "state_age_s": round(age, 1), "stale_quotes": stale}

    # ================================================================== controls
    def _apply_controls(self, now: datetime) -> None:
        for c in self.st.pending_controls():
            action, p, by = c["action"], c["params"], c["requested_by"] or "dashboard"
            day = self.risk.day_id or None
            try:
                if action == "pause":
                    self.risk.paused = True
                    self.om.submit_control("PAUSE", day)
                    result = "paused: no new entries (protection continues)"
                elif action == "resume":
                    self.risk.paused = False
                    self.om.submit_control("RESUME", day)
                    result = "resumed"
                elif action == "estop":
                    policy = p.get("policy", self.cfg.risk.emergency_stop_policy)
                    policy = "close_all" if policy == "close_all" else "hold"
                    self.risk.estop, self.risk.estop_reason = True, f"dashboard ({by})"
                    self.bridge.set_estop_flag(policy, by)
                    self.om.submit_control("ESTOP", day, action="set", policy=policy)
                    self._estop_sent = True
                    result = f"emergency stop set (policy {policy})"
                elif action == "estop_clear":
                    if p.get("confirm") != "CLEAR":
                        raise ValueError("type CLEAR to confirm")
                    self.bridge.clear_estop_flag()
                    self.om.submit_control("ESTOP", day, action="clear", confirm="CLEAR")
                    self.risk.estop, self.risk.estop_reason = False, ""
                    self._estop_sent = False
                    self._estop_clear_until = now.timestamp() + 60
                    result = "emergency stop cleared"
                elif action == "close_all":
                    self.om.submit_control("CLOSE_ALL", day, reason="dashboard")
                    result = "close-all sent for system positions"
                elif action == "set_limits":
                    result = self._set_limits(p, by)
                elif action == "clear_loss_pause":
                    self.risk.pause_until = None
                    self.risk.consecutive_losses = 0
                    result = "consecutive-loss pause cleared"
                else:
                    raise ValueError(f"unknown action {action}")
                self.st.resolve_control(c["id"], "applied", result)
                self.st.audit(by, action, {"params": p, "result": result})
                self.st.log_event("warning", "control", action.upper(), result)
            except Exception as e:
                self.st.resolve_control(c["id"], "rejected", str(e))
                self.st.log_event("warning", "control", "REJECTED", f"{action}: {e}")

    def _set_limits(self, p: dict[str, Any], by: str) -> str:
        hard = self.cfg.hard_limits
        allowed = {"risk_per_trade_pct": float, "max_total_risk_pct": float, "max_open_positions": int,
                   "max_daily_loss_pct": float, "max_entries_per_day": int}
        applied = []
        for k, v in p.items():
            if k not in allowed:
                raise ValueError(f"{k} cannot be changed from the dashboard")
            val = allowed[k](v)
            cap = getattr(hard, k)
            if not (0 < val <= cap) and not (k == "max_entries_per_day" and val == 0):
                raise ValueError(f"{k}={val} outside (0, {cap}] (hard limit from config file)")
            self.st.set_override(k, val, by)
            applied.append(f"{k}={val}")
        return "limits updated: " + ", ".join(applied)

    # ================================================================== sync
    def _sync(self, state: BridgeState, now: datetime) -> None:
        ea = state.ea
        if ea.day_id and ea.day_id != self.risk.day_id:
            self.risk.roll_if_needed(ea.day_id, ea.day_start_equity or state.account.equity)
            self.st.log_event("info", "risk", "DAY_ROLL", f"trading day {ea.day_id} start equity "
                              f"{self.risk.day_start_equity:.2f}")
        if ea.day_start_equity > 0:
            self.risk.day_start_equity = ea.day_start_equity
        self.risk.net_flows_today = ea.net_flows
        for note in self.tracker.sync(state, self.risk):
            self.st.log_event("info", "trades", "SYNC", note)
        clearing = now.timestamp() < self._estop_clear_until
        if not ea.estop:
            self._estop_clear_until = 0.0
        if ea.estop and not self.risk.estop and not clearing:
            self.risk.estop, self.risk.estop_reason = True, "EA reported emergency stop"
            self.st.log_event("critical", "risk", "ESTOP", "EA reports emergency stop active")
        if ea.halted and not self.risk.daily_loss_halt:
            self.risk.daily_loss_halt, self.risk.halt_reason = True, ea.halt_reason or "EA daily-loss halt"

    def _on_fill(self, ev: FillEvent, cmd: dict) -> None:
        self.risk.record_entry(ev.symbol, self.clock())
        self.st.update_signal_status(ev.signal_id, "FILLED")
        self.st.log_event("info", "orders", "FILLED", f"{ev.signal_id} -> #{ev.ticket}"
                          + (" (reconciled)" if ev.reconciled else ""))

    def _on_counter(self, kind: str) -> None:
        {"failed": self.risk.record_failed_attempt, "modification": self.risk.record_modification,
         "partial_close": self.risk.record_partial_close}[kind]()

    # ================================================================== safety
    def limits(self, state: BridgeState | None) -> EffectiveLimits:
        return EffectiveLimits.combine(self.cfg.risk, self.cfg.hard_limits, self.st.overrides(),
                                       state.ea.limits if state else None)

    def _safety(self, state: BridgeState, now: datetime) -> None:
        lim = self.limits(state)
        if self.risk.check_daily_loss(state.account.equity, lim.max_daily_loss_pct):
            self.st.log_event("critical", "risk", "DAILY_LOSS_HALT", self.risk.halt_reason)
        if self.risk.daily_loss_halt and not self.risk.daily_loss_handled:
            self.risk.daily_loss_handled = True
            self.om.submit_control("CANCEL_PENDING", self.risk.day_id, reason="daily_loss")
            if self.cfg.risk.daily_loss_policy == "close_all":
                self.om.submit_control("CLOSE_ALL", self.risk.day_id, reason="daily_loss")
            self.st.log_event("critical", "risk", "DAILY_LOSS_ACTION",
                              f"pending entries cancelled; existing positions: {self.cfg.risk.daily_loss_policy}")
        if self.risk.estop and not state.ea.estop and not self._estop_sent:
            policy = "close_all" if self.cfg.risk.emergency_stop_policy == "close_all" else "hold"
            self.bridge.set_estop_flag(policy, "service")
            self.om.submit_control("ESTOP", self.risk.day_id, action="set", policy=policy)
            self._estop_sent = True

    # ================================================================== decisions
    def _correlations(self, now: datetime) -> dict[tuple[str, str], float] | None:
        if self._corr is not None and now.timestamp() - self._corr_ts < 3600:
            return self._corr
        closes = {}
        for s in self.symbols:
            b = self.bridge.read_bars(s, self.strategy.trend_tf, self.state.offset_s if self.state else 0)
            if b is not None and len(b) > 50:
                closes[s] = b.set_index("close_time")["close"].tail(200)
        if len(closes) < 2:
            return None
        rets = np.log(pd.DataFrame(closes)).diff().dropna(how="all")
        c = rets.corr(min_periods=50)
        self._corr = {(a, b): float(c.loc[a, b]) for a in c.index for b in c.columns
                      if a != b and pd.notna(c.loc[a, b])}
        self._corr_ts = now.timestamp()
        return self._corr

    def context(self, state: BridgeState, now: datetime, news_block: str | None = None) -> RiskContext:
        syms, inflight_risk = self.om.inflight_symbols_and_risk()
        return RiskContext(
            account=state.account, positions=state.positions, specs=state.specs, quotes=state.quotes,
            state=self.risk, now=now, limits=self.limits(state),
            max_spread_points={s: i.max_spread_points for s, i in self.symbols.items()},
            live_enabled=self.cfg.live_enabled, bridge_healthy=self.health["healthy"],
            bridge_detail=self.health["detail"], inflight_symbols=syms, inflight_risk_money=inflight_risk,
            ea_entries_today=state.ea.entries_today, ea_estop=state.ea.estop, ea_halt=state.ea.halted,
            correlations=self._correlations(now), news_block=news_block)

    def _record(self, symbol: str, out: StrategyOutput, action: str, reasons: list[str],
                signal_id: str | None = None) -> None:
        bar = out.bar_close_time
        self.latest[symbol] = {"action": action, "reasons": reasons, "regime": out.regime.value,
                               "bar_close": str(bar) if bar is not None else None, "signal_id": signal_id,
                               "at": self.clock().isoformat()}
        if bar is not None:
            self.st.record_decision(symbol, bar.to_pydatetime(), action, out.regime.value,
                                    self.strategy.full_version,
                                    self.model.version if self.model else None, reasons, signal_id)

    def _decide(self, state: BridgeState, now: datetime) -> None:
        etf, ttf = self.strategy.entry_tf, self.strategy.trend_tf
        candidates: list[StrategyOutput] = []
        for sym, info in self.symbols.items():
            if sym not in state.specs:
                self.latest[sym] = {"action": "WAIT", "reasons": ["symbol not reported by EA"], "regime": "UNKNOWN"}
                continue
            entry = self.bridge.read_bars(sym, etf, state.offset_s)
            trend = self.bridge.read_bars(sym, ttf, state.offset_s)
            if entry is None or trend is None or entry.empty:
                self.latest[sym] = {"action": "WAIT", "reasons": [f"no {etf}/{ttf} bars from EA yet"],
                                    "regime": "UNKNOWN"}
                continue
            entry = entry[entry["close_time"] <= pd.Timestamp(now)]
            trend = trend[trend["close_time"] <= pd.Timestamp(now)]
            if entry.empty or trend.empty:
                continue
            last_close = entry["close_time"].iloc[-1]
            if self.last_decided.get(sym) == last_close:
                continue
            self.last_decided[sym] = last_close
            if self.st.decision_exists(sym, last_close.to_pydatetime(), self.strategy.full_version):
                continue  # already decided before a restart
            window = "00:00-24:00" if self.strategy.ignores_session_window else info.trading_hours_utc
            out = self.strategy.decide_latest(sym, entry, trend, window, now)
            if out.action is Action.WAIT:
                self._record(sym, out, "WAIT", out.reasons)
                continue
            candidates.append(out)
        ranked = self.rank_candidates(state, candidates)
        for i, out in enumerate(ranked):
            if len(ranked) > 1:
                out.reasons = out.reasons + [f"opportunity rank {i + 1}/{len(ranked)} this step "
                                             f"(attention {self._attention(out.symbol):.0f}, spread {self._cost_r(state, out):.3f} R)"]
            self._candidate(state, now, out.symbol, out)

    def _attention(self, sym: str) -> float:
        for p in self.scan.get("pairs", []):
            if p["symbol"] == sym:
                return float(p["score"])
        return 0.0

    @staticmethod
    def _cost_r(state: BridgeState, out: StrategyOutput) -> float:
        q = state.quotes.get(out.symbol)
        if q is None or out.entry_ref is None or out.stop_loss is None or out.entry_ref == out.stop_loss:
            return 9.0
        return (q.ask - q.bid) / abs(out.entry_ref - out.stop_loss)

    def rank_candidates(self, state: BridgeState, outs: list[StrategyOutput]) -> list[StrategyOutput]:
        """Order simultaneous signals: higher attention score, then lower spread cost per R, then symbol.
        A heuristic for which signal the limits admit first; it never creates or upgrades a signal."""
        return sorted(outs, key=lambda o: (-self._attention(o.symbol), self._cost_r(state, o), o.symbol))

    # ================================================================== scan + watchlist
    def _scan(self, state: BridgeState, now: datetime) -> None:
        t0 = time.monotonic()
        etf, ttf = self.strategy.entry_tf, self.strategy.trend_tf
        items = exposure_items(state.positions, state.specs)
        ccy = currency_exposure(items, state.specs)
        held = {p.symbol for p in state.positions}
        corr = self._correlations(now) or {}
        thr = self.cfg.risk.correlation_threshold
        quality = self.st.execution_quality()
        cal = self.calendar.status(now)
        views = []
        for sym, info in self.symbols.items():
            spec = state.specs.get(sym)
            q = state.quotes.get(sym)
            entry = self.bridge.read_bars(sym, etf, state.offset_s) if spec else None
            trend = self.bridge.read_bars(sym, ttf, state.offset_s) if spec else None
            daily = self.bridge.read_bars(sym, "D1", state.offset_s) if spec and ttf != "D1" else trend
            nt = pd.Timestamp(now)
            entry = entry[entry["close_time"] <= nt] if entry is not None else None
            trend = trend[trend["close_time"] <= nt] if trend is not None else None
            daily = daily[daily["close_time"] <= nt] if daily is not None else None
            window = "00:00-24:00" if self.strategy.ignores_session_window else info.trading_hours_utc
            frame, setups = None, []
            if entry is not None and trend is not None and len(entry) >= 30 and len(trend) >= 30:
                frame = self.strategy.compute(entry, trend, window)
                setups = self.strategy.setups(frame, sym)
            price = (q.bid + q.ask) / 2 if q else None
            signal = None
            if frame is not None and not frame.empty and int(frame["signal"].iloc[-1] or 0) != 0:
                side = int(frame["signal"].iloc[-1])
                bar = pd.Timestamp(frame["close_time"].iloc[-1])
                signal = (side, f"{self.strategy.full_version}:{sym}:{bar:%Y%m%dT%H%M}:{'BUY' if side > 0 else 'SELL'}")
            latest_bar = pd.Timestamp(frame["close_time"].iloc[-1]) if frame is not None and not frame.empty else None
            for note in self.watchlist.refresh(sym, self.strategy.full_version, setups, now, price, latest_bar, signal):
                self.st.log_event("info", "watchlist", "WATCH", note)
            act = self.st.watch_active(sym)
            setup = None
            if act:
                w = act[-1]
                setup = {k: w[k] for k in ("id", "side", "stage", "trigger_level", "invalidation", "created", "expires",
                                           "confirmations", "conditions")}
            ev = {"source": cal.get("provider"), "note": cal.get("detail")}
            if spec and cal.get("active"):
                ev["blocking"] = self.calendar.blocking_reason((spec.base, spec.quote), now)
                ev["upcoming"] = [{"time": e.time_utc.isoformat(), "currency": e.currency, "impact": e.impact,
                                   "title": e.title} for e in self.calendar.upcoming(now, 12)
                                  if e.currency in (spec.base, spec.quote)][:5]
            cor = sorted({b for (a, b), c in corr.items() if a == sym and b in held and b != sym and abs(c) >= thr})
            note = None
            if spec:
                parts = [f"{c} {ccy.get(c, 0):+.0f}" for c in (spec.base, spec.quote) if abs(ccy.get(c, 0)) > 0]
                note = ", ".join(parts) or "none"
            views.append(assess_pair(
                sym, now, entry, frame, daily, (q.bid, q.ask, q.time_utc) if q else None,
                spec.point if spec else 0.00001, info.max_spread_points, in_window(now, window), setup,
                sym in held, note, cor, ev, quality.get(sym), self.cfg.risk.max_quote_age_s))
        ranked = rank(views)
        self.scan = {"at": now.isoformat(), "duration_ms": round((time.monotonic() - t0) * 1000, 1),
                     "interval_s": self.cfg.strategy.scan_interval_s, "pairs": [v.as_dict() for v in ranked],
                     "note": "attention score = unvalidated heuristic for prioritising; it never opens a trade"}

    def _block(self, sym: str, out: StrategyOutput, why: str) -> None:
        self._record(sym, out, "WAIT", out.reasons + [f"WAIT: {why}"])

    def _candidate(self, state: BridgeState, now: datetime, sym: str, out: StrategyOutput) -> None:
        age = (pd.Timestamp(now) - out.bar_close_time).total_seconds()
        if age > self.cfg.strategy.signal_ttl_s:
            return self._block(sym, out, f"signal is {age:.0f}s old (> {self.cfg.strategy.signal_ttl_s}s)")
        if not state.ea.trading_enabled:
            return self._block(sym, out, "EA input EnableTrading=false (entries disabled at the EA)")
        q, spec = state.quotes.get(sym), state.specs[sym]
        if q is None:
            return self._block(sym, out, "no quote")
        side = Side.BUY if out.action is Action.BUY else Side.SELL
        entry = q.ask if side is Side.BUY else q.bid
        r = abs(entry - out.stop_loss)
        tp = spec.round_price(out.take_profit_price) if out.take_profit_price else \
            spec.round_price(entry + side.sign * out.take_profit_r * r)
        ex = self.strategy.exits
        hold_h = ex.max_hold_hours
        if out.deadline is not None:
            left_h = (out.deadline - pd.Timestamp(now)).total_seconds() / 3600
            if left_h <= 0.25:  # never open a trade whose forced-exit time has passed or is minutes away
                return self._block(sym, out, f"forced-exit deadline {out.deadline:%Y-%m-%d %H:%M} UTC passed or < 15 min away")
            hold_h = min(hold_h, left_h)
        # The strategy's own exit policy, exactly as backtested: the trailing stop keeps a FIXED distance of
        # trailing_atr_mult x entry-timeframe ATR at the signal bar (see fxai/backtest/fills.py).
        trail_dist = 0.0
        if ex.trailing_enabled:
            if not out.atr_entry or out.atr_entry <= 0:
                return self._block(sym, out, "trailing exit needs the entry-timeframe ATR, which is missing")
            trail_dist = round(ex.trailing_atr_mult * out.atr_entry, spec.digits)
        exit_params = {"hold_h": round(hold_h, 2), "be_r": ex.breakeven_trigger_r if ex.breakeven_enabled else 0,
                       "be_pts": ex.breakeven_offset_points, "trail_r": ex.trailing_start_r if ex.trailing_enabled else -1,
                       "trail_dist": trail_dist}
        bad = validate_exit_params(exit_params, entry)
        if bad:
            return self._block(sym, out, f"exit policy rejected: {bad}")
        sid = f"{self.strategy.full_version}:{sym}:{out.bar_close_time:%Y%m%dT%H%M}:{side.value}"
        intent = TradeIntent(signal_id=sid, symbol=sym, side=side, entry_price=entry,
                             stop_loss=spec.round_price(out.stop_loss), take_profit=tp,
                             strategy=self.strategy.name, strategy_version=self.strategy.full_version,
                             bar_time_utc=out.bar_close_time.to_pydatetime(), created_utc=now,
                             reasons=out.reasons, features=out.features, exit_params=exit_params,
                             invalidation=out.invalidation)
        # ML meta-filter (can only remove trades)
        if self.cfg.ml.enabled:
            if self.model is None:
                return self._block(sym, out, self.model_error or "no approved model")
            if self.model.strategy_version != self.strategy.full_version:
                return self._block(sym, out, f"model trained for {self.model.strategy_version}")
            score = self.model.score_one(out.features)
            intent.ml_score, intent.ml_model_version = score, self.model.version
            label = "probability" if self.model.calibrated else "score (uncalibrated)"
            if score < self.model.threshold:
                return self._block(sym, out, f"ML meta-filter {label} {score:.2f} < {self.model.threshold:.2f}")
        news = self.calendar.blocking_reason((spec.base, spec.quote), now)
        dec = self.engine.evaluate(intent, self.context(state, now, news))
        self._store_signal(intent, dec, "CANDIDATE")
        if not dec.approved:
            self.st.update_signal_status(sid, "REJECTED_RISK", risk=dec.as_dict())
            return self._block(sym, out, "risk engine: " + "; ".join(dec.blocking_reasons))
        if self.cfg.llm.mode != "off":
            candidate = self._llm_payload(intent, out, state, now)
            fut = self.pool.submit(self.analyst.review, candidate, f"{sym}|{side.value}|{out.bar_close_time}")
            self.pending[sid] = PendingReview(fut, intent, out, time.monotonic())
            self.latest[sym] = {"action": "REVIEW", "reasons": out.reasons + ["awaiting LLM review"],
                                "regime": out.regime.value, "signal_id": sid}
            return
        self._execute(state, now, intent, out, [])

    def _llm_payload(self, intent: TradeIntent, out: StrategyOutput, state: BridgeState, now: datetime) -> dict:
        spec, q = state.specs[intent.symbol], state.quotes[intent.symbol]
        ev = [{"time": e.time_utc.isoformat(), "currency": e.currency, "impact": e.impact, "title": e.title}
              for e in self.calendar.upcoming(now) if e.currency in (spec.base, spec.quote)]
        return {"symbol": intent.symbol, "side": intent.side.value, "regime": out.regime.value,
                "time_utc": now.isoformat(), "spread_points": round((q.ask - q.bid) / spec.point, 1),
                "stop_distance_points": round(intent.stop_distance / spec.point, 1),
                "target_r": self.strategy.exits.take_profit_r, "rule_checks": out.reasons,
                "features": {k: round(v, 4) for k, v in out.features.items()}, "events": ev}

    def _process_reviews(self, state: BridgeState, now: datetime) -> None:
        for sid, pr in list(self.pending.items()):
            timed_out = time.monotonic() - pr.submitted > self.cfg.llm.timeout_s + 5
            if not pr.future.done() and not timed_out:
                continue
            del self.pending[sid]
            res = pr.future.result() if pr.future.done() else ReviewResult("timeout", detail="review thread timeout")
            allow, note = apply_policy(self.cfg.llm.mode, res, self.cfg.llm.on_unavailable)
            self.st.update_signal_status(sid, "LLM_REVIEWED", llm_assessment=note[:500])
            if not allow:
                self._block(pr.intent.symbol, pr.out, note)
                continue
            self._execute(state, now, pr.intent, pr.out, [note] if note else [])

    def _execute(self, state: BridgeState, now: datetime, intent: TradeIntent, out: StrategyOutput,
                 notes: list[str]) -> None:
        sym = intent.symbol
        age = (pd.Timestamp(now) - out.bar_close_time).total_seconds()
        if age > self.cfg.strategy.signal_ttl_s:
            return self._block(sym, out, f"signal expired while under review ({age:.0f}s)")
        q, spec = state.quotes[sym], state.specs[sym]
        intent.entry_price = q.ask if intent.side is Side.BUY else q.bid  # fresh reference price
        news = self.calendar.blocking_reason((spec.base, spec.quote), now)
        dec = self.engine.evaluate(intent, self.context(state, now, news))  # re-check with fresh state
        if not dec.approved:
            self.st.update_signal_status(intent.signal_id, "REJECTED_RISK", risk=dec.as_dict())
            return self._block(sym, out, "risk engine: " + "; ".join(dec.blocking_reasons))
        seq = self.om.submit_open(intent, dec, self.risk.day_id, self.cfg.risk.max_slippage_points,
                                  self.cfg.risk.max_entry_deviation_points)
        if seq is None:
            return self._block(sym, out, "order not submitted (duplicate or bridge error)")
        self.st.update_signal_status(intent.signal_id, "SUBMITTED", risk=dec.as_dict())
        reasons = out.reasons + notes + [f"risk approved: {dec.volume} lots, planned risk "
                                         f"{dec.planned_risk_money:.2f} ({dec.planned_risk_pct:.3f}% equity)"]
        self._record(sym, out, intent.side.value, reasons, intent.signal_id)

    def _store_signal(self, intent: TradeIntent, dec, status: str) -> None:
        self.st.insert_signal({
            "signal_id": intent.signal_id, "created_at": intent.created_utc.isoformat(), "symbol": intent.symbol,
            "side": intent.side.value, "strategy": intent.strategy, "strategy_version": intent.strategy_version,
            "bar_time": intent.bar_time_utc.isoformat(), "entry_ref": intent.entry_price, "sl": intent.stop_loss,
            "tp": intent.take_profit, "ml_score": intent.ml_score, "ml_model_version": intent.ml_model_version,
            "llm_assessment": None, "status": status, "reasons": intent.reasons, "features": intent.features,
            "risk": dec.as_dict()})

    # ================================================================== status
    def block_reasons(self, state: BridgeState | None, lim: EffectiveLimits) -> list[str]:
        r = []
        if self.risk.estop or (state and state.ea.estop):
            r.append(f"EMERGENCY STOP active ({self.risk.estop_reason or 'EA'})")
        if self.risk.paused or (state and state.ea.paused):
            r.append("paused from dashboard")
        if self.risk.daily_loss_halt or (state and state.ea.halted):
            r.append(f"daily-loss halt: {self.risk.halt_reason or (state.ea.halt_reason if state else '')}")
        if not self.health.get("healthy"):
            r.append(f"bridge: {self.health.get('detail')}")
        if state and not state.ea.trading_enabled:
            r.append("EA EnableTrading=false (demo safety default)")
        if state and not state.account.is_demo and not self.cfg.live_enabled:
            r.append("real-money account but live trading not enabled in config")
        entries = max(self.risk.entries_today, state.ea.entries_today if state else 0)
        if entries >= lim.max_entries_per_day:
            r.append(f"daily entry cap reached ({entries}/{lim.max_entries_per_day})")
        if self.risk.in_loss_pause(self.clock()):
            r.append(f"consecutive-loss pause until {self.risk.pause_until}")
        if self.cfg.ml.enabled and self.model is None:
            r.append(self.model_error)
        return r

    def _write_status(self, state: BridgeState | None, now: datetime) -> None:
        lim = self.limits(state)
        data: dict[str, Any] = {
            "service": {"version": __version__, "mode": self.cfg.mode, "live_enabled": self.cfg.live_enabled,
                        "started_at": self.started.isoformat(), "now": now.isoformat(),
                        "loop_ms": round(self.loop_ms, 1), "strategy": self.strategy.full_version,
                        "decision_tf": self.strategy.entry_tf, "trend_tf": self.strategy.trend_tf},
            "bridge": {**self.health, "last_error": self.bridge.last_error},
            "limits": lim.__dict__,
            "block_reasons": self.block_reasons(state, lim),
            "decisions": self.latest,
            "scan": self.scan,
            "watchlist": self.st.watch_recent(40),
            "models": {"ml": {"enabled": self.cfg.ml.enabled, "version": self.model.version if self.model else None,
                              "calibrated": bool(self.model and self.model.calibrated), "error": self.model_error},
                       "llm": self.analyst.status()},
            "news": self.calendar.status(now),
            "risk_state": {"day_id": self.risk.day_id, "entries_today": self.risk.entries_today,
                           "failed_today": self.risk.failed_attempts_today,
                           "modifications_today": self.risk.modifications_today,
                           "partial_closes_today": self.risk.partial_closes_today,
                           "consecutive_losses": self.risk.consecutive_losses, "pause_until": self.risk.pause_until,
                           "estop": self.risk.estop, "paused": self.risk.paused,
                           "daily_loss_halt": self.risk.daily_loss_halt, "halt_reason": self.risk.halt_reason},
        }
        if state is not None:
            a, ea = state.account, state.ea
            items = exposure_items(state.positions, state.specs)
            open_risk = total_open_risk(items)
            realized = sum(h.net_profit for h in state.history if h.close_time_utc.date() == now.date())
            daily_pnl = a.equity - self.risk.day_start_equity - self.risk.net_flows_today \
                if self.risk.day_start_equity else 0.0
            data["account"] = {"login": a.login, "server": a.server, "company": a.company, "currency": a.currency,
                               "is_demo": a.is_demo, "balance": a.balance, "equity": a.equity, "margin": a.margin,
                               "free_margin": a.free_margin,
                               "margin_level": None if a.margin <= 0 else round(a.margin_level_pct, 1),
                               "leverage": a.leverage}
            data["pnl"] = {"floating": round(a.floating_pnl, 2), "realized_today": round(realized, 2),
                           "daily_pnl": round(daily_pnl, 2),
                           "daily_loss_pct": round(self.risk.current_daily_loss_pct(a.equity), 3),
                           "daily_loss_limit_pct": lim.max_daily_loss_pct,
                           "day_start_equity": self.risk.day_start_equity, "net_flows": self.risk.net_flows_today}
            data["exposure"] = {"open_risk": round(open_risk, 2),
                                "open_risk_pct": round(open_risk / a.equity * 100, 3) if a.equity else None,
                                "by_currency": {k: round(v, 2) for k, v in currency_exposure(items, state.specs).items()},
                                "positions": len([p for p in state.positions if p.system_owned])}
            data["entries"] = {"today": max(self.risk.entries_today, ea.entries_today), "cap": lim.max_entries_per_day,
                               "ea_count": ea.entries_today, "failed": max(self.risk.failed_attempts_today, ea.failed_today),
                               "modifications": max(self.risk.modifications_today, ea.modifications_today),
                               "partial_closes": max(self.risk.partial_closes_today, ea.partial_closes_today)}
            data["positions"] = []
            for p in state.positions:
                spec = state.specs.get(p.symbol)
                risk, protected = position_risk_money(p, spec) if spec else (None, p.sl > 0)
                data["positions"].append({
                    "ticket": p.ticket, "symbol": p.symbol, "side": p.side.value, "volume": p.volume,
                    "open_price": p.open_price, "sl": p.sl, "tp": p.tp, "profit": round(p.net_profit, 2),
                    "swap": round(p.swap, 2), "commission": round(p.commission, 2),
                    "risk": None if risk is None or risk == float("inf") else round(risk, 2), "protected": protected,
                    "open_time": p.open_time_utc.isoformat(), "system": p.system_owned})
            data["account"]["server_offset_s"] = state.offset_s
            data["quotes"] = {s: {"bid": q.bid, "ask": q.ask,
                                  "spread_pts": round((q.ask - q.bid) / state.specs[s].point, 1),
                                  "age_s": round((now - q.time_utc).total_seconds(), 1)}
                              for s, q in state.quotes.items() if s in state.specs}
            data["ea"] = {"version": ea.version, "master": ea.instance_master, "trading_enabled": ea.trading_enabled,
                          "live_allowed": ea.live_allowed, "py_heartbeat_age": ea.py_heartbeat_age,
                          "last_cmd_seq": ea.last_cmd_seq, "day_id": ea.day_id, "events": state.events[-10:]}
            if now.timestamp() - self._last_equity_ts >= 60:
                self._last_equity_ts = now.timestamp()
                self.st.record_equity({"ts": now.isoformat(), "balance": a.balance, "equity": a.equity,
                                       "margin": a.margin, "free_margin": a.free_margin, "floating": a.floating_pnl,
                                       "realized_today": realized,
                                       "daily_loss_pct": self.risk.current_daily_loss_pct(a.equity),
                                       "open_risk": open_risk})
        self.st.write_status(data)

