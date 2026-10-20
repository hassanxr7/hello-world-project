"""Configuration loading and validation.

Non-secret settings live in a YAML file (see config/config.example.yaml).
Secrets are read ONLY from environment variables (or a local .env file that is
git-ignored) and are never written to the database, logs or the dashboard.

Every risk value has a validated range. ``hard_limits`` bounds what the
dashboard may change at runtime; the EA's own inputs cap everything again.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .symbols import DEFAULT_MAX_SPREAD_POINTS, DEFAULT_SESSIONS_UTC, KNOWN_MAJORS, SymbolInfo, broker_name_for

_HOURS_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-4]):([0-5]\d)$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SymbolOverride(_Strict):
    broker_name: str | None = None
    max_spread_points: int | None = Field(default=None, ge=1, le=500)
    trading_hours_utc: str | None = None

    @field_validator("trading_hours_utc")
    @classmethod
    def _hours(cls, v: str | None) -> str | None:
        if v is not None and not _HOURS_RE.match(v):
            raise ValueError("trading_hours_utc must look like 07:00-20:00")
        return v


class CustomSymbol(_Strict):
    """Explicit definition required for anything that is not one of the 7 majors."""

    base: str = Field(min_length=3, max_length=3)
    quote: str = Field(min_length=3, max_length=3)
    digits: int = Field(ge=0, le=8)
    max_spread_points: int = Field(ge=1, le=5000)
    trading_hours_utc: str = "07:00-20:00"
    broker_name: str | None = None


class SymbolsConfig(_Strict):
    enabled: list[str] = Field(default_factory=lambda: list(KNOWN_MAJORS))
    prefix: str = ""
    suffix: str = ""
    overrides: dict[str, SymbolOverride] = Field(default_factory=dict)
    custom: dict[str, CustomSymbol] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _known(self) -> "SymbolsConfig":
        for s in self.enabled:
            if s not in KNOWN_MAJORS and s not in self.custom:
                raise ValueError(
                    f"symbol {s!r} is not a built-in major; define it explicitly under symbols.custom"
                )
        return self

    def resolve(self) -> dict[str, SymbolInfo]:
        out: dict[str, SymbolInfo] = {}
        for s in self.enabled:
            ov = self.overrides.get(s, SymbolOverride())
            if s in KNOWN_MAJORS:
                base, quote, digits = KNOWN_MAJORS[s]
                hours = ov.trading_hours_utc or DEFAULT_SESSIONS_UTC[s]
                spread = ov.max_spread_points or DEFAULT_MAX_SPREAD_POINTS[s]
                bname = broker_name_for(s, self.prefix, self.suffix, ov.broker_name)
            else:
                c = self.custom[s]
                base, quote, digits = c.base, c.quote, c.digits
                hours = ov.trading_hours_utc or c.trading_hours_utc
                spread = ov.max_spread_points or c.max_spread_points
                bname = broker_name_for(s, self.prefix, self.suffix, ov.broker_name or c.broker_name)
            out[s] = SymbolInfo(s, bname, base, quote, digits, hours, spread)
        return out


class DailyResetConfig(_Strict):
    zone: Literal["server", "UTC", "America/New_York", "Europe/London"] = "server"
    hour: int = Field(default=0, ge=0, le=23)


class BridgeConfig(_Strict):
    type: Literal["file"] = "file"
    root: str = "auto"  # <Terminal Common>/Files/FXAI ; "auto" resolves %APPDATA% on Windows
    account: str = "auto"  # account login sub-folder; auto = the single folder present
    poll_interval_s: float = Field(default=1.0, ge=0.2, le=10)
    ea_heartbeat_timeout_s: float = Field(default=10, ge=2, le=120)
    command_ttl_s: int = Field(default=15, ge=3, le=120)
    ack_timeout_s: int = Field(default=20, ge=5, le=300)
    magic_number: int = Field(default=7340001, ge=1, le=2_147_483_647)


class RiskConfig(_Strict):
    risk_per_trade_pct: float = Field(default=0.25, gt=0, le=2.0)
    max_total_risk_pct: float = Field(default=1.0, gt=0, le=5.0)
    max_open_positions: int = Field(default=3, ge=1, le=20)
    max_positions_per_symbol: Literal[1] = 1
    max_daily_loss_pct: float = Field(default=2.0, gt=0, le=10.0)
    max_entries_per_day: int = Field(default=20, ge=0, le=20)
    max_currency_risk_pct: float = Field(default=0.5, gt=0, le=5.0)
    correlation_threshold: float = Field(default=0.75, gt=0, le=1.0)
    max_correlated_positions: int = Field(default=2, ge=1, le=20)
    max_margin_usage_pct: float = Field(default=30.0, gt=0, le=100)
    min_margin_level_pct: float = Field(default=300.0, ge=100)
    cooldown_after_entry_min: int = Field(default=30, ge=0)
    cooldown_after_loss_min: int = Field(default=60, ge=0)
    max_consecutive_losses: int = Field(default=3, ge=1)
    consecutive_loss_pause_min: int = Field(default=240, ge=0)
    daily_loss_headroom_check: bool = True
    daily_loss_policy: Literal["hold_protected", "close_all"] = "hold_protected"
    emergency_stop_policy: Literal["close_all", "hold_protected"] = "close_all"
    max_quote_age_s: float = Field(default=30.0, gt=0)
    max_spread_to_stop: float = Field(default=0.15, gt=0, le=1.0)
    commission_per_lot_round_turn: float = Field(default=7.0, ge=0)
    sizing_slippage_points: float = Field(default=5.0, ge=0)
    max_lot_per_trade: float = Field(default=5.0, gt=0)
    max_entry_deviation_points: int = Field(default=20, ge=0)
    max_slippage_points: int = Field(default=10, ge=0)

    @model_validator(mode="after")
    def _coherent(self) -> "RiskConfig":
        if self.risk_per_trade_pct > self.max_total_risk_pct:
            raise ValueError("risk_per_trade_pct cannot exceed max_total_risk_pct")
        if self.max_total_risk_pct > self.max_daily_loss_pct and self.daily_loss_headroom_check:
            # Allowed, but the headroom check will then be the binding limit.
            pass
        return self


class HardLimits(_Strict):
    """Upper bounds for runtime (dashboard) edits. The config file is the only place
    these can be raised, and the EA inputs cap them again."""

    risk_per_trade_pct: float = Field(default=0.5, gt=0, le=2.0)
    max_total_risk_pct: float = Field(default=2.0, gt=0, le=5.0)
    max_open_positions: int = Field(default=5, ge=1, le=20)
    max_daily_loss_pct: float = Field(default=3.0, gt=0, le=10.0)
    max_entries_per_day: int = Field(default=20, ge=0, le=20)


class StrategyParams(_Strict):
    atr_period: int = 14
    adx_period: int = 14
    adx_min: float = 20.0
    ema_fast: int = 50  # trend timeframe
    ema_slow: int = 200  # trend timeframe
    ema_slope_bars: int = 5
    vol_ratio_max: float = 2.0
    vol_median_window: int = 500
    ema_entry: int = 20
    pullback_lookback: int = 6
    pullback_atr_tol: float = 0.25
    rsi_period: int = 14
    rsi_long_min: float = 50.0
    rsi_long_max: float = 70.0
    max_extension_atr: float = 1.0
    stop_buffer_atr: float = 0.2
    min_stop_atr: float = 1.0
    max_stop_atr: float = 2.5
    min_room_r: float = 1.0
    swing_lookback_bars: int = 200  # trend-timeframe bars
    fractal_n: int = 3
    friday_cutoff_utc: str = "18:00"


class StrategyConfig(_Strict):
    name: Literal["trend_pullback"] = "trend_pullback"
    # Default H1/H4 chosen by the pre-declared protocol in docs/RESEARCH_LOG.md
    # (it was the less-bad variant; NEITHER variant showed a positive edge).
    decision_timeframe: Literal["M15", "M30", "H1"] = "H1"
    trend_timeframe: Literal["H1", "H4"] = "H4"
    signal_ttl_s: int = Field(default=90, ge=10, le=900)
    params: StrategyParams = Field(default_factory=StrategyParams)

    @model_validator(mode="after")
    def _tf_order(self) -> "StrategyConfig":
        mins = {"M15": 15, "M30": 30, "H1": 60, "H4": 240}
        if mins[self.trend_timeframe] <= mins[self.decision_timeframe]:
            raise ValueError("trend_timeframe must be higher than decision_timeframe")
        return self


class ExitConfig(_Strict):
    take_profit_r: float = Field(default=2.0, gt=0.2, le=10)
    breakeven_enabled: bool = True
    breakeven_trigger_r: float = Field(default=1.0, gt=0)
    breakeven_offset_points: int = Field(default=10, ge=0)
    trailing_enabled: bool = False
    trailing_start_r: float = Field(default=1.5, gt=0)
    trailing_atr_mult: float = Field(default=2.0, gt=0)
    max_hold_hours: float = Field(default=48, gt=0)


class MLConfig(_Strict):
    """The meta-filter can only REMOVE baseline signals. Only a model approved via
    ``python -m fxai model approve`` (all walk-forward gates passed) is loaded."""

    enabled: bool = False
    registry_dir: str = "models"


class LLMConfig(_Strict):
    """Optional language-model review of candidate trades. It can only add an
    explanation ("advisory") or turn a BUY/SELL into WAIT ("veto"); it can never
    create a trade, change size, stops or limits, and it never sees credentials."""

    mode: Literal["off", "advisory", "veto"] = "off"
    provider: Literal["anthropic"] = "anthropic"
    model: str = "claude-opus-5-5"
    effort: Literal["low", "medium", "high"] = "medium"
    timeout_s: float = Field(default=20.0, gt=0, le=120)
    max_calls_per_day: int = Field(default=40, ge=0, le=2000)
    max_cost_usd_per_day: float = Field(default=2.0, ge=0)
    cache_ttl_min: int = Field(default=60, ge=0)
    max_output_tokens: int = Field(default=4000, ge=256, le=16000)  # includes adaptive-thinking tokens
    on_unavailable: Literal["proceed", "wait"] = "proceed"
    # USD per million tokens, used only for the local cost cap (claude-opus-5-5
    # list price at the time of writing). Keep in sync with published pricing.
    price_input_per_mtok: float = 4.0
    price_output_per_mtok: float = 20.0


class NewsConfig(_Strict):
    provider: Literal["none", "csv"] = "none"
    csv_path: str = "data/calendar.csv"
    block_minutes_before: int = Field(default=30, ge=0)
    block_minutes_after: int = Field(default=30, ge=0)
    min_impact: Literal["low", "medium", "high"] = "high"
    require_feed: bool = False
    max_feed_age_days: int = Field(default=7, ge=1)


class DashboardConfig(_Strict):
    host: str = "127.0.0.1"
    port: int = Field(default=8787, ge=1, le=65535)
    session_ttl_min: int = Field(default=720, ge=5)
    secure_cookies: bool = False  # set true when served over HTTPS (reverse proxy)


class StorageConfig(_Strict):
    db_path: str = "data/fxai.sqlite"


class AppConfig(_Strict):
    mode: Literal["paper", "demo", "live"] = "demo"
    live_trading_acknowledged: bool = False
    account_currency: str = "USD"  # simulation only; live currency comes from the broker
    daily_reset: DailyResetConfig = Field(default_factory=DailyResetConfig)
    symbols: SymbolsConfig = Field(default_factory=SymbolsConfig)
    bridge: BridgeConfig = Field(default_factory=BridgeConfig)
    risk: RiskConfig = Field(default_factory=RiskConfig)
    hard_limits: HardLimits = Field(default_factory=HardLimits)
    strategy: StrategyConfig = Field(default_factory=StrategyConfig)
    exits: ExitConfig = Field(default_factory=ExitConfig)
    ml: MLConfig = Field(default_factory=MLConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    news: NewsConfig = Field(default_factory=NewsConfig)
    dashboard: DashboardConfig = Field(default_factory=DashboardConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)

    @model_validator(mode="after")
    def _limits_within_hard(self) -> "AppConfig":
        r, h = self.risk, self.hard_limits
        pairs = [
            ("risk_per_trade_pct", r.risk_per_trade_pct, h.risk_per_trade_pct),
            ("max_total_risk_pct", r.max_total_risk_pct, h.max_total_risk_pct),
            ("max_open_positions", r.max_open_positions, h.max_open_positions),
            ("max_daily_loss_pct", r.max_daily_loss_pct, h.max_daily_loss_pct),
            ("max_entries_per_day", r.max_entries_per_day, h.max_entries_per_day),
        ]
        for name, val, cap in pairs:
            if val > cap:
                raise ValueError(f"risk.{name}={val} exceeds hard_limits.{name}={cap}")
        return self

    @property
    def live_enabled(self) -> bool:
        """Live trading requires BOTH mode=live and the explicit acknowledgement flag.
        (The EA additionally requires AllowLiveAccount=true.)"""
        return self.mode == "live" and self.live_trading_acknowledged


class Secrets:
    """Secrets are read from the environment on demand and never stored."""

    @staticmethod
    def get(name: str) -> str | None:
        v = os.environ.get(name)
        return v if v else None

    @staticmethod
    def require(name: str) -> str:
        v = Secrets.get(name)
        if not v:
            raise RuntimeError(f"required secret {name} is not set (use an environment variable or .env)")
        return v


def load_dotenv(path: str | Path = ".env") -> None:
    """Minimal .env loader (KEY=VALUE lines). Existing environment variables win."""
    p = Path(path)
    if not p.is_file():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def load_config(path: str | Path | None = None) -> AppConfig:
    path = path or os.environ.get("FXAI_CONFIG", "config/config.yaml")
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(
            f"config file {p} not found - copy config/config.example.yaml to config/config.yaml"
        )
    data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    return AppConfig.model_validate(data)


def resolve_bridge_dir(cfg: BridgeConfig) -> Path:
    """Locate <Common>/Files/FXAI/<login>. On Windows "auto" uses %APPDATA%."""
    if cfg.root == "auto":
        appdata = os.environ.get("APPDATA")
        if not appdata:
            raise RuntimeError("bridge.root=auto only works on Windows; set bridge.root explicitly")
        root = Path(appdata) / "MetaQuotes" / "Terminal" / "Common" / "Files" / "FXAI"
    else:
        root = Path(cfg.root)
    if cfg.account != "auto":
        return root / cfg.account
    if not root.is_dir():
        raise RuntimeError(f"bridge root {root} does not exist yet - is the EA running?")
    subs = [d for d in root.iterdir() if d.is_dir() and d.name.isdigit()]
    if len(subs) != 1:
        raise RuntimeError(
            f"bridge.account=auto needs exactly one account folder under {root}, found {len(subs)}; "
            "set bridge.account to the MT4 login number"
        )
    return subs[0]
