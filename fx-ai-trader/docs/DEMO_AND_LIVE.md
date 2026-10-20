# Demo forward testing and the explicit live-enable procedure

## Stage 0: connectivity (no trading)

EA `EnableTrading=false`, config `mode: demo`.

- [ ] Dashboard: "EA connected", correct broker, login and **Demo account**; all symbols with
      fresh quotes; spreads look right.
- [ ] Decision history fills once per completed bar per symbol, with reasons.
- [ ] Block reasons show "EA EnableTrading=false"; no orders are sent.
- [ ] Stop the Python service: within 30 s the EA's chart comment shows a stale heartbeat.
      Restart it and the dashboard recovers.
- [ ] Emergency stop (keep protected) → the EA shows estop ACTIVE → clear with `CLEAR`.

## Stage 1: demo trading (at least 4–8 weeks, ideally 100+ trades)

EA `EnableTrading=true`, still on a **demo** account.

- [ ] Every order has a broker-side SL (and TP); comment `FXAI|…`; magic matches.
- [ ] A manual trade with another magic number is never modified or closed.
- [ ] Break-even moves once price reaches 1R; the stop never widens.
- [ ] Restart MT4 with an open position: protection resumes, counters persist.
- [ ] Disconnect the network briefly: no duplicate orders after reconnecting; reconciliation
      events appear in the log if a result was ambiguous.
- [ ] Compare demo fills with the backtest's assumptions (spread at entry, slippage, commission,
      swap). Update `fxai/backtest/costs.py` with your broker's real numbers.
- [ ] Export trades (dashboard → CSV) weekly. Track expectancy (R), drawdown, rejected orders
      and slippage. A demo period is still a small sample; it is evidence, not proof.

## Stage 2: deciding whether live trading is justified

Live trading is only reasonable if **all** of these hold:

1. A strategy version passed the pre-declared protocol on data from **your broker**: positive
   expectancy and profit factor on the untouched holdout, with realistic costs and the cost
   sensitivity still positive.
2. A demo forward test of the same version, long enough to be meaningful, is consistent with
   the backtest (no unexplained execution problems).
3. You accept that losses can exceed planned stops and daily thresholds, and that past results
   do not guarantee future results.

**The baseline strategy shipped here does not meet condition 1** (see [VALIDATION.md](VALIDATION.md)).

## Stage 3: the explicit live switches (all are required)

| Where | Setting |
|---|---|
| `config/config.yaml` | `mode: live` |
| `config/config.yaml` | `live_trading_acknowledged: true` |
| `reports/validation_status.json` | `{"strategy_version": "...", "passed": true, "demo_forward_test": "<dates, trades, notes>", "approved_by": "<you>", "date": "..."}`. The service refuses `mode: live` without `"passed": true`. Write this file yourself, only when stages 1 and 2 are satisfied |
| EA inputs | `EnableTrading=true` **and** `AllowLiveAccount=true` |

Every risk control stays active in live mode, and the hard limits still cap everything. Start
with the smallest risk settings your broker's minimum lot allows. Watch the first weeks closely.

To return to safety at any time: dashboard emergency stop, `python -m fxai estop`, or set the EA
input `EnableTrading=false`. Each of these blocks new entries; existing positions keep their
broker-side stops.
