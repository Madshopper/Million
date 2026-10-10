"""
Løvbjerg ugens tilbudsavis fra lovbjerg.dk's egen PDF.

Avis-siden (https://www.lovbjerg.dk/avis/denne-uges-avis) linker ugens avis som
PDF på lovbjerg.dk. PDF'en har et rigtigt tekstlag, så varerne læses ud fra
tekstens placering og skriftstørrelse:
  - navnet står med fed skrift (ca. 9-11 pt), og linjerne under med almindelig
    skrift (varianter, vægt og "Pr kg max ...");
  - prisen er de store tal (kroner ca. 88-115 pt, øre ca. halvt så store);
  - hver vare får den pris, der passer bedst efter placering (ved siden af
    eller under teksten), og hver pris bruges kun én gang.
Målt mod Tjek-versionen af uge 42: alle 129 varer, der står i PDF'en, fik
samme navn og pris.

Erstatter den tidligere Tjek-baserede scraper: Tjek (eTilbudsavis) bad os
09-10-2026 skriftligt om at stoppe brugen af deres API og billedservere.
Varebillederne klippes ud af PDF'en (det indlejrede foto nærmest over prisen i
samme spalte) og gemmes i Supabase Storage, se store_images.
"""
import io
import os
import re
import sys

import pdfplumber
import requests
from pdfminer.pdftypes import resolve1
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from keywords import is_non_food
from avis_billeder import cleanup_images, store_images
from supabase_utils import save_product_dicts

AVIS_URL = "https://www.lovbjerg.dk/avis/denne-uges-avis"
BUTIK = "Løvbjerg"
KATEGORI = "Tilbudsavis"

# Mappe i avis-billeder-bucket'en (scraper/avis_billeder.py).
IMAGE_PREFIX = "loevbjerg"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "da,da-DK;q=0.9",
}

_PDF_RE = re.compile(r'https://www\.lovbjerg\.dk/files/pdf/[^"\'\s]+\.pdf')
_PRICE_WORD_RE = re.compile(r'\d{1,4}[.,]?-?')
_WEIGHT_RE = re.compile(r'(\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)?)\s*(kg|g|ltr|l|cl|ml|stk)\b', re.I)
_KG_PRICE_RE = re.compile(r'Pr\.?\s*(kg|ltr|l|stk)\s*(?:max\s*)?(\d+(?:\.\d{3})*,(?:\d{2}|-))', re.I)
_MULTI_RE = re.compile(r'Ta.?\s*(\d+)\s*(?:stk|for)', re.I)
_ORE_PRICE_RE = re.compile(r'(\d+),(\d{2})$')


