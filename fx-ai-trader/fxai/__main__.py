"""Command line: python -m fxai <command> [options]

  hash-password           print a scrypt hash for FXAI_DASHBOARD_PASSWORD_HASH
  gen-secret              print a random FXAI_SECRET_KEY
  service                 run the live/demo trading service (needs the EA running)
  dashboard               run the web dashboard (127.0.0.1:8787 by default)
  paper                   paper-trade on historical data: EA emulator + simulated broker
  backtest                portfolio backtest on historical data
  validate                full validation protocol -> reports/validation/<ts>/REPORT.md
  model train|approve|list
  estop [--policy]        write the emergency-stop flag for the EA directly
  doctor [--json]         deployment diagnostics (safe, read-only; paste the output when asking for help)
  status                  print the latest status snapshot
"""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import secrets
import signal
import sys
import time
from pathlib import Path

import pandas as pd


def _cfg(args):
    from .config import load_config, load_dotenv
    load_dotenv(getattr(args, "env", ".env"))
    return load_config(args.config)


def _load_data(args, symbols: list[str]) -> tuple[dict[str, pd.DataFrame], str]:
    from .backtest.data import load_generic_csv, load_mt4_export, load_oanda_m1
    years = range(args.start_year, args.end_year + 1)
    m1 = {}
    if args.data_format == "oanda":
        for s in symbols:
            try:
                m1[s] = load_oanda_m1(args.data_root, s, years, cache_dir="data/cache")
            except (FileNotFoundError, KeyError) as e:
                print(f"skip {s}: {e}", file=sys.stderr)
        desc = (f"Oanda M1 mid prices, public mirror github.com/FutureSharks/financial-data "
                f"({args.start_year}-{args.end_year}, data ends 2020-05-14)")
    else:
        for s in symbols:
            p = Path(args.data_root) / f"{s}.csv"
            if not p.is_file():
                print(f"skip {s}: {p} not found", file=sys.stderr)
                continue
            m1[s] = (load_mt4_export(p, args.server_offset) if args.data_format == "mt4"
                     else load_generic_csv(p))
        desc = f"{args.data_format} CSV files from {args.data_root}"
    if not m1:
        raise SystemExit("no data loaded")
    return m1, desc


def cmd_hash_password(args) -> None:
    from .dashboard.auth import hash_password
    pw = getpass.getpass("New dashboard password (min 12 chars): ")
    if pw != getpass.getpass("Repeat: "):
        raise SystemExit("passwords differ")
    print(hash_password(pw))


def cmd_gen_secret(args) -> None:
    print(secrets.token_urlsafe(48))


def cmd_service(args) -> None:
    from .bridge.file_bridge import FileBridge
    from .config import resolve_bridge_dir
    from .service import TradingService
    from .storage import Storage
    cfg = _cfg(args)
    if cfg.mode == "paper":
        raise SystemExit("mode=paper: use `python -m fxai paper` instead")
    if cfg.mode == "live":
        if not cfg.live_trading_acknowledged:
            raise SystemExit("mode=live requires live_trading_acknowledged: true (see docs/DEMO_AND_LIVE.md)")
        vs = Path("reports/validation_status.json")
        status = json.loads(vs.read_text()) if vs.is_file() else {}
        if not status.get("passed"):
            raise SystemExit("live mode refused: reports/validation_status.json does not record a passed validation "
                             "and demo forward test for this strategy version (docs/DEMO_AND_LIVE.md)")
    root = resolve_bridge_dir(cfg.bridge)
    st = Storage(cfg.storage.db_path)
    svc = TradingService(cfg, st, FileBridge(root, cfg.bridge.magic_number))
    stop = {"flag": False}
    signal.signal(signal.SIGINT, lambda *_: stop.__setitem__("flag", True))
    print(f"fxai service running (mode={cfg.mode}, bridge={root}); Ctrl+C to stop. Protection continues in the EA.")
    svc.run_forever(lambda: stop["flag"])


def cmd_dashboard(args) -> None:
    import uvicorn
    from .dashboard.app import create_app
    from .storage import Storage
    cfg = _cfg(args)
    app = create_app(cfg, Storage(cfg.storage.db_path))
    if cfg.dashboard.host not in ("127.0.0.1", "localhost", "::1"):
        print("WARNING: dashboard bound to a non-loopback address; use HTTPS (reverse proxy) and a firewall.")
    uvicorn.run(app, host=cfg.dashboard.host, port=cfg.dashboard.port, log_level="warning")


