"""Forudberegn opskrift-priser og tilbudsdækning (recipe_price_snapshot).

Ren prisberegning over allerede matchede ingredienser
(recipe_ingredients.matched_product_id) - ingen AI/Ollama involveret, så det
kunne køre lige efter updater.py i .github/workflows/cache-updater.yml.

Siden Feature-fanen i /admin (03-10-2026) kører den i recipe-import.yml kl. 04
UTC, efter nattens app_cache er bygget: kun dér har kørslen Cloudflare-nøglen
til at se om opskrifterne er udgivet (scripts/feature_flags.py). Trinnet i
cache-updater.yml springer derfor altid over, og at fjerne det ville udløse en
ekstra D1-reseed ved merge (cache-updater.yml er i dens push-filter).

Læses ved sidevisning som et opslag (app.py /api/recipes) frem for en live
join mod aktuelle priser pr. request - samme grund som home_data_v1 (KV): tung
per-request-beregning på edge var årsagen til nedbruddet 2026-07-19, se
CLAUDE.md § Miljøer & deploy.
"""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

from app_support import configure_logging, logger
from recipe_matching import (
    _CANDIDATE_TOP_K, _MATCH_CONFIDENT, _score_candidates, load_current_products,
)


def _get_supabase_client():
    """Samme env-fallback-mønster som updater.py's _get_supabase_client."""
    url = os.getenv('SUPABASE_URL') or os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    key = (
        os.getenv('DEPLOY_KEY')
        or os.getenv('SUPABASE_KEY')
        or os.getenv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    )
    if not url or not key:
        return None
    try:
        return create_client(url, key)
    except Exception:
        return None


def _product_price_points(product: dict) -> list[dict]:
    """Alle nuværende (butik, pris, is_sale)-punkter for ét produkt-kort:
    forsidens egen butik + alle store_matches - samme effektiv-pris-logik som
    updater.py._display_item_to_match (sale_price hvis is_sale, ellers price)."""
    points = []
    sale = product.get('/product/sale_price')
    is_sale = sale is not None
    try:
        price = float(sale) if is_sale else float(product.get('/product/price', 0) or 0)
    except (TypeError, ValueError):
        price = 0.0
    if price > 0:
        points.append({
            'store': product.get('/product/store', ''),
            'price': price,
            'is_sale': bool(is_sale),
        })

    for store_name, match in (product.get('/product/store_matches') or {}).items():
        if not isinstance(match, dict):
            continue
        try:
            m_price = float(match.get('price') or 0)
        except (TypeError, ValueError):
            m_price = 0.0
        if m_price > 0:
            points.append({
                'store': store_name,
                'price': m_price,
                'is_sale': bool(match.get('is_sale')),
            })
    return points


# Under så mange varer er app_cache halv eller tom (fejlet hentning, swap midt
# i en læsning). Normalt ~20.000. Hellere ingen nye priser end at skrive
# "0 af 12 varer fundet" over alle opskrifter.
_MIN_PRODUCTS = 5000


def _refresh_ingredient_match(ing: dict, product_by_id: dict, products: list[dict]) -> dict | None:
    """Ret en ingrediens hvis produkt-id'erne er forsvundet fra cachen.

    Produkt-id'erne er ikke faste: et kort får nyt id når nattens matching
    samler det anderledes (målt 06-10-2026: 16 af 112 matchede ingredienser
    pegede på et id der ikke fandtes mere). Uden ret faldt ingrediensen
    stille ud af prisen, så opskriften så billigere ud end den er.

    Kun ingredienser med et forsvundet id matches igen (ét scan af cachen),
    og kun et sikkert match (_MATCH_CONFIDENT) erstatter det gamle -
    et svagt navnematch ville lægge en forkert vare ind i prisen (fx "frisk
    spinat" -> vin). Ellers står ingrediensen som ikke fundet, ligesom
    opskriftsiden allerede viser den. Returnerer felterne der skal skrives,
    eller None når intet er ændret."""
    pid = ing.get('matched_product_id')
    candidates = ing.get('candidate_product_ids') or []
    match_gone = bool(pid) and pid not in product_by_id
    candidates_gone = any(c not in product_by_id for c in candidates)
    if not match_gone and not candidates_gone:
        return None

    scored = _score_candidates(ing.get('ingredient_name') or ing.get('raw_text') or '', products)
    update = {'candidate_product_ids': [str(p.get('/product/id', '')) for _, p in scored[:_CANDIDATE_TOP_K]]}
    if match_gone:
        if scored and scored[0][0] >= _MATCH_CONFIDENT:
            best_score, best = scored[0]
            update.update({
                'matched_product_id': str(best.get('/product/id', '')),
                'match_confidence': round(best_score, 3),
                'match_method': 'exact' if best_score >= 0.97 else 'fuzzy',
            })
        else:
            update.update({'matched_product_id': None, 'match_confidence': None,
                           'match_method': 'unmatched'})
    if update.get('candidate_product_ids') == candidates and not match_gone:
        return None
    return update


