-- Kør i Supabase SQL Editor, én gang. Efter supabase-cart-increment.sql,
-- supabase-cart-increment-throttle.sql, supabase-dev-tables.sql og
-- supabase-admin.sql (bruger cart_events(_dev), cart_popularity(_dev) og
-- is_admin()). Kan køres igen uden skade.
--
-- Varestatistik til fanen "Varer" i /admin (app._FEATURES 'stats').
--
-- To lag, så vi beholder så meget som muligt inden for gratis-planens 500 MB:
--  - cart_events: én række pr. vare pr. TIME pr. type. Ryddes efter 30 dage
--    (updater.py::prune_cart_events). Det er de "rå" data.
--  - stats_daily: én række pr. vare (eller søgeord) pr. DØGN pr. type. Ryddes
--    aldrig. Skrives i samme kald som cart_events, så der er intet natligt
--    sammenlægningsjob der kan glemme en dag.
--
-- Persondata: der gemmes kun tællere. Ingen bruger-id, IP, session eller
-- klokkeslæt på dagsniveau. Søgeord renses (små bogstaver, 2-40 tegn) og
-- afvises hvis de ligner en mail eller et telefon-/CPR-nummer (@ eller 5+
-- cifre i træk), så de ikke kan pege på en bestemt person.
--
-- Typer (kind): 'add' = lagt i kurv, 'compare' = prissammenligning,
-- 'view' = åbnet varens detaljer, 'search' = søgning (key er søgeordet).
-- 'view' og 'search' tæller IKKE med i cart_popularity, så forsidens
-- "Brugernes Favoritter" er uændret.

-- ===========================================================================
-- Tabellerne
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.stats_daily (
  day    date    NOT NULL,           -- dansk dato
  kind   text    NOT NULL CHECK (kind IN ('add', 'compare', 'view', 'search')),
  key    text    NOT NULL,           -- produkt-id, eller søgeord for 'search'
  events integer NOT NULL DEFAULT 0,
  qty    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, key)
);

CREATE TABLE IF NOT EXISTS public.stats_daily_dev (LIKE public.stats_daily INCLUDING ALL);

-- Helt lukket for den offentlige nøgle, som cart_events: skrivning kun via
-- RPC'erne nedenfor, læsning kun via admin_stats().
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stats_daily', 'stats_daily_dev'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role fuld adgang" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Service role fuld adgang" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Loft over NYE rækker pr. døgn. RPC'erne kan kaldes direkte med den
-- offentlige nøgle, så uden loft kunne nogen fylde databasen med opdigtede
-- id'er og søgeord. Over loftet tælles kun videre på rækker der findes.
-- Ægte trafik er i dag ca. 20 nye rækker pr. døgn.
CREATE OR REPLACE FUNCTION public._stats_room(tbl text, d date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM public.%I WHERE day = $1 LIMIT 5000) x', tbl)
    INTO n USING d;
  RETURN n < 5000;
END;
$$;
REVOKE ALL ON FUNCTION public._stats_room(text, date) FROM PUBLIC, anon, authenticated;

