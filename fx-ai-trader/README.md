# fxai: risk-first, AI-assisted FX trading system for MetaTrader 4

An autonomous trading stack for MT4 that monitors the market about once a second, decides
BUY / SELL / WAIT on completed bars, and executes only through a deterministic risk engine
and an independent final risk gate inside the MT4 Expert Advisor.

> **Read this first.**
> - **No edge has been demonstrated.** These were evaluated on real 1-minute data (EURUSD,
>   GBPUSD, USDCAD, AUDUSD, 2007–2020) with pre-declared protocols:
>   - the baseline strategy and the ML filter;
>   - five further strategy ideas (research plan v2).
>
>   Every one lost money before costs, and none beat random entries. See
>   [docs/READINESS.md](docs/READINESS.md), [docs/VALIDATION.md](docs/VALIDATION.md) and
>   [docs/RESEARCH_LOG.md](docs/RESEARCH_LOG.md).
> - An aspirational daily target (for example USD 15–230) is **never** a trading input or a
>   forecast. `python -m fxai scenario` shows what it would require. The dashboard shows
>   forecast ranges only for a validated strategy with enough forward evidence; otherwise it
>   says "Insufficient evidence for a reliable estimate."
> - The system therefore ships **demo-only**. Live trading needs several explicit switches
>   (see [docs/DEMO_AND_LIVE.md](docs/DEMO_AND_LIVE.md)) and a recorded passing validation.
> - There is no promise of profit, win rate or "experience". Losses can exceed planned stop
>   amounts because of gaps, slippage and execution failures.
> - The MQL4 EA could **not be compiled** in the environment it was written in (no MetaEditor).
>   Follow [docs/VERIFICATION.md](docs/VERIFICATION.md) before relying on it.

## What is in the box

| Component | Path | What it does |
|---|---|---|
| MT4 Expert Advisor | `mql4/Experts/FXAI_Bridge.mq4` | Exports state, quotes and bars; executes commands after its own hard risk checks; keeps broker-side SL, break-even, trailing, max-hold, daily-loss halt and persistent emergency stop running without Python; single-instance lock; never touches manual trades |
| History export script | `mql4/Scripts/FXAI_ExportHistory.mq4` | Exports your broker's bars to CSV for backtesting |
| Python service | `fxai/service.py` | 1-second monitoring loop; decisions on completed bars; reconciliation; safety actions |
| Strategies | `fxai/strategy/` | Six explainable rule sets (baseline `trend_pullback` plus five plan-v2 candidates), each with its own timeframes and exit policy. Causal, with per-rule reasons, invalidation conditions and watchlist setups. **None validated** |
| Market scan and watchlist | `fxai/analysis/scanner.py`, `candles.py`, `fxai/execution/watchlist.py` | At least once a minute, per pair: multi-timeframe trend, momentum, volatility, support and resistance, candlesticks in context, breakout location, spread, session, exposure and correlation, execution quality, events (only with a feed). Attention ranking with reasons; setup lifecycle (active, triggered, expired, invalidated) |
| Research tooling | `fxai/research/` | Baseline audit, random-entry permutation test, pre-declared experiment runner with gates (`python -m fxai experiment`) |
| Reporting | `fxai/analytics/` | Actual period performance and costs, drawdown, daily risk allowance, evidence-gated forecasts (block bootstrap), target scenarios (`python -m fxai scenario`) |
| Risk engine | `fxai/risk/` | Sizing from tick value/size/lot step, per-trade/total/currency/correlation limits, margin, spread, stale quotes, cooldowns, loss streaks, daily loss with deposit handling, emergency stop |
| Execution | `fxai/execution/`, `fxai/bridge/` | File protocol, idempotent commands, ambiguous-outcome reconciliation (never blind-retries), trade tracking |
| ML meta-filter (optional) | `fxai/ml/` | Logistic regression, purged walk-forward, calibration check, JSON model files, human approval gate. **Currently not approvable** (failed its gates). |
| LLM review (optional, off) | `fxai/llm/` | Bounded Claude review of a candidate: structured JSON, can only veto, cached, timed out, budget-capped |
| Economic calendar | `fxai/news/` | CSV feed you supply; inactive (and shown as inactive) if none |
| Dashboard | `fxai/dashboard/` | Balance, equity, margin, currency; realised vs floating; day, week and month results with commission and swap separate; drawdown; remaining daily risk allowance; entries vs ceiling; open trades with risk at SL; pairs by attention; watchlist; decisions with explanations; broker, EA, Python, data and AI status; forecasts and scenarios. Every section is labelled ACTUAL, SIMULATED, FORECAST or SCENARIO. E-stop, pause and exports. Password and CSRF protected; secrets never reach the browser |
| Backtester | `fxai/backtest/` | Same strategy and risk code as live; M1 fills; spread, commission, swap and slippage; stop-first rule for intrabar ambiguity; validation report generator |
| Storage | `fxai/storage.py` | SQLite (WAL): signals, decisions, commands, trades, events, equity, risk state, controls, audit, models, LLM calls |

Screenshot of the dashboard (paper session on 2019 data, taken after the paper service was stopped, so it also shows the "service not running" banner):

![dashboard](docs/img/dashboard_v2.png)

## Status: implemented vs. tested vs. simulated vs. unavailable

