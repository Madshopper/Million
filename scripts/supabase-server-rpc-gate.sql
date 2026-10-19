-- Kun appen kan tælle, og indsendte opskrifter får et loft (sikkerhedstjek 18-10-2026).
--
-- Før: tælle-RPC'erne (kurv, sammenligning, søgning, opskrift-klik) var åbne
-- for alle med den offentlige nøgle. Ét script uden om appens rate limiter
-- kunne derfor give en vare 3 point i sekundet og overtage "Populære varer"
-- på forsiden (den mest populære vare havde 91 point 19-10-2026), eller fylde
-- cart_popularity med opdigtede vare-id'er uden loft.
-- Nu: hver af dem kræver headeren X-MadShopper-Server med en hemmelig nøgle,
-- som kun workeren har (secret SERVER_RPC_KEY, app.py::_supabase_rest). Så
-- går al tælling gennem /api/cart-event og /api/recipe-click og deres
-- rate limiter (20/min/IP). Selve funktionerne er uændrede: de flyttes til
-- skemaet private (som PostgREST ikke viser), og en lille indpakning med
-- samme navn tjekker nøglen og kalder dem.
--
-- Populariteten tæller desuden højst én gang i timen pr. vare.
--
-- submit_recipe får samme slags indpakning med et loft: højst 5 ventende
-- opskrifter pr. konto, 50 nye i døgnet i alt, og kildelink/billede skal være
-- http(s) og højst 1000 tegn (et javascript:-link kunne ellers nå opskrift-siden).
--
-- RÆKKEFØLGE: 1) merge koden, 2) sæt worker-secret SERVER_RPC_KEY på
-- madshopper og madshopper-dev, 3) kør denne fil med nøglen indsat nederst.
-- Uden nøglen i private.settings afvises alle tællinger (fail closed).
-- Sikker at køre igen.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.settings (
  name  text PRIMARY KEY,
  value text NOT NULL
);
REVOKE ALL ON private.settings FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.server_call_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, pg_temp
AS $$
  SELECT coalesce(
    (current_setting('request.headers', true)::json ->> 'x-madshopper-server')
      = (SELECT value FROM private.settings WHERE name = 'server_rpc_key'),
    false);
$$;
REVOKE ALL ON FUNCTION private.server_call_ok() FROM PUBLIC, anon, authenticated;

-- Flyt de oprindelige funktioner til private (kun første gang).
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'record_cart_activity(jsonb,text)', 'record_cart_activity_dev(jsonb,text)',
    'increment_cart_count(text)', 'increment_cart_count_dev(text)',
    'increment_cart_counts(text[])', 'increment_cart_counts_dev(text[])',
    'record_search_activity(text[])', 'record_search_activity_dev(text[])',
    'record_recipe_click(bigint)', 'record_recipe_click_dev(bigint)',
    'submit_recipe(text,text,text,integer,integer,jsonb,text[])']
  LOOP
    IF to_regprocedure('private.' || f) IS NULL AND to_regprocedure('public.' || f) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION public.%s SET SCHEMA private', f);
      EXECUTE format('REVOKE ALL ON FUNCTION private.%s FROM PUBLIC, anon, authenticated', f);
    END IF;
  END LOOP;
END $$;

