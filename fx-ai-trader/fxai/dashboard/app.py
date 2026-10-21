"""Monitoring and control dashboard (FastAPI).

Security model
- Binds to 127.0.0.1 by default; reach it remotely through RDP/SSH tunnel or an
  HTTPS reverse proxy (then set dashboard.secure_cookies: true).
- Single operator account. Password stored only as a scrypt hash in
  FXAI_DASHBOARD_PASSWORD_HASH; sessions are HMAC-signed with FXAI_SECRET_KEY.
- HttpOnly + SameSite=Strict cookie, per-session CSRF token required on every
  state-changing request, login rate limiting, strict CSP (no inline script).
- The browser never receives secrets: /api/status is built from the service's
  status snapshot, which contains no credentials or API keys.
- Controls are queued in SQLite and applied by the service, which validates
  them again; the emergency stop is ALSO written straight to the EA's
  estop.flag so it works even if the service is down.
"""

from __future__ import annotations

import csv
import io
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .. import __version__
from ..analytics import (assess_target, daily_returns_pct, drawdown, evidence_gate, forecast, next_trading_days,
                         observed_evidence, period_summary, risk_allowance)
from ..bridge.file_bridge import FileBridge
from ..config import AppConfig, Secrets, resolve_bridge_dir
from ..storage import Storage
from ..strategy import build_strategy
from ..timeutil import utcnow
from .auth import LoginLimiter, SessionSigner, verify_password

HERE = Path(__file__).parent
COOKIE = "fxai_session"
ALLOWED_ACTIONS = {"pause", "resume", "estop", "estop_clear", "close_all", "set_limits", "clear_loss_pause"}
LIMIT_KEYS = {"risk_per_trade_pct": float, "max_total_risk_pct": float, "max_open_positions": int,
              "max_daily_loss_pct": float, "max_entries_per_day": int}


