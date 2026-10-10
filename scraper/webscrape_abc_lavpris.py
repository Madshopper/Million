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

De 16 butikkers aviser er næsten ens, men enkelte varer findes kun i nogle
byer. Alle byers aviser læses, og et kort der allerede er læst i en anden by,
springes over (pHash), så OCR'en kun kører på de nye.
"""
import csv
import io
import os
import re
import shutil
import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import imagehash
import numpy as np
import requests
from PIL import Image
from rapidfuzz import fuzz, process
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from avis_billeder import cleanup_images, store_images
from keywords import is_non_food
from supabase_utils import get_client, save_product_dicts

BASE_URL = "https://www.abc-lavpris.dk"
# Kort med højst så mange forskellige bit (af 256) i pHash er samme kort.
# Målt uge 41: 16 byer x ~121 kort gav 131 forskellige.
_SAME_CARD_MAX_DIST = 12
_SAME_PAGE_MAX_DIST = 6
_SEEN_PAGES: list = []
BUTIK = "ABC Lavpris"
KATEGORI = "Tilbudsavis"
IMAGE_PREFIX = "abc-lavpris"

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
    """Ord samlet i linjer efter placering. Tesseracts egne linjer (psm 11)
    deler ofte en linje op, når ordene står med luft imellem."""
    lines: list[dict] = []
    for w in sorted(words, key=lambda w: int(w["top"]) + int(w["height"]) / 2):
        top, h = int(w["top"]), int(w["height"])
        mid = top + h / 2
        for line in lines:
            line_mid = line["top"] + line["height"] / 2
            if abs(mid - line_mid) < 0.5 * max(h, line["height"]) \
                    and max(h, line["height"]) < 1.6 * max(1, min(h, line["height"])):
                bottom = max(line["top"] + line["height"], top + h)
                line["top"] = min(line["top"], top)
                line["height"] = bottom - line["top"]
                line["words"].append(w)
                break
        else:
            lines.append({"top": top, "height": h, "words": [w]})
    for line in lines:
        line["words"].sort(key=lambda w: int(w["left"]))
        line["text"] = " ".join(w["text"] for w in line["words"])
    return sorted(lines, key=lambda line: line["top"])


def _binary(mask: np.ndarray, pad: int = 0) -> Image.Image:
    arr = np.where(mask, 0, 255).astype("uint8")
    if pad:
        arr = np.pad(arr, pad, constant_values=255)
    return Image.fromarray(arr)


_DIGIT_CACHE: list[tuple[np.ndarray, str]] = []


def _read_digit(mask: np.ndarray) -> str:
    """Ét ciffer, læst enkeltvis (sikrest: samlet forveksler tesseract 5/9 og
    taber smalle 1-taller). Avisen bruger samme skrift og få størrelser, så et
    ciffer med samme form som et allerede læst genbruger svaret i stedet for
    et nyt tesseract-kald."""
    shape = np.asarray(_binary(mask).resize((20, 30))) < 128
    for known, digit in _DIGIT_CACHE:
        if (known != shape).mean() < 0.04:
            return digit
    part = _binary(mask, pad=max(mask.shape) // 3)
    part = part.resize((max(1, int(part.width * 100 / part.height)), 100))
    digit = re.sub(r"\D", "", "".join(w["text"] for w in _tesseract(part, 10, "0123456789")))[:1]
    if digit:
        _DIGIT_CACHE.append((shape, digit))
    return digit


def _read_digits(lab: np.ndarray, group: list) -> str:
    """Læs en gruppe cifre ét ad gangen; mangler et, læses gruppen samlet."""
    if not group:
        return ""
    single = "".join(_read_digit(lab[s] == i) for s, i in sorted(group, key=lambda g: g[0][1].start))
    if len(single) == len(group):
        return single
    ys = [s[0] for s, _ in group]
    xs = [s[1] for s, _ in group]
    y0, y1 = min(y.start for y in ys), max(y.stop for y in ys)
    x0, x1 = min(x.start for x in xs), max(x.stop for x in xs)
    img = _binary(np.isin(lab, [i for _, i in group])[y0:y1, x0:x1], pad=30)
    if img.height > 120:
        img = img.resize((max(1, int(img.width * 120 / img.height)), 120))
    whole = re.sub(r"\D", "", "".join(w["text"] for w in _tesseract(img, 7, "0123456789.-")))
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


def _text_lines(region: np.ndarray, scale: int) -> list[tuple]:
    """Sikre tekstlinjer som (top, højde, tekst, felt) i regionens koordinater."""
    img = _binary(_text_mask(region))
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale), Image.LANCZOS)
    words = _tesseract(img, 11)
    for w in words:
        for key in ("left", "top", "width", "height"):
            w[key] = int(w[key]) // scale
    # Navnet står altid øverst i kortet. Et varefoto tæt på teksten kan sænke
    # tesseracts sikkerhed, så øverst godtages rene ord ved lavere sikkerhed;
    # ellers kun sikre ord. Usikre ord (støj fra fotoet) frasorteres FØR ordene
    # samles i linjer, så de ikke forskyder linjernes højde og placering.
    words = [w for w in words if float(w["conf"]) >= 50
             or (w["top"] < 45 and float(w["conf"]) >= 20
                 and re.fullmatch(r"[A-Za-zÆØÅæøåÉé'’,.-]{3,}", w["text"]))]
    # "DYBFROST"-mærket står i kortets hjørne på frostvarer.
    words = [w for w in words if "DYBFROST" not in w["text"].upper()]
    out = []
    for line in _lines(words):
        text = line["text"].strip(" |—-=_")
        letters = sum(ch.isalpha() for ch in text)
        if len(text) < 2 or letters < 0.5 * len(text.replace(" ", "")):
            if not re.search(r"\d", text):
                continue
        ws = line["words"]
        # Typisk ordhøjde: et logo der læses som "Ø" må ikke gøre linjen højere.
        out.append((line["top"], int(np.median([w["height"] for w in ws])), text,
                    (min(w["left"] for w in ws), line["top"],
                     max(w["left"] + w["width"] for w in ws), line["top"] + line["height"])))
    return out


def _read_text(region: np.ndarray) -> tuple[str, list[str], list[tuple]]:
    """Navn (de største linjer øverst) og infolinjer under det. Returnerer også
    linjernes felter (x0, y0, x1, y1), så teksten ikke tages for at være varen."""
    lines = _text_lines(region, 1)
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
            spans.append(bbox)
        else:
            info.append((top, h, text, bbox))
    # Infoteksten (kg-pris, vægt) er kun 10-15 px høj; tesseract læser den
    # markant bedre i dobbelt størrelse. Navnet læses bedst i normal størrelse.
    small = [ln for ln in _text_lines(region, 2) if ln[0] >= prev_bottom - 3 and ln[1] < 0.75 * name_h]
    info = small or info
    spans += [ln[3] for ln in info]
    info = [ln[2] for ln in info]
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


def parse_page(img: Image.Image, seen_cards: list | None = None) -> list[dict]:
    """Varerne på en avisside. seen_cards (pHash'er) springer kort over, som
    allerede er læst i en anden bys avis, så kun nye kort OCR-læses."""
    img = img.convert("RGB")
    if seen_cards is not None:
        # Hele siden uden byens navn i toppen; en side der er set i en anden
        # by, springes over uden at blive analyseret (de fleste sider).
        page_hash = imagehash.phash(img.crop((0, int(img.height * 0.07), img.width, img.height)), hash_size=16)
        if any(page_hash - h <= _SAME_PAGE_MAX_DIST for h in _SEEN_PAGES):
            return []
        _SEEN_PAGES.append(page_hash)
    rgb = np.asarray(img).astype(int)
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
        if seen_cards is not None:
            # Kortet til og med prisboksen; samme vare til samme pris i en
            # anden by giver (næsten) samme hash.
            card_hash = imagehash.phash(img.crop((card[0], top, card[2], box[3])), hash_size=16)
            if any(card_hash - h <= _SAME_CARD_MAX_DIST for h in seen_cards):
                continue
            seen_cards.append(card_hash)
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

def find_store_slugs() -> list[str]:
    r = requests.get(f"{BASE_URL}/butikker", headers=_HEADERS, timeout=30)
    r.raise_for_status()
    return sorted(set(re.findall(r'href="/butikker/([a-z]+)"', r.text)))


def find_page_urls(slug: str) -> list[str]:
    r = requests.get(f"{BASE_URL}/butikker/{slug}", headers=_HEADERS, timeout=30)
    r.raise_for_status()
    urls = []
    for path in _PAGE_RE.findall(r.text):
        if path not in urls:
            urls.append(path)
    return [BASE_URL + p for p in urls]


def _clean_name(name: str) -> str:
    name = re.sub(r"(\w)- (\w)", r"\1\2", name).replace("’", "'").replace("”", "'")
    return re.sub(r"\s+", " ", name).strip(" ,.")


_WORD_RE = re.compile(r"[a-zæøåéèüöä'-]+")


def load_vocabulary() -> Counter:
    """Ordene i alle andre butikkers varenavne. Bruges til at rette OCR-fejl
    i navnene ("Premieris" -> "Premier Is") og fjerne støj ("Ø", "he").
    Fejler opslaget, læses navnene bare uden retning."""
    vocab: Counter = Counter()
    try:
        client = get_client()
        offset, page_size = 0, 1000
        while True:
            batch = (client.table("produkter").select("navn").neq("butik", BUTIK)
                     .order("id").range(offset, offset + page_size - 1).execute().data or [])
            for row in batch:
                vocab.update(_WORD_RE.findall((row.get("navn") or "").lower()))
            if len(batch) < page_size:
                break
            offset += page_size
    except Exception as e:
        print(f"  ⚠ Kunne ikke hente ordliste til navnerettelse: {e}")
    return vocab


_KNOWN_WORDS: dict[int, list[str]] = {}


def _match_case(word: str, like: str) -> str:
    if like.isupper() and len(like) > 1:
        return word.upper()
    return word[:1].upper() + word[1:] if like[:1].isupper() else word


def fix_name(name: str, vocab: Counter) -> str:
    """Ret hvert ord, som ingen andre butikker bruger, til det kendte ord det
    ligner: to sammenklistrede ord deles, et enkelt forkert bogstav rettes, og
    korte ukendte stumper (typisk støj fra varefotoet) fjernes. Ukendte men
    rimelige ord (nye mærker) beholdes."""
    if not vocab:
        return name
    if id(vocab) not in _KNOWN_WORDS:
        _KNOWN_WORDS.clear()
        _KNOWN_WORDS[id(vocab)] = [w for w, c in vocab.items() if c >= 3 and len(w) >= 4]
    known = _KNOWN_WORDS[id(vocab)]
    out = []
    for pos, token in enumerate(name.split()):
        core = token.strip(",.;:!?\"'()")
        low = core.lower()
        if not low or vocab[low] >= 2 or not low.isalpha():
            out.append(token)
            continue
        if len(low) <= 3:
            # Første ord er oftest mærket ("EGO", "OTA"), som godt kan være
            # ukendt; ellers er en kort ukendt stump støj.
            if pos == 0:
                out.append(token)
            continue
        split = next((f"{low[:i]} {low[i:]}" for i in range(2, len(low) - 1)
                      if vocab[low[:i]] >= 3 and vocab[low[i:]] >= 3), None)
        if split:
            out.append(token.replace(core, " ".join(_match_case(w, core) for w in split.split())))
            continue
        best = process.extractOne(low, known, scorer=fuzz.ratio, score_cutoff=88)
        if best and abs(len(best[0]) - len(low)) <= 1:
            out.append(token.replace(core, _match_case(best[0], core)))
        else:
            out.append(token)
    # Rester af kilo-pris-linjen ("kg max") hører ikke til navnet.
    while len(out) > 1 and out[-1].lower().strip(".") in ("kg", "max", "pr", "ltr", "stk"):
        out.pop()
    return " ".join(out).strip(" ,.")


def build_row(item: dict, vocab: Counter | None = None) -> dict | None:
    name = fix_name(_clean_name(item["name"]), vocab or Counter())
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
    # Byernes aviser er næsten ens, men nogle varer findes kun i nogle byer
    # (uge 41: 10 af 131 kort). Alle byer læses; kort der allerede er set,
    # springes over, så kun de nye OCR-læses.
    slugs = find_store_slugs()
    print(f"  {len(slugs)} ABC Lavpris-butikker med egen avis")
    if not slugs:
        raise RuntimeError("Ingen butikker fundet på abc-lavpris.dk - siden er sandsynligvis ændret")
    vocab = load_vocabulary()
    print(f"  Ordliste til navnerettelse: {len(vocab)} ord")
    rows, pairs, seen_cards, total, pages = [], [], [], 0, 0
    urls = [url for slug in slugs for url in find_page_urls(slug)]

    def download(url: str) -> bytes:
        r = requests.get(url, headers=_HEADERS, timeout=60)
        r.raise_for_status()
        return r.content

    # ~190 sider à 0,5 MB; serveren er langsom pr. forespørgsel, så nogle få
    # hentes ad gangen. Siderne læses stadig i rækkefølge.
    with ThreadPoolExecutor(max_workers=4) as pool:
        for data in pool.map(download, urls):
            pages += 1
            items = parse_page(Image.open(io.BytesIO(data)), seen_cards)
            total += len(items)
            for it in items:
                row = build_row(it, vocab)
                if row is None:
                    continue
                # Samme kort kan læses lidt forskelligt i to byer ("Guldost,"/"Guldost").
                if any(r["pris"] == row["pris"] and fuzz.token_set_ratio(r["navn"].lower(), row["navn"].lower()) >= 85
                       for r in rows):
                    continue
                rows.append(row)
                if it["image"] is not None:
                    pairs.append((row, it["image"]))
    print(f"  {pages} avissider, {len(seen_cards)} forskellige varekort")
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