def cmd_paper(args) -> None:
    """Paper trading on historical data through the REAL file bridge and service code."""
    from .backtest.costs import CostModel
    from .bridge.ea_emulator import EAEmulator, EAInputs
    from .bridge.file_bridge import FileBridge
    from .execution.sim_broker import SimBroker
    from .service import TradingService
    from .storage import Storage
    from .symbols import KNOWN_MAJORS, default_sim_spec
    cfg = _cfg(args)
    m1, desc = _load_data(args, list(cfg.symbols.enabled))
    start = pd.Timestamp(args.start, tz="UTC")
    end = pd.Timestamp(args.end, tz="UTC") if args.end else start + pd.Timedelta(days=args.days)
    root = Path(args.bridge_dir) / "900001"
    costs = CostModel()
    prices = {s: float(df["close"][df.index < start].iloc[-1]) for s, df in m1.items()}
    specs = {s: default_sim_spec(s, *KNOWN_MAJORS[s], cfg.account_currency, prices) for s in m1}
    broker = SimBroker(specs=specs, balance=args.balance)
    from .strategy import build_strategy
    _s = build_strategy(cfg)
    tfs = sorted({_s.entry_tf, _s.trend_tf})
    ea = EAEmulator(root, broker, EAInputs(enable_trading=True, symbols=list(m1), bars_timeframes=tfs,
                                           magic=cfg.bridge.magic_number), m1=m1)
    now = {"t": start.to_pydatetime()}
    clock = lambda: now["t"]  # noqa: E731
    st = Storage(cfg.storage.db_path)
    svc = TradingService(cfg, st, FileBridge(root, cfg.bridge.magic_number, clock=clock), clock=clock)
    print(f"paper trading {start} -> {end} on {desc}; bridge dir {root}; db {cfg.storage.db_path}")
    t = start
    steps = 0
    while t < end:
        for s, df in m1.items():
            i = df.index.searchsorted(t, side="left") - 1  # last M1 bar that has CLOSED by time t
            if i < 0:
                continue
            mid = float(df["close"].iloc[i])
            pip = specs[s].pip_size
            half = costs.spread_pips[s] * pip / 2
            broker.set_quote(s, round(mid - half, specs[s].digits), round(mid + half, specs[s].digits),
                             df.index[i].to_pydatetime() + pd.Timedelta(seconds=59))
        now["t"] = t.to_pydatetime() + pd.Timedelta(seconds=2)
        ea.step(now["t"])
        svc.step()
        # The real EA polls every ~0.5 s: give it a turn one second later so commands the
        # service just wrote are executed (and their results read) within their TTL.
        now["t"] += pd.Timedelta(seconds=1)
        ea.step(now["t"])
        svc.step()
        steps += 1
        if args.realtime:
            time.sleep(args.step_seconds / max(args.speed, 1e-6))
        t += pd.Timedelta(seconds=args.step_seconds)
        if steps % 1440 == 0:
            print(f"{t:%Y-%m-%d %H:%M}  equity {broker.equity:,.2f}  open {len(broker.orders)}  closed "
                  f"{len([h for h in broker.history if h.type <= 1])}")
    print(f"done: equity {broker.equity:,.2f} (start {args.balance:,.2f}); "
          f"{len([h for h in broker.history if h.type <= 1])} closed trades. Inspect with `python -m fxai dashboard`.")


def cmd_backtest(args) -> None:
    from .backtest.costs import CostModel
    from .backtest.engine import PortfolioBacktest
    cfg = _cfg(args)
    m1, desc = _load_data(args, list(cfg.symbols.enabled))
    bt = PortfolioBacktest(cfg, m1, CostModel().scaled(spread=args.spread_mult, slippage=args.slippage_mult))
    bt.prepare()
    res = bt.run(start=pd.Timestamp(args.start, tz="UTC") if args.start else None,
                 end=pd.Timestamp(args.end, tz="UTC") if args.end else None)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    res.trades.to_csv(out / "trades.csv", index=False)
    res.equity_hourly.to_csv(out / "equity_hourly.csv")
    (out / "stats.json").write_text(json.dumps({"data": desc, "stats": res.stats, "rejections": res.rejections,
                                                "params": res.params}, indent=2, default=str))
    print(json.dumps({k: v for k, v in res.stats.items() if k not in ("by_symbol", "yearly_net", "costs")},
                     indent=1, default=str))
    print(f"written to {out}")


def cmd_validate(args) -> None:
    from .backtest.validation import run_validation
    from .config import AppConfig
    cfg = AppConfig()
    m1, desc = _load_data(args, [s for s in cfg.symbols.enabled])
    out = run_validation(m1, args.out, desc)
    print(f"report: {out / 'REPORT.md'}")


