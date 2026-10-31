#!/usr/bin/env python3
"""Indlæser produkter fra Supabase app_cache ind i Cloudflare D1.

Kører lokalt (hvor der er netværk + wrangler-login). Bygger en tabel med
queryable kolonner, så Worker'en kun henter det en side skal bruge.
"""
from __future__ import annotations

import json
import os
import random
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

DB_NAME = "madshopper"
KV_NAMESPACE_ID = "0e60bdf03ed4490cbfac5fa72c8adca5"
# dev.madshopper.dk (madshopper-dev) læser SAMME D1 som produktionen (Kalle,
# 12-10-2026). Dens egen kopi blev kun fyldt ved manuelle staging-seeds, som
# budgettet herunder ikke har plads til hver dag, så den stod uger bagud (fx
# 3088 gamle Tjek-tilbud for Føtex i stedet for ugens 716 i avisen). Det, der
# hører til tabellen i KV (søgeindeks, d1_stats_v1, forsidepuljer og
# cache_version), skrives derfor til BEGGE namespaces i samme kørsel, så
# staging aldrig peger på en anden tabelversion end den der ligger i D1.
STAGING_KV_NAMESPACE_ID = "b879e69c3a1f477c9c69bbc7e7b041df"
KV_NAMESPACE_IDS = (KV_NAMESPACE_ID, STAGING_KV_NAMESPACE_ID)

# D1's gratis-plan-budget (100k rows written / 5M rows read pr. dag) er
# KONTO-bredt - delt mellem madshopper og madshopper-dev, ikke pr. database
# (bekræftet 2026-07-19: 710k/100k skrivninger var de to tilsammen). Derfor
# tjekkes/opdateres reseed-spærren altid mod PRODUKTIONENS KV-namespace,
# uanset hvilket miljø der seedes - en guard pr. miljø ville ikke opdage at
# begge tilsammen sprænger den fælles kontogrænse.
GUARD_KV_NAMESPACE_ID = "0e60bdf03ed4490cbfac5fa72c8adca5"
GUARD_HOURS = 6

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from app_support import (  # noqa: E402
    _fold, _get_subcategory, _STORE_CONFIGS, CAT_MEJERI,
    is_organic, is_lactose_free, parse_weight_to_grams,
    normalize_name, _PLACEHOLDER_IMGS,
    is_non_food_name, is_age_restricted, is_rema_tobacco_id, store_match_names,
    offer_group_key, AVIS_LEAFLET_STORES,
)
from updater import get_search_flavor_keywords  # noqa: E402

_TOBACCO_IMG_RE = re.compile(r'rema-product-images\.digital\.rema1000\.dk/(\d+)/')


def _is_tobacco_image(url: str) -> bool:
    m = _TOBACCO_IMG_RE.search(url)
    if not m:
        return False
    return is_rema_tobacco_id(m.group(1))


def _home_is_allowed(p: dict) -> bool:
    """Samme regler som app.py::filter_products_by_stores' _is_allowed (minus
    butiksfiltrering, som forbliver pr.-request i app.py). Anvendes her ved
    seed-tid i stedet for ved hver forsidevisning - målt: kontrollen fjernede
    0 af 18.781 rækker (upstream matching/scraping udelukker allerede disse
    kategorier), men kørte alligevel igen på de samme ~400 forudberegnede
    varer ved HVER request og stod for 54% af forsidens CPU. HOLD DE TO
    FUNKTIONER I SYNC, hvis reglerne nogensinde ændres."""
    img = str(p.get('/product/imageLink', '')).strip()
    if img in _PLACEHOLDER_IMGS or _is_tobacco_image(img):
        return False
    rema_img = str(p.get('/product/rema_image', '')).strip()
    if rema_img in _PLACEHOLDER_IMGS or _is_tobacco_image(rema_img):
        return False
    title = str(p.get('/product/title', ''))
    brand = str(p.get('/product/brand', ''))
    if is_age_restricted(title, brand, product_id=p.get('/product/id', '')):
        return False
    if is_non_food_name(title) or is_non_food_name(brand):
        return False
    bilka_brand = str((p.get('/product/store_matches') or {}).get('bilka', {}).get('brand', '')).lower().strip()
    if bilka_brand.startswith('deli'):
        return False
    if str(p.get('/product/store', '')).lower() == 'bilka' and str(p.get('/product/brand', '')).lower().strip().startswith('deli'):
        return False
    return True

# Skrive-tabellen cart_popularity er miljø-adskilt ligesom i app.py::_table_suffix.
TABLE_SUFFIX = ""

SUPABASE_URL = (
    os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    or os.environ.get("SUPABASE_URL")
    or "https://oxzxingkbsnqzpmjtktr.supabase.co"
)
SUPABASE_KEY = (
    os.environ.get("DEPLOY_KEY")
    or os.environ.get("SUPABASE_KEY")
    or "sb_publishable_Jt8N0XezmzfZJSzzSwBBKQ_uGbNoq8f"
)

MAX_STMT_BYTES = 60_000      # hver INSERT skal være under D1's statement-grænse
BYTES_PER_FILE = 2_000_000   # færre, større filer = færre wrangler-kald = hurtigere

# Seed ind i en midlertidig tabel, mens den gamle 'products' fortsat betjener
# trafik. Til sidst byttes de om (næsten uden nedetid) i FINALIZE.
SCHEMA = """
DROP TABLE IF EXISTS products_new;
CREATE TABLE products_new (
  id TEXT PRIMARY KEY,
  category TEXT,
  subcategory TEXT,
  title TEXT,
  price REAL,
  eff_price REAL,
  is_sale INTEGER DEFAULT 0,
  organic INTEGER DEFAULT 0,
  lactose INTEGER DEFAULT 0,
  weight_g REAL,
  store TEXT,
  stores TEXT,
  search_text TEXT,
  data TEXT
);
"""

