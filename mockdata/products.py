"""Mock-varer til offline-tilstand (MADSHOPPER_OFFLINE=1).

Ingen rigtige butiksdata: navne og priser er opdigtede, men har samme form som
updater.py's app_cache, så sider, søgning, kurv og sammenligning opfører sig
som på madshopper.dk. Tilføj frit varer her, når en ny funktion skal vises.

Hver række: (titel, mærke, mængde, kategori, gram/ml, {butik: pris eller
(tilbudspris, førpris)}, multikøb). Butiksnøglerne er dem fra
app_support._STORE_CONFIGS. Kortets forside bliver den billigste butik.
"""
from __future__ import annotations

from app_support import (
    CAT_BROED_KAGER, CAT_DRIKKEVARER, CAT_FROST, CAT_FRUGT_GROENT,
    CAT_KOED_FISK, CAT_KOLONIAL, CAT_MEJERI, CAT_SLIK, _STORE_CONFIGS,
)

_ROWS = [
    # --- Køl ---
    ('Letmælk 1 L', 'Arla', '1 L', CAT_MEJERI, 1000,
     {'rema': 11.95, 'netto': 11.95, 'bilka': 12.25, 'meny': 13.5, 'sb': 13.95, 'lidl': 11.5}, ''),
    ('Øko Sødmælk 1 L', 'Arla Ko', '1 L', CAT_MEJERI, 1000,
     {'rema': 15.95, 'foetex': (12.0, 16.5), 'kvickly': 16.95, 'spar': 17.25}, ''),
    ('Skyr Vanilje 1 kg', 'Arla', '1 kg', CAT_MEJERI, 1000,
     {'netto': (20.0, 27.95), 'bilka': 27.5, 'rema': 26.95}, ''),
    ('Græsk Yoghurt 10 %', 'Apetina', '1 kg', CAT_MEJERI, 1000,
     {'lidl': 24.95, 'rema': 27.0, 'meny': 32.95}, ''),
    ('Smør 250 g', 'Lurpak', '250 g', CAT_MEJERI, 250,
     {'rema': 24.95, 'netto': (18.0, 25.0), 'bilka': 24.5, 'sb': 26.95, 'loevbjerg': 25.95}, ''),
    ('Gouda 45+ skiver', 'Castello', '300 g', CAT_MEJERI, 300,
     {'foetex': 29.95, 'bilka': 28.5, 'meny': (22.0, 32.0)}, '2 for 40'),
    ('Danbo 45+ i skiver', 'Riberhus', '500 g', CAT_MEJERI, 500,
     {'rema': 39.95, 'netto': 38.5, 'abclavpris': 36.95}, ''),
    ('Æg fritgående 10 stk', 'Hedegaard', '10 stk', CAT_MEJERI, None,
     {'rema': 29.95, 'netto': 28.95, 'lidl': 27.95, 'discount365': 27.5}, ''),
    ('Piskefløde 38 %', 'Arla', '1/4 L', CAT_MEJERI, 250,
     {'rema': 13.5, 'meny': 15.95, 'mk': 16.5}, ''),
    ('Hummus Klassisk', 'Salling', '200 g', CAT_MEJERI, 200,
     {'bilka': 16.0, 'netto': 15.5, 'foetex': (12.0, 17.0)}, ''),
    # --- Kød & Fisk ---
    ('Hakket oksekød 8-12 %', 'Danish Crown', '500 g', CAT_KOED_FISK, 500,
     {'rema': 42.95, 'netto': (35.0, 45.0), 'bilka': 44.0, 'lidl': 41.95, 'kvickly': 49.95}, ''),
    ('Hakket svinekød 8-12 %', 'Tulip', '500 g', CAT_KOED_FISK, 500,
     {'rema': 29.95, 'foetex': 32.0, 'spar': 34.95}, '2 for 50'),
    ('Kyllingebryst', 'Danpo', '900 g', CAT_KOED_FISK, 900,
     {'rema': 79.95, 'bilka': (59.0, 85.0), 'meny': 89.95, 'lidl': 74.95}, ''),
    ('Laksefilet med skind', 'Royal Greenland', '250 g', CAT_KOED_FISK, 250,
     {'netto': 39.95, 'sb': (30.0, 45.95), 'loevbjerg': 42.0}, ''),
    ('Bacon i skiver', 'Steff Houlberg', '150 g', CAT_KOED_FISK, 150,
     {'rema': 18.95, 'netto': 17.95, 'abclavpris': 16.95}, '3 for 45'),
    ('Rullepølse i skiver', 'Gøl', '100 g', CAT_KOED_FISK, 100,
     {'rema': 15.95, 'foetex': 17.0}, ''),
    # --- Frugt & Grønt ---
    ('Bananer', '', '1 kg', CAT_FRUGT_GROENT, 1000,
     {'rema': 16.0, 'netto': 15.0, 'bilka': 15.95, 'lidl': 14.95, 'meny': 19.95}, ''),
    ('Æbler Pink Lady', '', '6 stk', CAT_FRUGT_GROENT, None,
     {'netto': 25.0, 'foetex': (18.0, 28.0), 'spar': 29.95}, ''),
    ('Agurk', '', '1 stk', CAT_FRUGT_GROENT, None,
     {'rema': 8.0, 'netto': 7.5, 'lidl': 6.95, 'kvickly': 9.95}, ''),
    ('Cherrytomater', '', '250 g', CAT_FRUGT_GROENT, 250,
     {'rema': 14.95, 'bilka': (10.0, 15.95), 'mk': 18.0}, ''),
    ('Øko Gulerødder', '', '1 kg', CAT_FRUGT_GROENT, 1000,
     {'rema': 12.0, 'netto': 11.0, 'brugsen': 14.95}, ''),
    ('Avocado klar til spisning', '', '2 stk', CAT_FRUGT_GROENT, None,
     {'foetex': 25.0, 'meny': 26.95, 'lidl': 20.0}, ''),
    ('Kartofler bagekartofler', '', '2 kg', CAT_FRUGT_GROENT, 2000,
     {'rema': 20.0, 'bilka': 18.0, 'discount365': 17.5}, ''),
    # --- Brød & Kager ---
    ('Rugbrød Solsikke', 'Schulstad', '1 kg', CAT_BROED_KAGER, 1000,
     {'rema': 22.0, 'netto': (17.0, 23.0), 'bilka': 22.5, 'sb': 25.95}, ''),
    ('Toastbrød', 'Kohberg', '700 g', CAT_BROED_KAGER, 700,
     {'rema': 18.95, 'lidl': 14.95, 'meny': 22.0}, ''),
    ('Hvedeboller 6 stk', 'Lagkagehuset', '6 stk', CAT_BROED_KAGER, None,
     {'foetex': 25.0, 'loevbjerg': 24.0}, ''),
    ('Kanelsnegle 4 stk', 'Mette Munk', '4 stk', CAT_BROED_KAGER, None,
     {'netto': 20.0, 'rema': 22.0, 'abclavpris': 19.0}, ''),
    # --- Frost ---
    ('Pizza Margherita', "Dr. Oetker", '335 g', CAT_FROST, 335,
     {'rema': 30.0, 'netto': (22.0, 32.0), 'bilka': 29.95}, '2 for 45'),
    ('Ærter frosne', 'Frigodan', '1 kg', CAT_FROST, 1000,
     {'rema': 20.0, 'lidl': 17.95, 'spar': 26.0}, ''),
    ('Vaniljeis', 'Hansens', '1 L', CAT_FROST, 1000,
     {'foetex': (35.0, 52.0), 'kvickly': 54.95, 'meny': 52.0}, ''),
    ('Pommes frites', 'Aviko', '1 kg', CAT_FROST, 1000,
     {'rema': 22.0, 'netto': 21.0, 'discount365': 19.95}, ''),
    # --- Kolonial ---
    ('Spaghetti', 'Barilla', '500 g', CAT_KOLONIAL, 500,
     {'rema': 14.0, 'netto': 13.5, 'bilka': (10.0, 15.0), 'meny': 17.95, 'lidl': 12.95}, ''),
    ('Basmati ris', 'Tilda', '1 kg', CAT_KOLONIAL, 1000,
     {'foetex': 34.95, 'bilka': 33.0, 'sb': (25.0, 37.0)}, ''),
    ('Hakkede tomater', 'Mutti', '400 g', CAT_KOLONIAL, 400,
     {'rema': 9.0, 'netto': 8.5, 'mk': 12.0}, '4 for 30'),
    ('Havregryn', 'Ota', '1 kg', CAT_KOLONIAL, 1000,
     {'rema': 18.0, 'netto': 17.5, 'lidl': 15.95, 'brugsen': 22.0}, ''),
    ('Rapsolie', 'Änglamark', '1 L', CAT_KOLONIAL, 1000,
     {'kvickly': 29.95, 'sb': 29.95, 'brugsen': 31.0}, ''),
    ('Peanut butter crunchy', 'Skippy', '340 g', CAT_KOLONIAL, 340,
     {'bilka': 28.0, 'foetex': 29.0, 'meny': (22.0, 32.0)}, ''),
    ('Kaffe formalet', 'Merrild', '400 g', CAT_KOLONIAL, 400,
     {'rema': 49.95, 'netto': (40.0, 52.0), 'bilka': 49.0, 'loevbjerg': 54.95}, ''),
    # --- Drikkevarer ---
    ('Coca-Cola 1,5 L', 'Coca-Cola', '1,5 L', CAT_DRIKKEVARER, 1500,
     {'rema': 18.0, 'netto': 17.0, 'bilka': (12.0, 18.0), 'lidl': 16.95, 'abclavpris': 15.0}, '2 for 25'),
    ('Pilsner 6-pak', 'Tuborg', '6 x 33 cl', CAT_DRIKKEVARER, 1980,
     {'rema': 39.95, 'foetex': (30.0, 45.0), 'discount365': 36.0}, ''),
    ('Appelsinjuice', 'Rynkeby', '1 L', CAT_DRIKKEVARER, 1000,
     {'rema': 20.0, 'netto': 19.0, 'meny': 24.95}, ''),
    ('Danskvand citrus', 'Egekilde', '1,5 L', CAT_DRIKKEVARER, 1500,
     {'netto': 10.0, 'rema': 10.5, 'spar': 13.0}, '3 for 25'),
    ('Rødvin Primitivo', 'Doppio Passo', '75 cl', CAT_DRIKKEVARER, 750,
     {'bilka': (49.0, 79.0), 'foetex': 75.0, 'meny': 79.95}, ''),
    # --- Slik ---
    ('Mælkechokolade', 'Marabou', '200 g', CAT_SLIK, 200,
     {'rema': 25.0, 'netto': (15.0, 25.0), 'bilka': 24.0, 'lidl': 22.95}, '2 for 35'),
    ('Vingummi Matador Mix', 'Haribo', '375 g', CAT_SLIK, 375,
     {'rema': 25.0, 'foetex': 27.0, 'abclavpris': 20.0}, ''),
    ('Chips Sour Cream', 'Kims', '175 g', CAT_SLIK, 175,
     {'netto': 22.0, 'rema': 23.0, 'kvickly': 26.95}, '3 for 50'),
    ('Lakridser', 'Lakrids by Bülow', '125 g', CAT_SLIK, 125,
     {'meny': 45.0, 'sb': 49.0}, ''),
]

