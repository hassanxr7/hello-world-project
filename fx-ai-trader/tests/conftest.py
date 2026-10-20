from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fxai.config import AppConfig  # noqa: E402
from fxai.domain import AccountSnapshot, Quote, SymbolSpec  # noqa: E402
from fxai.risk import EffectiveLimits, RiskContext, RiskState  # noqa: E402
from fxai.storage import Storage  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 10, 20, 10, 0, 0, tzinfo=UTC)


def eurusd_spec(**kw) -> SymbolSpec:
    base = dict(canonical="EURUSD", broker_name="EURUSD", base="EUR", quote="USD", digits=5, point=1e-5,
                tick_size=1e-5, tick_value=1.0, contract_size=100_000, min_lot=0.01, max_lot=100, lot_step=0.01,
                stop_level_points=0, freeze_level_points=0, margin_per_lot=1100.0)
    base.update(kw)
    return SymbolSpec(**base)


def gbpusd_spec(**kw) -> SymbolSpec:
    return eurusd_spec(canonical="GBPUSD", broker_name="GBPUSD", base="GBP", margin_per_lot=1300.0, **kw)


def audusd_spec(**kw) -> SymbolSpec:
    return eurusd_spec(canonical="AUDUSD", broker_name="AUDUSD", base="AUD", margin_per_lot=700.0, **kw)


def usdjpy_spec(price: float = 150.0, **kw) -> SymbolSpec:
    # tick 0.001 JPY * 100000 = 100 JPY per tick per lot -> in USD
    return SymbolSpec(canonical="USDJPY", broker_name="USDJPY", base="USD", quote="JPY", digits=3, point=0.001,
                      tick_size=0.001, tick_value=100.0 / price, contract_size=100_000, min_lot=0.01, max_lot=100,
                      lot_step=0.01, margin_per_lot=1000.0, **kw)


def account(equity: float = 10_000.0, balance: float | None = None, margin: float = 0.0, **kw) -> AccountSnapshot:
    bal = equity if balance is None else balance
    return AccountSnapshot(login=1, currency="USD", balance=bal, equity=equity, margin=margin,
                           free_margin=equity - margin, **kw)


def quote(symbol: str = "EURUSD", bid: float = 1.10000, ask: float = 1.10008, age_s: float = 1.0) -> Quote:
    return Quote(symbol, bid, ask, NOW - timedelta(seconds=age_s))


@pytest.fixture
def cfg() -> AppConfig:
    return AppConfig()


@pytest.fixture
def storage(tmp_path) -> Storage:
    return Storage(tmp_path / "t.sqlite")


def make_ctx(cfg: AppConfig, **kw) -> RiskContext:
    specs = kw.pop("specs", {"EURUSD": eurusd_spec(), "GBPUSD": gbpusd_spec(), "AUDUSD": audusd_spec(),
                             "USDJPY": usdjpy_spec()})
    quotes = kw.pop("quotes", {"EURUSD": quote(), "GBPUSD": quote("GBPUSD", 1.30000, 1.30010),
                               "AUDUSD": quote("AUDUSD", 0.70000, 0.70010),
                               "USDJPY": quote("USDJPY", 150.000, 150.010)})
    state = kw.pop("state", None)
    if state is None:
        state = RiskState()
        state.roll_if_needed("2026-10-20", 10_000.0)
    acct = kw.pop("account", account())
    limits = kw.pop("limits", EffectiveLimits.combine(cfg.risk, cfg.hard_limits))
    spreads = kw.pop("max_spread_points", {s: 30 for s in specs})
    return RiskContext(account=acct, positions=kw.pop("positions", []), specs=specs, quotes=quotes, state=state,
                       now=kw.pop("now", NOW), limits=limits, max_spread_points=spreads, **kw)
