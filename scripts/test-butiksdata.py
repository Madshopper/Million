#!/usr/bin/env python3
"""Regressionstest for det, hentningen afgør FØR matchingen: hvad der er mad,
hvilken afdeling varen ligger i, og hvor stor den er.

Kør: python3 scripts/test-butiksdata.py

BAGGRUNDEN, kort: scripts/test-matching.py låser matchmotorens gates, men
motoren kan kun arbejde med det, hentningen giver den. Gennemgangen
10-11-2026 til 11-11-2026 fandt, at fejlene lå her, og at ingen test så dem:

  - Bilka viste nikotinposer, cerutter, ugeblade og skrabelodder; Netto viste
    julelys og hovedpinepiller, fordi 'te' findes i "Not Ca-te-gorized".
  - Meny, Spar og Min Købmand manglede ca. 300 madvarer fra afdelingen
    "Diverse", babymad og proteinbarer, og varer solgt i hele liter ("1 LT")
    stod uden størrelse.
  - Avisernes "24 x 33 cl" stod som én dåse, "3 bakker 100,-" som 100 kr for
    én bakke, og "pr. 1/2 kg" som 2 kg.

Hver kontrol her er et tilfælde, der stod forkert på madshopper.dk, eller en
madvare, som en rettelse nær havde taget med i faldet. Testen bruger ingen
netværk og ingen Supabase: de tunge pakker (selenium, openpyxl, billed-hash)
erstattes af tomme moduler, hvis de ikke er installeret, for reglerne her
bruger dem ikke.
"""
from __future__ import annotations

import importlib
import os
import sys
from unittest.mock import MagicMock

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)
sys.path.insert(0, os.path.join(_ROOT, 'scraper'))


def _stub_if_missing(*names: str) -> None:
    """Scraperne importerer browser- og regnearkspakker øverst i filen. Reglerne
    der testes her, rører dem ikke, så testen skal ikke kræve dem installeret."""
    for name in names:
        try:
            importlib.import_module(name)
        except ImportError:
            sys.modules[name] = MagicMock(name=name)


try:
    # Repoets egen mappe supabase/ (edge-funktionerne) kan importeres som en
    # tom navnerumspakke, når den rigtige pakke mangler: tjek derfor navnet.
    from supabase import create_client  # noqa: F401
except ImportError:
    sys.modules['supabase'] = MagicMock(name='supabase')

_stub_if_missing(
    'requests', 'dotenv',
    'webdriver_manager', 'webdriver_manager.chrome',
    'selenium', 'selenium.webdriver', 'selenium.webdriver.chrome',
    'selenium.webdriver.chrome.service', 'selenium.webdriver.chrome.options',
    'selenium.webdriver.common', 'selenium.webdriver.common.by',
    'selenium.webdriver.support', 'selenium.webdriver.support.ui',
    'selenium.webdriver.support.expected_conditions',
    'openpyxl', 'openpyxl.styles', 'PIL', 'imagehash',
)

import app_support  # noqa: E402
from app_support import (  # noqa: E402
    CAT_BROED_KAGER, CAT_DRIKKEVARER, CAT_FROST, CAT_FRUGT_GROENT, CAT_KOED_FISK,
    CAT_KOLONIAL, CAT_MEJERI, CAT_SLIK, CATEGORY_DEFAULT, CATEGORY_FROM_NAME,
    CATEGORY_FROM_STORE, card_category_after_promotion, category_is_real,
    classify_category, is_age_restricted, is_non_food_name, parse_stk_count,
    parse_weight_to_grams, unify_category,
)
import avis_tekst  # noqa: E402
import dagrofa_scraper  # noqa: E402
import netto_katalog  # noqa: E402
import salling_mad  # noqa: E402
import tjek_tilbud_scraper  # noqa: E402
from keywords import is_non_food, matches_food  # noqa: E402

fails: list[str] = []


def check(label: str, ok: bool) -> None:
    print(("  OK    " if ok else "  FEJL  ") + label)
    if not ok:
        fails.append(label)


def eq(label: str, got, want) -> None:
    ok = got == want
    check(label if ok else f"{label}: fik {got!r}, ventede {want!r}", ok)


# ── Sallings fælles kategoritræ (Bilka, Netto, Føtex) ────────────────────────

def hit(name, lvl0=None, lvl1=None, lvl2=None, unit=None, **extra) -> dict:
    tree = None
    if lvl0:
        tree = {'lvl0': [lvl0]}
        if lvl1:
            tree['lvl1'] = [f'{lvl0} > {lvl1}']
        if lvl1 and lvl2:
            tree['lvl2'] = [f'{lvl0} > {lvl1} > {lvl2}']
    return {'name': name, 'consumerFacingHierarchy': tree, 'unitsOfMeasure': unit, **extra}


