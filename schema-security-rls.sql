-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY FIX: Restringi policy RLS per anon (solo lettura)
-- Esegui nel SQL Editor di Supabase:
-- https://supabase.com/dashboard/project/ubgpohirljxmnamuzuqi/sql
--
-- PROBLEMA: anon_members e anon_bonuses consentivano FOR ALL (lettura + scrittura)
-- agli utenti anonimi. La ANON_KEY è pubblica nel frontend, quindi chiunque
-- poteva inserire/modificare/cancellare membri e bonus senza autenticarsi.
--
-- FIX: anon può solo leggere. Le scritture richiedono utente autenticato.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Rimuovi le policy anon permissive su members
DROP POLICY IF EXISTS "anon_members" ON public.members;

-- 2. Ricrea con solo SELECT per anon
CREATE POLICY "anon_members_read" ON public.members
  FOR SELECT TO anon USING (true);

-- 3. Rimuovi le policy anon permissive su cwl_bonuses
DROP POLICY IF EXISTS "anon_bonuses" ON public.cwl_bonuses;

-- 4. Ricrea con solo SELECT per anon
CREATE POLICY "anon_bonuses_read" ON public.cwl_bonuses
  FOR SELECT TO anon USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICA: dopo aver applicato, le policy attive dovrebbero essere:
--
-- members:
--   auth_members   → authenticated, FOR ALL  (lettura + scrittura per utenti loggati)
--   anon_members_read → anon, FOR SELECT      (solo lettura pubblica)
--
-- cwl_bonuses:
--   auth_bonuses   → authenticated, FOR ALL
--   anon_bonuses_read → anon, FOR SELECT
-- ─────────────────────────────────────────────────────────────────────────────
