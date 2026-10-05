"""Midlertidigt tjek af App Store Connect API-nøglen (ASC_KEY_ID, ASC_ISSUER_ID,
ASC_PRIVATE_KEY). Printer kun statuskoder og offentlige app-oplysninger, aldrig nøglen."""
import os
import sys
import time

import jwt
import requests

BASE = "https://api.appstoreconnect.apple.com"


def token():
    key = os.environ["ASC_PRIVATE_KEY"].strip().replace("\\n", "\n")
    now = int(time.time())
    return jwt.encode(
        {"iss": os.environ["ASC_ISSUER_ID"].strip(), "iat": now, "exp": now + 900,
         "aud": "appstoreconnect-v1"},
        key, algorithm="ES256",
        headers={"kid": os.environ["ASC_KEY_ID"].strip(), "typ": "JWT"})


def main():
    for name in ("ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_PRIVATE_KEY"):
        print(f"{name}: {'sat' if os.environ.get(name, '').strip() else 'MANGLER'}")
    try:
        t = token()
    except Exception as e:
        print("Kunne ikke lave adgangsbillet af nøglen:", type(e).__name__, e)
        return 1
    h = {"Authorization": f"Bearer {t}"}
    r = requests.get(f"{BASE}/v1/apps", headers=h, params={"fields[apps]": "name,bundleId"}, timeout=30)
    print("apps:", r.status_code)
    if r.status_code != 200:
        print(r.text[:500])
        return 1
    apps = r.json().get("data", [])
    for a in apps:
        print("  ", a["id"], a["attributes"].get("bundleId"), a["attributes"].get("name"))
    for a in apps:
        r = requests.get(f"{BASE}/v1/apps/{a['id']}/analyticsReportRequests", headers=h, timeout=30)
        print(f"analyticsReportRequests {a['attributes'].get('bundleId')}:", r.status_code, r.text[:200] if r.status_code != 200 else "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