def test_salling_mad():
    print("\nSalling: hvad er mad (salling_mad.py)")
    food = salling_mad.is_food_hit

    check("slik i 'Slik & snacks' er mad",
          food(hit('Haribo Matador Mix', 'Slik & snacks', 'Slik')))
    check("mælk i 'Mejeri & køl' er mad",
          food(hit('Sødmælk', 'Mejeri & køl', 'Mælk')))
    check("'Mad fra hele verden' er mad",
          food(hit('Santa Maria Tortilla', 'Mad fra hele verden', 'Mexicansk')))

    # Bilka hentede hele sin kiosk: tobak, nikotin, medicin, blade, lodder.
    for name, lvl1 in (('Zyn Cool Mint Slim', 'Tobak & nikotin'),
                       ('Se & Hør', 'Blade & magasiner'),
                       ('Skrabelod Quick', 'Spil'),
                       ('Panodil 500 mg', 'Håndkøbsmedicin')):
        check(f"kiosk: '{name}' er ikke mad", not food(hit(name, 'Kiosk', lvl1)))
    check("en ukendt vare i 'Kiosk' er ikke mad (hvidliste, ikke sortliste)",
          not food(hit('Ny vare uden kendt ord', 'Kiosk', 'Andet')))

    # 'te' findes i "Not Ca-te-gorized": alt uden kategori blev godkendt.
    check("uden kategori + sælges pr. styk + intet mad-ord: ikke mad",
          not food(hit('Kalenderlys 5x25 cm', 'Not Categorized', unit='stk')))
    check("uden kategori + ukendt navn pr. styk: ikke mad",
          not food(hit('Juledekoration m. gran', None, unit='stk')))
    check("uden kategori + vægt: mad (kød fra slagteren)",
          food(hit('Nakkefilet', 'Not Categorized', unit='g')))
    check("uden kategori + rumfang med punktum ('ml.'): mad",
          food(hit('Hyldeblomstsaft', None, unit='ml.')))
    check("uden kategori + pr. styk + mad-ord (bake-off): mad",
          food(hit('Chokolade croissant', None, unit='stk')))
    check("uden kategori + vægt, men ikke-mad-navn: ikke mad",
          not food(hit('Opvaskemiddel citron', None, unit='ml')))
    check("consumerFacingHierarchy = null vælter ikke",
          not food({'name': 'Kurv', 'consumerFacingHierarchy': None}))

    # "Baby & børn" blev godkendt på ordet 'baby'.
    check("babymad er mad",
          food(hit('Semper Grød', 'Baby & børn', 'Baby- & børnemad')))
    check("sutter er ikke mad", not food(hit('Sut 0-6 mdr', 'Baby & børn', 'Sutter & flasker')))
    check("bleer er ikke mad", not food(hit('Bleer str. 4', 'Baby & børn', 'Bleer')))

    # Proteinbarer ligger under personlig pleje sammen med vitaminpiller.
    check("proteinbar under 'Personlig pleje' er mad",
          food(hit('Barebells Salty Peanut', 'Personlig pleje', 'Helse & kosttilskud',
                   'Proteinbarer & -shakes')))
    check("vitaminpiller under 'Personlig pleje' er ikke mad",
          not food(hit('D-vitamin 90 stk', 'Personlig pleje', 'Helse & kosttilskud',
                       'Vitaminer & mineraler')))
    check("shampoo er ikke mad", not food(hit('Shampoo', 'Personlig pleje', 'Hårpleje')))
    check("en ikke-mad-vare i en mad-kategori er stadig ikke mad",
          not food(hit('Kaffemaskine 1,2 l', 'Kolonial', 'Kaffe, te & kakao')))

    eq("hierarchy: øverste niveau og stier i små bogstaver",
       salling_mad.hierarchy(hit('x', 'Kolonial', 'Kaffe, te & kakao', 'Kaffe')),
       ('kolonial', frozenset({'kolonial > kaffe, te & kakao',
                               'kolonial > kaffe, te & kakao > kaffe'})))
    eq("hierarchy: uden kategori", salling_mad.hierarchy({'name': 'x'}), ('', frozenset()))

    # Forsvinder kategorifeltet, skal hentningen fejle frem for at gemme.
    healthy = [hit(f'vare {i}', 'Kolonial') for i in range(90)] + \
              [hit(f'ny {i}', None) for i in range(10)]
    try:
        salling_mad.assert_hierarchy_healthy(healthy, 'Netto')
        check("10 % uden kategori er normalt (nye varer)", True)
    except RuntimeError:
        check("10 % uden kategori er normalt (nye varer)", False)
    broken = [hit(f'vare {i}', None) for i in range(100)]
    try:
        salling_mad.assert_hierarchy_healthy(broken, 'Netto')
        check("alle uden kategori: hentningen fejler", False)
    except RuntimeError:
        check("alle uden kategori: hentningen fejler", True)


