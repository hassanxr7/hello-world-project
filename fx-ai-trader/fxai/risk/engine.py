"""Deterministic pre-trade risk engine.

``RiskEngine.evaluate`` runs every check, records each result (pass or fail)
and approves an entry only if all pass. Volume is computed here and nowhere
else. Strategy, ML and LLM components cannot influence size or limits.

The MT4 EA re-checks the hard limits independently before sending any order,
so a bug or compromise on the Python side cannot exceed the EA's inputs.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import datetime

from ..config import HardLimits, RiskConfig
from ..domain import AccountSnapshot, CheckResult, Position, Quote, RiskDecision, Side, SymbolSpec, TradeIntent
from ..symbols import currency_risk_vector
from .exposure import correlated_count, currency_exposure, exposure_items, total_open_risk
from .sizing import size_position
from .state import RiskState

# Fraction of the normal per-trade budget below which a down-sized trade is
# refused rather than taken at a token size.
MIN_BUDGET_FRACTION = 0.5


@dataclass(frozen=True)
class EALimits:
    """Hard limits reported by the EA (its input parameters)."""

    max_risk_per_trade_pct: float
    max_total_risk_pct: float
    max_open_positions: int
    max_entries_per_day: int
    max_daily_loss_pct: float


@dataclass(frozen=True)
class EffectiveLimits:
    risk_per_trade_pct: float
    max_total_risk_pct: float
    max_open_positions: int
    max_daily_loss_pct: float
    max_entries_per_day: int

    @staticmethod
    def combine(cfg: RiskConfig, hard: HardLimits, overrides: dict | None = None,
                ea: EALimits | None = None) -> "EffectiveLimits":
        """Config value, optionally replaced by a dashboard override (clamped to
        hard_limits), then capped by the EA's own limits. The strictest wins."""
        ov = overrides or {}

        def pick(name: str, cast):
            v = cfg.__getattribute__(name)
            if name in ov:
                try:
                    v = cast(ov[name])
                except (TypeError, ValueError):
                    pass
            v = min(v, getattr(hard, name))
            return max(v, 0) if cast is int else max(v, 0.0)

        lim = EffectiveLimits(
            risk_per_trade_pct=pick("risk_per_trade_pct", float),
            max_total_risk_pct=pick("max_total_risk_pct", float),
            max_open_positions=pick("max_open_positions", int),
            max_daily_loss_pct=pick("max_daily_loss_pct", float),
            max_entries_per_day=pick("max_entries_per_day", int),
        )
        if ea is not None:
            lim = replace(
                lim,
                risk_per_trade_pct=min(lim.risk_per_trade_pct, ea.max_risk_per_trade_pct),
                max_total_risk_pct=min(lim.max_total_risk_pct, ea.max_total_risk_pct),
                max_open_positions=min(lim.max_open_positions, ea.max_open_positions),
                max_daily_loss_pct=min(lim.max_daily_loss_pct, ea.max_daily_loss_pct),
                max_entries_per_day=min(lim.max_entries_per_day, ea.max_entries_per_day),
            )
        return lim


@dataclass
class RiskContext:
    account: AccountSnapshot
    positions: list[Position]
    specs: dict[str, SymbolSpec]
    quotes: dict[str, Quote]
    state: RiskState
    now: datetime
    limits: EffectiveLimits
    max_spread_points: dict[str, int]
    live_enabled: bool = False
    bridge_healthy: bool = True
    bridge_detail: str = ""
    inflight_symbols: set[str] = field(default_factory=set)  # entries sent but unresolved
    inflight_risk_money: float = 0.0
    ea_entries_today: int | None = None
    ea_estop: bool = False
    ea_halt: bool = False
    correlations: dict[tuple[str, str], float] | None = None
    news_block: str | None = None  # reason string if a news blackout applies


