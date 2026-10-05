#!/usr/bin/env python3
"""Hent appens tal fra Apple til /admin (fanen App).

Køres hver dag af app-stats.yml og gemmer i Supabase med service_role:
  - public.app_store_daily (dag, måling, værdi), upsert, så en dag der
    hentes igen bare overskrives.
  - public.app_store_reviews (de nyeste anmeldelser).

Kilder (alle gratis):
  - Salgsrapporten (App Store Connect API, salesReports): downloads,
    gen-downloads og opdateringer pr. dag. Kræver ASC_VENDOR_NUMBER.
  - Analytics Reports (App Store Connect API): visninger i App Store,
    sessioner, sletninger og nedbrud. Apple laver først rapporterne ca. to
    døgn efter at anmodningen er oprettet; scriptet opretter den selv første gang.
  - Apples offentlige opslag (itunes.apple.com) og anmeldelses-feed: stjerner
    og anmeldelser, uden nøgle.

Hver del kører for sig: fejler én, gemmes resten, men kørslen ender rød,
så det ses i Kørsler i stedet for at stå grønt uden data.

Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY, ASC_VENDOR_NUMBER,
SUPABASE_URL, DEPLOY_KEY (service_role). Valgfri: ASC_APP_ID, SALES_DAYS,
DRY_RUN=1 (hent og vis tallene uden at gemme), ASC_ADMIN_KEY_ID og
ASC_ADMIN_PRIVATE_KEY (en nøgle med rollen Admin; kun Admin må bede Apple om
Analytics-rapporterne første gang, og nøglen kan slettes bagefter).
"""
import csv
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import jwt

ASC = "https://api.appstoreconnect.apple.com"
APP_ID = os.environ.get("ASC_APP_ID") or "6812713857"
SALES_DAYS = int(os.environ.get("SALES_DAYS") or 35)
# Analytics-rapporter kommer som én instans pr. behandlingsdag.
ANALYTICS_INSTANCES = 10

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY = os.environ.get("DEPLOY_KEY") or ""

# Salgsrapportens "Product Type Identifier" (Apples liste over produkttyper).
NEW_TYPES = {"1", "1F", "1T", "F1"}
REDOWNLOAD_TYPES = {"3", "3F", "3T", "F3"}
UPDATE_TYPES = {"7", "7F", "7T", "F7"}

def log(msg: str) -> None:
    print(msg, flush=True)


