"""
Kvickly tilbudsavis via Tjek/ShopGun (dealer c1edq).

Coop viser avisen på kvickly.coop.dk/avis/ som en Tjek-widget, der bygges i
browseren. Den gamle Selenium-scraper ledte efter div[data-role='offer'] i
avis-siden; den markup forsvandt i juli 2026, og scraperen fandt derefter 0
tilbud hver nat uden at fejle, så Kvicklys priser stod stille i månedsvis.
Tjeks API giver de samme tilbud struktureret (pris, førpris, multikøb,
billede) og kræver ingen browser - samme vej som Netto, Føtex, Lidl m.fl.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from supabase_utils import save_product_dicts
from tjek_tilbud_scraper import fetch_tjek_tilbud

DEALER_ID = "c1edq"
BUTIK = "Kvickly"


def main():
    print("Starter Kvickly scraper (Tjek API)...")
    # dedupe_by_heading: samme vare kan stå både i ugeavisen og i fx
    # "Søndag & mandag"-indstikket; to rækker med samme navn i én butik
    # forvirrer matchingen. fetch_tjek_tilbud raiser selv, hvis der ingen
    # aktive aviser er, eller en avis der påstår at have tilbud giver nul.
    rows = fetch_tjek_tilbud(DEALER_ID, BUTIK, dedupe_by_heading=True)
    # min_ratio=None: antallet af aktive aviser svinger legitimt; sundheds-
    # kontrollen ligger pr. avis i fetch_tjek_tilbud (se dens docstring).
    # save_product_dicts raiser på 0 rækker, så en tom kørsel bliver rød.
    save_product_dicts(BUTIK, rows, min_ratio=None)
    print("\nFærdig!")


if __name__ == "__main__":
    main()
