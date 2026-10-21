# Research log

This log records every strategy evaluation that informed a design decision, in
the order it happened, so the amount of testing done on the data is visible
(multiple testing inflates apparent performance).

Data: Oanda M1 mid prices, EURUSD / GBPUSD / USDCAD / AUDUSD (public mirror:
github.com/FutureSharks/financial-data). Entries 1-5 used 2015-01-01 to
2020-05-14; from entry 6 on, 2005-2014 is also used (research plan v2). USDJPY,
USDCHF and NZDUSD were not available in this environment.

## Entry 1 - exploratory full-period run of V1 (2026-10-20)

Before a protocol was written, the a-priori baseline **V1 (M15 entry / H1
trend)** was run once on the *full* 2015-2020 period with default costs and
default risk settings to check that the pipeline works end to end:

- 1,855 trades, net -61.8 %, profit factor 0.61, expectancy -0.22 R after costs,
  max drawdown 62.5 %; every year negative.
- Costs were 41 % of gross profit; stops are ~1-2.5 x M15 ATR (~8-25 pips) so a
  ~1.5-pip round-trip cost is a large fraction of 1 R.
- The fill simulator was then unit-tested on hand-built price paths
  (tests/test_backtest_fills.py) to rule out a simulation bug.

Because the full period has now been seen for V1, no V1 parameter is changed
on the basis of this result.

## Entry 2 - pre-declared protocol (written before running anything below)

- **Development period:** 2015-01-01 to 2017-12-31. **Holdout:** 2018-01-01 to
  2020-05-14. The holdout is evaluated once, after selection.
- **Variants (declared in advance, nothing else will be tried):**
  - V1: decision M15 / trend H1 (the original baseline).
  - V2: decision H1 / trend H4, every other rule and parameter identical. A-priori
    rationale: larger stops make fixed transaction costs a smaller share of 1 R.
- **Selection rule:** on the development period, choose the variant with the
  higher portfolio expectancy (R per trade), provided expectancy > 0 and profit
  factor > 1.05. If neither qualifies, record "no edge found" - the system stays
  demo-only and the default configuration is set to the less-bad variant.
- **ML filter:** evaluated only by chronological walk-forward on the selected
  variant's signals; it is compared with the unfiltered baseline on the same
  out-of-sample signals.
- Costs and risk settings are the defaults in `fxai/backtest/costs.py` and
  `config/config.example.yaml`; sensitivity to costs is reported, not optimised.

## Entry 3 - development-period comparison (2015-01-01 to 2017-12-31)

| Variant | Trades | Net % | Max DD % | PF | Win % | Expectancy (R) | Costs % of gross profit |
|---|---|---|---|---|---|---|---|
| V1 M15/H1 | 1,030 | -40.1 | 40.9 | 0.63 | 33.9 | -0.207 | 36.7 |
| V2 H1/H4 | 311 | -13.7 | 15.4 | 0.64 | 32.8 | -0.199 | 22.2 |

Both variants fail the selection rule (expectancy > 0 and PF > 1.05).
**Outcome: no edge found.** Per the protocol the default configuration is set
to the less-bad variant (V2, H1/H4) and the system remains demo-only. Lower
cost share did not rescue V2, so the entry rules themselves - not only costs -
lack a positive edge on this data. No parameters were tuned in response.

## Entry 4 - walk-forward ML meta-filter (expanding window, 6-month folds from 2016-07)

Purged (training trades must have exited >= 72 h before each fold), training-only
scaling/imputation, L2 logistic regression C=0.5, threshold = training base rate.
Both variants are reported (V2 as declared; V1 additionally because it has 4x
more samples - this is a second test and is labelled as such).

| Variant | OOS rows | AUC | Brier skill | Folds with skill > 0 | Max calib. error | Exp. R unfiltered | Exp. R filtered | Gates |
|---|---|---|---|---|---|---|---|---|
| V2 H1/H4 | 513 | 0.484 | -0.042 | 25 % | 0.171 | -0.146 | -0.185 | FAIL |
| V1 M15/H1 | 2,206 | 0.575 | +0.006 | 62.5 % | 0.086 | -0.230 | -0.188 | FAIL (filtered expectancy still < 0) |

**Outcome:** the meta-filter has no skill on V2 and a small, real but
insufficient skill on V1. It does not turn either variant into a positive-
expectancy system, so no model is approvable and `ml.enabled` stays false.

## Entry 5 - holdout evaluation (2018-01-01 to 2020-05-14), run once after selection

| Variant | Trades | Net % | Max DD % | PF | Expectancy (R) |
|---|---|---|---|---|---|
| V2 H1/H4 (default) | 227 | -5.5 | 7.8 | 0.80 | -0.102 |
| V1 M15/H1 | 825 | -37.4 | 38.4 | 0.58 | -0.233 |

Additional diagnostics from the same validation run (reports/validation/):
- With ALL costs set to zero, V2 still loses (-5.7 %, PF 0.91, -0.046 R): the
  rules have no gross edge on this data; costs make it worse but are not the
  root cause.
- Win rate is very sensitive to costs because break-even exits are +1 pip
  (10-point offset) and flip sign once commission + slippage exceed it; the
  expectancy moves much less. If you use break-even, set the offset above your
  round-trip cost.
- Intrabar stop/target ambiguity was negligible at M1 resolution (0-1 bars).
- No daily-loss halt triggered: with 0.25 %/trade and 1 % total risk, a 2 %
  daily loss needs gaps or several stop-outs plus new entries.

**Conclusion:** the system's machinery (data, risk, execution, protection,
validation) is in place, but no strategy in this repository has demonstrated an
edge. It must stay on demo / paper until a strategy passes this protocol on
data from the broker you will trade with.