# ------------------------------------------------------------------ HTTP
def request(url: str, method: str = "GET", headers: dict | None = None,
            body: bytes | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def load_key(raw: str) -> str:
    """Tåler at nøglen er indsat uden BEGIN/END-linjer eller på én linje."""
    body = "".join(re.sub(r"-----[A-Z ]+-----", "", raw.replace("\\n", "\n")).split())
    lines = "\n".join(body[i:i + 64] for i in range(0, len(body), 64))
    return f"-----BEGIN PRIVATE KEY-----\n{lines}\n-----END PRIVATE KEY-----\n"


_tokens: dict = {}


def asc_token(admin: bool = False) -> str:
    """Adgangsbillet. admin=True bruger den valgfri Admin-nøgle
    (ASC_ADMIN_KEY_ID/ASC_ADMIN_PRIVATE_KEY), som kun skal bruges én gang."""
    prefix = "ASC_ADMIN_" if admin else "ASC_"
    now = time.time()
    cached = _tokens.get(prefix)
    if cached and cached[1] > now + 60:
        return cached[0]
    exp = int(now) + 1200   # Apple tillader højst 20 minutter
    tok = jwt.encode(
        {"iss": os.environ["ASC_ISSUER_ID"].strip(), "iat": int(now), "exp": exp,
         "aud": "appstoreconnect-v1"},
        load_key(os.environ[prefix + "PRIVATE_KEY"]), algorithm="ES256",
        headers={"kid": os.environ[prefix + "KEY_ID"].strip(), "typ": "JWT"})
    _tokens[prefix] = (tok, exp)
    return tok


def asc(path: str, params: dict | None = None, method: str = "GET",
        body: dict | None = None, accept: str = "application/json",
        admin: bool = False) -> tuple[int, bytes]:
    url = path if path.startswith("http") else ASC + path
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    headers = {"Authorization": f"Bearer {asc_token(admin)}", "Accept": accept}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    return request(url, method=method, headers=headers, body=data)


def asc_json(path: str, params: dict | None = None) -> dict:
    status, raw = asc(path, params)
    if status != 200:
        raise RuntimeError(f"{path} svarede {status}: {raw[:300]!r}")
    return json.loads(raw)


def asc_all(path: str, params: dict | None = None, limit: int = 1000) -> list[dict]:
    """Alle sider af en liste (følger links.next)."""
    out: list[dict] = []
    page = asc_json(path, params)
    while True:
        out.extend(page.get("data") or [])
        nxt = (page.get("links") or {}).get("next")
        if not nxt or len(out) >= limit:
            return out
        page = asc_json(nxt)


def tsv_rows(raw: bytes) -> list[dict]:
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    text = raw.decode("utf-8-sig", errors="replace")
    return list(csv.DictReader(io.StringIO(text), delimiter="\t"))


def num(v) -> float:
    try:
        return float(str(v).replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def col(row: dict, *names: str):
    """Kolonne efter navn uden hensyn til store/små bogstaver."""
    low = {k.strip().lower(): v for k, v in row.items() if k}
    for n in names:
        if n in low:
            return low[n]
    return None


# ------------------------------------------------------------ salgsrapport
def fetch_sales(metrics: dict) -> None:
    # Kun cifrene: tåler at navnet eller "#" er kopieret med.
    vendor = re.sub(r"\D", "", os.environ.get("ASC_VENDOR_NUMBER") or "")
    if not vendor:
        raise RuntimeError("ASC_VENDOR_NUMBER mangler i GitHub, så downloads kan ikke hentes")
    today = datetime.now(timezone.utc).date()
    got = 0
    for back in range(1, SALES_DAYS + 1):
        day = today - timedelta(days=back)
        status, raw = asc("/v1/salesReports", {
            "filter[frequency]": "DAILY",
            "filter[reportDate]": day.isoformat(),
            "filter[reportSubType]": "SUMMARY",
            "filter[reportType]": "SALES",
            "filter[vendorNumber]": vendor,
            "filter[version]": "1_1",
        }, accept="application/a-gzip")
        if status == 404:
            # Ingen salg den dag - eller rapporten er ikke klar endnu (gårsdagen
            # kommer først ud på eftermiddagen). Kun ældre dage tælles som 0.
            if back > 2:
                for m in ("downloads", "redownloads", "updates"):
                    metrics[(day, m)] += 0
            continue
        if status != 200:
            raise RuntimeError(f"salgsrapporten for {day} svarede {status}: {raw[:300]!r}")
        got += 1
        for m in ("downloads", "redownloads", "updates"):
            metrics[(day, m)] += 0
        for row in tsv_rows(raw):
            if str(col(row, "apple identifier") or "").strip() != APP_ID:
                continue
            ptype = str(col(row, "product type identifier") or "").strip()
            units = num(col(row, "units"))
            if ptype in NEW_TYPES:
                metrics[(day, "downloads")] += units
            elif ptype in REDOWNLOAD_TYPES:
                metrics[(day, "redownloads")] += units
            elif ptype in UPDATE_TYPES:
                metrics[(day, "updates")] += units
    log(f"salgsrapport: {got} dage med data af {SALES_DAYS}")


# --------------------------------------------------------- analytics
def ensure_request() -> str | None:
    """Id på den løbende analytics-anmodning; oprettes første gang."""
    reqs = asc_all(f"/v1/apps/{APP_ID}/analyticsReportRequests",
                   {"filter[accessType]": "ONGOING"})
    live = [r for r in reqs if not (r.get("attributes") or {}).get("stoppedDueToInactivity")]
    if live:
        return live[0]["id"]
    # Kun en Admin-nøgle må oprette anmodningen; Sales-nøglen kan læse bagefter.
    admin = bool((os.environ.get("ASC_ADMIN_KEY_ID") or "").strip()
                 and (os.environ.get("ASC_ADMIN_PRIVATE_KEY") or "").strip())
    status, raw = asc("/v1/analyticsReportRequests", method="POST", admin=admin, body={
        "data": {
            "type": "analyticsReportRequests",
            "attributes": {"accessType": "ONGOING"},
            "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}},
        }
    })
    if status == 403:
        raise RuntimeError("nøglen må ikke bede Apple om rapporter. Læg en nøgle med "
                           "rollen Admin i ASC_ADMIN_KEY_ID og ASC_ADMIN_PRIVATE_KEY én gang")
    if status not in (200, 201):
        raise RuntimeError(f"kunne ikke bede Apple om rapporter ({status}): {raw[:300]!r}")
    log("analytics: anmodning oprettet - Apple leverer de første tal om ca. to døgn")
    return None


def report_rows(report_id: str) -> list[dict]:
    instances = asc_all(f"/v1/analyticsReports/{report_id}/instances",
                        {"filter[granularity]": "DAILY", "limit": 200})
    instances.sort(key=lambda i: (i.get("attributes") or {}).get("processingDate") or "", reverse=True)
    rows: list[dict] = []
    for inst in instances[:ANALYTICS_INSTANCES]:
        for seg in asc_all(f"/v1/analyticsReportInstances/{inst['id']}/segments"):
            url = (seg.get("attributes") or {}).get("url")
            if not url:
                continue
            status, raw = request(url)   # forhåndssigneret link, ingen nøgle
            if status != 200:
                raise RuntimeError(f"segment svarede {status}")
            rows.extend(tsv_rows(raw))
    return rows


def row_day(row: dict) -> date | None:
    d = str(col(row, "date") or "").strip()
    try:
        return date.fromisoformat(d[:10])
    except ValueError:
        return None


def fetch_analytics(metrics: dict) -> None:
    req_id = ensure_request()
    if not req_id:
        return
    reports = asc_all(f"/v1/analyticsReportRequests/{req_id}/reports")
    by_name = {(r.get("attributes") or {}).get("name", "").lower(): r["id"] for r in reports}
    if not by_name:
        log("analytics: Apple har ikke lavet rapporterne endnu")
        return

    def find(name: str) -> str | None:
        return next((rid for n, rid in by_name.items() if n == name), None)

    rid = find("app store discovery and engagement standard")
    if rid:
        for row in report_rows(rid):
            d = row_day(row)
            event = str(col(row, "event") or "").lower()
            if not d:
                continue
            if "impression" in event:
                metrics[(d, "impressions")] += num(col(row, "counts", "count"))
            elif "page view" in event:
                metrics[(d, "page_views")] += num(col(row, "counts", "count"))

    rid = find("app store installation and deletion standard")
    if rid:
        for row in report_rows(rid):
            d = row_day(row)
            event = str(col(row, "event") or "").lower()
            if d and "delet" in event:
                metrics[(d, "deletions")] += num(col(row, "counts", "count"))

    rid = find("app sessions standard")
    if rid:
        for row in report_rows(rid):
            d = row_day(row)
            if d:
                metrics[(d, "sessions")] += num(col(row, "sessions"))

    rid = find("app crashes")
    if rid:
        for row in report_rows(rid):
            d = row_day(row)
            if not d:
                continue
            n = num(col(row, "crashes", "count", "counts"))
            metrics[(d, "crashes")] += n
            version = str(col(row, "app version") or "").strip()
            if version:
                metrics[(d, f"crashes:{version[:20]}")] += n
    log(f"analytics: {len(by_name)} rapporter fundet")


# ------------------------------------------------ stjerner og anmeldelser
def fetch_ratings(metrics: dict, reviews: list) -> None:
    status, raw = request(f"https://itunes.apple.com/lookup?id={APP_ID}&country=dk")
    if status != 200:
        raise RuntimeError(f"Apples opslag svarede {status}")
    res = (json.loads(raw).get("results") or [{}])[0]
    today = datetime.now(timezone.utc).date()
    metrics[(today, "rating_avg")] = num(res.get("averageUserRating"))
    metrics[(today, "rating_count")] = num(res.get("userRatingCount"))

    status, raw = request(f"https://itunes.apple.com/dk/rss/customerreviews/page=1/id={APP_ID}/sortby=mostrecent/json")
    if status != 200:
        log(f"anmeldelses-feed svarede {status} - springes over")
        return
    entries = ((json.loads(raw).get("feed") or {}).get("entry")) or []
    if isinstance(entries, dict):
        entries = [entries]
    for e in entries:
        if "im:rating" not in e:
            continue   # første post kan være appen selv
        reviews.append({
            "id": str((e.get("id") or {}).get("label") or "")[:100],
            "rating": int(num((e.get("im:rating") or {}).get("label"))),
            "title": str((e.get("title") or {}).get("label") or "")[:300],
            "body": str((e.get("content") or {}).get("label") or "")[:4000],
            "author": str(((e.get("author") or {}).get("name") or {}).get("label") or "")[:100],
            "version": str((e.get("im:version") or {}).get("label") or "")[:20],
            "created_at": (e.get("updated") or {}).get("label"),
        })
    reviews[:] = [r for r in reviews if r["id"]]
    log(f"stjerner: {res.get('averageUserRating')} fra {res.get('userRatingCount')}, {len(reviews)} anmeldelser")


# ------------------------------------------------------------- Supabase
def upsert(table: str, conflict: str, rows: list[dict]) -> None:
    if not rows:
        return
    status, raw = request(
        f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={conflict}", method="POST",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        body=json.dumps(rows).encode(),
    )
    if status not in (200, 201, 204):
        raise RuntimeError(f"Supabase {table} gav {status}: {raw[:300]!r} "
                           "- er scripts/supabase-app-stats.sql kørt?")


def main() -> int:
    dry = bool(os.environ.get("DRY_RUN"))   # kun hent og vis, gem intet
    if not dry and not (SUPABASE_URL and SUPABASE_KEY):
        log("fejl: SUPABASE_URL og DEPLOY_KEY skal være sat")
        return 1
    metrics: dict = defaultdict(float)
    reviews: list = []
    failed = []
    for name, fn in (("salgsrapport", lambda: fetch_sales(metrics)),
                     ("analytics", lambda: fetch_analytics(metrics)),
                     ("stjerner", lambda: fetch_ratings(metrics, reviews))):
        try:
            fn()
        except Exception as e:   # noqa: BLE001 - hver del for sig
            failed.append(name)
            log(f"FEJL i {name}: {type(e).__name__}: {e}")

    now = datetime.now(timezone.utc).isoformat()
    if dry:
        for (d, m), v in sorted(metrics.items()):
            if v:
                log(f"  {d} {m} {v:g}")
        log(f"{len(reviews)} anmeldelser (DRY_RUN, intet gemt)")
        return 1 if failed else 0
    rows = [{"day": d.isoformat(), "metric": m, "value": v, "synced_at": now}
            for (d, m), v in sorted(metrics.items())]
    try:
        upsert("app_store_daily", "day,metric", rows)
        upsert("app_store_reviews", "id", reviews)
    except Exception as e:   # noqa: BLE001
        log(f"FEJL: {e}")
        return 1
    log(f"{len(rows)} målinger og {len(reviews)} anmeldelser gemt")
    if failed:
        log("Disse dele fejlede: " + ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