-- Populariteten tæller højst én gang i timen pr. vare (før: hvert sekund).
-- Selv gennem appens rate limiter kunne én person ellers give en vare 60
-- point i minuttet. Rigtige brugere mærker det ikke: den mest populære vare
-- havde samlet 91 point. cart_events og varestatistikken tæller stadig alt.
DO $$
DECLARE f text; d text;
BEGIN
  FOREACH f IN ARRAY ARRAY['private.record_cart_activity(jsonb,text)',
                           'private.record_cart_activity_dev(jsonb,text)']
  LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      d := pg_get_functiondef(f::regprocedure);
      IF position('interval ''1 second''' in d) > 0 THEN
        EXECUTE replace(d, 'interval ''1 second''', 'interval ''1 hour''');
      END IF;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.record_cart_activity(items jsonb, etype text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.server_call_ok() THEN
    RAISE EXCEPTION 'kun via madshopper.dk' USING ERRCODE = '42501';
  END IF;
  PERFORM private.record_cart_activity(items, etype);
END $$;

CREATE OR REPLACE FUNCTION public.record_cart_activity_dev(items jsonb, etype text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.server_call_ok() THEN
    RAISE EXCEPTION 'kun via madshopper.dk' USING ERRCODE = '42501';
  END IF;
  PERFORM private.record_cart_activity_dev(items, etype);
END $$;

CREATE OR REPLACE FUNCTION public.increment_cart_count(pid text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.server_call_ok() THEN
    RAISE EXCEPTION 'kun via madshopper.dk' USING ERRCODE = '42501';
  END IF;
  PERFORM private.increment_cart_count(pid);
END $$;

CREATE OR REPLACE FUNCTION public.increment_cart_count_dev(pid text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.server_call_ok() THEN
    RAISE EXCEPTION 'kun via madshopper.dk' USING ERRCODE = '42501';
  END IF;
  PERFORM private.increment_cart_count_dev(pid);
END $$;

CREATE OR REPLACE FUNCTION public.increment_cart_counts(pids text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.server_call_ok() THEN
    RAISE EXCEPTION 'kun via madshopper.dk' USING ERRCODE = '42501';
  END IF;
  PERFORM private.increment_cart_counts(pids);
END $$;

CREATE OR REPLACE FUNCTION public.increment_cart_counts_dev(pids text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.server_call_ok() THEN
    RAISE EXCEPTION 'kun via madshopper.dk' USING ERRCODE = '42501';
  END IF;
  PERFORM private.increment_cart_counts_dev(pids);
END $$;

CREATE OR REPLACE FUNCTION public.record_search_activity(terms text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.server_call_ok() THEN
    RAISE EXCEPTION 'kun via madshopper.dk' USING ERRCODE = '42501';
  END IF;
  PERFORM private.record_search_activity(terms);
END $$;

CREATE OR REPLACE FUNCTION public.record_search_activity_dev(terms text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.server_call_ok() THEN
    RAISE EXCEPTION 'kun via madshopper.dk' USING ERRCODE = '42501';
  END IF;
  PERFORM private.record_search_activity_dev(terms);
END $$;

CREATE OR REPLACE FUNCTION public.record_recipe_click(p_recipe_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.server_call_ok() THEN
    RAISE EXCEPTION 'kun via madshopper.dk' USING ERRCODE = '42501';
  END IF;
  PERFORM private.record_recipe_click(p_recipe_id);
END $$;

CREATE OR REPLACE FUNCTION public.record_recipe_click_dev(p_recipe_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.server_call_ok() THEN
    RAISE EXCEPTION 'kun via madshopper.dk' USING ERRCODE = '42501';
  END IF;
  PERFORM private.record_recipe_click_dev(p_recipe_id);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'record_cart_activity(jsonb,text)', 'record_cart_activity_dev(jsonb,text)',
    'increment_cart_count(text)', 'increment_cart_count_dev(text)',
    'increment_cart_counts(text[])', 'increment_cart_counts_dev(text[])',
    'record_search_activity(text[])', 'record_search_activity_dev(text[])',
    'record_recipe_click(bigint)', 'record_recipe_click_dev(bigint)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated, service_role', f);
  END LOOP;
END $$;

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
  -- Låsen gør tællingen nedenfor sikker mod samtidige kald.
  PERFORM pg_advisory_xact_lock(hashtext('submit_recipe'));
  IF (SELECT count(*) FROM public.recipes
      WHERE submitted_by = auth.uid() AND status = 'pending') >= 5 THEN
    RAISE EXCEPTION 'Du har allerede 5 opskrifter der venter på godkendelse'
      USING ERRCODE = '54000';
  END IF;
  IF (SELECT count(*) FROM public.recipes
      WHERE submitted_by IS NOT NULL AND created_at > now() - interval '1 day') >= 50 THEN
    RAISE EXCEPTION 'Opskrift-loft nået, prøv igen i morgen' USING ERRCODE = '54000';
  END IF;
  RETURN private.submit_recipe(p_title, p_source_url, p_image_url, p_servings,
                               p_time_min, p_instructions, p_ingredients);
END $$;
REVOKE ALL ON FUNCTION public.submit_recipe(text,text,text,integer,integer,jsonb,text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_recipe(text,text,text,integer,integer,jsonb,text[])
  TO authenticated, service_role;

-- Til sidst: nøglen. Samme værdi som worker-secret SERVER_RPC_KEY.
-- INSERT INTO private.settings (name, value) VALUES ('server_rpc_key', '<nøglen>')
--   ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
