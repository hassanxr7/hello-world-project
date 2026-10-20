"""Event-driven portfolio backtest.

It uses the *same* strategy code (``TrendPullbackStrategy.compute``) and the
*same* ``RiskEngine.evaluate`` as live trading, with simulated account state.

Pipeline
1. Per symbol: resample M1 -> M15/H1, compute strategy frame (causal).
2. Per signal: simulate the trade path on M1 bars (``fills.simulate_trade``).
   Paths do not depend on position size, so they are computed once.
3. Walk through signal events and trading-day boundaries in time order. Between
   events, mark open positions to market minute-by-minute to (a) detect the
   daily-loss threshold intraday and (b) measure drawdown at M1 resolution.
4. At each signal, build a RiskContext (balance, equity, margin, open positions
   with their CURRENT stops, quotes, correlations, persistent RiskState) and let
   the risk engine approve and size the trade.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta

import numpy as np
import pandas as pd

from ..analysis.bars import resample
from ..config import AppConfig
from ..domain import AccountSnapshot, Position, Quote, Side, SymbolSpec, TradeIntent
from ..risk import EffectiveLimits, RiskContext, RiskEngine, RiskState
from ..strategy import FEATURES, TrendPullbackStrategy
from ..symbols import KNOWN_MAJORS, default_sim_spec
from ..timeutil import UTC, from_epoch
from .costs import CostModel
from .fills import SymbolArrays, TradePath, simulate_trade

CONTRACT = 100_000.0
NS = 1_000_000_000


@dataclass
class OpenTrade:
    ticket: int
    key: str
    path: TradePath
    volume: float
    planned_risk: float
    tt: np.ndarray
    val: np.ndarray  # cumulative account-currency P&L incl. commission & swap at each bar
    commission: float
    swap_cum: np.ndarray
    vpu: np.ndarray
    signal: dict

    def value_at(self, ts: np.ndarray) -> np.ndarray:
        idx = np.searchsorted(self.tt, ts, side="right") - 1
        idx = np.clip(idx, 0, len(self.val) - 1)
        out = self.val[idx]
        return np.where(ts < self.tt[0], 0.0, out)

    @property
    def t_exit(self) -> int:
        return int(self.tt[-1])


@dataclass
class BacktestResult:
    trades: pd.DataFrame
    equity_hourly: pd.Series
    daily: pd.DataFrame
    rejections: dict[str, int]
    stats: dict
    params: dict
    signals_considered: int
    halts: list[dict] = field(default_factory=list)


class PortfolioBacktest:
    def __init__(self, cfg: AppConfig, m1: dict[str, pd.DataFrame], costs: CostModel | None = None,
                 initial_balance: float = 10_000.0, use_correlation: bool = True):
        self.cfg = cfg
        self.m1 = m1
        self.costs = costs or CostModel()
        self.initial_balance = initial_balance
        self.use_correlation = use_correlation
        self.strategy = TrendPullbackStrategy(cfg.strategy.params, cfg.exits)
        self.exits = cfg.exits
        self.symbols = sorted(m1)
        self.info = cfg.symbols.resolve() if set(self.symbols) <= set(cfg.symbols.enabled) else {}
        self._frames: dict[str, pd.DataFrame] = {}
        self._arrays: dict[str, SymbolArrays] = {}
        self._signals: pd.DataFrame | None = None
        self._h1_close: pd.DataFrame | None = None

    # ------------------------------------------------------------------ preparation
    def _session(self, sym: str) -> str:
        if sym in self.info:
            return self.info[sym].trading_hours_utc
        from ..symbols import DEFAULT_SESSIONS_UTC
        return DEFAULT_SESSIONS_UTC.get(sym, "07:00-20:00")

    def prepare(self) -> pd.DataFrame:
        rows = []
        h1_closes = {}
        for sym in self.symbols:
            m1 = self.m1[sym]
            m15 = resample(m1, self.cfg.strategy.decision_timeframe)
            h1 = resample(m1, self.cfg.strategy.trend_timeframe)
            # Drop a trailing partial bar.
            last_t = m1.index[-1] + pd.Timedelta(minutes=1)
            m15, h1 = m15[m15["close_time"] <= last_t], h1[h1["close_time"] <= last_t]
            f = self.strategy.compute(m15, h1, self._session(sym))
            self._frames[sym] = f
            h1_closes[sym] = h1.set_index("close_time")["close"]
            sig = f[f["signal"] != 0]
            for t, r in sig.iterrows():
                rows.append({
                    "key": f"{sym}|{r['close_time'].isoformat()}", "symbol": sym, "time": r["close_time"],
                    "side": int(r["signal"]), "sl": float(r["sl"]), "ref_close": float(r["close"]),
                    "atr_e": float(r["atr_e"]), "regime": r["tr_regime"],
                    **{k: float(r[k]) if pd.notna(r[k]) else np.nan for k in FEATURES},
                })
        self._h1_close = pd.DataFrame(h1_closes).sort_index()
        self._signals = pd.DataFrame(rows).sort_values("time").reset_index(drop=True) if rows else pd.DataFrame()
        return self._signals

    def arrays(self, costs: CostModel) -> dict[str, SymbolArrays]:
        out = {}
        for sym in self.symbols:
            digits = KNOWN_MAJORS[sym][2]
            point = 10.0 ** -digits
            pip = point * 10 if digits in (3, 5) else point
            out[sym] = SymbolArrays.from_m1(sym, self.m1[sym], costs, pip, point)
        return out

    def trade_paths(self, costs: CostModel) -> dict[str, TradePath]:
        arrays = self.arrays(costs)
        self._arrays = arrays
        paths = {}
        for r in self.signals.itertuples(index=False):
            a = arrays[r.symbol]
            ts = pd.Timestamp(r.time).value
            i0 = a.index_at_or_after(ts)
            if i0 >= len(a.t) or a.t[i0] - ts > 5 * 60 * NS:
                continue
            p = simulate_trade(a, i0, r.side, r.sl, self.exits, costs, r.atr_e)
            if p is not None:
                paths[r.key] = p
        return paths

    @property
    def signals(self) -> pd.DataFrame:
        if self._signals is None:
            self.prepare()
        return self._signals  # type: ignore[return-value]

    # ------------------------------------------------------------------ helpers
    def _price_at(self, sym: str, ts: int) -> float:
        a = self._arrays[sym]
        i = int(np.searchsorted(a.t, ts, side="right")) - 1
        return float(a.c[max(i, 0)])

    def _prices(self, ts: int) -> dict[str, float]:
        return {s: self._price_at(s, ts) for s in self.symbols}

    def _spec(self, sym: str, prices: dict[str, float]) -> SymbolSpec:
        base, quote, digits = KNOWN_MAJORS[sym]
        return default_sim_spec(sym, base, quote, digits, self.cfg.account_currency, prices)

    def _vpu(self, sym: str, prices: np.ndarray) -> np.ndarray:
        base, quote, _ = KNOWN_MAJORS[sym]
        acc = self.cfg.account_currency
        if quote == acc:
            return np.full(len(prices), CONTRACT)
        if base == acc:
            return CONTRACT / prices
        raise NotImplementedError(f"backtest supports pairs quoted in or based on {acc} only ({sym})")

    def _correlations(self, ts: int) -> dict[tuple[str, str], float] | None:
        if not self.use_correlation or self._h1_close is None or len(self.symbols) < 2:
            return None
        end = pd.Timestamp(ts, tz=UTC).normalize()
        cache = getattr(self, "_corr_cache", {})
        self._corr_cache = cache
        if end not in cache:
            win = self._h1_close[(self._h1_close.index <= end) & (self._h1_close.index > end - pd.Timedelta(days=30))]
            rets = np.log(win).diff().dropna(how="all")
            if len(rets) < 200:
                cache[end] = None
            else:
                c = rets.corr()
                cache[end] = {(a, b): float(c.loc[a, b]) for a in c.index for b in c.columns
                              if a != b and pd.notna(c.loc[a, b])}
        return cache[end]

    def _open(self, ticket: int, key: str, path: TradePath, volume: float, planned_risk: float,
              costs: CostModel, signal: dict) -> OpenTrade:
        a = self._arrays[path.symbol]
        sl = slice(path.i_entry, path.i_exit + 1)
        tt = a.t[sl]
        vpu = self._vpu(path.symbol, a.c[sl])
        commission = costs.commission_per_lot_rt * volume
        swap_cum = np.cumsum(a.rollover[sl] * costs.swap_pips_per_night * costs.swap_multiplier
                             * a.pip_size * vpu * volume)
        swap_cum[0] = 0.0 if a.rollover[path.i_entry] == 0 else swap_cum[0]
        val = path.mtm * vpu * volume - commission + swap_cum
        return OpenTrade(ticket, key, path, volume, planned_risk, tt, val, commission, swap_cum, vpu, signal)

    def _force_close(self, ot: OpenTrade, ts: int, costs: CostModel, reason: str) -> None:
        a = self._arrays[ot.path.symbol]
        k = int(np.searchsorted(ot.tt, ts, side="right")) - 1
        k = max(0, min(k, len(ot.tt) - 1))
        i = ot.path.i_entry + k
        bo, bh, bl, bc, ao, ah, al, ac = a.bid_ask(i)
        slip = costs.stop_slip(a.pip_size)
        px = (bc - slip) if ot.path.side > 0 else (ac + slip)
        p = ot.path
        mtm = p.mtm[: k + 1].copy()
        mtm[-1] = (px - p.entry) * p.side
        p.mtm, p.exit, p.i_exit, p.t_exit, p.reason = mtm, float(px), i, int(a.t[i]), reason
        ot.tt, ot.vpu, ot.swap_cum = ot.tt[: k + 1], ot.vpu[: k + 1], ot.swap_cum[: k + 1]
        ot.val = mtm * ot.vpu * ot.volume - ot.commission + ot.swap_cum

    # ------------------------------------------------------------------ main loop
    def run(self, costs: CostModel | None = None, paths: dict[str, TradePath] | None = None,
            allowed_keys: set[str] | None = None, start: pd.Timestamp | None = None,
            end: pd.Timestamp | None = None, label: str = "baseline") -> BacktestResult:
        costs = costs or self.costs
        paths = paths if paths is not None else self.trade_paths(costs)
        if not self._arrays:
            self._arrays = self.arrays(costs)
        cfg = self.cfg
        engine = RiskEngine(cfg.risk)
        limits = EffectiveLimits.combine(cfg.risk, cfg.hard_limits)
        max_spread = {s: (self.info[s].max_spread_points if s in self.info else 30) for s in self.symbols}
        sigs = self.signals
        if start is not None:
            sigs = sigs[sigs["time"] >= start]
        if end is not None:
            sigs = sigs[sigs["time"] < end]
        sigs = sigs[sigs["key"].isin(paths.keys())]
        if allowed_keys is not None:
            ml_skipped = int((~sigs["key"].isin(allowed_keys)).sum())
            sigs = sigs[sigs["key"].isin(allowed_keys)]
        else:
            ml_skipped = 0

        t0 = pd.Timestamp(start) if start is not None else min(pd.Timestamp(self._arrays[s].t[0], tz=UTC) for s in self.symbols)
        t1 = pd.Timestamp(end) if end is not None else max(pd.Timestamp(self._arrays[s].t[-1], tz=UTC) for s in self.symbols)
        # Trading-day boundaries: 17:00 New York (the conventional FX day; matches
        # brokers whose server time is NY-close aligned).
        ny0 = t0.tz_convert("America/New_York").normalize() - pd.Timedelta(days=1)
        days = pd.date_range(ny0, t1.tz_convert("America/New_York") + pd.Timedelta(days=1), freq="D")
        bounds = [(d + pd.Timedelta(hours=17)).tz_convert(UTC) for d in days]
        bounds = [b for b in bounds if t0 - pd.Timedelta(days=1) <= b <= t1]

        events: list[tuple[int, int, object]] = [(b.value, 0, None) for b in bounds]
        events += [(pd.Timestamp(r.time).value, 1, r) for r in sigs.itertuples(index=False)]
        events.sort(key=lambda e: (e[0], e[1]))

        balance = self.initial_balance
        st = RiskState()
        open_trades: list[OpenTrade] = []
        closed: list[dict] = []
        rejections: dict[str, int] = {}
        halts: list[dict] = []
        eq_points_t: list[np.ndarray] = []
        eq_points_v: list[np.ndarray] = []
        peak = balance
        max_dd = 0.0
        max_dd_pct = 0.0
        last_t = events[0][0] if events else 0
        ticket = 0
        day_rows: list[dict] = []
        day_entries = 0
        considered = 0

        def realize(ot: OpenTrade) -> None:
            nonlocal balance
            net = float(ot.val[-1])
            balance += net
            p = ot.path
            a = self._arrays[p.symbol]
            vpu_e, vpu_x = float(ot.vpu[0]), float(ot.vpu[-1])
            spread_cost = (p.entry_spread / 2 * vpu_e + p.exit_spread / 2 * vpu_x) * ot.volume
            slip = costs.entry_slip(a.pip_size) * vpu_e * ot.volume
            if p.reason not in ("tp",):
                slip += costs.stop_slip(a.pip_size) * vpu_x * ot.volume
            closed.append({
                "ticket": ot.ticket, "key": ot.key, "symbol": p.symbol, "side": "BUY" if p.side > 0 else "SELL",
                "entry_time": pd.Timestamp(p.t_entry, tz=UTC), "exit_time": pd.Timestamp(p.t_exit, tz=UTC),
                "entry": p.entry, "exit": p.exit, "sl": p.initial_sl, "tp": p.tp, "volume": ot.volume,
                "planned_risk": ot.planned_risk, "gross": float(p.mtm[-1] * ot.vpu[-1] * ot.volume),
                "commission": -ot.commission, "swap": float(ot.swap_cum[-1]), "net": net,
                "r_multiple": net / ot.planned_risk if ot.planned_risk > 0 else 0.0,
                "reason": p.reason, "ambiguous_bars": p.ambiguous_bars, "mfe_r": p.mfe_r, "mae_r": p.mae_r,
                "spread_cost": spread_cost, "slippage_cost": slip,
                "hold_hours": (p.t_exit - p.t_entry) / 3600e9, "regime": ot.signal.get("regime"),
            })
            st.record_closed_trade(ot.ticket, p.symbol, net, from_epoch(p.t_exit / NS),
                                   cfg.risk.max_consecutive_losses, cfg.risk.consecutive_loss_pause_min)

        def process_interval(ta: int, tb: int) -> None:
            nonlocal peak, max_dd, max_dd_pct
            if not open_trades:
                eq_points_t.append(np.array([tb])); eq_points_v.append(np.array([balance]))
                peak = max(peak, balance)
                return
            grids = [ot.tt[(ot.tt > ta) & (ot.tt <= tb)] for ot in open_trades]
            grid = np.unique(np.concatenate(grids + [np.array([tb])]))
            vals = np.zeros(len(grid))
            for ot in open_trades:
                vals += ot.value_at(grid)
            eq = balance + vals
            # daily-loss detection (latched)
            if not st.daily_loss_handled and st.day_start_equity > 0:
                loss = np.maximum(0.0, -(eq - st.day_start_equity - st.net_flows_today)) / st.day_start_equity * 100
                hit = np.flatnonzero(loss >= limits.max_daily_loss_pct)
                if hit.size:
                    tb_hit = int(grid[hit[0]])
                    st.daily_loss_halt = True
                    st.daily_loss_handled = True
                    st.halt_reason = f"daily loss {loss[hit[0]]:.2f}%"
                    halts.append({"time": pd.Timestamp(tb_hit, tz=UTC), "loss_pct": float(loss[hit[0]]),
                                  "policy": cfg.risk.daily_loss_policy})
                    if cfg.risk.daily_loss_policy == "close_all":
                        for ot in open_trades:
                            if ot.t_exit > tb_hit:
                                self._force_close(ot, tb_hit, costs, "daily_loss_close")
                        vals = np.zeros(len(grid))
                        for ot in open_trades:
                            vals += ot.value_at(grid)
                        eq = balance + vals
            run_peak = np.maximum.accumulate(np.r_[peak, eq])[1:]
            dd = run_peak - eq
            j = int(np.argmax(dd))
            if dd[j] > max_dd:
                max_dd = float(dd[j])
            dd_pct = dd / run_peak
            max_dd_pct = max(max_dd_pct, float(dd_pct.max()))
            peak = float(run_peak[-1])
            eq_points_t.append(grid); eq_points_v.append(eq)
            # realize trades that closed in the interval, in exit order
            done = sorted([ot for ot in open_trades if ot.t_exit <= tb], key=lambda o: o.t_exit)
            for ot in done:
                realize(ot)
                open_trades.remove(ot)

        def equity_at(ts: int) -> float:
            return balance + sum(float(ot.value_at(np.array([ts]))[0]) for ot in open_trades)

        for ts, kind, payload in events:
            process_interval(last_t, ts)
            last_t = ts
            now = from_epoch(ts / NS)
            if kind == 0:
                eq = equity_at(ts)
                if st.day_id:
                    day_rows.append({"day": st.day_id, "start_equity": st.day_start_equity, "end_equity": eq,
                                     "entries": st.entries_today, "halted": st.daily_loss_halt})
                ny = pd.Timestamp(ts, tz=UTC).tz_convert("America/New_York")
                st.roll_if_needed((ny - pd.Timedelta(hours=17)).date().isoformat(), eq)
                continue
            r = payload
            considered += 1
            path = paths[r.key]
            sym = r.symbol
            a = self._arrays[sym]
            prices = self._prices(ts)
            specs = {s: self._spec(s, prices) for s in self.symbols}
            bo, _, _, _, ao, _, _, _ = a.bid_ask(path.i_entry)
            q = {s: Quote(s, prices[s] - a.spread[path.i_entry] / 2, prices[s] + a.spread[path.i_entry] / 2, now)
                 for s in self.symbols}
            q[sym] = Quote(sym, bo, ao, now)
            positions = [Position(ticket=ot.ticket, symbol=ot.path.symbol, side=Side.from_sign(ot.path.side),
                                  volume=ot.volume, open_price=ot.path.entry,
                                  open_time_utc=from_epoch(ot.path.t_entry / NS), sl=ot.path.sl_at(ts),
                                  tp=ot.path.tp) for ot in open_trades]
            margin = sum(ot.volume * specs[ot.path.symbol].margin_per_lot for ot in open_trades)
            eq = equity_at(ts)
            acct = AccountSnapshot(login=0, currency=cfg.account_currency, balance=balance, equity=eq,
                                   margin=margin, free_margin=eq - margin)
            side = Side.from_sign(r.side)
            entry_ref = ao if side is Side.BUY else bo
            intent = TradeIntent(signal_id=r.key, symbol=sym, side=side, entry_price=entry_ref, stop_loss=r.sl,
                                 take_profit=path.tp, strategy=self.strategy.name,
                                 strategy_version=self.strategy.version, bar_time_utc=now, created_utc=now)
            ctx = RiskContext(account=acct, positions=positions, specs=specs, quotes=q, state=st, now=now,
                              limits=limits, max_spread_points=max_spread,
                              correlations=self._correlations(ts))
            dec = engine.evaluate(intent, ctx)
            if not dec.approved:
                for c in dec.checks:
                    if not c.passed:
                        rejections[c.name] = rejections.get(c.name, 0) + 1
                continue
            ticket += 1
            ot = self._open(ticket, r.key, _copy_path(path), dec.volume, dec.planned_risk_money, costs, r._asdict())
            open_trades.append(ot)
            st.record_entry(sym, now)

        process_interval(last_t, int(t1.value))
        for ot in sorted(open_trades, key=lambda o: o.t_exit):
            realize(ot)
        open_trades.clear()

        trades = pd.DataFrame(closed)
        eq_t = np.concatenate(eq_points_t) if eq_points_t else np.array([], dtype=np.int64)
        eq_v = np.concatenate(eq_points_v) if eq_points_v else np.array([])
        eq = pd.Series(eq_v, index=pd.to_datetime(eq_t, utc=True)).sort_index()
        eq = eq[~eq.index.duplicated(keep="last")]
        eq_h = eq.resample("1h").last().ffill()
        daily = pd.DataFrame(day_rows)
        if ml_skipped:
            rejections["ml_filter"] = ml_skipped
        from .metrics import compute_stats
        stats = compute_stats(trades, eq_h, self.initial_balance, t0, t1, max_dd, max_dd_pct, daily)
        stats["label"] = label
        stats["daily_loss_halts"] = len(halts)
        params = {"strategy": self.strategy.full_version, "costs": costs.describe(),
                  "risk": cfg.risk.model_dump(), "exits": cfg.exits.model_dump(),
                  "strategy_params": cfg.strategy.params.model_dump(), "symbols": self.symbols,
                  "initial_balance": self.initial_balance, "period": [str(t0), str(t1)]}
        return BacktestResult(trades, eq_h, daily, rejections, stats, params, considered + ml_skipped, halts)


def _copy_path(p: TradePath) -> TradePath:
    return TradePath(**{**p.__dict__, "mtm": p.mtm.copy(), "sl_changes": list(p.sl_changes)})
