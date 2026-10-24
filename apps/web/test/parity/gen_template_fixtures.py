"""Genererer paritets-fixtures: Flask/Jinja-renderinger af templates/ med faste
kontekster, så TSX-porten kan sammenlignes med den rigtige HTML.

Køres fra repo-roden:  python3 apps/web/test/parity/gen_template_fixtures.py
Skriver apps/web/test/parity/fixtures/templates.json og static-hashes.json.
"""
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent / 'fixtures'
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

# Faste offentlige værdier, så tojson-stierne i base.html bliver afprøvet.
os.environ['NEXT_PUBLIC_SUPABASE_URL'] = 'https://example.supabase.co'
os.environ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] = "sb_publishable_<test>&'key'"

import flask  # noqa: E402
import app  # noqa: E402
import app_support  # noqa: E402

# --- Deterministisk udvalg af rigtige produkter -------------------------------

cache = json.loads((ROOT / 'data' / 'app_cache_local.json').read_text())
raw_products = cache['products']


def pick(pred, n=1, start=0):
    out = []
    for p in raw_products[start:]:
        try:
            if pred(p):
                out.append(p)
        except Exception:
            continue
        if len(out) >= n:
            break
    return out


def g(p, k, d=None):
    return p.get('/product/' + k, d)


def store_is(s):
    return lambda p: str(g(p, 'store', '')).lower() == s


selected = []
selected += pick(lambda p: g(p, 'sale_price') is not None and float(g(p, 'sale_price')) < float(g(p, 'price')), 6)
selected += pick(lambda p: len(g(p, 'store_matches') or {}) >= 3, 3)
selected += pick(lambda p: g(p, 'multi_deal'), 2)
selected += pick(lambda p: g(p, 'lowest_price_30d') is not None and g(p, 'sale_price') is None, 1)
selected += pick(lambda p: not g(p, 'imageLink'), 1)
selected += pick(lambda p: g(p, 'stk_count'), 1)
selected += pick(lambda p: g(p, 'price_per_kg') is None, 1)
selected += pick(lambda p: isinstance(g(p, 'rema_price'), float) and g(p, 'rema_price') == int(g(p, 'rema_price')), 1)
selected += pick(lambda p: isinstance(g(p, 'rema_price'), float) and g(p, 'rema_price') != int(g(p, 'rema_price')), 1)
selected += pick(lambda p: type(g(p, 'rema_price')) is int and g(p, 'rema_price') == 0, 1)
selected += pick(lambda p: g(p, 'is_any_sale') is True and g(p, 'sale_price') is None, 1)
selected += pick(lambda p: re.search(r'[&<>"\']', str(g(p, 'title', '')) + str(g(p, 'description', ''))), 2)
selected += pick(lambda p: re.search(r'øko', str(g(p, 'title', '')).lower()), 1)
selected += pick(lambda p: (g(p, 'sale_price_effective_date') or ''), 1)
for st in ['rema 1000', 'bilka', 'netto', 'føtex', 'min købmand', 'meny', 'superbrugsen', 'brugsen',
           'kvickly', 'lidl', 'løvbjerg', 'abc lavpris', '365 discount', 'spar']:
    selected += pick(store_is(st), 1)

seen = set()
uniq = []
for p in selected:
    pid = g(p, 'id')
    if pid in seen:
        continue
    seen.add(pid)
    uniq.append(p)

display = [app_support.product_to_display_dict(p) for p in uniq]
# Kunstige kanttilfælde (tie-afrunding, tom butik, None-felter)
edge = dict(display[0])
edge.update({'id': 'edge1', 'name': 'Kant <test> & "citat"', 'price': 10.125, 'sale_price': 2.375, 'is_sale': True,
             'store': '', 'price_per_kg': 0.125, 'store_matches': {}, 'rema_price': None, 'weight_g': 1000.0,
             'stk_count': 6, 'multi_deal': '', 'cheapest_at': None, 'brand': '', 'description': ''})
display.append(edge)
json.dumps(display)  # skal være JSON-sikker

sale_items = [d for d in display if d.get('is_sale')]
print(f'{len(display)} produkter, {len(sale_items)} på tilbud', file=sys.stderr)

recipes = [
    {'id': 'a1b2c3', 'title': 'Pasta & "kødsovs"', 'image_url': 'https://img.example/p.jpg', 'total_points': 3.5,
     'click_count': 2, 'cheapest_total_price': 87.5, 'matched_ingredient_count': 5, 'total_ingredient_count': 7,
     'sale_ratio': 0.286},
    {'id': 42, 'title': 'Grød', 'image_url': '', 'total_points': 0, 'click_count': 0,
     'cheapest_total_price': None, 'matched_ingredient_count': 0, 'total_ingredient_count': 0, 'sale_ratio': 0.0},
    {'id': 'x9', 'title': 'Laks <ovn>', 'image_url': 'https://img.example/l.jpg', 'total_points': 1,
     'click_count': 1, 'cheapest_total_price': 120.125, 'matched_ingredient_count': 3, 'total_ingredient_count': 3,
     'sale_ratio': 1.0},
]

# --- Feature-flag-patching -------------------------------------------------------

_orig = {k: getattr(app, k) for k in ('_feature_enabled', '_recipes_enabled', '_is_data_degraded')}


def set_flags(on=False, degraded=False):
    for k, v in _orig.items():
        setattr(app, k, v)
    if on:
        app._feature_enabled = lambda key, *a, **kw: True
        app._recipes_enabled = lambda *a, **kw: True
    if degraded:
        app._is_data_degraded = lambda *a, **kw: 'test'


cases = []