-- Fælles skrivning af dagstotalerne (prod og dev). agg: [{"key","events","qty"}]
CREATE OR REPLACE FUNCTION public._stats_add(tbl text, p_kind text, agg jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d date := timezone('Europe/Copenhagen', now())::date;
BEGIN
  IF tbl NOT IN ('stats_daily', 'stats_daily_dev') THEN
    RETURN;
  END IF;
  IF public._stats_room(tbl, d) THEN
    EXECUTE format(
      'INSERT INTO public.%1$I (day, kind, key, events, qty)
       SELECT $1, $2, a.key, a.events, a.qty
       FROM jsonb_to_recordset($3) AS a(key text, events int, qty int)
       ON CONFLICT (day, kind, key) DO UPDATE
       SET events = %1$I.events + EXCLUDED.events,
           qty    = %1$I.qty + EXCLUDED.qty', tbl)
    USING d, p_kind, agg;
  ELSE
    EXECUTE format(
      'UPDATE public.%1$I s
       SET events = s.events + a.events, qty = s.qty + a.qty
       FROM jsonb_to_recordset($3) AS a(key text, events int, qty int)
       WHERE s.day = $1 AND s.kind = $2 AND s.key = a.key', tbl)
    USING d, p_kind, agg;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._stats_add(text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- record_cart_activity(_dev): som før + 'view' + dagstotaler
-- ===========================================================================
-- Samme validering, vægtning og 1-sekunds-loft på cart_popularity som i
-- supabase-cart-increment-throttle.sql. Nyt: etype 'view' (vægt 0, rører
-- ikke cart_popularity) og en dagstotal i stats_daily for alle tre typer.
CREATE OR REPLACE FUNCTION public.record_cart_activity(
  items jsonb,
  etype text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  bucket timestamp := date_trunc('hour', timezone('Europe/Copenhagen', now()));
  w integer;
  daily jsonb;
BEGIN
  w := CASE etype WHEN 'compare' THEN 3 WHEN 'add' THEN 1 WHEN 'view' THEN 0 ELSE NULL END;
  IF w IS NULL OR items IS NULL OR jsonb_typeof(items) <> 'array' THEN
    RETURN;
  END IF;

  -- Renset og samlet pr. vare én gang; GROUP BY fjerner dubletter, så ON
  -- CONFLICT ikke rammer samme række to gange.
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', pid, 'events', events, 'qty', qty)), '[]'::jsonb)
  INTO daily
  FROM (
  SELECT pid, count(*)::int AS events, sum(qty)::int AS qty
  FROM (
    SELECT i.pid, LEAST(GREATEST(COALESCE(i.qty, 1), 1), 99) AS qty
    FROM jsonb_to_recordset(items) AS i(pid text, qty int)
    WHERE i.pid IS NOT NULL AND i.pid <> '' AND length(i.pid) <= 64
    LIMIT 50
  ) c
  GROUP BY pid
  ) g;

  IF w > 0 THEN
    INSERT INTO public.cart_popularity (product_id, count, updated_at)
    SELECT a.key, w, now() FROM jsonb_to_recordset(daily) AS a(key text)
    ON CONFLICT (product_id) DO UPDATE
    SET count = cart_popularity.count + w,
        updated_at = now()
    WHERE cart_popularity.updated_at < now() - interval '1 second';
  END IF;

  INSERT INTO public.cart_events (product_id, hour, event_type, events, qty)
  SELECT a.key, bucket, etype, a.events, a.qty
  FROM jsonb_to_recordset(daily) AS a(key text, events int, qty int)
  ON CONFLICT (product_id, hour, event_type) DO UPDATE
  SET events = cart_events.events + EXCLUDED.events,
      qty    = cart_events.qty + EXCLUDED.qty;

  PERFORM public._stats_add('stats_daily', etype, daily);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_cart_activity_dev(
  items jsonb,
  etype text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  bucket timestamp := date_trunc('hour', timezone('Europe/Copenhagen', now()));
  w integer;
  daily jsonb;
BEGIN
  w := CASE etype WHEN 'compare' THEN 3 WHEN 'add' THEN 1 WHEN 'view' THEN 0 ELSE NULL END;
  IF w IS NULL OR items IS NULL OR jsonb_typeof(items) <> 'array' THEN
    RETURN;
  END IF;

  -- Renset og samlet pr. vare én gang; GROUP BY fjerner dubletter, så ON
  -- CONFLICT ikke rammer samme række to gange.
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', pid, 'events', events, 'qty', qty)), '[]'::jsonb)
  INTO daily
  FROM (
  SELECT pid, count(*)::int AS events, sum(qty)::int AS qty
  FROM (
    SELECT i.pid, LEAST(GREATEST(COALESCE(i.qty, 1), 1), 99) AS qty
    FROM jsonb_to_recordset(items) AS i(pid text, qty int)
    WHERE i.pid IS NOT NULL AND i.pid <> '' AND length(i.pid) <= 64
    LIMIT 50
  ) c
  GROUP BY pid
  ) g;

  IF w > 0 THEN
    INSERT INTO public.cart_popularity_dev (product_id, count, updated_at)
    SELECT a.key, w, now() FROM jsonb_to_recordset(daily) AS a(key text)
    ON CONFLICT (product_id) DO UPDATE
    SET count = cart_popularity_dev.count + w,
        updated_at = now()
    WHERE cart_popularity_dev.updated_at < now() - interval '1 second';
  END IF;

  INSERT INTO public.cart_events_dev (product_id, hour, event_type, events, qty)
  SELECT a.key, bucket, etype, a.events, a.qty
  FROM jsonb_to_recordset(daily) AS a(key text, events int, qty int)
  ON CONFLICT (product_id, hour, event_type) DO UPDATE
  SET events = cart_events_dev.events + EXCLUDED.events,
      qty    = cart_events_dev.qty + EXCLUDED.qty;

  PERFORM public._stats_add('stats_daily_dev', etype, daily);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_cart_activity(jsonb, text)     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_cart_activity_dev(jsonb, text) TO anon, authenticated, service_role;

-- ===========================================================================
-- Søgninger
-- ===========================================================================
-- Rensningen her er den egentlige regel (app.py::_clean_search_terms gør det
-- samme for at spare et kald): små bogstaver, ét mellemrum, 2-40 tegn, højst
-- 10 ord pr. kald, intet der ligner en mail eller et nummer.
CREATE OR REPLACE FUNCTION public._stats_search_agg(terms text[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', t, 'events', n, 'qty', n)), '[]'::jsonb)
  FROM (
    SELECT t, count(*)::int AS n
    FROM (
      SELECT lower(regexp_replace(btrim(x), '\s+', ' ', 'g')) AS t
      FROM unnest(terms) AS u(x)
      WHERE x IS NOT NULL
      LIMIT 10
    ) c
    WHERE length(t) BETWEEN 2 AND 40 AND t !~ '@' AND t !~ '[0-9]{5,}'
    GROUP BY t
  ) g;
$$;

CREATE OR REPLACE FUNCTION public.record_search_activity(terms text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF terms IS NULL THEN RETURN; END IF;
  PERFORM public._stats_add('stats_daily', 'search', public._stats_search_agg(terms));
END;
$$;

CREATE OR REPLACE FUNCTION public.record_search_activity_dev(terms text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF terms IS NULL THEN RETURN; END IF;
  PERFORM public._stats_add('stats_daily_dev', 'search', public._stats_search_agg(terms));
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_search_activity(text[])     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_search_activity_dev(text[]) TO anon, authenticated, service_role;

-- ===========================================================================
-- Admin: læsning til fanen "Varer"
-- ===========================================================================
-- p_days: periode (1-3650). p_dev: læs testtabellen (dev.madshopper.dk).
-- Returnerer dagstotaler pr. type (til grafen), de mest populære varer pr.
-- type og de mest søgte ord - alt i perioden, plus samme tal for perioden før,
-- så fanen kan vise om en vare er på vej op.
CREATE OR REPLACE FUNCTION public.admin_stats(p_days integer DEFAULT 30, p_dev boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '8s'
AS $$
DECLARE
  tbl  text := CASE WHEN p_dev THEN 'stats_daily_dev' ELSE 'stats_daily' END;
  n    integer := least(greatest(coalesce(p_days, 30), 1), 3650);
  today date := timezone('Europe/Copenhagen', now())::date;
  since date := today - (n - 1);
  prev  date := since - n;
  out  jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  EXECUTE format($q$
    SELECT jsonb_build_object(
      'since', $1, 'today', $3, 'days', $4,
      'first_day', (SELECT min(day) FROM public.%1$I),
      'daily', (
        SELECT coalesce(jsonb_agg(x ORDER BY x.day, x.kind), '[]'::jsonb) FROM (
          SELECT day, kind, sum(events)::int AS events, sum(qty)::int AS qty
          FROM public.%1$I WHERE day >= $1 GROUP BY day, kind
        ) x),
      'top', (
        SELECT coalesce(jsonb_agg(x ORDER BY x.kind, x.events DESC), '[]'::jsonb) FROM (
          SELECT kind, key, events, qty, prev_events, active_days FROM (
            SELECT kind, key,
                   sum(events) FILTER (WHERE day >= $1)::int AS events,
                   sum(qty)    FILTER (WHERE day >= $1)::int AS qty,
                   coalesce(sum(events) FILTER (WHERE day < $1), 0)::int AS prev_events,
                   count(*)    FILTER (WHERE day >= $1)::int AS active_days,
                   row_number() OVER (PARTITION BY kind
                     ORDER BY sum(events) FILTER (WHERE day >= $1) DESC NULLS LAST, key) AS rn
            FROM public.%1$I WHERE day >= $2
            GROUP BY kind, key
          ) r
          WHERE rn <= 50 AND events > 0
        ) x)
    )$q$, tbl)
  INTO out USING since, prev, today, n;
  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_stats(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_stats(integer, boolean) TO authenticated;

-- ===========================================================================
-- Engangs-overførsel: de timetal der stadig findes (op til 30 dage tilbage)
-- ===========================================================================
-- Kun dage der ikke allerede står i stats_daily, så en ny kørsel af scriptet
-- ikke tæller dobbelt. Kører i samme transaktion som den nye
-- record_cart_activity, så dagen i dag hverken mistes eller tælles to gange.
INSERT INTO public.stats_daily (day, kind, key, events, qty)
SELECT hour::date, event_type, product_id, sum(events), sum(qty)
FROM public.cart_events
WHERE event_type IN ('add', 'compare')
  AND hour::date <= timezone('Europe/Copenhagen', now())::date
  AND NOT EXISTS (SELECT 1 FROM public.stats_daily s WHERE s.day = cart_events.hour::date)
GROUP BY hour::date, event_type, product_id
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.cart_events_dev') IS NOT NULL THEN
    INSERT INTO public.stats_daily_dev (day, kind, key, events, qty)
    SELECT hour::date, event_type, product_id, sum(events), sum(qty)
    FROM public.cart_events_dev
    WHERE event_type IN ('add', 'compare')
      AND hour::date <= timezone('Europe/Copenhagen', now())::date
      AND NOT EXISTS (SELECT 1 FROM public.stats_daily_dev s WHERE s.day = cart_events_dev.hour::date)
    GROUP BY hour::date, event_type, product_id
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
