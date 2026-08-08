-- Evento "Clash of Cards" — sezione "Mazzi pubblici": ogni profilo CoC può essere
-- reso pubblico (visibile a tutti gli utenti CoCBoard nella sezione dedicata) o
-- tenuto privato (default). I match restano calcolati con find_card_matches già
-- esistente; questa colonna serve solo a filtrare quali profili sono "in vetrina".
-- Esegui su Supabase (SQL Editor) oppure via migrazione MCP.

ALTER TABLE public.user_coc_profiles
  ADD COLUMN IF NOT EXISTS card_deck_public BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS user_coc_profiles_card_deck_public_idx
  ON public.user_coc_profiles (card_deck_public)
  WHERE card_deck_public = true;

COMMENT ON COLUMN public.user_coc_profiles.card_deck_public IS
  'Evento Clash of Cards: se true, il mazzo di questo profilo è visibile nella sezione "Mazzi pubblici" per suggerire scambi ad altri utenti CoCBoard.';
