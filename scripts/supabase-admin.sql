-- ===========================================================================
-- MadShopper - admin-system (kør i Supabase SQL Editor, én gang)
-- ===========================================================================
-- Giver /admin-siden (templates/admin.html + static/js/admin.js) data.
--
-- Sikkerhedsmodel (samme som resten, CLAUDE.md § Sikkerhed):
--   * Siden er en tom skal i den delte edge-cache - INGEN data i HTML'en.
--     Alt hentes i browseren via supabase-js med brugerens eget login-JWT.
--   * Hvem der er admin, står i public.admin_users. Tabellen er helt lukket
--     for anon/authenticated (ingen grants), så den kan hverken læses eller
--     skrives med den offentlige nøgle - kun via SQL Editor/service_role.
--   * Hver admin_*-RPC er SECURITY DEFINER og tjekker selv _require_admin()
--     som første linje. Uden en række i admin_users kaster den 'forbidden'.
--     service_role-nøglen kommer aldrig i browseren eller worker'en.
--   * Skrivning (opskrift-status) sker kun gennem admin_set_recipe_status,
--     der validerer værdien i SQL - ingen direkte tabelskrivning.
--
-- Gør en bruger til admin (personen skal have oprettet konto først):
--   INSERT INTO public.admin_users (user_id, note)
--   SELECT id, 'ejer' FROM auth.users WHERE email = 'din@mail.dk'
--   ON CONFLICT (user_id) DO NOTHING;
-- Fjern igen:
--   DELETE FROM public.admin_users
--   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'din@mail.dk');
--
-- Staging/lokal læser de samme admin-RPC'er (prod-tabellerne): admin-data er
-- ren læsning ud over opskrift-moderering, og opskrifter har ingen _dev-
-- variant (se supabase-recipes.sql). Kør scriptet igen efter ændringer -
-- alt er idempotent (IF NOT EXISTS / CREATE OR REPLACE).


-- ---------------------------------------------------------------------------
-- admin_users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.admin_users FROM anon, authenticated;
GRANT ALL ON public.admin_users TO service_role;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role fuld adgang" ON public.admin_users;
CREATE POLICY "Service role fuld adgang" ON public.admin_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ---------------------------------------------------------------------------
-- is_admin() - må kaldes af enhver indlogget bruger; svarer kun true/false
-- for den kaldende bruger selv (aldrig for et vilkårligt id).
-- ---------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.is_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;


-- Intern vagt - ikke kaldbar udefra.
CREATE OR REPLACE FUNCTION public._require_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._require_admin() FROM public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- admin_overview() - nøgletal til forsiden af admin.
-- Valgfri tabeller slås op med to_regclass, så en database uden fx
-- shared_carts ikke får hele oversigten til at fejle - nøglen udelades bare.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  res jsonb;
  extra jsonb;
  n bigint;
