-- ===========================================================================
-- MadShopper - admin-panel (/admin) (kør i Supabase SQL Editor)
-- ===========================================================================
-- Sikkerhedsmodel: samme som resten af projektet (se supabase-hardening.sql).
-- Den offentlige nøgle får INGEN ny tabeladgang. Alt admin-data går gennem
-- SECURITY DEFINER-RPC'er, der som det første tjekker public.is_admin() mod
-- auth.uid() - dvs. mod den indloggede brugers EGEN, Supabase-signerede JWT.
-- Hvem der er admin, står kun i public.admin_users, som ingen klient kan læse
-- eller skrive (RLS uden policies + REVOKE).
--
-- Læser altid produktionens tabeller, også fra staging: tallene er ren
-- læsning, og et admin-overblik over *_dev-kopierne siger intet.
--
-- Efter kørsel: indsæt din egen konto (én gang) - se bunden af filen.


-- ---------------------------------------------------------------------------
-- Hvem er admin
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.admin_users FROM anon, authenticated;
GRANT ALL ON public.admin_users TO service_role;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
-- Ingen policies for anon/authenticated: tabellen er usynlig for klienter.


CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;


-- ---------------------------------------------------------------------------
-- Overblik (ren læsning)
-- ---------------------------------------------------------------------------
-- price_history (1,2 mio. rækker) røres bevidst ikke: dens PK starter med
-- product_id, så max(date) ville være en fuld scanning. price_last_seen
-- (~50k rækker) bærer samme "hvornår kom der sidst priser"-signal billigt.
CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '8s'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),

    'users', (
      SELECT jsonb_build_object(
        'total',     count(*),
        'confirmed', count(*) FILTER (WHERE email_confirmed_at IS NOT NULL),
        'new_7d',    count(*) FILTER (WHERE created_at > now() - interval '7 days'),
        'new_30d',   count(*) FILTER (WHERE created_at > now() - interval '30 days'),
        'active_7d', count(*) FILTER (WHERE last_sign_in_at > now() - interval '7 days')
      )
      FROM auth.users
    ),

    'recent_users', (
      SELECT coalesce(jsonb_agg(u ORDER BY u.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT email,
               created_at,
               last_sign_in_at,
               email_confirmed_at IS NOT NULL AS confirmed,
               coalesce(raw_app_meta_data->>'provider', '') AS provider
        FROM auth.users
        ORDER BY created_at DESC
        LIMIT 15
      ) u
    ),

    'stores', (
      SELECT coalesce(jsonb_agg(s ORDER BY s.butik), '[]'::jsonb)
      FROM (
        SELECT butik,
               count(*)        AS products,
               max(scraped_at) AS last_scraped
        FROM public.produkter
        GROUP BY butik
      ) s
    ),

    'prices_last_checked', (SELECT max(last_checked_date) FROM public.price_last_seen),
    'nutrition_updated',   (SELECT max(updated_at) FROM public.nutrition_data),

    'database', jsonb_build_object(
      'size_bytes',  pg_database_size(current_database()),
      -- Gratis-planens grænse. Ændres planen, ændres kun dette tal.
      'limit_bytes', 500 * 1024 * 1024
    ),

    'tables', (
      SELECT coalesce(jsonb_agg(t ORDER BY t.bytes DESC), '[]'::jsonb)
      FROM (
        SELECT c.relname                     AS name,
               pg_total_relation_size(c.oid) AS bytes,
               greatest(c.reltuples, 0)::bigint AS rows_estimate
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 10
      ) t
    ),

    'engagement', jsonb_build_object(
      'price_alerts_active', (SELECT count(*) FROM public.price_alerts WHERE is_active = 1),
      'carts',               (SELECT count(*) FROM public.carts),
      'shared_carts',        (SELECT count(*) FROM public.shared_carts),
      'cart_events_7d',      (SELECT coalesce(sum(events), 0) FROM public.cart_events
                              WHERE hour > now() - interval '7 days'),
      'savings_users',       (SELECT count(*) FROM public.user_monthly_savings)
    ),

    'security_24h', (
      SELECT coalesce(jsonb_agg(e ORDER BY e.events DESC), '[]'::jsonb)
      FROM (
        SELECT kind, sum(events)::bigint AS events
        FROM public.security_events
        WHERE bucket > now() - interval '24 hours'
        GROUP BY kind
      ) e
    ),

    'recipes', (
      SELECT jsonb_build_object(
        'approved', count(*) FILTER (WHERE status = 'approved'),
        'pending',  count(*) FILTER (WHERE status = 'pending'),
        'rejected', count(*) FILTER (WHERE status = 'rejected')
      )
      FROM public.recipes
    ),

    'pending_recipes', (
      SELECT coalesce(jsonb_agg(r ORDER BY r.created_at), '[]'::jsonb)
      FROM (
        SELECT id, title, source_url, source_name, imported_via, created_at
        FROM public.recipes
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT 50
      ) r
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_overview() TO authenticated;


-- ---------------------------------------------------------------------------
-- Opskrift-moderering: den eneste skrivning panelet kan
-- ---------------------------------------------------------------------------
-- Erstatter "sæt status manuelt i Supabase" (se supabase-recipes.sql og
-- recipe_importer.py::moderate_pending_recipes).
CREATE OR REPLACE FUNCTION public.admin_set_recipe_status(p_recipe_id bigint, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('approved', 'rejected', 'pending') THEN
    RAISE EXCEPTION 'ugyldig status: %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.recipes
     SET status      = p_status,
         approved_at = CASE WHEN p_status = 'approved' THEN now() ELSE NULL END
   WHERE id = p_recipe_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'opskrift % findes ikke', p_recipe_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_recipe_status(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_recipe_status(bigint, text) TO authenticated;


-- ---------------------------------------------------------------------------
-- Feedback
-- ---------------------------------------------------------------------------
-- Feedback-formularen (/api/feedback i app.py) skriver direkte hertil via
-- submit_feedback() nedenfor - ingen D1-kø, intet relay-job, intet Google
-- Sheet. Svarene læses og markeres håndteret i /admin.
--
-- env: 'prod' fra produktions-workeren, 'dev' fra staging og lokalt (følger
-- TABLE_SUFFIX), så testbeskeder kan skelnes i panelet uden en *_dev-tabel.
CREATE TABLE IF NOT EXISTS public.feedback (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  env           text NOT NULL DEFAULT 'prod' CHECK (env IN ('prod', 'dev')),
  feedback_type text NOT NULL DEFAULT 'feedback'
                CHECK (feedback_type IN ('feedback', 'bug', 'feature', 'other')),
  name          text NOT NULL DEFAULT '' CHECK (char_length(name) <= 120),
  email         text NOT NULL DEFAULT '' CHECK (char_length(email) <= 254),
  subject       text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 200),
  message       text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 500),
  page_url      text NOT NULL DEFAULT '' CHECK (char_length(page_url) <= 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  handled_at    timestamptz
);

CREATE INDEX IF NOT EXISTS feedback_created_idx ON public.feedback (created_at DESC);

REVOKE ALL ON public.feedback FROM anon, authenticated;
GRANT ALL ON public.feedback TO service_role;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role fuld adgang" ON public.feedback;
CREATE POLICY "Service role fuld adgang" ON public.feedback
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- Eneste skrivevej. Gentager appens validering i SQL (projektets regel), fordi
-- den offentlige nøgle kan kalde RPC'en direkte uden om Turnstile-tjekket i
-- app.py. Derfor også et globalt loft: højst 30 beskeder pr. time og 200 pr.
-- døgn, så spam uden om formularen kan genere, men aldrig fylde databasen.
-- Afvises en besked af loftet, får brugeren 503 + "prøv igen" fra app.py.
CREATE OR REPLACE FUNCTION public.submit_feedback(
  p_type     text,
  p_name     text,
  p_email    text,
  p_subject  text,
  p_message  text,
  p_page_url text,
  p_env      text DEFAULT 'prod'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type    text := coalesce(nullif(btrim(p_type), ''), 'feedback');
  v_message text := btrim(coalesce(p_message, ''));
  v_email   text := left(btrim(coalesce(p_email, '')), 254);
  v_url     text := left(btrim(coalesce(p_page_url, '')), 500);
BEGIN
  IF char_length(v_message) < 10 OR char_length(v_message) > 500 THEN
    RAISE EXCEPTION 'ugyldig besked' USING ERRCODE = '22023';
  END IF;
  IF v_type NOT IN ('feedback', 'bug', 'feature', 'other') THEN
    v_type := 'feedback';
  END IF;
  IF v_email <> '' AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' THEN
    v_email := '';
  END IF;
  IF v_url <> '' AND v_url !~* '^https?://\S+$' THEN
    v_url := '';
  END IF;

  IF (SELECT count(*) FROM public.feedback WHERE created_at > now() - interval '1 hour') >= 30
     OR (SELECT count(*) FROM public.feedback WHERE created_at > now() - interval '1 day') >= 200 THEN
    RAISE EXCEPTION 'feedback-loft naaet' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.feedback (env, feedback_type, name, email, subject, message, page_url)
  VALUES (
    CASE WHEN p_env = 'dev' THEN 'dev' ELSE 'prod' END,
    v_type,
    left(btrim(coalesce(p_name, '')), 120),
    v_email,
    left(btrim(coalesce(p_subject, '')), 200),
    v_message,
    v_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_feedback(text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_feedback(text, text, text, text, text, text, text) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.admin_feedback(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(f ORDER BY f.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT id, env, feedback_type, name, email, subject, message, page_url,
             created_at, handled_at
      FROM public.feedback
      ORDER BY created_at DESC
      LIMIT least(greatest(coalesce(p_limit, 100), 1), 500)
    ) f
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_feedback(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_feedback(integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_set_feedback_handled(p_id bigint, p_handled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.feedback
     SET handled_at = CASE WHEN p_handled THEN now() ELSE NULL END
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback % findes ikke', p_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_feedback_handled(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_feedback_handled(bigint, boolean) TO authenticated;


-- ---------------------------------------------------------------------------
-- Kørselshistorik (GitHub Actions) til admin-panelets "Kørsler"
-- ---------------------------------------------------------------------------
-- Skrives af scripts/sync-job-runs.py, et trin i security-monitor.yml, der henter
-- de seneste kørsler med workflowets egen GITHUB_TOKEN og upserter dem her med
-- service_role. Ingen klient kan skrive; admins læser via admin_job_runs().
-- En række pr. GitHub-kørsel (id = run id), så en kørsel der stod "i gang" ved
-- én synk bliver rettet til sit udfald ved den næste. Scriptet sletter rækker
-- ældre end 90 dage, så tabellen bliver ved med at være lille (~30 rækker/døgn).
CREATE TABLE IF NOT EXISTS public.job_runs (
  id          bigint PRIMARY KEY,
  workflow    text NOT NULL,
  path        text NOT NULL DEFAULT '',
  event       text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT '',
  conclusion  text,
  branch      text NOT NULL DEFAULT '',
  run_number  integer,
  run_attempt integer,
  created_at  timestamptz NOT NULL,
  started_at  timestamptz,
  updated_at  timestamptz,
  url         text NOT NULL DEFAULT '',
  synced_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_runs_created_idx ON public.job_runs (created_at DESC);

REVOKE ALL ON public.job_runs FROM anon, authenticated;
GRANT ALL ON public.job_runs TO service_role;
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role fuld adgang" ON public.job_runs;
CREATE POLICY "Service role fuld adgang" ON public.job_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);


CREATE OR REPLACE FUNCTION public.admin_job_runs(p_days integer DEFAULT 14)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'synced_at', (SELECT max(synced_at) FROM public.job_runs),
    'runs', (
      SELECT coalesce(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT id, workflow, path, event, status, conclusion, branch, run_number,
               run_attempt, created_at, started_at, updated_at, url
        FROM public.job_runs
        WHERE created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90))
        ORDER BY created_at DESC
        LIMIT 1000
      ) r
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_job_runs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_job_runs(integer) TO authenticated;


-- ---------------------------------------------------------------------------
-- Gør din konto til admin (én gang, ret e-mailen hvis nødvendigt)
-- ---------------------------------------------------------------------------
-- INSERT INTO public.admin_users (user_id)
-- SELECT id FROM auth.users WHERE email = 'DIN-EMAIL-HER'
-- ON CONFLICT DO NOTHING;