# Indekser oprettes EFTER indsættelse (hurtigere) på den færdige tabel.
# idx_products_category_price dækker "ORDER BY eff_price" inden for en
# kategori (_d1_listing i app.py, sort=price-asc/-desc) - uden den sorterer
# planlæggeren resultatet i en midlertidig B-træ bagefter (130x langsommere
# målt).
#
# Der er BEVIDST intet selvstændigt indeks på ren `category` eller på
# `store`. Et rent category-filter dækkes allerede af venstre-præfikset på
# idx_products_category_price/idx_products_subcat (begge starter med
# category), og ingen forespørgsel i app.py filtrerer nogensinde på
# `store = ?` - butiksvalg går altid via `stores LIKE '%|X|%'`, som et
# indeks alligevel ikke kan bruge. De to indekser kostede derfor et fuldt
# genopbygnings-skriv (~18-19k rows_written hver, jf. rows_written i
# scripts/seed-d1.py's wrangler-output) hver evig eneste nat uden at nogen
# forespørgsel nogensinde læste dem - hovedårsagen til at reseed'en sprang
# D1's gratis 100k rows_written/dag (se main()'s guard-kommentar) 02-09-2026.
#
# idx_products_sale er PARTIELT (WHERE is_sale = 1): kun tilbudsvarerne faar en
# indeksindgang. Hele reseed'en koster ~5 rows_written pr. produkt (tabelraekke
# + PK-autoindeks + tre indekser = 97.163 for 19.429 produkter 11-09-2026), dvs.
# ~97 % af doegnbudgettet paa een koersel, og EEN nattereseed alene ville ramme
# loftet ved ~20.000 produkter. Et fuldt is_sale-indeks skrev en indgang for alle
# raekker, ogsaa de ~75 % som ingen forespoergsel slaar op (intet i app.py
# filtrerer paa is_sale = 0). Partielt sparer ~14k rows_written pr. reseed.
#
# Maalt paa en lokal SQLite-replika bygget med build_row_values + SCHEMA/FINALIZE,
# uden ANALYZE ligesom D1: samme plan, samme antal undersoegte raekker og
# IDENTISKE resultater (samme varer, samme orden) for tilbuds-COUNT,
# relevans-sider, pris-/navnesortering og load_sale_raw. Indekset kan kun bruges
# naar forespoergslen selv indeholder det bogstavelige led `is_sale = 1` - skriv
# det aldrig som `is_sale = ?`.
#
# (eff_price) WHERE is_sale = 1 blev fravalgt: det fjerner tilbudssidens TEMP
# B-TREE-sortering (5.442 -> 24 laeste raekker), men aendrer gennemloebsordenen,
# saa relevans-siderne og load_sale_raw viste andre varer (24 af 24 skiftet paa
# side 1). Det er en produktbeslutning, ikke en budgetrettelse.
FINALIZE = """
DROP TABLE IF EXISTS products;
ALTER TABLE products_new RENAME TO products;
CREATE INDEX idx_products_category_price ON products(category, eff_price);
CREATE INDEX idx_products_subcat ON products(category, subcategory);
CREATE INDEX idx_products_sale ON products(is_sale) WHERE is_sale = 1;
"""


def available_stores(p: dict) -> str:
    """'|'-omkranset liste af butiks-labels varen findes hos (til SQL-filter)."""
    labels = {str(p.get("/product/store", "Rema 1000"))}
    if p.get("/product/rema_price"):
        labels.add("Rema 1000")
    for key in (p.get("/product/store_matches") or {}):
        cfg = _STORE_CONFIGS.get(key)
        if cfg and cfg.get("label"):
            labels.add(cfg["label"])
    return "|" + "|".join(sorted(labels)) + "|"


_LOCAL_APP_CACHE = os.path.join(ROOT, "data", "app_cache_local.json")
_LOCAL_APP_CACHE_MAX_AGE_S = 1800  # 30 min


def fetch_products() -> list[dict]:
    # updater.py's _save_app_cache() skriver ALTID præcis samme produktliste
    # til data/app_cache_local.json FØR den uploader til Supabase (se
    # updater.py:1354-1363) - i cache-updater.yml kører seed-d1.py som næste
    # trin i SAMME job/runner lige efter, så filen er på det tidspunkt
    # identisk med det der netop blev skrevet til app_cache. At hente den
    # samme ~30 MB igen over netværket dér er ren Supabase-egress der aldrig
    # giver noget nyt (bekræftet 2026-08-05: gratis-planens 5 GB/måned-kvote).
    # Kun brugt hvis filen er frisk (< 30 min) - en standalone/manuel kørsel
    # af dette script uden en updater.py-kørsel lige før falder automatisk
    # tilbage til den gamle Supabase-hentning, så en gammel liggende fil
    # aldrig kan seede D1 med forældede data.
    if os.path.exists(_LOCAL_APP_CACHE):
        age_s = time.time() - os.path.getmtime(_LOCAL_APP_CACHE)
        if age_s < _LOCAL_APP_CACHE_MAX_AGE_S:
            try:
                with open(_LOCAL_APP_CACHE, "r", encoding="utf-8") as f:
                    payload = json.load(f)
                products = payload.get("products") or []
                if products:
                    print(
                        f"Genbruger frisk data/app_cache_local.json ({len(products)} "
                        f"produkter, {age_s:.0f}s gammel) - springer Supabase-hentning over"
                    )
                    return products
            except Exception as e:
                print(f"Kunne ikke læse lokal cache ({e}) - henter fra Supabase i stedet")

    url = f"{SUPABASE_URL}/rest/v1/app_cache?select=*&order=id.asc"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    print("Henter app_cache fra Supabase ...")
    raw = urllib.request.urlopen(
        urllib.request.Request(url, headers=headers), timeout=120
    ).read()
    rows = json.loads(raw)
    products: list[dict] = []
    for row in rows:
        if row.get("id") == 0:
            continue
        chunk = row.get("data")
        if isinstance(chunk, list):
            products.extend(chunk)
    print(f"  {len(products)} produkter ({len(raw) / 1024 / 1024:.1f} MB)")
    return products


# Interne felter som KUN bruges af updater.py/scrapers ved bygning - aldrig af
# runtime (app.py/app_support.py). Fjernes fra det gemte 'data' for at halvere
# blob-størrelsen (mindre JSON-parsing i worker'en + mindre D1).
# NB: /product/ean og store_matches 'ean' BEHOLDES nu - nutrition_candidate_keys
# (app_support.py) slår næring op via EAN, så de skal med ud til edge/D1.
# own_avis_titel/avis_titel erstattes af /product/offer_keys (build_row_values).
_TOP_DROP = frozenset({"/product/image_hash", "/product/weight_grams",
                       "/product/own_avis_titel"})
_MATCH_DROP = frozenset({"_hash_int", "_norm_name", "_image_hash", "_weight_g", "_stk_count",
                         "avis_titel"})


