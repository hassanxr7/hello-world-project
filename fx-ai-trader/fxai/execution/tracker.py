"""Keeps the trades table and the persistent risk state in sync with the broker
snapshot (open system positions and closed system trades; cash flows come from the EA)."""

from __future__ import annotations

import json

from ..bridge.protocol import BridgeState
from ..config import RiskConfig
from ..risk import RiskState
from ..storage import Storage


class TradeTracker:
    def __init__(self, storage: Storage, risk_cfg: RiskConfig):
        self.st = storage
        self.cfg = risk_cfg
        self._tag_cache: dict[str, tuple[str, float]] = {}

    def _signal_for(self, comment: str) -> tuple[str | None, float | None]:
        if "FXAI|" not in comment:
            return None, None
        tag = comment.split("FXAI|", 1)[1][:10]
        if tag in self._tag_cache:
            return self._tag_cache[tag]
        rows = self.st.query("SELECT signal_id, payload FROM commands WHERE type='OPEN' AND payload LIKE ?",
                             (f'%"tag":"{tag}"%',))
        if not rows:
            return None, None
        p = json.loads(rows[0]["payload"])
        self._tag_cache[tag] = (rows[0]["signal_id"], float(p.get("planned_risk", 0) or 0))
        return self._tag_cache[tag]

    def sync(self, state: BridgeState, risk: RiskState) -> list[str]:
        """Returns human-readable notes about newly closed trades / cash flows."""
        notes = []
        for p in state.positions:
            if not p.system_owned:
                continue
            sid, planned = self._signal_for(p.comment)
            existing = self.st.trade(p.ticket)
            self.st.upsert_trade({
                "ticket": p.ticket, "signal_id": sid, "symbol": p.symbol, "side": p.side.value, "volume": p.volume,
                "open_time": p.open_time_utc.isoformat(), "open_price": p.open_price,
                "initial_sl": existing["initial_sl"] if existing and existing["initial_sl"] else p.sl, "tp": p.tp,
                "planned_risk": planned, "status": "OPEN", "comment": p.comment,
                "profit": p.profit, "swap": p.swap, "commission": p.commission,
            })
        for h in state.history:
            if not h.system_owned:
                continue
            prior = self.st.trade(h.ticket)
            if prior and prior["status"] == "CLOSED":
                continue
            sid, planned = self._signal_for(h.comment)
            if planned is None and prior:
                planned = prior.get("planned_risk")
            net = h.net_profit
            self.st.upsert_trade({
                "ticket": h.ticket, "signal_id": sid, "symbol": h.symbol, "side": h.side.value, "volume": h.volume,
                "open_time": h.open_time_utc.isoformat(), "open_price": h.open_price,
                "initial_sl": prior["initial_sl"] if prior else h.sl, "tp": h.tp, "planned_risk": planned,
                "close_time": h.close_time_utc.isoformat(), "close_price": h.close_price, "profit": h.profit,
                "swap": h.swap, "commission": h.commission, "net_profit": net,
                "r_multiple": (net / planned) if planned else None, "status": "CLOSED", "comment": h.comment,
            })
            if risk.record_closed_trade(h.ticket, h.symbol, net, h.close_time_utc, self.cfg.max_consecutive_losses,
                                        self.cfg.consecutive_loss_pause_min):
                notes.append(f"consecutive-loss pause until {risk.pause_until}")
            notes.append(f"closed #{h.ticket} {h.symbol} net {net:+.2f}")
        return notes
