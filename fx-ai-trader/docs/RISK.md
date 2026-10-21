# Risk management

All values are **demo starting defaults**, not optimal settings. They are configured in
`config/config.yaml` (Python) and the EA inputs (hard caps). The stricter of the two applies.

| Control | Default | Where enforced |
|---|---|---|
| Planned risk per trade | 0.25 % of equity | Risk engine (sizing) + EA cap (×1.10 tolerance for price drift) |
| Max aggregate planned stop-loss risk | 1 % of equity | Risk engine + EA |
| Max simultaneous system positions | 3 | Risk engine + EA |
| Positions per symbol | 1 | Risk engine + EA (in-flight entries count too) |
| Daily equity-loss threshold | 2 % | Risk engine + EA (each latches its own halt) |
| Max successful entries per day | 20 (a ceiling, never a target) | Risk engine + EA; the count is max(Python, EA) |
| Net stop-risk per currency | 0.5 % of equity | Risk engine |
| Correlated same-direction positions | ≤ 2 with \|corr\| ≥ 0.75 (trend-TF returns, last 200 bars) | Risk engine |
| Margin | usage after trade ≤ 30 %, margin level ≥ 300 %, `AccountFreeMarginCheck` > 0 | Risk engine + EA |
| Spread | per-symbol max points (e.g. EURUSD 20), and ≤ 15 % of the stop distance | Risk engine; EA generic cap 50 points |
| Quote freshness | ≤ 30 s | Risk engine + EA |
| Entry price drift | ≤ 20 points from the signal reference | Risk engine + EA |
| Slippage on execution | ≤ 10 points (`OrderSend` slippage) | EA |
| Re-entry cooldown | 30 min per symbol | Risk engine |
| Cooldown after a loss | 60 min per symbol | Risk engine |
| Consecutive losses | 3, then a 240-minute pause | Risk engine |
| Daily-loss headroom | a new trade's planned risk + open risk must fit inside the remaining daily-loss budget | Risk engine |
| Emergency stop | persistent; set from dashboard, CLI, `estop.flag` or command | EA + Python |

The system never uses martingale, grids, loss-recovery doubling or averaging down: one position
per symbol, and every entry is sized only from the fixed risk budget.

## Position sizing

```
loss_per_lot = (|entry − stop| + sizing_slippage_points × point) × tick_value / tick_size
               + commission_per_lot_round_turn
budget       = min(equity × risk_per_trade,
                   equity × max_total_risk − open_risk − in-flight risk,
                   day_start_equity × max_daily_loss − today's loss − open_risk)   # headroom check
volume       = floor_to_lot_step(budget / loss_per_lot), clamped to broker max and max_lot_per_trade
```

- `tick_value` and `tick_size` come from the broker (`MODE_TICKVALUE`, `MODE_TICKSIZE`) in the
  account currency, so JPY pairs, crosses and non-USD accounts are handled by the broker's own
  conversion. If they are 0 or missing, the trade is refused.
- Volume is always rounded **down** using decimal arithmetic. If the broker's minimum lot would
  risk more than the budget, the trade is **skipped**, never rounded up.
- If the budget is below 50 % of the normal per-trade budget (because other positions use the
  allowance), the trade is refused rather than taken at a token size.
- Open risk counts each position from its entry to its **current** stop, floored at 0. A position
  at break-even therefore frees its risk allowance.

## Currency exposure

A long BASE/QUOTE position's planned risk is attributed +risk to BASE and −risk to QUOTE. Summed
over positions this gives the net directional stop-risk per currency. Example: long EURUSD and
long GBPUSD are each −0.25 % USD, so USD is at −0.5 %. A third long USD-quoted pair (−0.75 %) is
refused; a trade that **reduces** an existing exposure is allowed. Manual positions with a stop
are included (read-only).

## Daily loss: definition

At the trading-day boundary (configurable: server midnight, UTC, New York or London with a reset
hour; the EA and Python use the same rules and the DST logic is tested against the IANA
database):

```
day_start_equity = equity at the first observation after the boundary   (includes floating P&L)
net_flows        = sum of balance (type 6) and credit (type 7) operations since the boundary
daily_pnl        = equity_now − day_start_equity − net_flows
daily_loss_pct   = max(0, −daily_pnl) / day_start_equity × 100
```

- Equity includes floating P&L, swaps and commissions, so open losses count immediately.
- Deposits and withdrawals are removed, so a withdrawal is not a "loss" and a deposit cannot
  hide one (tested).
- If the EA starts mid-day with no saved state, `day_start_equity` is approximated as
  `balance − today's closed P&L − today's flows`. Floating P&L carried over the boundary is
  unknown and treated as 0, and this is logged.
- MT4 only exposes the history loaded in the terminal's **Account History** tab. Set it to
  "All History" (or at least "Last 3 days"), otherwise cash flows and today's trades may be missed.

**When the threshold is reached:** new entries are blocked until the next trading day, the
system's pending orders are cancelled, and existing positions follow `daily_loss_policy`:
`hold_protected` (default: positions keep their broker-side stops and are still managed) or
`close_all` (system positions are closed at market). Manual positions are never touched.

## Emergency stop

- Set from the dashboard ("Emergency stop + flatten" or "keep protected"), from
  `python -m fxai estop`, or by creating `estop.flag` in the bridge folder (works with Python
  down). Policy `close_all` (default) closes system positions; `hold` keeps them with their stops.
- Persistent across restarts (EA GlobalVariable + Python SQLite). Clearing requires typing
  `CLEAR`, and the EA refuses to clear while `estop.flag` exists.

## Exits and protection

Every entry carries a broker-side stop-loss and, where the strategy has one, a take-profit.
Each order also carries its strategy's exit policy: maximum hold, break-even trigger and offset,
and trailing start with a fixed trailing distance. The EA stores the policy per ticket and runs
it every 500 ms, independent of Python ([PROTOCOL.md](PROTOCOL.md)). Out-of-range values make
the EA reject the order. Orders without a policy use the EA inputs (break-even at 1R +10
points, max hold 48 h). Stops are only ever moved in the favourable direction,
respecting the broker's stop and freeze levels. If you use break-even, set the offset above your
round-trip cost (spread + commission + slippage); otherwise break-even exits become small losses
(visible in the validation report).

## Limitations you must accept

- **A stop-loss is not a guaranteed price.** Weekend gaps, news spikes, illiquidity, requotes,
  broker outages and slippage can fill a stop far beyond its level. Realised losses can exceed
  the planned per-trade risk and the daily threshold. The backtest shows such `sl_gap` exits.
- The daily-loss check runs every 500 ms (EA) / 1 s (Python); a fast move can overshoot it.
- A broker can reject or delay orders, change margin requirements, or widen spreads beyond
  the filters, which blocks entries.
- Correlation estimates are backward-looking and unstable in crises.
- Weekend gaps: positions may be held over the weekend (max hold 48 h). There is no automatic
  Friday close by default.