class RiskEngine:
    def __init__(self, cfg: RiskConfig, include_manual_positions: bool = True):
        self.cfg = cfg
        self.include_manual = include_manual_positions

    # ------------------------------------------------------------------------------
    def evaluate(self, intent: TradeIntent, ctx: RiskContext) -> RiskDecision:
        cfg, lim, st = self.cfg, ctx.limits, ctx.state
        checks: list[CheckResult] = []

        def add(name: str, ok: bool, detail: str = "", value=None, limit=None) -> bool:
            checks.append(CheckResult(name, bool(ok), detail, value, limit))
            return ok

        sym = intent.symbol
        spec = ctx.specs.get(sym)
        quote = ctx.quotes.get(sym)
        acct = ctx.account

        # --- global state -----------------------------------------------------------
        add("emergency_stop", not (st.estop or ctx.ea_estop),
            "emergency stop active" if (st.estop or ctx.ea_estop) else "")
        add("paused", not st.paused, "trading paused from dashboard" if st.paused else "")
        loss_pct = st.current_daily_loss_pct(acct.equity)
        halted = st.daily_loss_halt or ctx.ea_halt or loss_pct >= lim.max_daily_loss_pct
        add("daily_loss", not halted,
            st.halt_reason or (f"daily loss {loss_pct:.2f}% >= {lim.max_daily_loss_pct}%" if halted else ""),
            round(loss_pct, 3), lim.max_daily_loss_pct)
        add("bridge_health", ctx.bridge_healthy, ctx.bridge_detail)
        add("account_trading", acct.trade_allowed and acct.connected,
            "" if acct.trade_allowed and acct.connected else "terminal not connected or trading disabled")
        add("live_gate", acct.is_demo or ctx.live_enabled,
            "" if acct.is_demo or ctx.live_enabled else "real-money account but live trading not enabled")
        entries = max(st.entries_today, ctx.ea_entries_today or 0)
        add("daily_entry_cap", entries < lim.max_entries_per_day,
            f"{entries}/{lim.max_entries_per_day} entries today", entries, lim.max_entries_per_day)
        in_pause = st.in_loss_pause(ctx.now)
        add("consecutive_loss_pause", not in_pause,
            f"paused until {st.pause_until} after {cfg.max_consecutive_losses} consecutive losses" if in_pause else "")

        # --- symbol-level --------------------------------------------------------------
        if spec is None or quote is None:
            add("symbol_data", False, "no contract spec or quote for symbol")
            return RiskDecision(False, checks=checks)
        add("symbol_trade_allowed", spec.trade_allowed, "" if spec.trade_allowed else "symbol not tradeable")

        since_entry = st.minutes_since(st.last_entry_time, sym, ctx.now)
        ok = since_entry is None or since_entry >= cfg.cooldown_after_entry_min
        add("reentry_cooldown", ok, "" if ok else f"{since_entry:.0f} min since last entry < {cfg.cooldown_after_entry_min}")
        since_loss = st.minutes_since(st.last_loss_time, sym, ctx.now)
        ok = since_loss is None or since_loss >= cfg.cooldown_after_loss_min
        add("loss_cooldown", ok, "" if ok else f"{since_loss:.0f} min since loss < {cfg.cooldown_after_loss_min}")

        system_positions = [p for p in ctx.positions if p.system_owned]
        same_symbol = [p for p in system_positions if p.symbol == sym]
        add("one_position_per_symbol", not same_symbol and sym not in ctx.inflight_symbols,
            "" if not same_symbol and sym not in ctx.inflight_symbols else "position or entry already in flight")
        n_open = len(system_positions) + len(ctx.inflight_symbols)
        add("max_open_positions", n_open < lim.max_open_positions,
            f"{n_open}/{lim.max_open_positions} open", n_open, lim.max_open_positions)

        unprotected = [p.ticket for p in system_positions if p.sl <= 0]
        add("all_positions_protected", not unprotected,
            f"system position(s) without stop-loss: {unprotected}" if unprotected else "")

        age = (ctx.now - quote.time_utc).total_seconds()
        add("quote_fresh", -5.0 < age <= cfg.max_quote_age_s,
            f"quote age {age:.1f}s", round(age, 1), cfg.max_quote_age_s)

        spread_pts = (quote.ask - quote.bid) / spec.point
        max_sp = ctx.max_spread_points.get(sym, 0)
        add("spread", 0 <= spread_pts <= max_sp, f"{spread_pts:.1f} pts", round(spread_pts, 1), max_sp)

        # --- stop / target validity -------------------------------------------------------
        side = intent.side
        entry = quote.ask if side is Side.BUY else quote.bid
        sl, tp = intent.stop_loss, intent.take_profit
        dev_pts = abs(entry - intent.entry_price) / spec.point
        add("entry_price_deviation", dev_pts <= cfg.max_entry_deviation_points,
            f"price moved {dev_pts:.1f} pts since signal", round(dev_pts, 1), cfg.max_entry_deviation_points)
        stop_ok = sl > 0 and ((side is Side.BUY and sl < quote.bid) or (side is Side.SELL and sl > quote.ask))
        add("stop_loss_present", stop_ok, "" if stop_ok else "missing or wrong-side stop-loss")
        if not stop_ok:
            return RiskDecision(False, checks=checks)
        min_dist = spec.stop_level_points * spec.point
        exit_px = quote.bid if side is Side.BUY else quote.ask  # stops are checked vs the closing price
        sl_dist = abs(exit_px - sl)
        add("stop_level", sl_dist >= min_dist, f"SL {sl_dist / spec.point:.0f} pts vs broker min {spec.stop_level_points}")
        if tp > 0:
            tp_ok = (side is Side.BUY and tp > entry) or (side is Side.SELL and tp < entry)
            tp_ok = tp_ok and abs(tp - exit_px) >= min_dist
            add("take_profit_valid", tp_ok, "" if tp_ok else "take-profit on wrong side or inside stop level")
        stop_dist = abs(entry - sl)
        ratio = (quote.ask - quote.bid) / stop_dist if stop_dist > 0 else math.inf
        add("spread_to_stop", ratio <= cfg.max_spread_to_stop,
            f"spread is {ratio:.0%} of stop distance", round(ratio, 3), cfg.max_spread_to_stop)

        # --- risk budget & sizing ---------------------------------------------------------
        equity = acct.equity
        items = exposure_items(ctx.positions, ctx.specs, self.include_manual)
        open_risk = total_open_risk(items) + ctx.inflight_risk_money
        normal_budget = equity * lim.risk_per_trade_pct / 100.0
        remaining_total = equity * lim.max_total_risk_pct / 100.0 - open_risk
        budget = min(normal_budget, remaining_total)
        if cfg.daily_loss_headroom_check:
            day_loss_money = max(0.0, -(equity - st.day_start_equity - st.net_flows_today))
            base = st.day_start_equity if st.day_start_equity > 0 else equity
            headroom = base * lim.max_daily_loss_pct / 100.0 - day_loss_money - open_risk
            budget = min(budget, headroom)
        enough = budget >= normal_budget * MIN_BUDGET_FRACTION
        add("risk_budget", enough,
            f"budget {budget:.2f} (normal {normal_budget:.2f}, open risk {open_risk:.2f})",
            round(budget, 2), round(normal_budget, 2))
        sizing = size_position(spec, entry, sl, max(0.0, budget), cfg.commission_per_lot_round_turn,
                               cfg.sizing_slippage_points, cfg.max_lot_per_trade)
        add("position_size", sizing.ok, sizing.reason or f"{sizing.volume} lots risks {sizing.risk_money:.2f}",
            sizing.volume, spec.min_lot)
        if not (enough and sizing.ok):
            return RiskDecision(False, checks=checks)
        risk_money = sizing.risk_money
        add("total_risk", open_risk + risk_money <= equity * lim.max_total_risk_pct / 100.0 + 1e-6,
            f"open+new {(open_risk + risk_money) / equity * 100:.2f}% of equity",
            round((open_risk + risk_money) / equity * 100, 3), lim.max_total_risk_pct)

        # --- currency & correlation ------------------------------------------------------
        net = currency_exposure(items, ctx.specs)
        cap = equity * cfg.max_currency_risk_pct / 100.0
        worst = ""
        for ccy, v in currency_risk_vector(spec.base, spec.quote, side.sign, risk_money).items():
            after = net.get(ccy, 0.0) + v
            if abs(after) > cap + 1e-6 and abs(after) > abs(net.get(ccy, 0.0)):
                worst = f"{ccy} net risk {after / equity * 100:+.2f}% > {cfg.max_currency_risk_pct}%"
        add("currency_exposure", not worst, worst)
        nc = correlated_count(sym, side, items, ctx.correlations, cfg.correlation_threshold)
        add("correlation", nc + 1 <= cfg.max_correlated_positions,
            f"{nc} correlated same-direction position(s)", nc + 1, cfg.max_correlated_positions)

        # --- margin -------------------------------------------------------------------------
        req = sizing.volume * spec.margin_per_lot
        usage_after = (acct.margin + req) / equity * 100.0 if equity > 0 else math.inf
        level_after = equity / (acct.margin + req) * 100.0 if acct.margin + req > 0 else math.inf
        add("margin", req < acct.free_margin and usage_after <= cfg.max_margin_usage_pct
            and level_after >= cfg.min_margin_level_pct,
            f"margin usage after {usage_after:.1f}%, level {level_after:.0f}%",
            round(usage_after, 2), cfg.max_margin_usage_pct)

        # --- news ----------------------------------------------------------------------------
        add("news_blackout", ctx.news_block is None, ctx.news_block or "")

        approved = all(c.passed for c in checks)
        return RiskDecision(
            approved=approved,
            volume=sizing.volume if approved else 0.0,
            planned_risk_money=risk_money,
            planned_risk_pct=risk_money / equity * 100.0 if equity > 0 else 0.0,
            checks=checks,
        )
