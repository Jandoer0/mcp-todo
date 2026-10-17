"""Security helpers: SSRF protection for webhook URLs and simple in-memory
rate limiting for auth endpoints.

One responsibility per file — everything here is about *rejecting unsafe
input / outbound requests*, not business logic.
"""
import ipaddress
import os
import socket
import threading
import time
from urllib.parse import urlsplit

MAX_WEBHOOK_URL_LEN = 2048

# --- Rate limiting (process-local, good enough for a single-container app) ---
_lock = threading.Lock()
_attempts: dict[str, list[float]] = {}
_ATTEMPTS_CAP = 10_000


def attempt_allowed(key: str, max_hits: int, window_sec: float) -> bool:
    """Sliding-window counter. Records the attempt and returns False once
    the key made ``max_hits`` attempts inside ``window_sec``."""
    now = time.monotonic()
    with _lock:
        hits = [t for t in _attempts.get(key, ()) if now - t < window_sec]
        if len(hits) >= max_hits:
            _attempts[key] = hits
            return False
        hits.append(now)
        _attempts[key] = hits
        if len(_attempts) > _ATTEMPTS_CAP:
            # Bounded memory: drop the oldest half of the keys.
            for k in list(_attempts)[: _ATTEMPTS_CAP // 2]:
                _attempts.pop(k, None)
        return True


def reset_attempts(key: str) -> None:
    with _lock:
        _attempts.pop(key, None)


# --- SSRF protection for outbound webhooks -----------------------------------
def _allow_private() -> bool:
    """Test/dev escape hatch: WEBHOOK_ALLOW_PRIVATE=1 skips the private-IP
    check (used by the webhook delivery tests that hit 127.0.0.1)."""
    return os.getenv("WEBHOOK_ALLOW_PRIVATE", "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def _resolve(host: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as exc:
        raise ValueError("Не удалось разрешить имя хоста URL") from exc
    return sorted({info[4][0] for info in infos})


def _is_forbidden_ip(ip: str) -> bool:
    # Strip an IPv6 zone id ("fe80::1%eth0") before parsing.
    try:
        addr = ipaddress.ip_address(ip.split("%")[0])
    except ValueError:
        return True
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def validate_webhook_url(url: str) -> str:
    """Validate an outbound webhook URL (SSRF guard).

    Only plain http(s) URLs are accepted; credentials in the URL are
    rejected; the host must resolve — every resolved address must be public
    (no loopback / RFC1918 / link-local / cloud-metadata endpoints). The
    check runs both on save and again right before delivery, so a host that
    re-points to an internal address (DNS rebinding) is caught too.
    """
    if not url or not isinstance(url, str) or len(url) > MAX_WEBHOOK_URL_LEN:
        raise ValueError("Некорректный URL веб-хука")
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise ValueError("URL веб-хука должен начинаться с http:// или https://")
    if not parts.hostname:
        raise ValueError("В URL веб-хука не указан хост")
    if parts.username or parts.password:
        raise ValueError("URL веб-хука с логином/паролем запрещён")
    if _allow_private():
        return url
    for ip in _resolve(parts.hostname):
        if _is_forbidden_ip(ip):
            raise ValueError(
                f"URL веб-хука указывает на внутренний адрес ({ip}) и запрещён"
            )
    return url
