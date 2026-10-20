# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Dashboard: "EA/bridge: state.json not found (EA not running?)" | EA not attached, wrong folder, or `bridge.account` mismatch | Check the chart shows `[ACTIVE]`; open `%APPDATA%\MetaQuotes\Terminal\Common\Files\FXAI\` and confirm a folder named after the login; set `bridge.account` |
| "EA snapshot is Ns old" | Terminal frozen, EA removed, timer stopped, or the file is locked by an antivirus scan | Check the MT4 *Experts* tab; exclude the `Common\Files\FXAI` folder from real-time AV scanning |
| "EA instance is not the master" | EA attached to two charts, or a stale lock after a crash | Remove the extra chart; a stale lock is taken over automatically after 15 s |
| Chart comment: Python heartbeat large | Service not running, or the PC clock jumped | Start `python -m fxai service`; keep Windows time sync on |
| `SYMBOL_MISSING` in the EA log | Suffix/prefix wrong or symbol not in Market Watch | Set `SymbolSuffix`/`SymbolPrefix`; Market Watch → Show All |
| "no H1/H4 bars from EA yet" | History not loaded for that symbol/timeframe (error 4066) | Open a chart of that symbol/timeframe once, scroll back; wait one bar |
| Every decision is WAIT | Normal most of the time: the reasons list the failed rule. Check the block reasons banner too | Read the reasons; WAIT is the designed default |
| `OPEN_REJECTED: EnableTrading is false` | Safe default | Set EA input `EnableTrading=true` on **demo** |
| `live account and AllowLiveAccount is false` | Real-money account detected | Intended. See DEMO_AND_LIVE.md |
| `planned risk X > EA cap Y` | Python and EA limits differ, or price moved a lot between sizing and execution | Align `risk_per_trade_pct` with `MaxRiskPerTradePct`; check spreads |
| `broker minimum lot ... would risk ... > budget` | Account too small for the stop distance at 0.25 % risk | Expected protective behaviour; the trade is skipped |
| Result `UNKNOWN`, then `RECONCILED` / `NOT_FOUND` | Broker timeout or lost acknowledgement | Nothing to do: the system reconciled without re-sending. Investigate if frequent (connection quality) |
| `PROTECTION_FAILED` | Broker refused to attach a stop-loss after entry | The position was closed immediately. Check stop/freeze levels and the broker's execution mode |
| `UNPROTECTED` | A system position lost its SL (manual edit or broker issue) | The EA restores the original SL or closes after the grace period. Don't remove stops by hand |
| Daily loss halt shows on a deposit/withdrawal day | Account History not set to "All History", so the cash flow was not seen | Set Account History → All History |
| `PermissionError ... (locked)` in the service log | Windows sharing violation during a rename | Harmless if occasional (retried); persistent → AV scanning or another program holding the file |
| Dashboard refuses to start | `FXAI_DASHBOARD_PASSWORD_HASH` / `FXAI_SECRET_KEY` missing | `python -m fxai hash-password`, `python -m fxai gen-secret`, put both in `.env` |
| Dashboard login: 429 | 5 failed attempts | Wait 5 minutes |
| `ml.enabled but no approved model` | ML switched on without an approved model | Keep `ml.enabled: false`, or train and approve a model that passes its gates |
| LLM status "unavailable" | Package missing, no credentials, budget reached, timeout | `pip install -r requirements-llm.txt`; set `ANTHROPIC_API_KEY`; check `llm` limits. Trading continues per `on_unavailable` |
| Emergency stop will not clear | `estop.flag` still exists, or `CLEAR` not typed | Use the dashboard button (it removes the flag), type `CLEAR` |
| Service refuses `mode: live` | Missing `live_trading_acknowledged` or a passed `reports/validation_status.json` | Intentional. See DEMO_AND_LIVE.md |

Logs: the service writes to the console (run it under Task Scheduler with output redirected, see
`scripts/windows/run_service.ps1`), the database `events` table (dashboard "Event log"), and
the EA's *Experts* tab plus the `events` array in `state.json`.
