"""Watchlist lifecycle.

A setup is a partially formed opportunity produced by the active strategy on a COMPLETED
bar: it has a creation time, the entry conditions (met / pending), the evidence, a trigger
and an invalidation level, and an expiry. Every scan (at least once per minute) re-evaluates
each active setup against fresh data:

  triggered    the strategy produced a BUY/SELL signal on that symbol and side
               (the signal itself goes through the normal risk checks)
  expired      no completed bar re-confirmed it before its expiry
  invalidated  price crossed the invalidation level, the conditions no longer hold on a
               newer bar, or the active strategy version changed

A re-confirmation on a newer completed bar refreshes the setup (stage, evidence, expiry)
and is counted. Execution never comes from the watchlist: only a fresh signal on a
completed bar, younger than ``strategy.signal_ttl_s``, can reach the risk engine, so an
expired setup can never be executed.
"""

from __future__ import annotations

from datetime import datetime

import pandas as pd

from ..storage import Storage
from ..strategy.base import Setup


def _ts(v) -> pd.Timestamp | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    t = pd.Timestamp(v)
    return t.tz_localize("UTC") if t.tzinfo is None else t


class Watchlist:
    def __init__(self, storage: Storage):
        self.st = storage

    def refresh(self, symbol: str, strategy_version: str, setups: list[Setup], now: datetime, price: float | None,
                latest_bar: pd.Timestamp | None, signal: tuple[int, str] | None = None) -> list[str]:
        """Apply the lifecycle for one symbol. ``signal`` = (side, signal_id) if the latest bar fired.
        Returns human-readable notes of every status change."""
        now_t = _ts(now)
        latest = _ts(latest_bar)
        current = {s.side: s for s in setups if s.strategy == strategy_version}
        notes: list[str] = []
        for w in self.st.watch_active(symbol):
            side, wid = int(w["side"]), int(w["id"])
            label = f"{symbol} {'BUY' if side > 0 else 'SELL'} setup #{wid}"
            inv = w["invalidation"]
            if w["strategy"] != strategy_version:
                why = f"active strategy changed to {strategy_version}"
                self.st.watch_close(wid, "invalidated", why)
            elif signal is not None and signal[0] == side:
                why = f"signal {signal[1]}"
                self.st.watch_close(wid, "triggered", why, signal_id=signal[1])
            elif now_t >= _ts(w["expires"]):
                why = f"not re-confirmed by a completed bar before {w['expires']}"
                self.st.watch_close(wid, "expired", why)
            elif price is not None and inv is not None and (price - float(inv)) * side <= 0:
                why = f"price {price:.5g} crossed the invalidation level {float(inv):.5g}"
                self.st.watch_close(wid, "invalidated", why)
            elif side not in current and latest is not None and (w["last_bar"] is None or latest > _ts(w["last_bar"])):
                why = f"conditions no longer met on the bar closing {latest}"
                self.st.watch_close(wid, "invalidated", why)
            else:
                continue
            notes.append(f"{label}: {why}")
        for side, s in current.items():
            if signal is not None and signal[0] == side:
                continue
            created = _ts(s.created)
            if _ts(s.expires) <= now_t:
                continue  # already past its expiry when first seen (e.g. after downtime) - never listed
            self.st.watch_upsert({"symbol": symbol, "strategy": s.strategy, "side": side, "created": created,
                                  "expires": _ts(s.expires), "last_bar": created, "stage": round(float(s.stage), 3),
                                  "trigger_level": s.trigger_level, "invalidation": s.invalidation,
                                  "conditions": s.conditions, "evidence": s.evidence})
        return notes
