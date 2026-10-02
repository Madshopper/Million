#!/usr/bin/env python3
"""Håndhæver den automatiske cache-busting af statiske assets.

Kør: python3 scripts/test-cache-bust.py   (efter scripts/build-pages.sh, hvis
dist/ skal kontrolleres; REQUIRE_DIST=1 gør en manglende dist/ til en fejl)

BAGGRUNDEN: /static/* serveres `immutable` i et år. Tidligere skulle ?v=<n> i
templates hæves i hånden ved hver ændring, og det blev glemt igen og igen:
login brød for alle (c7c0efd), og 02-10-2026 stod "Spring til indhold" synligt
øverst på siden, fordi styles.css' nye regel aldrig nåede browserne.

Nu sætter app.py::_static_cache_bust selv ?v=<indholds-hash> på alle
url_for('static', ...). Testen sikrer at:
  1) ingen template skriver ?v= selv efter url_for('static', ...),
  2) bygge-scriptet og app.py hasher med samme algoritme,
  3) dist/python_modules/static_hashes.json (som edge læser) findes, matcher
     de nuværende filer og dækker hver statisk fil templates refererer.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "templates"
DIST_HASHES = ROOT / "dist" / "python_modules" / "static_hashes.json"

fails: list[str] = []


def check(label: str, ok: bool) -> None:
    print(("  OK   " if ok else "  FEJL ") + label)
    if not ok:
        fails.append(label)


def load_builder():
    spec = importlib.util.spec_from_file_location(
        "build_static_hashes", ROOT / "scripts" / "build-static-hashes.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    # --- 1) Ingen manuelle ?v= ----------------------------------------------
    static_ref = re.compile(r"""url_for\(\s*['"]static['"]\s*,\s*filename\s*=\s*['"]([^'"]+)['"]\s*\)\s*\}\}(\?v=)?""")
    referenced: set[str] = set()
    for tpl in sorted(TEMPLATES.rglob("*.html")):
        rel = tpl.relative_to(ROOT).as_posix()
        for m in static_ref.finditer(tpl.read_text(encoding="utf-8")):
            referenced.add(m.group(1))
            check(f"{rel}: {m.group(1)} har ingen manuel ?v=", m.group(2) is None)

    # --- 2) Samme algoritme i bygget og i app.py -----------------------------
    builder = load_builder()
    app_src = (ROOT / "app.py").read_text(encoding="utf-8")
    m = re.search(r"^_STATIC_HASH_LEN = (\d+)$", app_src, re.M)
    check("app.py og build-static-hashes.py bruger samme hash-længde",
          bool(m) and int(m.group(1)) == builder.HASH_LEN)
    check("app.py::_static_file_hash bruger sha256",
          re.search(r"def _static_file_hash\(.*?\n(?:    .*\n)*?.*hashlib\.sha256", app_src) is not None)
    prefixes = re.search(r"^_STATIC_NO_HASH_PREFIXES = \(([^)]*)\)", app_src, re.M)
    no_hash = tuple(re.findall(r"'([^']+)'", prefixes.group(1))) if prefixes else ()

    # --- 3) Edge-hashene -----------------------------------------------------
    if not DIST_HASHES.exists():
        if os.environ.get("REQUIRE_DIST") == "1":
            check(f"{DIST_HASHES.relative_to(ROOT)} findes", False)
        else:
            print(f"\n(ingen {DIST_HASHES.relative_to(ROOT)} - kør scripts/build-pages.sh for at teste den)")
    else:
        built = json.loads(DIST_HASHES.read_text(encoding="utf-8"))
        check("static_hashes.json matcher de nuværende filer i static/", built == builder.build())
        for ref in sorted(referenced):
            if ref.startswith(no_hash):
                continue
            check(f"static_hashes.json har en hash for {ref}", ref in built)

    print()
    if fails:
        print(f"{len(fails)} KONTROL(LER) FEJLEDE")
        print("Fjern ?v= fra templates - url_for('static', ...) sætter den selv.")
        return 1
    print("ALLE TESTS BESTAAET")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
