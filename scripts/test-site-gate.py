#!/usr/bin/env python3
"""Regressionstest af det private sites gate-logik (site_gate.py).

Signaturen tjekkes af workeren med WebCrypto og kan ikke køres her; alt andet
kan: hvilke stier der er åbne, hvor tokenet læses fra, hvilke claims der
kræves, overvågningens adgang og redirect-målet. Kør: python3 scripts/test-site-gate.py
"""
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import site_gate as g  # noqa: E402

ISS = "https://x.supabase.co/auth/v1"
fails = 0


def check(name, got, want):
    global fails
    if got != want:
        fails += 1
        print(f"FEJL {name}: fik {got!r}, ventede {want!r}")


def b64(obj):
    raw = json.dumps(obj).encode() if not isinstance(obj, bytes) else obj
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def token(header=None, **claims):
    h = header or {"alg": "ES256", "kid": "k1", "typ": "JWT"}
    return f"{b64(h)}.{b64(claims)}.{b64(b'x' * 64)}"


base = dict(iss=ISS, aud="authenticated", role="authenticated", sub="u1",
            exp=int(time.time()) + 3600)

# Åbne stier
for p in ("/login", "/api/session", "/robots.txt", "/static/css/a.css",
          "/.well-known/assetlinks.json", "/privatliv", "/terms-of-service"):
    check(f"åben {p}", g.is_open_path(p), True)
for p in ("/", "/admin", "/api/products", "/Mejeri", "/search/results",
          "/sitemap.xml", "/product/1", "/loginx", "/api/sessions"):
    check(f"lukket {p}", g.is_open_path(p), False)

# Token-kilde
check("bearer", g.bearer_token("ms_session=c", "Bearer abc"), "abc")
check("cookie", g.bearer_token("a=1; ms_session=c.d.e", ""), "c.d.e")
check("ingen", g.bearer_token("", ""), "")

# Parse: kun ES256 med kid og 64-byte signatur
check("parse ok", g.parse_jwt(token(**base)) is not None, True)
check("alg none", g.parse_jwt(token({"alg": "none", "kid": "k1"}, **base)), None)
check("alg HS256", g.parse_jwt(token({"alg": "HS256", "kid": "k1"}, **base)), None)
check("uden kid", g.parse_jwt(token({"alg": "ES256"}, **base)), None)
check("skrald", g.parse_jwt("abc"), None)
check("tom", g.parse_jwt(""), None)

# Claims
st = lambda **kw: g.claims_status({**base, **kw}, ISS)  # noqa: E731
check("pending", st(), "pending")
check("approved", st(app_metadata={"approved": True}), "approved")
check("approved som streng", st(app_metadata={"approved": "true"}), "pending")
check("user_metadata tæller ikke", st(user_metadata={"approved": True}), "pending")
check("udløbet", st(exp=int(time.time()) - 120, app_metadata={"approved": True}), "invalid")
check("forkert iss", st(iss="https://evil/auth/v1", app_metadata={"approved": True}), "invalid")
check("anon-rolle", st(role="anon", app_metadata={"approved": True}), "invalid")
check("forkert aud", st(aud="x", app_metadata={"approved": True}), "invalid")

# Overvågning
sec = "s3cret"
tok = g.monitor_token(sec)
check("monitor header", g.monitor_ok(sec, "", tok, ""), True)
check("monitor cookie", g.monitor_ok(sec, f"ms_monitor={tok}", "", ""), True)
check("cache-secret", g.monitor_ok(sec, "", "", sec), True)
check("rå secret i header", g.monitor_ok(sec, "", sec, ""), False)
check("forkert", g.monitor_ok(sec, "ms_monitor=x", "y", "z"), False)
check("intet secret", g.monitor_ok(None, "", tok, ""), False)
check("tomt secret", g.monitor_ok("", "", g.monitor_token(""), ""), False)

# Redirect og svartype
check("redirect /", g.login_redirect_location("/", ""), "/login")
check("redirect sti", g.login_redirect_location("/search/results", "q=mælk"),
      "/login#next=%2Fsearch%2Fresults%3Fq%3Dm%C3%A6lk")
check("html", g.wants_html("/Mejeri", "text/html,application/xhtml+xml"), True)
check("api", g.wants_html("/api/home", "text/html"), False)
check("fetch json", g.wants_html("/search", "application/json"), False)

if fails:
    print(f"{fails} fejl")
    sys.exit(1)
print("site_gate: alle tjek bestået")
