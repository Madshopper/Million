#!/usr/bin/env python3
"""Bot-tjekket på /api/feedback skal virke på edge.

Fundet 10-11-2026 ved en måling mod produktion: et opdigtet Turnstile-token
kom forbi serverens tjek. `_verify_turnstile_token` brugte httpx, som ikke
virker i Cloudflares Pyodide-runtime; kaldet kastede hver gang og faldt i
"tillad alligevel". Ingen opdagede det, fordi browseren selv spurgte
verificerings-workeren først - og det må den heller ikke, for et token kan
kun bruges én gang.

Gaten tjekker to ting, uden afhængigheder (funktionen køres direkte fra
kildeteksten med stubbe):
  1. På edge spørger serveren workeren gennem _edge_fetch, og et nej er et nej.
     Kun når workeren ikke kan nås (eller selv fejler med 5xx), slippes
     beskeden igennem.
  2. Hverken hjemmesiden eller appen spørger selv workeren (så var tokenet
     brugt, før serveren nåede at tjekke det).
"""
import ast
import json
import pathlib
import sys
import types

ROOT = pathlib.Path(__file__).resolve().parent.parent
VERIFY_HOST = "verify.madshopper.dk"

failures: list[str] = []


def check(ok: bool, label: str) -> None:
    print(("  OK    " if ok else "  FEJL  ") + label)
    if not ok:
        failures.append(label)


# --- 1. Serverens tjek, kørt som på edge -----------------------------------
source = (ROOT / "app.py").read_text(encoding="utf-8")
tree = ast.parse(source)
fn = next((n for n in tree.body
           if isinstance(n, ast.FunctionDef) and n.name == "_verify_turnstile_token"), None)
if fn is None:
    sys.exit("FEJL: fandt ikke _verify_turnstile_token i app.py")
fn_source = ast.get_source_segment(source, fn)


class _Logger:
    def warning(self, *args, **kwargs) -> None:
        pass


class _HttpxMaaIkkeBruges(types.ModuleType):
    """På edge findes httpx ikke brugbart. Rører funktionen den alligevel,
    kaster kaldet - præcis som i produktion før rettelsen."""

    def __getattr__(self, name):
        raise RuntimeError("httpx virker ikke i Cloudflares Pyodide-runtime")


sys.modules["httpx"] = _HttpxMaaIkkeBruges("httpx")


def run(worker_answer, token: str = "et-token", ip: str = "203.0.113.7"):
    calls = []

    def edge_fetch(url, method="GET", headers=None, body=None):
        calls.append({"url": url, "method": method, "headers": headers or {}, "body": body})
        if isinstance(worker_answer, Exception):
            raise worker_answer
        return worker_answer

    namespace = {
        "json": json,
        "logger": _Logger(),
        "_IS_EDGE": True,
        "_edge_fetch": edge_fetch,
        "_client_ip": lambda: ip,
        "_TURNSTILE_VERIFY_URL": "https://" + VERIFY_HOST,
    }
    exec(fn_source, namespace)
    return namespace["_verify_turnstile_token"](token), calls


print("Serverens bot-tjek på edge:")

result, calls = run(({"success": True}, 200), token="")
check(result is False and not calls, "tomt token afvises uden at spørge workeren")

result, calls = run(({"success": True}, 200))
check(result is True, "workeren siger ja -> beskeden slippes igennem")
check(len(calls) == 1 and calls[0]["method"] == "POST" and VERIFY_HOST in calls[0]["url"],
      "serveren spørger workeren præcis én gang med POST")
sent = json.loads(calls[0]["body"]) if calls and calls[0]["body"] else {}
check(sent.get("token") == "et-token", "tokenet sendes med")
check(sent.get("remoteip") == "203.0.113.7", "den besøgendes IP sendes med")
check(calls[0]["headers"].get("Content-Type") == "application/json" if calls else False,
      "kaldet sendes som JSON")

result, _ = run(({"success": False, "error-codes": ["invalid-input-response"]}, 200))
check(result is False, "workeren siger nej (opdigtet token) -> afvist")

result, _ = run(({"success": False, "error-codes": ["timeout-or-duplicate"]}, 200))
check(result is False, "workeren siger nej (brugt eller udløbet token) -> afvist")

result, _ = run(({"success": False, "error-codes": ["missing-token"]}, 400))
check(result is False, "workeren afviser kaldet (400) -> afvist")

result, _ = run((None, 502))
check(result is True, "workeren er nede (502 uden svar) -> slippes igennem")

result, _ = run(({"success": False, "error-codes": ["upstream-timeout"]}, 504))
check(result is True, "workeren kan ikke nå Cloudflare (504) -> slippes igennem")

result, _ = run((None, 200))
check(result is True, "workeren svarer ikke JSON -> slippes igennem")

result, _ = run(RuntimeError("Sync-bro optaget"))
check(result is True, "kaldet kaster -> slippes igennem")

result, calls = run(({"success": True}, 200), ip="unknown")
sent = json.loads(calls[0]["body"]) if calls and calls[0]["body"] else {}
check("remoteip" not in sent, "ukendt IP sendes ikke med")

# --- 2. Ingen klient må selv bruge tokenet ---------------------------------
print("Kun serveren spørger verificerings-workeren:")
client_files = [
    *sorted((ROOT / "templates").rglob("*.html")),
    *sorted(p for p in (ROOT / "static" / "js").rglob("*.js") if "vendor" not in p.parts),
    *sorted(p for ext in ("*.ts", "*.tsx") for p in (ROOT / "apps" / "mobile" / "src").rglob(ext)),
]
check(len(client_files) > 20, f"fandt klientfilerne ({len(client_files)} stk.)")
offenders = [str(p.relative_to(ROOT)) for p in client_files
             if VERIFY_HOST in p.read_text(encoding="utf-8", errors="replace")]
check(not offenders,
      "ingen side eller app-skærm kalder " + VERIFY_HOST
      + (" (fundet i: " + ", ".join(offenders) + ")" if offenders else ""))

if failures:
    print(f"\n{len(failures)} FEJL")
    sys.exit(1)
print("\nALLE TESTS BESTAAET")
