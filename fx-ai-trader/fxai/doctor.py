"""`python -m fxai doctor`: deployment diagnostics for the VPS.

Reads the configuration, the EA's bridge folder (state.json, bars) and the
local environment, and reports PASS / WARN / FAIL / INFO lines. It never
sends commands and never changes anything, so it is safe to run at any time,
including while the service is running. The output contains no secrets.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from . import __version__
from .analysis.bars import TF_MINUTES
from .analysis.indicators import atr
from .bridge.file_bridge import FileBridge
from .config import AppConfig, resolve_bridge_dir
from .risk import EffectiveLimits
from .risk.sizing import loss_per_lot
from .timeutil import trading_day_id, utcnow

ORDER = {"FAIL": 0, "WARN": 1, "INFO": 2, "PASS": 3}


@dataclass
class Check:
    status: str
    name: str
    detail: str


def _bridge_candidates(cfg: AppConfig) -> str:
    try:
        root = Path(os.environ["APPDATA"]) / "MetaQuotes" / "Terminal" / "Common" / "Files" / "FXAI" \
            if cfg.bridge.root == "auto" else Path(cfg.bridge.root)
    except KeyError:
        return "APPDATA not set (not Windows?) - set bridge.root explicitly"
    if not root.is_dir():
        return f"{root} does not exist: the EA has never run on this machine/user (attach it to a chart)"
    subs = [d.name for d in root.iterdir() if d.is_dir()]
    return f"{root} contains {subs or 'nothing'}"


def market_probably_closed(now: datetime) -> bool:
    wd, h = now.weekday(), now.hour
    return wd == 5 or (wd == 4 and h >= 21) or (wd == 6 and h < 22)


def run_doctor(cfg: AppConfig, now: datetime | None = None, env: dict[str, str] | None = None) -> list[Check]:
    now = now or utcnow()
    env = env if env is not None else dict(os.environ)
    out: list[Check] = []

    def add(status: str, name: str, detail: str) -> None:
        out.append(Check(status, name, detail))

    add("INFO", "fxai", f"version {__version__}, mode={cfg.mode}, strategy entries {cfg.strategy.decision_timeframe} "
        f"/ trend {cfg.strategy.trend_timeframe}, symbols {cfg.symbols.enabled}, suffix '{cfg.symbols.suffix}'")
    if cfg.mode == "live":
        add("WARN" if cfg.live_trading_acknowledged else "FAIL", "live mode",
            "mode=live - the service also requires reports/validation_status.json with passed=true")
    if not env.get("FXAI_DASHBOARD_PASSWORD_HASH") or len(env.get("FXAI_SECRET_KEY", "")) < 32:
        add("WARN", "dashboard secrets", "FXAI_DASHBOARD_PASSWORD_HASH / FXAI_SECRET_KEY missing in .env - "
            "the dashboard will not start (python -m fxai hash-password / gen-secret)")
    else:
        add("PASS", "dashboard secrets", "present (values not shown)")
    try:
        from .storage import Storage
        st = Storage(cfg.storage.db_path)
        st.query("SELECT 1")
        add("PASS", "database", f"{cfg.storage.db_path} writable")
    except Exception as e:
        add("FAIL", "database", f"{cfg.storage.db_path}: {e}")

    # ------------------------------------------------------------------ bridge
    try:
        root = resolve_bridge_dir(cfg.bridge)
    except Exception as e:
        add("FAIL", "bridge folder", f"{e}. {_bridge_candidates(cfg)}")
        return sorted(out, key=lambda c: ORDER[c.status])
    add("PASS", "bridge folder", str(root))
    bridge = FileBridge(root, cfg.bridge.magic_number)
    age = bridge.state_age_s()
    if age is None:
        add("FAIL", "EA state", "state.json not found - is FXAI_Bridge attached to a chart and showing [ACTIVE]?")
        return sorted(out, key=lambda c: ORDER[c.status])
    state = bridge.read_state()
    if state is None:
        add("FAIL", "EA state", f"state.json unreadable: {bridge.last_error}")
        return sorted(out, key=lambda c: ORDER[c.status])
    add("PASS" if age <= cfg.bridge.ea_heartbeat_timeout_s else "FAIL", "EA state freshness",
        f"state.json written {age:.1f}s ago (limit {cfg.bridge.ea_heartbeat_timeout_s}s)")
    clock_skew = now.timestamp() - state.gmt_time - (age or 0)
    add("PASS" if abs(clock_skew) < 15 else "WARN", "clock", f"PC clock vs EA TimeGMT differ by {clock_skew:+.0f}s "
        "(Python and MT4 must run on the same machine with Windows time sync on)")
    ea, acct = state.ea, state.account
    add("PASS" if ea.instance_master else "FAIL", "EA instance",
        f"EA {ea.version}, {'active master' if ea.instance_master else 'STANDBY - another chart holds the lock'}")
    add("INFO", "broker", f"{acct.company} / {acct.server}, login {acct.login}, {acct.currency}, leverage 1:{acct.leverage}, "
        f"balance {acct.balance:,.2f}, equity {acct.equity:,.2f}")
    add("PASS" if acct.is_demo else "WARN", "account type",
        "DEMO account" if acct.is_demo else "REAL-MONEY account - entries stay blocked unless AllowLiveAccount=true "
        "and live mode is fully enabled")
    add("PASS" if acct.connected else "FAIL", "broker connection", "connected" if acct.connected else "terminal offline")
    add("PASS" if acct.trade_allowed else "WARN", "AutoTrading",
        "allowed" if acct.trade_allowed else "AutoTrading button off or 'Allow live trading' unticked on the EA")
    add("INFO" if not ea.trading_enabled else "PASS", "EA EnableTrading",
        "false (stage 0: connectivity only - no orders will be sent)" if not ea.trading_enabled
        else "true - the EA will execute approved entries")
    hours = state.offset_s / 3600
    add("INFO", "server time", f"broker server = UTC{hours:+.1f}h"
        + (" (typical NY-close-aligned broker: daily_reset zone 'server' hour 0 = 17:00 New York)"
           if hours in (2.0, 3.0) else ""))

    if ea.magic is not None:
        add("PASS" if ea.magic == cfg.bridge.magic_number else "FAIL", "magic number",
            f"EA {ea.magic} vs config {cfg.bridge.magic_number}")
    if ea.reset_zone is not None:
        same = ea.reset_zone == cfg.daily_reset.zone and ea.reset_hour == cfg.daily_reset.hour
        add("PASS" if same else "WARN", "daily reset",
            f"EA {ea.reset_zone} {ea.reset_hour}h vs config {cfg.daily_reset.zone} {cfg.daily_reset.hour}h"
            + ("" if same else " - align them (the EA's day is authoritative for counters)"))
    try:
        py_day = trading_day_id(now, cfg.daily_reset.zone, cfg.daily_reset.hour, state.offset_s)
        add("PASS" if py_day == ea.day_id else "WARN", "trading day", f"EA {ea.day_id}, Python {py_day}")
    except Exception as e:
        add("WARN", "trading day", str(e))
    if ea.symbol_suffix is not None and (ea.symbol_suffix != cfg.symbols.suffix or ea.symbol_prefix != cfg.symbols.prefix):
        add("WARN", "symbol suffix", f"EA prefix/suffix '{ea.symbol_prefix}'/'{ea.symbol_suffix}' vs config "
            f"'{cfg.symbols.prefix}'/'{cfg.symbols.suffix}' (only the EA's is used for orders; keep them equal)")
    hb = ea.py_heartbeat_age
    add("PASS" if hb <= 30 else "INFO", "python service",
        f"EA sees the Python heartbeat {hb:.0f}s old" if hb < 1e8 else "no Python heartbeat yet - start "
        "`python -m fxai service` (expected if you have not started it)")

    lim = EffectiveLimits.combine(cfg.risk, cfg.hard_limits, None, ea.limits)
    add("INFO", "effective limits", f"risk/trade {lim.risk_per_trade_pct}%, total {lim.max_total_risk_pct}%, "
        f"positions {lim.max_open_positions}, daily loss {lim.max_daily_loss_pct}%, entries/day {lim.max_entries_per_day} "
        "(stricter of config and EA inputs)")
    add("INFO", "commission", f"config assumes {cfg.risk.commission_per_lot_round_turn} {acct.currency}/lot round turn "
        "- set your broker's real value (0 for spread-only accounts)")

    # ------------------------------------------------------------------ symbols, spreads, bars, min lot
    closed = market_probably_closed(now)
    info = cfg.symbols.resolve()
    missing = [s for s in info if s not in state.specs]
    if missing:
        add("FAIL", "symbols", f"configured but not exported by the EA: {missing}. EA exports "
            f"{[sp.broker_name for sp in state.specs.values()]} - check SymbolSuffix/Symbols inputs and Market Watch")
    else:
        add("PASS", "symbols", ", ".join(f"{s}->{state.specs[s].broker_name}" for s in info))
    for tf in {cfg.strategy.decision_timeframe, cfg.strategy.trend_timeframe}:
        if ea.bar_timeframes and tf not in ea.bar_timeframes:
            add("FAIL", "bar timeframes", f"strategy needs {tf} but EA BarTimeframes={','.join(ea.bar_timeframes)}")
    budget = acct.equity * lim.risk_per_trade_pct / 100.0
    for sym, si in info.items():
        spec = state.specs.get(sym)
        if spec is None:
            continue
        q = state.quotes.get(sym)
        if spec.tick_value <= 0 or spec.lot_step <= 0 or spec.min_lot <= 0:
            add("FAIL", f"{sym} contract", f"tick value {spec.tick_value}, lot step {spec.lot_step}, min lot {spec.min_lot}")
            continue
        if q is not None:
            qage = (now - q.time_utc).total_seconds()
            spread = (q.ask - q.bid) / spec.point
            if qage > cfg.risk.max_quote_age_s:
                add("INFO" if closed else "WARN", f"{sym} quote", f"last tick {qage:.0f}s ago"
                    + (" (market closed?)" if closed else ""))
            elif spread > si.max_spread_points:
                add("WARN", f"{sym} spread", f"{spread:.0f} points > max {si.max_spread_points} - entries will be "
                    "blocked; widen symbols.overrides if this is your account's normal spread")
            else:
                add("PASS", f"{sym} quote", f"spread {spread:.0f} pts (max {si.max_spread_points}), "
                    f"digits {spec.digits}, stop level {spec.stop_level_points}")
        entry = bridge.read_bars(sym, cfg.strategy.decision_timeframe, state.offset_s)
        trend = bridge.read_bars(sym, cfg.strategy.trend_timeframe, state.offset_s)
        for tf, df in ((cfg.strategy.decision_timeframe, entry), (cfg.strategy.trend_timeframe, trend)):
            if df is None or df.empty:
                add("FAIL", f"{sym} {tf} bars", "file missing - open that chart once so MT4 loads history")
                continue
            need = cfg.strategy.params.ema_slow + 20
            last_close = df["close_time"].iloc[-1]
            lag_min = (pd.Timestamp(now) - last_close).total_seconds() / 60
            stale = lag_min > 2 * TF_MINUTES[tf] and not closed
            status = "FAIL" if len(df) < need else ("WARN" if stale or len(df) < 520 else "PASS")
            add(status, f"{sym} {tf} bars", f"{len(df)} bars (need >= {need}, 520+ recommended), last closed "
                f"{last_close:%Y-%m-%d %H:%M} UTC" + (" - not updating" if stale else ""))
        if entry is not None and len(entry) > 20 and q is not None:
            a = float(atr(entry, cfg.strategy.params.atr_period).iloc[-1])
            stop = 1.5 * a  # typical stop for this strategy (1.0-2.5 ATR)
            mid = (q.bid + q.ask) / 2
            lpl = loss_per_lot(spec, mid, mid - stop, cfg.risk.commission_per_lot_round_turn,
                               cfg.risk.sizing_slippage_points)
            min_risk = spec.min_lot * lpl
            ok = min_risk <= budget
            add("PASS" if ok else "WARN", f"{sym} min lot",
                f"typical stop {stop / spec.pip_size:.0f} pips: min lot {spec.min_lot} risks {min_risk:.2f} vs budget "
                f"{budget:.2f} {acct.currency}" + ("" if ok else " - most trades will be SKIPPED (account too small "
                                                     "for this risk %; never rounded up)"))
    return sorted(out, key=lambda c: ORDER[c.status])


def format_report(checks: list[Check]) -> str:
    lines = [f"[{c.status}] {c.name}: {c.detail}" for c in checks]
    n = {k: sum(c.status == k for c in checks) for k in ORDER}
    lines.append(f"-- {n['FAIL']} FAIL, {n['WARN']} WARN, {n['PASS']} PASS, {n['INFO']} INFO "
                 f"(generated {utcnow():%Y-%m-%d %H:%M:%S} UTC; contains no secrets)")
    return "\n".join(lines)


def as_dicts(checks: list[Check]) -> list[dict[str, Any]]:
    return [c.__dict__ for c in checks]
