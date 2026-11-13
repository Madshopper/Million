"""Fælles regler for tekst og tal i tilbudsaviserne (Løvbjerg, ABC Lavpris og
Coop-aviserne via Tjek).

Hver avis-scraper havde sin egen læsning af vægt, pakker og multikøb, og de
tog fejl på hver sin måde (målt 10-11-2026 mod ugens aviser):

  - En kasse øl stod som én dåse: "33 cl/24 ds" og "24x33 cl" blev til "33 cl",
    så kassen til 69,99 kr lignede en dåse til 69,99 kr.
  - "Ta' 3 bakker 100,-" stod som 100 kr for én bakke, og kurven regnede tre
    bakker til 300 kr.
  - Kød "pr. 1/2 kg" stod som "2 kg" (tallet efter skråstregen).
  - "Frikadelle- el. kyllingeplatte" blev til "Frikadelleel. kyllingeplatte".

Reglerne ligger her, så de kun findes ét sted.
"""
import re

# Orddeling ved linjeskift ("stege/bage- margarine" -> "bagemargarine") skal
# samles, men en bindestreg der venter på næste led ("Frikadelle- el.
# kyllingeplatte", "kød- og melboller") skal blive stående.
_LINEBREAK_HYPHEN_RE = re.compile(r'(\w)- (?!(?:og|el|eller|samt)\b)(\w)', re.IGNORECASE)


def join_linebreak_hyphens(name: str) -> str:
    return _LINEBREAK_HYPHEN_RE.sub(r'\1\2', name or '')


_UNITS = {
    'g': 'g', 'gr': 'g', 'gram': 'g', 'kg': 'kg',
    'ml': 'ml', 'cl': 'cl', 'dl': 'dl',
    'l': 'l', 'ltr': 'l', 'liter': 'l', 'litre': 'l',
    'stk': 'stk', 'pcs': 'stk',
}


def norm_unit(unit: str | None) -> str | None:
    return _UNITS.get(str(unit or '').strip().lower().rstrip('.'))


def to_number(text) -> float | None:
    try:
        return float(str(text).replace(' ', '').replace(',', '.'))
    except (TypeError, ValueError):
        return None


def fmt_amount(value: float) -> str:
    """4.0 -> "4", 27.5 -> "27,5" (dansk komma; app_support forstår begge)."""
    value = round(float(value), 3)
    if value == int(value):
        return str(int(value))
    return f"{value:.3f}".rstrip('0').rstrip('.').replace('.', ',')


def weight_text(size_min, size_max, unit, count_min=1, count_max=1) -> str | None:
    """Vægtfeltet som tekst: "500 g", "850-900 g", "24 x 33 cl", "15-18 x 33 cl".

    "N x V enhed" er præcis det app_support.parse_weight_to_grams forstår som
    en multipak (samlet vægt = antal x enhed). Et interval kan ikke blive til
    ét tal, så det gemmes som tekst: parse_weight_to_grams giver ingen vægt
    for det, så vægt-gaten dømmer ikke (de andre gates gør), og kunden kan se
    hvad prisen dækker.
    """
    unit = norm_unit(unit)
    lo, hi = to_number(size_min), to_number(size_max)
    if lo is None and hi is None or not unit:
        return None
    lo = hi if lo is None else lo
    hi = lo if hi is None else hi
    if lo <= 0 or hi <= 0:
        return None
    lo, hi = min(lo, hi), max(lo, hi)
    if unit == 'kg' and hi < 1:
        lo, hi, unit = lo * 1000, hi * 1000, 'g'   # "0,5 kg" -> "500 g"
    size = fmt_amount(lo) if lo == hi else f"{fmt_amount(lo)}-{fmt_amount(hi)}"
    try:
        c_lo, c_hi = int(count_min or 1), int(count_max or count_min or 1)
    except (TypeError, ValueError):
        c_lo = c_hi = 1
    c_lo, c_hi = min(c_lo, c_hi), max(c_lo, c_hi)
    if c_hi <= 1:
        return f"{size} {unit}"
    count = str(c_lo) if c_lo == c_hi else f"{c_lo}-{c_hi}"
    return f"{count} x {size} {unit}"