# Farver til billed-pladsholderne (mockdata.offline._placeholder_svg).
CATEGORY_COLORS = {
    CAT_MEJERI: '#cfe8ff', CAT_KOED_FISK: '#ffd6d6', CAT_FRUGT_GROENT: '#d7f5d0',
    CAT_BROED_KAGER: '#f6e3c3', CAT_FROST: '#dff4fb', CAT_KOLONIAL: '#efe6d5',
    CAT_DRIKKEVARER: '#e6dcff', CAT_SLIK: '#ffe0f0',
}


def _norm(price):
    """(tilbud, før) eller bare pris -> (pris man betaler, førpris|None)."""
    if isinstance(price, tuple):
        return float(price[0]), float(price[1])
    return float(price), None


def _kg_price(price: float, grams) -> float | None:
    return round(price / grams * 1000, 2) if grams else None


def build_products() -> list[dict]:
    products = []
    for n, (title, brand, amount, cat, grams, prices, multi) in enumerate(_ROWS, start=1):
        pid = f'mock{n:03d}'
        img = f'/__mock/img/{pid}.svg'
        normed = {k: _norm(v) for k, v in prices.items()}
        cheapest = min(normed, key=lambda k: normed[k][0])
        pay, before = normed[cheapest]
        matches = {}
        for key, (p, b) in normed.items():
            if key == 'rema':
                continue
            matches[key] = {
                'name': title, 'price': p, 'normal_price': b, 'is_sale': b is not None,
                'image': img, 'brand': brand, 'description': amount, 'weight': amount,
                'kg_price': _kg_price(p, grams), 'multi_deal': multi if key == cheapest else '',
                'ean': f'57{n:011d}', 'Kategori': cat,
            }
        rema = normed.get('rema')
        any_sale = any(b is not None for _, b in normed.values())
        products.append({
            '/product/id': pid,
            '/product/title': title,
            '/product/price': before if before else pay,
            '/product/sale_price': pay if before else None,
            '/product/description': amount,
            '/product/brand': brand,
            '/product/imageLink': img,
            '/product/rema_image': img if rema else '',
            '/product/store': _STORE_CONFIGS[cheapest]['label'],
            '/product/unit_pricing_measure': amount,
            '/product/weight_g': grams,
            '/product/stk_count': None,
            '/product/price_per_kg': _kg_price(pay, grams),
            '/product/rema_price': rema[0] if rema else None,
            '/product/rema_is_sale': bool(rema and rema[1]),
            '/product/multi_deal': multi,
            '/product/cheapest_at': cheapest,
            '/product/cheaper_at': cheapest,
            '/product/product_type': cat,
            '/product/is_any_sale': any_sale,
            '/product/own_sale': before is not None,
            '/product/lowest_price_30d': round(pay * 0.95, 2),
            '/product/ean': f'57{n:011d}',
            '/product/store_matches': matches,
        })
    return products


def price_history_rows(product: dict, days: int = 30) -> list[dict]:
    """Opdigtet prisudvikling: normalpris, med tilbuddet de sidste 5 dage."""
    from datetime import date, timedelta
    rows = []
    today = date.today()
    stores = dict(product.get('/product/store_matches') or {})
    if product.get('/product/rema_price'):
        stores['rema'] = {'price': product['/product/rema_price'], 'normal_price': None}
    for key, m in stores.items():
        now = float(m.get('price') or 0)
        normal = float(m.get('normal_price') or now)
        rows.append({'store': key, 'price': round(normal * 1.04, 2),
                     'date': (today - timedelta(days=days)).isoformat()})
        rows.append({'store': key, 'price': normal,
                     'date': (today - timedelta(days=18)).isoformat()})
        rows.append({'store': key, 'price': now,
                     'date': (today - timedelta(days=5)).isoformat()})
    return rows
