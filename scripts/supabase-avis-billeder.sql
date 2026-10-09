-- Varebilleder klippet ud af butikkernes egne avis-PDF'er (scraper/webscrape_lovbjerg.py).
--
-- Offentlig bucket: billederne vises direkte på madshopper.dk og i appen via
-- /storage/v1/object/public/avis-billeder/... Kun scraper-kontoen
-- (scripts/supabase-scraper-account.sql) må lægge op og slette.
-- Kun JPEG under 200 KB; scraperen gemmer kun ugens madtilbud og rydder
-- billeder, som ingen vare har brugt i 14 dage.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avis-billeder', 'avis-billeder', true, 200000, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "scraper_bot_avis_billeder" ON storage.objects;
CREATE POLICY "scraper_bot_avis_billeder"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'avis-billeder' AND auth.uid() = public._scraper_bot_uid())
  WITH CHECK (bucket_id = 'avis-billeder' AND auth.uid() = public._scraper_bot_uid());