# "33 cl/24 ds", "33 cl/30 fl", "33 cl/18/20/24 ds" (Løvbjerg).
_CRATE_RE = re.compile(
    r'(\d+(?:[.,]\d+)?)\s*(cl|ml|dl|ltr|l)\s*/\s*(\d+(?:\s*/\s*\d+)*)\s*(?:ds|fl|dåser|flasker|stk)\b',
    re.IGNORECASE)
_LITRES = {'ml': 0.001, 'cl': 0.01, 'dl': 0.1, 'l': 1.0}


def crate_weight(text: str) -> str | None:
    """En kasse som vægtfelt: "33 cl/24 ds" -> "24 x 33 cl".

    Flere antal ("33 cl/18/20/24 ds") bliver et interval af antal. Flere
    størrelser i samme tilbud ("25 cl/24 fl, 33 cl/12 ds el. 50 cl/8 ds")
    bliver kassernes samlede rumfang som interval ("3,96-6 l").
    """
    specs = []
    for m in _CRATE_RE.finditer(text or ''):
        size, unit = to_number(m.group(1)), norm_unit(m.group(2))
        counts = [int(c) for c in re.split(r'\s*/\s*', m.group(3)) if c.strip().isdigit()]
        if size and unit in _LITRES and counts:
            specs.append((size, unit, counts))
    if not specs:
        return None
    if len({(size, unit) for size, unit, _ in specs}) == 1:
        size, unit, _ = specs[0]
        counts = [c for _, _, cs in specs for c in cs]
        return weight_text(size, size, unit, min(counts), max(counts))
    totals = [size * _LITRES[unit] * c for size, unit, cs in specs for c in cs]
    return weight_text(min(totals), max(totals), 'l')


# "24x33 cl", "12-18x33 cl", "8x100 gram" (ABC Lavpris).
_MULTIPACK_RE = re.compile(
    r'(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|gram|gr|g|ltr|liter|l|cl|ml|dl)\b',
    re.IGNORECASE)
# "4 stk. I alt 124 gram", "12 donuts å 67 gram / i alt 804 gram".
_TOTAL_RE = re.compile(
    r'\bi\s+alt\s+(\d+(?:[.,]\d+)?)\s*(kg|gram|gr|g|ltr|liter|l|cl|ml|dl)\b', re.IGNORECASE)


def package_weight(text: str) -> str | None:
    """Hele pakkens størrelse, når avisen skriver den som en pakke.

    "i alt 804 gram" (12 donuts å 67 gram), "24x33 cl" og "12-18x33 cl" (en
    kasse øl), "8x100 gram" (bøffer) og "33 cl/24 ds". Den første vægt i
    teksten er her kun én dåse eller ét stykke. None når teksten ikke
    beskriver en pakke; så gælder den almindelige vægt.
    """
    t = text or ''
    m = _TOTAL_RE.search(t)
    if m:
        total = weight_text(m.group(1), m.group(1), m.group(2))
        if total:
            return total
    m = _MULTIPACK_RE.search(t)
    if m:
        lo = int(m.group(1))
        hi = int(m.group(2)) if m.group(2) else lo
        if 1 < lo <= hi:
            pack = weight_text(m.group(3), m.group(3), m.group(4), lo, hi)
            if pack:
                return pack
    return crate_weight(t)


_CM_RE = re.compile(r'\d\s*cm\b', re.IGNORECASE)
# En vægt, et rumfang eller en kilo-/literpris betyder mad.
_FOOD_UNIT_RE = re.compile(
    r'\d\s*(?:g|gr|gram|kg|ml|cl|dl|l|ltr|liter)\b|\bpr\.?\s*(?:kg|ltr|l)\b', re.IGNORECASE)


