"""Opskrift-import og -moderation (docs/Features.md "Opskrift-import og
-matching system").

Ingen AI/Ollama nogen steder i dette modul (se [[features-skal-vaere-lovlige]]
- bevidst fravalg, ikke en midlertidig begrænsning).

Tre indgange, kørt lokalt af udvikleren (ligesom updater.py/scrapers - intet
her kaldes fra en live edge-request):

  import_recipe_from_url(url)
      Admin-import: hent side -> schema.org Recipe JSON-LD -> match
      ingredienser mod app_cache (recipe_matching.py) -> gem som
      status='approved' (den der kører scriptet har allerede kurateret
      url'en). Kun JSON-LD-stien - ingen AI-fallback hvis siden mangler
      struktureret data, se extract_jsonld_recipe.

      Fremgangsmåde-teksten fra kilden gemmes BEVIDST ALDRIG: den er typisk
      et ophavsretligt beskyttet litterært værk (i modsætning til
      ingredienslisten, mængder, tid og portioner, som er fakta og ikke
      beskyttede), og vi har ingen tilladelse fra kilderne til at
      genpublicere den. Siden viser i stedet et link til kilden
      ("Opskrift fra ...", se templates/opskrift.html), så brugeren læser
      selve fremgangsmåden dér.

  moderate_pending_recipes()
      Bruger-indsendte opskrifter (submit_recipe-RPC, se
      scripts/supabase-recipes.sql) lander altid som 'pending'. Dette
      gennemløb genmatcher blot ingredienserne mod den aktuelle
      produkt-cache (kan med fordel køres igen efter et cache-updater-run)
      - der er ingen automatisk godkendelse. En opskrift forbliver
      'pending' til en administrator manuelt sætter status='approved' i
      Supabase. Det er en strengere fail-safe end nødvendigt for selve
      matchingen, men bevidst: en useriøs/spam-opskrift der vises offentligt
      er en anden slags fejl end blot et dårligt ingrediens-match.

  import_own_recipes()
      MadShoppers egne opskrifter fra data/egne_opskrifter.json, skrevet fra
      bunden ud fra almindelige retter. Den lovlige vej til flere
      opskrifter: teksten er vores, så fremgangsmåden vises på siden, og
      der er ingen billeder fra andre (siden viser et neutralt ikon).
"""

from __future__ import annotations

import json
import os
import re

import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

from app_support import DEFAULT_HTTP_HEADERS, configure_logging, logger
from recipe_matching import load_current_products, match_recipe_ingredients


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


# ---------------------------------------------------------------------------
# JSON-LD Recipe-udtræk
# ---------------------------------------------------------------------------

_JSONLD_SCRIPT_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)


def fetch_html(url: str, timeout: int = 15) -> str | None:
    try:
        resp = requests.get(url, timeout=timeout, headers=DEFAULT_HTTP_HEADERS)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        logger.error(f"Kunne ikke hente opskrift-URL {url}: {e}")
        return None


def _iter_jsonld_blocks(html: str):
    for match in _JSONLD_SCRIPT_RE.finditer(html):
        raw = match.group(1).strip()
        if not raw:
            continue
        try:
            yield json.loads(raw)
        except json.JSONDecodeError:
            continue


def _find_recipe_node(data):
    """Recipe-objektet kan ligge direkte, i en liste eller under @graph."""
    if isinstance(data, dict):
        types = data.get('@type')
        types = [types] if isinstance(types, str) else (types or [])
        if 'Recipe' in types:
            return data
        if '@graph' in data:
            found = _find_recipe_node(data['@graph'])
            if found:
                return found
    elif isinstance(data, list):
        for item in data:
            found = _find_recipe_node(item)
            if found:
                return found
    return None


def _parse_iso8601_duration_minutes(value) -> int | None:
    if not value or not isinstance(value, str):
        return None
    m = re.match(r'P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?', value)
    if not m:
        return None
    hours = int(m.group(1) or 0)
    minutes = int(m.group(2) or 0)
    total = hours * 60 + minutes
    return total or None