BEGIN
  PERFORM public._require_admin();

  SELECT jsonb_build_object(
    'users_total',     count(*),
    'users_new_7d',    count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
    'users_active_7d', count(*) FILTER (WHERE last_sign_in_at >= now() - interval '7 days'))
  INTO res FROM auth.users;

  SELECT count(*) INTO n FROM public.admin_users;
  res := res || jsonb_build_object('admins_total', n);

  IF to_regclass('public.carts') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.carts WHERE jsonb_array_length(items) > 0' INTO n;
    res := res || jsonb_build_object('carts_nonempty', n);
  END IF;

  IF to_regclass('public.price_alerts') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.price_alerts' INTO n;
    res := res || jsonb_build_object('price_alerts_total', n);
  END IF;

  IF to_regclass('public.shared_carts') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.shared_carts' INTO n;
    res := res || jsonb_build_object('shared_carts_total', n);
  END IF;

  IF to_regclass('public.recipes') IS NOT NULL THEN
    EXECUTE $q$
      SELECT jsonb_build_object(
        'recipes_pending',  count(*) FILTER (WHERE status = 'pending'),
        'recipes_approved', count(*) FILTER (WHERE status = 'approved'),
        'recipes_rejected', count(*) FILTER (WHERE status = 'rejected'))
      FROM public.recipes
    $q$ INTO extra;
    res := res || extra;
  END IF;

  IF to_regclass('public.cart_events') IS NOT NULL THEN
    EXECUTE $q$
      SELECT jsonb_build_object(
        'cart_adds_7d',     coalesce(sum(events) FILTER (WHERE event_type = 'add'), 0),
        'cart_compares_7d', coalesce(sum(events) FILTER (WHERE event_type = 'compare'), 0))
      FROM public.cart_events
      WHERE hour >= (timezone('Europe/Copenhagen', now()) - interval '7 days')
    $q$ INTO extra;
    res := res || extra;
  END IF;

  RETURN res || jsonb_build_object('generated_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_overview() TO authenticated;


-- ---------------------------------------------------------------------------
-- admin_top_products(p_days) - mest lagt-i-kurv de sidste p_days dage.
-- cart_events er anonym (ingen bruger-kolonne), så dette er rene tællere.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_top_products(p_days integer DEFAULT 7)
RETURNS TABLE (product_id text, adds bigint, compares bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._require_admin();
  IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN
    RAISE EXCEPTION 'invalid days';
  END IF;
  IF to_regclass('public.cart_events') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE $q$
    SELECT e.product_id,
           coalesce(sum(e.events) FILTER (WHERE e.event_type = 'add'), 0)::bigint,
           coalesce(sum(e.events) FILTER (WHERE e.event_type = 'compare'), 0)::bigint
    FROM public.cart_events e
    WHERE e.hour >= (timezone('Europe/Copenhagen', now()) - make_interval(days => $1))
    GROUP BY e.product_id
    ORDER BY 2 DESC, 3 DESC
    LIMIT 25
  $q$ USING p_days;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_top_products(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_top_products(integer) TO authenticated;


-- ---------------------------------------------------------------------------
-- admin_list_users(p_search, p_limit, p_offset) - nyeste først.
-- Kun de felter admin-siden viser; ingen tokens/metadata-dump.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT '',
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id         uuid,
  email           text,
  provider        text,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  confirmed       boolean,
  is_admin        boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  q text := lower(trim(coalesce(p_search, '')));
BEGIN
  PERFORM public._require_admin();
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN p_limit := 50; END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN p_offset := 0; END IF;
  IF length(q) > 100 THEN RAISE EXCEPTION 'search too long'; END IF;

  RETURN QUERY
  SELECT u.id,
         u.email::text,
         coalesce(u.raw_app_meta_data->>'provider', '')::text,
         u.created_at,
         u.last_sign_in_at,
         (u.email_confirmed_at IS NOT NULL),
         EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = u.id)
  FROM auth.users u
  WHERE q = '' OR position(q IN lower(coalesce(u.email, ''))) > 0
  ORDER BY u.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users(text, integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, integer, integer) TO authenticated;


-- ---------------------------------------------------------------------------
-- admin_list_recipes(p_status, p_limit) - moderationskø.
-- submitted_by-emailen vises KUN her (admin), aldrig via de offentlige
-- grants (GDPR-031 i supabase-recipes.sql).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_recipes(
  p_status text DEFAULT 'pending',
  p_limit  integer DEFAULT 50
)
RETURNS TABLE (
  id                 bigint,
  title              text,
  source_url         text,
  source_name        text,
  image_url          text,
  imported_via       text,
  status             text,
  created_at         timestamptz,
  submitted_by_email text,
  ingredient_count   bigint,
  matched_count      bigint,
  ingredients        text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._require_admin();
  IF p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN p_limit := 50; END IF;

  RETURN QUERY
  SELECT r.id, r.title, r.source_url, r.source_name, r.image_url,
         r.imported_via, r.status, r.created_at,
         u.email::text,
         count(i.id),
         count(i.id) FILTER (WHERE i.matched_product_id IS NOT NULL),
         coalesce(array_agg(i.raw_text ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL), '{}')
  FROM public.recipes r
  LEFT JOIN auth.users u ON u.id = r.submitted_by
  LEFT JOIN public.recipe_ingredients i ON i.recipe_id = r.id
  WHERE r.status = p_status
  GROUP BY r.id, u.email
  ORDER BY r.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_recipes(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_recipes(text, integer) TO authenticated;


-- ---------------------------------------------------------------------------
-- admin_set_recipe_status(p_id, p_status) - eneste skrivevej fra admin-siden.
-- Erstatter "sæt status='approved' i Supabase-dashboardet" fra
-- supabase-recipes.sql's header. approved_at sættes/ryddes i samme skridt.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_recipe_status(p_id bigint, p_status text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_status text;
BEGIN
  PERFORM public._require_admin();
  IF p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  UPDATE public.recipes
  SET status = p_status,
      approved_at = CASE WHEN p_status = 'approved' THEN now() ELSE NULL END
  WHERE id = p_id
  RETURNING status INTO new_status;

  IF new_status IS NULL THEN
    RAISE EXCEPTION 'recipe not found';
  END IF;
  RETURN new_status;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_recipe_status(bigint, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_recipe_status(bigint, text) TO authenticated;
