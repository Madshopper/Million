# Offline-tilstand (mock-data)

Kør hele sitet lokalt uden ét eneste kald ud af maskinen - til at vise en
ændring eller en ny funktion i en sky-VM, en Claude-tråd eller uden net.

```bash
uv sync                                   # én gang (kræver net)
bash scripts/offline.sh                   # http://127.0.0.1:5001, Ctrl+C stopper
bash scripts/offline.sh --shots out/      # skærmbilleder (desktop + mobil) af standardsiderne
bash scripts/offline.sh --shots out/ / /Mejeri "/search/results?q=pizza"   # egne stier
```

`--shots` blokerer og tæller alle browser-requests til andre værter end
localhost og fejler, hvis der var nogen. Python-siden kører med proxy-variabler
mod en død port, så et glemt kald fejler i stedet for at slippe ud.

## Hvad er erstattet (`MADSHOPPER_OFFLINE=1`)

| Rigtig kilde | Offline |
|---|---|
| Produkt-cache (Supabase `app_cache` / KV) | `mockdata/products.py`: ~46 opdigtede varer i alle kategorier og 14 butikker, med tilbud, multikøb og prishistorik |
| Supabase REST/RPC (`app.py::_supabase_rest`) | `mockdata/offline.py::supabase_rest`, i hukommelsen. Skrivninger (kurv-tælling, feedback, søgninger) gemmes og kan ses på `/__mock/writes` |
| Produktbilleder fra butikkernes CDN'er | SVG-pladsholdere på `/__mock/img/<id>.svg` |
| Login (supabase-js), Google/Apple, Turnstile | Slået fra: browseren får tom Supabase-URL/-nøgle |
| Feature-panelet | Alt slået til, som på staging. `MOCK_FEATURES=prod` slår kun det til, miljø-varerne slår til |
| Admin | `MOCK_ADMIN=1` får `is_admin` til at svare ja |

D1 og KV bruges ikke lokalt (kun på edge), så de kræver ingen mock.
`mockdata/` kommer aldrig med på edge: den er udeladt i `pyproject.toml`
(`[tool.edgekit.builder.exclude]`), og `app.py` importerer den kun når flaget er sat.

## Ny funktion der skal vises

Tilføj de varer, funktionen har brug for, i `_ROWS` i `mockdata/products.py`
(pris som tal, eller `(tilbudspris, førpris)` for et tilbud). Kalder funktionen
en ny Supabase-tabel/RPC, så giv den et svar i `mockdata/offline.py::supabase_rest`
- ukendte tabeller svarer en tom liste.

Ikke dækket endnu: login/konto-sider (gemt kurv, prisalarmer, personlig
besparelse) og opskrifternes indhold (listen er tom).