def extract_jsonld_recipe(html: str) -> dict | None:
    """Eneste udtræksvej: schema.org Recipe JSON-LD (Google Recipe-kort-
    formatet). Findes ingen Recipe-node, importeres siden ikke - der er
    ingen AI-fallback-parsing."""
    for block in _iter_jsonld_blocks(html):
        node = _find_recipe_node(block)
        if node:
            return node
    return None


def normalize_jsonld_recipe(node: dict, url: str) -> dict:
    """Udtrækker kun FAKTA fra kildens JSON-LD (navn, ingredienser, tid,
    portioner, næring, billede-URL) - bevidst ALDRIG recipeInstructions, se
    moduldokumentation øverst om hvorfor."""
    name = node.get('name') or ''
    image = node.get('image')
    if isinstance(image, list):
        image = image[0] if image else ''
    if isinstance(image, dict):
        image = image.get('url', '')

    ingredients_raw = node.get('recipeIngredient') or node.get('ingredients') or []
    if isinstance(ingredients_raw, str):
        ingredients_raw = [ingredients_raw]

    servings = node.get('recipeYield')
    if isinstance(servings, list):
        servings = servings[0] if servings else None
    servings_int = None
    if servings is not None:
        m = re.search(r'\d+', str(servings))
        if m:
            servings_int = int(m.group())

    author = node.get('author')
    if isinstance(author, list):
        author = author[0] if author else None
    if isinstance(author, dict):
        author = author.get('name', '')

    return {
        'title': str(name).strip() or 'Unavngivet opskrift',
        'source_url': url,
        'source_name': str(author or '').strip(),
        'image_url': str(image or ''),
        'servings': servings_int,
        'total_time_minutes': _parse_iso8601_duration_minutes(node.get('totalTime')),
        'ingredients': [str(i).strip() for i in ingredients_raw if str(i).strip()],
        'imported_via': 'jsonld',
        'nutrition_source': _normalize_jsonld_nutrition(node.get('nutrition')),
    }


def _normalize_jsonld_nutrition(raw: dict | None) -> dict | None:
    """schema.org NutritionInformation, hvis kilden selv erklærer den (fx
    Arla) - autoritativ, foretrækkes altid over vores eget estimat
    (_recipe_nutrition_estimate i app.py). Kun de felter vi rent faktisk
    viser, resten af schema.org-blokken (@type mv.) droppes."""
    if not isinstance(raw, dict):
        return None
    fields = {
        'serving_size': raw.get('servingSize'),
        'calories': raw.get('calories'),
        'protein': raw.get('proteinContent'),
        'fat': raw.get('fatContent'),
        'carbohydrate': raw.get('carbohydrateContent'),
        'fiber': raw.get('fiberContent'),
    }
    cleaned = {k: str(v).strip() for k, v in fields.items() if v}
    return cleaned or None


# ---------------------------------------------------------------------------
# Admin-import fra URL
# ---------------------------------------------------------------------------

def import_recipe_from_url(url: str) -> int | None:
    client = _get_supabase_client()
    if client is None:
        logger.error('Supabase-forbindelse mangler - kan ikke importere opskrift')
        return None

    html = fetch_html(url)
    if html is None:
        return None

    node = extract_jsonld_recipe(html)
    recipe = normalize_jsonld_recipe(node, url) if node else None
    if not recipe or not recipe['ingredients']:
        logger.error(
            f'Ingen schema.org Recipe JSON-LD med ingredienser fundet på {url} - '
            'kan ikke importere (ingen AI-fallback)'
        )
        return None

    products = load_current_products(client)
    matched = match_recipe_ingredients(
        [{'raw_text': line} for line in recipe['ingredients']], products,
    )

    try:
        result = client.table('recipes').insert({
            'source_url': recipe['source_url'],
            'source_name': recipe['source_name'],
            'title': recipe['title'],
            'image_url': recipe['image_url'],
            'servings': recipe['servings'],
            'total_time_minutes': recipe['total_time_minutes'],
            'instructions': [],  # bevidst tomt - se moduldokumentation (ophavsret)
            'imported_via': recipe['imported_via'],
            'nutrition_source': recipe.get('nutrition_source'),
            'status': 'approved',
            'approved_at': 'now()',
        }).execute()
        recipe_id = result.data[0]['id']

        rows = [{
            'recipe_id': recipe_id,
            'position': i,
            'raw_text': ing['raw_text'],
            'quantity': ing['quantity'],
            'unit': ing['unit'],
            'ingredient_name': ing['ingredient_name'],
            'matched_product_id': ing['matched_product_id'],
            'match_confidence': ing['match_confidence'],
            'match_method': ing['match_method'],
            'candidate_product_ids': ing['candidate_product_ids'],
        } for i, ing in enumerate(matched)]
        client.table('recipe_ingredients').insert(rows).execute()
    except Exception as e:
        logger.error(f'Kunne ikke gemme opskrift fra {url}: {e}')
        return None

    matched_count = sum(1 for m in matched if m['matched_product_id'])
    logger.info(
        f"Importeret '{recipe['title']}' ({recipe['imported_via']}): "
        f"{matched_count}/{len(matched)} ingredienser matchet"
    )
    return recipe_id