def create_app(cfg: AppConfig, storage: Storage, password_hash: str | None = None,
               secret_key: str | None = None) -> FastAPI:
    password_hash = password_hash or Secrets.get("FXAI_DASHBOARD_PASSWORD_HASH")
    secret_key = secret_key or Secrets.get("FXAI_SECRET_KEY")
    if not password_hash or not secret_key or len(secret_key) < 32:
        raise RuntimeError("set FXAI_DASHBOARD_PASSWORD_HASH (python -m fxai hash-password) and FXAI_SECRET_KEY "
                           "(>= 32 random characters) before starting the dashboard")
    signer = SessionSigner(secret_key.encode(), cfg.dashboard.session_ttl_min * 60)
    strategy = build_strategy(cfg)
    limiter = LoginLimiter()
    cache: dict[str, Any] = {"t": 0.0, "v": None}

    def reports(st: dict[str, Any]) -> dict[str, Any]:
        """ACTUAL / FORECAST / SCENARIO / SIMULATED sections, each labelled with its kind (cached 10 s)."""
        if cache["v"] is not None and time.monotonic() - cache["t"] < 10:
            return cache["v"]
        cache["v"], cache["t"] = build_reports(cfg, storage, strategy.full_version, st), time.monotonic()
        return cache["v"]
    templates = Jinja2Templates(directory=str(HERE / "templates"))
    app = FastAPI(title="fxai dashboard", docs_url=None, redoc_url=None, openapi_url=None)
    app.mount("/static", StaticFiles(directory=str(HERE / "static")), name="static")

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers["Content-Security-Policy"] = ("default-src 'self'; script-src 'self'; style-src 'self'; "
                                                   "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
                                                   "base-uri 'none'; form-action 'self'")
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    def session(request: Request) -> dict | None:
        return signer.verify(request.cookies.get(COOKIE))

    def require(request: Request, csrf: bool = False) -> dict:
        s = session(request)
        if s is None:
            raise HTTPException(401, "login required")
        if csrf and request.headers.get("X-CSRF-Token") != s.get("csrf"):
            raise HTTPException(403, "missing or invalid CSRF token")
        return s

    @app.get("/favicon.ico")
    def favicon() -> Response:
        return Response(status_code=204)

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True}

    @app.get("/login", response_class=HTMLResponse)
    def login_page(request: Request):
        return templates.TemplateResponse(request, "login.html", {"version": __version__})

    @app.post("/api/login")
    async def login(request: Request):
        key = request.client.host if request.client else "?"
        if limiter.locked(key):
            raise HTTPException(429, "too many failed attempts - wait 5 minutes")
        try:
            body = await request.json()
        except json.JSONDecodeError:
            raise HTTPException(400, "bad request")
        if not verify_password(str(body.get("password", "")), password_hash):
            limiter.fail(key)
            storage.audit(key, "login_failed")
            raise HTTPException(401, "invalid password")
        limiter.reset(key)
        token, _ = signer.issue("operator")
        storage.audit("operator", "login", {"ip": key})
        resp = JSONResponse({"ok": True})
        resp.set_cookie(COOKIE, token, httponly=True, samesite="strict", secure=cfg.dashboard.secure_cookies,
                        max_age=cfg.dashboard.session_ttl_min * 60, path="/")
        return resp

    @app.post("/api/logout")
    def logout(request: Request):
        require(request, csrf=True)
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(COOKIE, path="/")
        return resp

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request):
        s = session(request)
        if s is None:
            return RedirectResponse("/login", status_code=303)
        return templates.TemplateResponse(request, "index.html", {"csrf": s["csrf"], "version": __version__})

    @app.get("/api/status")
    def status(request: Request) -> dict[str, Any]:
        require(request)
        st = storage.read_status() or {}
        written = st.pop("_written_at", None)
        age = (utcnow() - datetime.fromisoformat(written)).total_seconds() if written else None
        return {
            "status": st, "status_age_s": age, "service_running": age is not None and age < 10,
            "reports": reports(st),
            "events": storage.recent_events(60),
            "errors": storage.recent_events(30, min_level="warning"),
            "decisions": storage.recent_decisions(40),
            "controls": storage.recent_controls(10),
            "trades": storage.trades(50),
            "equity": _downsample(storage.equity_curve(200_000), 1500),
            "models": storage.models(),
            "overrides": storage.overrides(),
            "hard_limits": cfg.hard_limits.model_dump(),
            "config": {"mode": cfg.mode, "live_enabled": cfg.live_enabled, "symbols": cfg.symbols.enabled,
                       "risk": cfg.risk.model_dump(), "exits": strategy.exits.model_dump(),
                       "strategy": strategy.full_version, "timeframes": [strategy.entry_tf, strategy.trend_tf],
                       "llm_mode": cfg.llm.mode, "ml_enabled": cfg.ml.enabled, "news": cfg.news.provider},
        }

    @app.post("/api/control")
    async def control(request: Request):
        require(request, csrf=True)
        body = await request.json()
        action = str(body.get("action", ""))
        params = body.get("params") or {}
        if action not in ALLOWED_ACTIONS or not isinstance(params, dict):
            raise HTTPException(400, "unknown action")
        if action == "set_limits":
            clean = {}
            for k, v in params.items():
                if k not in LIMIT_KEYS:
                    raise HTTPException(400, f"{k} is not editable")
                try:
                    val = LIMIT_KEYS[k](v)
                except (TypeError, ValueError):
                    raise HTTPException(400, f"{k} must be a number")
                cap = getattr(cfg.hard_limits, k)
                if val < 0 or val > cap or (val == 0 and k != "max_entries_per_day"):
                    raise HTTPException(400, f"{k} must be within (0, {cap}] (hard limit from the config file)")
                clean[k] = val
            params = clean
        if action == "estop_clear" and params.get("confirm") != "CLEAR":
            raise HTTPException(400, "type CLEAR to confirm")
        if action == "estop":
            params = {"policy": "close_all" if params.get("policy", cfg.risk.emergency_stop_policy) == "close_all"
                      else "hold"}
            try:  # direct path to the EA: works even if the service is not running
                FileBridge(resolve_bridge_dir(cfg.bridge), cfg.bridge.magic_number).set_estop_flag(
                    params["policy"], "dashboard")
            except Exception as e:
                storage.log_event("warning", "dashboard", "ESTOP_FLAG", f"could not write estop.flag directly: {e}")
        cid = storage.add_control(action, params, "operator")
        storage.audit("operator", f"request_{action}", params)
        return {"ok": True, "id": cid, "note": "queued - applied by the service within ~1 s"}

    @app.get("/api/trades.csv")
    def export_trades(request: Request):
        require(request)
        rows = storage.trades(100_000)
        buf = io.StringIO()
        cols = ["ticket", "signal_id", "symbol", "side", "volume", "open_time", "open_price", "initial_sl", "tp",
                "planned_risk", "close_time", "close_price", "profit", "swap", "commission", "net_profit",
                "r_multiple", "status", "comment"]
        w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
        return Response(buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="fxai_trades.csv"'})

    @app.get("/api/watchlist.csv")
    def export_watchlist(request: Request):
        require(request)
        buf = io.StringIO()
        cols = ["id", "symbol", "strategy", "side", "status", "status_reason", "stage", "trigger_level", "invalidation",
                "created", "expires", "last_bar", "confirmations", "signal_id", "conditions", "evidence"]
        w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in storage.watch_recent(100_000):
            w.writerow({**r, "conditions": json.dumps(r["conditions"]), "evidence": " | ".join(r["evidence"])})
        return Response(buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="fxai_watchlist.csv"'})

    @app.get("/api/report.json")
    def export_report(request: Request):
        require(request)
        st = storage.read_status() or {}
        body = json.dumps({"generated": utcnow().isoformat(), "reports": build_reports(cfg, storage, strategy.full_version, st),
                           "scan": st.get("scan"), "limits": st.get("limits")}, indent=2, default=str)
        return Response(body, media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="fxai_report.json"'})

    @app.get("/api/decisions.csv")
    def export_decisions(request: Request):
        require(request)
        rows = storage.recent_decisions(100_000)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["ts", "symbol", "bar_time", "action", "regime", "strategy_version", "model_version", "reasons"])
        for r in rows:
            w.writerow([r["ts"], r["symbol"], r["bar_time"], r["action"], r["regime"], r["strategy_version"],
                        r["model_version"], " | ".join(r["reasons"])])
        return Response(buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="fxai_decisions.csv"'})

    return app


def build_reports(cfg: AppConfig, storage: Storage, version: str, st: dict[str, Any]) -> dict[str, Any]:
    # The service's clock (equal to wall-clock time in demo/live; simulated time in paper mode).
    try:
        now = datetime.fromisoformat((st.get("service") or {})["now"])
    except (KeyError, TypeError, ValueError):
        now = utcnow()
    acct, pnl, ex, lim = st.get("account") or {}, st.get("pnl") or {}, st.get("exposure") or {}, st.get("limits") or {}
    zone, hour, off = cfg.daily_reset.zone, cfg.daily_reset.hour, acct.get("server_offset_s")
    basis = f"trading day rolls at {hour:02d}:00 {zone} time"
    if zone == "server" and off is None:  # no EA snapshot yet: fall back to UTC calendar days (labelled)
        zone, hour, basis = "UTC", 0, "UTC calendar days (broker server offset not known yet)"
    trades = storage.trades(100_000)
    eq = storage.equity_curve(200_000)
    out: dict[str, Any] = {"day_basis": basis}
    out["performance"] = period_summary(trades, now, zone, hour, off)
    out["drawdown"] = drawdown(eq)
    out["allowance"] = risk_allowance(pnl.get("day_start_equity") or 0.0, acct.get("equity") or 0.0,
                                      pnl.get("net_flows") or 0.0, lim.get("max_daily_loss_pct") or cfg.risk.max_daily_loss_pct,
                                      ex.get("open_risk") or 0.0)
    out["execution"] = {"kind": "actual", "by_symbol": storage.execution_quality()}
    # forecast: only this strategy version's own forward trades on this account
    mine = [t for t in trades if str(t.get("signal_id") or "").startswith(version + ":")]
    daily = daily_returns_pct(mine, eq, zone, hour, off)
    vpath = Path(cfg.reporting.validation_status_path)
    try:
        validation = json.loads(vpath.read_text()) if vpath.is_file() else None
    except (OSError, json.JSONDecodeError):
        validation = None
    n_closed = len([t for t in mine if t.get("status") == "CLOSED"])
    gate = evidence_gate(validation, version, n_closed, len(daily), cfg.reporting.forecast_min_trades,
                         cfg.reporting.forecast_min_days)
    out["forecast"] = forecast(daily, next_trading_days(now), acct.get("equity") or 0.0, n_closed, gate)
    ev = observed_evidence(cfg.reporting.experiments_dir)
    capital = acct.get("balance") or cfg.reporting.capital_for_scenarios
    t = cfg.reporting.aspirational_daily_target
    out["scenario"] = assess_target(capital, acct.get("currency") or cfg.account_currency, tuple(t) if t else None,
                                    lim.get("risk_per_trade_pct") or cfg.risk.risk_per_trade_pct,
                                    cfg.hard_limits.risk_per_trade_pct, cfg.risk.max_daily_loss_pct, ev,
                                    trades_per_day=(0.5, 1, 2), leverage=acct.get("leverage"))
    out["research"] = {"kind": "simulated", "runs": ev.get("detail", []), "any_passed": ev.get("any_passed", False),
                       "note": "backtests on historical data with modelled costs - not account results"}
    return out


def _downsample(rows: list[dict], n: int) -> list[dict]:
    """Evenly thin a long equity history for plotting; always keeps the last point."""
    if len(rows) <= n:
        return rows
    step = len(rows) / n
    out = [rows[int(i * step)] for i in range(n - 1)]
    out.append(rows[-1])
    return out


def app_from_env() -> FastAPI:  # uvicorn factory: uvicorn --factory fxai.dashboard.app:app_from_env
    from ..config import load_config, load_dotenv
    load_dotenv(os.environ.get("FXAI_ENV_FILE", ".env"))
    cfg = load_config()
    return create_app(cfg, Storage(cfg.storage.db_path))
