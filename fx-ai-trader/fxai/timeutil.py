"""Time helpers: UTC handling, broker server offset and trading-day boundaries.

Trading-day definition (identical in the EA, see ``DayIdForGmt`` in FXAI_Bridge.mq4):

    day_id = calendar date of (zone_local_time - reset_hour)

where zone_local_time is broker server time, UTC, New York or London time.
Example: zone=America/New_York, hour=17 -> the day rolls at 17:00 New York
time (the conventional FX day). The EA uses hard-coded DST rules (US rules
since 2007, EU rules since 1996); ``rule_based_local`` is a line-by-line port of
that MQL4 code and is tested against Python's zoneinfo database.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc


def utcnow() -> datetime:
    return datetime.now(UTC)


def as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def from_epoch(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, UTC)


def server_offset_seconds(server_epoch: int, gmt_epoch: int) -> int:
    """Broker server time offset from UTC, rounded to the nearest 30 minutes.

    MT4 'datetime' values for server time are seconds since 1970 *in server
    local time*; TimeGMT() is computed from the PC clock. The difference is
    the server offset (+ jitter), which we round.
    """
    raw = server_epoch - gmt_epoch
    return int(round(raw / 1800.0)) * 1800


def server_to_utc(server_epoch: int, offset_s: int) -> datetime:
    return from_epoch(server_epoch - offset_s)


# --- rule-based DST (mirrors the MQL4 implementation exactly) -----------------

def _nth_sunday(year: int, month: int, n: int) -> date:
    d = date(year, month, 1)
    first_sunday = d + timedelta(days=(6 - d.weekday()) % 7)
    return first_sunday + timedelta(weeks=n - 1)


def _last_sunday(year: int, month: int) -> date:
    nxt = date(year + (month // 12), month % 12 + 1, 1)
    last = nxt - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - 6) % 7)


def us_dst_utc_bounds(year: int) -> tuple[datetime, datetime]:
    """US Eastern DST: 2nd Sunday March 02:00 EST (07:00 UTC) to
    1st Sunday November 02:00 EDT (06:00 UTC)."""
    start = datetime.combine(_nth_sunday(year, 3, 2), datetime.min.time(), UTC) + timedelta(hours=7)
    end = datetime.combine(_nth_sunday(year, 11, 1), datetime.min.time(), UTC) + timedelta(hours=6)
    return start, end


def eu_dst_utc_bounds(year: int) -> tuple[datetime, datetime]:
    """EU/UK summer time: last Sunday March 01:00 UTC to last Sunday October 01:00 UTC."""
    start = datetime.combine(_last_sunday(year, 3), datetime.min.time(), UTC) + timedelta(hours=1)
    end = datetime.combine(_last_sunday(year, 10), datetime.min.time(), UTC) + timedelta(hours=1)
    return start, end


def rule_based_local(utc_dt: datetime, zone: str) -> datetime:
    """Naive local wall time for UTC/New York/London using fixed DST rules."""
    u = as_utc(utc_dt)
    if zone == "UTC":
        return u.replace(tzinfo=None)
    if zone == "America/New_York":
        s, e = us_dst_utc_bounds(u.year)
        off = -4 if s <= u < e else -5
        return (u + timedelta(hours=off)).replace(tzinfo=None)
    if zone == "Europe/London":
        s, e = eu_dst_utc_bounds(u.year)
        off = 1 if s <= u < e else 0
        return (u + timedelta(hours=off)).replace(tzinfo=None)
    raise ValueError(f"unsupported zone {zone}")


def zone_local(utc_dt: datetime, zone: str, server_offset_s: int | None = None) -> datetime:
    """Naive local wall-clock time in the reset zone."""
    u = as_utc(utc_dt)
    if zone == "server":
        if server_offset_s is None:
            raise ValueError("server zone requires the broker server offset")
        return (u + timedelta(seconds=server_offset_s)).replace(tzinfo=None)
    if zone == "UTC":
        return u.replace(tzinfo=None)
    return u.astimezone(ZoneInfo(zone)).replace(tzinfo=None)


def trading_day_id(utc_dt: datetime, zone: str, reset_hour: int, server_offset_s: int | None = None) -> str:
    local = zone_local(utc_dt, zone, server_offset_s)
    return (local - timedelta(hours=reset_hour)).date().isoformat()


def trading_day_start_utc(utc_dt: datetime, zone: str, reset_hour: int,
                          server_offset_s: int | None = None) -> datetime:
    """UTC instant at which the trading day containing ``utc_dt`` began."""
    local = zone_local(utc_dt, zone, server_offset_s)
    day = (local - timedelta(hours=reset_hour)).date()
    local_start = datetime.combine(day, datetime.min.time()) + timedelta(hours=reset_hour)
    if zone == "server":
        return (local_start - timedelta(seconds=server_offset_s or 0)).replace(tzinfo=UTC)
    if zone == "UTC":
        return local_start.replace(tzinfo=UTC)
    return local_start.replace(tzinfo=ZoneInfo(zone)).astimezone(UTC)


def parse_hours_window(window: str) -> tuple[int, int]:
    """'07:00-20:00' -> (420, 1200) minutes after midnight UTC."""
    a, b = window.split("-")
    ah, am = (int(x) for x in a.split(":"))
    bh, bm = (int(x) for x in b.split(":"))
    return ah * 60 + am, bh * 60 + bm


def in_window(utc_dt: datetime, window: str) -> bool:
    start, end = parse_hours_window(window)
    m = utc_dt.hour * 60 + utc_dt.minute
    if start <= end:
        return start <= m < end
    return m >= start or m < end  # window wraps midnight