# ---------------------------------------------------------------------------
# Moderation af bruger-indsendte opskrifter (submit_recipe-RPC)
# ---------------------------------------------------------------------------

def moderate_pending_recipes() -> None:
    """Genmatcher ingredienser for alle 'pending' bruger-indsendte opskrifter
    mod den aktuelle produkt-cache. Ingen automatisk godkendelse - kør
    lokalt/manuelt med jævne mellemrum (fx efter et cache-updater-run, så
    matches opdateres mod frisk produktdata), og godkend/afvis derefter
    manuelt i Supabase (status -> 'approved'/'rejected')."""
    client = _get_supabase_client()
    if client is None:
        logger.error('Supabase-forbindelse mangler - kan ikke moderere opskrifter')
        return

    pending = (
        client.table('recipes')
        .select('id,title')
        .eq('status', 'pending')
        .execute()
    ).data or []
    if not pending:
        logger.info('Ingen ventende opskrifter til moderation')
        return

    products = load_current_products(client)

    for recipe in pending:
        recipe_id = recipe['id']
        ingredients = (
            client.table('recipe_ingredients')
            .select('id,raw_text')
            .eq('recipe_id', recipe_id)
            .order('position')
            .execute()
        ).data or []
        if not ingredients:
            continue

        matched = match_recipe_ingredients(ingredients, products)
        for ing in matched:
            client.table('recipe_ingredients').update({
                'quantity': ing['quantity'],
                'unit': ing['unit'],
                'ingredient_name': ing['ingredient_name'],
                'matched_product_id': ing['matched_product_id'],
                'match_confidence': ing['match_confidence'],
                'match_method': ing['match_method'],
                'candidate_product_ids': ing['candidate_product_ids'],
            }).eq('id', ing['id']).execute()

        logger.info(f"Opskrift #{recipe_id} '{recipe['title']}': ingredienser genmatchet, forbliver 'pending'")


# ---------------------------------------------------------------------------
# MadShoppers egne opskrifter (data/egne_opskrifter.json)
# ---------------------------------------------------------------------------

_OWN_RECIPES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'egne_opskrifter.json')
# Kendetegnet for en egen opskrift i recipes-tabellen. imported_via='user_manual'
# (håndskrevet) i stedet for en ny CHECK-værdi, så importen virker uden en
# skemaændring; source_name skiller dem fra brugernes indsendte, som altid har
# submitted_by sat.
_OWN_SOURCE_NAME = 'MadShopper'


def load_own_recipes(path: str = _OWN_RECIPES_FILE) -> list[dict]:
    """Egne opskrifter, skrevet fra bunden af MadShopper ud fra almindelige
    retter. Her MÅ fremgangsmåden gemmes og vises: teksten er vores egen, i
    modsætning til JSON-LD-importen ovenfor, hvor kun fakta tages med."""
    with open(path, 'r', encoding='utf-8') as f:
        recipes = json.load(f).get('opskrifter') or []
    for r in recipes:
        if not r.get('title') or not r.get('ingredients'):
            raise ValueError(f"Egen opskrift mangler titel eller ingredienser: {r.get('slug')}")
    return recipes


