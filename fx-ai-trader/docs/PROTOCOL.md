# File protocol v1 (MT4 EA ↔ Python)

Folder: `%APPDATA%\MetaQuotes\Terminal\Common\Files\FXAI\<login>\`
(MQL4 `FILE_COMMON`; one sub-folder per account so several terminals cannot collide).

| File | Writer → reader | Format | Frequency |
|---|---|---|---|
| `state.json` | EA → Py | JSON | about once per second |
| `bars/<SYMBOL>_<TF>.csv` | EA → Py | CSV `time,open,high,low,close,volume,spread`; `time` = broker **server** epoch seconds; completed bars only, oldest first | on each new bar |
| `cmd/<seq:012d>.cmd` | Py → EA | KV line | per command |
| `res/<seq:012d>.res` | EA → Py | KV line | per processed command |
| `py_heartbeat.txt` | Py → EA | KV line `v,gmt,seq,mode,status` | every loop (1 s) |
| `estop.flag` | any → EA | KV line `policy=close_all\|hold,by,ts`; presence = emergency stop | on demand |
| `ea_tags.csv`, `ea_pending.csv` | EA only | tag→ticket map; pending reconciliations | on change |

All writes go to a temporary name and are renamed into place. KV records look like
`k=v|k=v|...|end=1`; a record without `end=1` is treated as truncated and ignored. Values may
not contain `|`, `=` or newlines; free-text messages are sanitised (`|`→`/`, `=`→`:`).

## Time

`state.time.server = TimeGMT() + offset`, where the EA tracks
`offset = round((TimeCurrent() − TimeGMT()) / 1800) × 1800` while ticks are flowing (it freezes
over weekends). Python converts every server timestamp (ticks, orders, bars) to UTC with
`server − gmt`. `time.last_server` is the raw `TimeCurrent()`.

## state.json

```json
{"v":1,"seq":123,
 "time":{"server":1792497606,"gmt":1792490406,"local":1792490406,"last_server":1792497605},
 "account":{"login":900001,"server":"Broker-Demo","company":"...","currency":"USD","leverage":100,
            "balance":10000.0,"equity":10012.5,"margin":130.0,"free_margin":9882.5,
            "is_demo":true,"trade_allowed":true,"connected":true},
 "ea":{"version":"1.0.0","master":true,"trading_enabled":false,"live_allowed":false,
       "estop":false,"paused":false,"halted":false,"halt_reason":"","day_id":"2026-10-20",
       "day_start_equity":10000.0,"net_flows":0.0,"daily_loss_pct":0.0,"entries_today":1,
       "failed_today":0,"modifications_today":1,"partial_closes_today":0,"py_heartbeat_age":0.4,
       "last_cmd_seq":17,"server_offset":10800,
       "limits":{"risk_per_trade_pct":0.25,"total_risk_pct":1.0,"max_positions":3,
                 "max_entries":20,"daily_loss_pct":2.0}},
 "symbols":[{"name":"EURUSD.r","canonical":"EURUSD","base":"EUR","profit_ccy":"USD",
             "bid":1.10001,"ask":1.10009,"tick_time":1792497605,"digits":5,"point":0.00001,
             "tick_size":0.00001,"tick_value":1.0,"contract_size":100000,"min_lot":0.01,
             "max_lot":100,"lot_step":0.01,"stop_level":0,"freeze_level":0,
             "margin_required":1100.0,"trade_allowed":true,"swap_long":-6.1,"swap_short":1.2}],
 "orders":[{"ticket":1001,"symbol":"EURUSD.r","type":0,"lots":0.12,"open_price":1.1,
            "open_time":1792497000,"sl":1.098,"tp":1.104,"profit":1.2,"swap":0,"commission":-0.84,
            "magic":7340001,"comment":"FXAI|ABCDEFGHIJ"}],
 "history":[ "... closed orders (with close_time, close_price) and balance operations (type 6/7) since yesterday's day start ..." ],
 "events":[{"t":1792490400,"level":"info","code":"FILLED","msg":"..."}]}
