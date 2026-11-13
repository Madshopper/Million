"""Hvilke varer i Sallings kataloger (Bilka, Netto, Føtex) der er mad.

De tre kæder deler ét kategoritræ (`consumerFacingHierarchy` i Algolia), så
reglen ligger ét sted i stedet for i tre kopier, der tog fejl på hver sin måde
(målt 11-11-2026 mod madshopper.dk og de rå kataloger):

  - Bilka hentede hele sin egen "Kiosk"-kategori. Den rummer slik, men også
    tobak og nikotin (194), håndkøbsmedicin (74), ugeblade (74) og
    skrabelodder (21). Navnefilteret fangede cigaretterne, men ikke
    nikotinposer, cerutter, ugeblade og skrabelodder, som stod på siden.
  - Netto og Føtex sammenlignede kategorinavnet som delstreng: 'te' (te er
    mad) findes i "Not Ca-te-gorized", så alle varer uden kategori blev
    godkendt som mad, bl.a. Nettos julelys, hovedpinepiller og toiletpapir.
  - "Baby & børn" blev godkendt på ordet 'baby', så sutter og vatpinde kom
    med, når deres navn ikke stod på ordlisten.

Reglen er en hvidliste på det øverste niveau, så en ny kategori hos Salling
ikke slipper ind af sig selv.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from keywords import is_non_food, matches_food

# Øverste niveau i det fælles kategoritræ, hvor alt er mad eller drikke.
FOOD_LVL0 = frozenset({
    'mejeri & køl', 'kolonial', 'drikkevarer', 'slik & snacks',
    'frugt & grønt', 'frost', 'brød & kager', 'mad fra hele verden',
    'kød & fisk',
})

# Kategorier længere nede i træet, der er mad, selvom deres øverste niveau
# ikke er det:
#   - "Baby & børn" er grød og mos, men også bleer, sutter og babypleje.
#   - Proteinbarer og proteindrikke (Arla Protein, Barebells, Gropper) ligger
#     under "Personlig pleje > Helse & kosttilskud" sammen med vitaminpiller.
#     Hele "Personlig pleje" blev før sorteret fra, så Netto manglede 47 og
#     Føtex 93 af de varer, som de andre butikker fører i køledisken.
_FOOD_PATHS = frozenset({
    'baby & børn > baby- & børnemad',
    'personlig pleje > helse & kosttilskud > proteinbarer & -shakes',
})

# Nye og sæsonvarer står uden kategori, til Salling får dem placeret: kød fra
# slagteren og marmelade, men også julelys og hovedpinepiller.
_UNCATEGORIZED = frozenset({'', 'not categorized'})
_WEIGHT_UNITS = frozenset({'g', 'gr', 'kg', 'ml', 'cl', 'dl', 'l', 'ltr'})

# Mister de fleste varer deres kategori (Salling ændrer feltet), ville reglen
# for "uden kategori" slippe shampoo og vaskemiddel ind. Så hellere fejle, så
# gårsdagens data bliver stående.
_MAX_UNCATEGORIZED_SHARE = 0.15


def _as_list(value) -> list:
    if not value:
        return []
    return [value] if isinstance(value, str) else list(value)


def hierarchy(hit: dict) -> tuple[str, frozenset]:
    """(øverste niveau, alle stier på niveau 1 og 2) i små bogstaver.
    ('', frozenset()) for en vare uden kategori."""
    tree = hit.get('consumerFacingHierarchy') or {}
    lvl0 = _as_list(tree.get('lvl0'))
    if not lvl0:
        return '', frozenset()
    paths = frozenset(
        str(x).strip().lower()
        for key in ('lvl1', 'lvl2') for x in _as_list(tree.get(key)))
    return str(lvl0[0]).strip().lower(), paths


# Rækkens kategori, når varen ingen har i kategoritræet: visningslaget
# (app_support.unify_category) gætter så afdelingen ud fra navnet, som det
# gjorde for alle varer, da feltet var hardkodet til dette.
UDEN_KATEGORI = 'Katalog'


def kategori(hit: dict) -> str:
    """Varens plads i Sallings kategoritræ som tekst til produkter.kategori:
    afdeling og underafdeling, fx "Kolonial > Kaffe, te & kakao".

    Feltet var hardkodet til 'Katalog' for alle varer hos Bilka, Netto og
    Føtex, så afdelingen blev gættet ud fra navnet og var forkert for næsten
    hver anden vare (se app_support._STORE_CATEGORIES, som oversætter stien
    til sidens kategorier). To niveauer er nok til det og holder teksten
    kort: den følger med hver vare ud i cachen og D1."""
    tree = hit.get('consumerFacingHierarchy') or {}
    for key in ('lvl1', 'lvl0'):
        values = _as_list(tree.get(key))
        path = str(values[0]).strip() if values else ''
        if path and not path.lower().startswith('not categorized'):
            return path
    return UDEN_KATEGORI


def is_food_hit(hit: dict) -> bool:
    name = hit.get('name') or ''
    if is_non_food(name):
        return False
    lvl0, paths = hierarchy(hit)
    if lvl0 in FOOD_LVL0 or paths & _FOOD_PATHS:
        return True
    if lvl0 in _UNCATEGORIZED:
        # Mad sælges efter vægt eller rumfang. En vare uden kategori, der
        # sælges pr. styk, skal have et mad-ord i navnet for at komme med
        # (bake-off: "Chokolade croissant"); ellers er det julelys og piller.
        unit = str(hit.get('unitsOfMeasure') or '').strip().rstrip('.').lower()
        return unit in _WEIGHT_UNITS or matches_food(name)
    return False


def assert_hierarchy_healthy(hits: list, butik: str) -> None:
    """Fejl, hvis kategorifeltet er forsvundet fra kataloget."""
    if not hits:
        return
    missing = sum(1 for h in hits if hierarchy(h)[0] in _UNCATEGORIZED)
    share = missing / len(hits)
    if share > _MAX_UNCATEGORIZED_SHARE:
        raise RuntimeError(
            f"{butik}: {missing} af {len(hits)} varer ({share:.0%}) har ingen kategori. "
            "Sallings kategorifelt (consumerFacingHierarchy) ser ud til at være ændret, "
            "og uden det kan mad ikke skilles fra ikke-mad. Intet er gemt.")
