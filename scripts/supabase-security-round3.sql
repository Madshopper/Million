-- Sikkerhedstjek runde 3 (26-10-2026): de rettelser, der skal ske i databasen.
--
-- RÆKKEFØLGE: 1) merge koden (app.py henter ikke længere prisoversigtens
-- vareliste), 2) kør denne fil i Supabase SQL Editor. Kører du den før
-- koden er ude, viser opskriftsiden ingen pris, indtil koden er deployet.
-- Kræver at scripts/supabase-server-rpc-gate.sql er kørt før.
-- Sikker at køre igen.
--
-- 1. Varelisten bag hver betalt opskrift (recipe_price_snapshot.
--    cheapest_store_breakdown) kan ikke længere læses med den offentlige nøgle.
-- 2. Nøglen til tælle-funktionerne skal være mindst 32 tegn.
-- 3. Kurv-tællingen tager kun rigtige vare-id'er og har et loft pr. døgn, så
--    tabellerne ikke kan vokse uden grænse.
-- 4. Pausen på "Populære varer" tjekkes: står den ikke på 1 time, siger
--    scriptet det højt i stedet for at gøre ingenting.
-- 5. Indsendte opskrifter: loftet tæller også opskrifter fra slettede konti,
--    billedlinket gemmes renset, og portioner/tid skal være rimelige tal.
-- 6. Kildelinket på opskrifter skal starte med http:// eller https:// (også
--    for gamle rækker). Står der en, der ikke gør, tømmes linket først.

-- Stop før noget ændres, hvis nøglen er for kort: så ville al tælling stoppe.
DO $$
BEGIN
  IF coalesce((SELECT length(value) FROM private.settings WHERE name = 'server_rpc_key'), 0) < 32 THEN
    RAISE EXCEPTION 'server_rpc_key er kortere end 32 tegn. Lav en ny nøgle (fx openssl rand -hex 32), sæt den som SERVER_RPC_KEY på begge workere og i private.settings, og kør så scriptet igen. Intet er ændret.';
  END IF;
END $$;

-- 1 -------------------------------------------------------------------------
REVOKE SELECT ON public.recipe_price_snapshot FROM anon, authenticated;
GRANT SELECT (
  recipe_id, computed_at, cheapest_total_price, matched_ingredient_count,
  total_ingredient_count, ingredients_on_sale_count
) ON public.recipe_price_snapshot TO anon, authenticated;

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.server_call_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, pg_temp
AS $$
  SELECT coalesce(
    (SELECT length(value) >= 32 FROM private.settings WHERE name = 'server_rpc_key')
    AND (current_setting('request.headers', true)::json ->> 'x-madshopper-server')
      = (SELECT value FROM private.settings WHERE name = 'server_rpc_key'),
    false);
$$;
REVOKE ALL ON FUNCTION private.server_call_ok() FROM PUBLIC, anon, authenticated;

-- 3 -------------------------------------------------------------------------
-- Vare-id'er ser ud som Remas tal, ean_<hex> eller <butik>_<hex>
-- (samme regel som app.py::_CART_PID_RE). Loftet: højst 20.000 rækker i
-- cart_events det seneste døgn (normalt et par hundrede). Er det nået,
-- tælles der ikke mere, før døgnet er gået.
CREATE OR REPLACE FUNCTION private.clean_cart_items(items jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT coalesce(jsonb_agg(e), '[]'::jsonb)
  FROM (
    SELECT e FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::jsonb END) AS e
    WHERE jsonb_typeof(e) = 'object' AND (e ->> 'pid') ~ '^[A-Za-z0-9_-]{1,64}$'
    LIMIT 50
  ) c;
