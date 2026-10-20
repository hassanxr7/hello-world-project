# Baseline strategy: `trend_pullback` 1.0.0

A deliberately small, explainable rule set. Its parameters were fixed a priori from common
practice and were **not tuned** on the evaluation data. It is a baseline to measure everything
else against, **not** a strategy shown to be profitable (see [VALIDATION.md](VALIDATION.md)).

Timeframes are configurable: H1 entries / H4 trend (default, chosen by the pre-declared
protocol as the less-bad variant) or M15 entries / H1 trend. All rules use **completed** bars
only.

## 1. Market regime (trend timeframe)

| Regime | Rule | Action |
|---|---|---|
| VOLATILE | ATR(14) / median ATR(14) over 500 bars > 2.0 | WAIT |
| TREND_UP | ADX(14) ≥ 20 and EMA50 > EMA200 and close > EMA50 and EMA50 rising over 5 bars | look for longs |
| TREND_DOWN | mirror image | look for shorts |
| RANGE | anything else | WAIT |
| UNKNOWN | indicators not warmed up | WAIT |

## 2. Entry (entry timeframe), long side; short is the mirror image

| Condition | Rule |
|---|---|
| Pullback | within the last 6 bars, some low ≤ EMA20 + 0.25 × ATR |
| Resumption | close > EMA20, bullish candle, close > previous bar's high |
| Momentum | 50 ≤ RSI(14) ≤ 70 |
| Not extended | (close − EMA20) / ATR ≤ 1.0 |
| Stop | below the 6-bar low − 0.2 × ATR; widened to at least 1.0 × ATR; WAIT if wider than 2.5 × ATR |
| Room | nearest confirmed swing resistance (fractal 3/3, last 200 trend-TF bars) at least 1R away |
| Session | bar close inside the symbol's UTC window (EUR/GBP/CAD/CHF 07–20, JPY/AUD/NZD 00–20); no Friday entries after 18:00 UTC; never at weekends |

Target: 2R from the actual entry price. Exits: break-even at 1R (+10 points), optional
trailing, 48 h maximum holding time (all run by the EA).

## 3. Market-quality filters (risk engine)

Spread vs. per-symbol maximum, spread ≤ 15 % of the stop distance, quote age ≤ 30 s, price
drift since the signal ≤ 20 points, and a news blackout (±30 min around high-impact events for
either currency) **only if** a calendar feed is configured. Without a feed the dashboard
states that the news filter is inactive.

## 4. Explanations

Every evaluated bar produces one stored decision with its reasons. A real one, recorded in a
paper session on 2019 data:

```
USDCAD  WAIT  TREND_UP  bar close 2019-09-22 23:00 UTC
  trend-TF regime TREND_UP (ADX 27.0, EMA50 > EMA200, slope +0.16 ATR, vol ratio 0.94)
  session window: FAIL
  pullback to EMA20 zone within 6 bars: pass
  long resumption candle (close beyond EMA and prior bar extreme): pass
  RSI 50.9 in long band: pass
  extension 0.15 ATR <= 1.0: pass
  stop 1.54 ATR <= 2.5: pass
  WAIT: at least one entry condition failed
```

Approved trades add the ML/LLM notes (if enabled) and the risk engine's size and planned risk.
Rejected candidates list every failed risk check.

## 5. Why it is kept small

Adding indicators without evidence of added value increases the chance of fitting noise. The
validation report includes a zero-cost run (−0.05R per trade for the default variant), which
shows that these rules have **no gross edge** on 2015–2020 data for the four tested pairs.
Treat this as a framework for testing your own hypotheses with the same pipeline, not as a
finished strategy.

## Adding or changing a strategy

1. Implement a class with `compute(entry_bars, trend_bars, session_window)` returning a frame
   with `signal`, `sl` and feature columns, plus `decide_latest(...)` (see `trend_pullback.py`).
2. Bump its version. Decisions, signals, models and reports are keyed by strategy version.
3. Write down the hypothesis, the variants and the selection rule in `docs/RESEARCH_LOG.md`
   **before** running anything.
4. Run `python -m fxai validate` on development data; evaluate the holdout once.
5. Demo forward test (see [DEMO_AND_LIVE.md](DEMO_AND_LIVE.md)).