def cmd_model(args) -> None:
    from .backtest.costs import CostModel
    from .backtest.engine import PortfolioBacktest
    from .ml import ModelRegistry
    from .ml.dataset import build_dataset
    from .ml.train import evaluate, train_final, walk_forward
    from .storage import Storage
    cfg = _cfg(args)
    st = Storage(cfg.storage.db_path)
    reg = ModelRegistry(cfg.ml.registry_dir, st)
    if args.action == "list":
        for m in st.models():
            print(m)
        return
    if args.action == "approve":
        try:
            p = reg.approve(args.version, getpass.getuser())
        except (PermissionError, ValueError) as e:
            raise SystemExit(f"refused: {e}")
        print(f"approved {args.version} -> {p}. Set ml.enabled: true to use it (restart the service).")
        return
    m1, desc = _load_data(args, list(cfg.symbols.enabled))
    costs = CostModel()
    bt = PortfolioBacktest(cfg, m1, costs)
    sig = bt.prepare()
    paths = bt.trade_paths(costs)
    ds = build_dataset(sig, paths, costs)
    folds, oos = walk_forward(ds, pd.Timestamp(args.first_test, tz="UTC"), strategy_version=bt.strategy.full_version)
    rep = evaluate(folds, oos)
    model = train_final(ds, rep, bt.strategy.full_version, desc)
    path, sha = reg.save_candidate(model, rep)
    print(json.dumps({k: v for k, v in rep.items() if k not in ("folds", "calibration")}, indent=1))
    print(f"candidate {model.version} saved to {path} (sha256 {sha[:16]}...). "
          f"{'Approvable' if rep['approvable'] else 'NOT approvable - gates failed'}.")


def cmd_estop(args) -> None:
    from .bridge.file_bridge import FileBridge
    from .config import resolve_bridge_dir
    cfg = _cfg(args)
    b = FileBridge(resolve_bridge_dir(cfg.bridge), cfg.bridge.magic_number)
    b.set_estop_flag(args.policy, getpass.getuser())
    print(f"estop.flag written (policy {args.policy}). The EA acts on it within ~1 s. "
          "To clear: delete the flag via the dashboard 'Clear emergency stop' (requires typing CLEAR).")


def cmd_doctor(args) -> None:
    from .doctor import as_dicts, format_report, run_doctor
    cfg = _cfg(args)
    checks = run_doctor(cfg)
    print(json.dumps(as_dicts(checks), indent=1) if args.json else format_report(checks))
    if any(c.status == "FAIL" for c in checks):
        raise SystemExit(1)


def cmd_status(args) -> None:
    from .storage import Storage
    cfg = _cfg(args)
    print(json.dumps(Storage(cfg.storage.db_path).read_status(), indent=1, default=str))


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="fxai", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--config", default=None, help="config YAML (default: $FXAI_CONFIG or config/config.yaml)")
    p.add_argument("--env", default=".env", help="optional .env file with secrets")
    sub = p.add_subparsers(dest="cmd", required=True)

    def data_args(sp):
        sp.add_argument("--data-root", required=True)
        sp.add_argument("--data-format", choices=["oanda", "mt4", "csv"], default="oanda")
        sp.add_argument("--server-offset", type=float, default=2.0, help="MT4 export: server UTC offset hours")
        sp.add_argument("--start-year", type=int, default=2015)
        sp.add_argument("--end-year", type=int, default=2020)

    sub.add_parser("hash-password").set_defaults(fn=cmd_hash_password)
    sub.add_parser("gen-secret").set_defaults(fn=cmd_gen_secret)
    sub.add_parser("service").set_defaults(fn=cmd_service)
    sub.add_parser("dashboard").set_defaults(fn=cmd_dashboard)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sp = sub.add_parser("doctor")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(fn=cmd_doctor)
    sp = sub.add_parser("paper")
    data_args(sp)
    sp.add_argument("--start", required=True)
    sp.add_argument("--end")
    sp.add_argument("--days", type=int, default=30)
    sp.add_argument("--balance", type=float, default=10_000.0)
    sp.add_argument("--step-seconds", type=int, default=60)
    sp.add_argument("--realtime", action="store_true", help="sleep between steps (with --speed)")
    sp.add_argument("--speed", type=float, default=60.0)
    sp.add_argument("--bridge-dir", default="data/paper_bridge")
    sp.set_defaults(fn=cmd_paper)
    sp = sub.add_parser("backtest")
    data_args(sp)
    sp.add_argument("--start")
    sp.add_argument("--end")
    sp.add_argument("--spread-mult", type=float, default=1.0)
    sp.add_argument("--slippage-mult", type=float, default=1.0)
    sp.add_argument("--out", default="reports/backtest")
    sp.set_defaults(fn=cmd_backtest)
    sp = sub.add_parser("validate")
    data_args(sp)
    sp.add_argument("--out", default="reports/validation")
    sp.set_defaults(fn=cmd_validate)
    sp = sub.add_parser("model")
    sp.add_argument("action", choices=["train", "approve", "list"])
    sp.add_argument("version", nargs="?")
    sp.add_argument("--data-root")
    sp.add_argument("--data-format", choices=["oanda", "mt4", "csv"], default="oanda")
    sp.add_argument("--server-offset", type=float, default=2.0)
    sp.add_argument("--start-year", type=int, default=2015)
    sp.add_argument("--end-year", type=int, default=2020)
    sp.add_argument("--first-test", default="2016-07-01")
    sp.set_defaults(fn=cmd_model)
    sp = sub.add_parser("estop")
    sp.add_argument("--policy", choices=["close_all", "hold"], default="close_all")
    sp.set_defaults(fn=cmd_estop)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
