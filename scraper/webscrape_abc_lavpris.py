"""
ABC Lavpris ugens tilbud, læst direkte ud af avisen på abc-lavpris.dk.

Avisen findes kun som JPG-sider (én pr. butik, /butikker/<by>), så teksten
læses med OCR (tesseract, dansk). Erstatter den tidligere Tjek-baserede
scraper: Tjek (eTilbudsavis) bad os 09-10-2026 skriftligt om at stoppe brugen
af deres API og billedservere.

Layoutet er fast: hver vare står i et kort (hvidt, eller rødt med hvid kant),
og prisen står i en gul boks i kortet. Derfor:
  1. gule bokse = priser; det mindste kort uden om boksen = varen,
  2. navn og info (vægt, kg-pris) læses over boksen, prisen i boksen
     (stort kronebeløb + små ører, eller "10.-"),
  3. resten af kortet bliver varens billede.

De 16 butikkers aviser er næsten ens (Tjek havde 14 af 16 identiske), så kun
én butiks avis læses.
"""
import csv
import io
import os
import re
import shutil
import subprocess
import sys
import time

import numpy as np
import requests
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from avis_billeder import cleanup_images, store_images
from keywords import is_non_food
from supabase_utils import save_product_dicts

BASE_URL = "https://www.abc-lavpris.dk"
STORE_SLUG = "herning"
BUTIK = "ABC Lavpris"
KATEGORI = "Tilbudsavis"
IMAGE_PREFIX = "abc-lavpris"
PAGE_DELAY = 1.0

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "da,da-DK;q=0.9",
}

_PAGE_RE = re.compile(r"src:\s*'(/app/webroot/uploads/annoncer/[^'?]+\.jpg)")
_WEIGHT_RE = re.compile(r'(\d+(?:[.,]\d+)?(?:\s*[-/]\s*\d+(?:[.,]\d+)?)?)\s*(kg|gram|g|ltr|l|cl|ml|stk)\b\.?', re.I)
# OCR læser kommaet i små tal som punktum af og til ("Pr. kg 4.99").
_KG_PRICE_RE = re.compile(r'Pr\.?\s*(kg|ltr|l|stk)\.?\s*(?:max\.?\s*)?(\d+(?:[.,]\d{2}|,-))', re.I)
# Ikke-mad i ABC's avis, som keywords.py ikke kender (garn, bageforme, tøj).
_NON_FOOD_EXTRA_RE = re.compile(r'\b(garn|meter|muffinforme|bageforme|handsker|huer|sokker|best friend)\b', re.I)
_MULTI_RE = re.compile(r'Ta.?\s*(\d+)\s*(?:stk|for)', re.I)


# ── Billedanalyse ────────────────────────────────────────────────────────────

def _boxes(mask: np.ndarray, min_h: int, min_w: int) -> list[tuple[int, int, int, int]]:
    """Sammenhængende områder i masken som (x0, y0, x1, y1)."""
    lab, _ = ndi.label(mask)
    out = []
    for sl in ndi.find_objects(lab):
        if sl[0].stop - sl[0].start > min_h and sl[1].stop - sl[1].start > min_w:
            out.append((sl[1].start, sl[0].start, sl[1].stop, sl[0].stop))
    return out


def _tesseract(img: Image.Image, psm: int, whitelist: str | None = None) -> list[dict]:
    """Ord fra tesseract som dicts med text, conf, top, height og linjenøgle."""
    buf = io.BytesIO()
    img.save(buf, "PNG")
    cmd = ["tesseract", "stdin", "stdout", "-l", "dan", "--psm", str(psm)]
    if whitelist:
        cmd += ["-c", f"tessedit_char_whitelist={whitelist}"]
    out = subprocess.run(cmd + ["tsv"], input=buf.getvalue(), capture_output=True, check=True).stdout
    rows = csv.DictReader(io.StringIO(out.decode("utf-8")), delimiter="\t", quoting=csv.QUOTE_NONE)
    return [r for r in rows if (r.get("text") or "").strip() and float(r["conf"]) >= 0]


