# Architecture

```
 ┌───────────────────────── Windows PC / VPS ─────────────────────────────────────────────┐
 │                                                                                          │
 │  MetaTrader 4 terminal ── broker server                                                  │
 │   └─ FXAI_Bridge.mq4 (ONE chart)                                                         │
 │        • every 0.5 s: day roll, cash flows, estop.flag, daily-loss check,                │
 │          position protection (SL restore/close, break-even, trailing, max hold)          │
 │        • executes cmd/*.cmd after its OWN hard checks (final gate)                       │
 │        • writes state.json (1/s), bars/*.csv (on bar close), res/*.res                   │
 │                │  ▲                                                                       │
 │   Common\Files\FXAI\<login>\   (atomic temp-file + rename on both sides)                 │
 │                ▼  │                                                                       │
 │  python -m fxai service (1 s loop)                                                        │
 │        FileBridge ─ read state/bars, write commands + heartbeat                          │
 │        TradeTracker / RiskState sync ── SQLite (WAL) ── storage of everything            │
 │        OrderManager (idempotent, write-ahead, reconcile, no blind retry)                 │
 │        on each NEW completed bar per symbol:                                              │
 │           Strategy (rules + reasons) → news blackout → [ML filter] → RiskEngine           │
 │           → [LLM review, can only veto] → RiskEngine again → OPEN command                │
 │                                                                                          │
 │  python -m fxai dashboard (127.0.0.1:8787)                                                │
 │        reads the status snapshot + tables from SQLite; writes control requests;          │
 │        emergency stop also written directly to estop.flag                                │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

## Responsibilities

| Layer | Owns | Never does |
|---|---|---|
| EA (MQL4) | Order execution, broker-side SL/TP, protective management, hard caps, daily-loss halt, persistent estop, daily counters (authoritative) | Decide entries on its own |
| Risk engine (Python) | Every pre-trade check and the position size | Run without a broker snapshot; accept a trade without a stop |
| Strategy | BUY/SELL/WAIT and the reasons for it, the structural stop | Size trades or touch limits |
| ML meta-filter | Removing low-scored baseline signals (only an approved model) | Create trades, change size |
| LLM review | An explanation; in `veto` mode it may turn BUY/SELL into WAIT | Create trades, see credentials or account data, change limits, call tools |
| Dashboard | Display and queue operator controls | Bypass the service's validation; expose secrets |

The risk engine is the deterministic authority on the Python side, and the EA re-checks the
hard limits before every `OrderSend`. When Python and the EA disagree, the stricter value wins:
`EffectiveLimits = min(config, dashboard override ≤ hard_limits, EA inputs)`, and the entry
count is `max(Python count, EA count)`.

## Why a file bridge (and not ZeroMQ, sockets or WebRequest)

MT4 is not MT5: MQL4 has no native socket API and no Python package (the `MetaTrader5`
Python module only works with MT5 terminals). The realistic options for MT4 are:

| Option | Verdict |
|---|---|
| ZeroMQ / named pipes / Winsock via DLL imports | Fast, but requires "Allow DLL imports". This is often forbidden by VPS or prop-firm policy, is a security risk, and binds you to 32-bit DLL builds |
| `WebRequest()` to a local HTTP server | Blocks the EA thread for every call, needs URL allow-listing, unavailable in the tester, and an HTTP failure stalls protection |
| **Files in `Terminal\Common\Files` (chosen)** | No DLLs, no allow-list, works on every MT4 build ≥ 600, survives restarts on both sides, trivially inspectable. Latency is a few hundred ms, which is fine for completed-bar decisions |

Atomicity: writers create `name.tmp` and rename it over the target (`FileMove(...FILE_REWRITE)`
in MQL4, `os.replace` in Python). Readers only parse complete records: JSON for state, and KV
lines ending in `end=1` for commands and results. A Windows sharing violation during the rename
is retried on the next cycle. Commands are one file per sequence number, so producer and
consumer never overwrite each other.

Both processes must run on the same machine (or share the folder). Running Python on another
host is possible via an SMB share but is not recommended.

## Failure handling

| Failure | What happens |
|---|---|
| Python service stops | Within `PyHeartbeatTimeoutSec` (30 s) the EA refuses any new entry. Stops, break-even, trailing, max-hold, daily-loss halt and estop keep running in the EA. Dashboard shows "Service not running" |
| EA / terminal stops | Python sees `state.json` age > `ea_heartbeat_timeout_s` and marks the bridge unhealthy: no decisions are submitted. Broker-side SL/TP remain on the server |
| Command result lost / ambiguous broker error (e.g. 128 timeout) | The EA writes `UNKNOWN`, keeps a persisted pending marker, and rescans orders and history for the `FXAI\|<tag>` comment. Python reconciles the same way. Found means FILLED (counted once). Not found within the window means NOT_FOUND, **never re-sent** |
| Requote / price changed / off quotes / context busy | These errors mean "definitely not executed", so the EA retries up to `MaxEntryRetries` with a fresh price, after re-running every guard and checking the tag again |
| Broker rejects SL on entry (market execution) | Two-step: open without SL, attach the SL immediately (3 tries); if that fails, the position is **closed at once** and logged as `PROTECTION_FAILED` |
| A system position is found without a stop | The EA restores the original stop (stored at fill), or closes the position after `UnprotectedGraceSec`. Python blocks all new entries meanwhile |
| Restart of either side | Counters, estop, pause, halt, last command seq, tag→ticket map and pending reconciliations are persisted (EA: GlobalVariables + files; Python: SQLite). The entry count is rebuilt from broker history if it was lost. A decision per bar is stored once (unique key), and an OPEN per signal id is stored once (unique index) |
| Two charts with the EA | A GlobalVariable lock (`GlobalVariableSetOnCondition`) elects one active instance; the others show STANDBY and do nothing. The lock is taken over after 15 s of silence |
| Stale command (EA was busy or down) | The EA refuses OPEN commands older than `min(ttl, MaxCommandAgeSec)`. Python withdraws unconsumed files after TTL + 5 s |

## Timing

- Monitoring: EA timer 500 ms; Python loop 1 s (state, quotes, health, reconciliation, safety).
- Decisions: only when a new **completed** entry-timeframe bar exists (the strategy's entry
  timeframe). A decision older than `signal_ttl_s` (90 s) is dropped. Signals on the same step
  are ranked before the risk engine sees them.
- Opportunity scan and watchlist re-evaluation: every `scan_interval_s` (≤ 60 s). The scan is
  advisory, so a failure is logged and monitoring continues.
- Higher-timeframe values are joined by bar **close** time (`merge_asof` backward), and swing
  levels count only after their confirmation bar has closed (no look-ahead; covered by a test).

## Storage schema (SQLite)

`signals`, `decisions` (unique per symbol/bar/strategy version), `commands` (unique OPEN per
signal), `trades`, `events`, `equity` (1/min), `kv` (risk state, command seq), `controls`,
`overrides`, `audit`, `models`, `llm_calls`, `watchlist` (one active setup per symbol, strategy and
side; closed ones keep their outcome), `status` (latest snapshot for the dashboard, incl. the scan).
WAL mode lets the dashboard read while the service writes.
