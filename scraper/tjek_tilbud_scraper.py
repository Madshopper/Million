"""Fælles Tjek/ShopGun tilbudsavis-scraper for discount-butikker."""
import os
import re
import sys
from datetime import datetime, timezone

import requests

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
from app_support import attach_billede_hashes

from avis_tekst import exact_unit_price, multi_buy, norm_unit, weight_text
from keywords import is_non_food as _is_non_food

TJEK_BASE = "https://squid-api.tjek.com"
KATEGORI = "Tilbudsavis"

_NON_FOOD_CATALOG = [
    'sommersk', 'skønhed', 'beauty', 'non-food', 'helse og pleje',
    'kæledyr', 'dyr og natur', 'dyremad', 'husholdning', 'rengøring',
    'personlig pleje', 'pleje', 'tøj', 'sko', 'sport', 'fritid',
    'elektronik', 'legetøj', 'blomster', 'have', 'haven', 'udendørs',
    'tekstil', 'sengetøj', 'køkkengrej', 'service og bestik',
]


def is_food(heading: str, catalog_label: str | None) -> bool:
    label = (catalog_label or "").lower()
    if any(p in label for p in _NON_FOOD_CATALOG):
        return False
    return not _is_non_food(heading)


# Multipakninger i avisteksten: "24x33 cl.", "6 x 0,5 l", "3 X 200 G".
# SKAL prøves før enkeltvægt-regexet nedenfor, som ellers finder "33 cl" inde i
# "24x33 cl" og dermed angiver en 7,92-liters kasse som en enkelt dåse. Vægt-
# gaten sammenlignede så 330 g mod en anden butiks 7920 g og afviste et korrekt
# match - eller værre, accepterede en enkeltdåse som samme vare som kassen.
# Formatet "N x V enhed" er præcis det app_support._MULTIPACK_RE forstår, så
# totalvægten beregnes korrekt derfra.
_MULTIPACK_DESC_RE = re.compile(
    r"(\d+)\s*[x×]\s*(\d+[.,]?\d*)\s*(kg|g|l|ml|cl|dl)\b", re.IGNORECASE)

# Variabel vægt ("105-150 g", "1,2-1,8 kg") - typisk fersk kød og fisk.
# Enkeltvægt-regexet nedenfor greb den ØVRE grænse og angav den som en præcis
# nettovægt. Med vægt-gatens tolerance på 8 % betyder det, at en butik der
# opgiver 105-150 g og en anden der opgiver 105-150 g kan ende med at blive
# sammenlignet som 150 g mod 105 g og afvist. Et interval er ikke en vægt, så
# feltet lades tomt og varen håndteres ad den vægtløse vej.
_WEIGHT_RANGE_RE = re.compile(
    r"\d+[.,]?\d*\s*-\s*\d+[.,]?\d*\s*(kg|g|l|ml|cl|dl)\b", re.IGNORECASE)


# "Pr. 1/2 kg" / "Pr. ½ kg": prisen gælder et halvt kilo. Enkeltvægt-regexet
# fandt "2 kg" i "1/2 kg", så en and til 59 kr pr. halve kilo stod som 2 kg
# til 59 kr (målt i Kvicklys avis 10-11-2026: fire varer).
_HALF_KG_RE = re.compile(r"(?:\b1\s*/\s*2|½)\s*kg\b", re.IGNORECASE)


def parse_description(description: str):
    """(tekst før vægten, vægt, kilopris) ud af avisens fritekst.

    Bruges kun når tilbuddet mangler Tjeks egne mængdefelter (quantity); se
    offer_fields. Teksten før vægten er IKKE et mærke og må ikke gemmes som
    producent (se _rows_from_offers)."""
    product_type = weight = kg_price = ""
    half = _HALF_KG_RE.search(description)
    if half:
        return description[:half.start()].strip().strip(",| -").strip(), "500 g", ""
    mm = _MULTIPACK_DESC_RE.search(description)
    rm = _WEIGHT_RANGE_RE.search(description)
    wm = re.search(r"(\d+[.,]?\d*)\s*(kg|g|l|ml|cl|dl|stk)", description, re.IGNORECASE)
    if rm and not mm:
        # Interval: ingen vægt, men varenavnet foran er stadig brugbart.
        product_type = description[:rm.start()].strip().strip(",| -").strip()
        wm = None
    if mm:
        weight = f"{mm.group(1)} x {mm.group(2)} {mm.group(3).lower()}"
        product_type = description[:mm.start()].strip().strip(",| -").strip()
    elif wm:
        weight = f"{wm.group(1)} {wm.group(2).lower()}"
        product_type = description[:wm.start()].strip().strip(",| -").strip()
    else:
        tm = re.search(r"^[^,\.]+", description)
        if tm:
            product_type = tm.group(0).strip()
    km = re.search(r"(\d+[.,]?\d*)\s*(?:kr\s*)?/\s*(kg|g|l|ml|cl|dl)", description, re.IGNORECASE)
    if km:
        kg_price = f"{km.group(1)} kr/{km.group(2)}"
    return product_type, weight, kg_price


