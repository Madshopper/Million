#!/usr/bin/env python3
"""Genererer paritets-fixtures for TS-porten af app_support.py (apps/web/src/lib/support).

Køres fra repo-roden (kræver data/app_cache_local.json og Python-afhængighederne):

    python3 apps/web/test/parity/gen_support_fixtures.py

Skriver apps/web/test/parity/fixtures/support.json, som
apps/web/test/parity/support.test.ts sammenligner TS-porten imod.

Stikprøven er deterministisk (hver N'te vare + udvalgte kanttilfælde +
syntetiske varer). Halvdelen beriges som scripts/seed-d1.py::build_row_values
gør det (flavor_kw/subcategory/is_organic/is_lactose_free i data-blob'en), den
anden halvdel ikke - så både D1-stien og fallback-stierne dækkes.
"""
from __future__ import annotations

import copy
import json
import os
import sys
import urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
sys.path.insert(0, ROOT)
os.environ.pop('CLOUDFLARE_WORKERS', None)

import app_support as A  # noqa: E402
import app as APP  # noqa: E402
from werkzeug.datastructures import MultiDict  # noqa: E402

# Miljøvariabler til en fuld engangskørsel (fx STEP=1) uden at røre den committede fixture.
OUT = os.environ.get('SUPPORT_FIXTURE_OUT') or os.path.join(os.path.dirname(__file__), 'fixtures', 'support.json')
STEP = int(os.environ.get('SUPPORT_FIXTURE_STEP') or 26)


# ── Samme berigelse/slankning som scripts/seed-d1.py ─────────────────────────
_TOP_DROP = frozenset({"/product/image_hash", "/product/weight_grams"})
_MATCH_DROP = frozenset({"_hash_int", "_norm_name", "_image_hash", "_weight_g", "_stk_count"})


def slim_product(p: dict) -> dict:
    out = {}
    for k, v in p.items():
        if k in _TOP_DROP:
            continue
        if k == "/product/store_matches" and isinstance(v, dict):
            out[k] = {sk: ({mk: mv for mk, mv in m.items() if mk not in _MATCH_DROP}
                           if isinstance(m, dict) else m) for sk, m in v.items()}
        else:
            out[k] = v
    return out


def enrich(p: dict) -> dict:
    """Spejler build_row_values' mutation af p (de fire /product/*-felter)."""
    category = str(p.get("/product/product_type") or "Andre varer")
    title = str(p.get("/product/title", ""))
    subcategory = A._get_subcategory(title, category)
    desc = str(p.get("/product/description", "") or "")
    brand = str(p.get("/product/brand", "") or "")
    base_text = " ".join([
        str(p.get("/product/title", "")),
        str(p.get("/product/brand", "")),
        str(p.get("/product/description", "")),
    ])
    img_url = str(p.get("/product/imageLink", ""))
    flavor_kw = A.get_search_flavor_keywords(base_text, img_url)
    p["/product/flavor_kw"] = A.normalize_name(flavor_kw) if flavor_kw else ""
    p["/product/subcategory"] = subcategory
    p["/product/is_organic"] = bool(A.is_organic(title, desc, brand))
    p["/product/is_lactose_free"] = bool(A.is_lactose_free(title, desc, brand))
    return p


