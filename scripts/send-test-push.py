"""Send en testbesked til alle telefoner og browsere tilmeldt på dev-siden.

Bruges til at afprøve "Beskeder på telefonen" uden at vente på en rigtig
prisalarm. Rammer KUN push_devices_dev (dev.madshopper.dk og appens
test-udgave), aldrig rigtige brugere. Køres af push-test.yml.

    python scripts/send-test-push.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx  # noqa: E402

from push_notify import send_to_devices  # noqa: E402


def main() -> int:
    base = os.getenv("SUPABASE_URL") or ""
    key = os.getenv("DEPLOY_KEY") or ""
    if not base or not key:
        print("SUPABASE_URL/DEPLOY_KEY mangler", file=sys.stderr)
        return 1
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    resp = httpx.get(f"{base}/rest/v1/push_devices_dev", headers=headers,
                     params={"select": "id,user_id,kind,token,p256dh,auth",
                             "order": "last_seen_at.desc", "limit": "20"}, timeout=30)
    resp.raise_for_status()
    devices = resp.json()
    print(f"Tilmeldte enheder på dev: {len(devices)} "
          f"({sum(d['kind'] == 'expo' for d in devices)} app, "
          f"{sum(d['kind'] == 'web' for d in devices)} browser)")
    if not devices:
        print("Ingen at sende til. Slå beskeder til under Mine prisalarmer først.")
        return 1
    delivered, gone = send_to_devices(devices, {
        "title": "Testbesked fra MadShopper",
        "body": "Det virker. Sådan ser en prisalarm ud på din telefon.",
        "url": "/?alarmer=1",
        "data": {"type": "test"},
    })
    print(f"Leveret: {delivered} af {len(devices)}. Væk: {len(gone)}")
    if gone:
        httpx.delete(f"{base}/rest/v1/push_devices_dev", headers=headers,
                     params={"id": f"in.({','.join(str(int(i)) for i in gone)})"}, timeout=30)
    return 0 if delivered else 1


if __name__ == "__main__":
    sys.exit(main())
