"""Offline-tilstand: kør hele sitet uden ét eneste kald ud af maskinen.

Slås til med MADSHOPPER_OFFLINE=1 (se scripts/offline.sh og docs/offline.md).
Bruges kun lokalt - modulet importeres aldrig på edge, og build-pages.sh
kopierer det ikke med.

Erstatter:
- produkt-cachen (Supabase app_cache / KV)  -> mockdata.products
- alle Supabase REST/RPC-kald               -> supabase_rest() herunder (i hukommelsen)
- produktbilleder fra butikkernes CDN'er    -> SVG-pladsholdere på /__mock/img/
- browserens Supabase-login/Turnstile        -> slået fra (tom URL/nøgle)
"""
from __future__ import annotations

import hashlib
import html
import logging
import os
import threading

logger = logging.getLogger(__name__)

ENABLED = os.environ.get('MADSHOPPER_OFFLINE') == '1'

_lock = threading.Lock()
# Alt der "skrives" (kurv-tælling, feedback, søgninger ...), så en demo eller en
# test kan se at kaldet skete: GET /__mock/writes.
WRITES: list[dict] = []

_products: list[dict] | None = None


def products() -> list[dict]:
    global _products
    if _products is None:
        from mockdata.products import build_products
        _products = build_products()
    return _products


def product_by_id(pid: str) -> dict | None:
    return next((p for p in products() if str(p.get('/product/id')) == str(pid)), None)


def cache_payload() -> tuple[list, dict]:
    """(products, search_index) i samme form som updater.py skriver til app_cache."""
    from app_support import build_search_index, normalize_name
    prods = products()
    idx = {k: sorted(v) for k, v in build_search_index(prods, normalize_name).items()}
    return prods, idx


def _eq(params: dict | None, key: str) -> str | None:
    v = (params or {}).get(key)
    if isinstance(v, str) and v.startswith('eq.'):
        return v[3:]
    return None


def supabase_rest(method: str, path: str, params: dict | None = None, json_body=None) -> tuple:
    """Svarer som PostgREST: (data, status). Ukendte tabeller giver en tom liste."""
    table = path.split('?', 1)[0]
    if method != 'GET':
        with _lock:
            WRITES.append({'method': method, 'path': table, 'body': json_body})
            del WRITES[:-500]
    if table.startswith('rpc/'):
        rpc = table[4:]
        if rpc.startswith('is_admin'):
            return os.environ.get('MOCK_ADMIN') == '1', 200
        if rpc.startswith('has_recipe_access'):
            return True, 200
        return None, 204
    if method != 'GET':
        return None, 201
    base = table.removesuffix('_dev')
    if base == 'price_history':
        p = product_by_id(_eq(params, 'product_id') or '')
        if not p:
            return [], 200
        from mockdata.products import price_history_rows
        return price_history_rows(p), 200
    if base == 'cart_popularity':
        return [{'product_id': p['/product/id'], 'count': 10 - i}
                for i, p in enumerate(products()[:8])], 200
    return [], 200


def placeholder_svg(pid: str) -> str:
    """Farvet flise med varens navn - erstatter butikkens produktfoto."""
    from mockdata.products import CATEGORY_COLORS
    p = product_by_id(pid) or {}
    title = str(p.get('/product/title') or pid)
    color = CATEGORY_COLORS.get(p.get('/product/product_type'), '#eeeeee')
    words, lines, line = title.split(), [], ''
    for w in words:
        if len(line) + len(w) > 12 and line:
            lines.append(line)
            line = w
        else:
            line = f'{line} {w}'.strip()
    lines.append(line)
    tspans = ''.join(
        f'<tspan x="100" dy="{0 if i == 0 else 24}">{html.escape(t)}</tspan>'
        for i, t in enumerate(lines[:4]))
    start_y = 100 - 12 * (min(len(lines), 4) - 1)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">'
        f'<rect width="200" height="200" rx="16" fill="{color}"/>'
        f'<text x="100" y="{start_y}" font-family="sans-serif" font-size="20" '
        f'text-anchor="middle" dominant-baseline="middle" fill="#333">{tspans}</text>'
        '</svg>'
    )


def install(app) -> None:
    """Tilføj mock-ruterne og fjern browserens Supabase-opsætning."""
    from flask import Response, jsonify

    # Browserens supabase-js/auth.js starter ikke uden URL+nøgle, så login,
    # Google/Apple-scripts og Turnstile hentes aldrig.
    for var in ('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_KEY',
                'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'DEPLOY_KEY', 'SERVER_RPC_KEY',
                'CF_ANALYTICS_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'):
        os.environ[var] = ''

    @app.route('/__mock/img/<pid>.svg')
    def _mock_img(pid):
        svg = placeholder_svg(pid)
        etag = hashlib.md5(svg.encode()).hexdigest()
        return Response(svg, mimetype='image/svg+xml', headers={'ETag': etag})

    @app.route('/__mock/writes')
    def _mock_writes():
        with _lock:
            return jsonify(writes=list(WRITES))

    logger.warning('OFFLINE-tilstand: mock-data (%d varer), ingen kald ud af maskinen',
                   len(products()))
