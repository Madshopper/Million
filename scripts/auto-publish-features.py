"""Udgiver en funktion automatisk, når appversionen med den er i App Store.

En funktion i app._FEATURES med 'with_app': '1.0.4' skal ud på hjemmesiden
samtidig med appen (Kalle 06-10-2026: "hjemmesiden og appen skal følges ad").
Kørslen (feature-auto-publish.yml) slår App Store-versionen op i Apples
offentlige opslag og sætter funktionen til i produktionens KV (features_v1),
præcis som knappen "Udgiv" i Feature-panelet gør.

Rører kun en funktion, der aldrig er sat i panelet. Har Kalle selv udgivet
eller skjult den, bestemmer han, og kørslen gør ingenting.

    python scripts/auto-publish-features.py           # udgiver hvis klar
    python scripts/auto-publish-features.py --dry-run # viser kun hvad der ville ske

Kræver CLOUDFLARE_API_TOKEN og CLOUDFLARE_ACCOUNT_ID.
"""
from __future__ import annotations

import ast
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLE_ID = "dk.madshopper.app"
LOOKUP_URL = f"https://itunes.apple.com/lookup?bundleId={BUNDLE_ID}&country=dk"
# Samme som scripts/feature_flags.py (produktionens KV).
PROD_KV_NAMESPACE_ID = "0e60bdf03ed4490cbfac5fa72c8adca5"
FEATURES_KV_KEY = "features_v1"


def features_with_app() -> list[dict]:
    """_FEATURES fra app.py uden at importere Flask: tuplen er ren literal."""
    tree = ast.parse((ROOT / "app.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "_FEATURES" for t in node.targets
        ):
            return [f for f in ast.literal_eval(node.value) if f.get("with_app")]
    raise SystemExit("fejl: fandt ikke _FEATURES i app.py")


def version_tuple(v: str) -> tuple[int, ...]:
    return tuple(int(p) for p in v.strip().split("."))


def store_version() -> str:
    with urllib.request.urlopen(LOOKUP_URL, timeout=20) as resp:
        data = json.loads(resp.read().decode())
    results = data.get("results") or []
    if not results:
        raise SystemExit(f"fejl: App Store kender ikke {BUNDLE_ID}")
    return results[0]["version"]


def _kv_url() -> tuple[str, str]:
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not token or not account:
        raise SystemExit("fejl: CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID mangler")
    return (f"https://api.cloudflare.com/client/v4/accounts/{account}"
            f"/storage/kv/namespaces/{PROD_KV_NAMESPACE_ID}/values/{FEATURES_KV_KEY}"), token


def read_flags() -> dict:
    """Fejler højt: et tomt svar ved en fejl ville ellers få skrivningen
    nedenfor til at slette Kalles andre valg i panelet."""
    url, token = _kv_url()
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode()
    except urllib.error.HTTPError as e:
        if e.code == 404:          # intet er udgivet endnu
            return {}
        raise SystemExit(f"fejl: KV svarede {e.code}")
    data = json.loads(raw or "{}")
    if not isinstance(data, dict):
        raise SystemExit("fejl: features_v1 er ikke et objekt")
    return data


def write_flags(flags: dict) -> None:
    url, token = _kv_url()
    body = json.dumps(flags, separators=(",", ":")).encode()
    req = urllib.request.Request(url, data=body, method="PUT", headers={
        "Authorization": f"Bearer {token}", "Content-Type": "text/plain"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status != 200:
            raise SystemExit(f"fejl: KV-skrivning svarede {resp.status}")


def main() -> int:
    dry = "--dry-run" in sys.argv
    waiting = features_with_app()
    if not waiting:
        print("Ingen funktioner venter på en appversion.")
        return 0
    live = store_version()
    print(f"App Store-version nu: {live}")
    ready = [f for f in waiting if version_tuple(live) >= version_tuple(f["with_app"])]
    for f in waiting:
        if f not in ready:
            print(f"  {f['key']}: venter på {f['with_app']}")
    if not ready:
        return 0
    flags = read_flags()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    changed = []
    for f in ready:
        if f["key"] in flags:
            print(f"  {f['key']}: allerede sat i panelet, rører den ikke")
            continue
        flags[f["key"]] = {"on": True, "at": now, "auto": f"app {live}"}
        changed.append(f["key"])
        print(f"  {f['key']}: udgives nu (app {live} >= {f['with_app']})")
    if changed and not dry:
        write_flags(flags)
        print("Gemt i features_v1. Hjemmesiden følger med inden for ca. 5 minutter.")
    out = os.environ.get("GITHUB_STEP_SUMMARY")
    if out and changed:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"Udgivet automatisk med app {live}: {', '.join(changed)}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
