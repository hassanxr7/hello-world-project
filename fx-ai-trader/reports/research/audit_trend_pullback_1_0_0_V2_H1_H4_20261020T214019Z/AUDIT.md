# Strategy audit: trend_pullback-1.0.0 V2 H1/H4

Period 2015-01-01 to 2018-01-01, symbols AUDUSD, EURUSD, GBPUSD, USDCAD. 423 signals, 329 portfolio trades (default risk limits).

## 1. Do the entries carry information? (random-entry permutation test)

- Real signals: mean net R per signal **-0.230** (gross -0.194).
- Random entries, same symbol / hour / regime / side / stop size / exits: mean net R -0.042 ± 0.057 over 100 permutations.
- z = -3.31, p-value (real ≥ random) = **1.000**. Hour-only matching (no regime): null -0.081, p = 1.000.

Reading: a p-value near 0.5 means the entry rules select bars no better than random bars at the same time of day in the same regime; the loss then comes from costs plus the exit structure, which random entries share.

## 2. Forward returns after signals (side-signed, ATR units)

| symbol | horizon_bars | n | signal_mean_atr | signal_t | regime_bars_mean_atr | hit_rate |
|---|---|---|---|---|---|---|
| AUDUSD | 1 | 151 | 0.0175 | 0.2788 | 0.0066 | 0.4768 |
| AUDUSD | 2 | 151 | -0.0847 | -1.005 | 0.0118 | 0.457 |
| AUDUSD | 4 | 151 | -0.0952 | -0.8177 | 0.0269 | 0.4636 |
| AUDUSD | 8 | 151 | -0.2775 | -1.631 | 0.0535 | 0.4172 |
| AUDUSD | 24 | 151 | -0.1237 | -0.4655 | 0.1268 | 0.4702 |
| EURUSD | 1 | 79 | -0.0807 | -0.7682 | 0.0028 | 0.4177 |
| EURUSD | 2 | 79 | -0.2527 | -2.047 | 0.0058 | 0.3418 |
| EURUSD | 4 | 79 | -0.3343 | -1.358 | 0.0148 | 0.3797 |
| EURUSD | 8 | 79 | -0.1154 | -0.3101 | 0.0383 | 0.4304 |
| EURUSD | 24 | 79 | -0.3298 | -0.6838 | 0.1432 | 0.3797 |
| GBPUSD | 1 | 80 | 0.0839 | 0.8359 | 0.0013 | 0.4875 |
| GBPUSD | 2 | 80 | -0.1032 | -0.6714 | 0.0034 | 0.4625 |
| GBPUSD | 4 | 80 | -0.1462 | -0.7354 | -0.001 | 0.4625 |
| GBPUSD | 8 | 80 | -0.3332 | -1.202 | -0.0255 | 0.475 |
| GBPUSD | 24 | 80 | -0.3797 | -1.014 | -0.0408 | 0.475 |
| USDCAD | 1 | 113 | -0.2843 | -3.112 | 0.0119 | 0.4071 |
| USDCAD | 2 | 113 | -0.2624 | -2.044 | 0.0229 | 0.4513 |
| USDCAD | 4 | 113 | -0.522 | -2.765 | 0.0493 | 0.4159 |
| USDCAD | 8 | 113 | -0.853 | -2.607 | 0.0914 | 0.4336 |
| USDCAD | 24 | 113 | -0.5727 | -1.361 | 0.1717 | 0.4779 |

`regime_bars_mean_atr` is the same statistic for *every* bar in the same trend regime (signed by trend direction): it shows how much of any drift is just the regime, not the entry.

## 3. Where the money goes (portfolio run)

Net -1647.71 USD over 329 trades, PF 0.591, expectancy -0.225 R, costs 551.69 USD (23.2 % of gross profit).

By exit reason:

| reason | trades | net | mean_r | share_of_trades_pct |
|---|---|---|---|---|
| sl | 179 | -3890 | -1 | 54.4 |
| sl_gap | 5 | -109.7 | -1.002 | 1.5 |
| breakeven | 73 | -10.21 | -0.006 | 22.2 |
| breakeven_gap | 2 | -1.53 | -0.035 | 0.6 |
| time | 13 | 71.55 | 0.264 | 4 |
| tp | 57 | 2292 | 1.877 | 17.3 |

Give-back:

```
{
 "pct_reaching_1R": 42.2,
 "pct_reaching_2R": 17.3,
 "pct_of_1R_reachers_ending_le_0": 25.2,
 "mean_mae_winners": 0.4,
 "mean_mae_losers": 1.039,
 "mean_mfe_losers": 0.487
}
```

By session:

| session | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| asia 0-6 | 45 | -266 | -0.254 | 35.6 |
| london 7-11 | 163 | -1033 | -0.291 | 33.1 |
| overlap 12-16 | 83 | -352.2 | -0.182 | 30.1 |
| ny late 17-23 | 38 | 3.3 | -0.004 | 28.9 |

By symbol:

| symbol | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| AUDUSD | 104 | -678.9 | -0.288 | 34.6 |
| EURUSD | 64 | -441.9 | -0.321 | 28.1 |
| GBPUSD | 72 | -60.14 | -0.037 | 50 |
| USDCAD | 89 | -466.8 | -0.234 | 18 |

By year:

| year | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| 2015 | 109 | -594.2 | -0.23 | 33 |
| 2016 | 105 | -413.4 | -0.178 | 33.3 |
| 2017 | 115 | -640.2 | -0.263 | 30.4 |

By adx_bucket:

| adx_bucket | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| 20-25 | 60 | -402.7 | -0.309 | 26.7 |
| 25-30 | 59 | -452.8 | -0.356 | 28.8 |
| 30-40 | 114 | -539.9 | -0.208 | 36 |
| 40+ | 96 | -252.3 | -0.113 | 33.3 |

By stop_bucket:

| stop_bucket | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| 1.0-1.25 ATR | 72 | -710.9 | -0.433 | 26.4 |
| 1.25-1.75 | 125 | -119 | -0.046 | 39.2 |
| 1.75-2.5 | 132 | -817.9 | -0.281 | 28.8 |

By room_bucket:

| room_bucket | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| 1-1.5R | 128 | -445.7 | -0.157 | 33.6 |
| 1.5-2.5R | 99 | -556.8 | -0.252 | 35.4 |
| 2.5R+ | 102 | -645.2 | -0.285 | 27.5 |

By side:

| side | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| BUY | 139 | -603.4 | -0.196 | 33.1 |
| SELL | 190 | -1044 | -0.246 | 31.6 |

By regime:

| regime | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| TREND_DOWN | 190 | -1044 | -0.246 | 31.6 |
| TREND_UP | 139 | -603.4 | -0.196 | 33.1 |

## 4. Exit-rule what-ifs on the same signals (per-signal, isolated; diagnostic only)

| variant | n | mean_r_net | mean_r_gross | win_pct | pf |
|---|---|---|---|---|---|
| as configured | 423 | -0.2297 | -0.1937 | 31.4 | 0.614 |
| BE offset 25 pts (> round-trip cost) | 423 | -0.23 | -0.1941 | 41.8 | 0.612 |
| BE off | 423 | -0.2369 | -0.1998 | 29.3 | 0.672 |
| time stop 24h | 423 | -0.2418 | -0.206 | 32.6 | 0.591 |
| TP 1R | 423 | -0.1945 | -0.1595 | 41.8 | 0.672 |
| TP 3R, BE off | 423 | -0.1852 | -0.147 | 27 | 0.752 |

These are NOT a parameter search for deployment: they show whether the loss is an exit artefact. If every variant stays negative, the entries themselves have no edge.
