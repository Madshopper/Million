"""Poster næste video fra some/koe/ på Facebook-siden og Instagram (Reels).

Kalle 31-10-2026: alle videoer der laves, lægges i en mappe, som et job selv
tager fra og poster mandag og torsdag kl. 19.30, uden at han gør noget.

Køen er filer i some/koe/:
    2026-11-02-velkommen.mp4   videoen
    2026-11-02-velkommen.md    teksterne, under "# Facebook" og "# Instagram"

Datoen i navnet er den tidligste dag den må komme ud. Hver kørsel poster den
ÆLDSTE video, hvis dato er nået, og kun én. Er en kørsel faldet ud, rykker
resten altså en plads, i stedet for at to videoer kommer ud samme aften.

Når en platform er postet, skrives det i <navn>.status.json, så en kørsel der
fejler halvvejs (fx Instagram nede) aldrig poster på Facebook igen. Når begge
er postet, flyttes teksten og status til some/postet/, og videoen slettes fra
repoet (den ligger stadig i projektmappen). Workflowet committer ændringerne.

    python scripts/some-post.py           # poster næste video (kræver nøgle)
    python scripts/some-post.py --check   # tjekker køen, poster intet

Kræver GitHub-secret META_PAGE_TOKEN: en sidenøgle til Facebook-siden
MadShopper, der aldrig udløber (some/README.md). Siden og Instagram-kontoen
findes ud fra nøglen.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
KOE = ROOT / "some" / "koe"
POSTET = ROOT / "some" / "postet"
DK = ZoneInfo("Europe/Copenhagen")
GRAPH_VERSION = os.environ.get("META_GRAPH_VERSION", "v23.0")
GRAPH = f"https://graph.facebook.com/{GRAPH_VERSION}"
RUPLOAD = "https://rupload.facebook.com"
NAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-[a-z0-9-]+$")
PLATFORMS = ("facebook", "instagram")

# Instagram: højst 2.200 tegn og 30 hashtags. Reels: 3-90 sekunder.
IG_MAX_CHARS = 2200
IG_MAX_TAGS = 30
MIN_SECONDS, MAX_SECONDS = 3, 90


def parse_captions(path: Path) -> dict:
    """'# Facebook' / '# Instagram'-afsnit -> {'facebook': tekst, ...}."""
    out, cur, lines = {}, None, []
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^#\s+(facebook|instagram)\s*$", line.strip(), re.I)
        if m:
            if cur:
                out[cur] = "\n".join(lines).strip()
            cur, lines = m.group(1).lower(), []
        elif cur:
            lines.append(line)
    if cur:
        out[cur] = "\n".join(lines).strip()
    return out


def video_seconds(path: Path) -> float | None:
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                            "-of", "csv=p=0", str(path)], capture_output=True, text=True, timeout=30)
        return float(r.stdout.strip())
    except Exception:
        return None


def queue() -> list[tuple[str, str]]:
    """[(dato, navn)] sorteret, ældste først."""
    items = []
    for mp4 in KOE.glob("*.mp4"):
        m = NAME_RE.match(mp4.stem)
        if m:
            items.append((m.group(1), mp4.stem))
    return sorted(items)


def check() -> list[str]:
    """Fejl i køen. Tom liste = alt i orden."""
    errors = []
    for f in KOE.iterdir() if KOE.exists() else []:
        if f.name.startswith(".") or f.name == "README.md":
            continue
        stem = f.name.split(".")[0]
        if not NAME_RE.match(stem):
            errors.append(f"{f.name}: navnet skal være ÅÅÅÅ-MM-DD-navn (små bogstaver)")
        elif f.suffix == ".md" and not (KOE / f"{stem}.mp4").exists():
            errors.append(f"{f.name}: videoen {stem}.mp4 mangler")
    for date, name in queue():
        try:
            dt.date.fromisoformat(date)
        except ValueError:
            errors.append(f"{name}: {date} er ikke en dato")
        md = KOE / f"{name}.md"
        if not md.exists():
            errors.append(f"{name}: teksten {name}.md mangler")
            continue
        caps = parse_captions(md)
        for p in PLATFORMS:
            if not caps.get(p):
                errors.append(f"{name}.md: afsnittet '# {p.capitalize()}' mangler eller er tomt")
        ig = caps.get("instagram", "")
        if len(ig) > IG_MAX_CHARS:
            errors.append(f"{name}.md: Instagram-teksten er {len(ig)} tegn (højst {IG_MAX_CHARS})")
        if len(re.findall(r"#\w", ig)) > IG_MAX_TAGS:
            errors.append(f"{name}.md: over {IG_MAX_TAGS} hashtags til Instagram")
        secs = video_seconds(KOE / f"{name}.mp4")
        if secs is not None and not MIN_SECONDS <= secs <= MAX_SECONDS:
            errors.append(f"{name}.mp4: {secs:.1f} s (Reels skal være {MIN_SECONDS}-{MAX_SECONDS} s)")
    return errors


# ---------- Meta Graph API ----------

def _req():
    import requests
    return requests


def graph(method: str, path: str, token: str, **params) -> dict:
    # POST sender felterne i body, så lange tekster med emoji ikke står i URL'en.
    fields = {**params, "access_token": token}
    r = _req().request(method, f"{GRAPH}/{path}", timeout=60,
                       **({"data": fields} if method == "POST" else {"params": fields}))
    data = r.json() if r.content else {}
    if r.status_code >= 400 or "error" in data:
        err = data.get("error", {})
        # Nøglen må aldrig stå i loggen; Metas fejltekst indeholder den ikke.
        raise RuntimeError(f"Meta svarede {r.status_code} på {path.split('?')[0]}: "
                           f"{err.get('message') or r.text[:300]}")
    return data


def rupload(url: str, token: str, video: Path) -> dict:
    body = video.read_bytes()
    r = _req().post(url, data=body, timeout=600, headers={
        "Authorization": f"OAuth {token}", "offset": "0", "file_size": str(len(body))})
    if r.status_code >= 400:
        raise RuntimeError(f"Upload af videoen fejlede ({r.status_code}): {r.text[:300]}")
    return r.json() if r.content else {}


def accounts(token: str) -> tuple[str, str]:
    """(side-id, instagram-id) ud fra sidenøglen."""
    me = graph("GET", "me", token, fields="id,name,instagram_business_account")
    ig = (me.get("instagram_business_account") or {}).get("id")
    if not ig:
        raise RuntimeError(f"Siden {me.get('name')} har ingen Instagram-konto koblet på. "
                           "Kobl den i Meta Business Suite (Indstillinger > Konti > Instagram).")
    print(f"Side: {me.get('name')} ({me['id']}), Instagram: {ig}")
    return me["id"], ig


def post_facebook(token: str, page: str, video: Path, caption: str) -> str:
    start = graph("POST", f"{page}/video_reels", token, upload_phase="start")
    vid = start["video_id"]
    rupload(start.get("upload_url") or f"{RUPLOAD}/video-upload/{GRAPH_VERSION}/{vid}", token, video)
    graph("POST", f"{page}/video_reels", token, upload_phase="finish", video_id=vid,
          video_state="PUBLISHED", description=caption)
    # Facebook behandler videoen bagefter; vent til den er ude, så en fejl ses her.
    for _ in range(60):
        st = graph("GET", vid, token, fields="status").get("status", {})
        if st.get("video_status") == "ready" or (st.get("publishing_phase") or {}).get("status") == "complete":
            return vid
        if st.get("video_status") == "error":
            raise RuntimeError(f"Facebook kunne ikke behandle videoen: {json.dumps(st)[:300]}")
        time.sleep(10)
    print("Facebook: videoen er sendt, men var ikke færdigbehandlet efter 10 min.")
    return vid


def post_instagram(token: str, ig: str, video: Path, caption: str) -> str:
    cont = graph("POST", f"{ig}/media", token, media_type="REELS", upload_type="resumable",
                 caption=caption, share_to_feed="true")
    cid = cont["id"]
    rupload(cont.get("uri") or f"{RUPLOAD}/ig-api-upload/{GRAPH_VERSION}/{cid}", token, video)
    for _ in range(60):
        code = graph("GET", cid, token, fields="status_code").get("status_code")
        if code == "FINISHED":
            break
        if code in ("ERROR", "EXPIRED"):
            raise RuntimeError(f"Instagram kunne ikke behandle videoen ({code})")
        time.sleep(10)
    else:
        raise RuntimeError("Instagram blev ikke færdig med videoen på 10 min")
    return graph("POST", f"{ig}/media_publish", token, creation_id=cid)["id"]


def post_next(today: dt.date) -> int:
    due = [(d, n) for d, n in queue() if dt.date.fromisoformat(d) <= today]
    if not due:
        print(f"Ingen video i køen med dato til og med {today}.")
        return 0
    _, name = due[0]
    video, md = KOE / f"{name}.mp4", KOE / f"{name}.md"
    status_path = KOE / f"{name}.status.json"
    status = json.loads(status_path.read_text()) if status_path.exists() else {}
    caps = parse_captions(md)

    token = os.environ.get("META_PAGE_TOKEN", "").strip()
    if not token:
        print("META_PAGE_TOKEN mangler i GitHub-secrets, så intet er postet. Se some/README.md.",
              file=sys.stderr)
        return 1
    page, ig = accounts(token)
    failed = False
    for p, fn, target in (("facebook", post_facebook, page), ("instagram", post_instagram, ig)):
        if p in status:
            print(f"{p}: allerede postet {status[p]['at']}")
            continue
        try:
            pid = fn(token, target, video, caps[p])
        except Exception as e:  # noqa: BLE001 - den anden platform skal stadig prøves
            print(f"{p}: FEJL: {e}", file=sys.stderr)
            failed = True
            continue
        status[p] = {"id": pid, "at": dt.datetime.now(DK).isoformat(timespec="seconds")}
        status_path.write_text(json.dumps(status, indent=1) + "\n")
        print(f"{p}: postet ({pid})")
    if failed:
        return 1
    POSTET.mkdir(parents=True, exist_ok=True)
    md.rename(POSTET / md.name)
    status_path.rename(POSTET / status_path.name)
    video.unlink()
    print(f"{name}: postet begge steder og flyttet til some/postet/")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="tjek køen, post intet")
    args = ap.parse_args()
    errors = check()
    for e in errors:
        print("FEJL:", e, file=sys.stderr)
    if args.check:
        for d, n in queue():
            print(d, n)
        return 1 if errors else 0
    if errors:
        print("Køen har fejl, så intet er postet.", file=sys.stderr)
        return 1
    return post_next(dt.datetime.now(DK).date())


if __name__ == "__main__":
    sys.exit(main())
