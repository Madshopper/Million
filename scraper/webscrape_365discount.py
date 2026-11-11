"""
365discount tilbudsavis via Tjek/ShopGun (dealer DWZE1w).

365discount er Coops discountkæde, og avisen har samme form som Kvickly,
SuperBrugsen og Brugsen. Scraperen havde tidligere sin egen ældre kopi af
tekstlæsningen og tog derfor fejl på ting, den fælles læsning havde rettet:
en ramme med 15-18 øl til 69 kr stod som én dåse på 33 cl, og "Actimel 8-pak"
som 100 g. Nu bruges den fælles læsning i tjek_tilbud_scraper.py.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from supabase_utils import save_product_dicts
from tjek_tilbud_scraper import fetch_tjek_tilbud

DISCOUNT365_DEALER_ID = "DWZE1w"
BUTIK = "365discount"


def fetch_365discount_tilbud() -> list[dict]:
    return fetch_tjek_tilbud(DISCOUNT365_DEALER_ID, BUTIK)


def main():
    print("Starter 365discount scraper (Tjek API)...")
    rows = fetch_365discount_tilbud()
    # min_ratio=None: antallet af aktive tilbudsaviser svinger legitimt, saa
    # totalantallet falder proportionalt uden at noget er galt. Sundheds-
    # kontrollen ligger i fetch_tjek_tilbud, som fejler hvis en aktiv avis
    # giver nul tilbud - den aegte fejlsignatur. Se dens docstring.
    save_product_dicts(BUTIK, rows, min_ratio=None)
    print("\nFærdig!")


if __name__ == "__main__":
    main()
