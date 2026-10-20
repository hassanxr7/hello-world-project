# Research log

This log records every strategy evaluation that informed a design decision, in
the order it happened, so the amount of testing done on the data is visible
(multiple testing inflates apparent performance).

Data: Oanda M1 mid prices, EURUSD / GBPUSD / USDCAD / AUDUSD, 2015-01-01 to
2020-05-14 (public mirror: github.com/FutureSharks/financial-data). USDJPY,
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
