"""Durable storage (SQLite, WAL mode).

Holds signals, decisions, commands/orders, fills (trades), errors/events,
equity snapshots, persistent risk state, control requests from the dashboard,
runtime limit overrides (with audit), the model registry and LLM call log.

One connection per thread; WAL lets the dashboard read while the service writes.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

from .timeutil import utcnow

SCHEMA_VERSION = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    strategy TEXT NOT NULL,
    strategy_version TEXT NOT NULL,
    bar_time TEXT NOT NULL,
    entry_ref REAL, sl REAL, tp REAL,
    ml_score REAL, ml_model_version TEXT,
    llm_assessment TEXT,
    status TEXT NOT NULL,
    reasons TEXT, features TEXT, risk TEXT
);

CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    symbol TEXT NOT NULL,
    bar_time TEXT NOT NULL,
    action TEXT NOT NULL,
    regime TEXT,
    strategy_version TEXT,
    model_version TEXT,
    reasons TEXT,
    signal_id TEXT,
    UNIQUE(symbol, bar_time, strategy_version)
);
CREATE INDEX IF NOT EXISTS ix_decisions_ts ON decisions(ts);

CREATE TABLE IF NOT EXISTS commands (
    seq INTEGER PRIMARY KEY,
    signal_id TEXT,
    type TEXT NOT NULL,
    symbol TEXT,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    resolved_at TEXT,
    result TEXT,
    ticket INTEGER,
    day_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_commands_open_signal
    ON commands(signal_id) WHERE type = 'OPEN';
CREATE INDEX IF NOT EXISTS ix_commands_status ON commands(status);

CREATE TABLE IF NOT EXISTS trades (
    ticket INTEGER PRIMARY KEY,
    signal_id TEXT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    volume REAL NOT NULL,
    open_time TEXT NOT NULL,
    open_price REAL NOT NULL,
    initial_sl REAL, tp REAL,
    planned_risk REAL,
    close_time TEXT,
    close_price REAL,
    profit REAL, swap REAL, commission REAL,
    net_profit REAL,
    r_multiple REAL,
    status TEXT NOT NULL,
    comment TEXT
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    code TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT
);
CREATE INDEX IF NOT EXISTS ix_events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS equity (
    ts TEXT PRIMARY KEY,
    balance REAL, equity REAL, margin REAL, free_margin REAL,
    floating REAL, realized_today REAL, daily_loss_pct REAL, open_risk REAL
);

CREATE TABLE IF NOT EXISTS controls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    action TEXT NOT NULL,
    params TEXT,
    requested_by TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    applied_at TEXT,
    result TEXT
);

CREATE TABLE IF NOT EXISTS overrides (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT
);

CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT
);

CREATE TABLE IF NOT EXISTS models (
    version TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    approved_at TEXT,
    approved_by TEXT,
    metrics TEXT
);

CREATE TABLE IF NOT EXISTS llm_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    model TEXT,
    status TEXT NOT NULL,
    latency_ms INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    output TEXT
);
CREATE INDEX IF NOT EXISTS ix_llm_key ON llm_calls(cache_key);

CREATE TABLE IF NOT EXISTS status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    ts TEXT NOT NULL,
    data TEXT NOT NULL
);

-- Watchlist: partially formed setups, re-evaluated against fresh data every scan.
-- status: active | triggered | expired | invalidated. Only one active row per
-- (symbol, strategy, side); a re-confirmation on a newer bar refreshes it.
CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    strategy TEXT NOT NULL,
    side INTEGER NOT NULL,
    created TEXT NOT NULL,
    expires TEXT NOT NULL,
    updated TEXT NOT NULL,
    last_bar TEXT,
    confirmations INTEGER NOT NULL DEFAULT 1,
    stage REAL,
    trigger_level REAL,
    invalidation REAL,
    conditions TEXT,
    evidence TEXT,
    status TEXT NOT NULL,
    status_reason TEXT,
    signal_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_watch_active ON watchlist(symbol, strategy, side) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_watch_status ON watchlist(status, updated);
"""


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _dumps(obj: Any) -> str:
    return json.dumps(obj, default=str, separators=(",", ":"))


