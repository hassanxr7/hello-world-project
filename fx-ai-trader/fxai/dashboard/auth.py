"""Dashboard authentication: scrypt password hash, HMAC-signed session cookie,
per-session CSRF token, login rate limiting. Secrets come from environment
variables only and are never sent to the browser."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass, field

SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 14, 8, 1


def hash_password(password: str, salt: bytes | None = None) -> str:
    if len(password) < 12:
        raise ValueError("use a dashboard password of at least 12 characters")
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_b64, dk_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64), n=int(n), r=int(r), p=int(p),
                            dklen=len(base64.b64decode(dk_b64)))
        return hmac.compare_digest(dk, base64.b64decode(dk_b64))
    except (ValueError, TypeError):
        return False


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


@dataclass
class SessionSigner:
    secret: bytes
    ttl_s: int

    def issue(self, user: str) -> tuple[str, str]:
        csrf = secrets.token_urlsafe(24)
        body = _b64(json.dumps({"u": user, "exp": int(time.time()) + self.ttl_s, "csrf": csrf}).encode())
        sig = _b64(hmac.new(self.secret, body.encode(), hashlib.sha256).digest())
        return f"{body}.{sig}", csrf

    def verify(self, token: str | None) -> dict | None:
        if not token or "." not in token:
            return None
        body, sig = token.rsplit(".", 1)
        good = _b64(hmac.new(self.secret, body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            return None
        try:
            data = json.loads(_unb64(body))
        except (ValueError, json.JSONDecodeError):
            return None
        if int(data.get("exp", 0)) < time.time():
            return None
        return data


@dataclass
class LoginLimiter:
    max_failures: int = 5
    lockout_s: int = 300
    _fails: dict[str, list[float]] = field(default_factory=dict)

    def locked(self, key: str) -> bool:
        now = time.time()
        recent = [t for t in self._fails.get(key, []) if now - t < self.lockout_s]
        self._fails[key] = recent
        return len(recent) >= self.max_failures

    def fail(self, key: str) -> None:
        self._fails.setdefault(key, []).append(time.time())

    def reset(self, key: str) -> None:
        self._fails.pop(key, None)
