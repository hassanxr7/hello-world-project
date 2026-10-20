"""Transaction-cost assumptions for simulation. These are ASSUMPTIONS, not broker
quotes - replace them with your broker's actual values (see docs/VALIDATION.md).

Spread model (the Oanda data has no bid/ask, only mid prices):
    spread(symbol, hour_utc) = base_spread_pips[symbol] * hour_multiplier[hour] * spread_multiplier
Rollover hours (21-22 UTC) are 3x wider, the late-Asian hours 1.2-1.5x.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

DEFAULT_SPREAD_PIPS = {
    "EURUSD": 0.5, "GBPUSD": 0.9, "AUDUSD": 0.6, "USDCAD": 0.9,
    "USDJPY": 0.5, "USDCHF": 0.9, "NZDUSD": 1.2,
}

# UTC hour -> multiplier
HOUR_MULT = np.array([
    1.5, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2,  # 00-06 Asia
    1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,  # 07-19 London/NY
    1.2, 3.0, 3.0, 1.5,  # 20-23 late NY / rollover
])


@dataclass
class CostModel:
    spread_pips: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_SPREAD_PIPS))
    spread_multiplier: float = 1.0
    commission_per_lot_rt: float = 7.0  # account currency per 1.0 lot round turn
    slippage_entry_pips: float = 0.1  # adverse, market entries
    slippage_stop_pips: float = 0.3  # adverse, stop-loss / time / forced exits
    slippage_multiplier: float = 1.0
    swap_pips_per_night: float = -0.3  # charged to BOTH sides (conservative, ignores carry)
    swap_multiplier: float = 1.0

    def spread_series(self, symbol: str, hours_utc: np.ndarray, pip_size: float) -> np.ndarray:
        base = self.spread_pips[symbol] * pip_size * self.spread_multiplier
        return base * HOUR_MULT[hours_utc]

    def entry_slip(self, pip_size: float) -> float:
        return self.slippage_entry_pips * pip_size * self.slippage_multiplier

    def stop_slip(self, pip_size: float) -> float:
        return self.slippage_stop_pips * pip_size * self.slippage_multiplier

    def scaled(self, spread: float = 1.0, slippage: float = 1.0, commission: float = 1.0,
               swap: float = 1.0) -> "CostModel":
        return CostModel(dict(self.spread_pips), self.spread_multiplier * spread, self.commission_per_lot_rt * commission,
                         self.slippage_entry_pips, self.slippage_stop_pips, self.slippage_multiplier * slippage,
                         self.swap_pips_per_night, self.swap_multiplier * swap)

    def describe(self) -> dict:
        return {
            "spread_pips": self.spread_pips, "spread_multiplier": self.spread_multiplier,
            "hour_multipliers_utc": HOUR_MULT.tolist(), "commission_per_lot_rt": self.commission_per_lot_rt,
            "slippage_entry_pips": self.slippage_entry_pips * self.slippage_multiplier,
            "slippage_stop_pips": self.slippage_stop_pips * self.slippage_multiplier,
            "swap_pips_per_night": self.swap_pips_per_night * self.swap_multiplier,
        }