def synthetic() -> list[dict]:
    base = {'/product/id': 'syn', '/product/title': 'Syntetisk vare', '/product/price': 10.0}
    out = []

    def add(**kw):
        d = dict(base)
        d['/product/id'] = f'syn{len(out)}'
        for k, v in kw.items():
            d['/product/' + k] = v
        out.append(d)

    add(title='Øko Mælk 1 L')
    add(title='Letmælk', brand=None, description=None)
    add(title='Pris med komma', price='12,5')
    add(title='Pris som tekst', price=' 12.5 ')
    add(title='Pris mangler', price=None)
    add(title='Tilbud nul', sale_price=0.0, sale_price_effective_date='2026-10-01T00:00:00+02:00/2026-10-07T23:59:59+02:00')
    add(title='Stk nul', stk_count=0, unit_pricing_measure='10 stk.')
    add(title='Multipak', unit_pricing_measure='6 x 0,33 liter')
    add(title='Multipak nul', unit_pricing_measure='0 x 5 g')
    add(title='Dårlig vægt', unit_pricing_measure='1.2.3 g', weight_g='500')
    add(title='Vægt tekst', unit_pricing_measure='', weight_g='abc')
    add(title='Vægt kg', unit_pricing_measure=' 1,5 KG ')
    add(title='Stk st', unit_pricing_measure='10 st')
    add(title='nan vægt', unit_pricing_measure='nan')
    add(title='Prince Rød 20 stk', brand='HARDBOX')
    add(title='LU Prince kiks chokolade', brand='LU')
    add(title='Deli kylling', brand='Deli Bilka', store='Bilka')
    add(title='Bilka deli match', store='Netto', store_matches={'bilka': {'name': 'x', 'price': 5.0, 'brand': 'Deli X'}})
    add(title='Bilka brand None', store='Netto', store_matches={'bilka': {'name': 'x', 'price': 5.0, 'brand': None}})
    add(title='🍓 Jordbær yoghurt', description='Med ægte jordbær', brand='Arla')
    add(title='Placeholder billede', imageLink='/static/images/bilka-logo.png')
    add(title='Tobaksbillede', imageLink='https://rema-product-images.digital.rema1000.dk/521400/1-large-x.webp')
    add(title='Rema tobak id', id='521500')
    add(title='Rema pris tom', rema_price='', store='Netto')
    add(title='Rema pris tekst', rema_price='abc', store='Netto')
    add(title='Rema pris streng', rema_price='5', store='Netto', rema_image=' nan ')
    add(title='Rema billede', rema_price=7.5, store='Netto', rema_image='https://img.example/rema.png')
    add(title='Mange matches', store='Bilka', rema_price=20.0, store_matches={
        'netto': {'name': 'Netto vare', 'price': None, 'brand': 'X', 'Kategori': 'Kolonial'},
        'foetex': {'name': 'Føtex vare', 'price': '0', 'image': 'nan', 'Kategori': 'kiosk'},
        'lidl': {'name': 'Lidl Cola Zero', 'price': 'abc', 'Kategori': 'kiosk'},
        'meny': {'name': 'Meny vare', 'price': 9.95, 'is_sale': True, 'normal_price': 12.0,
                 'image': 'https://img.example/m.png', 'weight': '500 g', 'kg_price': 19.9,
                 'multi_deal': '2 for 15', 'Kategori': 'Mejeri', 'brand': 'None'},
        'spar': {'name': 'Spar vare', 'is_sale': True, 'price': 8.5, 'normal_price': None, 'Kategori': ''},
        'mk': {'name': 'MK chips', 'Kategori': 'kiosk - slik og snack - chips og snacks'},
        'ukendt': {'name': 'Ukendt butik', 'price': 1.0},
    })
    add(title='Tilbud dato kort', sale_price=5.0, sale_price_effective_date='2026-1-5T1:2:3+0200/2026-1-5T1:2:3+0200')
    add(title='Tilbud dato dårlig', sale_price=5.0, sale_price_effective_date='a/2026-02-30T00:00:00+02:00')
    add(title='Tilbud dato Z', sale_price=5.0, sale_price_effective_date='a/ 2026-12-24T10:00:00Z ')
    add(title='Flavor tom', flavor_kw='')
    add(title='Kun is organic', is_organic=None, is_lactose_free=0)
    add(title='Subcat tom', subcategory='', product_type='Køl')
    add(title='Mangler type', product_type=None)
    d = {'/product/id': 'bare', '/product/price': 3}
    out.append(d)
    return out


