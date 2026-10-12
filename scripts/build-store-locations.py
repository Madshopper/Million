"""Henter adresserne på alle butikker i vores kæder fra OpenStreetMap.

Feature 'lokation' (app.py::_FEATURES): "Butikker nær mig" og rækkefølgen i
"Billigste butikker". Filen static/data/butikker.json bruges af browseren og
appen, som selv regner ud hvilke butikker der er tæt på. Brugerens placering
sendes derfor aldrig til os.

Kilden er OpenStreetMap via Overpass (gratis, ingen nøgle). Data er under
ODbL: "© OpenStreetMap-bidragydere" skal stå hvor listen bruges.

    python scripts/build-store-locations.py            # via Overpass
    python scripts/build-store-locations.py --geojsonseq butikker.geojsonseq
    python scripts/build-store-locations.py --check    # kun tæl, skriv intet

Overpass-serverne giver tit 504 på hele Danmark, så den månedlige kørsel
bruger i stedet Geofabriks gratis Danmark-udtræk og osmium (se workflowet).

Kører én gang om måneden i store-locations.yml. Fejler hellere end at skrive
en halv liste: hver kæde skal have mindst én butik, og der skal være mindst
MIN_TOTAL butikker i alt.
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "static" / "data" / "butikker.json"

# Flere offentlige Overpass-servere. Den første er den officielle.
OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)

# Butikstyper der kan være et af vores supermarkeder. Spar, Min Købmand og
# Dagli'Brugsen er ofte mærket som "convenience", Bilka nogle steder som
# "department_store".
_NAMES = ("rema|bilka|f(ø|o)tex|netto|lidl|meny|brugsen|kvickly|365|"
          "l(ø|o)vbjerg|abc lavpris|k(ø|o)bmand|spar")
# Kun butikker hvis brand eller navn ligner en af kæderne. En forespørgsel på
# alle butikker i Danmark var for tung: alle tre servere svarede 504.
QUERY = f"""
[out:json][timeout:240];
area["ISO3166-1"="DK"][admin_level=2]->.dk;
(
  nwr["shop"]["brand"~"{_NAMES}",i](area.dk);
  nwr["shop"]["name"~"{_NAMES}",i](area.dk);
);
out center tags;
"""

# Rækkefølgen betyder noget: SuperBrugsen før Brugsen, Rema før alt med "1000".
# Nøglerne er de samme som app_support._STORE_CONFIGS.
_CHAINS = (
    ("rema", re.compile(r"\brema\b", re.I)),
    ("bilka", re.compile(r"\bbilka\b", re.I)),
    ("foetex", re.compile(r"\bf(ø|o|oe)tex\b", re.I)),
    ("netto", re.compile(r"\bnetto\b", re.I)),
    ("lidl", re.compile(r"\blidl\b", re.I)),
    ("meny", re.compile(r"\bmeny\b", re.I)),
    ("sb", re.compile(r"\bsuper\s*brugsen\b", re.I)),
    ("kvickly", re.compile(r"\bkvickly\b", re.I)),
    ("discount365", re.compile(r"\bcoop\s*365\b|\b365\s*discount\b|\b365discount\b", re.I)),
    ("brugsen", re.compile(r"\b(dagli'?\s*)?brugsen\b", re.I)),
    ("loevbjerg", re.compile(r"\bl(ø|o|oe)vbjerg\b", re.I)),
    ("abclavpris", re.compile(r"\babc\s*lavpris\b", re.I)),
    ("mk", re.compile(r"\bmin\s*k(ø|o|oe)bmand\b", re.I)),
    ("spar", re.compile(r"\b(kwik\s*|euro)?spar\b", re.I)),
)
# Spar, Min Købmand og Dagli'Brugsen er ofte mærket "convenience", Bilka
# nogle steder "department_store".
_SHOP_TYPES = {"supermarket", "convenience", "department_store", "general",
               "hypermarket", "discount", "food"}
ALL_KEYS = tuple(k for k, _ in _CHAINS)
MIN_TOTAL = 1500


def classify(tags: dict) -> str | None:
    """Kæden for én OSM-butik, eller None hvis den ikke er en af vores."""
    # brand er det mest pålidelige; name bruges når brand mangler.
    for field in ("brand", "name", "operator"):
        text = (tags.get(field) or "").strip()
        if not text:
            continue
        for key, rx in _CHAINS:
            if rx.search(text):
                return key
    return None


def fetch() -> list[dict]:
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    last: Exception | None = None
    for url in OVERPASS_URLS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, data=body, headers={
                    "User-Agent": "madshopper.dk butiksliste (hej@madshopper.dk)",
                })
                with urllib.request.urlopen(req, timeout=300) as resp:
                    return json.loads(resp.read().decode())["elements"]
            except Exception as e:  # næste server
                last = e
                print(f"Overpass {url} fejlede ({e}), prøver igen", file=sys.stderr)
                time.sleep(30 * (attempt + 1))
    raise SystemExit(f"Ingen Overpass-server svarede: {last}")


def read_geojsonseq(path: str) -> list[dict]:
    """Butikker fra `osmium export -f geojsonseq` (Geofabriks Danmark-udtræk),
    lavet om til samme form som Overpass' svar."""
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            feat = json.loads(line)
            geom = feat.get("geometry") or {}
            pts = []
            def walk(c):
                if c and isinstance(c[0], (int, float)):
                    pts.append(c)
                else:
                    for x in c or []:
                        walk(x)
            walk(geom.get("coordinates"))
            if not pts:
                continue
            out.append({
                "lat": sum(p[1] for p in pts) / len(pts),
                "lon": sum(p[0] for p in pts) / len(pts),
                "tags": feat.get("properties") or {},
            })
    return out


