"""Trading-session labels (UTC, approximate; DST shifts sessions by one hour)."""

from __future__ import annotations

from datetime import datetime

SESSIONS_UTC = {
    "sydney": (21, 6),
    "tokyo": (0, 9),
    "london": (7, 16),
    "new_york": (12, 21),
}


def active_sessions(t: datetime) -> list[str]:
    h = t.hour
    out = []
    for name, (a, b) in SESSIONS_UTC.items():
        if (a <= b and a <= h < b) or (a > b and (h >= a or h < b)):
            out.append(name)
    return out


def is_weekend_closed(t: datetime) -> bool:
    """FX is closed roughly Friday 21:00 UTC to Sunday 21:00 UTC (broker-specific)."""
    wd = t.weekday()
    if wd == 5:
        return True
    if wd == 4 and t.hour >= 21:
        return True
    if wd == 6 and t.hour < 21:
        return True
    return False
