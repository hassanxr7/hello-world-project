"""Position sizing from the actual stop distance and broker contract data.

loss_per_lot = (|entry - SL| + slippage_buffer) * tick_value / tick_size
               + round-turn commission per lot
volume       = floor_to_lot_step(budget / loss_per_lot), clamped to max lot

If the broker's minimum lot would risk more than the budget, the trade is
skipped - never rounded up.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal

from ..domain import SymbolSpec


@dataclass(frozen=True)
class SizingResult:
    ok: bool
    volume: float
    risk_money: float
    loss_per_lot: float
    reason: str = ""


def _decimals(step: float) -> int:
    d = Decimal(str(step)).normalize()
    return max(0, -d.as_tuple().exponent)  # type: ignore[operator]


def floor_to_step(x: float, step: float) -> float:
    """Round DOWN to a multiple of ``step`` without binary floating-point artefacts."""
    if step <= 0:
        raise ValueError("lot step must be positive")
    if x <= 0 or not math.isfinite(x):
        return 0.0
    q = (Decimal(repr(float(x))) / Decimal(str(step))).to_integral_value(rounding=ROUND_FLOOR)
    return float((q * Decimal(str(step))).quantize(Decimal(1).scaleb(-_decimals(step))))


def loss_per_lot(spec: SymbolSpec, entry: float, stop: float, commission_per_lot_rt: float,
                 slippage_points: float) -> float:
    dist = abs(entry - stop) + max(0.0, slippage_points) * spec.point
    return dist * spec.value_per_price_unit + max(0.0, commission_per_lot_rt)


def size_position(spec: SymbolSpec, entry: float, stop: float, budget_money: float,
                  commission_per_lot_rt: float = 0.0, slippage_points: float = 0.0,
                  max_lot_cfg: float = float("inf")) -> SizingResult:
    if not (math.isfinite(entry) and math.isfinite(stop)) or entry <= 0 or stop <= 0:
        return SizingResult(False, 0.0, 0.0, 0.0, "invalid entry/stop price")
    if abs(entry - stop) < spec.point:
        return SizingResult(False, 0.0, 0.0, 0.0, "stop distance is zero")
    if spec.tick_size <= 0 or spec.tick_value <= 0:
        return SizingResult(False, 0.0, 0.0, 0.0, "broker tick value/size unavailable")
    if spec.lot_step <= 0 or spec.min_lot <= 0:
        return SizingResult(False, 0.0, 0.0, 0.0, "broker lot step/min lot unavailable")
    if budget_money <= 0:
        return SizingResult(False, 0.0, 0.0, 0.0, "no risk budget available")

    lpl = loss_per_lot(spec, entry, stop, commission_per_lot_rt, slippage_points)
    raw = budget_money / lpl
    cap = min(spec.max_lot, max_lot_cfg)
    vol = floor_to_step(min(raw, cap), spec.lot_step)
    if vol < spec.min_lot - 1e-12:
        min_risk = spec.min_lot * lpl
        return SizingResult(
            False, 0.0, 0.0, lpl,
            f"broker minimum lot {spec.min_lot} would risk {min_risk:.2f} > budget {budget_money:.2f}",
        )
    return SizingResult(True, vol, vol * lpl, lpl)
