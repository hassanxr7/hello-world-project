"""Open-risk, currency exposure and correlation accounting."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from ..domain import Position, Side, SymbolSpec
from ..symbols import currency_risk_vector


@dataclass(frozen=True)
class ExposureItem:
    symbol: str
    side: Side
    risk_money: float
    system_owned: bool
    protected: bool  # has a stop-loss


def position_risk_money(pos: Position, spec: SymbolSpec) -> tuple[float, bool]:
    """Planned loss from the ENTRY price to the current stop (floored at 0).

    Once the stop is moved to break-even or beyond, the position contributes 0
    to planned risk. A position without a stop returns (inf, False).
    """
    if pos.sl <= 0:
        return float("inf"), False
    dist = (pos.open_price - pos.sl) * pos.side.sign
    return max(0.0, dist) * spec.value_per_price_unit * pos.volume, True


def exposure_items(positions: Iterable[Position], specs: dict[str, SymbolSpec],
                   include_manual: bool = True) -> list[ExposureItem]:
    items: list[ExposureItem] = []
    for p in positions:
        if not p.system_owned and not include_manual:
            continue
        spec = specs.get(p.symbol)
        if spec is None:
            continue
        risk, protected = position_risk_money(p, spec)
        items.append(ExposureItem(p.symbol, p.side, risk, p.system_owned, protected))
    return items


def total_open_risk(items: Iterable[ExposureItem]) -> float:
    return sum(i.risk_money for i in items if i.protected)


def currency_exposure(items: Iterable[ExposureItem], specs: dict[str, SymbolSpec]) -> dict[str, float]:
    net: dict[str, float] = {}
    for i in items:
        if not i.protected:
            continue
        spec = specs[i.symbol]
        for ccy, v in currency_risk_vector(spec.base, spec.quote, i.side.sign, i.risk_money).items():
            net[ccy] = net.get(ccy, 0.0) + v
    return net


def correlated_count(symbol: str, side: Side, items: Iterable[ExposureItem],
                     correlations: dict[tuple[str, str], float] | None, threshold: float) -> int:
    """Number of existing positions whose returns are correlated with the new
    trade *in the same effective direction* (|corr| >= threshold)."""
    if not correlations:
        return 0
    n = 0
    for i in items:
        if i.symbol == symbol:
            continue
        c = correlations.get((symbol, i.symbol), correlations.get((i.symbol, symbol)))
        if c is None:
            continue
        if c * side.sign * i.side.sign >= threshold:
            n += 1
    return n
