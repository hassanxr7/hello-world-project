# Model card: ML meta-filter and LLM review

Three kinds of "AI" appear in this system and are kept distinct:

| Kind | Where | Role | Status |
|---|---|---|---|
| Rule-based signals | `fxai/strategy` | Produce BUY/SELL/WAIT with reasons | Active |
| Trained statistical model | `fxai/ml` | Meta-filter: may only *remove* rule-based signals | Implemented; **no model passed its gates**, disabled |
| Language model | `fxai/llm` | Optional review: explanation, or veto (WAIT) | Implemented; **off by default**; not exercised against the live API here |

### Authority and change control (applies to every AI component)

- **Claude (LLM) review is not a trained model.** It is a veto-only reviewer of a candidate that
  has already passed the rules and the risk engine. It cannot open, upgrade or size a trade.
- **A trained model gets execution authority only after showing added value on unseen data.**
  That means passing the walk-forward gates on data not used for training, then a human
  `model approve`. Even then it can only remove signals. No model has qualified.
- **No AI component can override a limit.** The risk engine and then the EA re-check every order
  against the hard limits whatever any model says.
- **No unvalidated self-modification.** The live service never trains, tunes or edits strategy
  parameters. Every strategy or model change is a new version that must go through the
  versioned evaluation (research plan, experiment record, approval).
- The attention score and the candlestick reading are **descriptive heuristics**, labelled as
  such on the dashboard. They order and explain; they never decide.

## 1. ML meta-filter

**Task.** For each baseline signal, estimate whether the trade would finish with a positive R
multiple after costs. Below the threshold, the signal is dropped. It cannot create trades,
change direction, size or limits.

**Dataset.** One row per baseline signal from `PortfolioBacktest.prepare()`, simulated in
isolation on M1 data with the live exit rules (2R target, break-even at 1R, 48 h max hold) and
the default cost model.

- Data: Oanda M1 mid prices, EURUSD/GBPUSD/USDCAD/AUDUSD, 2015-01-01 to 2020-05-14.
- Rows: 699 (H1/H4 default variant) and 3,004 (M15/H1 variant).
- Label: `1` if the per-signal R net of spread, slippage, commission and swap is > 0.
  Base rate ≈ 0.34.

**Features (14, all from bars closed at decision time):** `adx_trend`, `trend_strength` (EMA50–
EMA200 in ATR, side-adjusted), `slope_trend`, `vol_ratio`, `rsi_side`, `ext_atr`, `stop_atr`,
`room_r` (capped at 5), `body_ratio`, `hour_sin`, `hour_cos`, `ret_24h_atr`, `atr_entry_ratio`,
`pullback_depth`.

**Leakage prevention.**
- Causality of every feature is tested by recomputing on truncated history
  (`tests/test_strategy.py::test_no_lookahead`).
- Higher-timeframe values are joined by bar close time; swing levels count only after their
  confirmation bar.
- Walk-forward is chronological. A training row is used only if its trade **exited** at least
  72 h before the test fold starts (purging and embargo, tested).
- Imputation and standardisation are fit on training rows only.

**Model.** L2 logistic regression, C = 0.5 (fixed, not tuned). Threshold = training base rate
(fixed rule). Serialised as JSON (coefficients, scaler, imputation values, metadata), never
pickle. The SHA-256 is recorded at evaluation and verified at load.

**Validation protocol.** Expanding window, 6-month test folds from 2016-07. Metrics per fold and
pooled: AUC, Brier score vs. base-rate Brier (skill), log loss, reliability bins, and per-signal
expectancy of taken vs. all signals. A portfolio backtest compares baseline and filtered signals
on the same out-of-sample period.

**Approval gates (all required):** ≥ 200 out-of-sample rows; pooled Brier skill > 0; skill > 0 in
≥ 60 % of folds; filtered expectancy > 0; filtered expectancy > unfiltered. Separately,
**calibration** (max reliability-bin error ≤ 0.10 on bins with ≥ 30 rows) decides whether the
dashboard may call the output a "probability"; otherwise it is shown as an "uncalibrated score".

**Results (measured, out-of-sample):**

| Variant | OOS rows | AUC | Brier skill | Calibration error | Exp. R unfiltered → filtered | Gates |
|---|---|---|---|---|---|---|
| H1/H4 (default) | 513 | 0.48 | −0.042 | 0.17 | −0.146 → −0.185 | fail |
| M15/H1 | 2,206 | 0.57 | +0.006 | 0.09 | −0.230 → −0.188 | fail (expectancy still negative) |

**Limitations.** Few samples for the default variant; non-stationary markets; labels depend on
the cost model; the four pairs share USD so rows are not independent; a model trained on one
broker's data may not transfer to another's spreads and execution.

**Lifecycle (no uncontrolled self-modification).** `python -m fxai model train` evaluates and
stores a *candidate*. `python -m fxai model approve <version>` is a human action, refused if any
gate failed, and audited. The live service only loads the single approved model, verifies its
hash, and never trains. Retraining always produces a new version.

## 2. LLM review (optional)

- **Purpose:** a bounded second look at a candidate that already passed the strategy and the
  risk engine. In `advisory` mode it only adds an explanation. In `veto` mode, an assessment of
  `contradicts` turns the trade into WAIT. It can never create, upgrade or size a trade.
- **Inputs:** symbol, side, regime, rule results, features, spread and stop distance, and the
  calendar events for the pair's currencies. Calendar text is untrusted: control characters and
  angle brackets are stripped, it is truncated, and it is wrapped in `<untrusted_calendar>` with
  an instruction to treat it as data. **No** account data, credentials or limits are sent.
- **Output:** JSON constrained by a schema
  (`assessment ∈ {supports, neutral, contradicts}`, `concerns[≤5]`, `explanation`), validated
  again with pydantic. Anything invalid, truncated or refused has no effect (`on_unavailable`
  decides between proceed and WAIT).
- **Model and request:** `claude-opus-5-5` by default (configurable), `output_config.effort`
  configurable (default `medium`), no tools, server-side refusal fallback
  (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) for models that support it.
- **Controls:** called only for candidates (a few per day), never per tick; runs in a worker
  thread so monitoring continues; timeout 20 s; response cache 60 min; daily caps of 40 calls
  and USD 2 tracked locally from token usage. The prices used for that cap are in config and
  must be kept in sync with the published price list.
- **Credentials:** from the environment (`ANTHROPIC_API_KEY` or an `ant auth login` profile);
  never stored or displayed.
- **Status:** tested with a fake client only (`tests/test_llm.py`). No live API call was made
  in this environment. Whether it adds value has not been measured; treat it as an explanation
  aid, and evaluate it on demo before giving it veto power.