SALE_DATES = [
    '2026-10-05T23:59:59+02:00', '2026-1-5T1:2:3+0200', '2026-02-30T00:00:00+02:00',
    '2026-02-29T00:00:00+02:00', '2028-02-29T00:00:00+02:00', '2026-10-05T23:59:60+02:00',
    '2026-10-05t23:59:59+02:00', '2026-10-05t23:59:59z', '2026-10-05T23:59:59Z',
    '2026-10-05T23:59:59+24:00', '2026-10-05T23:59:59+23:59:59.123', '2026-10- 5T00:00:00Z',
    '2026-10-05T00:00:00 Z', '2026-10-05T00:00:00+02:0030', '2026-10-05T00:00:00+0200:30',
    '2026-10-05T00:00:00+020030', '2026-10-05T00:00:00+02', '0000-01-01T00:00:00Z',
    '2026-13-01T00:00:00Z', '2026-10-05T24:00:00Z', '2026-10-05', '', ' ',
    '2026-10-05T00:00:00-05:30', '2026-10-05T00:00:00+02:00:00.1234567',
]

TEXTS = [
    'HK. SVINEKØD 8-12%', 'Hakket oksekød 4-7% fedt', "Lay's Sour Cream & Onion", 'F.eks. eks. ekstra',
    'Øko Mælk', 'Økologisk Mælk', 'økologiske æg', 'Kyl. bryst', 'Champ. i skiver', 'Sdj. sennep',
    'Vanille is', 'Vanilla Ice', 'Chai Latte Vanill.', 'Jordbæ/Rabarb', 'Æble/Hindb', 'Sc/Purløg',
    'Smørbart', 'smrbar', 'Hyldebl. saft', 'Peberm. pastiller', 'Chokol. kiks', 'Vanilj. sukker',
    'Café crème', 'Ålborg Akvavit', 'Crème Fraîche 18%', 'ﬁne ﬂour', 'İstanbul', 'STRASSE ẞ',
    '  dobbelt   mellemrum\t\n', 'A/S Brand', 'Bio Brand Eko', 'Mælk & Fløde + Ost, Smør', 'nan', '',
    '日本 茶', '١٢٣ عربي', 'x²', 'Ⅻ romertal', '🍓 jordbær', 'pølser', 'juleøl', 'gris', 'rispapir',
    'saltkaramelsmag', 'pebermyntefyld', 'mælkechokoladeovertræk', 'druesukker', 'Piña Colada',
    'Æblemost Løgismose', 'Røget tunge', 'Neptun tun', 'chokokaramel', 'h.løg flødeost',
    'vandmelon', 'Extra Refresh Melon', 'sour cream', 'sourcream', 'lakridskarameller',
    'spearmintsmag', 'chocolatier', 'Kims Sour & Onion', 'Org. sodavand', 'ikke økologisk mælk',
    'ikke  øko', 'Økonomipakke', 'organic oats', 'Lacto mælk', 'laktosefri', 'Lactofree', 'lacto-free',
    'Arla Lacto', 'lactose free', 'Libero bleer', 'Babyshampoo', 'Spraymaling', 'hyldeblomst', 'æble juice',
    'Valg pomodoro', 'LG tv', 'King\'s', 'L&M blå', 'Romaine salat', 'Proteindrik', 'kokosdrik',
    'TV-Mix', 'cremefraiche', 'balsamico', '7-tv-dage', 'Lolly is', 'frys-selv is', 'Cola Zero',
]

UNITS = [
    '500 g', '1 kg', '1,5 l', '33 cl', '2 dl', '250 ml', '1 ltr', '1 liter', '1 litre', '500 gr', '500 gram',
    '6 x 0.33 liter', '8 x 40.75 g', '6x0,33l', '6 X 33 CL', '0 x 5 g', '2 x 1.2.3 g', '1.2.3 g', '. g', '..',
    '10 stk', '10 stk.', '10 st', '10 STK', '1.5 stk', '. stk', 'stk', '9 ct', '9 L.B', '9', '', 'nan', 'None',
    '  500 g  ', '500g', '500 kgx', '½ kg', '١٠٠ g', '١٠ stk', '3 x ١٠٠ g', '1e3 g', '5 pk', '6 x 0,33 liter.',
]


def py_set_sorted(s):
    return sorted(s)