def compute_recipe_price_snapshots(dry_run: bool = False) -> bool:
    """Genberegn recipe_price_snapshot for alle godkendte opskrifter.

    dry_run: beregn og vis, men skriv intet (kan køres med den offentlige
    nøgle). Returnerer False ved fejl, så kørslen bliver rød i stedet for
    at stå grøn uden nye priser."""
    client = _get_supabase_client()
    if client is None:
        logger.error('Supabase-forbindelse mangler - kan ikke beregne opskrift-priser')
        return False

    products = load_current_products(client)
    if len(products) < _MIN_PRODUCTS:
        logger.error(f'Kun {len(products)} varer i app_cache - skriver ingen opskrift-priser i nat')
        return False
    product_by_id = {}
    for p in products:
        pid = str(p.get('/product/id', '')).strip()
        if pid:
            product_by_id[pid] = p

    recipes = (
        client.table('recipes').select('id,title').eq('status', 'approved').execute()
    ).data or []
    if not recipes:
        logger.info('Ingen godkendte opskrifter at prisberegne')
        return True

    computed = 0
    repaired = 0
    for recipe in recipes:
        recipe_id = recipe['id']
        ingredients = (
            client.table('recipe_ingredients')
            .select('id,raw_text,ingredient_name,matched_product_id,candidate_product_ids')
            .eq('recipe_id', recipe_id)
            .execute()
        ).data or []
        total_count = len(ingredients)
        if total_count == 0:
            continue

        matched_count = 0
        on_sale_count = 0
        cheapest_total = 0.0
        breakdown = {}

        for ing in ingredients:
            update = _refresh_ingredient_match(ing, product_by_id, products)
            if update:
                if 'matched_product_id' in update:
                    repaired += 1
                    logger.info(
                        f"Opskrift #{recipe_id}: '{ing.get('ingredient_name')}' "
                        f"{ing.get('matched_product_id')} -> {update['matched_product_id']}"
                    )
                ing.update(update)
                if not dry_run:
                    client.table('recipe_ingredients').update(update).eq('id', ing['id']).execute()

            pid = ing.get('matched_product_id')
            product = product_by_id.get(pid) if pid else None
            if not product:
                continue
            points = _product_price_points(product)
            if not points:
                continue
            matched_count += 1
            cheapest = min(points, key=lambda pt: pt['price'])
            cheapest_total += cheapest['price']
            if any(pt['is_sale'] for pt in points):
                on_sale_count += 1
            breakdown[pid] = {'store': cheapest['store'], 'price': cheapest['price']}

        row = {
            'recipe_id': recipe_id,
            'computed_at': 'now()',
            'cheapest_total_price': round(cheapest_total, 2) if matched_count else None,
            'matched_ingredient_count': matched_count,
            'total_ingredient_count': total_count,
            'ingredients_on_sale_count': on_sale_count,
            'cheapest_store_breakdown': breakdown,
        }
        if dry_run:
            print(f"#{recipe_id} {recipe.get('title')}: {row['cheapest_total_price']} kr, "
                  f"{matched_count}/{total_count} varer, {on_sale_count} på tilbud")
        else:
            client.table('recipe_price_snapshot').upsert(row).execute()
        computed += 1

    logger.info(f'Prisberegnet {computed}/{len(recipes)} godkendte opskrifter, '
                f'{repaired} ingredienser matchet igen'
                + (' (prøvekørsel, intet skrevet)' if dry_run else ''))
    return True


if __name__ == '__main__':
    # Kører kun når opskrifterne er udgivet fra Feature-fanen i /admin
    # (scripts/feature_flags.py), så priserne starter sammen med funktionen.
    # RECIPES_ENABLED=1 kører den alligevel (lokalt/test og manuel start af
    # recipe-import.yml). --dry-run skriver intet og kører altid.
    configure_logging()  # ellers forsvinder logger.info i kørslens log
    dry_run = '--dry-run' in sys.argv
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scripts'))
    from feature_flags import feature_live
    if dry_run or os.environ.get('RECIPES_ENABLED') == '1' or feature_live('recipes'):
        sys.exit(0 if compute_recipe_price_snapshots(dry_run=dry_run) else 1)
    else:
        print('Opskrifterne er ikke udgivet - springer opskrift-priser over')