$$;
REVOKE ALL ON FUNCTION private.clean_cart_items(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_cart_activity(items jsonb, etype text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE clean jsonb := private.clean_cart_items(items);
BEGIN
  IF NOT private.server_call_ok() THEN
    RAISE EXCEPTION 'kun via madshopper.dk' USING ERRCODE = '42501';
  END IF;
  IF jsonb_array_length(clean) = 0 THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.cart_events
      WHERE hour > timezone('Europe/Copenhagen', now()) - interval '1 day') >= 20000 THEN
    RETURN;
  END IF;
  PERFORM private.record_cart_activity(clean, etype);
END $$;

CREATE OR REPLACE FUNCTION public.record_cart_activity_dev(items jsonb, etype text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE clean jsonb := private.clean_cart_items(items);
BEGIN
  IF NOT private.server_call_ok() THEN
    RAISE EXCEPTION 'kun via madshopper.dk' USING ERRCODE = '42501';
  END IF;
  IF jsonb_array_length(clean) = 0 THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.cart_events_dev
      WHERE hour > timezone('Europe/Copenhagen', now()) - interval '1 day') >= 20000 THEN
    RETURN;
  END IF;
  PERFORM private.record_cart_activity_dev(clean, etype);
END $$;

REVOKE ALL ON FUNCTION public.record_cart_activity(jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_cart_activity_dev(jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_cart_activity(jsonb,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_cart_activity_dev(jsonb,text) TO anon, authenticated, service_role;

-- 4 -------------------------------------------------------------------------
DO $$
DECLARE f text; d text;
BEGIN
  FOREACH f IN ARRAY ARRAY['private.record_cart_activity(jsonb,text)',
                           'private.record_cart_activity_dev(jsonb,text)']
  LOOP
    IF to_regprocedure(f) IS NULL THEN
      RAISE WARNING '% findes ikke - kør supabase-server-rpc-gate.sql først', f;
      CONTINUE;
    END IF;
    d := pg_get_functiondef(f::regprocedure);
    IF position('interval ''1 second''' in d) > 0 THEN
      EXECUTE replace(d, 'interval ''1 second''', 'interval ''1 hour''');
      d := pg_get_functiondef(f::regprocedure);
    END IF;
    IF position('interval ''1 hour''' in d) = 0 THEN
      RAISE WARNING '%: pausen på Populære varer er ikke 1 time - tjek funktionen', f;
    END IF;
  END LOOP;
END $$;

-- 5 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_recipe(
  p_title text, p_source_url text, p_image_url text, p_servings integer,
  p_time_min integer, p_instructions jsonb, p_ingredients text[])
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  src text := NULLIF(trim(coalesce(p_source_url, '')), '');
  img text := NULLIF(trim(coalesce(p_image_url, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log ind for at indsende en opskrift' USING ERRCODE = '42501';
  END IF;
  IF (src IS NOT NULL AND (length(src) > 1000 OR src !~* '^https?://'))
     OR (img IS NOT NULL AND (length(img) > 1000 OR img !~* '^https?://')) THEN
    RAISE EXCEPTION 'Links skal starte med http:// eller https:// og være korte'
      USING ERRCODE = '22023';
  END IF;
  IF (p_servings IS NOT NULL AND p_servings NOT BETWEEN 1 AND 100)
     OR (p_time_min IS NOT NULL AND p_time_min NOT BETWEEN 0 AND 10000) THEN
    RAISE EXCEPTION 'Portioner skal være 1-100 og tid 0-10000 minutter'
      USING ERRCODE = '22023';
  END IF;
  -- Låsen gør tællingen nedenfor sikker mod samtidige kald.
  PERFORM pg_advisory_xact_lock(hashtext('submit_recipe'));
  IF (SELECT count(*) FROM public.recipes
      WHERE submitted_by = auth.uid() AND status = 'pending') >= 5 THEN
    RAISE EXCEPTION 'Du har allerede 5 opskrifter der venter på godkendelse'
      USING ERRCODE = '54000';
  END IF;
  -- Alle brugeropskrifter tæller, også dem fra konti der er slettet bagefter
  -- (submitted_by bliver NULL ved sletning, og så kunne loftet omgås).
  IF (SELECT count(*) FROM public.recipes
      WHERE imported_via = 'user_manual' AND created_at > now() - interval '1 day') >= 50 THEN
    RAISE EXCEPTION 'Opskrift-loft nået, prøv igen i morgen' USING ERRCODE = '54000';
  END IF;
  RETURN private.submit_recipe(p_title, src, coalesce(img, ''), p_servings,
                               p_time_min, p_instructions, p_ingredients);
END $$;
REVOKE ALL ON FUNCTION public.submit_recipe(text,text,text,integer,integer,jsonb,text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_recipe(text,text,text,integer,integer,jsonb,text[])
  TO authenticated, service_role;

-- 6 -------------------------------------------------------------------------
UPDATE public.recipes SET source_url = NULL
WHERE source_url IS NOT NULL AND source_url !~* '^https?://';
ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_source_url_http;
ALTER TABLE public.recipes ADD CONSTRAINT recipes_source_url_http
  CHECK (source_url IS NULL OR source_url ~* '^https?://');
