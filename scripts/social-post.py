#!/usr/bin/env python3
"""Poster næste video fra social/koe/ som reel på Facebook-siden MadShopper og
Instagram-kontoen madshopper.dk. Køres af .github/workflows/social-post.yml,
som uptime-workeren starter mandag og torsdag kl. 19.30 dansk tid.

SELVE POSTERINGEN SKER I MAKE.COM (Kalle 13-11-2026). Metas egen vej kræver
en udviklerkonto, og den kræver en sms-kode, som Meta ikke kan sende til
Kalles nummer. Make har sin egen godkendte Meta-app; Kalle har forbundet
siden og Instagram med sit eget login dér. Scriptet sender kun et link til
videoen og teksten til Make-scenariets webhook (MAKE_WEBHOOK_URL), og
videoen hentes direkte fra repoet af Meta, så den aldrig går gennem Make
(gratisplanen har 100 MB dataoverførsel om måneden).

ALDRIG INSTAGRAM UDEN FACEBOOK (Kalle 31-10-2026). Make-scenariet poster
Facebook-reelen først og kun derefter Instagram. Scenariet svarer med JSON:
  {"status": "ok", "facebook_id": ..., "instagram_id": ...}
  {"status": "fb_failed", "error": ...}      intet er udgivet
  {"status": "ig_failed", "facebook_id": ..., "error": ...}  kun Facebook
Når Facebook er ude (ok eller ig_failed), flyttes videoen til
social/udgivet/, så den aldrig kommer på Facebook to gange. Svarer Make ikke
med JSON (fx "Accepted", fordi Meta var længe om videoen), ved vi ikke om den
kom ud: videoen flyttes alligevel, og kørslen bliver rød, så nogen kigger på
siden. Hellere en video for lidt end en dobbelt.

Uden MAKE_WEBHOOK_URL stopper scriptet pænt uden fejl.

Kørsel: python3 scripts/social-post.py [--dry-run]
  --dry-run: tjekker video, tekst, webhook og at videolinket virker, men
  kalder ikke Make.
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
from pathlib import Path
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parent.parent
QUEUE = ROOT / "social" / "koe"
DONE = ROOT / "social" / "udgivet"
HISTORY = DONE / "historik.csv"
REPO = os.environ.get("GITHUB_REPOSITORY", "Madshopper/Million")

VIDEO_EXT = {".mp4", ".mov"}
# Facebook-reels: 3-90 sekunder. Instagram tillader længere, men begge skal
# kunne tage videoen, ellers kommer den kun ét sted.
MIN_SECONDS, MAX_SECONDS = 3.0, 90.0
MAX_BYTES = 100 * 1024 * 1024  # GitHubs grænse for en fil i repoet
CAPTION_MAX = 2200             # Instagrams grænse
# Make venter op til et par minutter på scenariets svar; Meta skal nå at
# hente og behandle videoen to gange imens.
MAKE_TIMEOUT = 330


class PostError(Exception):
    pass


def notice(msg: str) -> None:
    print(f"::notice::{msg}")


def warning(msg: str) -> None:
    print(f"::warning::{msg}")


def error(msg: str) -> None:
    print(f"::error::{msg}")


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


# ---------------------------------------------------------------- køen

def next_video() -> Path | None:
    if not QUEUE.is_dir():
        return None
    videos = sorted(p for p in QUEUE.iterdir()
                    if p.is_file() and p.suffix.lower() in VIDEO_EXT)
    return videos[0] if videos else None


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
        raise PostError(f"{video.name} fylder over 100 MB.")
    if not shutil.which("ffprobe"):
        warning("ffprobe findes ikke; videoens længde og format tjekkes ikke.")
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


# ---------------------------------------------------------------- link + Make

def commit_sha() -> str:
    sha = os.environ.get("GITHUB_SHA", "").strip()
    if sha:
        return sha
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True,
                          text=True, check=True).stdout.strip()


def video_url(video: Path) -> str:
    """Offentligt link til videoen på netop denne commit, så linket ikke
    ændrer sig, når videoen bagefter flyttes til social/udgivet/."""
    path = quote(rel(video).replace(os.sep, "/"))
    return f"https://raw.githubusercontent.com/{REPO}/{commit_sha()}/{path}"


def check_url(url: str) -> None:
    try:
        res = requests.head(url, timeout=30, allow_redirects=True)
    except requests.RequestException as exc:
        raise PostError(f"Videolinket kunne ikke nås: {exc}") from exc
    if res.status_code != 200:
        raise PostError(f"Videolinket svarer {res.status_code} ({url}). Er repoet privat? "
                        "Meta kan kun hente videoen fra et offentligt link.")
    ctype = res.headers.get("content-type", "")
    if not ctype.startswith("video/"):
        warning(f"Videolinket sendes som '{ctype}', ikke video/*. Meta kan afvise den.")


def call_make(webhook: str, url: str, caption: str, name: str) -> dict:
    try:
        res = requests.post(webhook, json={"video_url": url, "caption": caption, "file": name},
                            timeout=MAKE_TIMEOUT)
    except requests.Timeout:
        return {"status": "unknown", "error": f"Make svarede ikke inden for {MAKE_TIMEOUT} s"}
    except requests.RequestException as exc:
        # Nåede kaldet aldrig frem, er intet startet.
        raise PostError(f"Make kunne ikke nås: {exc}") from exc
    try:
        body = res.json()
    except ValueError:
        body = None
    if res.status_code == 410 or (res.status_code == 400 and not isinstance(body, dict)):
        raise PostError(f"Make afviste kaldet ({res.status_code}: {res.text[:200]}). "
                        "Er scenariet slået til, og er MAKE_WEBHOOK_URL rigtig?")
    if not isinstance(body, dict) or "status" not in body:
        return {"status": "unknown", "error": f"Make svarede {res.status_code}: {res.text[:200]}"}
    return body


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
            w.writerow(["tidspunkt_utc", "fil", "facebook_id", "instagram_id"])
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

    webhook = os.environ.get("MAKE_WEBHOOK_URL", "").strip()
    if not webhook:
        notice("MAKE_WEBHOOK_URL er ikke sat endnu; intet postet. Se social/README.md.")
        return 0

    url = video_url(video)
    try:
        check_url(url)
    except PostError as exc:
        error(f"{exc} Intet er postet.")
        return 1

    if args.dry_run:
        notice(f"Prøvekørsel: {video.name} og teksten er klar, og videolinket virker. "
               "Make er ikke kaldt, intet er postet.")
        return 0

    result = call_make(webhook, url, caption, video.name)
    status = result.get("status")
    fb_id = str(result.get("facebook_id") or "")
    ig_id = str(result.get("instagram_id") or "")
    why = result.get("error") or ""

    if status == "ok":
        archive(video, fb_id, ig_id)
        notice(f"{video.name} er udgivet på Facebook og Instagram.")
        return 0
    if status == "fb_failed":
        error(f"Facebook afviste videoen: {why} Intet er udgivet; videoen ligger stadig i social/koe/.")
        return 1
    if status == "ig_failed":
        archive(video, fb_id, "")
        error(f"KUN FACEBOOK: Instagram afviste videoen: {why} Den er flyttet til "
              "social/udgivet/, så den ikke kommer på Facebook igen.")
        return 1
    archive(video, fb_id, ig_id)
    error(f"Ukendt udfald ({why}). Tjek Facebook-siden og Instagram. Videoen er flyttet "
          "til social/udgivet/, så den ikke risikerer at komme ud to gange.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
