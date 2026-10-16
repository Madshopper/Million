"""Genererer paritets-fixtures for opskrifterne: app.py's opskrift-logik
(get_recipes, _fetch_recipe_detail, _parse_nutrition_number,
_alt_store_prices) og Jinja-renderingen af opskrifter.html/opskrift.html, kørt
mod faste, syntetiske Supabase-svar og rigtige produkter fra den lokale cache.
Supabase og D1 kaldes ikke - _supabase_rest og load_products_by_ids er
erstattet af opslag i de samme svar, som TS-testen (recipes.test.tsx) mocker.

Køres fra repo-roden:  python3 apps/web/test/parity/gen_recipe_fixtures.py
Skriver apps/web/test/parity/fixtures/recipes.json.
"""
import copy
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent / 'fixtures'
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

os.environ['NEXT_PUBLIC_SUPABASE_URL'] = 'https://example.supabase.co'
os.environ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] = "sb_publishable_<test>&'key'"

import flask  # noqa: E402
import app  # noqa: E402
import app_support  # noqa: E402

cache = json.loads((ROOT / 'data' / 'app_cache_local.json').read_text())
raw_products = cache['products']


def g(p, k, d=None):
    return p.get('/product/' + k, d)


def pick(pred, n=1, skip=()):
    out = []
    for p in raw_products:
        if g(p, 'id') in skip:
            continue
        try:
            if pred(p):
                out.append(p)
        except Exception:
            continue
        if len(out) >= n:
            break
    return out


chosen = []


def take(pred, n=1):
    got = pick(pred, n, skip={g(p, 'id') for p in chosen})
    chosen.extend(got)
    return got


sale = take(lambda p: g(p, 'sale_price') is not None and g(p, 'weight_g'), 2)
matched = take(lambda p: len(g(p, 'store_matches') or {}) >= 3 and g(p, 'weight_g'), 3)
rema = take(lambda p: (g(p, 'rema_price') or 0) > 0 and g(p, 'store') != 'Rema 1000', 1)
stk = take(lambda p: g(p, 'stk_count'), 1)
quote = take(lambda p: any(c in str(g(p, 'title', '')) for c in '&"\'<'), 1)
noimg = take(lambda p: not g(p, 'imageLink'), 1)
P = {g(p, 'id'): p for p in chosen}
ids = [g(p, 'id') for p in chosen]
print(f'{len(chosen)} produkter', file=sys.stderr)

# Næringsdata på de første nøgler for nogle af produkterne - forskellige
# formater, så _parse_nutrition_number's grene bliver afprøvet.
nutrition_payloads = [
    {'rows': [{'label': 'Energi', 'value': '1.542 KJ / 366 kcal'}, {'label': 'Fedt', 'value': '9,4 g'},
              {'label': '- heraf mættede fedtsyrer', 'value': '3 g'}, {'label': 'Kulhydrat', 'value': '< 0,5 g'},
              {'label': 'Protein', 'value': '12.5 g'}]},
    {'rows': [{'label': 'energi', 'value': '250 kcal'}, {'label': 'Protein', 'value': '~3,25 g'},
              {'label': 'Kulhydrater', 'value': '≤ 1 g'}, {'label': 'Fedt', 'value': 'spor'}]},
    {'rows': [{'label': 'Energi', 'value': '900 kJ'}, {'label': 'Salt', 'value': '1 g'}]},  # intet brugbart
    {'rows': []},
]
nutrition_rows = []
for i, p in enumerate([sale[0], matched[0], matched[1], stk[0]]):
    keys = app_support.nutrition_candidate_keys(p)
    if keys:
        nutrition_rows.append({'key': keys[0], 'payload': nutrition_payloads[i]})


def ing(iid, pos, raw, qty, unit, name, pid=None, cands=(), conf=None):
    return {'id': iid, 'position': pos, 'raw_text': raw, 'quantity': qty, 'unit': unit, 'ingredient_name': name,
            'matched_product_id': pid, 'match_confidence': conf, 'candidate_product_ids': list(cands)}


