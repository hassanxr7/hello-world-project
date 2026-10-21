# Strategies, market analysis and decision flow

## Status of every strategy (read first)

| Strategy | Hypothesis | Entry / context TF | Development 2007–2014 (plan v2) | Status |
|---|---|---|---|---|
| `trend_pullback` 1.0.0 (baseline, default) | Pullback then resumption in a trend regime | H1 / H4 | −0.057 R, PF 0.88 (BE +25 variant) | **No edge**; also lost in 2015–2020 (entries 3–5) |
| `donchian_trend` 1.0.0 | Multi-week time-series momentum | H4 / D1 | −0.037 R, PF 0.94 | Failed all quality gates |
| `range_reversion` 1.0.0 | Fade 2σ extensions in non-trending markets | H1 / H4 | −0.085 R, worse than random (z −3.1) | Failed |
| `london_breakout` 1.0.0 | Continuation after the break of the Asian range | M15 / H1 | −0.089 R, worse than random (z −2.3) | Failed |
| `pullback_rejection` 1.0.0 | Enter at the pullback on a rejection candle | H1 / H4 | −0.093 R | Failed |
| `vol_breakout` 1.0.0 | Expansion after an inside bar / NR4 compression | H4 / D1 | −0.060 R | Failed |

Every candidate is negative **before** costs, and none beats random entries with the same exits.
Details are in [RESEARCH_LOG.md](RESEARCH_LOG.md) entry 7 and `reports/experiments/`. They are
kept so that results stay reproducible and so the system has something to run on demo. None
may trade real money.

### Framework

- Each strategy is a `StrategyBase` subclass (`fxai/strategy/`). Its `compute()` returns a
  causal frame using **completed bars only**, checked by a truncated-history test for every
  strategy. The frame holds the signal, stop, optional fixed target and forced-exit time,
  per-rule flags, watchlist candidates and invalidation levels.
- It carries its own default timeframes, parameters and **exit policy**. The exit policy is
  sent with each order, and the EA applies it per ticket ([PROTOCOL.md](PROTOCOL.md)), so the
  live exits are the backtested exits.
- `decide_latest()` gives BUY / SELL / WAIT with a reason per rule, plus the invalidation
  conditions that would void the trade. `setups()` gives watchlist entries with stage,
  trigger, invalidation and expiry.
- Choose the running strategy with `strategy.name` in the config. Version bumps are required
  for any rule change, and everything stored is keyed by `name-version`.

### Market analysis and opportunity handling (implemented for every strategy)

| Component | What it does | Authority |
|---|---|---|
| Opportunity scan (`fxai/analysis/scanner.py`), at least once per minute | Per pair: trend-timeframe regime and ADX; multi-timeframe alignment (entry EMA20 slope, trend regime, D1 EMA50/200); RSI and 24-bar move; ATR percentile and volatility ratio; nearest confirmed support and resistance; candlestick picture; 20-bar breakout location; spread vs limit and vs ATR; session; own execution quality; currency exposure and correlation with open positions; events only from a configured calendar | Advisory. It ranks pairs by an **unvalidated** attention score with written reasons and never opens a trade |
| Candlesticks in context (`fxai/analysis/candles.py`) | Doji, pin bars, engulfing, inside and outside bars, momentum candles, morning and evening stars. Each is read with trend, location at support or resistance, and range position | Context only |
| Watchlist (`fxai/execution/watchlist.py`, SQLite `watchlist`) | Setups with created / expires / trigger / invalidation / conditions / evidence. Each scan re-evaluates them: triggered, expired (not re-confirmed in time), or invalidated (price through the level, conditions gone, strategy changed) | Never executes. Only a fresh completed-bar signal younger than `signal_ttl_s` reaches the risk engine |
| Signal ranking (`TradingService.rank_candidates`) | Signals on the same step are ordered by attention score, then spread cost per R | Decides only which signal the limits see first |

Zero trades on a day is a normal outcome, and the 20-entry ceiling is a limit, not a target.

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

1. Subclass `StrategyBase` (see `donchian_trend.py` for a compact example) and register it in
   `fxai/strategy/registry.py`. The contract, causality, explanation and setup tests in
   `tests/test_strategies.py` then run on it automatically.
2. Bump its version. Decisions, signals, models and reports are keyed by strategy version.
3. Write the hypothesis, the fixed parameters and the gates in a new research plan, and commit
   it **before** running anything. Count every idea ever tested in the multiple-testing
   correction: plan v2 already used K = 6.
4. Run it on the development stage with `python -m fxai experiment`. That requires adding it to
   the plan list in `fxai/research/experiments.py`, which is the commit that records the
   decision. Later stages run only for survivors.
5. Final holdout on your broker's unseen data, then a demo forward test
   ([DEMO_AND_LIVE.md](DEMO_AND_LIVE.md)).
