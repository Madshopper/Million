#!/usr/bin/env python3
"""Poster næste video fra social/koe/ som reel på Facebook-siden MadShopper og
Instagram-kontoen madshopper.dk. Køres af .github/workflows/social-post.yml,
som uptime-workeren starter mandag og torsdag kl. 19.30 dansk tid.

BEGGE ELLER INGEN (Kalle 31-10-2026: aldrig en video på Instagram uden
Facebook). Rækkefølgen sikrer det:
  1. Tjek video, tekst og nøgle, og at nøglen virker for både siden og
     Instagram-kontoen. Fejler noget, postes intet.
  2. Instagram-videoen uploades og behandles, men udgives IKKE endnu.
  3. Facebook-reelen udgives, og vi venter til Facebook melder den ude.
  4. Først nu udgives Instagram-videoen (med genforsøg).
Fejler 2 eller 3, er intet udgivet (en uudgivet Instagram-upload udløber selv
efter 24 timer). Fejler 4 efter alle forsøg, er kun Facebook ude: kørslen
bliver rød, og videoen flyttes alligevel til social/udgivet/, så den ikke
kommer på Facebook to gange.

Uden nøglen META_PAGE_TOKEN (sidenøgle der aldrig udløber, se
social/README.md) stopper scriptet pænt uden fejl, så kørslerne ikke er røde,
mens nøglen mangler.

Kørsel: python3 scripts/social-post.py [--dry-run]
  --dry-run: tjekker alt (også nøglen mod Meta), men uploader intet.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
QUEUE = ROOT / "social" / "koe"
DONE = ROOT / "social" / "udgivet"
HISTORY = DONE / "historik.csv"

GRAPH = "https://graph.facebook.com/v25.0"
RUPLOAD = "https://rupload.facebook.com"
VIDEO_EXT = {".mp4", ".mov"}

# Facebook-reels: 3-90 sekunder. Instagram tillader længere, men begge skal
# kunne tage videoen, ellers kommer den kun ét sted.
MIN_SECONDS, MAX_SECONDS = 3.0, 90.0
MAX_BYTES = 1024 * 1024 * 1024  # 1 GB (Facebooks grænse for reels)
CAPTION_MAX = 2200              # Instagrams grænse

TIMEOUT = 60
UPLOAD_TIMEOUT = 600


class PostError(Exception):
    pass


def notice(msg: str) -> None:
    print(f"::notice::{msg}")


def warning(msg: str) -> None:
    print(f"::warning::{msg}")


def error(msg: str) -> None:
    print(f"::error::{msg}")


# ---------------------------------------------------------------- køen

def next_video() -> Path | None:
    if not QUEUE.is_dir():
        return None
    videos = sorted(p for p in QUEUE.iterdir()
                    if p.is_file() and p.suffix.lower() in VIDEO_EXT)
    return videos[0] if videos else None


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_caption(video: Path) -> str:
    txt = video.with_suffix(".txt")
    if not txt.is_file():
        raise PostError(f"Teksten mangler: læg {rel(txt)} ved siden af videoen.")
    caption = txt.read_text(encoding="utf-8").strip()
    if not caption:
        raise PostError(f"{rel(txt)} er tom.")
    if len(caption) > CAPTION_MAX:
        raise PostError(f"Teksten er {len(caption)} tegn; Instagram tillader højst {CAPTION_MAX}.")
    return caption


def check_video(video: Path) -> None:
    size = video.stat().st_size
    if size == 0:
        raise PostError(f"{video.name} er tom.")
    if size > MAX_BYTES:
        raise PostError(f"{video.name} fylder over 1 GB.")
    if not shutil.which("ffprobe"):
        warning("ffprobe findes ikke; videoens længde og format tjekkes ikke før upload.")
        return
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height:format=duration", "-of", "json", str(video)],
        capture_output=True, text=True, check=False)
    if out.returncode != 0:
        raise PostError(f"{video.name} kan ikke læses som video: {out.stderr.strip()[:200]}")
    info = json.loads(out.stdout or "{}")
    duration = float(info.get("format", {}).get("duration") or 0)
    streams = info.get("streams") or [{}]
    w, h = streams[0].get("width") or 0, streams[0].get("height") or 0
    if not (MIN_SECONDS <= duration <= MAX_SECONDS):
        raise PostError(f"{video.name} varer {duration:.1f} s; reels skal være "
                        f"{MIN_SECONDS:.0f}-{MAX_SECONDS:.0f} s.")
    if w and h and w >= h:
        warning(f"{video.name} er {w}x{h} (ikke stående). Reels vises bedst i 9:16 (fx 1080x1920).")


# ---------------------------------------------------------------- Meta

def graph(method: str, path: str, token: str, **params) -> dict:
    params["access_token"] = token
    try:
        res = requests.request(method, f"{GRAPH}/{path}",
                               params=params if method == "GET" else None,
                               data=params if method != "GET" else None,
                               timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise PostError(f"Meta kunne ikke nås ({path.split('?')[0]}): {exc}") from exc
    try:
        body = res.json()
    except ValueError:
        body = {}
    if res.status_code >= 400 or "error" in body:
        err = body.get("error", {})
        raise PostError(f"Meta afviste {method} {path.split('?')[0]}: "
                        f"{err.get('message') or res.text[:300]} (kode {err.get('code')})")
    return body


def rupload(url: str, token: str, video: Path) -> dict:
    size = video.stat().st_size
    with video.open("rb") as fh:
        try:
            res = requests.post(url, data=fh, timeout=UPLOAD_TIMEOUT, headers={
                "Authorization": f"OAuth {token}",
                "offset": "0",
                "file_size": str(size),
                "Content-Type": "application/octet-stream",
            })
        except requests.RequestException as exc:
            raise PostError(f"Upload af videoen fejlede: {exc}") from exc
    try:
        body = res.json()
    except ValueError:
        body = {}
    if res.status_code >= 400 or body.get("success") is False or "error" in body:
        raise PostError(f"Upload af videoen blev afvist: {res.text[:300]}")
    return body


def accounts(token: str) -> tuple[str, str, str]:
    """(side-id, instagram-id, instagram-brugernavn). Fejler hvis nøglen ikke
    er en sidenøgle med koblet Instagram-konto."""
    me = graph("GET", "me", token, fields="id,name,instagram_business_account{id,username}")
    ig = me.get("instagram_business_account") or {}
    if not ig.get("id"):
        raise PostError(f"Nøglen hører til '{me.get('name')}', men der er ingen Instagram-konto "
                        "koblet til. Er det sidenøglen (fra me/accounts) og ikke brugernøglen?")
    return me["id"], ig["id"], ig.get("username", "?")


def ig_prepare(ig_id: str, token: str, video: Path, caption: str) -> str:
    """Uploader og venter på behandling. Udgiver ikke."""
    container = graph("POST", f"{ig_id}/media", token, media_type="REELS",
                      upload_type="resumable", caption=caption, share_to_feed="true")
    cid = container["id"]
    rupload(f"{RUPLOAD}/ig-api-upload/v25.0/{cid}", token, video)
    for _ in range(60):  # op til 10 min
        status = graph("GET", cid, token, fields="status_code,status")
        code = status.get("status_code")
        if code == "FINISHED":
            return cid
        if code in ("ERROR", "EXPIRED"):
            raise PostError(f"Instagram kunne ikke behandle videoen: {status.get('status')}")
        time.sleep(10)
    raise PostError("Instagram blev ikke færdig med at behandle videoen inden for 10 minutter.")


def fb_publish(page_id: str, token: str, video: Path, caption: str) -> str:
    start = graph("POST", f"{page_id}/video_reels", token, upload_phase="start")
    vid = start["video_id"]
    rupload(start.get("upload_url") or f"{RUPLOAD}/video-upload/v25.0/{vid}", token, video)
    graph("POST", f"{page_id}/video_reels", token, upload_phase="finish",
          video_id=vid, video_state="PUBLISHED", description=caption)
    for _ in range(60):  # op til 10 min
        status = graph("GET", vid, token, fields="status").get("status", {})
        if status.get("video_status") == "error":
            raise PostError(f"Facebook kunne ikke behandle videoen: {json.dumps(status)[:300]}")
        if (status.get("publishing_phase", {}).get("status") == "complete"
                or status.get("video_status") == "ready"):
            return vid
        time.sleep(10)
    raise PostError("Facebook blev ikke færdig med reelen inden for 10 minutter; "
                    "tjek siden, før der postes igen.")


def ig_publish(ig_id: str, token: str, cid: str) -> str:
    last = None
    for attempt in range(4):
        try:
            return graph("POST", f"{ig_id}/media_publish", token, creation_id=cid)["id"]
        except PostError as exc:
            last = exc
            time.sleep(15 * (attempt + 1))
    raise PostError(f"Instagram-udgivelsen fejlede efter 4 forsøg: {last}")


# ---------------------------------------------------------------- arkiv

def archive(video: Path, fb_id: str, ig_id: str) -> None:
    DONE.mkdir(parents=True, exist_ok=True)
    for src in (video, video.with_suffix(".txt")):
        if src.exists():
            shutil.move(str(src), DONE / src.name)
    new = not HISTORY.exists()
    with HISTORY.open("a", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(["tidspunkt_utc", "fil", "facebook_video_id", "instagram_media_id"])
        w.writerow([dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M"),
                    video.name, fb_id, ig_id])


# ---------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    video = next_video()
    if video is None:
        warning("Køen social/koe/ er tom; intet at poste i dag.")
        return 0
    print(f"Næste video: {video.name}")
    try:
        caption = read_caption(video)
        check_video(video)
    except PostError as exc:
        error(f"{exc} Intet er postet.")
        return 1

    token = os.environ.get("META_PAGE_TOKEN", "").strip()
    if not token:
        notice("META_PAGE_TOKEN er ikke sat endnu; intet postet. Se social/README.md.")
        return 0

    try:
        page_id, ig_id, ig_user = accounts(token)
    except PostError as exc:
        error(f"{exc} Intet er postet.")
        return 1
    print(f"Nøglen virker for siden {page_id} og Instagram @{ig_user}.")

    if args.dry_run:
        notice(f"Prøvekørsel: {video.name} ville blive postet på Facebook og @{ig_user}. "
               "Intet er uploadet.")
        return 0

    try:
        cid = ig_prepare(ig_id, token, video, caption)
        print("Instagram: uploadet og behandlet (ikke udgivet endnu).")
    except PostError as exc:
        error(f"{exc} Intet er udgivet.")
        return 1
    try:
        fb_id = fb_publish(page_id, token, video, caption)
        print(f"Facebook: udgivet ({fb_id}).")
    except PostError as exc:
        error(f"{exc} Instagram er IKKE udgivet. Tjek Facebook-siden, om reelen alligevel "
              "kom ud, før videoen prøves igen (den ligger stadig i social/koe/).")
        return 1

    try:
        ig_media = ig_publish(ig_id, token, cid)
    except PostError as exc:
        archive(video, fb_id, "")
        error(f"KUN FACEBOOK: {exc} Videoen er udgivet på Facebook, men ikke på Instagram. "
              "Den er flyttet til social/udgivet/, så den ikke kommer på Facebook igen.")
        return 1

    archive(video, fb_id, ig_media)
    notice(f"{video.name} er udgivet på Facebook og Instagram @{ig_user}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