def test_netto_kolli():
    print("\nNetto: kolli og paller uden mål")
    saved = (netto_katalog.fetch_existing_products, netto_katalog.enrich_billede_hashes)
    netto_katalog.fetch_existing_products = lambda butik: {}
    netto_katalog.enrich_billede_hashes = lambda rows: None

    def nhit(name, ore, units=None, unit=None, tree=None):
        return {'name': name, 'gtin': str(abs(hash(name)) % 10**13).zfill(13),
                'units': units, 'unitsOfMeasure': unit, 'consumerFacingHierarchy': tree,
                'storeData': {'7701': {'price': ore}}}
    try:
        rows = netto_katalog.build_rows([
            nhit('Pepsi Max', 165000),                 # en palle, uden mål
            nhit('Faxe Kondi 24 x 33 cl', 10000),      # præcis grænsen, uden mål
            nhit('Mariekiks', 500),                    # billig uden mål: rigtig vare
            nhit('Oksemørbrad', 29900, 1200, 'g'),     # dyr MED mål: rigtig vare
            nhit('Pepsi Max 1,5 l', 2000, 1.5, 'l',
                 {'lvl0': ['Drikkevarer'], 'lvl1': ['Drikkevarer > Sodavand']}),
        ])
    finally:
        netto_katalog.fetch_existing_products, netto_katalog.enrich_billede_hashes = saved
    names = {r['navn'] for r in rows}
    check("palle uden mål til 1.650 kr udelades", 'Pepsi Max' not in names)
    check("vare uden mål til præcis 100 kr udelades", 'Faxe Kondi 24 x 33 cl' not in names)
    check("billig vare uden mål bliver", 'Mariekiks' in names)
    check("dyr vare med mål bliver", 'Oksemørbrad' in names)
    kategori = {r['navn']: r.get('kategori') for r in rows}
    eq("rækken får Nettos egen afdeling", kategori.get('Pepsi Max 1,5 l'), 'Drikkevarer > Sodavand')
    eq("uden afdeling står der 'Katalog'", kategori.get('Mariekiks'), 'Katalog')


# ── Scraperens ordliste (keywords.py) ────────────────────────────────────────

def test_ordliste():
    print("\nOrdlisten: ikke-mad på navnet (keywords.py)")
    for name in ('Skrabelod 7-9-13', 'Se & Hør krydsord', 'Kalenderlys 5x25cm 2fv',
                 'Zyn Cool Mint Slim', 'Nikotinsugetabletter mint', 'Cerutter 10 stk',
                 'Panodil 500 mg 20 stk', 'Otrivin næsespray', 'Treo citrus',
                 'Always Ultra bind', 'Hello Sensitive uld/finvask',
                 'Opvaskemiddel citron', 'Fuglebolde 6 stk', 'Energizer AA 4 stk',
                 'Blender 600 W', 'Nissehue til børn', 'Strømpegarn', 'Lyskæde 80 LED',
                 'Adventslys 4 stk', 'Yummy Gummies vitamin'):
        check(f"ikke mad: {name}", is_non_food(name))

    # Ord der kun gælder som helt ord: delstrengen står i rigtige madvarer.
    for word, food_name in (('Garn', 'Bundgarn Porter'), ('Seler', 'Selleri'),
                            ('Pande', 'Pandekager'), ('Ovn', 'Ovnklar kylling'),
                            ('Spand', 'Spandauer'), ('Kurv', 'Kurvemagerens rugbrød')):
        check(f"'{word}' alene er ikke mad", is_non_food(word))
        check(f"men '{food_name}' er mad", not is_non_food(food_name))

    # Ord der blev prøvet og kasseret, fordi de også står på mad.
    for name in ('Haribo Sutter Mix', 'Chokolade julehus m. julekugler', 'Kinder gaveæske',
                 'Skagen lys rugbrød', 'Lys sirup', 'Trio is', 'Sukkerfri pastiller'):
        check(f"mad: {name}", not is_non_food(name))

    for name in ('Chokolade croissant', 'Kanelsnegl', 'Pølsehorn', 'Tebirkes'):
        check(f"bake-off har et mad-ord: {name}", matches_food(name))


# ── Visningslaget (app_support.py) ───────────────────────────────────────────