```

`orders` includes manual trades (different magic) when `ExportManualOrders=true`. They are
used read-only for exposure and are never modified.

## Commands (Python → EA)

Common fields: `v`, `seq` (strictly increasing, never reused), `type`, `created` (GMT epoch),
`ttl` (seconds).

| type | extra fields | EA behaviour |
|---|---|---|
| `OPEN` | `id` signal id, `tag` 10-char base32 of sha256(id), `symbol` canonical, `side` BUY/SELL, `volume`, `sl`, `tp`, `ref` reference price, `maxdev` points, `maxrisk` money, `slip` points, `magic`; optional exit policy `hold_h` (0–1080), `be_r` (0–20, 0 = off), `be_pts` (0–2000), `trail_r` (−1–50, < 0 = off), `trail_dist` (price units, ≤ 5 % of price; required when trailing) | Refused if age > min(ttl, MaxCommandAgeSec). Duplicate tag means `DUPLICATE`. Then the full hard guard, write-ahead pending marker, `OrderSend` with comment `FXAI\|<tag>`; see the result statuses below |
| `MODIFY` | `ticket`, `sl`, `tp` | System orders only; the stop may not be removed or widened |
| `CLOSE` | `ticket`, `volume` (0 = full) | System orders only; a partial close is counted separately |
| `CLOSE_ALL` | `reason` | Close all system positions and delete system pending orders |
| `CANCEL_PENDING` | `reason` | Delete system pending orders |
| `ESTOP` | `action=set\|clear`, `policy=close_all\|hold`, `confirm=CLEAR` | Set: persistent estop and policy. Clear: only with `confirm=CLEAR` **and** no `estop.flag` present |
| `PAUSE` / `RESUME` | | Block or allow new entries (persisted) |
| `PING` | | Liveness |

The EA persists `last_cmd_seq` **before** acting and deletes the command file, so a crash can
never replay a command. Files with `seq <= last_cmd_seq` are answered `DUPLICATE`.

## Results (EA → Python)

`v, seq, type, status, id, ticket, err, attempts, msg, [price, volume, sl, tp], time, end=1`

| status | meaning | Python action |
|---|---|---|
| `FILLED` | order exists with its stop | entry counted once; trade tracked |
| `REJECTED` | definitely not executed (guard or broker), or executed-and-immediately-closed because protection failed | failed-attempt counter |
| `UNKNOWN` | ambiguous broker outcome | reconcile by tag; **never re-send** |
| `EXPIRED` | command too old | none |
| `DUPLICATE` | signal already executed or seq already processed | none |
| `DONE` / `ERROR` | control commands | log |

## Hard guard order in the EA (OPEN)

EnableTrading → live gate (`IsDemo()` or AllowLiveAccount) → estop → pause → daily-loss halt
→ Python heartbeat age → terminal connected and AutoTrading on → daily entry cap → max open
system positions → symbol configured → one position per symbol → symbol tradeable → quote age
→ spread → SL present, on the correct side and outside the stop level → price deviation vs
`ref` → volume within min/max/step → planned risk ≤ min(`maxrisk`, equity × MaxRiskPerTradePct)
× (1 + RiskTolerancePct) → open + new risk ≤ equity × MaxTotalRiskPct × (1 + tol) → free-margin
check.

## Per-order exit policy

Each OPEN carries the strategy's own exit policy, the one that was backtested. Without it the
EA would apply one global policy to every strategy.

- The EA validates the five values with `ValidateExits()`. The ranges are shared with
  `fxai.bridge.protocol.validate_exit_params`, and a test keeps them identical. Out-of-range
  values make the EA answer `REJECTED` with `invalid exit params: ...`.
- The policy is saved as GlobalVariables `FXAI_<login>_X{H,BR,BP,TR,TD,OK}_T<tag>` **before**
  `OrderSend`. On fill or reconciliation it moves to `..._<ticket>`, so it survives terminal
  restarts and ambiguous outcomes.
- `ManagePositions()` uses the ticket's policy:
  - break-even once profit >= `be_r` x R, at entry +/- `be_pts`;
  - trailing once profit >= `trail_r` x R, at a FIXED distance `trail_dist`, which is the
    strategy's trailing ATR multiple times the entry-timeframe ATR at the signal, exactly as
    in `fxai/backtest/fills.py`;
  - close after `hold_h` hours.
- Orders without a policy (older orders, manual tests) use the EA inputs as before. Stops
  only ever tighten.
