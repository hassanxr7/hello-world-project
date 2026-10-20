# Validation results (measured)

Full generated report: [`reports/validation/20261020T185546Z/REPORT.md`](../reports/validation/20261020T185546Z/REPORT.md)
(also `summary.json`, per-trade CSVs and equity SVGs in the same folder). Every number below
comes from that run. It is a **historical simulation**, not live or demo trading, and it does
not predict future results.

## Setup

- **Data:** Oanda 1-minute mid prices (public mirror `github.com/FutureSharks/financial-data`),
  EURUSD, GBPUSD, USDCAD, AUDUSD, 2015-01-01 to 2020-05-14. USDJPY, USDCHF and NZDUSD were not
  available in the build environment and are untested.
- **Account:** 10,000 USD; default limits (0.25 %/trade, 1 % total, 3 positions, 1 per symbol,
  2 % daily loss, 20 entries/day, 0.5 % per currency, correlation and cooldown rules). The
  identical `RiskEngine` code that runs live.
- **Costs (assumptions, mid data has no bid/ask):** spread EURUSD 0.5, GBPUSD 0.9, AUDUSD 0.6,
  USDCAD 0.9 pips × hour-of-day multipliers (×3 at rollover, ×1.2–1.5 in Asian hours);
  commission 7 USD per lot round turn; slippage 0.1 pip on entries and 0.3 pip on stop/forced
  exits; swap −0.3 pip per night for both sides, triple on Wednesdays.
- **Fills:** entries at the next M1 open after the signal bar closes. Stops are checked on the
  closing side; gaps fill at the open; **if one M1 bar touches both stop and target, the stop is
  assumed first** (this happened 0 times for H1/H4 and once for M15/H1); break-even and trailing
  take effect from the next bar.
- **Protocol:** pre-declared (see [RESEARCH_LOG.md](RESEARCH_LOG.md)). Development 2015–2017 for
  selection, holdout 2018 to 2020-05 evaluated once, and parameters not tuned.

## Default variant: H1 entries / H4 trend

| Run | Trades | Net return | Max drawdown | Profit factor | Win rate | Expectancy | Costs |
|---|---|---|---|---|---|---|---|
| Development 2015–2017 | 311 | −13.7 % | 15.4 % | 0.64 | 32.8 % | −0.199 R (−4.40 USD) | 539 USD |
| **Holdout 2018 to 2020-05** | 227 | **−5.5 %** | 7.8 % | 0.80 | 33.5 % | −0.102 R (−2.42 USD) | 529 USD |
| Full period | 538 | −18.6 % (CAGR −3.8 %) | 21.0 % | 0.70 | 33.1 % | −0.158 R | 993 USD |
| Full period, **zero costs** | 547 | −5.7 % | 10.0 % | 0.91 | 48.6 % | −0.046 R | 0 |

- Exposure (time with ≥ 1 open position): 11.1 %. At most 4 entries in one day; the daily
  20-entry cap was never approached and no daily-loss halt triggered.
- Losing periods: 47 of 64 months negative; yearly net 2015 −311, 2016 −415, 2017 −642,
  2018 −172, 2019 −415, 2020 (to May) +99 USD; worst month −224 USD; longest losing streak 17.
- By symbol (full period): GBPUSD +22 USD (+0.01 R), EURUSD −410, USDCAD −622, AUDUSD −845.
  One slightly positive symbol out of four is consistent with noise, not an edge.
- Exits: 276 stop, 114 break-even, 104 target, 28 time, 10 stop-through-gap, 6 break-even-
  through-gap.
- Risk-engine rejections: one-per-symbol 129, currency exposure 36, loss-streak pause 17,
  loss cooldown 3, max positions 1.

![V2 equity](../reports/validation/20261020T185546Z/equity_V2_H1_H4_full.svg)

**Cost sensitivity (full period):** spread ×1.5 −19.1 %, spread ×2 −19.6 %, slippage ×2 −19.1 %,
commission ×1.5 −20.1 %, swap ×2 −19.0 %. The win rate falls sharply (33 % → 23 %) under higher
slippage or commission because break-even exits (+1 pip) turn into small net losses. This is why
the break-even offset should exceed round-trip costs.

**Parameter sensitivity (information only, not used to choose anything):** TP 1.5R −18.9 %,
TP 3R −17.6 %, break-even off −17.3 %, trailing on −17.7 %, ADX ≥ 25 −16.4 %, room filter off
−21.7 % (PF 0.82, twice the trades). No nearby setting is profitable, so the negative result is
not a knife-edge artefact of the chosen parameters.

## Second variant: M15 entries / H1 trend

| Run | Trades | Net return | Max drawdown | Profit factor | Expectancy |
|---|---|---|---|---|---|
| Development | 1,030 | −40.0 % | 40.9 % | 0.63 | −0.207 R |
| Holdout | 825 | −37.4 % | 38.4 % | 0.58 | −0.233 R |
| Full period | 1,855 | −61.8 % | 62.5 % | 0.61 | −0.219 R |
| Full, zero costs | 1,932 | −23.8 % | 29.6 % | 0.87 | −0.056 R |

Costs here are 41 % of gross profit: with ~10–25-pip stops, a ~1.5-pip round-trip cost is a large
fraction of 1R.

## ML meta-filter (walk-forward, out-of-sample)

| Variant | OOS rows | AUC | Brier skill | Calibrated | Portfolio OOS baseline → filtered | Approvable |
|---|---|---|---|---|---|---|
| H1/H4 | 513 | 0.48 | −0.042 | no (error 0.17) | −14.2 % → −8.4 % (expectancy −0.160 → −0.173 R) | **no** |
| M15/H1 | 2,206 | 0.57 | +0.006 | yes (error 0.09) | −51.6 % → −26.4 % (expectancy −0.225 → −0.174 R) | **no** |

The filtered portfolios lose less mainly because they trade about half as much. Per-trade
expectancy stays negative, so neither model may be approved.

## Conclusion

The infrastructure works and the result is measured honestly: **the baseline strategy does not
have an edge on this data, with or without the ML filter.** Do not trade it with real money.
Use the system to develop and validate your own hypotheses on your broker's data
(`mql4/Scripts/FXAI_ExportHistory.mq4` → `python -m fxai validate --data-format mt4`), then
forward-test on demo as described in [DEMO_AND_LIVE.md](DEMO_AND_LIVE.md).

## Reproduce

```bash
bash scripts/fetch_oanda_data.sh /path/to/data       # sparse checkout of the public dataset
python -m fxai validate --data-root /path/to/data/pyfinancialdata/data/currencies/oanda
python -m pytest
```

The run takes about 3–5 minutes on 4 CPU cores. The results are deterministic for a given dataset
and code version.