def test_visningslag():
    print("\nVisningslaget: unify_category, is_non_food_name, is_age_restricted")
    # Stod på madshopper.dk 11-11-2026.
    for cat, name, brand in (
            ('Katalog', 'Zyn Cool Mint Slim', 'Zyn'),
            ('Katalog', 'Epok Lime', 'Epok'),
            ('Katalog', 'Nordic Spirit Mint', 'Nordic Spirit'),
            ('Katalog', 'Nikotinsugetabletter mint 2 mg', 'Nicorette'),
            ('Katalog', 'Nikotinmundspray', 'Nicorette'),
            ('Katalog', 'Cerutter Café Crème', 'Henri Wintermans'),
            ('Kiosk', 'RØD CIGARETPAPIR', 'RIZLA'),
            ('Katalog', 'Skrabelod Quick', 'Danske Spil'),
            ('Katalog', 'Kalenderlys', 'Salling'),
            ('Andet', 'Otrivin Næsespr Mist 0,1%', 'Otrivin'),
            ('Andet', 'Benadryl Kapsler 8 Mg', 'Benadryl'),
            ('Katalog', 'Multivitamin Børn Jordbær', 'Livol'),
            ('Katalog', 'Magnesium 300 mg', 'Livol'),
            ('Katalog', 'Potte 12 cm', 'Salling'),
            ('Katalog', 'Blomster buket', 'Salling'),
            ('Katalog', 'Legetøj bil', 'Salling'),
            ('Katalog', 'Ble str. 4', 'Libero'),
            ('Kiosk', 'PRINCE HARDBOX', 'PRINCE')):
        eq(f"vises ikke: {name} [{brand}]", unify_category(cat, name, brand), None)

    # Madvarer der bærer et ikke-mad-ord (17 var skjult 11-11-2026).
    for cat, name, brand, want in (
            ('Katalog', 'Capri Sun Multivitamin', 'Capri-Sun', CAT_KOLONIAL),
            ('Katalog', 'Smoothie m. magnesium', 'Froosh', CAT_DRIKKEVARER),
            ('Frugt Og Grønt', 'Dild I Potte', 'Dild', CAT_FRUGT_GROENT),
            ('Frugt Og Grønt', 'Persille I Potte', 'Gartner', CAT_FRUGT_GROENT),
            ('Kolonial', 'Dansk Blomster Honning', 'Jakobsens', CAT_KOLONIAL),
            ('Kiosk - Slik Og Snack - Chokolade', 'Kinder Æg M/Legetøj', 'Kinder', CAT_SLIK),
            ('Kiosk - Slik Og Snack - Slik', 'Sutteflaske M/Sukkerkugler', 'Sutteflaske', CAT_SLIK),
            ('Kolonial', 'Black Coffee Hb Goumet Ble', 'Black', CAT_KOLONIAL),
            ('Kolonial', 'LU Prince kiks', 'LU', CAT_BROED_KAGER)):
        eq(f"vises: {name}", unify_category(cat, name, brand), want)

    check("mærket kan frikende navnet: 'Æg M/Legetøj' fra Kinder",
          not is_non_food_name('Æg M/Legetøj', 'Kinder'))
    check("men mærket alene kan ikke udløse: 'Mælk' med mærket 'Legetøj'",
          not is_non_food_name('Mælk', 'Legetøj'))
    check("uden frikendende ord er 'Legetøj bil' ikke mad", is_non_food_name('Legetøj bil'))
    check("to ord, hvor kun det ene er frikendt, er stadig ikke mad",
          is_non_food_name('Blomster honning shampoo'))

    for title, brand in (('Zyn Cool Mint Slim', ''), ('Nikotinsugetabletter', 'Nicorette'),
                         ('Cerutter', ''), ('Pibetobak Special Dublin', ''),
                         ('Cigaretpapir', 'Rizla'), ('Veev One', ''), ('Rød', 'Hardbox')):
        check(f"aldersbegrænset: {title} [{brand}]", is_age_restricted(title, brand))
    for title, brand in (('Zynk tabletter', ''), ('Cigarformet chokolade', ''),
                         ('Epokegørende rugbrød', ''), ('Snusket mælk', '')):
        check(f"ikke aldersbegrænset: {title}", not is_age_restricted(title, brand))


# ── Meny, Spar og Min Købmand (dagrofa_scraper.py) ───────────────────────────