def _lines(words: list[dict]) -> list[dict]:
    lines: dict[tuple, list[dict]] = {}
    for w in words:
        lines.setdefault((w["block_num"], w["par_num"], w["line_num"]), []).append(w)
    out = []
    for ws in lines.values():
        out.append({
            "top": min(int(w["top"]) for w in ws),
            "height": max(int(w["height"]) for w in ws),
            "words": ws,
            "text": " ".join(w["text"] for w in ws),
        })
    return sorted(out, key=lambda line: line["top"])


def _binary(mask: np.ndarray, pad: int = 0) -> Image.Image:
    arr = np.where(mask, 0, 255).astype("uint8")
    if pad:
        arr = np.pad(arr, pad, constant_values=255)
    return Image.fromarray(arr)


def _read_digits(lab: np.ndarray, group: list) -> str:
    """Læs en gruppe cifre både samlet og ét ad gangen. Tesseract taber
    ofte smalle cifre ("11") samlet, men kan forveksle 0'et i "10.-" ét ad
    gangen, hvor punktum og streg hænger fast."""
    if not group:
        return ""
    ys = [s[0] for s, _ in group]
    xs = [s[1] for s, _ in group]
    y0, y1 = min(y.start for y in ys), max(y.stop for y in ys)
    x0, x1 = min(x.start for x in xs), max(x.stop for x in xs)
    img = _binary(np.isin(lab, [i for _, i in group])[y0:y1, x0:x1], pad=30)
    if img.height > 120:
        img = img.resize((max(1, int(img.width * 120 / img.height)), 120))
    whole = re.sub(r"\D", "", "".join(w["text"] for w in _tesseract(img, 7, "0123456789.-")))
    single = ""
    for s, i in sorted(group, key=lambda g: g[0][1].start):
        part = _binary(lab[s] == i, pad=max(lab[s].shape) // 3)
        part = part.resize((max(1, int(part.width * 100 / part.height)), 100))
        single += re.sub(r"\D", "", "".join(w["text"] for w in _tesseract(part, 10, "0123456789")))
    if len(whole) == len(single):
        return single
    return whole or single


def _read_price(rgb: np.ndarray, box: tuple) -> tuple[str, float | None]:
    """Etiketten ("Pr. pakke", "Ta' 10 stk.") over stregen og prisen under."""
    x0, y0, x1, y1 = box
    dark = rgb[y0:y1, x0:x1].sum(axis=2) < 200
    rule = np.where(dark.mean(axis=1) > 0.6)[0]
    split = int(rule[0]) if len(rule) else int((y1 - y0) * 0.3)
    label = " ".join(w["text"] for w in _tesseract(_binary(dark[:split], pad=10), 7))

    lab, _ = ndi.label(dark[split + 5:])
    objs = [(s, i + 1) for i, s in enumerate(ndi.find_objects(lab))
            if s is not None and s[0].stop - s[0].start > 8]
    if not objs:
        return label, None
    tallest = max(s[0].stop - s[0].start for s, _ in objs)
    big = [(s, i) for s, i in objs if s[0].stop - s[0].start > 0.6 * tallest]
    first_x = min(s[1].start for s, _ in big)
    # Ørerne står hævet og mindre til højre for kronerne; "." og "-" i "10.-"
    # er lave og ligger nederst, så de skal ikke med.
    top = min(s[0].start for s, _ in big)
    small = [(s, i) for s, i in objs
             if s[0].stop - s[0].start <= 0.6 * tallest and s[1].start > first_x
             and s[0].start < top + 0.25 * tallest and s[0].stop - s[0].start > 0.25 * tallest]
    kroner = _read_digits(lab, big)
    oere = _read_digits(lab, small)
    if not kroner:
        return label, None
    if len(oere) != 2:
        oere = "00"
    return label, float(f"{int(kroner)}.{oere}")


def _text_mask(region: np.ndarray) -> np.ndarray:
    """Mørk tekst på hvidt kort, eller hvid tekst på rødt kort."""
    if region.reshape(-1, 3).mean(axis=0)[1] > 150:
        return region.sum(axis=2) < 300
    return region.min(axis=2) > 200


def _read_text(region: np.ndarray) -> tuple[str, list[str], list[tuple]]:
    """Navn (de største linjer øverst) og infolinjer under det. Returnerer også
    linjernes felter (x0, y0, x1, y1), så teksten ikke tages for at være varen."""
    lines = []
    for line in _lines(_tesseract(_binary(_text_mask(region)), 11)):
        # Navnet står altid øverst i kortet. Et varefoto tæt på teksten kan
        # sænke tesseracts sikkerhed på hele linjen, så i den øverste linje
        # godtages rene ord ved lavere sikkerhed; ellers kun sikre ord.
        at_top = line["top"] < 45
        words = [w for w in line["words"] if float(w["conf"]) >= 50
                 or (at_top and float(w["conf"]) >= 20
                     and re.fullmatch(r"[A-Za-zÆØÅæøåÉé'’,.-]{3,}", w["text"]))]
        text = " ".join(w["text"] for w in words).strip(" |—-=_")
        letters = sum(ch.isalpha() for ch in text)
        if len(text) < 2 or letters < 0.5 * len(text.replace(" ", "")):
            if not re.search(r"\d", text):
                continue
        lines.append((line["top"], line["height"], text, (
            min(int(w["left"]) for w in words), line["top"],
            max(int(w["left"]) + int(w["width"]) for w in words), line["top"] + line["height"])))
    first = next((k for k, (_, _, t, _) in enumerate(lines) if sum(c.isalpha() for c in t) >= 3), None)
    if first is None:
        return "", [], []
    # Navnet er den første linje med bogstaver plus de følgende linjer i samme
    # skriftstørrelse lige under den; resten er info (vægt, kg-pris, varianter).
    name_h = lines[first][1]
    name, info, spans = [lines[first][2]], [], [lines[first][3]]
    prev_bottom = lines[first][0] + name_h
    for top, h, text, bbox in lines[first + 1:]:
        if not info and 0.75 * name_h <= h <= 1.4 * name_h and top - prev_bottom < name_h \
                and sum(c.isalpha() for c in text) >= 3:
            name.append(text)
            prev_bottom = top + h
        else:
            info.append(text)
        spans.append(bbox)
    # Tesseract sætter af og til navn og kg-pris på samme linje.
    name_text, _, rest = re.sub(r"\s+(?=(Pr\.|Flere varianter))", "\n", " ".join(name), count=1).partition("\n")
    if rest:
        info.insert(0, rest)
    return name_text, info, spans


def _product_image(rgb: np.ndarray, card: tuple, box: tuple, spans: list) -> Image.Image | None:
    """Det største sammenhængende motiv i kortet, når prisboks og tekst er
    trukket fra; beskåret fra det originale kort."""
    cx0, cy0, cx1, cy1 = card
    crop = rgb[cy0:cy1, cx0:cx1].copy()
    red = (np.abs(crop[..., 0] - 190) < 30) & (crop[..., 1] < 90) & (crop[..., 2] < 90)
    crop[red] = 255
    bx0, by0, bx1, by1 = box
    crop[max(0, by0 - cy0):by1 - cy0, max(0, bx0 - cx0):bx1 - cx0] = 255
    content = crop.min(axis=2) < 225
    for x0, y0, x1, y1 in spans:
        content[max(0, y0 - 6):y1 + 6, max(0, x0 - 6):x1 + 6] = False
    content[:6, :] = content[-6:, :] = False
    content[:, :6] = content[:, -6:] = False
    lab, n = ndi.label(ndi.binary_closing(content, iterations=12))
    if not n:
        return None
    sizes = ndi.sum(content, lab, range(1, n + 1))
    sl = ndi.find_objects(lab)[int(np.argmax(sizes))]
    if sl[0].stop - sl[0].start < 60 or sl[1].stop - sl[1].start < 60:
        return None
    return Image.fromarray(crop[sl].astype("uint8"))


def _has_rule(rgb: np.ndarray, box: tuple) -> bool:
    """Prisbokse har en sort streg under etiketten i den øverste halvdel;
    gule "SPAR 50%"-cirkler og gul emballage har ikke."""
    x0, y0, x1, y1 = box
    top = rgb[y0:y0 + (y1 - y0) // 2, x0:x1].sum(axis=2) < 200
    return top.size > 0 and top.mean(axis=1).max() > 0.6


def _price_boxes(rgb: np.ndarray, yellow: np.ndarray) -> list[tuple]:
    boxes = [bx for bx in _boxes(yellow, 80, 120) if _has_rule(rgb, bx)]
    # Rører en prisboks gul emballage, smelter de sammen til ét område uden
    # synlig streg. En åbning skiller dem ad (men deler også små bokse ved
    # stregen, derfor kun som supplement).
    for bx in _boxes(ndi.binary_opening(yellow, iterations=4), 80, 120):
        inside = any(o[0] <= bx[0] and o[1] <= bx[1] and o[2] >= bx[2] and o[3] >= bx[3] for o in boxes)
        if not inside and _has_rule(rgb, bx):
            boxes.append(bx)
    return boxes


def parse_page(img: Image.Image) -> list[dict]:
    rgb = np.asarray(img.convert("RGB")).astype(int)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    price_boxes = _price_boxes(rgb, (r > 200) & (g > 180) & (b < 120))
    # Hvide kort og de røde korts tynde hvide kant; dilation lukker kanten.
    cards = _boxes(ndi.binary_dilation((g > 130) & (b > 130)), 150, 200)
    items = []
    for box in price_boxes:
        around = [c for c in cards if c[0] <= box[0] and c[1] <= box[1] and c[2] >= box[2] and c[3] >= box[3]]
        if not around:
            continue
        card = min(around, key=lambda c: (c[2] - c[0]) * (c[3] - c[1]))
        # Et kort kan have flere varer under hinanden (fx tre ænder); teksten
        # til denne vare starter under prisboksen over den.
        top = max([card[1]] + [o[3] for o in price_boxes
                               if o is not box and o[3] <= box[1] and card[0] <= o[0] <= card[2]])
        if box[1] - top < 40:
            continue
        region = rgb[top + 3:box[1], card[0] + 3:card[2] - 3]
        name, info, spans = _read_text(region)
        label, price = _read_price(rgb, box)
        if not name or price is None:
            continue
        # Tekstområdet starter 3 px inde i kortudsnittet, der starter i (card[0], top).
        spans = [(x0 + 3, y0 + 3, x1 + 3, y1 + 3) for x0, y0, x1, y1 in spans]
        below = [o for o in price_boxes if o[1] >= box[3] and card[0] <= o[0] <= card[2] and o[3] <= card[3]]
        bottom = box[3] if below else card[3]
        multi = _MULTI_RE.search(label)
        items.append({
            "name": name,
            "info": info,
            "label": label,
            "price": price,
            "multikob": int(multi.group(1)) if multi else None,
            "image": _product_image(rgb, (card[0], top, card[2], bottom), box, spans),
        })
    return items


# ── Avisen ───────────────────────────────────────────────────────────────────

def find_page_urls() -> list[str]:
    r = requests.get(f"{BASE_URL}/butikker/{STORE_SLUG}", headers=_HEADERS, timeout=30)
    r.raise_for_status()
    urls = []
    for path in _PAGE_RE.findall(r.text):
        if path not in urls:
            urls.append(path)
    return [BASE_URL + p for p in urls]


def _clean_name(name: str) -> str:
    name = re.sub(r"(\w)- (\w)", r"\1\2", name).replace("’", "'").replace("”", "'")
    return re.sub(r"\s+", " ", name).strip(" ,.")


def build_row(item: dict) -> dict | None:
    name = _clean_name(item["name"])
    info = " | ".join(item["info"])
    # Infolinjerne afslører ofte varetypen ("Hundesnacks", "290 meter").
    if not name or is_non_food(f"{name} {info}") or _NON_FOOD_EXTRA_RE.search(f"{name} {info}"):
        return None
    weight_m = _WEIGHT_RE.search(re.sub(r"Pr\.?\s*(kg|ltr|l|stk)\.?[^|]*", "", info, flags=re.I))
    kg_m = _KG_PRICE_RE.search(info)
    kg_price = None
    if kg_m:
        value = kg_m.group(2).replace(",-", ".00").replace(",", ".")
        unit = "l" if kg_m.group(1).lower() in ("l", "ltr") else kg_m.group(1).lower()
        kg_price = f"{value} kr/{unit}"
    weight = None
    if weight_m:
        unit = weight_m.group(2).lower()
        unit = "g" if unit == "gram" else unit
        amount = re.sub(r"\s+", "", weight_m.group(1))
        weight = f"{amount} {unit}"
    return {
        "butik":        BUTIK,
        "kategori":     KATEGORI,
        "navn":         name,
        "producent":    None,
        "netto_vaegt":  weight,
        "kg_price":     kg_price,
        "pris":         item["price"],
        "normalpris":   None,
        "varenummer":   None,
        "billede_url":  "",
        "billede_hash": None,
        "tilbud":       "Ja",
        "multikob":     item["multikob"],
    }


def fetch_abc_tilbud() -> list[dict]:
    if not shutil.which("tesseract"):
        raise RuntimeError("tesseract mangler (apt-get install tesseract-ocr tesseract-ocr-dan)")
    urls = find_page_urls()
    print(f"  {len(urls)} avissider for ABC Lavpris {STORE_SLUG}")
    if not urls:
        raise RuntimeError("Ingen avissider fundet på abc-lavpris.dk - siden er sandsynligvis ændret")
    rows, pairs, seen, total = [], [], set(), 0
    for url in urls:
        r = requests.get(url, headers=_HEADERS, timeout=60)
        r.raise_for_status()
        items = parse_page(Image.open(io.BytesIO(r.content)))
        total += len(items)
        for it in items:
            row = build_row(it)
            if row is None:
                continue
            key = (row["navn"].lower(), row["pris"])
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)
            if it["image"] is not None:
                pairs.append((row, it["image"]))
        time.sleep(PAGE_DELAY)
    print(f"  {total} varer læst i avisen, {len(rows)} madvarer, {len(pairs)} med billede")
    if len(rows) < 30:
        # En uge-avis har altid langt over 30 madtilbud; færre betyder at
        # layoutet er ændret og læsningen ikke længere virker.
        raise RuntimeError(f"Kun {len(rows)} varer læst fra ABC Lavpris' avis - layoutet er sandsynligvis ændret")
    store_images(pairs, IMAGE_PREFIX)
    return rows


def save_to_supabase(rows: list[dict]):
    # min_ratio=None: avisens størrelse svinger fra uge til uge; den ægte
    # fejl (layoutet ændret) fanges i fetch_abc_tilbud.
    save_product_dicts(BUTIK, rows, delete_neq_kategori="Katalog", min_ratio=None)


def main():
    print("Starter ABC Lavpris scraper (avis-billeder fra abc-lavpris.dk)...")
    rows = fetch_abc_tilbud()
    save_to_supabase(rows)
    cleanup_images(rows, IMAGE_PREFIX)
    print("\nFærdig!")


if __name__ == "__main__":
    main()
