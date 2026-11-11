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
    ét tal, så det gemmes som tekst: vægt-gaten bruger intervallets grænser
    (app_support.parse_weight_range), og kunden kan se hvad prisen dækker.
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

    "maks." betyder at prisen gælder den mindste af flere varianter. Den er
    ikke varens kilopris og springes over, så den hverken vises som en
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
