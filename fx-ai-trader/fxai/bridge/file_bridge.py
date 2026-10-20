"""Python side of the file bridge (see protocol.py / docs/PROTOCOL.md)."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

import pandas as pd

from ..timeutil import utcnow
from .protocol import BridgeState, ProtocolError, decode_kv, encode_kv, parse_state


def atomic_write(path: Path, text: str, attempts: int = 20) -> None:
    """Write to a temp file then rename over the target. On Windows the rename
    fails while another process holds the target open; retry briefly."""
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text, encoding="ascii", newline="\n")
    for i in range(attempts):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.005 * (i + 1))
    tmp.unlink(missing_ok=True)
    raise PermissionError(f"could not replace {path} (locked)")


@dataclass
class BarsCacheEntry:
    mtime: float
    df: pd.DataFrame


class FileBridge:
    def __init__(self, root: str | Path, magic: int, clock: Callable[[], datetime] = utcnow):
        self.root = Path(root)
        self.magic = magic
        self.clock = clock
        for d in ("cmd", "res", "bars"):
            (self.root / d).mkdir(parents=True, exist_ok=True)
        self._bars: dict[tuple[str, str], BarsCacheEntry] = {}
        self.last_error: str = ""

    # --- EA -> Python --------------------------------------------------------------
    def read_state(self) -> BridgeState | None:
        p = self.root / "state.json"
        for _ in range(3):
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
                return parse_state(text, self.magic)
            except FileNotFoundError:
                self.last_error = "state.json not found (EA not running?)"
                return None
            except (PermissionError, ProtocolError, KeyError, ValueError, TypeError) as e:
                self.last_error = f"state read failed: {e}"
                time.sleep(0.02)
        return None

    def state_age_s(self) -> float | None:
        p = self.root / "state.json"
        try:
            return time.time() - p.stat().st_mtime
        except FileNotFoundError:
            return None

    def read_bars(self, symbol: str, tf: str, offset_s: int) -> pd.DataFrame | None:
        """Completed bars written by the EA (server time -> UTC using ``offset_s``)."""
        p = self.root / "bars" / f"{symbol}_{tf}.csv"
        try:
            mt = p.stat().st_mtime
        except FileNotFoundError:
            return None
        key = (symbol, tf)
        ent = self._bars.get(key)
        if ent and ent.mtime == mt:
            return ent.df
        try:
            df = pd.read_csv(p)
        except Exception as e:  # partial file or locked: keep the previous copy
            self.last_error = f"bars read failed {p.name}: {e}"
            return ent.df if ent else None
        if df.empty or not {"time", "open", "high", "low", "close"} <= set(df.columns):
            return ent.df if ent else None
        idx = pd.to_datetime(df["time"].astype("int64") - offset_s, unit="s", utc=True).astype("datetime64[ns, UTC]")
        out = pd.DataFrame({c: df[c].to_numpy(float) for c in ("open", "high", "low", "close")}, index=idx)
        if "volume" in df:
            out["volume"] = df["volume"].to_numpy(float)
        if "spread" in df:
            out["spread"] = df["spread"].to_numpy(float)
        out.index.name = "open_time"
        minutes = {"M1": 1, "M5": 5, "M15": 15, "M30": 30, "H1": 60, "H4": 240, "D1": 1440}[tf]
        out["close_time"] = out.index + pd.Timedelta(minutes=minutes)
        out = out[~out.index.duplicated(keep="last")].sort_index()
        self._bars[key] = BarsCacheEntry(mt, out)
        return out

    def poll_results(self) -> list[dict[str, str]]:
        out = []
        for p in sorted((self.root / "res").glob("*.res")):
            try:
                rec = decode_kv(p.read_text(encoding="ascii", errors="replace"))
            except (ProtocolError, PermissionError, OSError) as e:
                self.last_error = f"result {p.name} unreadable: {e}"
                continue
            out.append(rec)
            try:
                p.unlink()
            except OSError:
                pass  # will be read again; consumers are idempotent
        return out

    # --- Python -> EA -----------------------------------------------------------------
    def send(self, cmd: dict) -> Path:
        p = self.root / "cmd" / f"{int(cmd['seq']):012d}.cmd"
        if p.exists():
            raise FileExistsError(f"command file {p.name} already exists")
        atomic_write(p, encode_kv(cmd))
        return p

    def command_pending(self, seq: int) -> bool:
        return (self.root / "cmd" / f"{seq:012d}.cmd").exists()

    def withdraw(self, seq: int) -> bool:
        """Delete a command the EA has not picked up yet. Returns True only if the
        file was removed by us (so the EA can no longer process it)."""
        try:
            (self.root / "cmd" / f"{seq:012d}.cmd").unlink()
            return True
        except (FileNotFoundError, PermissionError):
            return False

    def write_heartbeat(self, seq: int, mode: str, status: str) -> None:
        atomic_write(self.root / "py_heartbeat.txt",
                     encode_kv({"v": 1, "gmt": int(self.clock().timestamp()), "seq": seq, "mode": mode, "status": status}))

    def set_estop_flag(self, policy: str, by: str) -> None:
        atomic_write(self.root / "estop.flag",
                     encode_kv({"policy": policy, "by": by.replace("|", "_").replace("=", "_"),
                                "ts": int(self.clock().timestamp())}))

    def estop_flag_present(self) -> bool:
        return (self.root / "estop.flag").exists()

    def clear_estop_flag(self) -> None:
        (self.root / "estop.flag").unlink(missing_ok=True)
