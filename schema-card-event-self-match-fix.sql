-- Evento "Clash of Cards" — fix: gli scambi SUGGERITI tra i propri profili (self-trade)
-- non devono più proporre carte che il profilo ricevente possiede già. Si suggerisce solo
-- lo sblocco di carte nuove (qty=0 sul lato che riceve), esattamente come già avviene nel
-- matching P2P tra account diversi (find_card_matches).
--
-- Nota: apply_card_trade (kind='self') continua a sommare la quantità se venisse invocata
-- direttamente con una carta già posseduta — non fa male tenerlo come comportamento di
-- fallback — ma con questa fix nessuna suggerimento automatico propone più questo scenario.
--
-- Dipende da schema-card-event-qty-migration.sql già applicato.
-- Esegui su Supabase (SQL Editor) oppure via migrazione MCP.

CREATE OR REPLACE FUNCTION public.find_self_card_matches(p_user_id UUID)
RETURNS TABLE (
    profile_a   UUID,
    coc_tag_a   TEXT,
    profile_b   UUID,
    coc_tag_b   TEXT,
    card_a_to_b TEXT, -- carta che A cede a B
    card_b_to_a TEXT, -- carta che B cede ad A
    category    TEXT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH mine AS (
    SELECT id, coc_tag FROM public.user_coc_profiles WHERE user_id = p_user_id
  )
  SELECT DISTINCT
    a.id AS profile_a, a.coc_tag AS coc_tag_a,
    b.id AS profile_b, b.coc_tag AS coc_tag_b,
    ca.card_key AS card_a_to_b,
    cb.card_key AS card_b_to_a,
    ca.category AS category
  FROM mine a
  JOIN mine b ON b.coc_tag <> a.coc_tag
  JOIN public.card_event_collections ca
    ON ca.coc_tag = a.coc_tag AND ca.qty_state >= 2
  JOIN public.card_event_collections cb
    ON cb.coc_tag = b.coc_tag AND cb.qty_state >= 2
   AND cb.category = ca.category AND cb.card_key <> ca.card_key
  -- B non deve già possedere la carta che riceverebbe da A (sblocco carta nuova).
  JOIN public.card_event_collections b_missing
    ON b_missing.coc_tag = b.coc_tag AND b_missing.qty_state = 0 AND b_missing.card_key = ca.card_key
  -- A non deve già possedere la carta che riceverebbe da B (sblocco carta nuova).
  JOIN public.card_event_collections a_missing
    ON a_missing.coc_tag = a.coc_tag AND a_missing.qty_state = 0 AND a_missing.card_key = cb.card_key
  WHERE a.id < b.id; -- evita coppie duplicate (A→B e B→A sono la stessa proposta)
$$;

COMMENT ON FUNCTION public.find_self_card_matches(UUID) IS
  'Trova carte scambiabili tra i profili dello stesso account CoCBoard: entrambi i lati devono avere un doppione (qty>=2) di carte diverse della stessa categoria E non possedere già la carta che riceverebbero (si suggerisce solo lo sblocco di carte nuove, come nel matching P2P).';