| Item | Status |
|---|---|
| Python service, risk engine, order manager, storage, dashboard, CLI | Implemented and unit/integration tested (`reports/test_output.txt`) |
| File protocol end to end (service, bridge, files, EA emulator, simulated broker) | Tested with the Python EA emulator. The real MQL4 EA has **not** run against it yet |
| MQL4 EA (incl. per-order exit policy) | Written; static consistency checks pass (`tests/test_ea_source.py`); **not compiled, not run in MT4** |
| Backtests / walk-forward | Run on real Oanda M1 data, 2007-01 to 2020-05, 4 pairs; results in `reports/validation/` and `reports/experiments/` |
| Strategy research (plan v2) | 6 pre-declared candidates on 2007–2014: **all failed**; no later stage run (`docs/RESEARCH_LOG.md` entry 7) |
| Scan, watchlist, attention ranking, candlesticks | Implemented and tested with synthetic markets and a paper replay; heuristics, **not validated** as signals |
| Forecasts | Implemented; correctly report "Insufficient evidence" (no validated strategy) |
| USDJPY, USDCHF, NZDUSD | Supported in code; **no historical data was available here**, so they are not backtested |
| Spreads in backtests | **Modelled** (mid-price data has no bid/ask); assumptions in `fxai/backtest/costs.py` |
| Paper trading | Implemented (`python -m fxai paper`); historical replay through the real service and bridge code |
| Broker connectivity, demo forward test | **Not done**: needs your MT4 terminal and demo account |
| News feed | No feed bundled. CSV loader implemented; inactive by default |
| LLM review | Implemented and tested with a fake client; **no live API call was made**; off by default |

## Quick start (demo)

**Fastest path on a Windows VPS: [docs/VPS_QUICKSTART.md](docs/VPS_QUICKSTART.md)** (setup script + `python -m fxai doctor`).
Full instructions: [docs/INSTALL_WINDOWS_VPS.md](docs/INSTALL_WINDOWS_VPS.md).

```powershell
# Windows, in the fx-ai-trader folder
py -3.13 -m venv .venv                                  # tested with Python 3.13
.venv\Scripts\pip install -r requirements.txt
copy config\config.example.yaml config\config.yaml      # edit symbols suffix etc.
copy config\.env.example .env
.venv\Scripts\python -m fxai hash-password              # put the output in .env
.venv\Scripts\python -m fxai gen-secret                 # put the output in .env
# MT4: copy mql4\Experts\FXAI_Bridge.mq4 to <MT4 data folder>\MQL4\Experts, compile, attach to ONE chart
.venv\Scripts\python -m fxai service                    # terminal 1
.venv\Scripts\python -m fxai dashboard                  # terminal 2, then open http://127.0.0.1:8787
```

The EA ships with `EnableTrading=false`. Start that way to verify connectivity, then enable
it on a **demo** account.

## Tests and reproducibility

```bash
pip install -r requirements-dev.txt
python -m pytest                       # 216 tests: risk, sizing, time/DST, strategy causality (all six),
                                       # fills (fast vs reference), permutation test, protocol, per-order exits,
                                       # integration, scan/watchlist, reporting, dashboard security, LLM, ML gates
python -m fxai validate --data-root <oanda folder>    # regenerates reports/validation/<ts>/REPORT.md
python -m fxai experiment --stage dev --data-root <oanda folder> --jobs 3   # plan v2 stage 1 (appends to INDEX.md)
python -m fxai scenario --capital <amount> --currency <ccy>                # target scenario (not a forecast)
```

`scripts/fetch_oanda_data.sh` downloads the public dataset that was used.

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md): components, data flow, why a file bridge, failure handling
- [PROTOCOL.md](docs/PROTOCOL.md): MT4 to Python file protocol specification
- [RISK.md](docs/RISK.md): every risk control, the sizing formula, daily-loss calculation, policies and limitations
- [READINESS.md](docs/READINESS.md): honest readiness assessment and what is needed next
- [STRATEGY.md](docs/STRATEGY.md): every strategy and its status, the scan, watchlist and candlestick context, baseline rules
- [STRATEGY_AUDIT.md](docs/STRATEGY_AUDIT.md): why the baseline loses
- [RESEARCH_PLAN_v2.md](docs/RESEARCH_PLAN_v2.md): the pre-declared comparison of five ideas
- [DATA_SOURCES.md](docs/DATA_SOURCES.md): data used, licensed alternatives (quality, latency, coverage, cost), what the system cannot see
- [MODEL_CARD.md](docs/MODEL_CARD.md): ML meta-filter dataset, features, labels, validation, limitations; LLM design
- [VALIDATION.md](docs/VALIDATION.md): measured results, including losing periods
- [RESEARCH_LOG.md](docs/RESEARCH_LOG.md): every evaluation in order, so the amount of testing is visible
- [VPS_QUICKSTART.md](docs/VPS_QUICKSTART.md): step-by-step VPS setup with the setup script and diagnostics
- [INSTALL_WINDOWS_VPS.md](docs/INSTALL_WINDOWS_VPS.md): installation and VPS deployment
- [DEMO_AND_LIVE.md](docs/DEMO_AND_LIVE.md): demo forward-test procedure and the explicit live-enable checklist
- [VERIFICATION.md](docs/VERIFICATION.md): what was and was not verified, and the exact remaining steps
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- [SERVICES_AND_COSTS.md](docs/SERVICES_AND_COSTS.md): external services, licences, subscriptions and costs

## Licence and data

The code in this folder is provided as-is for your own use. The validation data
(Oanda candles mirrored by FutureSharks/financial-data) is **not** redistributed here; the fetch
script downloads it from the public mirror. Check the data provider's terms before using it.
This is not investment advice.
