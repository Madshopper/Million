-- Kør i Supabase SQL Editor (Dashboard → SQL → New query), én gang.
-- Beskeder på telefonen til prisalarmer (docs/prisovervaagning.md).
-- Køres EFTER scripts/supabase-price-alerts-v2.sql. Kan køres igen uden skade.
--
-- push_devices husker hvor en bruger vil have sine beskeder: en app-enhed
-- (kind 'expo', token = ExponentPushToken[...]) eller en browser (kind 'web',
-- token = push-adressen fra browseren + dens to nøgler p256dh/auth).
--
-- Som alt andet (supabase-hardening.sql) skriver browseren og appen ALDRIG
-- direkte i tabellen: kun gennem de to RPC'er nedenfor, der kræver login og
-- validerer i SQL. updater.py læser og rydder op med service-nøglen.

CREATE TABLE IF NOT EXISTS public.push_devices (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('expo', 'web')),
  token        text NOT NULL,
  p256dh       text,
  auth         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS push_devices_token_idx ON public.push_devices (token);
CREATE INDEX IF NOT EXISTS push_devices_user_idx ON public.push_devices (user_id);
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_devices FROM anon, authenticated;
-- Brugeren må se sine egne enheder (ingen policy for
-- INSERT/UPDATE/DELETE: det går kun via RPC'erne).
GRANT SELECT ON public.push_devices TO authenticated;
DROP POLICY IF EXISTS push_devices_own_select ON public.push_devices;
CREATE POLICY push_devices_own_select ON public.push_devices
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- updater.py læser enhederne og sletter dem der er væk.
GRANT SELECT, DELETE ON public.push_devices TO service_role;

CREATE TABLE IF NOT EXISTS public.push_devices_dev (LIKE public.push_devices INCLUDING ALL);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_devices_dev_user_id_fkey') THEN
    ALTER TABLE public.push_devices_dev
      ADD CONSTRAINT push_devices_dev_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE public.push_devices_dev ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_devices_dev FROM anon, authenticated;
GRANT SELECT ON public.push_devices_dev TO authenticated;
DROP POLICY IF EXISTS push_devices_dev_own_select ON public.push_devices_dev;
CREATE POLICY push_devices_dev_own_select ON public.push_devices_dev
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT, DELETE ON public.push_devices_dev TO service_role;


-- ---------------------------------------------------------------------------
-- RPC'erne. Én fælles krop for prod og dev (tabelnavnet er et argument), så
-- valideringen kun står ét sted. Den interne funktion kan ikke kaldes udefra.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._register_push_device(
  tbl text, pkind text, ptoken text, pp256dh text, pauth text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid    uuid := auth.uid();
  n_rows bigint;
BEGIN
  IF uid IS NULL OR tbl NOT IN ('push_devices', 'push_devices_dev') THEN
    RETURN false;
  END IF;
  IF pkind = 'expo' THEN
    IF ptoken IS NULL OR ptoken !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$' THEN
      RETURN false;
    END IF;
    pp256dh := NULL;
    pauth := NULL;
  ELSIF pkind = 'web' THEN
    -- Kun https-adresser, og nøglerne i deres faste længder (base64url).
    IF ptoken IS NULL OR ptoken !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/' OR length(ptoken) > 1000
       OR pp256dh IS NULL OR pp256dh !~ '^[A-Za-z0-9_-]{80,100}=*$'
       OR pauth   IS NULL OR pauth   !~ '^[A-Za-z0-9_-]{16,32}=*$' THEN
      RETURN false;
    END IF;
  ELSE
    RETURN false;
  END IF;

  -- Højst 10 enheder pr. bruger. Den ældste ryger, så en ny telefon altid virker.
  EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id = $1 AND token <> $2', tbl)
    INTO n_rows USING uid, ptoken;
  IF n_rows >= 10 THEN
    EXECUTE format(
      'DELETE FROM public.%I WHERE id IN (SELECT id FROM public.%I WHERE user_id = $1 AND token <> $2
         ORDER BY last_seen_at ASC LIMIT $3)', tbl, tbl)
      USING uid, ptoken, n_rows - 9;
  END IF;

  -- Samme enhed kan skifte bruger (log ud, log ind som en anden): så følger
  -- den den nye bruger, og den gamle får ikke længere beskeder på den.
  EXECUTE format(
    'INSERT INTO public.%I (user_id, kind, token, p256dh, auth)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id, kind = EXCLUDED.kind,
           p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, last_seen_at = now()', tbl)
    USING uid, pkind, ptoken, pp256dh, pauth;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public._register_push_device(text, text, text, text, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._unregister_push_device(tbl text, ptoken text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR ptoken IS NULL OR tbl NOT IN ('push_devices', 'push_devices_dev') THEN
    RETURN false;
  END IF;
  EXECUTE format('DELETE FROM public.%I WHERE token = $1 AND user_id = $2', tbl)
    USING ptoken, uid;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public._unregister_push_device(text, text) FROM public, anon, authenticated;

-- Offentlige indgange (prod + _dev), samme mønster som de andre RPC'er.
CREATE OR REPLACE FUNCTION public.register_push_device(kind text, token text, p256dh text DEFAULT NULL, auth text DEFAULT NULL)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT public._register_push_device('push_devices', kind, token, p256dh, auth) $$;
CREATE OR REPLACE FUNCTION public.register_push_device_dev(kind text, token text, p256dh text DEFAULT NULL, auth text DEFAULT NULL)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT public._register_push_device('push_devices_dev', kind, token, p256dh, auth) $$;
CREATE OR REPLACE FUNCTION public.unregister_push_device(token text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT public._unregister_push_device('push_devices', token) $$;
CREATE OR REPLACE FUNCTION public.unregister_push_device_dev(token text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT public._unregister_push_device('push_devices_dev', token) $$;

REVOKE ALL ON FUNCTION public.register_push_device(text, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.register_push_device_dev(text, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.unregister_push_device(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.unregister_push_device_dev(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_device_dev(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_device(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_device_dev(text) TO authenticated;