I = ids
scenarios = {
    'full': {
        'recipe': {'id': 101, 'title': 'Pasta & "kødsovs" <hurtig>', 'image_url': 'https://img.example/p.jpg',
                   'servings': None, 'total_time_minutes': 30, 'instructions': ['Kog <pasta>.', 'Steg & rør.', 'Server'],
                   'source_name': 'Arla', 'source_url': 'https://www.arla.dk/opskrifter/x/', 'nutrition_source': None},
        'ingredients': [
            ing(1, 0, '500 g hakket oksekød', 500.0, 'g', 'hakket oksekød', I[0], [I[0], I[2], 'findes-ikke'], 0.91),
            ing(2, 1, '2 dl fløde', 2.0, 'dl', 'fløde', I[2], [I[3], I[4]], 0.8),
            ing(3, 2, '2 æg', 2.0, '', 'æg', I[6] if len(I) > 6 else I[1], [], 0.7),
            ing(4, 3, 'salt og peber', None, '', 'salt', None, [I[1]]),
            ing(5, 4, '1 kg tomater', 1.0, 'kg', 'tomater', I[1], [I[1], I[5]], 1.0),
            ing(6, 5, '0,5 l mælk', 0.5, 'l', 'mælk', I[3], [], 0.5),
            ing(7, 6, '3 spsk olie', 3.0, 'spsk', 'olie', I[7] if len(I) > 7 else I[4], []),
            ing(8, 7, 'en vare uden match', 2.0, 'g', 'x', 'findes-ikke', ['findes-heller-ikke']),
        ],
        'snapshot': {'recipe_id': 101, 'computed_at': '2026-10-06T18:14:15+00:00', 'cheapest_total_price': 87.125,
                     'matched_ingredient_count': 6, 'total_ingredient_count': 8, 'ingredients_on_sale_count': 2,
                     'cheapest_store_breakdown': {I[0]: {'price': 12.0, 'store': 'Netto'}}},
    },
    'source_nutrition': {
        'recipe': {'id': 102, 'title': 'Grød', 'image_url': '', 'servings': 2, 'total_time_minutes': None,
                   'instructions': [], 'source_name': '', 'source_url': 'https://kilde.example/grod',
                   'nutrition_source': {'calories': '138 kcal', 'protein': '13,3 g', 'fat': '', 'carbohydrate': '4,1 g',
                                        'serving_size': '100 g'}},
        'ingredients': [ing(9, 0, '1 dl havregryn', 1.0, 'dl', 'havregryn', I[4], [I[4]])],
        'snapshot': None,
    },
    'name_only': {
        'recipe': {'id': 103, 'title': "Mormors 'bedste'", 'image_url': 'https://img.example/m.jpg', 'servings': 6,
                   'total_time_minutes': 0, 'instructions': [], 'source_name': 'Mormor', 'source_url': None,
                   'nutrition_source': {'calories': '200 kcal'}},
        'ingredients': [],
        'snapshot': {'recipe_id': 103, 'cheapest_total_price': None, 'matched_ingredient_count': 0,
                     'total_ingredient_count': 0, 'ingredients_on_sale_count': 0},
    },
    'no_source': {
        'recipe': {'id': 104, 'title': 'Uden kilde', 'image_url': 'https://img.example/u.jpg', 'servings': 4,
                   'total_time_minutes': 15, 'instructions': ['Bland'], 'source_name': '', 'source_url': '',
                   'nutrition_source': None},
        'ingredients': [ing(10, 0, '100 g ost', 100.0, 'g', 'ost', I[5], [I[5]])],
        'snapshot': {'recipe_id': 104, 'cheapest_total_price': 0, 'matched_ingredient_count': 1,
                     'total_ingredient_count': 1, 'ingredients_on_sale_count': 1},
    },
    'not_found': {'recipe': None, 'ingredients': [], 'snapshot': None},
    'ingredients_error': {
        'recipe': {'id': 106, 'title': 'Fejl i ingredienser', 'image_url': '', 'servings': 3, 'total_time_minutes': 5,
                   'instructions': [], 'source_name': 'X', 'source_url': 'https://x.example/', 'nutrition_source': None},
        'ingredients': 'ERROR',
        'snapshot': 'ERROR',
    },
}


def responses_for(sc):
    """Supabase-svar pr. sti: (data, status)."""
    r = sc['recipe']
    ings = sc['ingredients']
    snap = sc['snapshot']
    return {
        'recipes': ([r] if r else [], 200),
        'recipe_ingredients': (None, 500) if ings == 'ERROR' else (ings, 200),
        'recipe_price_snapshot': (None, 0) if snap == 'ERROR' else ([snap] if snap else [], 200),
        'nutrition_data': (nutrition_rows, 200),
    }


def run_detail(responses, recipe_id):
    calls = []

    def fake_rest(method, path, params=None, **kw):
        calls.append({'method': method, 'path': path, 'params': params})
        data, status = responses[path]
        if path == 'nutrition_data' and status == 200:
            keys = params['key'][len('in.('):-1].split(',')
            data = [row for row in data if row['key'] in keys]
        return copy.deepcopy(data), status

    def fake_load(id_list):
        want = {str(i) for i in id_list}
        return [copy.deepcopy(p) for p in chosen if str(g(p, 'id')) in want]

    orig = (app._supabase_rest, app.load_products_by_ids)
    app._supabase_rest, app.load_products_by_ids = fake_rest, fake_load
    try:
        recipe, ingredients, snapshot = app._fetch_recipe_detail(recipe_id)
    finally:
        app._supabase_rest, app.load_products_by_ids = orig
    return {'recipe': recipe, 'ingredients': ingredients, 'snapshot': snapshot}, calls