def test_dagrofa_kategori():
    print("\nMeny/Spar/Min Købmand: afdeling og mad (dagrofa_scraper._api_category)")
    cat = dagrofa_scraper._api_category

    eq("almindelig afdeling", cat(('Mejeri',), 'Mælk'), ('Mejeri', None))
    eq("underafdelingen ændrer ikke afdelingen", cat(('Frugt og grønt', 'Frugt'), 'Æbler'),
       ('Frugt Og Grønt', None))
    # "Diverse" blev sorteret fra: den er 100 % mad (færdigretter, havredrik).
    eq("'Diverse' er mad", cat(('Diverse',), 'Naturli Havredrik'), ('Diverse', None))
    eq("husholdning er ikke mad", cat(('Husholdning', 'Rengøring'), 'Ajax'), (None, 'husholdning'))
    eq("dyremad er ikke mad", cat(('Dyrenes Verden',), 'Kattemad'), (None, 'dyrenes verden'))

    eq("kiosk: slik er mad", cat(('Kiosk - Slik og snack', 'Slik'), 'Haribo'),
       ('Kiosk - Slik Og Snack - Slik', None))
    eq("kiosk: tobak er ikke mad", cat(('Kiosk - Slik og snack', 'Tobak'), 'Prince'),
       (None, 'kiosk (andet)'))
    eq("kiosk uden underafdeling er ikke mad", cat(('Kiosk - Slik og snack',), 'Ukendt'),
       (None, 'kiosk (andet)'))

    eq("babymad er mad", cat(('Baby og børn', 'Babymad og modermælkserstatning'), 'Semper Grød'),
       ('Babymad', None))
    eq("bleer er ikke mad", cat(('Baby og børn', 'Bleer'), 'Libero'), (None, 'baby og børn'))

    sports = ('Personlig pleje', 'Øvrig personlig pleje', 'Vitaminer & kosttilskud')
    eq("proteinbar er mad", cat(('Personlig pleje', 'Øvrig personlig pleje'),
                                'Barebells Salty Peanut'), ('Sportsernæring', None))
    eq("proteindrik er mad", cat(sports, 'Arla Protein Chokolade'), ('Sportsernæring', None))
    eq("proteinbar med kreatin er mad", cat(sports, 'Proteinbar m. kreatin'),
       ('Sportsernæring', None))
    eq("kreatinpulver er ikke mad", cat(sports, 'Kreatin pulver'), (None, 'personlig pleje'))
    eq("proteinpulver er ikke mad", cat(sports, 'Protein pulver vanilje'),
       (None, 'personlig pleje'))
    eq("vitamintabs er ikke mad", cat(sports, 'C-vitamin tabs'), (None, 'personlig pleje'))
    eq("'protein' i hårpleje er ikke mad", cat(('Personlig pleje', 'Hårpleje'), 'Protein shampoo'),
       (None, 'personlig pleje'))

    # Alle 81 varer uden kategori var håndkøbsmedicin.
    eq("uden kategori er ikke mad", cat((), 'Otrivin'), (None, 'uden kategori'))
    eq("tom kategori er ikke mad", cat(('',), 'Panodil'), (None, 'uden kategori'))

    # Afdelingsnavnene skal kunne oversættes til sidens kategorier.
    eq("'Babymad' kendes af visningslaget", unify_category('Babymad', 'Semper Grød Havre', 'Semper'),
       CAT_KOLONIAL)
    check("'Sportsernæring' giver en kategori (ikke skjult)",
          unify_category('Sportsernæring', 'Barebells Salty Peanut', 'Barebells') is not None)
    check("'Diverse' giver en kategori (ikke skjult)",
          unify_category('Diverse', 'Naturli Havredrik', 'Naturli') is not None)


def test_dagrofa_stoerrelse():
    print("\nMeny/Spar/Min Købmand: størrelse (dagrofa_scraper.parse_netto_vaegt)")
    parse = dagrofa_scraper.parse_netto_vaegt
    for text, want in (
            ('400 GR', '400 GR'), ('1 KG', '1 KG'), ('75 CL', '75 CL'),
            ('6X33 CL', '6X33 CL'),
            # "LT" stod ikke i mønsteret: 288 varer i hele liter uden størrelse.
            ('1 LT', '1 l'), ('0,5 LT', '0,5 l'), ('1.5 LT', '1.5 l'),
            # Brøken er en del af en liter, uanset enheden efter den.
            ('1/4 ML', '0.25 l'), ('1/1 L', '1 l'), ('1/2 LT', '0.5 l'),
            # Emballagen som enhed: tallet er indholdet.
            ('300 GL', '300 g'), ('250 BK', '250 g'), ('270 FL', '270 ml'),
            # ... men et lille tal er et antal og siger intet om indholdet.
            ('1 BK', ''), ('10 FL', ''),
            # "_" kan være g, ml, cl eller l: gæt aldrig.
            ('500 _', ''), ('1/1 _', ''),
            ('4 stk', '4 stk'), ('1 ST', '1 stk'), ('', ''),
            ('Netto vægt: 500 g. Mere tekst', '500 g')):
        eq(f"{text!r}", parse(text), want)

    # Størrelsen skal kunne læses af resten af koden.
    for text, grams in (('1 LT', 1000.0), ('1/4 ML', 250.0), ('300 GL', 300.0),
                        ('270 FL', 270.0), ('400 GR', 400.0), ('6X33 CL', 1980.0)):
        eq(f"{text!r} forstås som {grams:g} g/ml", parse_weight_to_grams(parse(text)), grams)
    eq("'1 LT' til 20 kr giver literpris",
       dagrofa_scraper.calculate_kg_price('20,00', parse('1 LT')), '20.00 kr/l')


# ── Aviserne (avis_tekst.py, tjek_tilbud_scraper.py) ─────────────────────────

def offer(heading, desc, price, unit=None, size=None, pieces=None, pre=None) -> dict:
    q = {}
    if unit:
        q['unit'] = {'symbol': unit}
    if size:
        q['size'] = {'from': size[0], 'to': size[1]}
    if pieces:
        q['pieces'] = {'from': pieces[0], 'to': pieces[1]}
    return {'heading': heading, 'description': desc,
            'pricing': {'price': price, 'pre_price': pre}, 'quantity': q}


