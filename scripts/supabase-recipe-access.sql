-- Kør i Supabase SQL Editor (Dashboard → SQL → New query), én gang.
-- Betaling for opskrifter (docs/abonnement.md). Kræver scripts/supabase-admin.sql
-- (is_admin). Kan køres igen uden skade.
--
-- recipe_access husker hvem der har betalt for opskrifterne, og hvor længe.
-- Én række pr. konto. Rækken skrives KUN af edge-funktionen recipe-access
-- (supabase/functions/recipe-access) med service-nøglen, efter den har tjekket
-- Apples signatur på købet. Browseren og appen kan kun spørge med
-- has_recipe_access(), aldrig skrive.
--
-- Én tabel for prod og dev (ingen _dev): et køb hører til kontoen, ikke til
-- et miljø, og staging læser alligevel kun som admin.

CREATE TABLE IF NOT EXISTS public.recipe_access (
  user_id                 uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Apples id for abonnementet. Samme abonnement kan kun låse én konto op.
  original_transaction_id text NOT NULL UNIQUE,
  product_id              text NOT NULL,
  -- 'Production' eller 'Sandbox' (TestFlight og Apples gennemgang).
  environment             text NOT NULL,
  expires_at              timestamptz NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recipe_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipe_access FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_access TO service_role;

-- Har den indloggede konto adgang til opskrifterne lige nu? Admins altid,
-- så Kalle kan teste uden at købe. Kaldes af app.py (med brugerens egen
-- token) og af appen.
CREATE OR REPLACE FUNCTION public.has_recipe_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.recipe_access
      WHERE user_id = auth.uid() AND expires_at > now()
    )
  );
$$;
REVOKE ALL ON FUNCTION public.has_recipe_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_recipe_access() TO authenticated;
