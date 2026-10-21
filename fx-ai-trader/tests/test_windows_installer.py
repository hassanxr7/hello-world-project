"""The Windows installer (scripts/windows/setup_vps.ps1).

Static checks always run. The logic tests in tests/windows/installer_tests.ps1 run when a
PowerShell is available: Windows PowerShell 5.1 on Windows (that is, on the VPS during
installation), or PowerShell 7 elsewhere (set FXAI_PWSH or put pwsh on PATH)."""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from fxai.config import load_config

ROOT = Path(__file__).resolve().parents[1]
WIN = ROOT / "scripts" / "windows"
SETUP = (WIN / "setup_vps.ps1").read_text(encoding="utf-8")


def code_only(src: str) -> str:
    src = re.sub(r"<#.*?#>", "", src, flags=re.S)
    return "\n".join(line.split(" #")[0] if not line.lstrip().startswith("#") else "" for line in src.splitlines())


@pytest.mark.parametrize("script", sorted(p.name for p in WIN.glob("*.ps1")))
def test_no_powershell7_only_constructs(script):
    code = code_only((WIN / script).read_text(encoding="utf-8"))
    for pat in [r"\?\?", r"-AsHashtable", r"\bTest-Json\b", r"utf8NoBOM", r"-SkipHttpErrorCheck", r"\s&&\s", r"\s\|\|\s",
                r"ForEach-Object\s+-Parallel", r"\$\w+\s*\?\s*\S+\s*:"]:
        assert not re.search(pat, code), (script, pat)


def test_installer_keeps_trading_off_and_limits_unchanged():
    calls = re.findall(r'Set-YamlScalar\s+\(?\$\w+(?:\s+"(\w+)"\s+"(\w+)")?', SETUP)
    edited = set(re.findall(r'"(symbols|risk|mode|strategy|exits|hard_limits)"\s+"(\w+)"', SETUP))
    assert edited == {("symbols", "prefix"), ("symbols", "suffix"), ("risk", "commission_per_lot_round_turn")}, edited
    assert calls
    assert "live_trading_acknowledged" not in code_only(SETUP)
    # the EA source is only changed for the symbol prefix/suffix defaults
    assert re.search(r'@\("SymbolPrefix", \$Prefix\), @\("SymbolSuffix", \$Suffix\)', SETUP)
    assert "EnableTrading" not in re.search(r"function Set-EaDefaults.*?\n}", SETUP, re.S).group(0)
    # the service is never started when the config says live
    assert re.search(r'if \(\$mode -ne "live"\) \{ Start-ScheduledTask -TaskName "fxai-service" \}', SETUP)


def test_downloads_are_verified():
    assert "Test-ProjectArchive $zip $sha" in SETUP  # archive must be the requested commit
    assert 'codeload.github.com/$Repo/zip/$sha' in SETUP
    assert "Get-AuthenticodeSignature" in SETUP and "Python Software Foundation" in SETUP
    assert 'Get-FileHash $zip -Algorithm SHA256' in SETUP  # GitHub CLI (private repositories only)
    assert "auth login --hostname github.com --git-protocol https --web" in SETUP  # device sign-in, no password typed here


def test_task_wrappers_retry_and_tasks_match():
    reg = (WIN / "register_tasks.ps1").read_text()
    assert 'foreach ($name in @("service", "dashboard"))' in reg and '"fxai-$name"' in reg
    for name in ("service", "dashboard"):
        w = (WIN / f"run_{name}.ps1").read_text()
        assert "while ($true)" in w and "Start-Sleep" in w and f"-m fxai {name}" in w


def _powershell() -> str | None:
    if os.environ.get("FXAI_PWSH"):
        return os.environ["FXAI_PWSH"]
    return shutil.which("pwsh") or (shutil.which("powershell") if sys.platform == "win32" else None)


@pytest.mark.skipif(_powershell() is None, reason="no PowerShell available")
def test_installer_logic(tmp_path):
    env = {**os.environ, "DOTNET_SYSTEM_GLOBALIZATION_INVARIANT": "1", "FXAI_TEST_PYTHON": sys.executable}
    r = subprocess.run([_powershell(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                        str(ROOT / "tests" / "windows" / "installer_tests.ps1"), "-OutDir", str(tmp_path)],
                       capture_output=True, text=True, env=env, timeout=600)
    assert r.returncode == 0, r.stdout[-4000:] + r.stderr[-2000:]
    assert "failures: 0" in r.stdout
    cfg = load_config(tmp_path / "config.yaml")  # the config the installer would write still validates
    assert cfg.mode == "demo" and cfg.symbols.suffix == ".r" and cfg.risk.commission_per_lot_round_turn == 3.5
