-- Privat site: kun brugere en admin har godkendt, kan se madshopper.dk.
--
-- Godkendelsen er auth.users.raw_app_meta_data.approved = true. Supabase
-- lægger app_metadata ind i hver access-token, og workeren
-- (src/worker.py::_site_gate, site_gate.py) læser den derfra efter at have
-- tjekket tokenets signatur. Brugeren kan ikke selv ændre app_metadata (kun
-- service-rollen og funktionerne herunder), modsat user_metadata.
--
-- En ændring slår igennem, når brugerens token fornyes (højst 1 time; "Tjek
-- igen" på login-siden fornyer med det samme).
--
-- Kræver scripts/supabase-admin.sql (is_admin). Køres i Supabase SQL Editor
-- FØR koden deployes, ellers kommer kun admins ind (via trin 3 nedenfor).

-- 1) Liste over brugere til admin-panelet (ren læsning, kun admins).
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  user_id         uuid,
  email           text,
  provider        text,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  approved        boolean,
  is_admin        boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT u.id,
           u.email::text,
           COALESCE(u.raw_app_meta_data->>'provider', '')::text,
           u.created_at,
           u.last_sign_in_at,
           COALESCE((u.raw_app_meta_data->>'approved')::boolean, false),
           EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = u.id)
      FROM auth.users u
     WHERE u.deleted_at IS NULL
     ORDER BY COALESCE((u.raw_app_meta_data->>'approved')::boolean, false),
              u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;


-- 2) Godkend / fjern godkendelse (kun admins). En admin kan ikke fjerne sin
--    egen adgang ved et uheld.
CREATE OR REPLACE FUNCTION public.admin_set_approved(p_user_id uuid, p_approved boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_approved IS NULL THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = auth.uid() AND NOT p_approved THEN
    RAISE EXCEPTION 'kan ikke fjerne egen adgang' USING ERRCODE = '22023';
  END IF;
  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('approved', p_approved)
   WHERE id = p_user_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_approved(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_approved(uuid, boolean) TO authenticated;


-- 3) Admins er altid godkendt (ellers låser de sig ude af panelet).
UPDATE auth.users u
   SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb)
                           || '{"approved": true}'::jsonb
 WHERE EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = u.id);

-- Valgfrit: godkend ALLE eksisterende konti på én gang (kun hvis det er valgt).
-- UPDATE auth.users
--    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
--                            || '{"approved": true}'::jsonb
--  WHERE deleted_at IS NULL;
