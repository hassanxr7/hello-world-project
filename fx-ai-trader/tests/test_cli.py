import pytest

from fxai.__main__ import main


def test_gen_secret(capsys):
    main(["gen-secret"])
    assert len(capsys.readouterr().out.strip()) >= 48


def test_help_lists_commands(capsys):
    with pytest.raises(SystemExit):
        main(["--help"])
    out = capsys.readouterr().out
    for cmd in ("service", "dashboard", "paper", "backtest", "validate", "model", "estop"):
        assert cmd in out


def test_live_mode_refused_without_validation(tmp_path, monkeypatch):
    cfg = tmp_path / "c.yaml"
    cfg.write_text("mode: live\nlive_trading_acknowledged: true\n")
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit, match="validation"):
        main(["--config", str(cfg), "service"])
    cfg.write_text("mode: live\n")
    with pytest.raises(SystemExit, match="live_trading_acknowledged"):
        main(["--config", str(cfg), "service"])