def find_pdf_url() -> str:
    r = requests.get(AVIS_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    m = _PDF_RE.search(r.text)
    if not m:
        raise RuntimeError(f"Ingen avis-PDF fundet på {AVIS_URL}")
    return m.group(0)


def _segments(words: list[dict]) -> list[dict]:
    """Ord -> linjestykker: samme højde, størrelse og vægt, delt ved store mellemrum
    (to spalter kan stå på samme linje)."""
    rows: dict = {}
    for w in words:
        key = (round(w['top']), round(w['size'], 1), 'Heavy' in w['fontname'])
        rows.setdefault(key, []).append(w)
    segs = []
    for (_top, size, heavy), ws in rows.items():
        ws.sort(key=lambda w: w['x0'])
        cur = [ws[0]]
        for w in ws[1:]:
            if w['x0'] - cur[-1]['x1'] > max(12, size * 1.6):
                segs.append((cur, size, heavy))
                cur = [w]
            else:
                cur.append(w)
        segs.append((cur, size, heavy))
    return [{'x0': s[0]['x0'], 'x1': s[-1]['x1'],
             'top': min(w['top'] for w in s), 'bottom': max(w['bottom'] for w in s),
             'size': size, 'heavy': heavy, 'text': ' '.join(w['text'] for w in s)}
            for s, size, heavy in segs]


def _prices(words: list[dict]) -> list[dict]:
    """Store kronetal + øretal ved siden af (mindre, øverst til højre)."""
    big = [w for w in words if w['size'] >= 35 and _PRICE_WORD_RE.fullmatch(w['text'])]
    used: set[int] = set()
    out = []
    for k in big:
        if id(k) in used:
            continue
        ore = next((o for o in big if o is not k and id(o) not in used
                    and 0.3 * k['size'] <= o['size'] <= 0.65 * k['size']
                    and -10 <= o['x0'] - k['x1'] <= k['size'] * 0.5
                    and abs(o['top'] - k['top']) <= k['size'] * 0.35
                    and len(o['text']) == 2), None)
        if ore is None and any(b is not k and b['size'] > k['size'] * 1.4
                               and abs(b['top'] - k['top']) < b['size'] * 0.4
                               and 0 < k['x0'] - b['x1'] < b['size'] for b in big):
            continue  # k er selv øretallet til en større pris
        used.add(id(k))
        if ore is not None:
            used.add(id(ore))
        value = float(re.sub(r'\D', '', k['text'])) + (float(ore['text']) / 100 if ore else 0)
        out.append({'x0': k['x0'], 'x1': (ore or k)['x1'], 'top': k['top'],
                    'bottom': k['bottom'], 'price': round(value, 2)})
    return out


def _aligned(s: dict, cur: dict) -> bool:
    """Venstre-, midt- eller højrestillet under hinanden."""
    return (abs(s['x0'] - cur['x0']) < 3
            or abs((s['x0'] + s['x1']) / 2 - (cur['x0'] + cur['x1']) / 2) < 4
            or abs(s['x1'] - cur['x1']) < 3)


def _is_text(s: dict) -> bool:
    return 7 <= s['size'] <= 12.5 and not re.match(r'(max\b|herefter|pr stk$)', s['text'], re.I)


def _blocks(segs: list[dict]) -> list[dict]:
    """Varetekster: fed navnelinje(r) efterfulgt af almindelige linjer."""
    texts = [s for s in segs if _is_text(s)]
    out = []
    for s0 in texts:
        if not s0['heavy'] or s0['size'] < 8.5:
            continue
        if any(t is not s0 and t['heavy'] and -1 < s0['top'] - t['bottom'] < 9 and _aligned(t, s0)
               for t in texts):
            continue  # ikke toppen af en tekstgruppe
        lines = [s0]
        cur = s0
        while True:
            cand = [t for t in texts if t is not cur and -1 < t['top'] - cur['bottom'] < 9 and _aligned(t, cur)]
            if not cand:
                break
            cur = min(cand, key=lambda t: t['top'])
            if cur['heavy'] and not lines[-1]['heavy']:
                break  # næste vares navn
            lines.append(cur)
        name = ' '.join(l['text'] for l in lines if l['heavy'])
        if not re.search(r'[A-Za-zÆØÅæøå]{2}', name):
            continue  # sidetal o.l.
        out.append({'x0': min(l['x0'] for l in lines), 'x1': max(l['x1'] for l in lines),
                    'top': s0['top'], 'bottom': lines[-1]['bottom'], 'name': name,
                    'info': [l['text'] for l in lines if not l['heavy']]})
    return out


def _pair_cost(b: dict, p: dict) -> float | None:
    """Hvor godt en pris passer til en varetekst. Prisen står ved siden af
    teksten (samme højde) eller under den; over eller til venstre er sjældnere."""
    v_overlap = min(b['bottom'], p['bottom']) - max(b['top'], p['top'])
    h_overlap = min(b['x1'], p['x1']) - max(b['x0'], p['x0'])
    if v_overlap > 8:
        gap = p['x0'] - b['x1']
        if gap >= -15:
            return max(gap, 0) if gap < 200 else None
        gap = b['x0'] - p['x1']
        if gap >= -15:
            return 100 + max(gap, 0) if gap < 120 else None
        return None
    if h_overlap > -20:
        gap = p['top'] - b['bottom']
        if gap >= 0:
            return 50 + gap if gap < 260 else None
        gap = b['top'] - p['bottom']
        return 120 + gap if 0 <= gap < 120 else None
    return None


def _label_near(segs: list[dict], p: dict, pattern: re.Pattern) -> re.Match | None:
    """Mærkat lige over prisen, fx "Ta' 2 stk"."""
    for s in segs:
        if 12 <= s['size'] <= 30 and 0 <= p['top'] - s['bottom'] < 25 \
                and min(s['x1'], p['x1']) - max(s['x0'], p['x0']) > 0:
            m = pattern.search(s['text'])
            if m:
                return m
    return None


def _after_limit_price(segs: list[dict], p: dict) -> float | None:
    """"Max 6 stk herefter 18,99 pr stk" ved siden af prisen = normalprisen.
    "herefter op til" springes over, da den varierer mellem varianterne."""
    for s in segs:
        if s['text'].lower() != 'herefter':
            continue
        if not (p['top'] - 20 <= s['top'] <= p['bottom'] and -10 < p['x0'] - s['x1'] < 160):
            continue
        val = next((v for v in segs if 0 <= v['top'] - s['bottom'] < 6 and abs(v['x0'] - s['x0']) < 20
                    and _ORE_PRICE_RE.match(v['text'])), None)
        if val:
            m = _ORE_PRICE_RE.match(val['text'])
            return float(f"{m.group(1)}.{m.group(2)}")
    return None


def _decode_image(img: dict) -> Image.Image | None:
    """Indlejret JPEG + evt. gennemsigtighedsmaske -> billede på hvid baggrund."""
    stream = img['stream']
    if 'DCT' not in str(stream.get('Filter')):
        return None
    try:
        im = Image.open(io.BytesIO(stream.get_rawdata()))
        im.load()
        im = im.convert('RGB')
        smask = resolve1(stream.get('SMask'))
        if smask is not None:
            if 'DCT' in str(resolve1(smask.get('Filter'))):
                mask = Image.open(io.BytesIO(smask.get_rawdata())).convert('L')
            else:
                mask = Image.frombytes('L', (resolve1(smask.get('Width')), resolve1(smask.get('Height'))),
                                       smask.get_data())
            bg = Image.new('RGB', im.size, 'white')
            bg.paste(im, mask=mask.resize(im.size))
            im = bg
        return im
    except Exception:
        return None


def _is_backdrop(im: Image.Image) -> bool:
    """Mørke, ensfarvede flader (skiferplader bag kødet) er baggrund, ikke varen."""
    # Kun de synlige pixels tæller: masken gør alt uden om pladen hvidt.
    px = [v for v in im.convert('L').resize((32, 32)).getdata() if v < 235]
    if len(px) < 50:
        return False
    return sum(v < 70 for v in px) > 0.75 * len(px)


def _assign_images(page, tiles: list[dict]) -> dict[int, Image.Image]:
    """Varebilledet står over prisen eller mellem navn og pris i samme spalte.
    Hver vare får det nærmeste (og ved lighed største) billede, hvert billede
    bruges kun én gang."""
    area_max = page.width * page.height * 0.35
    imgs = [i for i in page.images
            if 'DCT' in str(i['stream'].get('Filter'))
            and i['x1'] - i['x0'] > 30 and i['bottom'] - i['top'] > 30
            and (i['x1'] - i['x0']) * (i['bottom'] - i['top']) < area_max]
    cands = []
    for ti, t in enumerate(tiles):
        for ii, i in enumerate(imgs):
            width = i['x1'] - i['x0']
            overlap = min(t['x1'], i['x1']) - max(t['x0'], i['x0'])
            # Billedet skal for det meste stå i varens spalte; et bredt foto
            # (en person, en stemningsflade) der blot rører spalten, er ikke varen.
            if overlap < 0.4 * min(width, t['x1'] - t['x0']) or overlap < 0.5 * width:
                continue
            area = width * (i['bottom'] - i['top'])
            if area > 2.5 * (t['x1'] - t['x0']) * (t['bottom'] - t['top']):
                continue
            if (i['top'] + i['bottom']) / 2 > t['bottom']:
                continue
            gap = max(0, t['top'] - i['bottom'])
            if gap <= 150:
                cands.append((gap, -area, ti, ii))
    cands.sort()
    out: dict[int, Image.Image] = {}
    used: set[int] = set()
    for _gap, _area, ti, ii in cands:
        if ii in used or ti in out:
            continue
        im = _decode_image(imgs[ii])
        if im is None or _is_backdrop(im):
            continue
        used.add(ii)
        out[ti] = im
    return out


def parse_pdf(data: bytes) -> list[dict]:
    items = []
    seen = set()
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            words = page.extract_words(extra_attrs=['size', 'fontname'])
            segs = _segments(words)
            prices = _prices(words)
            blocks = _blocks(segs)
            pairs = sorted((c, bi, pj) for bi, b in enumerate(blocks) for pj, p in enumerate(prices)
                           if (c := _pair_cost(b, p)) is not None)
            b_used, p_used = set(), set()
            page_items = []
            for _c, bi, pj in pairs:
                if bi in b_used or pj in p_used:
                    continue
                b_used.add(bi)
                p_used.add(pj)
                b, p = blocks[bi], prices[pj]
                multi = _label_near(segs, p, _MULTI_RE)
                page_items.append({
                    'name': b['name'], 'info': b['info'], 'price': p['price'],
                    'multikob': int(multi.group(1)) if multi else None,
                    'normalpris': _after_limit_price(segs, p),
                    'x0': min(b['x0'], p['x0']), 'x1': max(b['x1'], p['x1']),
                    'top': min(b['top'], p['top']), 'bottom': max(b['bottom'], p['bottom']),
                })
            images = _assign_images(page, page_items)
            for idx, it in enumerate(page_items):
                key = (it['name'], it['price'])
                if key in seen:
                    continue  # samme side findes i flere regionsudgaver
                seen.add(key)
                it['image'] = images.get(idx)
                items.append(it)
    return items


def build_row(item: dict) -> dict | None:
    name = re.sub(r'(\w)- (\w)', r'\1\2', item['name']).replace('’', "'")
    if is_non_food(name):
        return None
    info = ' | '.join(item['info'])
    weight_m = _WEIGHT_RE.search(info)
    kg_m = _KG_PRICE_RE.search(info)
    kg_price = None
    if kg_m:
        value = kg_m.group(2).replace('.', '').replace(',-', ',00').replace(',', '.')
        unit = 'l' if kg_m.group(1).lower() in ('l', 'ltr') else kg_m.group(1).lower()
        kg_price = f"{value} kr/{unit}"
    normalpris = item['normalpris'] if item['normalpris'] and item['normalpris'] > item['price'] else None
    if item['multikob']:
        normalpris = None  # "herefter"-prisen er stykpris, prisen er for flere
    return {
        "butik":        BUTIK,
        "kategori":     KATEGORI,
        "navn":         name,
        "producent":    None,
        "netto_vaegt":  f"{weight_m.group(1)} {weight_m.group(2).lower()}" if weight_m else None,
        "kg_price":     kg_price,
        "pris":         item['price'],
        "normalpris":   normalpris,
        "varenummer":   None,
        "billede_url":  "",
        "billede_hash": None,
        "tilbud":       "Ja",
        "multikob":     item['multikob'],
    }


def fetch_lovbjerg_tilbud() -> list[dict]:
    url = find_pdf_url()
    print(f"  Avis-PDF: {url}")
    r = requests.get(url, headers=_HEADERS, timeout=120)
    r.raise_for_status()
    items = parse_pdf(r.content)
    rows, pairs = [], []
    for it in items:
        row = build_row(it)
        if row is None:
            continue
        rows.append(row)
        if it.get("image") is not None:
            pairs.append((row, it["image"]))
    print(f"  {len(items)} varer læst i avisen, {len(rows)} madvarer, {len(pairs)} med billede")
    if len(rows) < 30:
        # En uge-avis har altid langt over 30 madtilbud; færre betyder at
        # layoutet er ændret og læsningen ikke længere virker.
        raise RuntimeError(f"Kun {len(rows)} varer læst fra Løvbjergs avis - layoutet er sandsynligvis ændret")
    store_images(pairs, IMAGE_PREFIX)
    return rows


def save_to_supabase(rows: list[dict]):
    # min_ratio=None: avisens størrelse svinger fra uge til uge; den ægte
    # fejl (layoutet ændret) fanges i fetch_lovbjerg_tilbud.
    save_product_dicts(BUTIK, rows, delete_neq_kategori="Katalog", min_ratio=None)


def main():
    print("Starter Løvbjerg scraper (avis-PDF fra lovbjerg.dk)...")
    rows = fetch_lovbjerg_tilbud()
    save_to_supabase(rows)
    cleanup_images(rows, IMAGE_PREFIX)
    print("\nFærdig!")


if __name__ == "__main__":
    main()
