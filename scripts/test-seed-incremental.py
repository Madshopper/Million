#!/usr/bin/env python3
"""Den inkrementelle D1-seed skal give præcis samme tabel som en fuld.

Kør: python3 scripts/test-seed-incremental.py

Kører scripts/seed-d1.py::main() mod en lokal SQLite i stedet for D1 (wrangler
og KV erstattes), med et lille syntetisk katalog:
  nat 1: fuld genopbygning (FULL_RESEED=1)
  nat 2: inkrementel - én vare får ny pris, én nyt navn, én udgår, én er ny
  facit: fuld genopbygning af nat 2's katalog i en frisk database
Tjekker at indholdet er identisk, at kun de ændrede rækker skrives, at en
uændret nat 3 skriver nul rækker, og at søgeindeksets rowid'er findes.
"""
from __future__ import annotations

import copy
import importlib.util
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("seed_d1", ROOT / "scripts" / "seed-d1.py")
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


def _product(i: int, **kw) -> dict:
    p = {
        "/product/id": f"p{i}",
        "/product/title": f"Testvare nummer {i} letmælk",
        "/product/product_type": "Mejeri" if i % 2 else "Frugt & grønt",
        "/product/price": 10.0 + i,
        "/product/store": "Rema 1000",
        "/product/imageLink": f"https://example.com/{i}.jpg",
        "/product/unit_pricing_measure": "1 l",
    }
    p.update(kw)
    return p


BASE = [_product(i) for i in range(12)]
BASE[3]["/product/sale_price"] = 9.0

state: dict = {}


def _run_sql(sql: str) -> None:
    state["db"].executescript(sql)


def _query(sql: str) -> list[dict]:
    cur = state["db"].execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _seed(products: list[dict], full: bool) -> dict:
    state["products"] = copy.deepcopy(products)
    captured: dict = {}
    orig_shards = seed.build_search_shards

    def shards(postings, version):
        captured["postings"] = postings
        return orig_shards(postings, version)

    seed.build_search_shards = shards
    if full:
        os.environ["FULL_RESEED"] = "1"
    else:
        os.environ.pop("FULL_RESEED", None)
    try:
        assert seed.main() == 0
    finally:
        seed.build_search_shards = orig_shards
        os.environ.pop("FULL_RESEED", None)
    return captured


def main() -> int:
    seed.run_wrangler_sql = _run_sql
    seed.d1_query = _query
    for name in ("write_search_shards", "write_search_version", "write_d1_stats",
                 "write_offer_ids", "write_home_data", "set_cache_version", "mark_seeded"):
        setattr(seed, name, lambda *a, **k: True)
    seed.last_seed_info = lambda: None
    seed.build_home_data = lambda products: {}
    seed.fetch_products = lambda: state["products"]
    # Kataloget her er langt under produktionens værn (8000 varer, 25 % match).
    seed._MIN_PRODUCTS = 0
    seed._MIN_COVERAGE = 0

    night2 = copy.deepcopy(BASE)
    night2[0]["/product/price"] = 99.0                  # indekskolonne (eff_price)
    night2[1]["/product/title"] = "Nyt navn letmælk"     # kun data/title
    del night2[2]                                       # udgår
    night2.append(_product(50))                         # ny

    state["db"] = sqlite3.connect(":memory:")
    _seed(BASE, full=True)
    writes: list[str] = []
    orig_run = seed.run_wrangler_sql
    seed.run_wrangler_sql = lambda sql: (writes.append(sql), orig_run(sql))
    postings = _seed(night2, full=False)["postings"]
    inc_db = state["db"]
    inc = {r["id"]: r for r in _query("SELECT * FROM products")}
    joined = "\n".join(writes)
    assert joined.count("UPDATE products") == 2, joined
    price_update = [s for s in joined.splitlines() if "WHERE rowid" in s and "99.0" in s]
    assert price_update and "eff_price=" in price_update[0], price_update
    title_update = [s for s in joined.splitlines() if "Nyt navn" in s and s.startswith("UPDATE")]
    assert title_update and "eff_price=" not in title_update[0], title_update
    assert joined.count("DELETE FROM products") == 1, joined
    assert joined.count("INSERT INTO products ") == 1, joined

    rowids = {r[0] for r in inc_db.execute("SELECT rowid FROM products")}
    missing = {i for ids in postings.values() for i in ids} - rowids
    assert not missing, missing

    writes.clear()
    _seed(night2, full=False)
    assert not writes, writes

    state["db"] = sqlite3.connect(":memory:")
    seed.run_wrangler_sql = _run_sql
    _seed(night2, full=True)
    ref = {r["id"]: r for r in _query("SELECT * FROM products")}
    assert inc == ref, {k for k in ref if inc.get(k) != ref[k]}
    print(f"OK: inkrementel seed = fuld seed ({len(ref)} varer)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