def test_avis_tekst():
    print("\nAviserne: tekst og tal (avis_tekst.py)")
    join = avis_tekst.join_linebreak_hyphens
    eq("orddeling ved linjeskift samles", join('stege/bage- margarine'), 'stege/bagemargarine')
    eq("'- el.' bliver stående", join('Frikadelle- el. kyllingeplatte'),
       'Frikadelle- el. kyllingeplatte')
    eq("'- og' bliver stående", join('kød- og melboller'), 'kød- og melboller')
    eq("bindestreg uden mellemrum røres ikke", join('Coca-Cola'), 'Coca-Cola')

    wt = avis_tekst.weight_text
    eq("én størrelse", wt(500, 500, 'g'), '500 g')
    eq("et spænd bliver stående som tekst", wt(850, 900, 'g'), '850-900 g')
    eq("en ramme", wt(33, 33, 'cl', 24, 24), '24 x 33 cl')
    eq("en ramme med 15 eller 18", wt(33, 33, 'cl', 15, 18), '15-18 x 33 cl')
    eq("et halvt kilo skrives i gram", wt(0.5, 0.5, 'kg'), '500 g')
    eq("kun 'til' udfyldt", wt(None, 400, 'gr'), '400 g')
    eq("ukendt enhed giver ingen størrelse", wt(500, 500, 'pk'), None)
    eq("nul giver ingen størrelse", wt(0, 0, 'g'), None)
    eq("rammen kan regnes: 24 x 33 cl = 7.920 ml",
       parse_weight_to_grams(wt(33, 33, 'cl', 24, 24)), 7920.0)
    eq("et spænd er ikke ét tal for vægt-gaten", parse_weight_to_grams(wt(850, 900, 'g')), None)
    eq("'10 stk' læses som antal", parse_stk_count(wt(10, 10, 'stk')), 10)

    eq("3 for 100", avis_tekst.multi_buy(100, 3), (33.33, '3 for 100 kr'))
    eq("2 for 89,95", avis_tekst.multi_buy(89.95, 2), (44.98, '2 for 89,95 kr'))
    multi_re = getattr(app_support, '_MULTI_DEAL_RE', None)
    if multi_re is not None:
        for text in ('3 for 100 kr', '2 for 89,95 kr'):
            check(f"kortet forstår multikøb-teksten {text!r}", bool(multi_re.search(text)))

    up = avis_tekst.exact_unit_price
    eq("kilopris", up('Kg-pris 196,67'), '196.67 kr/kg')
    eq("literpris med pant", up('Literpris 88,67 + pant'), '88.67 kr/l')
    eq("tusindtalspunktum", up('Kg pris 1.250,00'), '1250.00 kr/kg')
    eq("'maks.' er ikke varens kilopris", up('Ltr-pris maks. 669,17'), None)
    eq("stykpris er ikke en kilopris", up('Stk-pris 2,50'), None)


def test_avis_tilbud():
    print("\nAviserne: ét tilbud til én række (tjek_tilbud_scraper.offer_fields)")
    fields = tjek_tilbud_scraper.offer_fields
    signal = tjek_tilbud_scraper.has_grocery_signal

    r = fields(offer('Hakket oksekød', 'Kg-pris 218,00. Pr. 1/2 kg', 109.0, 'kg', (0.5, 0.5), (1, 1)))
    eq("'pr. 1/2 kg' er 500 g (stod som 2 kg)", r['netto_vaegt'], '500 g')
    eq("... med avisens kilopris", r['kg_price'], '218.00 kr/kg')

    r = fields(offer('Tuborg', '24 x 33 cl. Literpris 8,84 + pant. Sælges i hele forpakninger',
                     69.99, 'cl', (33, 33), (24, 24)))
    eq("en kasse øl er én vare på 24 x 33 cl (stod som 33 cl)", r['netto_vaegt'], '24 x 33 cl')
    eq("... og ikke et multikøb", (r['pris'], r['multikob']), (69.99, None))

    r = fields(offer('Royal', '15-pak / 18-pak. 15-18 x 33 cl. Ltr-pris maks. 20,20 + pant',
                     99.95, 'cl', (33, 33), (15, 18)))
    eq("15 eller 18 dåser står som spænd", r['netto_vaegt'], '15-18 x 33 cl')
    eq("... uden kilopris ('maks.')", r['kg_price'], None)

    r = fields(offer('Pepsi Max', '6 flasker 150 cl. Literpris 11,11 + pant', 100.0, 'cl',
                     (150, 150), (6, 6), 150.0))
    eq("'6 flasker 100,-' er 16,67 kr pr. flaske", r['pris'], 16.67)
    eq("... med multikøb-tekst", r['multikob'], '6 for 100 kr')
    eq("... og førpris pr. flaske", r['normalpris'], 25.0)
    eq("... og størrelsen på én flaske", r['netto_vaegt'], '150 cl')

    r = fields(offer('Kyllingefilet', '3 bakker 100,-. 280-300 g. Kg-pris maks. 119,05', 100.0,
                     'g', (280, 300), (3, 3)))
    eq("'3 bakker 100,-' er 33,33 kr pr. bakke", (r['pris'], r['multikob']), (33.33, '3 for 100 kr'))

    r = fields(offer('Hakkebøffer', '1000 g. / 4-6 stk. Kg-pris 59,95', 59.95, 'g',
                     (1000, 1000), (4, 6)))
    eq("'1000 g / 4-6 stk' er ét kilo, ikke 4-6 kilo", r['netto_vaegt'], '1000 g')
    eq("... og ikke et multikøb", r['multikob'], None)

    r = fields(offer('Æg', '10 stk. Stk.-pris 2,50', 25.0, 'pcs', (10, 10), (1, 1)))
    eq("'10 stk' er antallet", r['netto_vaegt'], '10 stk')
    eq("... og stykprisen er ikke en kilopris", r['kg_price'], None)

    check("dagligvare med vægt har et signal",
          signal(offer('Rugbrød', '850-900 g', 12.0, 'g', (850, 900), (1, 1))))
    check("stykvare med stykpris har et signal",
          signal(offer('Agurk', 'Danmark, kl. I. Stk.-pris 6,00', 6.0, 'pcs', (1, 1), (1, 1))))
    check("mikroovn uden vægt og enhedspris har intet signal",
          not signal(offer('Mikroovn', '700 W', 499.0, 'pcs', (1, 1), (1, 1))))


