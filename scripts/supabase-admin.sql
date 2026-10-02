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
-- Feedback-arkiv
-- ---------------------------------------------------------------------------
-- Feedback-formularen skriver til D1 (pending_feedback), og
-- scripts/relay-feedback-to-sheet.py sender den videre til Google Sheet og
-- sletter den fra D1. Relayen gemmer nu en kopi her FØR sletningen, så svarene
-- kan læses i /admin. Kun service_role (relayen) skriver; admin læser og
-- markerer håndteret via RPC'erne nedenfor. d1_id gør relayen idempotent, hvis
-- en kørsel fejler halvvejs og samme række prøves igen.
CREATE TABLE IF NOT EXISTS public.feedback (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  d1_id         bigint UNIQUE,
  feedback_type text NOT NULL DEFAULT 'feedback',
  name          text NOT NULL DEFAULT '',
  email         text NOT NULL DEFAULT '',
  subject       text NOT NULL DEFAULT '',
  message       text NOT NULL DEFAULT '',
  page_url      text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz NOT NULL DEFAULT now(),
  handled_at    timestamptz
);

CREATE INDEX IF NOT EXISTS feedback_created_idx ON public.feedback (created_at DESC);

REVOKE ALL ON public.feedback FROM anon, authenticated;
GRANT ALL ON public.feedback TO service_role;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role fuld adgang" ON public.feedback;
CREATE POLICY "Service role fuld adgang" ON public.feedback
  FOR ALL TO service_role USING (true) WITH CHECK (true);


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
      SELECT id, feedback_type, name, email, subject, message, page_url,
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
-- Gør din konto til admin (én gang, ret e-mailen hvis nødvendigt)
-- ---------------------------------------------------------------------------
-- INSERT INTO public.admin_users (user_id)
-- SELECT id FROM auth.users WHERE email = 'DIN-EMAIL-HER'
-- ON CONFLICT DO NOTHING;
