# Strategy audit: trend_pullback-1.0.0 V1 M15/H1

Period 2015-01-01 to 2018-01-01, symbols AUDUSD, EURUSD, GBPUSD, USDCAD. 1678 signals, 1045 portfolio trades (default risk limits).

## 1. Do the entries carry information? (random-entry permutation test)

- Real signals: mean net R per signal **-0.201** (gross -0.139).
- Random entries, same symbol / hour / regime / side / stop size / exits: mean net R -0.179 ± 0.024 over 40 permutations.
- z = -0.89, p-value (real ≥ random) = **0.800**. Hour-only matching (no regime): null -0.165, p = 0.900.

Reading: a p-value near 0.5 means the entry rules select bars no better than random bars at the same time of day in the same regime; the loss then comes from costs plus the exit structure, which random entries share.

## 2. Forward returns after signals (side-signed, ATR units)

| symbol | horizon_bars | n | signal_mean_atr | signal_t | regime_bars_mean_atr | hit_rate |
|---|---|---|---|---|---|---|
| AUDUSD | 1 | 640 | -0.0706 | -2.3 | -0.0022 | 0.4484 |
| AUDUSD | 2 | 640 | -0.1179 | -2.978 | -0.004 | 0.4422 |
| AUDUSD | 4 | 640 | -0.1471 | -2.635 | -0.0105 | 0.4438 |
| AUDUSD | 8 | 640 | -0.1365 | -1.791 | -0.0253 | 0.4656 |
| AUDUSD | 24 | 639 | -0.0727 | -0.5667 | -0.0716 | 0.5008 |
| EURUSD | 1 | 345 | -0.0074 | -0.1804 | -0.0005 | 0.5072 |
| EURUSD | 2 | 345 | -0.0147 | -0.2811 | -0.0017 | 0.4928 |
| EURUSD | 4 | 345 | -0.0501 | -0.6985 | -0.0048 | 0.4812 |
| EURUSD | 8 | 345 | -0.0027 | -0.024 | -0.0076 | 0.487 |
| EURUSD | 24 | 345 | 0.3586 | 1.935 | -0.0133 | 0.513 |
| GBPUSD | 1 | 376 | 0.0262 | 0.7655 | 0.0022 | 0.492 |
| GBPUSD | 2 | 376 | -0.0558 | -1.304 | 0.0038 | 0.4601 |
| GBPUSD | 4 | 376 | 0.0023 | 0.0336 | 0.0067 | 0.4761 |
| GBPUSD | 8 | 376 | 0.0793 | 0.7509 | 0.0122 | 0.4654 |
| GBPUSD | 24 | 376 | 0.1484 | 0.756 | 0.0174 | 0.4814 |
| USDCAD | 1 | 317 | -0.0477 | -1.101 | 0.002 | 0.4574 |
| USDCAD | 2 | 317 | -0.1332 | -2.165 | 0.0046 | 0.4637 |
| USDCAD | 4 | 317 | -0.252 | -2.912 | 0.0111 | 0.4385 |
| USDCAD | 8 | 317 | 0.0234 | 0.1936 | 0.0272 | 0.4606 |
| USDCAD | 24 | 317 | 0.2547 | 0.9798 | 0.077 | 0.47 |

`regime_bars_mean_atr` is the same statistic for *every* bar in the same trend regime (signed by trend direction): it shows how much of any drift is just the regime, not the entry.

## 3. Where the money goes (portfolio run)

Net -4000.74 USD over 1045 trades, PF 0.635, expectancy -0.203 R, costs 2519.57 USD (36.2 % of gross profit).

By exit reason:

| reason | trades | net | mean_r | share_of_trades_pct |
|---|---|---|---|---|
| sl | 549 | -1.028e+04 | -0.997 | 52.5 |
| sl_gap | 28 | -510.6 | -1.022 | 2.7 |
| breakeven_gap | 19 | -48.16 | -0.161 | 1.8 |
| breakeven | 218 | -33.4 | -0.008 | 20.9 |
| time | 29 | 151.6 | 0.245 | 2.8 |
| tp | 202 | 6716 | 1.79 | 19.3 |

Give-back:

```
{
 "pct_reaching_1R": 43.3,
 "pct_reaching_2R": 19.4,
 "pct_of_1R_reachers_ending_le_0": 23.0,
 "mean_mae_winners": 0.473,
 "mean_mae_losers": 1.017,
 "mean_mfe_losers": 0.476
}
```

By session:

| session | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| asia 0-6 | 154 | -392.6 | -0.159 | 41.6 |
| london 7-11 | 309 | -407.4 | -0.063 | 43.7 |
| overlap 12-16 | 328 | -1409 | -0.239 | 30.2 |
| ny late 17-23 | 254 | -1792 | -0.355 | 22.4 |

By symbol:

| symbol | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| AUDUSD | 379 | -1475 | -0.217 | 35.9 |
| EURUSD | 214 | -745.9 | -0.165 | 41.1 |
| GBPUSD | 243 | -701.7 | -0.152 | 38.3 |
| USDCAD | 209 | -1079 | -0.276 | 18.2 |

By year:

| year | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| 2015 | 355 | -1929 | -0.249 | 32.1 |
| 2016 | 351 | -1016 | -0.164 | 35.9 |
| 2017 | 339 | -1055 | -0.196 | 33.9 |

By adx_bucket:

| adx_bucket | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| 20-25 | 190 | -752.7 | -0.216 | 33.7 |
| 25-30 | 223 | -892.7 | -0.221 | 32.3 |
| 30-40 | 308 | -1005 | -0.17 | 35.7 |
| 40+ | 324 | -1350 | -0.216 | 33.6 |

By stop_bucket:

| stop_bucket | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| 1.0-1.25 ATR | 242 | -1162 | -0.257 | 32.2 |
| 1.25-1.75 | 412 | -2320 | -0.295 | 32.3 |
| 1.75-2.5 | 391 | -518.2 | -0.074 | 36.8 |

By room_bucket:

| room_bucket | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| 1-1.5R | 306 | -704.9 | -0.133 | 35.6 |
| 1.5-2.5R | 277 | -1022 | -0.199 | 35.4 |
| 2.5R+ | 462 | -2273 | -0.252 | 32 |

By side:

| side | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| BUY | 502 | -1751 | -0.187 | 35.5 |
| SELL | 543 | -2250 | -0.218 | 32.6 |

By regime:

| regime | trades | net | mean_r | win_pct |
|---|---|---|---|---|
| TREND_DOWN | 543 | -2250 | -0.218 | 32.6 |
| TREND_UP | 502 | -1751 | -0.187 | 35.5 |

## 4. Exit-rule what-ifs on the same signals (per-signal, isolated; diagnostic only)

| variant | n | mean_r_net | mean_r_gross | win_pct | pf |
|---|---|---|---|---|---|
| as configured | 1676 | -0.2005 | -0.1385 | 34.5 | 0.669 |
| BE offset 25 pts (> round-trip cost) | 1676 | -0.1937 | -0.1319 | 44.1 | 0.678 |
| BE off | 1676 | -0.2046 | -0.1412 | 29.7 | 0.729 |
| time stop 24h | 1676 | -0.2003 | -0.1383 | 34.5 | 0.669 |
| TP 1R | 1676 | -0.1881 | -0.1272 | 44.2 | 0.687 |
| TP 3R, BE off | 1676 | -0.1947 | -0.1295 | 23.6 | 0.763 |

These are NOT a parameter search for deployment: they show whether the loss is an exit artefact. If every variant stays negative, the entries themselves have no edge.