details = []
pages = []
for name, sc in scenarios.items():
    rid = sc['recipe']['id'] if sc['recipe'] else 105
    responses = responses_for(sc)
    out, calls = run_detail(responses, rid)
    details.append({'name': name, 'recipe_id': rid, 'responses': responses, 'expected': out,
                    'paths': [c['path'] for c in calls]})
    with app.app.test_request_context(f'/opskrift/{rid}'):
        app._recipes_enabled = lambda: True
        app._feature_enabled = lambda key, *a, **kw: True
        site = app._inject_site_meta()
        html = flask.render_template('opskrift.html', **out)
        pages.append({'name': f'opskrift_{name}', 'template': 'opskrift.html', 'path': flask.request.path,
                      'endpoint': 'get_recipe_page', 'view_args': {'recipe_id': str(rid)},
                      'context': out, 'site_context': site, 'html': html})

with app.app.test_request_context('/opskrifter'):
    site = app._inject_site_meta()
    pages.append({'name': 'opskrifter', 'template': 'opskrifter.html', 'path': '/opskrifter',
                  'endpoint': 'recipes_page', 'view_args': {}, 'context': {}, 'site_context': site,
                  'html': flask.render_template('opskrifter.html')})

# --- get_recipes (listen) -------------------------------------------------------
list_rows = [{'id': i, 'title': f'Opskrift {i}', 'image_url': '', 'servings': 4, 'total_time_minutes': None,
              'source_name': '', 'source_url': None} for i in range(1, 9)]
list_snaps = [
    {'recipe_id': 1, 'cheapest_total_price': 50.5, 'matched_ingredient_count': 3, 'total_ingredient_count': 3,
     'ingredients_on_sale_count': 1},
    {'recipe_id': 2, 'cheapest_total_price': 10.0, 'matched_ingredient_count': 2, 'total_ingredient_count': 3,
     'ingredients_on_sale_count': 2},
    {'recipe_id': 3, 'cheapest_total_price': None, 'matched_ingredient_count': None, 'total_ingredient_count': 0,
     'ingredients_on_sale_count': 0},
    {'recipe_id': 4, 'cheapest_total_price': 7, 'matched_ingredient_count': 1, 'total_ingredient_count': 7,
     'ingredients_on_sale_count': 1},
    {'recipe_id': 5, 'cheapest_total_price': 9.99, 'matched_ingredient_count': 3, 'total_ingredient_count': 3,
     'ingredients_on_sale_count': 1},
    {'recipe_id': 7, 'cheapest_total_price': 1.0, 'matched_ingredient_count': 6, 'total_ingredient_count': 6,
     'ingredients_on_sale_count': 6},
    {'recipe_id': 8, 'cheapest_total_price': 3.3, 'total_ingredient_count': 9, 'ingredients_on_sale_count': None},
]
lists = []
for name, rows, snaps in [('normal', (list_rows, 200), (list_snaps, 200)), ('snap_error', (list_rows, 200), (None, 500)),
                          ('rows_error', (None, 0), (list_snaps, 200)), ('empty', ([], 200), ([], 200))]:
    responses = {'recipes': rows, 'recipe_price_snapshot': snaps}
    orig = (app._supabase_rest, app._recipes_enabled, app._supabase_available)
    app._supabase_rest = lambda method, path, params=None, **kw: copy.deepcopy(responses[path])
    app._recipes_enabled = lambda: True
    app._supabase_available = lambda: True
    try:
        with app.app.test_request_context('/api/recipes'):
            resp = app.app.make_response(app.get_recipes())
            lists.append({'name': name, 'responses': responses, 'status': resp.status_code,
                          'expected': json.loads(resp.get_data(as_text=True))})
    finally:
        app._supabase_rest, app._recipes_enabled, app._supabase_available = orig

# --- Rene hjælpere ------------------------------------------------------------------
nutrition_numbers = [[v, pk, app._parse_nutrition_number(v, prefer_kcal=pk)] for v, pk in [
    ('9,4 g', False), ('< 0,5 g', False), ('1.542 KJ / 366 kcal', True), ('1.542 KJ / 366 kcal', False),
    ('1.542,5 kJ', False), ('9.4', False), ('~3,25 g', False), ('≤ 1 g', False), ('spor', False), ('', False),
    ('366 KCAL/1532 kJ', True), ('kcal', True), ('12', False), ('0,0 g', False), ('1/2 kcal', True),
]]
store_price_cases = [[p, app._alt_store_prices(p)] for p in chosen] + [[p, app._alt_store_prices(p)] for p in [
    {'/product/store': 'Netto', '/product/price': '12,5', '/product/rema_price': 9.0},
    {'/product/store': None, '/product/price': 5.0, '/product/sale_price': 0},
    {'/product/price': 0, '/product/store_matches': {'bilka': {'price': None, 'normal_price': 7.5}, 'ukendt': {'price': 3.0}}},
    {'/product/store': 'Rema 1000', '/product/price': 4.0, '/product/rema_price': 6.0},
]]

OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'recipes.json').write_text(json.dumps({
    'products': chosen, 'details': details, 'pages': pages, 'lists': lists,
    'nutrition_numbers': nutrition_numbers, 'store_prices': store_price_cases,
}, ensure_ascii=False, indent=1))
print(f'{len(details)} detaljer, {len(pages)} sider, {len(lists)} lister -> {OUT / "recipes.json"}', file=sys.stderr)
