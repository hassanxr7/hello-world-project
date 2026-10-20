"""Meta-label dataset built from baseline signals.

One row per baseline signal (BUY/SELL), simulated in isolation with the live
exit rules on M1 data.

- Features: ``fxai.strategy.FEATURES`` - all computed from bars that had
  CLOSED at the decision time (verified by tests/test_strategy.py::test_no_lookahead).
- Label: 1 if the trade's R multiple net of spread, slippage, commission and
  swap is > 0, else 0.
- ``t_decision`` and ``t_exit`` are kept so walk-forward splits can purge any
  training row whose outcome was not yet known when the test period started.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..backtest.costs import CostModel
from ..backtest.fills import TradePath
from ..strategy import FEATURES
from ..symbols import KNOWN_MAJORS

CONTRACT = 100_000.0


def build_dataset(signals: pd.DataFrame, paths: dict[str, TradePath], costs: CostModel,
                  account_ccy: str = "USD") -> pd.DataFrame:
    rows = []
    for r in signals.itertuples(index=False):
        p = paths.get(r.key)
        if p is None or p.risk_dist <= 0:
            continue
        base, quote, digits = KNOWN_MAJORS[r.symbol]
        point = 10.0 ** -digits
        pip = point * 10 if digits in (3, 5) else point
        vpu = CONTRACT if quote == account_ccy else CONTRACT / p.entry
        commission_r = costs.commission_per_lot_rt / (p.risk_dist * vpu)
        swap_r = p.swap_nights * costs.swap_pips_per_night * costs.swap_multiplier * pip / p.risk_dist
        r_net = p.r_gross - commission_r + swap_r
        row = {"key": r.key, "symbol": r.symbol, "side": r.side, "t_decision": pd.Timestamp(r.time),
               "t_exit": pd.Timestamp(p.t_exit, tz="UTC"), "r_net": r_net, "label": int(r_net > 0),
               "exit_reason": p.reason}
        for f in FEATURES:
            v = getattr(r, f)
            row[f] = float(v) if v is not None and np.isfinite(v) else np.nan
        rows.append(row)
    return pd.DataFrame(rows).sort_values("t_decision").reset_index(drop=True)
