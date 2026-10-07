#!/usr/bin/env python3
"""Seeder en LOKAL D1 + KV (wrangler --local) med samme rækker og KV-nøgler som
scripts/seed-d1.py skriver i produktion - så TanStack-PoC'en (og den gamle
Python-worker) kan køres og måles lokalt uden at røre Cloudflare.

Kør fra apps/web:  python3 scripts/seed-local.py
Kræver ../../data/app_cache_local.json (hentes fra Supabase app_cache, hvis den mangler).
Skriver kun til apps/web/.wrangler-state (gitignored).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(WEB))
STATE = os.path.join(WEB, ".wrangler-state")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
sys.path.insert(0, ROOT)



import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("seed_d1", os.path.join(ROOT, "scripts", "seed-d1.py"))
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)  # type: ignore[union-attr]
seed._LOCAL_APP_CACHE_MAX_AGE_S = 10**9


def wrangler(*args: str) -> None:
    subprocess.run(["npx", "wrangler", *args, "--local", "--persist-to", STATE], cwd=WEB, check=True)


def main() -> int:
    products = seed.fetch_products()
    version = int(time.time() // 60)
    postings: dict = {}
    stats: dict = {}
    seen: set[str] = set()
    values: list[str] = []
    for p in products:
        pid = str(p.get("/product/id", "")).strip()
        if not pid or pid in ("None", "nan") or pid in seen:
            continue
        if str(p.get("/product/imageLink", "")).strip() in seed._PLACEHOLDER_IMGS:
            continue
        seen.add(pid)
        v = seed.build_row_values(p, stats, rowid=version * seed._SIDX_ROW_SPAN + len(values), postings=postings)
        if v:
            values.append(v)
    prefix = ("INSERT INTO products_new (rowid,id,category,subcategory,title,price,eff_price,"
              "is_sale,organic,lactose,weight_g,store,stores,search_text,data) VALUES ")
    stmts, batch, size = [], [], 0
    for v in values:
        if batch and size + len(v) >= seed.MAX_STMT_BYTES:
            stmts.append(prefix + ",".join(batch) + ";")
            batch, size = [], 0
        batch.append(v)
        size += len(v) + 1
    if batch:
        stmts.append(prefix + ",".join(batch) + ";")
    sql = seed.SCHEMA + "\n" + "\n".join(stmts) + "\n" + seed.FINALIZE
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(sql)
        sql_path = f.name
    print(f"D1: {len(values)} rækker")
    wrangler("d1", "execute", "DB", f"--file={sql_path}", "-y")
    os.unlink(sql_path)

    entries, manifest = seed.build_search_shards(postings, version)
    for e in entries:
        e.pop("expiration_ttl", None)
    stats_payload = {
        "products": stats.get("products", 0),
        "sale": stats.get("sale", 0),
        "cats": {c: {"n": v["n"], "subs": sorted(v["subs"])} for c, v in stats.get("cats", {}).items()},
    }
    home = seed.build_home_data(products)
    entries += [
        {"key": "sidx_ver", "value": json.dumps(manifest, separators=(",", ":"))},
        {"key": "d1_stats_v1", "value": json.dumps(stats_payload, separators=(",", ":"), ensure_ascii=False)},
        {"key": "home_data_v1", "value": json.dumps(home, separators=(",", ":"), ensure_ascii=False)},
        {"key": "cache_version", "value": str(int(time.time()))},
    ]
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False)
        kv_path = f.name
    print(f"KV: {len(entries)} nøgler")
    wrangler("kv", "bulk", "put", kv_path, "--binding", "CACHE_KV")
    os.unlink(kv_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