def render(name, template, path, ctx, flags=False, degraded=False):
    set_flags(flags, degraded)
    with app.app.test_request_context(path):
        req = flask.request
        site = app._inject_site_meta()
        html = flask.render_template(template, **ctx)
        cases.append({
            'name': name,
            'template': template,
            'path': req.path,
            'query': req.query_string.decode(),
            'endpoint': req.endpoint,
            'view_args': req.view_args or {},
            'context': ctx,
            'site_context': site,
            'html': html,
        })
    set_flags()


home_ctx = {
    'categories': {'Ugens Tilbud': sale_items[:12], 'Populære varer': display[:14], 'Skjult': display[:2]},
    'template_mapping': {'Ugens Tilbud': '/ugens_tilbud', 'Populære varer': None},
    'recipes': recipes,
    'recipes_clickable': False,
}
render('index', 'index.html', '/', home_ctx)
render('index_flags', 'index.html', '/?sort=price-asc', dict(home_ctx, recipes_clickable=True), flags=True)
render('index_error', 'index.html', '/', {'categories': {}, 'template_mapping': {}, 'recipes': []})
render('index_products', 'partials/index_products.html', '/', home_ctx)
render('index_products_clickable', 'partials/index_products.html', '/', dict(home_ctx, recipes_clickable=True))

subs = ['Pasta', 'Ris & korn', 'Konserves']
render('category_p2', 'category.html', '/Kolonial?sort=price-asc&page=2&stores=Bilka,Netto&_travlt=1&q=a+b%26c',
       {'category_name': 'Kolonial', 'products': display[:8], 'current_page': 2, 'total_pages': 5,
        'available_subcategories': subs, 'current_subcategory': 'Ris & korn'})
render('category_p7of12', 'category.html', '/Frost?page=7&sub=Is',
       {'category_name': 'Frost', 'products': display[8:16], 'current_page': 7, 'total_pages': 12,
        'available_subcategories': subs, 'current_subcategory': None})
render('category_p1of9', 'category.html', '/Slik',
       {'category_name': 'Slik', 'products': display[:3], 'current_page': 1, 'total_pages': 9,
        'available_subcategories': [], 'current_subcategory': None})
render('category_last', 'category.html', '/Drikkevarer?page=9',
       {'category_name': 'Drikkevarer', 'products': display[:3], 'current_page': 9, 'total_pages': 9,
        'available_subcategories': subs, 'current_subcategory': None})
render('category_empty_degraded', 'category.html', '/Mejeri?sale=1',
       {'category_name': 'Køl & Mejeri', 'products': [], 'current_page': 1, 'total_pages': 1,
        'available_subcategories': subs, 'current_subcategory': ''}, flags=True, degraded=True)
render('ugens_tilbud', 'category.html', '/ugens_tilbud?page=3',
       {'category_name': 'Ugens Tilbud', 'products': sale_items[:6], 'current_page': 3, 'total_pages': 3,
        'available_subcategories': [], 'current_subcategory': None})

render('grid_search_endpoint', 'partials/product_grid.html', '/search?q=m%C3%A6lk&page=2',
       {'products': display[:5], 'current_page': 2, 'total_pages': 4, 'pagination_endpoint': 'search_page'})
render('grid_category', 'partials/product_grid.html', '/Frost?page=1&_travlt=2',
       {'products': display[5:10], 'current_page': 1, 'total_pages': 9})
render('grid_empty', 'partials/product_grid.html', '/ugens_tilbud',
       {'products': [], 'current_page': 1, 'total_pages': 1})
render('grid_empty_degraded', 'partials/product_grid.html', '/ugens_tilbud',
       {'products': [], 'current_page': 1, 'total_pages': 1}, degraded=True)

q = 'mælk "øko" <b>'
render('search_results', 'search_results.html', '/search/results?q=m%C3%A6lk+%22%C3%B8ko%22+%3Cb%3E&page=2',
       {'query': q, 'products': display[:10], 'total_products': 120, 'current_page': 2, 'total_pages': 3})
render('search_zero', 'search_results.html', '/search/results?q=xyzzy',
       {'query': 'xyzzy', 'products': [], 'total_products': 0, 'current_page': 1, 'total_pages': 1})
render('search_error', 'search_results.html', '/search/results?q=ost',
       {'query': 'ost', 'products': [], 'total_products': 0, 'current_page': 1, 'total_pages': 1,
        'error': 'For mange forespørgsler. Prøv igen om lidt.'})

render('about', 'about.html', '/about', {})
render('about_flags', 'about.html', '/om-os', {}, flags=True)
render('terms', 'terms.html', '/terms-of-service', {})
render('privacy', 'privacy.html', '/privatliv', {})
render('feedback', 'feedback.html', '/feedback', {})
render('not_found', 'not_found.html', '/this-page-does-not-exist', {})

# --- Static-hashes som Flask brugte dem (url_for('static', ...)) ---------------
hashes = {}
with app.app.test_request_context('/'):
    static_dir = ROOT / 'static'
    for f in sorted(static_dir.rglob('*')):
        if not f.is_file():
            continue
        rel = f.relative_to(static_dir).as_posix()
        m = re.search(r'[?&]v=([^&]+)', flask.url_for('static', filename=rel))
        if m:
            hashes[rel] = m.group(1)

OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'templates.json').write_text(json.dumps(cases, ensure_ascii=False, indent=1))
(OUT / 'static-hashes.json').write_text(json.dumps(hashes, indent=1, sort_keys=True))
print(f'{len(cases)} fixtures, {len(hashes)} static-hashes -> {OUT}', file=sys.stderr)
