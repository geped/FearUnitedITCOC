-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY FIX v2: Ripristino scrittura anon su members (necessaria per sync)
-- Esegui nel SQL Editor di Supabase:
-- https://supabase.com/dashboard/project/ubgpohirljxmnamuzuqi/sql
--
-- RAGIONAMENTO:
-- - members: dati pubblici CoC (nomi, th_level, trofei) — la sync li sovrascrive
--   ad ogni esecuzione, quindi un write malevolo viene corretto al prossimo sync.
--   Ripristiniamo la scrittura anon per permettere al render-proxy di sincronizzare.
-- - cwl_bonuses: dati sensibili (assegnazione bonus) — manteniamo solo lettura anon.
--   Le scritture avvengono solo da utenti autenticati.
-- ─────────────────────────────────────────────────────────────────────────────

-- Ripristina scrittura anon su members (render-proxy sync)
DROP POLICY IF EXISTS "anon_members_read" ON public.members;
CREATE POLICY "anon_members" ON public.members
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- cwl_bonuses: mantieni solo lettura per anon (dati sensibili)
-- (anon_bonuses_read è già attiva dal fix precedente — nessuna modifica necessaria)
