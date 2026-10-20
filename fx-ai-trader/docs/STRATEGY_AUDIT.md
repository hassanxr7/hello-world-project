# Why the baseline loses (strategy audit)

Audit of `trend_pullback-1.0.0` in both pre-declared variants, V1 (M15 entries / H1 trend) and
V2 (H1 entries / H4 trend, the default). Produced by `fxai.research.audit.run_audit`; the full
reports are in `reports/research/audit_trend_pullback_1_0_0_*/` (`AUDIT.md`, `audit.json`,
`per_signal.csv`).

**Data used:** 2015-01-01 to 2017-12-31, AUDUSD / EURUSD / GBPUSD / USDCAD, Oanda M1 mids with the
default cost model. This is the period v1 was developed on (research log entry 3), so the audit
adds no new exposure of unseen data. It is also the v2 *validation* period; see "Caveat" below.

The audit's purpose is to explain the failure, not to choose the next strategy. The v2 candidate
set was committed (`docs/RESEARCH_PLAN_v2.md`) before these audit numbers were produced.

## Findings

### 1. The H1/H4 entry trigger selects bad moments; it is worse than random

Random-entry permutation test: for each real signal, a random bar of the same symbol, hour of
day, trend regime and side is drawn, and the same stop size and exit rules are applied.

| Variant | Signals | Real mean net R | Random mean net R (± sd) | z | p (real ≥ random) |
|---|---|---|---|---|---|
| V1 M15/H1 | 1,678 | −0.201 | −0.179 ± 0.024 (40 perms) | −0.89 | 0.80 |
| V2 H1/H4 | 423 | −0.230 | −0.042 ± 0.057 (100 perms) | −3.31 | 1.00 |

- **V2:** random entries in the same regime lose about the transaction cost (−0.04 R). The real
  entries lose a further ≈ 0.19 R per trade. The trigger, a close back above the EMA20 and above
  the previous bar's high after a pullback, systematically enters just before short-term
  reversals.
- **V1:** the M15 entries are indistinguishable from random. At that horizon the loss is the
  cost-plus-exit structure that every random entry also pays (stops are ~8–25 pips, so a
  ~1.5 pip round trip is a large share of 1 R).

### 2. Forward returns confirm it

Side-signed returns after V2 signals are negative at most horizons, for example USDCAD
−0.52 ATR after 4 bars (t = −2.8) and −0.85 ATR after 8 bars (t = −2.6). Over the same period,
*all* bars in the same trend regime drift slightly with the trend (USDCAD +0.05 ATR after 4 bars,
+0.17 after 24). The regime filter is not the problem; the entry timing inside the regime is.

This is consistent with short-horizon negative autocorrelation in FX: a breakout of the previous
bar after a pullback is a short-term extension, and extensions tend to retrace. Candidates S2
(fading extensions in ranges) and S4 (entering *at* the pullback on a rejection candle) were
declared to test exactly this hypothesis in a fresh period.

### 3. Costs make it worse but are not the root cause

| Variant | Gross R / signal | Net R / signal | Costs as % of gross profit |
|---|---|---|---|
| V1 M15/H1 | −0.139 | −0.201 | 36 % |
| V2 H1/H4 | −0.194 | −0.230 | 23 % |

Both are negative before costs. The 2018–2020 zero-cost run (research log entry 5) showed the
same thing.

### 4. The exit rules are not the cause

On the same signals, simulated in isolation:

| Exit variant | V1 net R | V2 net R |
|---|---|---|
| as configured (TP 2R, BE 1R +10 pts, 48 h) | −0.201 | −0.230 |
| BE offset 25 pts | −0.194 | −0.230 |
| BE off | −0.205 | −0.237 |
| 24 h time stop | −0.200 | −0.242 |
| TP 1R | −0.188 | −0.195 |
| TP 3R, BE off | −0.195 | −0.185 |

No exit variant comes close to break-even. Choosing the "best" one would be a parameter search
on a known period and is not done.

The break-even exits close at about −0.01 R on average, because a +10-point offset is less
than commission plus slippage. They are 21–22 % of trades, so they inflate the win rate in a
zero-cost view without changing expectancy. The plan keeps a "BE offset 25" sanity variant to
report this artefact, not as a new idea.

### 5. The loss is broad, not a bad patch

Every year (2015, 2016, 2017), symbol, side, ADX bucket and stop-size bucket is negative in
both variants. The few near-flat cells (V2 GBPUSD −0.04 R, V2 NY-late session −0.00 R over
38 trades) are what chance produces when cutting 329 trades into ~30 cells. Restricting to
them would be data mining, so they are not used.

### 6. Hit rates and give-back

- 42–43 % of signals reach +1 R and 17–19 % reach +2 R.
- About a quarter of the trades that reach +1 R end at or below zero.
- Losers reach a mean favourable excursion of only ≈ 0.48 R before being stopped.

This is what a trigger with no directional information looks like under a 2R target.

## Conclusions

1. The baseline's loss is an **entry-timing** problem on H1, and a **cost-plus-noise** problem
   on M15. It is not a simulation bug: the fill simulator has hand-built path tests and a
   differential test against a vectorised implementation.
2. No change of exits, filters or sub-segments of the known data rescues it. The baseline stays
   in the repository as a reference and as the default configuration only because the system
   must have *a* strategy to run on demo. It has no demonstrated edge.
3. The next step is the bounded comparison in `docs/RESEARCH_PLAN_v2.md`. It covers six
   pre-declared candidates with fixed parameters, a 2007–2014 development period none of them
   has seen, a permutation test with a Bonferroni correction (K = 6), and a single validation
   pass.

## Caveat on the v2 validation period

The 2015–2017 period was used for v1 development and for this audit. None of the v2 candidates
has been run on it, but the choice of candidates was made by someone who knew v1 lost there.
A stage-2 pass on 2015–2017 is therefore weaker evidence than a pass on untouched data. That is
why the plan makes the **broker's own 2020-06+ history** the decisive final holdout, followed by
a demo forward test through the real EA.
