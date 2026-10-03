"""Er en funktion udgivet på madshopper.dk? Til de natlige kørsler.

Feature-fanen i /admin gemmer valgene i produktionens KV-nøgle features_v1
(app.py::_FEATURES). Kørsler der hører til en funktion (fx opskrifternes
priser) tjekker her, så de starter og stopper sammen med knappen i panelet.

    python scripts/feature_flags.py recipes   # skriver on=true/false

Kræver CLOUDFLARE_API_TOKEN og CLOUDFLARE_ACCOUNT_ID. Ved fejl svares
"ikke udgivet", så en kørsel aldrig starter ved en fejl.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

# Produktionens KV (wrangler.toml, env.production). Staging læses aldrig:
# dér har funktionerne altid været slået til via miljø-varerne.
PROD_KV_NAMESPACE_ID = "0e60bdf03ed4490cbfac5fa72c8adca5"
FEATURES_KV_KEY = "features_v1"


def _read_flags() -> dict:
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not token or not account:
        print("feature_flags: CLOUDFLARE_API_TOKEN/ACCOUNT_ID mangler", file=sys.stderr)
        return {}
    url = (f"https://api.cloudflare.com/client/v4/accounts/{account}"
           f"/storage/kv/namespaces/{PROD_KV_NAMESPACE_ID}/values/{FEATURES_KV_KEY}")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        if e.code != 404:            # 404 = intet er udgivet endnu
            print(f"feature_flags: KV svarede {e.code}", file=sys.stderr)
        return {}
    except Exception as e:
        print(f"feature_flags: kunne ikke læse KV: {e}", file=sys.stderr)
        return {}
    return data if isinstance(data, dict) else {}


def feature_live(key: str) -> bool:
    entry = _read_flags().get(key)
    return isinstance(entry, dict) and entry.get("on") is True


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("brug: python scripts/feature_flags.py <key>")
    on = feature_live(sys.argv[1])
    print(f"{sys.argv[1]}: {'udgivet' if on else 'ikke udgivet'}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as fh:
            fh.write(f"on={'true' if on else 'false'}\n")
