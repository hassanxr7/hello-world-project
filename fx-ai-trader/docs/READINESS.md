# Readiness assessment (2026-10-21)

## Verdict

| Use | Ready? | Why |
|---|---|---|
| **Live trading with real money** | **No** | No strategy has an edge. The baseline and all five plan-v2 candidates lose before costs and fail every quality gate. The EA has not been compiled or run in MT4. Live mode stays disabled: it needs a passed validation record for the exact strategy version, and none exists |
| **Demo integration test** (MT4 + broker + EA + Python) | Yes, once the EA compiles on your VPS | It tests the plumbing: fills, protection, restarts, reconciliation, per-order exits, costs. It does **not** test an edge, and the strategies are expected to lose on demo too |
| **Research on new ideas** | Yes | The tooling exists: audit, permutation test, pre-declared experiment runner, gates, reproducible records. Unseen data is limited (see below) |
| **Daily profit target of 15–230 (aspirational)** | No evidence supports it | Every measured expectancy is negative. At any capital the evidence-based expected daily result is a loss. `python -m fxai scenario` shows what a target would need if an edge existed |

## Component status

| Area | Implemented | Tested here | Verified in MT4 / with a broker |
|---|---|---|---|
| Risk engine (sizing, per-trade / total / currency / correlation limits, daily loss, spread, stale data, cooldowns, e-stop) | Yes | Yes (unit + integration) | No |
| EA hard gate, broker-side SL, unprotected-position repair, daily-loss halt, e-stop flag | Yes | Through a Python emulator of the EA | **No (not compiled)** |
| Per-order exit policy (hold, break-even, fixed-distance trailing) | Yes, EA and emulator | Yes (emulator, static EA checks) | **No** |
| Idempotent execution, reconciliation, restarts | Yes | Yes (emulator) | No |
| Opportunity scan (≥ 1/min), candlesticks in context, attention ranking, watchlist lifecycle | Yes | Yes (synthetic markets, paper replay) | No |
| Dashboard (actual / simulated / forecast / scenario, controls, exports) | Yes | Yes (API tests, real-browser screenshots, mobile width) | No |
| Forecasts | Yes, evidence-gated | Yes | Correctly shows "Insufficient evidence for a reliable estimate." |
| ML meta-filter | Yes | Walk-forward run | Not approvable (failed gates); disabled |
| Claude review | Yes, veto only | Fake client only | No live call made; off |
| Economic calendar | CSV loader | Yes | No feed configured |
| Strategies | 6 | All causal; all evaluated | **None validated** |

## How much of the data is still unseen

| Period | Status |
|---|---|
| 2007–2014 | Used once by the six plan-v2 candidates |
| 2015–2017 | Used for v1 development, the ML walk-forward and the baseline audit |
| 2018 to 2020-05 | Used as the v1 holdout |
| **2020-06 onwards** | **Unseen by this project.** Your broker's history, or Dukascopy/TrueFX data, for this period is the only clean test left. Spend it once, on a final pre-registered test |

## What would have to happen before real money

1. A **new, pre-registered research plan** (v3) with ideas justified independently of the
   results so far. The multiple-testing count must include the 6 already tried. It is reasonable
   to also conclude that systematic retail FX trading on these pairs and horizons has no
   accessible edge, and not to trade.
2. A candidate passes development **and** a single final test on unseen post-2020 data, with
   costs from your broker. Win rate alone never decides.
3. The EA compiles. The checks in [VERIFICATION.md](VERIFICATION.md) and stage 0–1 of
   [DEMO_AND_LIVE.md](DEMO_AND_LIVE.md) pass on demo.
4. A demo forward test of that exact strategy version (≥ 8 weeks, ≥ 40 trades) is consistent
   with its backtest.
5. You write `reports/validation_status.json` for that version and make the explicit live
   switches. Every limit stays enforced, and losses can still exceed planned stops through gaps
   and slippage.

## What I need from you

- **Starting capital and account currency** (also the broker's commission per lot and the
  account leverage). They turn the scenario analysis into figures for your account:
  `python -m fxai scenario --capital <amount> --currency <code> --leverage <n>`.
- From the VPS: the output of `python -m fxai doctor`, the MetaEditor compile result for
  `FXAI_Bridge.mq4` (0 errors expected; send any error lines), and the last line of
  `python -m pytest`.
- Optionally, an export of your broker's history (`FXAI_ExportHistory.mq4`), kept aside unused
  as the final holdout.
