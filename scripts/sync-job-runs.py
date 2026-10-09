#!/usr/bin/env python3
"""Gem GitHub Actions-kørsler i Supabase (public.job_runs) til /admin.

Køres som et trin i security-monitor.yml (én gang i døgnet) med workflowets egen
GITHUB_TOKEN (permissions: actions: read), så der ikke skal oprettes nogen
personlig token. Henter de seneste 200 kørsler, sorterer pull request-tjek fra
(de er CI, ikke drift) og upserter på kørslens id: en kørsel der var i gang ved
sidste synk, får her sit endelige udfald. Rækker ældre end 90 dage slettes.

Kun standardbiblioteket, så trinnet ikke kræver installation.

Env: GITHUB_TOKEN, GITHUB_REPOSITORY (sættes af Actions), SUPABASE_URL og
DEPLOY_KEY (service_role).
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

KEEP_DAYS = 90
PAGES = 3            # 3 x 100 kørsler dækker et døgn mellem synk, også på travle dage

GH_TOKEN = os.environ.get("GITHUB_TOKEN") or ""
REPO = os.environ.get("GITHUB_REPOSITORY") or "Madshopper/Million"
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY = os.environ.get("DEPLOY_KEY") or ""


def request(url: str, method: str = "GET", headers: dict | None = None,
            body: bytes | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def fetch_runs() -> list[dict]:
    headers = {
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "madshopper-job-runs",
    }
    runs: list[dict] = []
    for page in range(1, PAGES + 1):
        url = (f"https://api.github.com/repos/{REPO}/actions/runs"
               f"?per_page=100&page={page}&exclude_pull_requests=true")
        status, raw = request(url, headers=headers)
        if status != 200:
            raise RuntimeError(f"GitHub svarede {status}: {raw[:200]!r}")
        batch = json.loads(raw).get("workflow_runs") or []
        runs.extend(batch)
        if len(batch) < 100:
            break
    return runs


def to_row(r: dict) -> dict:
    return {
        "id": int(r["id"]),
        "workflow": str(r.get("name") or r.get("path") or "?")[:200],
        "path": str(r.get("path") or "")[:200],
        "event": str(r.get("event") or "")[:40],
        "status": str(r.get("status") or "")[:40],
        "conclusion": r.get("conclusion"),
        "branch": str(r.get("head_branch") or "")[:200],
        "run_number": r.get("run_number"),
        "run_attempt": r.get("run_attempt"),
        "created_at": r.get("created_at"),
        "started_at": r.get("run_started_at"),
        "updated_at": r.get("updated_at"),
        "url": str(r.get("html_url") or "")[:300],
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


def supabase_headers(prefer: str) -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def main() -> int:
    if not (GH_TOKEN and SUPABASE_URL and SUPABASE_KEY):
        print("fejl: GITHUB_TOKEN, SUPABASE_URL og DEPLOY_KEY skal være sat", file=sys.stderr)
        return 1

    rows = [to_row(r) for r in fetch_runs() if r.get("event") != "pull_request"]
    if rows:
        status, raw = request(
            f"{SUPABASE_URL}/rest/v1/job_runs?on_conflict=id", method="POST",
            headers=supabase_headers("resolution=merge-duplicates,return=minimal"),
            body=json.dumps(rows).encode(),
        )
        if status not in (200, 201, 204):
            print(f"fejl: Supabase-upsert gav {status}: {raw[:300]!r} "
                  "- er scripts/supabase-admin.sql kørt?", file=sys.stderr)
            return 1

    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).isoformat()
    status, raw = request(
        f"{SUPABASE_URL}/rest/v1/job_runs?created_at=lt.{urllib.parse.quote(cutoff)}",
        method="DELETE", headers=supabase_headers("return=minimal"),
    )
    if status not in (200, 204):
        print(f"advarsel: oprydning gav {status}: {raw[:200]!r}", file=sys.stderr)

    print(f"{len(rows)} kørsler synket til job_runs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
