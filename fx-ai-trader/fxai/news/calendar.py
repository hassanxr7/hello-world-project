"""Scheduled economic events.

No calendar feed is bundled. ``provider: none`` means the news filter is
INACTIVE and the dashboard says so; nothing pretends to know about events.

``provider: csv`` reads a user-maintained file (e.g. exported from your
broker's or a licensed data vendor's calendar) with header:

    time_utc,currency,impact,title
    2026-11-06T13:30:00Z,USD,high,Non-Farm Payrolls

The file is treated as untrusted data: rows are validated, titles are
truncated, and only (time, currency, impact) influence trading.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from ..config import NewsConfig
from ..timeutil import as_utc

IMPACT_RANK = {"low": 1, "medium": 2, "high": 3}


@dataclass(frozen=True)
class Event:
    time_utc: datetime
    currency: str
    impact: str
    title: str


class Calendar:
    def __init__(self, cfg: NewsConfig):
        self.cfg = cfg
        self._events: list[Event] = []
        self._mtime: float | None = None
        self.error: str = ""

    @property
    def provider(self) -> str:
        return self.cfg.provider

    def _load(self) -> None:
        if self.cfg.provider != "csv":
            return
        p = Path(self.cfg.csv_path)
        try:
            mt = p.stat().st_mtime
        except FileNotFoundError:
            self._events, self.error = [], f"calendar file {p} not found"
            return
        if mt == self._mtime:
            return
        events, bad = [], 0
        with p.open(newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                try:
                    t = as_utc(datetime.fromisoformat(row["time_utc"].strip().replace("Z", "+00:00")))
                    ccy = row["currency"].strip().upper()
                    imp = row["impact"].strip().lower()
                    if len(ccy) != 3 or not ccy.isalpha() or imp not in IMPACT_RANK:
                        raise ValueError
                    events.append(Event(t, ccy, imp, (row.get("title") or "")[:120]))
                except (KeyError, ValueError, AttributeError):
                    bad += 1
        self._events = sorted(events, key=lambda e: e.time_utc)
        self._mtime = mt
        self.error = f"{bad} malformed rows ignored" if bad else ""

    def status(self, now: datetime) -> dict:
        if self.cfg.provider == "none":
            return {"provider": "none", "active": False, "detail": "no economic calendar configured - news filter inactive"}
        self._load()
        if not self._events:
            return {"provider": "csv", "active": False, "detail": self.error or "calendar empty"}
        latest = self._events[-1].time_utc
        stale = latest < as_utc(now) - timedelta(days=self.cfg.max_feed_age_days)
        return {"provider": "csv", "active": not stale, "events": len(self._events),
                "detail": "calendar stale (no future events)" if stale else (self.error or "ok")}

    def upcoming(self, now: datetime, hours: int = 24) -> list[Event]:
        self._load()
        n = as_utc(now)
        return [e for e in self._events if n - timedelta(hours=1) <= e.time_utc <= n + timedelta(hours=hours)]

    def blocking_reason(self, currencies: tuple[str, ...], now: datetime) -> str | None:
        """Reason string if an event of sufficient impact for these currencies is
        inside the blackout window; also blocks if a feed is required but unusable."""
        st = self.status(now)
        if not st["active"]:
            return f"news feed required but unavailable: {st['detail']}" if self.cfg.require_feed else None
        n = as_utc(now)
        lo = n - timedelta(minutes=self.cfg.block_minutes_after)
        hi = n + timedelta(minutes=self.cfg.block_minutes_before)
        min_rank = IMPACT_RANK[self.cfg.min_impact]
        for e in self._events:
            if e.time_utc > hi:
                break
            if e.time_utc >= lo and e.currency in currencies and IMPACT_RANK[e.impact] >= min_rank:
                mins = (e.time_utc - n).total_seconds() / 60
                return f"{e.impact}-impact {e.currency} event '{e.title}' {'in' if mins >= 0 else 'was'} {abs(mins):.0f} min {'' if mins >= 0 else 'ago'}".strip()
        return None
