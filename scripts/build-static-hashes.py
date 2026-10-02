#!/usr/bin/env python3
"""Skriver {sti: indholds-hash} for alle filer i static/ som JSON.

Kør: python3 scripts/build-static-hashes.py <ud-fil>

Bruges af scripts/build-pages.sh. app.py::_static_cache_bust sætter
?v=<hash> på alle url_for('static', ...), så en ændret fil altid får en ny
URL. Algoritmen SKAL matche app.py::_static_file_hash (sha256, 10 hex-tegn),
ellers giver lokal udvikling og edge forskellige URL'er for samme fil -
scripts/test-cache-bust.py kontrollerer det.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
HASH_LEN = 10

# Filer templates SKAL kunne få en hash til. Mangler en af dem, er noget galt
# med bygget, og det skal fejle frem for at sende sider uden cache-busting ud.
REQUIRED = ("css/styles.css", "js/script.js", "js/auth.js")


def build() -> dict[str, str]:
    return {
        p.relative_to(STATIC).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()[:HASH_LEN]
        for p in sorted(STATIC.rglob("*"))
        if p.is_file()
    }


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    hashes = build()
    missing = [f for f in REQUIRED if f not in hashes]
    if missing:
        print(f"fejl: ingen hash for {missing} - findes static/ ?", file=sys.stderr)
        return 1
    out = Path(sys.argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(hashes, sort_keys=True, separators=(",", ":")), encoding="utf-8")
    print(f"==> {len(hashes)} statiske filer hashet til {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
