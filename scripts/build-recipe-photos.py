#!/usr/bin/env python3
"""Henter og klargør fotos til MadShoppers egne opskrifter.

Hver opskrift i data/egne_opskrifter.json har et "foto" med et frit
licenseret foto fra Wikimedia Commons (Kalle 05-11-2026: "så realistiske som
muligt", og ingen fotos vi ikke må bruge):

    "foto": {"fil": "File:Frikadeller.jpg",
             "side": "https://commons.wikimedia.org/wiki/File:Frikadeller.jpg",
             "af": "Fotografens navn", "licens": "CC BY-SA 4.0",
             "beskaer": 0.5}

Kun CC0, public domain, CC BY og CC BY-SA er tilladt (alle må bruges
kommercielt, også bag abonnementet). Billedet beskæres til 4:3 ("beskaer" er
den lodrette placering af udsnittet, 0 = top, 0,5 = midt, 1 = bund), skaleres
til 800 x 600 og gemmes som static/images/opskrifter/<slug>.webp. Kræver
licensen kreditering (CC BY/CC BY-SA), skrives "Foto: <navn> / <licens>"
diskret nederst i højre hjørne af selve billedet, så krediteringen følger
billedet overalt (web, app, forside) uden en ny kolonne i databasen. Det
beskårne billede med tekst er en bearbejdning, og for CC BY-SA deles det
under samme licens.

Kør:  python3 scripts/build-recipe-photos.py            (dem der mangler)
      python3 scripts/build-recipe-photos.py frikadeller (kun slugs der matcher)
Derefter lægger `python recipe_importer.py egne` adressen på opskriften.
"""
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'egne_opskrifter.json')
OUT = os.path.join(ROOT, 'static', 'images', 'opskrifter')
W, H = 800, 600
UA = {'User-Agent': 'MadShopperRecipePhotos/1.0 (https://madshopper.dk)'}
FRI = re.compile(r'^(CC0( 1\.0)?|Public domain|CC BY(-SA)? [0-9.]+)$', re.I)
UDEN_KREDIT = re.compile(r'^(CC0( 1\.0)?|Public domain)$', re.I)
FONTE = ('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf',
         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')


def hent(url):
    for i in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            return urllib.request.urlopen(req, timeout=60).read()
        except Exception as e:
            kode = getattr(e, 'code', 0)
            if i == 5 or (400 <= kode < 500 and kode != 429):
                raise
            # Wikimedia svarer 429 ved for mange hentninger: vent længere
            time.sleep((60 if kode == 429 else 2) * (i + 1))


def foto_url(fil, bredde):
    # Wikimedias faste miniaturestørrelser (https://w.wiki/GHai); stien
    # regnes ud fra filnavnets md5, så der ikke skal et API-kald til.
    navn = fil.split(':', 1)[1].replace(' ', '_')
    h = hashlib.md5(navn.encode('utf-8')).hexdigest()
    q = urllib.parse.quote(navn)
    if not bredde:
        return f'https://upload.wikimedia.org/wikipedia/commons/{h[0]}/{h[:2]}/{q}'
    return f'https://upload.wikimedia.org/wikipedia/commons/thumb/{h[0]}/{h[:2]}/{q}/{bredde}px-{q}'


def hent_foto(fil):
    for bredde in (1280, 960, None):
        try:
            return hent(foto_url(fil, bredde))
        except urllib.error.HTTPError as e:
            if e.code == 429 or bredde is None:
                raise
            # originalen er smallere end miniaturen: prøv næste størrelse


def font(size):
    for p in FONTE:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def beskaer(im, y_pos):
    w, h = im.size
    if w / h > W / H:
        nw = int(h * W / H)
        x0 = (w - nw) // 2
        im = im.crop((x0, 0, x0 + nw, h))
    else:
        nh = int(w * H / W)
        y0 = int((h - nh) * y_pos)
        im = im.crop((0, y0, w, y0 + nh))
    return im.resize((W, H), Image.LANCZOS)


def kredit(im, tekst):
    d = ImageDraw.Draw(im, 'RGBA')
    f = font(15)
    x0, y0, x1, y1 = d.textbbox((0, 0), tekst, font=f)
    tw, th = x1 - x0, y1 - y0
    pad = 7
    bx, by = W - tw - 2 * pad - 10, H - th - 2 * pad - 10
    d.rounded_rectangle((bx, by, bx + tw + 2 * pad, by + th + 2 * pad), radius=8, fill=(0, 0, 0, 120))
    d.text((bx + pad - x0, by + pad - y0), tekst, font=f, fill=(255, 255, 255, 235))
    return im


def kort_navn(af):
    af = re.sub(r'\s+', ' ', af or '').strip()
    af = re.sub(r'^(User|Bruger):', '', af)
    return (af[:38] + '…') if len(af) > 39 else (af or 'Wikimedia Commons')


def main():
    filt = sys.argv[1:]
    with open(DATA, encoding='utf-8') as f:
        recipes = json.load(f)['opskrifter']
    os.makedirs(OUT, exist_ok=True)
    n = 0
    for r in recipes:
        foto = r.get('foto')
        if not foto:
            print(f'MANGLER foto: {r["slug"]}', file=sys.stderr)
            continue
        if filt and not any(s in r['slug'] for s in filt):
            continue
        if not FRI.match(foto['licens'].strip()):
            raise SystemExit(f'{r["slug"]}: licensen {foto["licens"]!r} er ikke fri til kommerciel brug')
        ud = os.path.join(OUT, r['slug'] + '.webp')
        if not filt and os.path.exists(ud):
            continue  # allerede lavet; giv slug som argument for at lave om
        im = Image.open(io.BytesIO(hent_foto(foto['fil']))).convert('RGB')
        im = beskaer(im, float(foto.get('beskaer', 0.5)))
        if not UDEN_KREDIT.match(foto['licens'].strip()):
            im = kredit(im, f'Foto: {kort_navn(foto.get("af"))} / {foto["licens"]}')
        im.save(ud, 'WEBP', quality=80, method=6)
        n += 1
        time.sleep(4)
    print(f'{n} fotos klar i {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
