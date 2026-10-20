# Research plan v2 (pre-declared)

Written and committed **before** any of the candidate strategies below were run on any data.
Changes to this plan after results are seen must be recorded as such in `docs/RESEARCH_LOG.md`.

## Why a new plan

The v1 baseline (`trend_pullback`) loses on development, validation and the 2018–2020 holdout,
including at zero cost. The 2018–2020-05 period has now been inspected and can no longer serve
as untouched out-of-sample evidence. The audit (`docs/STRATEGY_AUDIT.md`) is used only to
understand the failure; it does not pick the next idea.

## Data

| Role | Period | Use |
|---|---|---|
| Development | 2007-01-01 to 2014-12-31 (2005–2006 for indicator warm-up only) | all exploration, the permutation test, yearly stability |
| Validation | 2015-01-01 to 2017-12-31 | evaluated **once** per surviving candidate, no changes afterwards |
| Known | 2018-01-01 to 2020-05-14 | reported for information only; it is not evidence |
| **Final holdout** | your broker's own history, 2020-06 onward (`FXAI_ExportHistory.mq4`, bid/ask where available) | evaluated once, with the acceptance criteria below, then demo forward test through the real EA |

Source: Oanda M1 mid prices, EURUSD, GBPUSD, USDCAD, AUDUSD (public mirror). Quality: ≈350–380k
minute bars per pair-year across 2005–2020 (no sparse years). Spreads are modelled
(`fxai/backtest/costs.py`); the same session multipliers apply to every period.

## Candidate ideas (fixed set, parameters fixed a priori, no tuning)

| # | Strategy | Hypothesis (why it might work) | Entry TF / context | Exit policy |
|---|---|---|---|---|
| S1 | `donchian_trend` | Multi-week currency momentum/time-series trend has the best documented record of any FX anomaly; the v1 baseline traded a horizon (hours) where FX is closest to a random walk. | H4 close beyond the 55-bar Donchian channel (≈9 trading days), D1 context only for reporting | initial stop 2×ATR(14,H4); trailing 3×ATR(14,H4) from entry; no fixed target (20R cap); max hold 30 days; no break-even |
| S2 | `range_reversion` | Short-horizon FX returns show negative autocorrelation in non-trending conditions; fading a 2σ extension in a RANGE regime targets that. | H1 close outside Bollinger(20, 2σ) with RSI(14) < 30 / > 70 while the H4 regime is RANGE (ADX < 20) | stop 1.5×ATR(14,H1) beyond the extreme; target = Bollinger middle at signal time (≥ 0.8R required); max hold 24 h; no BE |
| S3 | `london_breakout` | The London open releases the overnight (Asian) range; the direction of the first decisive break has a documented, if small, continuation tendency. | M15 close beyond the 00:00–07:00 UTC range between 07:00 and 10:00 UTC; one trade per symbol per day; range must be 0.5–2 × ATR(14,H1) | stop = opposite side of the range (capped 2.5×ATR(H1)), target 1× range height; forced exit 16:00 UTC; no BE |
| S4 | `pullback_rejection` | Same regime as v1, but entering **at** the pullback on a rejection candle instead of after the resumption breakout; tests whether v1 loses because it buys extension. | H1 bar touching the EMA20 ± 0.25 ATR zone in a TREND regime, closing back in the trend direction with wick ≥ 50 % of range, body in the trend-side half | stop beyond the rejection bar ± 0.2 ATR (min 1 ATR, max 2.5 ATR); target 2R; BE at 1R with +25 pts (above cost); max hold 48 h |
| S5 | `vol_breakout` | Volatility compression precedes expansion; an H4 inside bar/NR4 followed by a break in the direction of the daily trend captures the expansion. | H4 close beyond an inside-bar or NR4 mother range, in the direction of D1 EMA50 vs EMA200 | stop = other side of the mother range (max 2.5×ATR(H4)); target 2R; max hold 72 h; no BE |

Plus a sanity variant of the baseline (`trend_pullback` with BE offset 25 points, fixing a cost
artefact found in the audit); it is reported but not a new idea. **K = 6 candidates** for the
multiple-testing correction.

## Stage 1 gates (development period, per candidate)

A candidate survives only if **all** hold on 2007–2014 with default costs:

1. per-signal expectancy (net R, isolated simulation) > 0 and portfolio profit factor ≥ 1.10;
2. ≥ 150 portfolio trades;
3. random-entry permutation test (same symbol / hour / regime / side / stop size / exits,
   ≥ 200 permutations): p < 0.05 / 6 ≈ 0.0083 (Bonferroni over the declared set);
4. positive net in at least 5 of the 8 development years and no year worse than −8 %;
5. still positive with spread × 1.5 and slippage × 2 (adverse-cost scenario);
6. max drawdown < 15 % at the default 0.25 % risk.

Failing candidates are reported in full (including the numbers) and not revisited with new
parameters. **No parameter is changed in response to development results.**

## Stage 2 (validation 2015–2017, once)

Survivors run once. Pass: expectancy > 0, PF ≥ 1.05, drawdown < 15 %, permutation p < 0.05.
The 2018–2020 period is then reported as "known" context.

## Stage 3 (final holdout = broker data, once) and acceptance for demo trading

Acceptance criteria, fixed now: on broker data from 2020-06 onward (≥ 3 years, ≥ 100 trades),
expectancy > 0, PF ≥ 1.10, max DD < 12 %, positive in ≥ 60 % of calendar quarters, adverse-cost
scenario positive. Then a demo forward test through the real MT4 EA of at least 8 weeks and
≥ 40 trades with expectancy within one standard error of the backtest. Only then may
`validation_status.json` record `passed: true`.

## What success would and would not mean

Passing all three stages establishes that an edge existed historically after realistic costs and
survived two unseen periods. It does not guarantee future results. The profit target
($15–$230/day) is **not** a criterion anywhere in this plan; see the scenario analysis
(`python -m fxai scenario`) for what any target implies for capital at a given validated
expectancy.

## Bookkeeping

- Every run writes `reports/experiments/<id>/` (config, numbers, trades) and a row in
  `reports/experiments/INDEX.md`; failures included.
- `docs/RESEARCH_LOG.md` records the narrative in order.
- The number of distinct evaluations performed on each period is reported in the final write-up.
