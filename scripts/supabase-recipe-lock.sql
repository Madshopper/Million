-- Betalt indhold i opskrifterne kan kun hentes med adgang (sikkerhedstjek 18-10-2026).
--
-- Før: anon-nøglen (offentlig, ligger i hver side) kunne læse recipes.instructions
-- og hele recipe_ingredients direkte via PostgREST, så betalingstjekket i
-- app.py::_recipe_access_ok kun var en dør på hjemmesiden, ikke på databasen.
-- Nu: fremgangsmåden og ingredienslinjerne (raw_text, mængde, enhed, produkt-
-- match) kommer kun ud gennem recipe_content(), der selv spørger
-- has_recipe_access() (betalt eller admin). Den åbne liste beholder titel,
-- billede, pris og ingrediensnavne (madplanens mærker, app.py::get_recipes).
--
-- Kør EFTER supabase-recipes.sql, -recipe-nutrition.sql, -recipe-candidates.sql
-- og -recipe-access.sql. Sikker at køre igen. app.py virker både før og efter
-- (falder tilbage til det gamle opslag, hvis funktionen ikke findes endnu).

REVOKE SELECT (instructions) ON public.recipes FROM anon, authenticated;

-- REVOKE ALL fjerner også TRUNCATE/TRIGGER/REFERENCES, som anon havde fået.
REVOKE ALL ON public.recipe_ingredients FROM anon, authenticated;
GRANT SELECT (recipe_id, position, ingredient_name)
  ON public.recipe_ingredients TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.recipe_content(p_recipe_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'instructions', r.instructions,
    'ingredients', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', i.id, 'position', i.position, 'raw_text', i.raw_text,
               'quantity', i.quantity, 'unit', i.unit,
               'ingredient_name', i.ingredient_name,
               'matched_product_id', i.matched_product_id,
               'match_confidence', i.match_confidence,
               'candidate_product_ids', i.candidate_product_ids)
             ORDER BY i.position)
      FROM public.recipe_ingredients i WHERE i.recipe_id = r.id), '[]'::jsonb))
  FROM public.recipes r
  WHERE r.id = p_recipe_id AND r.status = 'approved'
    AND public.has_recipe_access();
$$;
REVOKE ALL ON FUNCTION public.recipe_content(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recipe_content(bigint) TO authenticated;

-- Tjek bagefter (skal give false, false, true):
-- SELECT has_column_privilege('anon', 'public.recipes', 'instructions', 'SELECT'),
--        has_column_privilege('anon', 'public.recipe_ingredients', 'raw_text', 'SELECT'),
--        has_column_privilege('anon', 'public.recipe_ingredients', 'ingredient_name', 'SELECT');
