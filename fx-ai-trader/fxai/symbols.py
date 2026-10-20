"""Symbol catalogue, broker-name mapping and currency decomposition.

Only the seven majors are known out of the box. Any other instrument must be
configured explicitly (base, quote, digits) - the system refuses to guess.
"""

from __future__ import annotations

from dataclasses import dataclass

from .domain import SymbolSpec

# canonical -> (base, quote, digits)
KNOWN_MAJORS: dict[str, tuple[str, str, int]] = {
    "EURUSD": ("EUR", "USD", 5),
    "GBPUSD": ("GBP", "USD", 5),
    "USDJPY": ("USD", "JPY", 3),
    "USDCAD": ("USD", "CAD", 5),
    "AUDUSD": ("AUD", "USD", 5),
    "USDCHF": ("USD", "CHF", 5),
    "NZDUSD": ("NZD", "USD", 5),
}

# Default entry windows (UTC, start inclusive, end exclusive). London + New York
# for European/North-American pairs; Asia-Pacific pairs also get the Tokyo session.
DEFAULT_SESSIONS_UTC: dict[str, str] = {
    "EURUSD": "07:00-20:00",
    "GBPUSD": "07:00-20:00",
    "USDCAD": "07:00-20:00",
    "USDCHF": "07:00-20:00",
    "USDJPY": "00:00-20:00",
    "AUDUSD": "00:00-20:00",
    "NZDUSD": "00:00-20:00",
}

# Conservative default max spreads in *points* (5-digit points; 10 points = 1 pip).
DEFAULT_MAX_SPREAD_POINTS: dict[str, int] = {
    "EURUSD": 20,
    "GBPUSD": 30,
    "USDJPY": 25,
    "USDCAD": 30,
    "AUDUSD": 25,
    "USDCHF": 30,
    "NZDUSD": 35,
}


@dataclass(frozen=True)
class SymbolInfo:
    canonical: str
    broker_name: str
    base: str
    quote: str
    digits: int
    trading_hours_utc: str
    max_spread_points: int

    @property
    def currencies(self) -> tuple[str, str]:
        return (self.base, self.quote)


def broker_name_for(canonical: str, prefix: str = "", suffix: str = "", override: str | None = None) -> str:
    return override if override else f"{prefix}{canonical}{suffix}"


def canonical_from_broker(name: str, prefix: str = "", suffix: str = "") -> str:
    """Strip a configured prefix/suffix from a broker symbol name."""
    s = name
    if prefix and s.startswith(prefix):
        s = s[len(prefix):]
    if suffix and s.endswith(suffix):
        s = s[: -len(suffix)]
    return s


def currency_risk_vector(base: str, quote: str, side_sign: int, risk_money: float) -> dict[str, float]:
    """Signed risk attributed to each currency of a position.

    A long BASE/QUOTE position is long BASE and short QUOTE; its stop-loss risk
    is attributed to both legs (+risk on base, -risk on quote). Summing these
    vectors over positions gives the net directional exposure per currency.
    """
    return {base: side_sign * risk_money, quote: -side_sign * risk_money}


def sim_tick_value(spec_base: str, spec_quote: str, tick_size: float, contract: float,
                   account_ccy: str, price_of: dict[str, float]) -> float:
    """Tick value in account currency (simulation only; live uses broker values).

    ``price_of`` maps canonical pair -> current mid price.
    """
    quote_amount = tick_size * contract  # P&L in quote currency per tick per lot
    return quote_amount * conversion_rate(spec_quote, account_ccy, price_of)


def conversion_rate(ccy: str, account_ccy: str, price_of: dict[str, float]) -> float:
    """Rate to convert 1 unit of ``ccy`` into ``account_ccy`` using available pairs."""
    if ccy == account_ccy:
        return 1.0
    direct = f"{ccy}{account_ccy}"
    inverse = f"{account_ccy}{ccy}"
    if direct in price_of and price_of[direct] > 0:
        return price_of[direct]
    if inverse in price_of and price_of[inverse] > 0:
        return 1.0 / price_of[inverse]
    # Triangulate through USD.
    if account_ccy != "USD" and ccy != "USD":
        return conversion_rate(ccy, "USD", price_of) * conversion_rate("USD", account_ccy, price_of)
    raise KeyError(f"no conversion path from {ccy} to {account_ccy}")


def default_sim_spec(canonical: str, base: str, quote: str, digits: int, account_ccy: str,
                     price_of: dict[str, float], broker_name: str | None = None) -> SymbolSpec:
    point = 10.0 ** -digits
    contract = 100_000.0
    tv = sim_tick_value(base, quote, point, contract, account_ccy, price_of)
    mid = price_of.get(canonical, 1.0)
    # Margin at 1:100 leverage, expressed in account currency.
    notional_acc = contract * conversion_rate(base, account_ccy, {**price_of, canonical: mid})
    return SymbolSpec(
        canonical=canonical,
        broker_name=broker_name or canonical,
        base=base,
        quote=quote,
        digits=digits,
        point=point,
        tick_size=point,
        tick_value=tv,
        contract_size=contract,
        min_lot=0.01,
        max_lot=100.0,
        lot_step=0.01,
        stop_level_points=0,
        freeze_level_points=0,
        margin_per_lot=notional_acc / 100.0,
        trade_allowed=True,
    )