def build(elements: list[dict]) -> dict:
    stores = []
    seen = set()
    for el in elements:
        tags = el.get("tags") or {}
        if tags.get("shop") not in _SHOP_TYPES:
            continue
        key = classify(tags)
        if not key:
            continue
        lat = el.get("lat", (el.get("center") or {}).get("lat"))
        lon = el.get("lon", (el.get("center") or {}).get("lon"))
        if lat is None or lon is None:
            continue
        lat, lon = round(float(lat), 5), round(float(lon), 5)
        # Samme butik kan være tegnet både som punkt og som bygning.
        dedup = (key, round(lat, 3), round(lon, 3))
        if dedup in seen:
            continue
        seen.add(dedup)
        street = " ".join(p for p in (tags.get("addr:street"), tags.get("addr:housenumber")) if p)
        postcode = (tags.get("addr:postcode") or "").strip()
        if not re.fullmatch(r"\d{4}", postcode):
            postcode = ""
        city = (tags.get("addr:city") or "").strip()
        stores.append([key, lat, lon, street, postcode, city])
    stores.sort(key=lambda s: (s[0], s[4], s[3]))

    # Postnummer -> midtpunkt og bynavn, så man kan skrive sit postnummer i
    # stedet for at dele sin placering. Kun postnumre med mindst én butik.
    by_pc: dict[str, list] = defaultdict(list)
    for key, lat, lon, _street, pc, city in stores:
        if pc:
            by_pc[pc].append((lat, lon, city))
    postcodes = {}
    for pc, rows in sorted(by_pc.items()):
        lat = round(sum(r[0] for r in rows) / len(rows), 4)
        lon = round(sum(r[1] for r in rows) / len(rows), 4)
        names = Counter(r[2] for r in rows if r[2])
        postcodes[pc] = [lat, lon, names.most_common(1)[0][0] if names else ""]

    return {
        "updated": time.strftime("%Y-%m-%d"),
        "source": "© OpenStreetMap-bidragydere, ODbL",
        "fields": ["butik", "lat", "lon", "adresse", "postnummer", "by"],
        "stores": stores,
        "postcodes": postcodes,
    }


def check(data: dict) -> None:
    counts = Counter(s[0] for s in data["stores"])
    for key in ALL_KEYS:
        print(f"  {key:12} {counts.get(key, 0)}")
    print(f"  {'i alt':12} {len(data['stores'])}, {len(data['postcodes'])} postnumre")
    missing = [k for k in ALL_KEYS if not counts.get(k)]
    if missing:
        raise SystemExit(f"Ingen butikker fundet for: {', '.join(missing)}. Skriver ikke filen.")
    if len(data["stores"]) < MIN_TOTAL:
        raise SystemExit(f"Kun {len(data['stores'])} butikker (forventer mindst {MIN_TOTAL}). Skriver ikke filen.")


def main() -> None:
    # --geojsonseq FIL: Geofabriks udtræk (store-locations.yml), ellers Overpass.
    if "--geojsonseq" in sys.argv:
        elements = read_geojsonseq(sys.argv[sys.argv.index("--geojsonseq") + 1])
    else:
        elements = fetch()
    data = build(elements)
    check(data)
    if "--check" in sys.argv:
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Skrev {OUT} ({OUT.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    main()
