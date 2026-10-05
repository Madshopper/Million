-- Fanen App i /admin: appens tal fra Apple + egne brugertal.
--
-- Køres én gang i Supabase SQL Editor (efter supabase-admin.sql, som giver
-- is_admin()). Tabellerne skrives kun af scripts/app-store-stats.py
-- (app-stats.yml) med service_role; admins læser via admin_app_stats().

-- ---------------------------------------------------------------------------
-- Tal fra Apple: én række pr. dag og måling.
-- metric: downloads, redownloads, updates (salgsrapporten), impressions,
-- page_views, deletions, sessions, crashes, crashes:<version> (Analytics
-- Reports), rating_avg, rating_count (Apples offentlige opslag, dagens tal).
-- ~10 rækker pr. dag, så tabellen bliver ved med at være lille.
CREATE TABLE IF NOT EXISTS public.app_store_daily (
  day        date    NOT NULL,
  metric     text    NOT NULL,
  value      numeric NOT NULL DEFAULT 0,
  synced_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, metric)
);

CREATE TABLE IF NOT EXISTS public.app_store_reviews (
  id          text PRIMARY KEY,
  rating      integer,
  title       text NOT NULL DEFAULT '',
  body        text NOT NULL DEFAULT '',
  author      text NOT NULL DEFAULT '',
  version     text NOT NULL DEFAULT '',
  created_at  timestamptz
);

REVOKE ALL ON public.app_store_daily, public.app_store_reviews FROM anon, authenticated;
GRANT ALL ON public.app_store_daily, public.app_store_reviews TO service_role;
ALTER TABLE public.app_store_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_store_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role fuld adgang" ON public.app_store_daily;
CREATE POLICY "Service role fuld adgang" ON public.app_store_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role fuld adgang" ON public.app_store_reviews;
CREATE POLICY "Service role fuld adgang" ON public.app_store_reviews
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ---------------------------------------------------------------------------
-- Alt til fanen i ét kald.
-- App eller hjemmeside afgøres ud fra login-sessionens user_agent: appen
-- sender "MadShopper/<build> CFNetwork/... Darwin" (iPhone) eller okhttp
-- (Android), browsere sender "Mozilla/...". Andet (fx test-scripts) tælles
-- ikke med. En bruger kan tælle i begge.
CREATE OR REPLACE FUNCTION public.admin_app_stats(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_days integer := least(greatest(coalesce(p_days, 90), 7), 400);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'synced_at', (SELECT max(synced_at) FROM public.app_store_daily),

    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day', day, 'metric', metric, 'value', value)
                                ORDER BY day, metric), '[]'::jsonb)
      FROM public.app_store_daily
      WHERE day > current_date - v_days
    ),

    'totals', (
      SELECT coalesce(jsonb_object_agg(metric, total), '{}'::jsonb)
      FROM (
        SELECT metric, sum(value) AS total
        FROM public.app_store_daily
        WHERE metric IN ('downloads', 'redownloads', 'updates', 'deletions')
        GROUP BY metric
      ) t
    ),

    'rating', (
      SELECT jsonb_build_object(
        'avg',   max(value) FILTER (WHERE metric = 'rating_avg'),
        'count', max(value) FILTER (WHERE metric = 'rating_count'),
        'day',   max(day))
      FROM public.app_store_daily
      WHERE day = (SELECT max(day) FROM public.app_store_daily WHERE metric = 'rating_count')
        AND metric IN ('rating_avg', 'rating_count')
    ),

    'reviews', (
      SELECT coalesce(jsonb_agg(r ORDER BY r.created_at DESC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT id, rating, title, body, author, version, created_at
        FROM public.app_store_reviews
        ORDER BY created_at DESC NULLS LAST
        LIMIT 20
      ) r
    ),

    'users', jsonb_build_object(
      'app_30d', (
        SELECT count(DISTINCT user_id) FROM auth.sessions
        WHERE coalesce(updated_at, created_at) > now() - interval '30 days'
          AND (user_agent ILIKE 'MadShopper/%' OR user_agent ILIKE 'okhttp%')),
      'web_30d', (
        SELECT count(DISTINCT user_id) FROM auth.sessions
        WHERE coalesce(updated_at, created_at) > now() - interval '30 days'
          AND user_agent ILIKE 'Mozilla/%'),
      'app_ever', (
        SELECT count(DISTINCT user_id) FROM auth.sessions
        WHERE user_agent ILIKE 'MadShopper/%' OR user_agent ILIKE 'okhttp%'),
      'push_app', (SELECT count(DISTINCT user_id) FROM public.push_devices WHERE kind = 'expo'),
      'push_web', (SELECT count(DISTINCT user_id) FROM public.push_devices WHERE kind = 'web'),
      'weekly', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('week', w.week, 'new', w.n) ORDER BY w.week), '[]'::jsonb)
        FROM (
          SELECT gs::date AS week,
                 (SELECT count(*) FROM auth.users u
                  WHERE u.created_at >= gs AND u.created_at < gs + interval '7 days') AS n
          FROM generate_series(date_trunc('week', now()) - interval '11 weeks',
                               date_trunc('week', now()), interval '1 week') gs
        ) w
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_app_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_app_stats(integer) TO authenticated;
