"""
Netto komplet produktkatalog scraper.
- Algolia prod_NETTO_PRODUCTS: navn, EAN, kategori, vægt, billede OG pris.
- Priser ligger direkte i Algolia-indekset (storeData[butik].price i øre) - ligesom
  Bilka. Vi bruger derfor IKKE længere Salling Group /v2/products API'et, som var
  rate-limitet (~60 kald/min + daglig kvote) og kun nåede at prissætte en brøkdel
  af kataloget. Nu får ~alle fødevarer en pris i ét træk.

Netto, Føtex og Bilka har samme moderfirma (Salling Group), men er separate kæder
med hver deres priser - derfor læses Netto-prisen fra Netto' eget indeks.
"""
import os, sys, requests, time
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from supabase_utils import get_client, enrich_billede_hashes, shrink_guard_ok, fetch_existing_products, save_product_dicts, salling_offer_fields
from salling_mad import is_food_hit, assert_hierarchy_healthy, kategori

# ── Algolia ──────────────────────────────────────────────────────────────────
ALGOLIA_APP_ID = 'F9VBJLR1BK'
ALGOLIA_KEY    = 'd4f161f51f749bdd5baf699175d5f956'
ALGOLIA_INDEX  = 'prod_NETTO_PRODUCTS'
ALGOLIA_URL    = f'https://{ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/{ALGOLIA_INDEX}/query'
ALGOLIA_ATTRS  = ['name', 'isInCurrentLeaflet', 'gtin', 'objectID', 'brand', 'manufacturer',
                  'units', 'unitsOfMeasure',
                  'consumerFacingHierarchy', 'categories', 'images', 'productType', 'properties',
                  'storeData']
ALGOLIA_HEADERS = {'X-Algolia-Application-Id': ALGOLIA_APP_ID, 'X-Algolia-API-Key': ALGOLIA_KEY}

# Reference-butik (fysisk Netto) til pris/tilbud. Falder tilbage til enhver butik
# med pris, hvis referencebutikken ikke fører varen.
REF_STORES = ['7701']

# ── Supabase ──────────────────────────────────────────────────────────────────
BUTIK   = 'Netto'

# Nettos indeks rummer også handelsenheder (kolli og hele paller) uden mål:
# målt 11-11-2026 "Faxe Kondi" og "Pepsi Max" til 1.650 kr, "Shiraz-Cabernet"
# 620 kr, "Carlsberg Master Brew" 564 kr, alle uden vægt og uden literpris.
# De stod på siden som almindelige varer. En vare uden mål til 100 kr eller
# mere udelades; de billige uden mål (Mariekiks 5 kr) er rigtige varer, hvor
# Netto blot mangler at udfylde feltet.
_CASE_WITHOUT_SIZE_MIN_PRICE = 100.0