def import_own_recipes(dry_run: bool = False) -> int:
    """Lægger data/egne_opskrifter.json ind som godkendte opskrifter.

    Idempotent (nøgle: titel blandt source_name='MadShopper'): nye
    opskrifter oprettes og matches, eksisterende får titel/tid/fremgangsmåde
    opdateret, og ingredienserne matches kun igen hvis listen er ændret
    (nattens recipe_pricing.py holder selv døde produkt-id'er friske).
    Synligheden styres stadig af Opskrifter-knappen i Feature-panelet
    (_recipes_enabled i app.py) - 'approved' her udgiver intet på
    madshopper.dk. Returnerer antal nye/ændrede opskrifter."""
    recipes = load_own_recipes()
    client = _get_supabase_client()
    if client is None:
        logger.error('Supabase-forbindelse mangler - kan ikke importere egne opskrifter')
        return 0

    existing_rows = (
        client.table('recipes')
        .select('id,title')
        .eq('source_name', _OWN_SOURCE_NAME)
        .eq('imported_via', 'user_manual')
        .execute()
    ).data or []
    existing = {row['title']: row['id'] for row in existing_rows}

    products = None
    changed = 0
    for r in recipes:
        fields = {
            'title': r['title'],
            'servings': r.get('servings'),
            'total_time_minutes': r.get('total_time_minutes'),
            'instructions': r.get('instructions') or [],
        }
        recipe_id = existing.get(r['title'])
        if recipe_id is not None:
            current = [
                row['raw_text'] for row in (
                    client.table('recipe_ingredients')
                    .select('raw_text')
                    .eq('recipe_id', recipe_id)
                    .order('position')
                    .execute()
                ).data or []
            ]
            if current == r['ingredients']:
                if not dry_run:
                    client.table('recipes').update(fields).eq('id', recipe_id).execute()
                continue

        if products is None:
            products = load_current_products(client)
            if len(products) < 5000:
                # Samme værn som recipe_pricing.py: en halv cache giver
                # matches mod de forkerte varer, som så står fast.
                logger.error(f'Kun {len(products)} produkter i app_cache - springer egne opskrifter over')
                return 0
        matched = match_recipe_ingredients(
            [{'raw_text': line} for line in r['ingredients']], products,
        )
        matched_count = sum(1 for m in matched if m['matched_product_id'])
        logger.info(
            f"Egen opskrift '{r['title']}': {matched_count}/{len(matched)} ingredienser matchet"
            + (' (prøvekørsel, intet gemt)' if dry_run else '')
        )
        changed += 1
        if dry_run:
            continue

        try:
            if recipe_id is None:
                result = client.table('recipes').insert({
                    **fields,
                    'source_url': None,
                    'source_name': _OWN_SOURCE_NAME,
                    'image_url': '',
                    'imported_via': 'user_manual',
                    'status': 'approved',
                    'approved_at': 'now()',
                }).execute()
                recipe_id = result.data[0]['id']
            else:
                client.table('recipes').update(fields).eq('id', recipe_id).execute()
                client.table('recipe_ingredients').delete().eq('recipe_id', recipe_id).execute()

            client.table('recipe_ingredients').insert([{
                'recipe_id': recipe_id,
                'position': i,
                'raw_text': ing['raw_text'],
                'quantity': ing['quantity'],
                'unit': ing['unit'],
                'ingredient_name': ing['ingredient_name'],
                'matched_product_id': ing['matched_product_id'],
                'match_confidence': ing['match_confidence'],
                'match_method': ing['match_method'],
                'candidate_product_ids': ing['candidate_product_ids'],
            } for i, ing in enumerate(matched)]).execute()
        except Exception as e:
            logger.error(f"Kunne ikke gemme egen opskrift '{r['title']}': {e}")

    logger.info(f'Egne opskrifter: {changed} nye/ændrede af {len(recipes)}')
    return changed


if __name__ == '__main__':
    import sys
    configure_logging()
    if len(sys.argv) > 1 and sys.argv[1] == 'moderate':
        moderate_pending_recipes()
    elif len(sys.argv) > 1 and sys.argv[1] == 'egne':
        import_own_recipes(dry_run='--dry-run' in sys.argv)
    elif len(sys.argv) > 1:
        import_recipe_from_url(sys.argv[1])
    else:
        print('Brug: python recipe_importer.py <url>  ELLER  python recipe_importer.py moderate'
              '  ELLER  python recipe_importer.py egne [--dry-run]')
