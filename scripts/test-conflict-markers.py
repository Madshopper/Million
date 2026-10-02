#!/usr/bin/env python3
"""Fejler hvis en git-konfliktmarkør er committet.

Kør: python3 scripts/test-conflict-markers.py

BAGGRUNDEN: 02-10-2026 stod "<<<<<<< HEAD ======= >>>>>>> origin/main" som
synlig tekst øverst på madshopper.dk. En merge i templates/base.html var
committet med konfliktmarkørerne i, og intet tjek opdagede det, før en bruger
så det. Testen kører i deploy-workflows (blokerer deploy) og på hver PR.

Søger kun i filer git kender (git ls-files), så dist/, node_modules/ osv.
ikke tæller med. En markør er en linje der STARTER med 7 tegn efterfulgt af
mellemrum eller linjeslut; "=======" alene på en linje tæller kun med, hvis
samme fil også har en "<<<<<<<"- eller ">>>>>>>"-linje (Markdown/rst bruger
"=======" som overskriftslinje).
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OPEN_CLOSE = re.compile(rb"^(<{7}|>{7}|\|{7})(?: |$)")
SEPARATOR = re.compile(rb"^={7}$")


def main() -> int:
    files = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True
    ).stdout.split(b"\0")
    hits: list[str] = []
    for name in filter(None, files):
        path = ROOT / name.decode()
        try:
            data = path.read_bytes()
        except (FileNotFoundError, IsADirectoryError):
            continue
        if b"\0" in data[:8000]:
            continue  # binær fil
        lines = data.splitlines()
        marks = [i for i, l in enumerate(lines, 1) if OPEN_CLOSE.match(l.rstrip(b"\r"))]
        if not marks:
            continue
        marks += [i for i, l in enumerate(lines, 1) if SEPARATOR.match(l.rstrip(b"\r"))]
        hits += [f"{name.decode()}:{i}" for i in sorted(marks)]
    if hits:
        print("FEJL: git-konfliktmarkører fundet:")
        for h in hits:
            print("  " + h)
        return 1
    print("OK: ingen git-konfliktmarkører")
    return 0


if __name__ == "__main__":
    sys.exit(main())
