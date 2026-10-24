"""Er butikkernes nye ugetilbud ude? Bruges om morgenen på skiftedagene.

Siden kan kun genopbygges én gang i døgnet (D1's skrivebudget), så morgenens
hentning skal ramme et tidspunkt, hvor butikkerne har lagt den nye uge ud.
Det tidspunkt skifter: Nettos lørdagsavis var ude før kl. 06 den 18-10-2026,
men først efter kl. 06:02 den 24-10-2026. Derfor kigger dette script i
butikkernes egne data og sammenligner med det, vi har gemt:

- Ugens skift er sket, når mange af butikkens tilbudsvarer nu har en anden
  pris end den, vi gemte i går (på en almindelig dag er det ca. 0 %).
- Butikkens katalog skal være helt: Nettos søgeindeks var halvt tomt
  lørdag 24-10-2026 kl. 08:30 (2.536 af 4.622 varer) midt i skiftet.

Skrivebudget og hentning startes ikke herfra; scriptet skriver kun
`klar=true|false` til GITHUB_OUTPUT. Afgøres af `butikker-klar.yml`.

Fredag: Bilka, Føtex, Meny, Spar og Min Købmand. Lørdag: Netto. Andre dage
er der intet skift at vente på, og svaret er altid klar.
"""
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scraper"))

from supabase_utils import get_client  # noqa: E402

# Andel af tilbudsvarerne (som også står i vores data), der skal have fået en
# ny pris, før vi kalder ugen skiftet. Målt på de syv daglige sammenligninger
# 18-24-10-2026: en almindelig dag gav 0-6 nye priser ud af tusinder.
MIN_SKIFT = 0.10
MIN_VARER = 20

ALGOLIA = "https://F9VBJLR1BK-dsn.algolia.net/1/indexes/{}/query"
ALGOLIA_HEADERS = {"X-Algolia-Application-Id": "F9VBJLR1BK",
                   "X-Algolia-API-Key": "d4f161f51f749bdd5baf699175d5f956"}
SALLING = {"Netto": "prod_NETTO_PRODUCTS", "Foetex": "prod_FOETEX_PRODUCTS",
           "Bilka": "prod_BILKATOGO_PRODUCTS"}
SKIFT_DAGE = {5: ["Bilka", "Foetex", "Meny", "Spar", "minkøbmand"], 6: ["Netto"]}


def gemt(butik):
    """{ean: pris} for butikkens varer, som de står i produkter nu."""
    client, rows, offset = get_client(), [], 0
    while True:
        batch = (client.table("produkter").select("varenummer,pris")
                 .eq("butik", butik).order("id")
                 .range(offset, offset + 999).execute().data or [])
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    out = {}
    for r in rows:
        try:
            out[str(r["varenummer"])] = float(r["pris"])
        except (TypeError, ValueError, KeyError):
            pass
    return out


def _algolia(index, params):
    r = requests.post(ALGOLIA.format(index), json=params,
                      headers=ALGOLIA_HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def salling_nu(butik):
    """(antal varer i hele indekset, {ean: pris} for avisvarerne)."""
    index = SALLING[butik]
    total = _algolia(index, {"params": "hitsPerPage=0"}).get("nbHits", 0)
    tilbud = {}
    for page in range(10):
        j = _algolia(index, {"params": f"hitsPerPage=1000&page={page}"
                                       "&filters=isInCurrentLeaflet:true",
                             "attributesToRetrieve": ["gtin", "storeData"]})
        for h in j.get("hits") or []:
            priser = [v.get("price") for v in (h.get("storeData") or {}).values()
                      if v and v.get("price")]
            if h.get("gtin") and priser:
                # Som scraperne: referencebutikken, ellers den første med pris.
                # Her er det nok at sammenligne mod mindste og største pris.
                tilbud[str(h["gtin"])] = sorted(p / 100 for p in priser)
        if page + 1 >= j.get("nbPages", 0):
            break
    return total, tilbud


def dagrofa_nu(butik):
    import dagrofa_scraper as ds
    cfg = next(c for c in ds.STORES.values() if c["db_key"] == butik)
    ds.API_ORIGIN, ds.MERCHANT_ID, ds.BASE_URL = (
        cfg["api_origin"], cfg["merchant_id"], cfg["base_url"])
    ds.BASE_ORIGIN = ds.BASE_URL.rsplit("/produkter", 1)[0]
    j = ds._api_get("/Product/query", {
        "merchantId": ds.MERCHANT_ID, "pageNumber": 0,
        "pageSize": ds._API_PAGE_SIZE, "displayedInStore": "true"})
    tilbud = {}
    for p in j.get("products") or []:
        normal = float(p.get("price") or 0)
        rabat = float(p.get("discountPrice") or 0)
        # Multikøb gemmes med normalprisen; dem kan vi ikke bruge her.
        if p.get("sku") and 0 < rabat < normal and int(p.get("discountAmount") or 0) <= 1:
            tilbud[str(p["sku"])] = [rabat]
    return j.get("total", 0), tilbud


def klar(butik):
    gemte = gemt(butik)
    total, tilbud = (salling_nu if butik in SALLING else dagrofa_nu)(butik)
    faelles = [e for e in tilbud if e in gemte]
    nye = [e for e in faelles
           if all(abs(gemte[e] - p) > 0.01 for p in tilbud[e])]
    andel = len(nye) / len(faelles) if faelles else 0.0
    helt = total >= len(gemte)
    ok = helt and len(faelles) >= MIN_VARER and andel >= MIN_SKIFT
    print(f"{butik}: {total} varer hos butikken (gemt {len(gemte)}), "
          f"{len(tilbud)} tilbud, {len(nye)} af {len(faelles)} med ny pris "
          f"({andel:.0%}) -> {'klar' if ok else 'ikke klar'}")
    return ok


def main():
    dag = datetime.now(ZoneInfo("Europe/Copenhagen")).isoweekday()
    butikker = SKIFT_DAGE.get(dag, [])
    resultat = True
    for b in butikker:
        try:
            resultat = klar(b) and resultat
        except Exception as e:  # et fejlet opslag er ikke et "klar"
            print(f"{b}: kunne ikke tjekkes: {e}")
            resultat = False
    if not butikker:
        print("Ingen ugeskift i dag - klar")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"klar={'true' if resultat else 'false'}\n")
    print("KLAR" if resultat else "IKKE KLAR")


if __name__ == "__main__":
    main()