def looks_like_decoration(text: str) -> bool:
    """Mål i cm og hverken vægt eller rumfang: pynt, tøj og ting.

    Løvbjergs avis havde i uge 46 "Elf nisse" (H: 30 cm), "Julemand" (7,5-11
    cm) og "Juletræ til dekoration" (H: 15 cm), som navnefilteret ikke kan
    kende fra chokolade-julemænd og -juletræer. En madvare har en vægt eller
    en kilopris.
    """
    t = text or ''
    return bool(_CM_RE.search(t)) and not _FOOD_UNIT_RE.search(t)


# "Ta' 3 kasser", "Ta” 3 bakker", "Ta' 2 stk.", "Ta' 3 for": højst 20 stk.
MULTI_BUY_LABEL_RE = re.compile(r"\bTa\W{0,3}\s*(\d{1,2})\s*(?:stk|for|[a-zæøå]{3,})", re.IGNORECASE)


def multi_buy_count(label: str) -> int | None:
    """Antallet i "Ta' N ...", eller None. Før blev kun "Ta' N stk" og
    "Ta' N for" læst, så ABC's "Ta' 3 kasser 200,-" stod som 200 kr for én
    kasse."""
    m = MULTI_BUY_LABEL_RE.search(label or '')
    if not m:
        return None
    count = int(m.group(1))
    return count if 2 <= count <= 20 else None


def weight_from_unit_price(price: float, per_kg: float) -> str | None:
    """Vægten bag prisen, når avisen kun skriver kiloprisen.

    Kød "pr. ½ kg": Løvbjergs "Dansk ribbensteg 19,99" med "Pr kg 39,98" er
    et halvt kilo, men stod uden vægt og blev sammenlignet med hele stege.
    Kun et halvt eller helt kilo (±2 %); andre forhold er ikke sikre nok.
    """
    if not price or not per_kg or per_kg <= 0:
        return None
    ratio = price / per_kg
    for kg, text in ((0.5, '500 g'), (1.0, '1 kg')):
        if abs(ratio - kg) <= 0.02 * kg:
            return text
    return None


def multi_buy(total: float, count: int) -> tuple[float, str]:
    """(stykpris, tekst) for "tag N for X": samme form som Salling og Dagrofa
    leverer ("2 for 35,00 kr"), som kortet, kurven og appen i forvejen forstår
    (app_support._MULTI_DEAL_RE, script.js::parseMultiDeal).

    Stykprisen er totalen delt med antallet. Avisen oplyser ikke hvad én
    koster alene, så det er den pris kunden reelt betaler pr. stk. i tilbuddet.
    """
    count = int(count)
    total = float(total)
    unit_price = round(total / count, 2)
    amount = fmt_amount(total) if total == int(total) else f"{total:.2f}".replace('.', ',')
    return unit_price, f"{count} for {amount} kr"


# "Kg-pris 196,67", "Literpris 88,67 + pant", "Ltr-pris maks. 669,17".
# Kun kilo og liter: en stykpris er ikke en kilopris (se updater.parse_kg_price).
_UNIT_PRICE_VALUE_RE = re.compile(
    r'\b(kg|liter|ltr)\.?\s*-?\s*pris\s+(maks\.?\s+)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)',
    re.IGNORECASE)


def exact_unit_price(description: str) -> str | None:
    """Avisens egen kilo- eller literpris som "196.67 kr/kg" / "88.67 kr/l".

    "maks." er den højeste kilopris blandt flere varianter (typisk den mindste
    pakke). Den er ikke varens kilopris og springes over, så den hverken vises som en
    præcis kilopris eller snyder kg-pris-gaten i matchingen.
    """
    m = _UNIT_PRICE_VALUE_RE.search(description or '')
    if not m or m.group(2):
        return None
    value = to_number(m.group(3).replace('.', ''))
    if not value or value <= 0:
        return None
    unit = 'kg' if m.group(1).lower() == 'kg' else 'l'
    return f"{value:.2f} kr/{unit}"
