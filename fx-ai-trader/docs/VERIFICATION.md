# What was verified, and what you must still verify

## Verified in the build environment (Linux, Python 3.13)

| Area | Evidence |
|---|---|
| 140 automated tests pass | `reports/test_output.txt` (from `python -m pytest -v`) |
| Pinned dependencies resolve and install cleanly in a fresh venv | `pip install -r requirements-dev.txt -r requirements-llm.txt` then `pip check`: "No broken requirements found" |
| Sizing, rounding, min-lot skip, tick-value use | `tests/test_sizing.py` |
| Every risk check incl. currency, correlation, margin, daily loss with deposits, cooldowns, streaks, estop, live gate | `tests/test_risk_engine.py` |
| Trading-day/DST logic = IANA tz database (every 30 min, 2008–2037) | `tests/test_time_and_storage.py` |
| No look-ahead in strategy features (truncated-history recomputation) | `tests/test_strategy.py::test_no_lookahead` |
| Fill rules (gaps, stop-first ambiguity, spread, slippage, BE, trailing, time stop, swap) | `tests/test_backtest_fills.py` |
| Duplicates, ambiguous fills, requotes, expiry, withdrawal, restarts, stale data, Python down, daily reset, daily loss + close-all, estop (incl. flag-file path), two-step SL, protection failure, EA caps, trading disabled, live gate | `tests/test_integration.py` (Python EA emulator over real files) |
| Strategy signal → bars in server time → decision → order with SL/TP and ≤ 0.25 % risk | `tests/test_pipeline.py` |
| Dashboard auth, rate limit, CSRF, limit validation, estop flag, no secrets in responses | `tests/test_dashboard.py`; screenshots in `docs/img/` from a real browser (Chromium) |
| LLM output validation, caching, budgets, veto-only policy, no tools, request shape | `tests/test_llm.py` (fake client) |
| ML purging/embargo, approval gate, hash verification, JSON-only models | `tests/test_ml_news_config.py` |
| EA source consistency with the Python side (fields, inputs, commands, DST constants, no DLL/WebRequest, balanced delimiters) | `tests/test_ea_source.py` |
| Backtests and walk-forward on real data | `reports/validation/` |
| Paper trading through the real service and bridge code | a 21-day 2019 session: 1,443 decisions, 1 trade (filled with SL/TP, stopped out −1.05R), day rolls correct |

## NOT verified here (no Windows, no MetaEditor, no broker)

1. **MQL4 compilation.** The EA was written for MQL4 `#property strict` but has never been
   compiled.
2. **Real MT4 runtime behaviour.** File locking between the terminal and Python, `FileMove`
   replace semantics, `FileFindFirst` on `FILE_COMMON`, GlobalVariable persistence, the
   instance lock, timer cadence.
3. **Broker behaviour.** Stop levels, market vs. instant execution (two-step SL path), requote
   frequency, swap and commission figures, symbol suffixes, Account History scope.
4. **Live LLM calls** (no API key used) and any **news feed** (none bundled).
5. **USDJPY, USDCHF, NZDUSD backtests** (no data available).

## Exact remaining steps

1. **Compile.** In MetaEditor open `FXAI_Bridge.mq4` → F7. Expect 0 errors. If anything fails,
   the most likely spots are: `StringSplit` separator literals, `MathMin/MathMax` casts,
   `FileFindFirst` signature, `SymbolInfoString(…, SYMBOL_CURRENCY_BASE)`. Fix and re-run
   `python -m pytest tests/test_ea_source.py` if you change names or fields.
2. **Dry run (Stage 0 of [DEMO_AND_LIVE.md](DEMO_AND_LIVE.md))** with `EnableTrading=false`:
   - `Common\Files\FXAI\<login>\state.json` updates every second and is valid JSON
     (`python -m json.tool state.json`).
   - `bars\<SYM>_H1.csv` etc. exist with ~800 rows; times are server time.
   - `python -m fxai status` shows `"healthy": true`.
3. **Protocol smoke test on demo** (`EnableTrading=true`):
   - Use the dashboard: pause/resume (the EA chart comment changes), emergency stop hold and
     clear, close-all with no positions (result DONE).
   - Let one real signal trade, or temporarily lower `strategy.params.adx_min` on demo. Confirm
     the order has SL/TP, comment `FXAI|<tag>`, size ≤ 0.25 % risk, and the trade appears in
     the dashboard. Then put the parameter back.
   - Delete the SL manually in MT4 → within `UnprotectedGraceSec` the EA restores it (or closes).
   - Place a manual trade → confirm it is never modified.
   - Create `estop.flag` by hand (`python -m fxai estop --policy hold`) with Python stopped →
     the EA reacts.
4. **Restart tests:** restart MT4 and the service with an open demo position. Counters, estop
   and break-even behaviour persist and there are no duplicate orders.
5. **Two charts:** attach the EA to a second chart. It must show STANDBY.
6. **Record results** in `docs/RESEARCH_LOG.md` / your own log before any live consideration.