class Storage:
    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._lock = threading.RLock()
        with self._lock:
            c = self._conn()
            c.executescript(_SCHEMA)  # executescript manages its own transaction
            c.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))

    # -- connection management -------------------------------------------------
    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.path, timeout=10, isolation_level=None, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            if self.path != ":memory:":
                conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA busy_timeout=10000")
            conn.execute("PRAGMA foreign_keys=ON")
            self._local.conn = conn
        return conn

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        c = self._conn()
        with self._lock:
            c.execute("BEGIN IMMEDIATE")
            try:
                yield c
                c.execute("COMMIT")
            except BaseException:
                c.execute("ROLLBACK")
                raise

    def query(self, sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
        return [dict(r) for r in self._conn().execute(sql, params).fetchall()]

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None

    # -- key/value (persistent risk state etc.) --------------------------------
    def kv_get(self, key: str, default: Any = None) -> Any:
        rows = self.query("SELECT value FROM kv WHERE key=?", (key,))
        return json.loads(rows[0]["value"]) if rows else default

    def kv_set(self, key: str, value: Any) -> None:
        with self.tx() as c:
            c.execute(
                "INSERT INTO kv(key, value, updated_at) VALUES (?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                (key, _dumps(value), utcnow().isoformat()),
            )

    # -- events ----------------------------------------------------------------
    def log_event(self, level: str, source: str, code: str, message: str, data: Any = None) -> None:
        with self.tx() as c:
            c.execute(
                "INSERT INTO events(ts, level, source, code, message, data) VALUES (?,?,?,?,?,?)",
                (utcnow().isoformat(), level, source, code, message[:2000], _dumps(data) if data is not None else None),
            )

    def recent_events(self, limit: int = 100, min_level: str | None = None) -> list[dict[str, Any]]:
        if min_level == "warning":
            return self.query(
                "SELECT * FROM events WHERE level IN ('warning','error','critical') ORDER BY id DESC LIMIT ?", (limit,)
            )
        return self.query("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))

    # -- watchlist ---------------------------------------------------------------
    def watch_active(self, symbol: str | None = None) -> list[dict[str, Any]]:
        sql, args = "SELECT * FROM watchlist WHERE status='active'", ()
        if symbol:
            sql, args = sql + " AND symbol=?", (symbol,)
        return [self._watch_row(r) for r in self.query(sql + " ORDER BY id", args)]

    def watch_upsert(self, w: dict[str, Any]) -> int:
        """Insert a new active setup, or refresh the active one for (symbol, strategy, side)."""
        with self.tx() as c:
            cur = c.execute("SELECT id, confirmations, last_bar FROM watchlist WHERE status='active' AND symbol=? "
                            "AND strategy=? AND side=?", (w["symbol"], w["strategy"], w["side"])).fetchone()
            vals = (_iso(w["expires"]), utcnow().isoformat(), _iso(w["last_bar"]), w["stage"], w["trigger_level"],
                    w["invalidation"], _dumps(w["conditions"]), _dumps(w["evidence"]))
            if cur is None:
                c.execute("INSERT INTO watchlist(symbol, strategy, side, created, expires, updated, last_bar, stage, "
                          "trigger_level, invalidation, conditions, evidence, status) "
                          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'active')",
                          (w["symbol"], w["strategy"], w["side"], _iso(w["created"]), *vals))
                return int(c.execute("SELECT last_insert_rowid()").fetchone()[0])
            conf = cur["confirmations"] + (1 if cur["last_bar"] != _iso(w["last_bar"]) else 0)
            c.execute("UPDATE watchlist SET expires=?, updated=?, last_bar=?, stage=?, trigger_level=?, invalidation=?, "
                      "conditions=?, evidence=?, confirmations=? WHERE id=?", (*vals, conf, cur["id"]))
            return int(cur["id"])

    def watch_close(self, wid: int, status: str, reason: str, signal_id: str | None = None) -> None:
        assert status in ("triggered", "expired", "invalidated")
        with self.tx() as c:
            c.execute("UPDATE watchlist SET status=?, status_reason=?, signal_id=?, updated=? WHERE id=? "
                      "AND status='active'", (status, reason[:300], signal_id, utcnow().isoformat(), wid))

    def watch_closed_since(self, symbol: str, strategy: str, side: int, bar: datetime) -> bool:
        """True if a setup for (symbol, strategy, side) was already closed after being confirmed on ``bar`` or later."""
        return bool(self.query("SELECT 1 FROM watchlist WHERE status!='active' AND symbol=? AND strategy=? AND side=? "
                               "AND last_bar >= ? LIMIT 1", (symbol, strategy, side, _iso(bar))))

    def watch_recent(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.query("SELECT * FROM watchlist ORDER BY (status='active') DESC, updated DESC LIMIT ?", (limit,))
        return [self._watch_row(r) for r in rows]

    @staticmethod
    def _watch_row(r: dict[str, Any]) -> dict[str, Any]:
        r["conditions"] = json.loads(r["conditions"] or "{}")
        r["evidence"] = json.loads(r["evidence"] or "[]")
        return r

    def execution_quality(self, limit: int = 50) -> dict[str, dict[str, Any]]:
        """Per symbol, over the last ``limit`` OPEN commands: fills, rejections, unknown outcomes and the
        fill price versus the decision-time reference price (positive = adverse slippage, in price units)."""
        rows = self.query(
            "SELECT c.symbol, c.status, c.payload, t.open_price, t.side FROM commands c "
            "LEFT JOIN trades t ON t.signal_id = c.signal_id WHERE c.type='OPEN' ORDER BY c.seq DESC LIMIT ?", (limit,))
        out: dict[str, dict[str, Any]] = {}
        for r in rows:
            q = out.setdefault(r["symbol"], {"orders": 0, "filled": 0, "rejected": 0, "unknown": 0, "slippage": []})
            q["orders"] += 1
            st = r["status"]
            q["filled"] += st == "FILLED"
            q["rejected"] += st in ("REJECTED", "EXPIRED", "WITHDRAWN")
            q["unknown"] += st in ("UNKNOWN", "NOT_FOUND")
            if st == "FILLED" and r["open_price"] is not None:
                ref = json.loads(r["payload"] or "{}").get("ref")
                if ref:
                    sign = 1 if r["side"] == "BUY" else -1
                    q["slippage"].append((float(r["open_price"]) - float(ref)) * sign)
        for q in out.values():
            sl = q.pop("slippage")
            q["mean_adverse_slippage"] = sum(sl) / len(sl) if sl else None
            q["worst_adverse_slippage"] = max(sl) if sl else None
        return out

    # -- decisions & signals ---------------------------------------------------
    def record_decision(self, symbol: str, bar_time: datetime, action: str, regime: str | None,
                        strategy_version: str, model_version: str | None, reasons: list[str],
                        signal_id: str | None = None) -> bool:
        """Returns False if this (symbol, bar, strategy) was already decided."""
        with self.tx() as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO decisions(ts, symbol, bar_time, action, regime, strategy_version, "
                "model_version, reasons, signal_id) VALUES (?,?,?,?,?,?,?,?,?)",
                (utcnow().isoformat(), symbol, _iso(bar_time), action, regime, strategy_version,
                 model_version, _dumps(reasons), signal_id),
            )
            return cur.rowcount == 1

    def decision_exists(self, symbol: str, bar_time: datetime, strategy_version: str) -> bool:
        return bool(self.query(
            "SELECT 1 FROM decisions WHERE symbol=? AND bar_time=? AND strategy_version=?",
            (symbol, _iso(bar_time), strategy_version)))

    def recent_decisions(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.query("SELECT * FROM decisions ORDER BY id DESC LIMIT ?", (limit,))
        for r in rows:
            r["reasons"] = json.loads(r["reasons"] or "[]")
        return rows

    def insert_signal(self, sig: dict[str, Any]) -> bool:
        with self.tx() as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO signals(signal_id, created_at, symbol, side, strategy, strategy_version, "
                "bar_time, entry_ref, sl, tp, ml_score, ml_model_version, llm_assessment, status, reasons, "
                "features, risk) VALUES (:signal_id,:created_at,:symbol,:side,:strategy,:strategy_version,"
                ":bar_time,:entry_ref,:sl,:tp,:ml_score,:ml_model_version,:llm_assessment,:status,:reasons,"
                ":features,:risk)",
                {**sig, "reasons": _dumps(sig.get("reasons")), "features": _dumps(sig.get("features")),
                 "risk": _dumps(sig.get("risk"))},
            )
            return cur.rowcount == 1

    def update_signal_status(self, signal_id: str, status: str, **extra: Any) -> None:
        sets = ["status=?"]
        vals: list[Any] = [status]
        for k, v in extra.items():
            if k not in ("llm_assessment", "risk"):
                raise ValueError(k)
            sets.append(f"{k}=?")
            vals.append(_dumps(v) if k == "risk" else v)
        vals.append(signal_id)
        with self.tx() as c:
            c.execute(f"UPDATE signals SET {', '.join(sets)} WHERE signal_id=?", vals)

    # -- commands --------------------------------------------------------------
    def next_command_seq(self) -> int:
        with self.tx() as c:
            row = c.execute("SELECT value FROM kv WHERE key='cmd_seq'").fetchone()
            cur = json.loads(row["value"]) if row else 0
            # Never reuse a sequence number, even if the kv row was lost.
            mx = c.execute("SELECT COALESCE(MAX(seq),0) AS m FROM commands").fetchone()["m"]
            nxt = max(cur, mx) + 1
            c.execute(
                "INSERT INTO kv(key, value, updated_at) VALUES ('cmd_seq',?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                (_dumps(nxt), utcnow().isoformat()),
            )
            return nxt

    def insert_command(self, seq: int, ctype: str, payload: dict[str, Any], signal_id: str | None,
                       symbol: str | None, day_id: str | None, status: str = "QUEUED") -> None:
        with self.tx() as c:
            c.execute(
                "INSERT INTO commands(seq, signal_id, type, symbol, payload, status, created_at, day_id) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (seq, signal_id, ctype, symbol, _dumps(payload), status, utcnow().isoformat(), day_id),
            )

    def update_command(self, seq: int, status: str, result: dict[str, Any] | None = None,
                       ticket: int | None = None, sent: bool = False) -> None:
        now = utcnow().isoformat()
        with self.tx() as c:
            if sent:
                c.execute("UPDATE commands SET status=?, sent_at=? WHERE seq=?", (status, now, seq))
            else:
                c.execute(
                    "UPDATE commands SET status=?, resolved_at=?, result=COALESCE(?, result), "
                    "ticket=COALESCE(?, ticket) WHERE seq=?",
                    (status, now, _dumps(result) if result is not None else None, ticket, seq),
                )

    def commands_by_status(self, *statuses: str) -> list[dict[str, Any]]:
        q = ",".join("?" for _ in statuses)
        rows = self.query(f"SELECT * FROM commands WHERE status IN ({q}) ORDER BY seq", statuses)
        for r in rows:
            r["payload"] = json.loads(r["payload"])
            r["result"] = json.loads(r["result"]) if r["result"] else None
        return rows

    def command(self, seq: int) -> dict[str, Any] | None:
        rows = self.query("SELECT * FROM commands WHERE seq=?", (seq,))
        if not rows:
            return None
        r = rows[0]
        r["payload"] = json.loads(r["payload"])
        r["result"] = json.loads(r["result"]) if r["result"] else None
        return r

    def open_command_for_signal(self, signal_id: str) -> dict[str, Any] | None:
        rows = self.query("SELECT seq FROM commands WHERE signal_id=? AND type='OPEN'", (signal_id,))
        return self.command(rows[0]["seq"]) if rows else None

    def count_commands(self, day_id: str, ctype: str, statuses: tuple[str, ...]) -> int:
        q = ",".join("?" for _ in statuses)
        rows = self.query(
            f"SELECT COUNT(*) AS n FROM commands WHERE day_id=? AND type=? AND status IN ({q})",
            (day_id, ctype, *statuses))
        return int(rows[0]["n"])

    # -- trades ----------------------------------------------------------------
    def upsert_trade(self, t: dict[str, Any]) -> None:
        cols = ["ticket", "signal_id", "symbol", "side", "volume", "open_time", "open_price", "initial_sl", "tp",
                "planned_risk", "close_time", "close_price", "profit", "swap", "commission", "net_profit",
                "r_multiple", "status", "comment"]
        vals = {k: t.get(k) for k in cols}
        upd = ", ".join(f"{k}=COALESCE(excluded.{k}, trades.{k})" for k in cols if k != "ticket")
        with self.tx() as c:
            c.execute(
                f"INSERT INTO trades({', '.join(cols)}) VALUES ({', '.join(':' + k for k in cols)}) "
                f"ON CONFLICT(ticket) DO UPDATE SET {upd}",
                vals,
            )

    def trade(self, ticket: int) -> dict[str, Any] | None:
        rows = self.query("SELECT * FROM trades WHERE ticket=?", (ticket,))
        return rows[0] if rows else None

    def trades(self, limit: int = 10_000) -> list[dict[str, Any]]:
        return self.query("SELECT * FROM trades ORDER BY open_time DESC LIMIT ?", (limit,))

    # -- equity ----------------------------------------------------------------
    def record_equity(self, row: dict[str, Any]) -> None:
        with self.tx() as c:
            c.execute(
                "INSERT OR REPLACE INTO equity(ts, balance, equity, margin, free_margin, floating, "
                "realized_today, daily_loss_pct, open_risk) VALUES (:ts,:balance,:equity,:margin,:free_margin,"
                ":floating,:realized_today,:daily_loss_pct,:open_risk)",
                row,
            )

    def equity_curve(self, limit: int = 2000) -> list[dict[str, Any]]:
        return list(reversed(self.query("SELECT * FROM equity ORDER BY ts DESC LIMIT ?", (limit,))))

    # -- dashboard controls / overrides / audit --------------------------------
    def add_control(self, action: str, params: dict[str, Any] | None, requested_by: str) -> int:
        with self.tx() as c:
            cur = c.execute(
                "INSERT INTO controls(ts, action, params, requested_by) VALUES (?,?,?,?)",
                (utcnow().isoformat(), action, _dumps(params or {}), requested_by),
            )
            return int(cur.lastrowid)

    def pending_controls(self) -> list[dict[str, Any]]:
        rows = self.query("SELECT * FROM controls WHERE status='pending' ORDER BY id")
        for r in rows:
            r["params"] = json.loads(r["params"] or "{}")
        return rows

    def resolve_control(self, cid: int, status: str, result: str) -> None:
        with self.tx() as c:
            c.execute("UPDATE controls SET status=?, applied_at=?, result=? WHERE id=?",
                      (status, utcnow().isoformat(), result[:1000], cid))

    def recent_controls(self, limit: int = 20) -> list[dict[str, Any]]:
        return self.query("SELECT * FROM controls ORDER BY id DESC LIMIT ?", (limit,))

    def set_override(self, key: str, value: Any, by: str) -> None:
        with self.tx() as c:
            c.execute(
                "INSERT INTO overrides(key, value, updated_at, updated_by) VALUES (?,?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, "
                "updated_by=excluded.updated_by",
                (key, _dumps(value), utcnow().isoformat(), by),
            )
            c.execute("INSERT INTO audit(ts, actor, action, detail) VALUES (?,?,?,?)",
                      (utcnow().isoformat(), by, "set_override", _dumps({key: value})))

    def overrides(self) -> dict[str, Any]:
        return {r["key"]: json.loads(r["value"]) for r in self.query("SELECT key, value FROM overrides")}

    def audit(self, actor: str, action: str, detail: Any = None) -> None:
        with self.tx() as c:
            c.execute("INSERT INTO audit(ts, actor, action, detail) VALUES (?,?,?,?)",
                      (utcnow().isoformat(), actor, action, _dumps(detail)))

    # -- status snapshot for the dashboard -------------------------------------
    def write_status(self, data: dict[str, Any]) -> None:
        with self.tx() as c:
            c.execute("INSERT OR REPLACE INTO status(id, ts, data) VALUES (1, ?, ?)",
                      (utcnow().isoformat(), _dumps(data)))

    def read_status(self) -> dict[str, Any] | None:
        rows = self.query("SELECT ts, data FROM status WHERE id=1")
        if not rows:
            return None
        d = json.loads(rows[0]["data"])
        d["_written_at"] = rows[0]["ts"]
        return d

    # -- models ----------------------------------------------------------------
    def register_model(self, version: str, path: str, sha256: str, metrics: dict[str, Any]) -> None:
        with self.tx() as c:
            c.execute(
                "INSERT OR REPLACE INTO models(version, path, sha256, status, created_at, metrics) "
                "VALUES (?,?,?,?,?,?)",
                (version, path, sha256, "candidate", utcnow().isoformat(), _dumps(metrics)),
            )

    def approve_model(self, version: str, by: str) -> None:
        with self.tx() as c:
            c.execute("UPDATE models SET status='retired' WHERE status='approved'")
            c.execute("UPDATE models SET status='approved', approved_at=?, approved_by=? WHERE version=?",
                      (utcnow().isoformat(), by, version))
            c.execute("INSERT INTO audit(ts, actor, action, detail) VALUES (?,?,?,?)",
                      (utcnow().isoformat(), by, "approve_model", _dumps({"version": version})))

    def approved_model(self) -> dict[str, Any] | None:
        rows = self.query("SELECT * FROM models WHERE status='approved'")
        return rows[0] if rows else None

    def models(self) -> list[dict[str, Any]]:
        return self.query("SELECT version, status, created_at, approved_at, approved_by, sha256 FROM models "
                          "ORDER BY created_at DESC")

    # -- LLM call log ----------------------------------------------------------
    def log_llm_call(self, row: dict[str, Any]) -> None:
        with self.tx() as c:
            c.execute(
                "INSERT INTO llm_calls(ts, cache_key, model, status, latency_ms, input_tokens, output_tokens, "
                "cost_usd, output) VALUES (:ts,:cache_key,:model,:status,:latency_ms,:input_tokens,"
                ":output_tokens,:cost_usd,:output)",
                row,
            )

    def llm_usage_since(self, since_iso: str) -> tuple[int, float]:
        rows = self.query(
            "SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS c FROM llm_calls WHERE ts>=? AND status!='cache'",
            (since_iso,))
        return int(rows[0]["n"]), float(rows[0]["c"])