def _algolia_page(page: int) -> list[dict]:
    r = requests.post(ALGOLIA_URL, json={
        'query': '', 'hitsPerPage': 100, 'page': page,
        'attributesToRetrieve': ALGOLIA_ATTRS,
    }, headers=ALGOLIA_HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()['hits']


def fetch_all_algolia() -> list[dict]:
    r = requests.post(ALGOLIA_URL, json={
        'query': '', 'hitsPerPage': 100, 'page': 0,
        'attributesToRetrieve': ALGOLIA_ATTRS,
    }, headers=ALGOLIA_HEADERS, timeout=15)
    r.raise_for_status()
    data = r.json()
    nb_pages = data['nbPages']
    print(f'  Algolia: {data["nbHits"]} produkter, {nb_pages} sider')

    all_hits = list(data['hits'])
    for page in range(1, nb_pages):
        hits = _algolia_page(page)
        all_hits.extend(hits)
        if page % 10 == 0:
            print(f'    Side {page}/{nb_pages} ({len(all_hits)} produkter)...')
        time.sleep(0.15)

    print(f'  Algolia done: {len(all_hits)} produkter hentet')
    return all_hits


def _norm_unit(unit: str) -> str:
    return (unit or '').strip().rstrip('.').lower()


def _ref_store(hit: dict) -> dict | None:
    """Vælg prisdata fra referencebutik, ellers enhver butik med pris."""
    sd = hit.get('storeData') or {}
    for sid in REF_STORES:
        v = sd.get(sid)
        if v and v.get('price'):
            return v
    for v in sd.values():
        if v and v.get('price'):
            return v
    return None


def _kg_price(hit: dict, ref: dict | None) -> str | None:
    # Nettos unitsOfMeasurePrice er upålidelig (matcher kun hyldeprisen ~76% af
    # tiden); unitsOfMeasureOfferPrice er den faktiske effektive per-enheds-pris
    # (verificeret 100% match mod pris for 1 l/1 kg-varer).
    r = ref or {}
    val  = r.get('unitsOfMeasureOfferPrice') or r.get('unitsOfMeasurePrice')
    unit = r.get('unitsOfMeasurePriceUnit')
    if val and unit:
        return f'{val / 100:.2f} kr/{_norm_unit(unit)}'
    return None


def _weight(hit: dict) -> str | None:
    vol = hit.get('units')
    unit = hit.get('unitsOfMeasure')
    if vol and unit:
        return f'{vol} {unit}'
    return None


def build_rows(hits: list[dict]) -> list[dict]:
    # Genbrug gårsdagens billede_hash ved uændret billed-URL - se
    # bilka_katalog.py's build_rows for begrundelsen (fund M3).
    _hash_cache = fetch_existing_products(BUTIK)
    rows = []
    skipped_cases = []
    for hit in hits:
        naam = (hit.get('name') or '').strip()
        ean  = str(hit.get('gtin') or '').strip()
        if not naam or not ean:
            continue

        ref = _ref_store(hit)
        price_ore = (ref or {}).get('price')
        if not price_ore:
            continue

        on_offer, normalpris, multikob = salling_offer_fields(hit, ref, price_ore)
        pris = round(price_ore / 100, 2)

        vaegt = _weight(hit)
        if not vaegt and pris >= _CASE_WITHOUT_SIZE_MIN_PRICE:
            # Kolli og paller uden mål (se konstanten).
            skipped_cases.append(f'{naam} {pris:.2f} kr')
            continue

        # 'Avis' = i ugens avis (isInCurrentLeaflet). Stadig et tilbud for
        # updater.py, men kun de varer tæller i "Tilbudsavis pr. butik"
        # (Feature 'butiksaviser'): Sallings øvrige tilbud (Skarp pris,
        # webkampagner, multikøb) gav Føtex over 2.000 "avisvarer".
        if hit.get('isInCurrentLeaflet'):
            tilbud = 'Avis'
        else:
            tilbud = 'Ja' if (on_offer or multikob) else 'Nej'
        producent = (hit.get('brand') or hit.get('manufacturer') or 'Salling').strip() or 'Salling'
        images = hit.get('images') or []
        billede = images[0] if images else ''

        cached = _hash_cache.get(ean)
        reused_hash = (cached['billede_hash']
                       if cached and cached.get('billede_url') == billede and cached.get('billede_hash')
                       else None)

        rows.append({
            'butik':       BUTIK,
            'kategori':    kategori(hit),
            'navn':        naam,
            'producent':   producent,
            'netto_vaegt': vaegt,
            'kg_price':    _kg_price(hit, ref),
            'pris':        pris,
            'normalpris':  normalpris,
            'varenummer':  ean,
            'billede_url': billede,
            'billede_hash': reused_hash,
            'tilbud':      tilbud,
            'multikob':    multikob or None,
        })
    if skipped_cases:
        print(f'  {len(skipped_cases)} kolli/paller uden mål udeladt: ' + '; '.join(skipped_cases))
    enrich_billede_hashes(rows)
    return rows


def main():
    print('Starter Netto katalog scraper (Algolia)...')

    hits = fetch_all_algolia()
    assert_hierarchy_healthy(hits, BUTIK)
    food_hits = [h for h in hits if h.get('gtin') and is_food_hit(h)]
    print(f'  {len(hits)} produkter → {len(hits) - len(food_hits)} ikke-mad fjernet → {len(food_hits)} fødevarer')

    rows = build_rows(food_hits)
    print(f'  {len(rows)} rækker med pris bygget')

    print('\nEksempel (første 5):')
    for r in rows[:5]:
        print(f"  {r['navn']:35.35s} {r['pris']:>7} kr  {r['producent']:15.15s} "
              f"{r['netto_vaegt'] or '':>8}  tilbud={r['tilbud']}")

    # Hele butikken erstattes: kataloget er nu eneste kilde (ugens avisvarer
    # ligger i det via isInCurrentLeaflet). Rydder samtidig de gamle
    # Tjek-tilbudsrækker (kategori 'Tilbudsavis') væk ved første kørsel.
    save_product_dicts(BUTIK, rows)
    print(f'\nFærdig! {len(rows)} Netto-produkter gemt.')


if __name__ == '__main__':
    main()