def compute():
    with open(os.path.join(ROOT, 'data', 'app_cache_local.json')) as f:
        all_products = json.load(f)['products']

    picked: list[int] = list(range(0, len(all_products), STEP))
    chosen = set(picked)
    # Kanttilfælde: fang de første k af hver slags uden for den faste stikprøve.
    edge_preds = [
        lambda p: p.get('/product/brand') is None,
        lambda p: p.get('/product/sale_price') is not None,
        lambda p: bool(p.get('/product/stk_count')),
        lambda p: '/' in (p.get('/product/sale_price_effective_date') or ''),
        lambda p: any((m or {}).get('normal_price') for m in (p.get('/product/store_matches') or {}).values()),
        lambda p: len(p.get('/product/store_matches') or {}) >= 4,
        lambda p: ' x ' in (p.get('/product/unit_pricing_measure') or ''),
        lambda p: p.get('/product/store') in ('Lidl', 'Løvbjerg', 'ABC Lavpris', 'Kvickly', 'Brugsen'),
        lambda p: any(c in (p.get('/product/title') or '') for c in 'æøåÆØÅéü'),
        lambda p: 'øko' in (p.get('/product/title') or '').lower(),
        lambda p: 'laktosefri' in (p.get('/product/title') or '').lower(),
    ]
    for pred in edge_preds:
        n = 0
        for i, p in enumerate(all_products):
            if i in chosen or not pred(p):
                continue
            picked.append(i)
            chosen.add(i)
            n += 1
            if n >= 25:
                break

    products = [slim_product(all_products[i]) for i in picked] + synthetic()
    raws = []
    for idx, p in enumerate(products):
        p = copy.deepcopy(p)
        enriched = idx % 2 == 0 and not p['/product/id'].startswith(('syn', 'bare'))
        if enriched:
            enrich(p)
        raws.append({'raw': p, 'enriched': enriched})

    def guard(fn):
        try:
            return {'ok': fn()}
        except Exception as e:  # noqa: BLE001
            return {'error': type(e).__name__}

    def strip_display(d):
        return {k: v for k, v in d.items() if k not in ('store_matches', '_norm_fields')}

    store_sets = {
        'none': None, 'rema': {'Rema 1000'}, 'netto_foetex': {'Netto', 'Føtex'}, 'lidl': {'Lidl'},
        'empty': set(), 'dagrofa': {'Meny', 'Spar', 'Min Købmand'}, 'bilka': {'Bilka'},
    }

    per_product = []
    displays = []
    for entry in raws:
        p = entry['raw']
        title = p.get('/product/title', '')
        brand = p.get('/product/brand', '')
        desc = p.get('/product/description', '')
        img = str(p.get('/product/imageLink', ''))
        text = ' '.join([str(title), str(brand), str(desc)])
        rec = {
            'norm': [A.normalize_name(title), A.normalize_name(brand), A.normalize_name(desc)],
            'flavors': py_set_sorted(A.get_product_flavors(text)),
            'img_flavors': py_set_sorted(A.extract_image_flavor_keywords(img)),
            'search_kw': sorted(A.get_search_flavor_keywords(text, img).split()),
            'subcat': A._get_subcategory(str(title), str(p.get('/product/product_type') or 'Andre varer')),
            'organic': A.is_organic(str(title), str(desc), str(brand)),
            'lactose': A.is_lactose_free(str(title), str(desc), str(brand)),
            'nonfood': A.is_non_food_name(title),
            'age': A.is_age_restricted(title, brand, '', p.get('/product/id', '')),
            'weight': A.parse_weight_to_grams(p.get('/product/unit_pricing_measure')),
            'stk': A.parse_stk_count(p.get('/product/unit_pricing_measure')),
            'sale_end': A.parse_sale_end_date(p),
            'unify': [[m.get('Kategori', ''), m.get('name', ''), m.get('brand', ''),
                       A.unify_category(m.get('Kategori', ''), m.get('name', ''), m.get('brand', ''))]
                      for m in (p.get('/product/store_matches') or {}).values() if isinstance(m, dict)]
                     + [[p.get('/product/product_type'), title, brand,
                         A.unify_category(p.get('/product/product_type'), title, brand)]],
        }
        # Varianterne gemmes som forskel fra standard-dict'en (holder fixturen lille).
        disp = {}
        base_disp = None
        for key, kw in (('default', {}), ('cat', {'category': 'Frost'}), ('force', {'force_sale': True}),
                        ('sed', {'sale_end_date': '24/12'}), ('defcat', {'default_category': 'Kolonial'})):
            r = guard(lambda: A.product_to_display_dict(p, **kw))
            if 'ok' not in r:
                disp[key] = r
            elif key == 'default':
                base_disp = strip_display(r['ok'])
                disp[key] = {'ok': base_disp}
            else:
                o = strip_display(r['ok'])
                disp[key] = {'diff': {k: v for k, v in o.items() if k not in base_disp or base_disp[k] != v}}
        rec['display'] = disp
        d = guard(lambda: A.product_to_display_dict(p))
        if 'ok' in d:
            api = A.product_to_api_dict(d['ok'])
            # Serialiserede store_matches kun for hver 3. vare (størrelse).
            if len(per_product) % 3:
                api.pop('store_matches')
            rec['api'] = api
            displays.append((len(per_product), d['ok']))
        pfas = {}
        for name, ss in store_sets.items():
            avail = A.product_available_at_active_stores(p, ss)
            r = guard(lambda: A.product_for_active_stores(p, ss))
            if 'error' in r:
                res = r
            elif r['ok'] is None:
                res = {'none': True}
            elif r['ok'] is p:
                res = {'same': True}
            else:
                o = r['ok']
                res = {'diff': {k: v for k, v in o.items() if k not in p or p[k] != v}}
            pfas[name] = {'avail': avail, 'res': res}
        rec['pfas'] = pfas
        per_product.append(rec)

    by_store = {}
    raw_list = [e['raw'] for e in raws]
    ident = {id(p): i for i, p in enumerate(raw_list)}
    for name, ss in store_sets.items():
        by_store[name] = [ident[id(p)] for p in APP.filter_products_by_stores(raw_list, ss)]

    filter_args = [
        '', 'min_price=10', 'max_price=20.5', 'min_price=+12+', 'min_price=1e1', 'min_price=abc', 'min_price=inf',
        'max_price=nan', 'min_price=1_0', 'min_price=', 'sale=true', 'sale=True', 'organic=true', 'lactose=true',
        'min_weight=500', 'max_weight=1000', 'min_weight=0', 'min_weight=-1', 'subcategory=Ost',
        'subcategory=Mælk+%26+Fløde', 'sort=price-asc', 'sort=price-desc', 'sort=kg-price-asc', 'sort=name-asc',
        'sort=relevance', 'sort=price-asc&min_price=5&max_price=50&sale=true', 'min_price=5&min_price=100',
        'organic=true&sort=name-asc', 'max_weight=250&sort=price-desc',
    ]
    disp_objs = [d for _, d in displays]
    disp_ident = {id(d): i for i, (_, d) in enumerate(displays)}
    apply_res = []
    for qs in filter_args:
        args = MultiDict(urllib.parse.parse_qsl(qs, keep_blank_values=True))
        res = APP.apply_product_filters(list(disp_objs), args)
        apply_res.append([qs, [disp_ident[id(d)] for d in res]])

    queries = [
        'mælk', 'maelk', 'øl', 'oel', 'ost', 'hakket svinekød', 'hk svinekød', 'minmælk', 'yoghurt jordbær',
        'cola zero', 'chokolade', 'banan', 'kyllingebryst', 'rugbrød', 'pasta', 'æg', 'smør', 'kaffe',
        'øko æg', 'økologisk mælk', 'organic', 'kyllingbryst', 'chokolde', 'yoghurd', 'banen', 'rugbrod',
        'smoer', 'kafe', 'pizza', 'is', 'ris', 'te', 'vand', 'juice', 'appelsinjuice', 'jordbær', 'hindbær',
        'vanilje is', 'lakrids', 'chips', 'sour cream', 'sc chips', 'fuldkorn', 'leverpostej', 'remoulade',
        'skyr', 'havregryn', 'tun', 'laks', 'hyldeblomst', 'hyldebl', 'mango', 'mint', 'citron', 'lime',
        'kokos', 'xyzqwe', 'M&M', 'Lay\'s', 'café', 'ÆBLE', '  mælk  ', 'a', '', 'pølse', 'grillpølser',
        'sodavand', 'flødeboller', 'peberfrugt rød', 'strawberry', 'garlic',
    ]
    search = []
    for q in queries:
        strict, fuzzy, scores = [], [], {}
        for i, (_, d) in enumerate(displays):
            s = A.product_matches_query(d, q)
            fz = A.product_matches_query_fuzzy(d, q)
            if s:
                strict.append(i)
            if fz:
                fuzzy.append(i)
            if s or fz or i % 7 == 0:
                scores[str(i)] = A.search_match_score(d, q)
        search.append({'q': q, 'strict': strict, 'fuzzy': fuzzy, 'scores': scores})

    raw_queries = queries + ['  Øko Æg  ', 'ORGANIC milk', 'oeko-mælk', 'økologisk', 'org', 'orgel',
                             'økomælk', 'x' * 150, '🍓' * 120, 'Øko æg']
    strings = {
        'normalize': [[t, A.normalize_name(t)] for t in TEXTS + queries],
        'fold': [[t, A._fold(t)] for t in TEXTS],
        'flavors': [[t, py_set_sorted(A.get_product_flavors(t))] for t in TEXTS],
        'image_flavors': [[u, py_set_sorted(A.extract_image_flavor_keywords(u))] for u in [
            'https://x/hyldebl-saft_500ml.png', 'https://cdn/jordbaer_yoghurt.jpg', 'nan', 'None', '',
            'https://x/Vanilla-Ice/choko.webp', 'https://x/cola-zero.png']],
        'weight': [[u, A.parse_weight_to_grams(u)] for u in UNITS],
        'stk': [[u, A.parse_stk_count(u)] for u in UNITS],
        'organic': [[t, A.is_organic(t)] for t in TEXTS],
        'lactose': [[t, A.is_lactose_free(t)] for t in TEXTS],
        'nonfood': [[t, A.is_non_food_name(t)] for t in TEXTS],
        'age': [[t, A.is_age_restricted(t)] for t in TEXTS + ['Prince Original 100', 'Prince original 2-pak',
                                                              'LU\nPrince', 'lu prince kiks', 'e-cig']],
        'tobacco_id': [[v, A.is_rema_tobacco_id(v)] for v in [
            '521340', ' 521825 ', '521826', '561830', '+561830', '5_21_340', 'abc', '', '521340.0', '٥٢١٣٤٠']],
        'subcat': [[t, c, A._get_subcategory(t, c)] for t in TEXTS for c in
                   ('Køl', 'Drikkevarer', 'Frost', 'Kolonial', 'Andre varer', 'Ukendt')],
        'unify': [[r, t, b, A.unify_category(r, t, b)] for r in
                  ('', 'Kiosk', 'mejeri', 'Kød & Fisk', 'Andre varer', 'personlig pleje', 'ukendt kategori', None)
                  for t, b in ((x, '') for x in TEXTS[:60])] +
                 [[r, t, b, A.unify_category(r, t, b)] for r, t, b in [
                     ('', 'Prince kiks', ''), ('', 'Hvidvin', 'HARDBOX'), ('', 'Kiks', 'LU Prince'),
                     ('kiosk', 'Stimorol gum', ''), ('kiosk', 'Coleslaw', ''), ('', 'Romaine salat', ''),
                     ('', 'Proteindrik', ''), (None, None, None), ('', '', 'Libero')]],
        'sale_end': [[s, A.parse_sale_end_date({'/product/sale_price_effective_date': 'x/' + s})] for s in SALE_DATES],
        'clean_display': [[v, A.clean_display_text(v)] for v in
                          [None, 'None', ' nan ', 'NULL', 'undefined', 'NaT', '<NA>', 'Arla', ' Arla ', '', 0, True]],
        'ratio': [[a, b, A.rapid_ratio(a, b), A.rapid_token_sort(a, b)] for a, b in [
            ('mælk', 'maelk'), ('minmælk', 'minimælk'), ('', ''), ('a', ''), ('kyllingbryst', 'kyllingebryst'),
            ('b a!', 'a b'), ('Rød peberfrugt', 'Peberfrugt rød'), ('🍓abc', 'abc'), ('chokolde', 'chokolade'),
            ('abc', 'ABC')]],
        'fuzzy_hits': [[t, w, A._fuzzy_term_hits(t, w)] for t, w in [
            ('chokolde', ['chokolade']), ('kafe', ['kaffe']), ('abc', ['abc']), ('yoghurd', ['yoghurt', 'x']),
            ('minmælk', ['minimælk']), ('banen', ['banan']), ('xyzqwe', ['xyz']), ('rugbrod', ['rugbrød'])]],
        'term_can': [[t, A._term_can_match_flavor(t), A._term_can_fuzzy_match_flavor(t)] for t in
                     ['cola', 'jordbaer', 'jordbær', 'mælk', 'xyzqwe', 'chokolde', 'hindbaer', 'vanilje', 'sej',
                      'melo', 'watermelonx', 'ørred', 'oerred', 'kaffe', 'mint', 'pasta']],
        'token_match': [[a, b, A._token_matches_term(a, b)] for a, b in [
            ('øl', 'øl'), ('ølflaske', 'øl'), ('juleøl', 'øl'), ('pølser', 'øl'), ('ris', 'ris'), ('gris', 'ris'),
            ('rispapir', 'ris'), ('mælk', 'maelk'), ('hyldebl', 'hyldeblomst'), ('hyl', 'hylde'), ('', 'x'),
            ('🍓🍓🍓øl', 'øl'), ('abcøl', 'oel')]],
        'clean_query': [[q, APP._clean_search_query(q)] for q in raw_queries],
        'split_organic': [[q, list(APP._split_organic_intent(APP._clean_search_query(q)))] for q in raw_queries],
        'stores_since': [[v, A.stores_auto_enable_since(v)] for v in (0, 1, 2, 3, 4)],
        'paginate': [[n, page, per, list(APP._paginate(list(range(n)), page, per)[1:])]
                     for n in (0, 1, 59, 60, 61, 200) for page in (-1, 0, 1, 2, 4, 99) for per in (60, 7)],
        'tobacco_image': [[u, APP._is_tobacco_image(u)] for u in [
            'https://rema-product-images.digital.rema1000.dk/521400/1-large-x.webp',
            'https://rema-product-images.digital.rema1000.dk/100/1.webp', '', 'rema-product-images.digital.rema1000.dk/561830/']],
    }
    constants = {
        'flavor_vocab': list(A._FLAVOR_VOCAB),
        'priors': A._search_category_priors(),
        'abbrev_canon': [list(c) for _, c in A._FLAVOR_ABBREV_PATTERNS],
        'store_configs': A._STORE_CONFIGS,
        'subcategory_rules': {k: [[n, list(kw)] for n, kw in v] for k, v in A._SUBCATEGORY_RULES.items()},
        'bilka_rules': [[c, list(k)] for c, k in A._BILKA_CATEGORY_RULES],
        'blocked': sorted(A._BLOCKED_NAME_FRAGMENTS),
        'extra_nonfood': sorted(A._EXTRA_NON_FOOD_TERMS),
        'placeholders': sorted(A._PLACEHOLDER_IMGS),
        'staples': sorted(APP._STAPLES),
        'slug_map': APP._CATEGORY_SLUG_MAP,
        'public_paths': list(APP._PUBLIC_CATEGORY_PATHS),
        'per_page': APP._LISTING_PER_PAGE,
        'catalog_version': A.STORE_CATALOG_VERSION,
        'added_in': {str(k): v for k, v in A.STORES_ADDED_IN_VERSION.items()},
    }
    return {
        'meta': {'step': STEP, 'products': len(raws), 'displays': len(displays)},
        'constants': constants,
        'strings': strings,
        'products': raws,
        'per_product': per_product,
        'display_index': [i for i, _ in displays],
        'by_store': by_store,
        'apply_filters': apply_res,
        'search': search,
    }


def main():
    data = compute()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    print(f'{OUT}: {os.path.getsize(OUT) / 1e6:.2f} MB, {data["meta"]}')


if __name__ == '__main__':
    main()
