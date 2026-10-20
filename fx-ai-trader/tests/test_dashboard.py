import pytest
from fastapi.testclient import TestClient

from fxai.config import AppConfig
from fxai.dashboard.app import create_app
from fxai.dashboard.auth import SessionSigner, hash_password, verify_password
from fxai.storage import Storage

PW = "correct horse battery staple"
SECRET = "x" * 48


@pytest.fixture
def setup(tmp_path):
    cfg = AppConfig.model_validate({"bridge": {"root": str(tmp_path / "FXAI"), "account": "900001"}})
    st = Storage(tmp_path / "db.sqlite")
    st.write_status({"service": {"mode": "demo"}, "block_reasons": [], "secret_probe": "none"})
    app = create_app(cfg, st, password_hash=hash_password(PW), secret_key=SECRET)
    return TestClient(app), st, tmp_path


def login(c):
    r = c.post("/api/login", json={"password": PW})
    assert r.status_code == 200
    page = c.get("/")
    import re
    return re.search(r'name="csrf-token" content="([^"]+)"', page.text).group(1)


def test_password_hashing():
    h = hash_password(PW)
    assert verify_password(PW, h) and not verify_password("wrong password!!", h)
    with pytest.raises(ValueError):
        hash_password("short")


def test_requires_secrets(tmp_path, monkeypatch):
    monkeypatch.delenv("FXAI_DASHBOARD_PASSWORD_HASH", raising=False)
    monkeypatch.delenv("FXAI_SECRET_KEY", raising=False)
    with pytest.raises(RuntimeError):
        create_app(AppConfig(), Storage(tmp_path / "x.sqlite"))


def test_unauthenticated_access_blocked(setup):
    c, _, _ = setup
    assert c.get("/api/status").status_code == 401
    assert c.get("/api/trades.csv").status_code == 401
    assert c.post("/api/control", json={"action": "pause"}).status_code == 401
    r = c.get("/", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/login"


def test_login_rate_limited(setup):
    c, _, _ = setup
    for _ in range(5):
        assert c.post("/api/login", json={"password": "nope nope nope"}).status_code == 401
    assert c.post("/api/login", json={"password": PW}).status_code == 429


def test_session_cookie_flags_and_security_headers(setup):
    c, _, _ = setup
    r = c.post("/api/login", json={"password": PW})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    s = c.get("/api/status")
    assert "default-src 'self'" in s.headers["content-security-policy"]
    assert s.headers["x-frame-options"] == "DENY" and s.headers["cache-control"] == "no-store"


def test_csrf_required_for_controls(setup):
    c, st, _ = setup
    token = login(c)
    assert c.post("/api/control", json={"action": "pause"}).status_code == 403
    assert c.post("/api/control", json={"action": "pause"}, headers={"X-CSRF-Token": "bad"}).status_code == 403
    r = c.post("/api/control", json={"action": "pause"}, headers={"X-CSRF-Token": token})
    assert r.status_code == 200
    assert st.pending_controls()[0]["action"] == "pause"


def test_limits_validated_against_hard_caps(setup):
    c, st, _ = setup
    token = login(c)
    h = {"X-CSRF-Token": token}
    assert c.post("/api/control", json={"action": "set_limits", "params": {"risk_per_trade_pct": 0.9}}, headers=h).status_code == 400
    assert c.post("/api/control", json={"action": "set_limits", "params": {"max_entries_per_day": 25}}, headers=h).status_code == 400
    assert c.post("/api/control", json={"action": "set_limits", "params": {"magic_number": 1}}, headers=h).status_code == 400
    assert c.post("/api/control", json={"action": "set_limits", "params": {"risk_per_trade_pct": 0.2}}, headers=h).status_code == 200
    assert c.post("/api/control", json={"action": "rm -rf"}, headers=h).status_code == 400


def test_estop_writes_flag_directly_and_clear_needs_confirm(setup):
    c, st, tmp = setup
    token = login(c)
    h = {"X-CSRF-Token": token}
    (tmp / "FXAI" / "900001").mkdir(parents=True)
    assert c.post("/api/control", json={"action": "estop", "params": {"policy": "close_all"}}, headers=h).status_code == 200
    assert (tmp / "FXAI" / "900001" / "estop.flag").exists()
    assert c.post("/api/control", json={"action": "estop_clear", "params": {}}, headers=h).status_code == 400
    assert c.post("/api/control", json={"action": "estop_clear", "params": {"confirm": "CLEAR"}}, headers=h).status_code == 200


def test_status_has_no_secrets_and_export_works(setup, monkeypatch):
    c, st, _ = setup
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-test-key-should-never-leak")
    login(c)
    body = c.get("/api/status").text
    assert "fake-test-key" not in body and SECRET not in body and "scrypt$" not in body
    st.upsert_trade({"ticket": 1, "symbol": "EURUSD", "side": "BUY", "volume": 0.1, "open_time": "2026-01-01T00:00:00",
                     "open_price": 1.1, "status": "OPEN"})
    csv = c.get("/api/trades.csv")
    assert csv.status_code == 200 and "EURUSD" in csv.text and csv.headers["content-type"].startswith("text/csv")


def test_tampered_session_rejected():
    s = SessionSigner(b"k" * 32, 60)
    tok, _ = s.issue("operator")
    body, sig = tok.rsplit(".", 1)
    assert s.verify(tok) is not None
    assert s.verify(body + "." + sig[:-2] + "AA") is None
    assert SessionSigner(b"other" * 8, 60).verify(tok) is None