## Entry 6 - audit of the baseline (2015-01-01 to 2017-12-31, already-seen data)

Research plan v2 (`docs/RESEARCH_PLAN_v2.md`) was committed first. The audit was then run on
the v1 development period to explain the loss. Full write-up: `docs/STRATEGY_AUDIT.md`.

| Variant | Signals | Real net R | Random-entry null (same symbol/hour/regime/side/stop/exits) | z | p |
|---|---|---|---|---|---|
| V1 M15/H1 | 1,678 | -0.201 | -0.179 +/- 0.024 | -0.89 | 0.80 |
| V2 H1/H4 | 423 | -0.230 | -0.042 +/- 0.057 | -3.31 | 1.00 |

- V2's entry trigger is significantly *worse* than random bars in the same regime. Random
  entries lose about the transaction cost; the trigger adds about -0.19 R by entering on
  short-term extensions that retrace.
- V1's M15 entries are indistinguishable from random; the loss is costs plus the exit structure.
- Both variants are negative before costs. No exit variant (BE offset, BE off, 24 h time stop,
  TP 1R, TP 3R) gets near zero. Every year, symbol, side and ADX bucket is negative.

**Outcome:** no change to the baseline. The candidate set in plan v2 is unchanged (it was
fixed before these numbers existed). Evaluations on 2015-2017 so far: v1 development (2
variants), ML walk-forward (2), this audit (2 variants, diagnostic).

## Entry 7 - research plan v2, stage 1 (development 2007-01-01 to 2014-12-31)

Run once per pre-declared candidate with `python -m fxai experiment --stage dev --n-perm 200`
from commit e3bac4d (clean tree; recorded in each `config.json`). Data: Oanda M1 mids,
AUDUSD / EURUSD / GBPUSD / USDCAD; 2005-11 to 2006 loaded for indicator warm-up only; nothing
after 2014 was loaded. Default costs; 0.25 % risk per trade and the default portfolio limits.

Before any candidate ran, preparing the runs found and fixed three tooling defects (commit
e3bac4d). London-breakout deadlines were being read in the wrong time unit. The per-signal and
random-entry simulations ignored fixed targets and deadlines. The gates crashed on missing
statistics. No result existed before these fixes.

| Candidate | Trades | Net % | PF | Exp. R (portfolio) | Max DD % | Per-signal net R | Per-signal gross R | Random-entry null R | p | Years + | Adverse-cost net |
|---|---|---|---|---|---|---|---|---|---|---|---|
| trend_pullback, BE +25 pts (sanity variant) | 828 | -11.3 | 0.88 | -0.057 | 16.7 | -0.068 | -0.038 | -0.058 | 0.60 | 2/8 | -1,470 |
| S1 donchian_trend (H4, trailing) | 947 | -6.7 | 0.94 | -0.037 | 17.8 | -0.054 | -0.026 | -0.021 | 0.90 | 2/8 | -847 |
| S2 range_reversion (H1) | 2,035 | -32.3 | 0.84 | -0.085 | 33.7 | -0.102 | -0.077 | -0.051 | 1.00 | 2/8 | -3,724 |
| S3 london_breakout (M15) | 2,725 | -42.3 | 0.80 | -0.089 | 43.1 | -0.097 | -0.072 | -0.059 | 0.99 | 1/8 | -4,910 |
| S4 pullback_rejection (H1) | 1,923 | -35.2 | 0.82 | -0.093 | 36.9 | -0.101 | -0.060 | -0.102 | 0.47 | 0/8 | -4,303 |
| S5 vol_breakout (H4) | 2,175 | -26.4 | 0.90 | -0.060 | 31.4 | -0.042 | -0.018 | -0.030 | 0.72 | 1/8 | -3,232 |

Gate thresholds: per-signal net R > 0, PF >= 1.10, >= 150 trades, p < 0.0083 (0.05 / 6),
>= 5 of 8 positive years with none below -8 %, positive under adverse costs, max DD < 15 %.

**Outcome: no candidate survives.** Each fails every gate except the trade count. Per the plan:

- no stage-2 (validation 2015-2017) or "known" (2018-2020) run was made for any candidate;
- no parameter was changed and no candidate will be re-run with new parameters;
- the default configuration stays `trend_pullback` (H1/H4). That is not a selection: nothing
  qualifies, and the system remains demo-only.

What the numbers say:

- **Every candidate is negative before costs** (per-signal gross R from -0.018 to -0.077).
  Costs are 9-21 % of gross profit; they deepen the losses but do not cause them.
- **None beats its random-entry null.** Two are significantly *worse* than random entries
  with the same exits:
  - range_reversion: z = -3.1. Fading 2-sigma extensions in ADX < 20 conditions lost more
    than random entries in the same regime and hours.
  - london_breakout: z = -2.3. The first break of the Asian range tended to reverse.
- The S4 hypothesis from the audit failed. Entering at the pullback rather than after the
  resumption does not help on 2007-2014 (p = 0.47; real equals random).
- The closest to zero are the slower trend and volatility rules (S1, S5, per-signal
  -0.04 to -0.05 R). S1 made +8.7 % in 2007 and +1.8 % in 2008, then lost in 5 of the next
  6 years. That fits the widely reported weakening of simple FX trend-following after 2008,
  but it is one sample and no evidence of an edge.

Evaluations so far on 2007-2014: 6, all in this entry. On 2015-2017: v1 development (2), ML
walk-forward (2), baseline audit (2, diagnostic). On 2018-2020-05: v1 holdout (2).
