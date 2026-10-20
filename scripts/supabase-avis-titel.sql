-- Kør i Supabase SQL Editor (kørt 13-10-2026).
-- Avisens tilbudstitel pr. vare (Sallings leafletTitle, fx "Haribo slikpose"),
-- skrevet af bilka_katalog.py og foetex_katalog.py. seed-d1.py tæller varer med
-- samme titel som ét tilbud på forsidens butikslogoer: Bilka viste 1.304
-- "tilbud", men avisen havde ~140 tilbud fordelt på 1.304 varianter.
-- Skal findes FØR scraperne kører med koden, ellers fejler deres insert.
ALTER TABLE public.produkter ADD COLUMN IF NOT EXISTS avis_titel text;
