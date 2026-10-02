#!/usr/bin/env python3
"""Henter ventende feedback fra D1 (pending_feedback) og sender den videre til
Google Sheet-webhooken. Kører periodisk via GitHub Actions - uden om Cloudflare
Workers' synkrone/tråd-begrænsninger, som gjorde at kaldet enten forsvandt
stille eller gav 503 når det blev forsøgt direkte fra Workeren."""
from __future__ import annotations

import json
import os
import subprocess
import sys

import httpx

DB_NAME = "madshopper"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEBHOOK_URL = os.environ.get("GOOGLE_SHEET_WEBHOOK_URL")
# Arkiv til /admin (public.feedback, scripts/supabase-admin.sql). service_role,
# fordi tabellen er lukket for anon/authenticated. Mangler en af dem, springes
# arkivet over og relayen opfoerer sig som foer.
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("DEPLOY_KEY") or ""


def run_wrangler_sql(sql: str) -> list[dict]:
    # --file+--json returnerer kun udførelsesstatistik (ikke rækkedata) i denne
    # wrangler-version - --command giver de faktiske rækker.
    result = subprocess.run(
        ["npx", "wrangler@4", "d1", "execute", DB_NAME, "--remote", f"--command={sql}", "--json"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    stdout = result.stdout
    json_start = stdout.find("[")
    if json_start == -1:
        # ALDRIG print hele stdout her: for SELECT * FROM pending_feedback
        # (linje 71) er stdout selve feedback-rækkerne (navn, e-mail, besked),
        # og dette workflow kører i et OFFENTLIGT GitHub-repo, hvis Actions-
        # logs er læsbare af alle og gemmes i 90 dage (compliance-audit
        # 19-08-2026, GDPR-023). Kun længde og statuskode er nødvendige for at
        # fejlsøge selve wrangler-kaldet.
        print(
            f"wrangler-output uden JSON (stdout: {len(stdout)} tegn, "
            f"returkode {result.returncode})",
            file=sys.stderr,
        )
        raise RuntimeError("Kunne ikke finde JSON i wrangler d1 execute-output")
    payload = json.loads(stdout[json_start:])
    return payload[0].get("results", []) if payload else []


def ensure_schema() -> None:
    run_wrangler_sql(
        "CREATE TABLE IF NOT EXISTS pending_feedback ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, feedback_type TEXT, name TEXT, "
        "email TEXT, subject TEXT, message TEXT, page_url TEXT, created_at TEXT);"
    )


def _is_feedback_row(row: object) -> bool:
    """Kun rigtige D1-rækker - ikke wrangler-statistik ved fejl."""
    if not isinstance(row, dict):
        return False
    if row.get("id") is None:
        return False
    return bool((row.get("message") or "").strip())


def _row_payload(row: dict) -> dict:
    return {
        "type": row.get("feedback_type") or "feedback",
        "name": row.get("name") or "",
        "email": row.get("email") or "",
        "subject": row.get("subject") or "",
        "message": row.get("message") or "",
        "page_url": row.get("page_url") or "",
        "created_at": row.get("created_at") or "",
    }


def _created_at_iso(raw: str) -> str | None:
    """D1's created_at er app.py's datetime.now() uden tidszone - UTC paa edge."""
    from datetime import datetime, timezone
    try:
        dt = datetime.fromisoformat(raw)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _service_headers() -> dict:
    return {"apikey": SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"}


def archive_ready() -> bool:
    """Sandt naar arkivtabellen findes. Er scripts/supabase-admin.sql endnu ikke
    koert, maa arkivet ikke blokere relayen - saa ville al feedback hobe sig op
    i D1 og aldrig naa sheet'et."""
    if not (SUPABASE_URL and SUPABASE_SERVICE_KEY):
        print("advarsel: SUPABASE_URL/DEPLOY_KEY ikke sat - feedback arkiveres ikke til /admin.")
        return False
    try:
        resp = httpx.get(
            f"{SUPABASE_URL}/rest/v1/feedback?select=id&limit=1",
            headers=_service_headers(), timeout=15.0,
        )
    except Exception as e:
        print(f"advarsel: arkivtjek fejlede ({type(e).__name__}) - arkiverer ikke denne gang.")
        return False
    if resp.status_code != 200:
        print(f"advarsel: public.feedback svarer {resp.status_code} - koer scripts/supabase-admin.sql. Arkiverer ikke.")
        return False
    return True


def archive_to_supabase(row: dict) -> bool:
    """Gem en kopi i public.feedback, saa svaret kan laeses i /admin. Upsert paa
    d1_id: fejler sheet-afsendelsen, ligger raekken i D1 til naeste koersel og
    arkiveres igen uden dublet."""
    payload = _row_payload(row)
    record = {
        "d1_id": int(row["id"]),
        "feedback_type": payload["type"],
        "name": payload["name"],
        "email": payload["email"],
        "subject": payload["subject"],
        "message": payload["message"],
        "page_url": payload["page_url"],
    }
    created = _created_at_iso(payload["created_at"])
    if created:
        record["created_at"] = created
    try:
        resp = httpx.post(
            f"{SUPABASE_URL}/rest/v1/feedback?on_conflict=d1_id",
            json=record,
            headers={**_service_headers(),
                     "Prefer": "resolution=ignore-duplicates,return=minimal"},
            timeout=15.0,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        # Samme regel som webhook-fejlen nedenfor: kun type + status, aldrig
        # svaret (det kan indeholde raekkens indhold i et offentligt Actions-log).
        status = getattr(getattr(e, "response", None), "status_code", "?")
        print(f"  arkiv fejlede for id={row.get('id')}: {type(e).__name__} (status {status})")
        return False


def main() -> int:
    if not WEBHOOK_URL:
        print("GOOGLE_SHEET_WEBHOOK_URL ikke sat - afbryder.")
        return 1

    ensure_schema()
    rows = run_wrangler_sql("SELECT * FROM pending_feedback ORDER BY id ASC LIMIT 200;")
    valid = [r for r in rows if _is_feedback_row(r)]
    skipped = len(rows) - len(valid)
    if skipped:
        print(f"advarsel: sprang {skipped} ugyldig(e) række(r) over (mangler id/besked).")

    if not valid:
        print("Ingen ventende feedback.")
        return 0

    print(f"{len(valid)} ventende feedback-række(r) fundet.")
    archive = archive_ready()
    sent_ids: list[int] = []
    for row in valid:
        rid = int(row["id"])
        payload = _row_payload(row)
        # Arkivet FOER sheet'et: en raekke slettes kun fra D1, naar den findes
        # begge steder. Fejler arkivet, bliver den liggende til naeste koersel.
        if archive and not archive_to_supabase(row):
            continue
        try:
            resp = httpx.post(WEBHOOK_URL, json=payload, timeout=15.0, follow_redirects=True)
            resp.raise_for_status()
            sent_ids.append(rid)
            print(f"  sendt id={rid} ({payload['type']!r}, {len(payload['message'])} tegn)")
        except Exception as e:
            # Ikke str(e): httpx.HTTPStatusError formaterer sig med den fulde
            # (omdirigerede) URL, som for Apps Script-webhooks indeholder et
            # user_content_key - og GitHub maskerer kun eksakte secret-
            # værdier, ikke en omdirigeret URL der blot INDEHOLDER en (se
            # compliance-audit 19-08-2026, GDPR-023). Kun fejltype + status.
            status = getattr(getattr(e, "response", None), "status_code", "?")
            print(f"  fejl ved id={rid}: {type(e).__name__} (status {status})")

    if sent_ids:
        ids_sql = ",".join(str(i) for i in sent_ids)
        run_wrangler_sql(f"DELETE FROM pending_feedback WHERE id IN ({ids_sql});")
        print(f"Sendt og ryddet {len(sent_ids)} feedback-række(r).")

    failed = len(valid) - len(sent_ids)
    if failed:
        print(f"advarsel: {failed} række(r) fejlede og prøves igen ved næste kørsel.")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