def slim_product(p: dict) -> dict:
    """Fjern build-only felter fra produkt-JSON før det gemmes i D1."""
    out = {}
    for k, v in p.items():
        if k in _TOP_DROP:
            continue
        if k == "/product/store_matches" and isinstance(v, dict):
            slim_matches = {}
            for sk, match in v.items():
                if isinstance(match, dict):
                    slim_matches[sk] = {
                        mk: mv for mk, mv in match.items() if mk not in _MATCH_DROP
                    }
                else:
                    slim_matches[sk] = match
            out[k] = slim_matches
        else:
            out[k] = v
    return out


def sql_str(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def build_row_values(p: dict, stats: dict | None = None, rowid: int | None = None,
                     postings: dict | None = None) -> str | None:
    pid = str(p.get("/product/id", "")).strip()
    if not pid or pid in ("None", "nan"):
        return None
    category = str(p.get("/product/product_type") or "Andre varer")
    title = str(p.get("/product/title", ""))
    subcategory = _get_subcategory(title, category)
    try:
        price = float(p.get("/product/price", 0) or 0)
    except (TypeError, ValueError):
        price = 0.0
    sale_price = p.get("/product/sale_price")
    # own_sale: butikkens eget tilbud uden førpris (updater.py), så "Tilbud
    # hos …" (app.py::_build_store_offer_listing) finder dem via indekset.
    is_sale = 1 if (sale_price is not None or p.get("/product/is_any_sale")
                    or p.get("/product/own_sale")) else 0
    try:
        eff_price = float(sale_price) if sale_price is not None else price
    except (TypeError, ValueError):
        eff_price = price
    # Øko/laktose/vægt som kolonner, så edge-filtrene kan afgøres i SQL FØR
    # paginering (ellers bliver sideantal/total talt uden filtrene).
    desc = str(p.get("/product/description", "") or "")
    brand = str(p.get("/product/brand", "") or "")
    organic = 1 if is_organic(title, desc, brand) else 0
    lactose = 1 if is_lactose_free(title, desc, brand) else 0
    weight_g = parse_weight_to_grams(str(p.get("/product/unit_pricing_measure", "") or ""))
    if weight_g is None:
        try:
            weight_g = float(p.get("/product/weight_g"))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            weight_g = None
    store = str(p.get("/product/store", "Rema 1000"))
    stores = available_stores(p)
    # normalize_name (ikke bare .lower()) så search_text bærer samme
    # kanoniske stavemåde som forespørgslen bliver normaliseret til i
    # app.py::load_search_raw - ellers matcher fx "hakket svinekød" aldrig
    # et Rema-kort med rå titel "HK. SVINEKØD".
    base_text = " ".join([
        str(p.get("/product/title", "")),
        str(p.get("/product/brand", "")),
        str(p.get("/product/description", "")),
    ])
    img_url = str(p.get("/product/imageLink", ""))
    flavor_kw = get_search_flavor_keywords(base_text, img_url)
    # De andre butikkers navne for varen med (app_support.store_match_names):
    # Spar kalder Føtex' "Flødeis m. romsmag ..." for "Toms Skildpadde".
    names = store_match_names(p.get("/product/store_matches"))
    search_text = normalize_name(f"{base_text} {flavor_kw} {names}".strip())
    # Samme regex-tunge opslag som lige er brugt til search_text ovenfor -
    # send resultatet med ind i data-JSON'en, så app_support._product_flavor_
    # search_field() kan slå det op i stedet for at genberegne det live pr.
    # søgning pr. kandidat (op til 800). Det var den anden af to bekræftede
    # CPU-budget-årsager til Error 1101/1102 (2026-08-05), ved siden af selve
    # D1/KV-bro-kollisionen.
    p["/product/flavor_kw"] = normalize_name(flavor_kw) if flavor_kw else ""
    # subcategory/organic/lactose er lige beregnet ovenfor til deres egne
    # D1-kolonner (bruges til SQL-filtrering FØR paginering) - samme mønster
    # som flavor_kw ramte: send dem også med i data-JSON'en, så
    # product_to_display_dict (app_support.py) kan slå dem op i stedet for at
    # genberegne (_get_subcategory scanner op til 100+ nøgleord pr. produkt,
    # og kører på ALLE sider - forside/kategori/tilbud/søgning - ikke kun
    # søgningens kandidatpulje).
    p["/product/subcategory"] = subcategory
    p["/product/is_organic"] = bool(organic)
    p["/product/is_lactose_free"] = bool(lactose)
    # Tilbuddets nøgle pr. butik, så butikkens tilbudsside viser ét kort pr.
    # tilbud i SQL (app.py::_store_offer_key_sql) med samme regel som tallet
    # på logoet (_count_store_offers).
    offer_keys = {}
    for key, cfg in _STORE_CONFIGS.items():
        ok = offer_group_key(p, key, cfg["label"])
        if ok:
            offer_keys[key] = ok
    if offer_keys:
        p["/product/offer_keys"] = offer_keys
    else:
        p.pop("/product/offer_keys", None)
    data = json.dumps(slim_product(p), separators=(",", ":"), ensure_ascii=False)
    if stats is not None:
        # Tilbudssidens antal: own_sale-varer vises ikke dér (app.py::
        # _build_sale_listing), så de tælles heller ikke med.
        _count_row(stats, category, subcategory,
                   1 if (sale_price is not None or p.get("/product/is_any_sale")) else 0)
        if is_sale:
            _count_store_offers(stats, p)
            _pick_store_offers(stats, p, pid, offer_keys)
    if postings is not None and rowid is not None:
        _add_postings(postings, search_text, rowid)
    return (
        "("
        + ("" if rowid is None else f"{int(rowid)},")
        + sql_str(pid) + ","
        + sql_str(category) + ","
        + sql_str(subcategory) + ","
        + sql_str(title) + ","
        + f"{price}" + ","
        + f"{eff_price}" + ","
        + f"{is_sale}" + ","
        + f"{organic}" + ","
        + f"{lactose}" + ","
        + ("NULL" if weight_g is None else f"{weight_g}") + ","
        + sql_str(store) + ","
        + sql_str(stores) + ","
        + sql_str(search_text) + ","
        + sql_str(data)
        + ")"
    )


# Kør wrangler fra dist/ lokalt (har genereret wrangler.toml), ellers fra roden
# (CI: root wrangler.toml har D1-bindingen + CLOUDFLARE_API_TOKEN/ACCOUNT_ID).
_DIST = os.path.join(ROOT, "dist")
WRANGLER_CWD = _DIST if os.path.isdir(_DIST) else ROOT


def _count_store_offers(stats: dict, p: dict) -> None:
    """Antal tilbud pr. butik til forsidens tilbudsaviser (app.py::
    _offer_store_counts). Samme regel som app.py::_as_store_offer:
    visningsbutikkens eget tilbud ligger på kortet, de andres i store_matches.
    Varer med samme tilbudsnøgle (app_support.offer_group_key: avistitel, eller
    mærke + pris hos Rema) er ét tilbud: Bilka havde 1.304 avisvarer men kun
    ~140 tilbud (13-10-2026), Rema 275 tilbudsvarer men ~155 tilbud."""
    counts = stats.setdefault("offer_counts", {})
    avis = stats.setdefault("avis_counts", {})
    seen = stats.setdefault("_offer_keys_seen", {})
    store = p.get("/product/store")
    matches = p.get("/product/store_matches") or {}
    for key, cfg in _STORE_CONFIGS.items():
        m = matches.get(key) or {}
        own = store == cfg["label"]
        group = offer_group_key(p, key, cfg["label"])
        if (own and (p.get("/product/sale_price") is not None
                     or p.get("/product/own_sale"))) or m.get("is_sale"):
            # Kun Remas grupper samler "alle tilbud"; de andre butikkers
            # avistitler gælder kun avisoptællingen nedenfor.
            if group and group.startswith("r:"):
                rema = seen.setdefault(("o", key), set())
                if group in rema:
                    continue  # Rema har ingen avis-optælling nedenfor
                rema.add(group)
            counts[key] = counts.get(key, 0) + 1
        # Kun ugens avisvarer (Salling og Dagrofa, tilbud='Avis'):
        # app.py::_avis_leaflet. Varer uden titel (Netto) tælles hver for sig.
        if not ((own and p.get("/product/own_avis")) or m.get("in_avis")):
            continue
        if group:
            titles = seen.setdefault(("a", key), set())
            if group in titles:
                continue
            titles.add(group)
        avis[key] = avis.get(key, 0) + 1


def _count_row(stats: dict, category: str, subcategory: str, is_sale: int) -> None:
    """Tæller én indsat række med i d1_stats_v1 (se write_d1_stats)."""
    stats["products"] = stats.get("products", 0) + 1
    stats["sale"] = stats.get("sale", 0) + is_sale
    cat = stats.setdefault("cats", {}).setdefault(category, {"n": 0, "subs": set()})
    cat["n"] += 1
    cat["subs"].add(subcategory)


_D1_STATS_KV_KEY = "d1_stats_v1"

# --- Tilbudslister pr. butik i KV (læses af app.py::_store_offer_ids) -------
#
# /tilbud/<butik> fandt "ét kort pr. tilbud" med en vinduesfunktion over alle
# ~5.800 tilbudsvarer, to gange pr. side (COUNT + SELECT): ~14.000 læste
# rækker pr. forespørgsel. 31-10-2026 gennemgik to crawlere (CA og US) alle
# kombinationer af afsnit, side og sortering, og ~180 sider sprængte de 5 mio.
# rows_read på to timer. Her vælges de samme varer én gang pr. seed, med
# samme regel som SQL'en (app.py::_store_offer_sql/_store_offer_key_sql), og
# siden henter dem bagefter med id IN (...): ét PK-opslag pr. vare.
_OFFER_IDS_KV_KEY = "offer_ids_v1"
# D1 tillader højst 100 KB SQL pr. forespørgsel; større lister (fx Bilkas
# alle tilbud, hvis avisen mangler) udelades, så app.py bruger den gamle vej.
_OFFER_IDS_MAX = 1500


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _store_offer_savings(p: dict, key: str, label: str, leaflet: bool):
    """Besparelsen som app.py::_store_offer_sql regner den, eller None hvis
    varen ikke er et tilbud hos butikken efter den regel."""
    if p.get("/product/store") == label and (
            p.get("/product/own_avis") == 1 if leaflet else (
                p.get("/product/sale_price") is not None
                or p.get("/product/own_sale") == 1)):
        sale, price = _num(p.get("/product/sale_price")), _num(p.get("/product/price"))
        if sale is not None and price is not None and price > sale and price:
            return 1.0 - sale / price
        return 0.0
    m = (p.get("/product/store_matches") or {}).get(key)
    if isinstance(m, dict) and m.get("in_avis" if leaflet else "is_sale") == 1:
        price, normal = _num(m.get("price")), _num(m.get("normal_price"))
        if price is not None and normal is not None and normal > price and normal:
            return 1.0 - price / normal
        return 0.0
    return None


def _pick_store_offers(stats: dict, p: dict, pid: str, offer_keys: dict) -> None:
    """Behold pr. butik, regel og tilbudsnøgle den vare der sparer mest (ved
    lighed laveste id), præcis som ROW_NUMBER() OVER (PARTITION BY ok ORDER
    BY sv DESC, id) i app.py."""
    picks = stats.setdefault("_offer_picks", {})
    for key, cfg in _STORE_CONFIGS.items():
        for leaflet in ((False, True) if key in AVIS_LEAFLET_STORES else (False,)):
            sv = _store_offer_savings(p, key, cfg["label"], leaflet)
            if sv is None:
                continue
            ok = offer_keys.get(key) or pid
            best = picks.setdefault((key, leaflet), {})
            cur = best.get(ok)
            if cur is None or sv > cur[0] or (sv == cur[0] and pid < cur[1]):
                best[ok] = (sv, pid)


def build_offer_ids(stats: dict) -> dict:
    """{butik: {"rule": "a"|"o", "ids": [...]}} med den regel app.py::
    _avis_leaflet vælger: avisvarer når butikken har en kendt avis, ellers
    alle tilbud."""
    picks = stats.get("_offer_picks", {})
    avis = stats.get("avis_counts", {})
    out = {}
    for key in _STORE_CONFIGS:
        leaflet = key in AVIS_LEAFLET_STORES and int(avis.get(key) or 0) > 0
        ids = sorted(pid for _sv, pid in picks.get((key, leaflet), {}).values())
        if len(ids) > _OFFER_IDS_MAX:
            print(f"  {key}: {len(ids)} tilbud, for mange til offer_ids_v1 (bruger SQL)")
            continue
        out[key] = {"rule": "a" if leaflet else "o", "ids": ids}
    return out


def write_offer_ids(offer_ids: dict) -> None:
    """Fejler blødt: uden nøglen bruger app.py den gamle SQL."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(offer_ids, f, separators=(",", ":"), ensure_ascii=False)
        path = f.name
    try:
        _kv_all(["key", "put", _OFFER_IDS_KV_KEY, f"--path={path}"])
    except Exception as e:
        print(f"  advarsel: kunne ikke skrive {_OFFER_IDS_KV_KEY}: {e}")
    finally:
        os.unlink(path)

# --- Søgeindeks i KV (læses af app.py::_sidx_search) -----------------------
#
# En D1-søgning med search_text LIKE '%…%' kan ikke bruge et indeks og læser
# 12-20k rækker - 76 % af gratis-planens 5 mio. rows_read/døgn (målt
# 30-09/02-10-2026). I stedet bygges her et ordindeks: foldet token
# (app_support._fold, samme som søgningen) -> rowid'er. Opslaget i app.py
# finder kandidaterne uden D1 og henter derefter kun de rækker der matcher
# via rowid (PK-opslag, én læst række pr. vare).
#
# rowid = version * _SIDX_ROW_SPAN + løbenummer. Versionen står dermed i selve
# rækken: er indekset fra en anden seed end tabellen, returnerer D1 færre
# rækker end bedt om, og app.py falder tilbage til LIKE-søgningen. Det
# lukker vinduet mellem tabel-swap og KV-skrivning (og KV's ~60 s
# propagering) uden en ekstra D1-tabel eller ekstra rows_written.
#
# Opdelt i shards efter første tegn (præfiks-opslag) og efter sidste tegn af
# token baglæns (sammensætninger som "letmælk" for "mælk"), så en søgning kun
# skal hente og parse 1-2 små nøgler pr. ord i stedet for hele indekset.
# ~90 nøgler pr. seed - langt under KV's 1.000 skrivninger/døgn.
_SIDX_ROW_SPAN = 100_000
_SIDX_VER_KEY = "sidx_ver"
_SIDX_TTL_S = 7 * 86400  # gamle versioner rydder sig selv op
# Kortere tokens kan aldrig være en sammensætnings-endelse med >= 3 tegns
# stamme for et søgeord på >= 2 tegn (app_support._token_matches_term).
_SIDX_SUFFIX_MIN_LEN = 5


def _add_postings(postings: dict, search_text: str, rowid: int) -> None:
    for tok in set(_fold(search_text).split()):
        if len(tok) >= 2:
            postings.setdefault(tok, []).append(rowid)


def _sidx_shard_id(ch: str) -> str:
    return format(ord(ch), "x")


def build_search_shards(postings: dict, version: int) -> tuple[list[dict], dict]:
    """KV-poster (til wrangler kv bulk put) + manifestet til _SIDX_VER_KEY."""
    pre: dict[str, dict] = {}
    suf: dict[str, dict] = {}
    for tok, ids in postings.items():
        pre.setdefault(tok[0], {})[tok] = ids
        if len(tok) >= _SIDX_SUFFIX_MIN_LEN:
            rev = tok[::-1]
            suf.setdefault(rev[0], {})[rev] = ids
    entries = []
    manifest = {"v": version, "p": [], "s": []}
    for kind, shards in (("p", pre), ("s", suf)):
        for ch, d in shards.items():
            toks = sorted(d)
            sid = _sidx_shard_id(ch)
            manifest[kind].append(sid)
            entries.append({
                "key": f"sidx:{version}:{kind}:{sid}",
                "value": json.dumps(
                    {"t": toks, "p": [d[t] for t in toks]},
                    separators=(",", ":"), ensure_ascii=False,
                ),
                "expiration_ttl": _SIDX_TTL_S,
            })
    return entries, manifest


def _kv_all(args: list[str]) -> None:
    """`wrangler kv <args>` mod produktionens namespace og derefter stagings
    (se KV_NAMESPACE_IDS). En fejl i produktionen rejses som før; en fejl på
    staging giver kun en advarsel, så dev aldrig kan vælte nattens seed."""
    for ns in KV_NAMESPACE_IDS:
        try:
            subprocess.run(
                ["npx", "wrangler", "kv", *args, "--namespace-id", ns, "--remote"],
                cwd=WRANGLER_CWD,
                check=True,
            )
        except Exception as e:
            if ns == KV_NAMESPACE_ID:
                raise
            print(f"  advarsel: staging-KV ikke opdateret ({' '.join(args[:3])}): {e}")


def write_search_shards(entries: list[dict]) -> bool:
    """Skriver shards FØR tabel-swappen: de er uvirksomme, indtil
    _SIDX_VER_KEY peger på deres version."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(entries, f, separators=(",", ":"), ensure_ascii=False)
        path = f.name
    try:
        _kv_all(["bulk", "put", path])
        return True
    except Exception as e:
        print(f"  advarsel: kunne ikke skrive søgeindeks: {e}")
        return False
    finally:
        os.unlink(path)


def write_search_version(manifest: dict) -> None:
    """Peger app.py på den nye indeksversion - EFTER tabel-swappen."""
    payload = json.dumps(manifest, separators=(",", ":"))
    try:
        _kv_all(["key", "put", _SIDX_VER_KEY, payload])
    except Exception as e:
        # Den gamle version bliver stående: dens rowid'er findes ikke i den
        # nye tabel, så app.py opdager det og bruger LIKE-søgningen.
        print(f"  advarsel: kunne ikke skrive {_SIDX_VER_KEY}: {e}")


def write_d1_stats(stats: dict) -> None:
    """Optællinger for den netop seedede tabel til KV, så app.py::_d1_stats
    kan svare på kategori-/tilbuds-COUNT, DISTINCT subcategory og admin-
    sidens varetal uden at scanne D1 (gratis-planens 5 mio. rows_read/døgn
    blev sprængt 30-09-2026). Tælles i samme løkke som INSERT'erne, så tallene
    altid svarer præcis til tabellen. Fejler blødt: uden nøglen falder app.py
    tilbage til D1-forespørgslerne."""
    payload = {
        "products": stats.get("products", 0),
        "sale": stats.get("sale", 0),
        "offer_counts": stats.get("offer_counts", {}),
        "avis_counts": stats.get("avis_counts", {}),
        "cats": {
            c: {"n": v["n"], "subs": sorted(v["subs"])}
            for c, v in stats.get("cats", {}).items()
        },
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
        path = f.name
    try:
        _kv_all(["key", "put", _D1_STATS_KV_KEY, f"--path={path}"])
    except Exception as e:
        print(f"  advarsel: kunne ikke skrive {_D1_STATS_KV_KEY}: {e}")
    finally:
        os.unlink(path)


def run_wrangler_sql(sql: str) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(sql)
        path = f.name
    try:
        subprocess.run(
            ["npx", "wrangler", "d1", "execute", DB_NAME, "--remote", f"--file={path}", "-y"],
            cwd=WRANGLER_CWD,
            check=True,
        )
    finally:
        os.unlink(path)


_HOME_KV_KEY = "home_data_v1"
_HOME_SALE_LIMIT = 200
_HOME_MEJERI_LIMIT = 200
_HOME_FAV_LIMIT = 60


def fetch_popular_product_ids(limit: int = _HOME_FAV_LIMIT) -> list[str]:
    """Samme udvælgelse som app.py::_popular_product_ids - kørt her så forsiden
    kan læse resultatet fra KV i stedet for at ramme Supabase pr. request."""
    url = (
        f"{SUPABASE_URL}/rest/v1/cart_popularity{TABLE_SUFFIX}"
        f"?select=product_id,count&count=gte.2&order=count.desc&limit={limit}"
    )
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    try:
        raw = urllib.request.urlopen(
            urllib.request.Request(url, headers=headers), timeout=30
        ).read()
        rows = json.loads(raw)
        return [str(r.get("product_id")) for r in rows if r.get("product_id")]
    except Exception as e:
        print(f"  advarsel: kunne ikke hente popularitets-id'er: {e}")
        return []


_HOME_RECIPE_LIMIT = 10

# De 10 opskrifter forsiden viste fra starten (de eneste godkendte før de egne
# opskrifter kom 07-10-2026), i den rækkefølge de stod i. Forsiden viser KUN
# dem, indtil opskrifter udgives fra Feature-panelet (Kalle 18-10-2026).
# Samme liste som app.py::_HOME_RECIPES_LOCKED_IDS.
_HOME_RECIPES_LOCKED_IDS = (15, 14, 13, 12, 11, 9, 8, 7, 6, 5)


def fetch_recipe_pool(limit: int = _HOME_RECIPE_LIMIT,
                      only_ids: tuple | None = None) -> list[dict]:
    """"Lækre opskrifter"-pulje: godkendte opskrifter rangeret efter akkumuleret
    klik-pointsum (recipe_points{TABLE_SUFFIX}, nedtrappende pointværdi pr.
    klik med opskriftens alder - se scripts/supabase-recipe-clicks.sql).
    Uafgjort afgøres af nyeste opskrift - bekræftet af opdragsgiver 2026-08-01.
    Opskrifter uden klik endnu tælles som 0 point, så nye/upopulære opskrifter
    naturligt fylder tomme pladser i stedet for et sparsomt afsnit ved cold
    start, i stedet for at kun nogensinde-klikkede opskrifter kan optræde."""
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

    def _get(path: str, params: str) -> list:
        url = f"{SUPABASE_URL}/rest/v1/{path}?{params}"
        try:
            raw = urllib.request.urlopen(
                urllib.request.Request(url, headers=headers), timeout=30
            ).read()
            return json.loads(raw)
        except Exception as e:
            print(f"  advarsel: kunne ikke hente {path}: {e}")
            return []

    recipes = _get(
        "recipes",
        "select=id,title,image_url,created_at&status=eq.approved"
        "&order=created_at.desc&limit=2000",
    )
    if not recipes:
        return []

    points_by_id = {
        r["recipe_id"]: r
        for r in _get(f"recipe_points{TABLE_SUFFIX}", "select=recipe_id,total_points,click_count")
    }
    snapshot_by_id = {
        r["recipe_id"]: r
        for r in _get(
            "recipe_price_snapshot",
            "select=recipe_id,cheapest_total_price,matched_ingredient_count,"
            "total_ingredient_count,ingredients_on_sale_count",
        )
    }

    ranked = []
    for r in recipes:
        rid = r["id"]
        pts = points_by_id.get(rid, {})
        snap = snapshot_by_id.get(rid, {})
        total = snap.get("total_ingredient_count") or 0
        on_sale = snap.get("ingredients_on_sale_count") or 0
        ranked.append({
            "id": rid,
            "title": r.get("title", ""),
            "image_url": r.get("image_url", ""),
            "created_at": r.get("created_at", ""),  # kun til sortering, fjernes nedenfor
            "total_points": pts.get("total_points", 0),
            "click_count": pts.get("click_count", 0),
            "cheapest_total_price": snap.get("cheapest_total_price"),
            "matched_ingredient_count": snap.get("matched_ingredient_count", 0),
            "total_ingredient_count": total,
            "sale_ratio": round(on_sale / total, 3) if total else 0.0,
        })

    # (total_points, created_at) begge faldende i én sort: højeste pointsum
    # øverst, uafgjort -> nyeste opskrift (ISO8601-strenge sammenligner
    # korrekt leksikografisk, samme UTC-format fra Supabase).
    if only_ids is not None:
        # Fast liste: præcis de valgte, i listens rækkefølge, uanset klik.
        order = {rid: i for i, rid in enumerate(only_ids)}
        ranked = sorted((r for r in ranked if r["id"] in order), key=lambda r: order[r["id"]])
    else:
        ranked.sort(key=lambda r: (r["total_points"], r["created_at"]), reverse=True)
    top = ranked[:limit]
    for r in top:
        del r["created_at"]
    return top


def build_home_data(products: list[dict]) -> dict:
    """Forudberegner forsidens kandidatpuljer (Ugens Tilbud, Køl (kategorisiden,
    ikke længere forsidesektionen), Populære varer, Lækre opskrifter), så
    app.py::home() på edge kan læse ét KV-opslag i stedet for at ramme D1 (2x)
    + Supabase (flere x) pr. samtidig sidevisning - det var hovedbidraget til
    1101/1102-nedbruddet under samtidig trafik.
    Butiksfiltrering (_adjust_for_stores) forbliver pr.-request i app.py,
    da den afhænger af den enkelte besøgendes cookie/query-param."""
    sale_cands, mejeri_cands = [], []
    by_id: dict[str, dict] = {}
    for p in products:
        pid = str(p.get("/product/id", "")).strip()
        if pid and pid not in by_id:
            by_id[pid] = p
        if not _home_is_allowed(p):
            continue
        if p.get("/product/sale_price") or p.get("/product/is_any_sale"):
            sale_cands.append(p)
        if str(p.get("/product/product_type") or "Andre varer") == CAT_MEJERI:
            mejeri_cands.append(p)

    # Bland ALLE kandidater før afskæring. At tage de første N i cache-
    # rækkefølgen gav en fast, butiks-skæv forside på edge (lokalt blandes
    # puljen pr. request) - ingen butik må være prioriteret.
    random.shuffle(sale_cands)
    random.shuffle(mejeri_cands)
    sale_raw = [slim_product(p) for p in sale_cands[:_HOME_SALE_LIMIT]]
    mejeri_raw = [slim_product(p) for p in mejeri_cands[:_HOME_MEJERI_LIMIT]]

    pop_ids = fetch_popular_product_ids()
    fav_pool = [
        slim_product(by_id[pid]) for pid in pop_ids
        if pid in by_id and _home_is_allowed(by_id[pid])
    ]

    return {
        "sale_raw": sale_raw,
        "mejeri_raw": mejeri_raw,
        "pop_ids": pop_ids,
        "fav_pool": fav_pool,
        "recipe_pool": fetch_recipe_pool(),
        # Forsidens faste 10, så længe opskrifter er skjult (app.py vælger).
        "recipe_pool_locked": fetch_recipe_pool(only_ids=_HOME_RECIPES_LOCKED_IDS),
    }


def write_home_data(data: dict) -> None:
    payload = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        f.write(payload)
        path = f.name
    try:
        _kv_all(["key", "put", _HOME_KV_KEY, f"--path={path}"])
        print(f"  {_HOME_KV_KEY} opdateret ({len(payload) / 1024:.0f} KB)")
    except Exception as e:
        print(f"  advarsel: kunne ikke skrive {_HOME_KV_KEY}: {e}")
    finally:
        os.unlink(path)


def set_cache_version() -> None:
    """Skriv en ny cache_version til KV. Worker'en bruger den i cache-nøglen,
    så den daglige opdatering automatisk nulstiller edge-cachen (friske priser
    med det samme). Fejler blødt - caching virker stadig med gammel version."""
    version = str(int(time.time()))
    try:
        _kv_all(["key", "put", "cache_version", version])
        print(f"  cache_version = {version}")
    except Exception as e:
        print(f"  advarsel: kunne ikke sætte cache_version: {e}")


def last_seed_info() -> tuple[float, str] | None:
    """(timer siden sidste fulde reseed, hvilket miljø det var).

    Tidsstemplet er FÆLLES for madshopper og madshopper-dev, fordi D1-budgettet
    er konto-bredt (se GUARD_KV_NAMESPACE_ID). Miljø-mærket gemmes med, så
    produktionens natlige seed ikke bliver sultet ihjel af et staging-seed -
    se guarden i main().

    Formatet er "<epoch>" (gammelt, uden mærke) eller "<epoch>:<env>". Ukendt
    mærke læses som "prod", så en gammel værdi opfører sig som før.

    Fejler ÅBENT (returnerer None) - en manglende læsning må ikke i sig selv
    blokere en seed."""
    try:
        result = subprocess.run(
            ["npx", "wrangler", "kv", "key", "get", "d1_last_full_seed",
             "--namespace-id", GUARD_KV_NAMESPACE_ID, "--remote"],
            cwd=WRANGLER_CWD, capture_output=True, text=True, timeout=30,
        )
        value = result.stdout.strip()
        if result.returncode != 0 or not value:
            return None
        stamp, _, env = value.partition(":")
        return (time.time() - float(stamp)) / 3600, (env or "prod")
    except Exception:
        return None


def mark_seeded() -> None:
    env_tag = "staging" if TABLE_SUFFIX else "prod"
    try:
        subprocess.run(
            ["npx", "wrangler", "kv", "key", "put", "d1_last_full_seed",
             f"{int(time.time())}:{env_tag}",
             "--namespace-id", GUARD_KV_NAMESPACE_ID, "--remote"],
            cwd=WRANGLER_CWD,
            check=True,
        )
    except Exception as e:
        print(f"  advarsel: kunne ikke gemme reseed-tidsstempel: {e}")


def main() -> int:
    if os.environ.get("DEPLOY_ENV") == "staging":
        # Staging har ingen egen D1 længere (12-10-2026). Uden dette værn ville
        # en gammel DEPLOY_ENV=staging-kommando seede PRODUKTIONENS tabel.
        print("Staging læser produktionens D1; nattens seed skriver også dens KV. Intet at gøre.")
        return 0
    # D1's gratis-plan-budget (100k rows written/dag, KONTO-bredt - delt
    # mellem madshopper og madshopper-dev) blev sprunget 7x på én dag
    # 2026-07-19 af gentagne fulde reseeds, og igen 2026-07-20. En fuld
    # reseed skriver hele produkt-tabellen på ny, så gentagne kørsler samme
    # dag (planlagt + manuel + fallback-triggere) rammer budgettet hurtigt.
    # Spær derfor medmindre FORCE_RESEED=1 er sat eksplicit (fx til en
    # hastende prisrettelse, hvor man accepterer risikoen).
    seeding_prod = not TABLE_SUFFIX
    info = last_seed_info()
    if info is not None and not os.environ.get("FORCE_RESEED"):
        age, last_env = info
        # Produktionens seed viger ikke for et staging-seed. Guarden findes for
        # at bremse GENTAGNE fulde reseeds (D1-budgettet er konto-bredt), ikke
        # for at lade et dev-push kl. 20 spise nattens prod-kørsel kl. 01 - det
        # skete tavst med exit 0, så prod-D1 og cache_version stod på
        # gårsdagens data et helt døgn med grøn CI. Prod seeder én gang i
        # døgnet uanset hvad; det er staging der må vente.
        yields_to_prod = seeding_prod and last_env == "staging"
        if age < GUARD_HOURS and not yields_to_prod:
            print(
                f"Sprunget over: sidste fulde D1-reseed ({last_env}) var for "
                f"{age:.1f} time(r) siden (< {GUARD_HOURS}t-grænse). Sæt FORCE_RESEED=1 for at "
                f"køre alligevel."
            )
            return 0
        if yields_to_prod and age < GUARD_HOURS:
            print(
                f"Sidste reseed var staging for {age:.1f} time(r) siden - "
                f"produktions-seed koerer alligevel."
            )

    # Reservér guarden HER, straks efter tjekket er bestået - ikke først ved
    # succesfuld afslutning (databaserevision 17-08-2026, fund L8). Uden dette
    # er der et TOCTOU-vindue: to næsten-samtidige kørsler (manuel + planlagt,
    # eller to FORCE_RESEED-kørsler) kunne begge læse "ingen nylig seed" og
    # begge fortsætte, hvilket ville fordoble D1-budgetforbruget og potentielt
    # sammenflette to skema-opbygninger. Bagsiden: fejler denne kørsel efter
    # dette punkt, blokerer guarden en øjeblikkelig retry uden FORCE_RESEED=1 -
    # det er en bevidst accept, ikke en fejl: netop ukontrollerede gentagne
    # forsøg samme dag var det der sprængte D1-budgettet 2026-07-19/07-20 (se
    # kommentaren ovenfor). mark_seeded() kaldes igen ved reel succes nedenfor,
    # så tidsstemplet ender med at afspejle den faktiske færdiggørelsestid.
    mark_seeded()

    products = fetch_products()
    if not products:
        print("Ingen produkter - afbryder.")
        return 1

    # Dæknings-værn: updater.py har sit eget (run_updater), men dette script
    # kan køres selvstændigt og seede D1 direkte fra hvad der p.t. ligger i
    # Supabase' app_cache - en anden sti end updateren, og derfor et separat
    # sikkerhedsnet mod at seede + bumpe cache_version med en Rema-only-cache
    # (ingen prissammenligninger) eller et kollaps i antal produkter.
    if len(products) < 8000:
        print(f"Kun {len(products)} produkter (forventet 8000+) - afbryder uden at seede.")
        return 1
    matched = sum(1 for p in products if p.get("/product/store_matches"))
    coverage = matched / len(products)
    if coverage < 0.25:
        print(
            f"Kun {coverage * 100:.1f}% af {len(products)} produkter har en "
            f"butiksmatch (forventet 50%+) - afbryder uden at seede."
        )
        return 1

    print("Opretter schema ...")
    run_wrangler_sql(SCHEMA)

    sidx_version = int(time.time() // 60)
    postings: dict = {}

    insert_prefix = (
        "INSERT INTO products_new "
        "(rowid,id,category,subcategory,title,price,eff_price,is_sale,organic,lactose,weight_g,store,stores,search_text,data) VALUES "
    )

    file_sql: list[str] = []
    file_bytes = 0
    batch: list[str] = []
    batch_bytes = 0
    total = 0
    file_count = 0

    def flush_file():
        nonlocal file_sql, file_bytes, file_count
        if not file_sql:
            return
        file_count += 1
        print(f"  skriver batch-fil #{file_count} ({file_bytes / 1024:.0f} KB) ...")
        run_wrangler_sql("\n".join(file_sql))
        file_sql = []
        file_bytes = 0

    def flush_batch():
        nonlocal batch, batch_bytes, file_bytes
        if not batch:
            return
        stmt = insert_prefix + ",".join(batch) + ";"
        file_sql.append(stmt)
        file_bytes += len(stmt)
        batch = []
        batch_bytes = 0

    seen_ids: set[str] = set()
    stats: dict = {}
    dupes = 0
    placeholders = 0

    for p in products:
        pid = str(p.get("/product/id", "")).strip()
        if not pid or pid in ("None", "nan"):
            continue
        if pid in seen_ids:
            dupes += 1
            continue
        # Kort med placeholder-billede (butikslogo) frafiltreres ALTID ved
        # visning af filter_products_by_stores i app.py - de kan aldrig ses.
        # Men de laa i D1 og blev talt med i COUNT og i LIMIT/OFFSET, saa
        # pagineringen fik huller: en side kunne vise 57 varer i stedet for 60,
        # og total_pages var for hoej. ~2% af kataloget.
        if str(p.get("/product/imageLink", "")).strip() in _PLACEHOLDER_IMGS:
            placeholders += 1
            continue
        seen_ids.add(pid)
        if total >= _SIDX_ROW_SPAN:
            print(f"Over {_SIDX_ROW_SPAN} produkter - rowid-versionering holder ikke. Afbryder.")
            return 1
        values = build_row_values(
            p, stats, rowid=sidx_version * _SIDX_ROW_SPAN + total, postings=postings,
        )
        if not values:
            continue
        # Én meget stor vare kan alene overstige grænsen - send den solo.
        if batch and batch_bytes + len(values) >= MAX_STMT_BYTES:
            flush_batch()
            if file_bytes >= BYTES_PER_FILE:
                flush_file()
        batch.append(values)
        batch_bytes += len(values) + 1
        total += 1

    flush_batch()
    flush_file()

    if placeholders:
        print(f"  {placeholders} kort med placeholder-billede udeladt (kan alligevel ikke vises)")
    if dupes:
        print(f"  advarsel: sprang {dupes} duplikerede produkt-id'er over")

    print(f"Skriver søgeindeks til KV (version {sidx_version}) ...")
    sidx_entries, sidx_manifest = build_search_shards(postings, sidx_version)
    sidx_ok = write_search_shards(sidx_entries)

    print("Skifter til ny tabel (swap) ...")
    run_wrangler_sql(FINALIZE)

    if sidx_ok:
        write_search_version(sidx_manifest)

    print("Skriver D1-optællinger til KV (d1_stats_v1) ...")
    write_d1_stats(stats)

    print("Skriver tilbudslister pr. butik til KV (offer_ids_v1) ...")
    write_offer_ids(build_offer_ids(stats))

    print("Forudberegner forside-data (sale/køl/favoritter) ...")
    write_home_data(build_home_data(products))

    print("Nulstiller edge-cache (cache_version) ...")
    set_cache_version()
    mark_seeded()

    print(f"Færdig - {total} produkter indlæst i D1 ({file_count} batch-filer).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