def fetch_active_catalogs(dealer_id: str) -> list[dict]:
    r = requests.get(
        f"{TJEK_BASE}/v2/catalogs",
        params={"dealer_id": dealer_id, "limit": 50},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def running_now(catalogs: list[dict], now: datetime | None = None) -> list[dict]:
    """Kun aviser der gælder nu. Tjek viser også aviser, der først starter om
    et par dage: lørdag 24-10-2026 stod Coops "Søndag & Mandag"-avis allerede
    på listen, og om onsdagen stod næste uges avis side om side med denne
    uges, så siden viste fremtidige priser (og dedupe valgte tilfældigt
    mellem to ugers pris for samme vare). Avisen starter ved dansk midnat, og
    morgenens hentning kører efter, så avisen er med samme morgen."""
    now = now or datetime.now(timezone.utc)
    out = []
    for cat in catalogs:
        try:
            start = datetime.strptime(cat["run_from"], "%Y-%m-%dT%H:%M:%S%z")
            slut = datetime.strptime(cat["run_till"], "%Y-%m-%dT%H:%M:%S%z")
        except (KeyError, TypeError, ValueError):
            out.append(cat)  # ukendt periode: som før
            continue
        if start <= now <= slut:
            out.append(cat)
        else:
            print(f"    Springer over (gælder ikke nu): {cat.get('label')} "
                  f"{cat['run_from'][:10]} til {cat['run_till'][:10]}")
    return out


def fetch_all_offers(catalog_id: str) -> list[dict]:
    offers = []
    offset = 0
    limit = 100
    while True:
        r = requests.get(
            f"{TJEK_BASE}/v2/offers",
            params={"catalog_id": catalog_id, "limit": limit, "offset": offset},
            timeout=15,
        )
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        offers.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return offers


# ── Mængde, pris og multikøb ud af Tjeks egne felter ─────────────────────────
#
# Hvert tilbud har et struktureret mængdefelt ved siden af friteksten:
#   quantity.unit.symbol  g / kg / ml / cl / l / pcs
#   quantity.size         {from, to}   størrelsen pr. stk. (eller i alt)
#   quantity.pieces       {from, to}   antal stk. prisen dækker
# Det er langt sikrere end at lede efter et tal i teksten. Målt 11-11-2026 mod
# de fire Coop-avisers 930 tilbud havde alle feltet, og friteksten tog fejl på:
#   "Kg-pris 218,00. Pr. 1/2 kg"        -> "2 kg"       (feltet siger 0,5 kg)
#   "15-pak / 18-pak / 15-18 x 33 cl"   -> "18 x 33 cl" (feltet siger 15-18 stk.)
#   "Sælges i hele forpakninger / 15-pak / 18-pak ... 33 cl" -> "33 cl"
# Friteksten bruges stadig til det feltet ikke siger: om "N x" er et antal
# pakker eller indholdet af én pakke, og avisens egen kilopris.

_WEIGHT_UNITS = frozenset({'g', 'kg', 'ml', 'cl', 'dl', 'l'})

# Enhedspris i teksten: "Kg-pris", "Literpris", "Ltr-pris", "Stk.-pris",
# "Bdt-pris", "Mtr-pris", "Pris pr. vask".
_UNIT_PRICE_RE = re.compile(
    r"(?<![a-zæøå])(?:kg|liter|ltr|l|stk|bdt|mtr|m)\.?\s*-?\s*pris|\bpris\s+pr\.", re.IGNORECASE)

# "4 x 105-375 g", "15-18 x 33 cl": antallet ganges på størrelsen. Uden "x" er
# antallet indholdet af én pakke ("1000 g. / 4-6 stk." = 4-6 bøffer i et kilo).
_TIMES_RE = re.compile(r"(?<![\d,.])\d{1,3}(?:\s*-\s*\d{1,3})?\s*[x×]\s*\d", re.IGNORECASE)

# En ramme sodavand eller en kasse øl er ÉN vare, ikke et multikøb.
_PACK_SIGNAL_RE = re.compile(r"hele forpakninger|\bkasse\b|\bramme\b", re.IGNORECASE)
_COUNT_WORDS = "stk|flasker|dåser|pakker|poser|bakker|glas|æsker|bægre|plader|bøtter|ruller|bundter|net"


def _quantity(o: dict) -> tuple[str | None, float | None, float | None, int, int]:
    """(enhed, størrelse fra, størrelse til, antal fra, antal til)."""
    q = o.get("quantity") or {}
    unit = norm_unit((q.get("unit") or {}).get("symbol"))
    size = q.get("size") or {}
    pieces = q.get("pieces") or {}

    def _int(value) -> int | None:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    p_lo = _int(pieces.get("from")) or _int(pieces.get("to")) or 1
    p_hi = _int(pieces.get("to")) or p_lo
    return unit, size.get("from"), size.get("to"), min(p_lo, p_hi), max(p_lo, p_hi)


def has_grocery_signal(o: dict) -> bool:
    """Har tilbuddet en vægt, et rumfang eller en enhedspris?

    Dagligvarer i avisen har altid mindst én af delene (enhedsprisen skal
    oplyses). Et tilbud uden er noget andet: køkkenmaskiner, tøj, julepynt,
    skrabelodder og mad ud af huset ("Nytårsmenu pr. kuvert"). Målt 11-11-2026
    mod Kvickly, SuperBrugsen, Brugsen og 365discount fjernede reglen kun
    rækker, som navnelisten i keywords.py havde lukket ind (mikroovn,
    saunatæppe, julepyjamas, lametta, Quick-skrabekalender og menuer til
    levering), og ingen vare med vægt eller enhedspris.
    """
    return _quantity(o)[0] in _WEIGHT_UNITS or bool(
        _UNIT_PRICE_RE.search(o.get("description") or ""))


def _multi_buy_count(heading: str, desc: str, p_lo: int, p_hi: int) -> int | None:
    """Antal i et ægte multikøb ("6 flasker 399,-"), ellers None.

    Tjek angiver både "24 x 33 cl" (én ramme) og "6 flasker for 399" som
    pieces > 1. Kun når avisen selv tæller i stk. (antallet efterfulgt af
    "flasker", "pakker", "stk." ... eller "ved køb af N"), og det ikke er en
    hel forpakning, er prisen for N enkeltvarer.
    """
    if p_lo != p_hi or p_lo < 2:
        return None
    n = p_lo
    text = f"{heading} {desc}"
    if _PACK_SIGNAL_RE.search(text) or re.search(rf"(?<!\d){n}\s*-?\s*pak\b", text, re.IGNORECASE):
        return None
    if re.search(rf"ved køb af {n}\b", desc, re.IGNORECASE):
        return n
    if re.search(rf"(?<![\d,.\-])(?<![x×]\s){n}\s+(?:{_COUNT_WORDS})\b", desc, re.IGNORECASE):
        return n
    return None


def offer_fields(o: dict) -> dict:
    """Vægt, kilopris, pris, førpris og multikøb for ét Tjek-tilbud."""
    heading = o.get("heading") or ""
    desc = o.get("description") or ""
    pricing = o.get("pricing") or {}
    pris = pricing.get("price")
    pre_price = pricing.get("pre_price")
    pris = float(pris) if pris is not None else None
    pre_price = float(pre_price) if pre_price is not None else None

    unit, s_lo, s_hi, p_lo, p_hi = _quantity(o)
    n_multi = _multi_buy_count(heading, desc, p_lo, p_hi) if pris else None

    weight = None
    if unit in _WEIGHT_UNITS and (s_lo or s_hi):
        times = p_lo > 1 and not n_multi and bool(_TIMES_RE.search(desc))
        weight = weight_text(s_lo, s_hi, unit, p_lo if times else 1, p_hi if times else 1)
    elif unit == "stk":
        if max(s_lo or 0, s_hi or 0) > 1:
            weight = weight_text(s_lo, s_hi, "stk")       # "10 stk", "16-20 stk"
        elif p_lo == p_hi and p_lo > 1 and not n_multi:
            weight = f"{p_lo} stk"
    if weight is None and unit not in _WEIGHT_UNITS:
        # Mængdefeltet siger ingenting (1 stk.): brug teksten som før.
        weight = parse_description(desc)[1] or None

    # Kiloprisen kun når vægten er ét tal; ved et interval er avisens tal en
    # yderværdi ("maks.") og ikke varens kilopris.
    kg_price = None if weight and "-" in weight else exact_unit_price(desc)

    multikob = None
    if n_multi:
        total = pris
        pris, multikob = multi_buy(total, n_multi)
        if pre_price is not None:
            pre_price = round(pre_price / n_multi, 2)

    return {"netto_vaegt": weight, "kg_price": kg_price, "pris": pris,
            "normalpris": pre_price, "multikob": multikob}


def _rows_from_offers(
    offers: list[dict],
    cat_id: str,
    label: str,
    butik: str,
    seen: set[str],
    *,
    dedupe_by_heading: bool = False,
    require_signal: bool = True,
) -> list[dict]:
    rows: list[dict] = []
    for o in offers:
        # Stjernen er avisens fodnote ("*Føres ikke i alle butikker"), ikke
        # en del af navnet.
        heading = (o.get("heading") or "").strip().rstrip("*").strip()
        if not heading:
            continue
        if not is_food(heading, label):
            continue
        if require_signal and not has_grocery_signal(o):
            continue
        key = heading if dedupe_by_heading else f"{cat_id}|{heading}"
        if key in seen:
            continue
        seen.add(key)

        img = o.get("images", {})
        billede_url = img.get("view") or img.get("thumb") or ""

        rows.append({
            "butik":        butik,
            "kategori":     KATEGORI,
            "navn":         heading,
            # Teksten før vægten i avisens fritekst blev tidligere gemt her
            # og vist som varens mærke: "Flere varianter", "Dybfrost",
            # "Danmark, kl. I.", "Stk.-pris 45,00.". Avisen har intet
            # mærkefelt; mærket står i navnet, og dér finder matchingen det.
            "producent":    None,
            **offer_fields(o),
            "varenummer":   None,
            "billede_url":  billede_url,
            "billede_hash": None,
            "tilbud":       "Ja",
        })
    attach_billede_hashes(rows)
    return rows


# Under denne andel tilbud med vægt eller enhedspris er det avisens format,
# der er ændret, ikke varerne: så slås reglen fra i den kørsel i stedet for at
# smide en hel butiks madvarer væk. Målt 11-11-2026: Kvickly 61 %, SuperBrugsen
# 89 %, Brugsen 100 %, 365discount 88 %.
_MIN_SIGNAL_SHARE = 0.30


def _signal_healthy(butik: str, catalogs: list[tuple[dict, list[dict]]]) -> bool:
    food = [o for cat, offers in catalogs for o in offers
            if o.get("heading") and is_food(o["heading"], cat.get("label"))]
    if not food:
        return True
    share = sum(1 for o in food if has_grocery_signal(o)) / len(food)
    if share < _MIN_SIGNAL_SHARE:
        print(f"  ⚠ {butik}: kun {share:.0%} af tilbuddene har vægt eller enhedspris - "
              f"avisens format ser ændret ud, så ikke-mad-reglen er slået fra i denne kørsel")
        return False
    return True


def rows_from_catalogs(
    butik: str,
    catalogs: list[tuple[dict, list[dict]]],
    *,
    dedupe_by_heading: bool = False,
) -> list[dict]:
    """Rækkerne for én butiks aviser: liste af (katalog, tilbud)."""
    require_signal = _signal_healthy(butik, catalogs)
    rows: list[dict] = []
    seen: set[str] = set()
    for cat, offers in catalogs:
        rows.extend(_rows_from_offers(
            offers, cat["id"], cat.get("label", cat["id"]), butik, seen,
            dedupe_by_heading=dedupe_by_heading, require_signal=require_signal,
        ))
    return rows


def assert_catalogs_healthy(butik: str, n_catalogs: int, tomme: list[str]) -> None:
    """Sundhedskontrol for en tilbudsavis-scraping. Raiser ved ægte fejl.

    Se fetch_tjek_tilbud for hvorfor totalantallet ikke duer som sundhedsmål.
    (365discount havde før sin egen kopi af catalog-løkken og kaldte denne
    funktion udefra; nu bruger den fetch_tjek_tilbud som de andre.)
    """
    if not n_catalogs:
        raise RuntimeError(
            f"{butik}: ingen aktive kataloger fundet i Tjek API - gemmer IKKE. "
            f"Butikkens eksisterende data må ikke erstattes af ingenting."
        )
    if tomme:
        raise RuntimeError(
            f"{butik}: {len(tomme)} af {n_catalogs} aktive kataloger gav NUL "
            f"tilbud ({', '.join(tomme)}) - gemmer IKKE. Det er signaturen på en "
            f"ægte hentefejl, modsat et normalt avis-skifte hvor antallet falder "
            f"proportionalt med antallet af aviser."
        )


def fetch_tjek_tilbud(
    dealer_id: str,
    butik: str,
    *,
    dedupe_by_heading: bool = False,
) -> list[dict]:
    """Hent alle aktive tilbudsaviser for én butik.

    SUNDHEDSKONTROLLEN LIGGER HER, ikke i totalantallet. Antallet af aktive
    aviser svinger legitimt (Netto er målt med 4, 3 og 2 aviser på fire nætter;
    Lidl med 4 og 2), og med det svinger tilbudsantallet proportionalt. Det
    generiske shrink-værn i supabase_utils.py sammenligner mod butikkens
    eksisterende rækker og læste derfor et helt normalt avis-skifte som en
    scraping-fejl:

        Netto        192 nye mod 386 eksisterende  -> blokeret 2 nætter
        Lidl         323 nye mod 698 eksisterende  -> blokeret
        365discount  126 nye mod 259 eksisterende  -> blokeret 4+ nætter

    Værre: blokeringen er selvforstærkende. Skrivningen afvises, så
    ``existing`` bliver aldrig mindre, så næste nat afvises igen med samme tal.
    365discount sad fast med præcis 126-127 mod 259 fire nætter i træk og kunne
    aldrig komme fri ved egen kraft. Imens viste sitet udløbne tilbud som
    aktuelle - stik imod det værnet skulle beskytte mod.

    Den fejl værnet ER til for (ændret markup, API der stille returnerer
    delvise data) ser anderledes ud: den rammer *pr. avis*. Derfor kontrolleres
    hver enkelt avis her, hvor vi kender dem, og totalantallet får lov at følge
    med antallet af aviser.
    """
    catalogs = running_now(fetch_active_catalogs(dealer_id))
    print(f"  Fandt {len(catalogs)} aktive {butik}-kataloger")

    fetched: list[tuple[dict, list[dict]]] = []
    tomme: list[str] = []
    for cat in catalogs:
        label = cat.get("label", cat["id"])
        run_till = cat.get("run_till", "")[:10]
        offers = fetch_all_offers(cat["id"])
        print(f"    {label} ({run_till}): {len(offers)} tilbud")
        # Nogle kataloger er permanente kampagne-brochurer uden strukturerede
        # tilbud - Tjek selv oplyser offer_count=0 for dem i katalog-metadata.
        # Kun et katalog der SELV haevder at have tilbud, men ikke leverer
        # nogen ved hentning, er den aegte fejlsignatur.
        if not offers and cat.get("offer_count", 0) > 0:
            tomme.append(f"{label} ({run_till})")
        fetched.append((cat, offers))

    assert_catalogs_healthy(butik, len(catalogs), tomme)

    rows = rows_from_catalogs(butik, fetched, dedupe_by_heading=dedupe_by_heading)
    print(f"  OK: {len(rows)} {butik}-tilbud hentet fra Tjek API "
          f"({len(catalogs)} kataloger, alle med indhold)")
    return rows
