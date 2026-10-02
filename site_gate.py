"""Privat site: kun godkendte, indloggede brugere ser noget (src/worker.py).

Ren Python uden Flask/edgekit, så logikken kan testes lokalt
(scripts/test-site-gate.py). Selve signaturtjekket (ES256) laves af workeren
med WebCrypto, fordi Pyodide ikke har en ECDSA-implementering; her ligger alt
andet: hvilke stier der er åbne, hvor tokenet kommer fra, hvilke claims der
kræves, og hvordan et afvist svar ser ud.

Godkendelse bor i Supabase-brugerens app_metadata.approved (sat af
admin_set_approved() i scripts/supabase-site-approval.sql). app_metadata kan
kun ændres med service-rollen eller den RPC'en, aldrig af brugeren selv, og
står i den signerede access-token - så gaten kræver hverken et D1- eller et
Supabase-kald pr. request. En fjernet godkendelse slår igennem, når tokenet
fornyes (Supabase udsteder tokens med 1 times levetid).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

# Cookien auth.js skriver ved hvert login/token-fornyelse (se _syncGateCookie).
AUTH_COOKIE = "ms_auth"
# Overvågning (uptime-tjek, røgtest, opvarmning) sender HMAC(CACHE_REFRESH_SECRET,
# MONITOR_CONTEXT) i denne cookie eller header. Afledt værdi, så den rå hemmelighed
# (som også styrer /api/refresh-cache) aldrig skal ud i en browser-cookie.
MONITOR_COOKIE = "ms_monitor"
MONITOR_HEADER = "X-MadShopper-Monitor"
MONITOR_CONTEXT = b"monitor-access"

LOGIN_PATH = "/login"

# Sider der skal kunne nås uden login. Ingen af dem viser produktdata:
# login-siden selv, robots/favicon, app-links (.well-known) og de juridiske
# sider, som Google-login og app-butikkerne kræver offentligt tilgængelige.
_OPEN_PATHS = frozenset({
    LOGIN_PATH,
    "/robots.txt",
    "/favicon.ico",
    "/security.txt",
    "/privatliv",
    "/privatliv.html",
    "/privacy",
    "/terms-of-service",
    "/vilkaar.html",
})
_OPEN_PREFIXES = ("/static/", "/.well-known/")

# Lille tolerance for urskævhed mellem Supabase og Cloudflare.
_CLOCK_SKEW_S = 30


def monitor_token(secret: str) -> str:
    return hmac.new(secret.encode(), MONITOR_CONTEXT, hashlib.sha256).hexdigest()


def is_open_path(path: str) -> bool:
    return path in _OPEN_PATHS or path.startswith(_OPEN_PREFIXES)


def cookie_value(cookie_header: str, name: str) -> str:
    for part in (cookie_header or "").split(";"):
        part = part.strip()
        if part.startswith(name + "="):
            return part[len(name) + 1:]
    return ""


def monitor_ok(secret: str | None, cookie_header: str, monitor_header: str,
               cache_secret_header: str) -> bool:
    """Sandt for overvågning og cache-updaterens /api/refresh-cache-kald."""
    if not secret:
        return False
    secret = str(secret)
    if cache_secret_header and hmac.compare_digest(
            cache_secret_header.encode(), secret.encode()):
        return True
    want = monitor_token(secret).encode()
    for got in (monitor_header, cookie_value(cookie_header, MONITOR_COOKIE)):
        if got and hmac.compare_digest(got.strip().encode(), want):
            return True
    return False


def bearer_token(cookie_header: str, authorization: str) -> str:
    """Access-token fra Authorization: Bearer (mobilappen) eller cookien (web)."""
    auth = (authorization or "").strip()
    if auth[:7].lower() == "bearer ":
        return auth[7:].strip()
    return cookie_value(cookie_header, AUTH_COOKIE).strip()


def _b64url(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


class Jwt:
    __slots__ = ("header", "claims", "signing_input", "signature")

    def __init__(self, header: dict, claims: dict, signing_input: bytes,
                 signature: bytes):
        self.header = header
        self.claims = claims
        self.signing_input = signing_input
        self.signature = signature


def parse_jwt(token: str) -> Jwt | None:
    """Splitter tokenet uden at stole på det - signaturen tjekkes bagefter."""
    if not token or len(token) > 8192:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        header = json.loads(_b64url(parts[0]))
        claims = json.loads(_b64url(parts[1]))
        signature = _b64url(parts[2])
    except Exception:
        return None
    if not isinstance(header, dict) or not isinstance(claims, dict):
        return None
    # Kun ES256 med en navngivet nøgle. "none"/HS256 afvises her, så en
    # forfalsket header aldrig kan vælge en svagere algoritme.
    if header.get("alg") != "ES256" or not header.get("kid") or len(signature) != 64:
        return None
    signing_input = f"{parts[0]}.{parts[1]}".encode()
    return Jwt(header, claims, signing_input, signature)


def claims_status(claims: dict, issuer: str, now: float | None = None) -> str:
    """'approved', 'pending' (gyldigt login, ikke godkendt) eller 'invalid'.
    Kaldes KUN efter at signaturen er verificeret."""
    now = time.time() if now is None else now
    try:
        exp = float(claims.get("exp") or 0)
    except (TypeError, ValueError):
        return "invalid"
    if exp + _CLOCK_SKEW_S < now:
        return "invalid"
    if issuer and claims.get("iss") != issuer:
        return "invalid"
    aud = claims.get("aud")
    if aud != "authenticated" and not (isinstance(aud, list) and "authenticated" in aud):
        return "invalid"
    if claims.get("role") != "authenticated" or not claims.get("sub"):
        return "invalid"
    meta = claims.get("app_metadata")
    if isinstance(meta, dict) and meta.get("approved") is True:
        return "approved"
    return "pending"


def wants_html(path: str, accept: str) -> bool:
    if path.startswith("/api/"):
        return False
    return "text/html" in (accept or "") or not accept


def login_redirect_location(path: str, query: str) -> str:
    # Næste side i fragmentet, ikke i query-strengen: fragmentet sendes aldrig
    # til serveren, så /login forbliver én cache-nøgle i edge-cachen.
    target = path + (f"?{query}" if query else "")
    if target in ("", "/") or path == LOGIN_PATH:
        return LOGIN_PATH
    from urllib.parse import quote
    return f"{LOGIN_PATH}#next={quote(target, safe='')}"


DENIED_HEADERS = {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    # Svaret afhænger af cookies/Authorization - må aldrig deles i et CDN-lag.
    "Vary": "Cookie, Authorization",
}


def denied_json(status: str) -> str:
    if status == "pending":
        return json.dumps({"success": False, "error": "Din konto afventer godkendelse.",
                           "code": "approval_pending"}, ensure_ascii=False)
    return json.dumps({"success": False, "error": "Log ind for at bruge MadShopper.",
                       "code": "login_required"}, ensure_ascii=False)


def jwks_url(supabase_url: str) -> str:
    return supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"


def issuer_for(supabase_url: str) -> str:
    return supabase_url.rstrip("/") + "/auth/v1" if supabase_url else ""
