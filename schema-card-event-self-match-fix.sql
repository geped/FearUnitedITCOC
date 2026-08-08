-- Evento "Clash of Cards" — fix: gli scambi SUGGERITI tra i propri profili (self-trade)
-- restano visibili anche quando il ricevente possiede già la carta (regola del "semaforo
-- giallo": non è necessario ma è comunque possibile farlo), ma ora la funzione segnala
-- esplicitamente, per ciascun lato, se lo scambio sblocca davvero una carta nuova (verde)
-- oppure se la possiede già (giallo) — così l'interfaccia può distinguerli chiaramente.
--
-- Dipende da schema-card-event-qty-migration.sql già applicato.
-- Esegui su Supabase (SQL Editor) oppure via migrazione MCP.
-- (Sostituisce la versione precedente di questo file, che invece filtrava/nascondeva
--  del tutto gli scambi "già posseduti": ora vengono mostrati ma marcati come gialli.)
--
-- NB: la firma della funzione cambia (nuove colonne in output), quindi Postgres non
-- permette un semplice CREATE OR REPLACE: va prima eliminata la versione precedente.
DROP FUNCTION IF EXISTS public.find_self_card_matches(UUID);

CREATE OR REPLACE FUNCTION public.find_self_card_matches(p_user_id UUID)
RETURNS TABLE (
    profile_a          UUID,
    coc_tag_a          TEXT,
    profile_b          UUID,
    coc_tag_b          TEXT,
    card_a_to_b        TEXT, -- carta che A cede a B
    card_b_to_a        TEXT, -- carta che B cede ad A
    category           TEXT,
    a_already_has_target BOOLEAN, -- true = A possiede già card_b_to_a (scambio "giallo" per A)
    b_already_has_target BOOLEAN  -- true = B possiede già card_a_to_b (scambio "giallo" per B)
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
    ca.category AS category,
    COALESCE(a_existing.qty_state, 0) >= 1 AS a_already_has_target,
    COALESCE(b_existing.qty_state, 0) >= 1 AS b_already_has_target
  FROM mine a
  JOIN mine b ON b.coc_tag <> a.coc_tag
  JOIN public.card_event_collections ca
    ON ca.coc_tag = a.coc_tag AND ca.qty_state >= 2
  JOIN public.card_event_collections cb
    ON cb.coc_tag = b.coc_tag AND cb.qty_state >= 2
   AND cb.category = ca.category AND cb.card_key <> ca.card_key
  -- Non richiesti come filtro: servono solo a calcolare il flag "già posseduta" (giallo/verde).
  LEFT JOIN public.card_event_collections a_existing
    ON a_existing.coc_tag = a.coc_tag AND a_existing.card_key = cb.card_key
  LEFT JOIN public.card_event_collections b_existing
    ON b_existing.coc_tag = b.coc_tag AND b_existing.card_key = ca.card_key
  WHERE a.id < b.id; -- evita coppie duplicate (A→B e B→A sono la stessa proposta)
$$;

COMMENT ON FUNCTION public.find_self_card_matches(UUID) IS
  'Trova carte scambiabili tra i profili dello stesso account CoCBoard: basta un doppione (qty>=2) su entrambi i lati di carte diverse della stessa categoria. Restituisce anche a_already_has_target/b_already_has_target per marcare come "semaforo giallo" (non necessario ma possibile) gli scambi dove il ricevente possiede già la carta, mentre "semaforo verde" indica un vero sblocco di carta nuova.';
