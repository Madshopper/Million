"""
Lidl ugens tilbud via lidl.dk's egne kampagnesider.

Kilde: forsiden på lidl.dk linker ugens kampagnesider (/c/<navn>/a<id>), og
hver side har varerne som JSON i data-grid-data-attributter (samme gridBox-
data som søgningen i lidl_katalog.py). Billeder ligger på lidl.dk.

Erstatter den tidligere Tjek-baserede scraper: Tjek (eTilbudsavis) bad os
09-10-2026 skriftligt om at stoppe brugen af deres API og billedservere.

Kun varer hvis tilbud er startet og ikke udløbet tages med, så næste uges
sider (som Lidl lægger op i forvejen) først kommer på, når de gælder.
Lidl Plus-priser bruges ikke (kræver login, se lidl_katalog.py).
"""
import html
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
from lidl_katalog import _HEADERS, _WEIGHT_RE, _is_food_product, _parse_kg_price, _parse_weight
from supabase_utils import enrich_billede_hashes, fetch_existing_products, save_product_dicts

BASE_URL = "https://www.lidl.dk"
BUTIK = "Lidl"

# Eget kategori-navnerum, så tilbuddene ikke rører katalog-rækkerne
# (lidl_katalog.py bruger kategori='Katalog').
KATEGORI = "Tilbudsavis"
PAGE_DELAY = 0.5

_CAMPAIGN_LINK_RE = re.compile(r'href="(?:https://www\.lidl\.dk)?(/c/[^"/?#]+/a\d+)"')
_GRID_DATA_RE = re.compile(r'data-grid-data="([^"]+)"')


def fetch_campaign_links() -> list[str]:
    r = requests.get(BASE_URL + "/", headers=_HEADERS, timeout=30)
    r.raise_for_status()
    return sorted(set(_CAMPAIGN_LINK_RE.findall(r.text)))


def fetch_campaign_items(path: str) -> list[dict]:
    r = requests.get(BASE_URL + path, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    items = []
    for raw in _GRID_DATA_RE.findall(r.text):
        try:
            items.append(json.loads(html.unescape(raw)))
        except ValueError:
            continue
    return items


def _parse_iso(value) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _is_active(data: dict, now: datetime) -> bool:
    start = data.get("storeStartDate")
    if isinstance(start, (int, float)) and start > now.timestamp():
        return False
    current = ((data.get("regionsPrices") or {}).get("1") or {}).get("currentPrice") or {}
    end = _parse_iso(current.get("endDate"))
    return end is None or end >= now


def build_row(data: dict) -> dict | None:
    title = (data.get("fullTitle") or "").strip()
    if not title or not _is_food_product(data, title):
        return None
    price_block = data.get("price") or {}
    pris = price_block.get("price")
    if not isinstance(pris, (int, float)) or pris <= 0:
        return None

    discount = price_block.get("discount") or {}
    normal = price_block.get("oldPrice") or discount.get("deletedPrice")
    normalpris = float(normal) if isinstance(normal, (int, float)) and normal > pris else None

    base_price_text = (price_block.get("basePrice") or {}).get("text")
    packaging = (price_block.get("packaging") or {}).get("text") or ""
    packaging = packaging.replace("1/2 ", "0.5 ")  # "1/2 kg" på kødpakker
    brand = (data.get("brand") or {}).get("name") or None

    return {
        "butik":        BUTIK,
        "kategori":     KATEGORI,
        "navn":         title,
        "producent":    brand,
        # Pakningsteksten ("2 x 140 g") forstås direkte af parse_weight_to_grams.
        "netto_vaegt":  (packaging if _WEIGHT_RE.search(packaging) else
                         _parse_weight(title, base_price_text)) or None,
        "kg_price":     _parse_kg_price(base_price_text) or None,
        "pris":         float(pris),
        "normalpris":   normalpris,
        "varenummer":   str(data.get("erpNumber") or "") or None,
        "billede_url":  data.get("image") or "",
        "billede_hash": None,
        "tilbud":       "Ja",
        "multikob":     None,
    }


def fetch_lidl_tilbud() -> list[dict]:
    links = fetch_campaign_links()
    print(f"  Fandt {len(links)} kampagnesider på lidl.dk")
    if not links:
        # Lidl har altid ugens kampagner på forsiden; ingen links betyder at
        # forsidens opbygning er ændret, ikke at der ingen tilbud er.
        raise RuntimeError("Ingen kampagnesider fundet på lidl.dk-forsiden")

    now = datetime.now(timezone.utc)
    rows: list[dict] = []
    seen: set[str] = set()
    empty_pages = 0
    for path in links:
        items = fetch_campaign_items(path)
        if not items:
            empty_pages += 1
        added = 0
        for data in items:
            if not _is_active(data, now):
                continue
            row = build_row(data)
            if row is None:
                continue
            key = row["varenummer"] or row["navn"].lower()
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)
            added += 1
        print(f"    {path}: {len(items)} varer, {added} aktive madtilbud")
        time.sleep(PAGE_DELAY)

    if empty_pages == len(links):
        raise RuntimeError("Ingen af Lidls kampagnesider havde varedata (data-grid-data)")

    # Genbrug gårsdagens billede_hash ved uændret billed-URL (se bilka_katalog.py).
    cache = fetch_existing_products(BUTIK)
    for row in rows:
        cached = cache.get(row["varenummer"] or "") or cache.get(row["navn"].lower())
        if cached and cached.get("billede_url") == row["billede_url"] and cached.get("billede_hash"):
            row["billede_hash"] = cached["billede_hash"]
    enrich_billede_hashes(rows)
    print(f"  OK: {len(rows)} Lidl-tilbud hentet fra lidl.dk")
    return rows


def save_to_supabase(rows: list[dict]):
    # min_ratio=None: antallet af kampagner svinger legitimt fra uge til uge;
    # den ægte fejl (ingen sider eller ingen varedata) fanges i fetch_lidl_tilbud.
    save_product_dicts(BUTIK, rows, delete_neq_kategori="Katalog", min_ratio=None)


def main():
    print("Starter Lidl tilbud-scraper (lidl.dk)...")
    rows = fetch_lidl_tilbud()
    save_to_supabase(rows)
    print("\nFærdig!")


if __name__ == "__main__":
    main()