# ── Kategorier: butikkens egen afdeling i stedet for et gæt ─────────────────

def test_kategorier():
    print("\nKategorier: salling_mad.kategori, classify_category, kortets kategori")
    # Før 12-11-2026 gemte Bilka, Netto og Føtex 'Katalog' på alle varer, så
    # kategorien blev gættet ud fra navnet. Gættet var forkert for næsten hver
    # anden vare (Pepsi Max under Kolonial).
    kat = salling_mad.kategori
    eq("Salling: afdeling og underafdeling",
       kat(hit('Pepsi Max', 'Drikkevarer', 'Sodavand', 'Cola')), 'Drikkevarer > Sodavand')
    eq("Salling: kun afdeling", kat(hit('Sødmælk', 'Mejeri & køl')), 'Mejeri & køl')
    eq("Salling: uden kategori", kat(hit('Ny vare')), 'Katalog')
    eq("Salling: 'Not Categorized' tæller ikke", kat(hit('Ny vare', 'Not Categorized')), 'Katalog')
    eq("Salling: hierarki = null vælter ikke",
       kat({'name': 'x', 'consumerFacingHierarchy': None}), 'Katalog')

    cc = classify_category
    BUTIK, NAVN, GAET = CATEGORY_FROM_STORE, CATEGORY_FROM_NAME, CATEGORY_DEFAULT
    eq("Pepsi Max med Sallings afdeling er en drikkevare",
       cc('Drikkevarer > Sodavand', 'Pepsi Max'), (CAT_DRIKKEVARER, BUTIK))
    eq("kaffe er en drikkevare, selv om Salling har den under Kolonial",
       cc('Kolonial > Kaffe, te & kakao', 'Formalet kaffe'), (CAT_DRIKKEVARER, BUTIK))
    eq("tørret frugt og bars er kolonial, ikke slik",
       cc('Slik & snacks > Tørret frugt, frugtsnacks & bars', 'Abrikoser'), (CAT_KOLONIAL, BUTIK))
    eq("resten af 'Slik & snacks' er slik",
       cc('Slik & snacks > Chips, nødder & snacks', 'Kims Chips'), (CAT_SLIK, BUTIK))
    eq("pålæg under 'Mejeri & køl' er køl", cc('Mejeri & køl > Pålæg', 'Leverpostej'),
       (CAT_MEJERI, BUTIK))
    eq("frost er frost", cc('Frost > Grøntsager', 'Ærter'), (CAT_FROST, BUTIK))
    eq("kød er kød", cc('Kød & fisk > Grisekød', 'Flæskesteg'), (CAT_KOED_FISK, BUTIK))
    eq("'Mad fra hele verden' er kolonial",
       cc('Mad fra hele verden > Asiatisk mad', 'Kokosmælk'), (CAT_KOLONIAL, BUTIK))
    eq("babymad er kolonial", cc('Baby & børn > Baby- & børnemad', 'Semper Grød'),
       (CAT_KOLONIAL, BUTIK))
    eq("bleer er ikke mad", cc('Baby & børn > Bleer', 'Bleer str. 4'), (None, ''))
    eq("proteinbar under personlig pleje gættes ud fra navnet (ikke skjult)",
       cc('Personlig pleje > Helse & kosttilskud', 'Barebells Salty Peanut'),
       (CAT_KOLONIAL, GAET))
    eq("'Katalog' (uden kategori) er kun et gæt", cc('Katalog', 'Pepsi Max'),
       (CAT_KOLONIAL, GAET))
    # Spar og Min Købmand kalder afdelingen noget andet end Meny. Den manglede,
    # så 310 pakker pålæg stod under Kolonial.
    eq("Spar/Min Købmand: 'Pålæg Og Middagsretter' er køl",
       cc('Pålæg Og Middagsretter', 'Leverpostej'), (CAT_MEJERI, BUTIK))
    eq("Meny: 'Pålæg Og Kølede Middagsretter' er køl",
       cc('Pålæg Og Kølede Middagsretter', 'Leverpostej'), (CAT_MEJERI, BUTIK))
    # Kiosk-reglerne (Remas blandede kiosk) ramte 'kiosk' midt i Dagrofas
    # afdelingsnavne og sendte 41 slik og chips til Drikkevarer.
    eq("Dagrofa: lakrids i kiosk-slik er slik, ikke en drikkevare",
       cc('Kiosk - Slik Og Snack - Slik', 'Toms Pingvin Lakrids'), (CAT_SLIK, BUTIK))
    eq("Dagrofa: chips med eddike er slik",
       cc('Kiosk - Slik Og Snack - Chips Og Snacks', 'Kims Salt & Vinegar'), (CAT_SLIK, BUTIK))
    eq("Dagrofa: slikkepind i slik-afdelingen er slik, ikke frost",
       cc('Kiosk - Slik Og Snack - Slik', 'Chupa Chups Lolly'), (CAT_SLIK, BUTIK))
    eq("avis: ispind er frost ud fra navnet", cc('Tilbudsavis', 'Magnum ispind'),
       (CAT_FROST, NAVN))
    eq("avis: cola er en drikkevare ud fra navnet", cc('Tilbudsavis', 'Coca-Cola'),
       (CAT_DRIKKEVARER, NAVN))
    eq("avis: ukendt navn er kun et gæt", cc('Tilbudsavis', 'Hakket oksekød 8-12%'),
       (CAT_KOLONIAL, GAET))
    eq("Rema: spiritus i kiosken er en drikkevare", cc('Kiosk', 'VODKA 37,5%')[0],
       CAT_DRIKKEVARER)
    eq("husholdning er ikke mad", cc('Husholdning', 'Opvaskemiddel'), (None, ''))

    check("en kendt afdeling er rigtig", category_is_real('Drikkevarer > Sodavand'))
    check("Spar/Min Købmands pålæg er en rigtig afdeling",
          category_is_real('Pålæg Og Middagsretter'))
    check("'Katalog' er ikke en rigtig afdeling", not category_is_real('Katalog'))
    check("'Tilbudsavis' er ikke en rigtig afdeling", not category_is_real('Tilbudsavis'))
    check("Remas blandede 'Kiosk' er ikke en rigtig afdeling", not category_is_real('Kiosk'))
    check("en afdeling der afgøres af navnet, er ikke en rigtig afdeling",
          not category_is_real('Personlig pleje > Helse & kosttilskud'))

    # Når en billigere butik bliver kortets forside, må den kun skifte kortets
    # kategori med sin egen afdeling, ikke med et gæt.
    promo = card_category_after_promotion
    eq("billigere butik med rigtig afdeling skifter kortets kategori",
       promo(CAT_KOLONIAL, {'Kategori': 'Drikkevarer > Sodavand', 'name': 'Pepsi Max'}),
       CAT_DRIKKEVARER)
    eq("et gæt overskriver ikke kortets kategori",
       promo(CAT_DRIKKEVARER, {'Kategori': 'Tilbudsavis', 'name': 'Pepsi Max'}), None)
    eq("et gæt må udfylde en manglende kategori",
       promo('', {'Kategori': 'Tilbudsavis', 'name': 'Coca-Cola'}), CAT_DRIKKEVARER)
    eq("et gæt må erstatte 'Andre varer'",
       promo('Andre varer', {'Kategori': 'Tilbudsavis', 'name': 'Coca-Cola'}), CAT_DRIKKEVARER)
    eq("ikke-mad skifter aldrig kortets kategori",
       promo(CAT_KOLONIAL, {'Kategori': 'Husholdning', 'name': 'Opvask'}), None)


def main() -> int:
    test_salling_mad()
    test_netto_kolli()
    test_ordliste()
    test_visningslag()
    test_dagrofa_kategori()
    test_dagrofa_stoerrelse()
    test_avis_tekst()
    test_avis_tilbud()
    test_kategorier()

    print()
    if fails:
        print(f"{len(fails)} KONTROL(LER) FEJLEDE:")
        for label in fails:
            print(f"  - {label}")
        return 1
    print("ALLE TESTS BESTAAET")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
