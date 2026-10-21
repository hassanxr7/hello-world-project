> Starting capital is unknown. Re-run with `--capital <amount> --currency <code>` (or set `reporting.capital_for_scenarios`) for figures for your account. The grid below shows the capital each hypothetical case would need.

# Profit-target scenario analysis

**hypothetical arithmetic on stated assumptions - not a forecast.** Capital: unknown USD; risk per trade 0.25%; target: (15.0, 230.0) USD/day (aspirational).

- No strategy has passed validation. Every recorded research run has a negative expectancy (best -0.037 R per trade), so the evidence-based expected daily result is a LOSS at any capital.
- Observed frequency in the research runs: 0.41-1.35 trades/day across all enabled pairs; the 20/day ceiling is a limit, not a goal, and no tested strategy came close to it.
- Raising risk per trade, leverage or trade frequency to reach a target is not an option in this system: the limits are fixed by configuration, and frequency without an edge only adds costs.

## Hypothetical grid

| expectancy_r | trades_per_day | capital_for_target_low | capital_for_target_high |
|---|---|---|---|
| 0.05 | 0.5 | 240000 | 3680000 |
| 0.05 | 1 | 120000 | 1840000 |
| 0.05 | 2 | 60000 | 920000 |
| 0.05 | 5 | 24000 | 368000 |
| 0.1 | 0.5 | 120000 | 1840000 |
| 0.1 | 1 | 60000 | 920000 |
| 0.1 | 2 | 30000 | 460000 |
| 0.1 | 5 | 12000 | 184000 |
| 0.2 | 0.5 | 60000 | 920000 |
| 0.2 | 1 | 30000 | 460000 |
| 0.2 | 2 | 15000 | 230000 |
| 0.2 | 5 | 6000 | 92000 |

## Evidence used

```
{
  "runs": 6,
  "any_passed": false,
  "best_expectancy_r": -0.037,
  "best_strategy": "donchian_trend-1.0.0",
  "best_stage": "dev",
  "trades_per_day_range": [
    0.41,
    1.35
  ]
}
```
