-- ═══════════════════════════════════════════════════════════════════════
-- Evento "Clash of Cards" — script consolidato (esegui tutto in un colpo solo)
-- Unisce, in ordine, le 3 migrazioni pendenti:
--   1) schema-card-event-qty-migration.sql   (quantità libera + regole scambio)
--   2) schema-card-event-public-decks.sql    (colonna "mazzo pubblico")
--   3) schema-card-event-self-match-fix.sql  (semaforo verde/giallo self-trade)
-- È idempotente: puoi incollarlo ed eseguirlo anche se parte di queste
-- migrazioni fosse già stata applicata in precedenza, senza errori.
-- Dipende da: schema-card-event.sql + schema-card-event-trades.sql +
-- schema-card-event-notify.sql già applicati (fase 1-3 già live).
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- 1) QUANTITÀ LIBERA (0-99, non più solo 0/1/2) + regole scambio aggiornate
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.card_event_collections
  DROP CONSTRAINT IF EXISTS card_event_collections_qty_state_check;
ALTER TABLE public.card_event_collections
  ADD CONSTRAINT card_event_collections_qty_state_check CHECK (qty_state >= 0);

COMMENT ON COLUMN public.card_event_collections.qty_state IS
  'Numero di copie possedute (0 = non posseduta, 1 = posseduta, 2+ = doppioni scambiabili). Nessun tetto massimo.';

COMMENT ON TABLE public.card_event_collections IS
  'Evento Clash of Cards: quantità reale posseduta per carta/profilo (0=non posseduta, 1=posseduta, 2+=doppioni). Accesso solo SERVICE_ROLE.';

-- Matching P2P (tra account diversi): solo qty>=2 per cedere, qty=0 per ricevere.
CREATE OR REPLACE FUNCTION public.find_card_matches(p_coc_tag TEXT)
RETURNS TABLE (
    other_coc_tag TEXT,
    other_user_id UUID,
    card_give     TEXT,
    card_get      TEXT,
    category      TEXT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH me AS (
    SELECT user_id FROM public.user_coc_profiles WHERE coc_tag = p_coc_tag
  ),
  my_dupes AS (
    SELECT card_key, category FROM public.card_event_collections
    WHERE coc_tag = p_coc_tag AND qty_state >= 2
  ),
  my_missing AS (
    SELECT card_key, category FROM public.card_event_collections
    WHERE coc_tag = p_coc_tag AND qty_state = 0
  ),
  others AS (
    SELECT p.coc_tag, p.user_id
    FROM public.user_coc_profiles p
    WHERE p.user_id <> (SELECT user_id FROM me) AND p.coc_tag <> p_coc_tag
  )
  SELECT DISTINCT
    o.coc_tag  AS other_coc_tag,
    o.user_id  AS other_user_id,
    md.card_key AS card_give,
    mg.card_key AS card_get,
    md.category AS category
  FROM my_dupes md
  JOIN my_missing mg ON mg.category = md.category
  JOIN others o ON TRUE
  JOIN public.card_event_collections other_missing
    ON other_missing.coc_tag = o.coc_tag
   AND other_missing.qty_state = 0
   AND other_missing.card_key = md.card_key
  JOIN public.card_event_collections other_dupe
    ON other_dupe.coc_tag = o.coc_tag
   AND other_dupe.qty_state >= 2
   AND other_dupe.card_key = mg.card_key;
$$;

-- Applicazione scambio: p2p richiede ricevente a 0, self somma sempre la quantità ricevuta.
CREATE OR REPLACE FUNCTION public.apply_card_trade(
    p_kind        TEXT,          -- 'p2p' | 'self'
    p_profile_a   UUID,
    p_profile_b   UUID,
    p_card_a_gave TEXT,          -- carta ceduta da A (deve avere qty>=2, -1)
    p_card_b_gave TEXT,          -- carta ceduta da B (deve avere qty>=2, -1)
    p_room_id     UUID DEFAULT NULL,
    p_proposal_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tag_a TEXT;
  v_tag_b TEXT;
  v_cat_a TEXT;
  v_cat_b TEXT;
BEGIN
  SELECT coc_tag INTO v_tag_a FROM public.user_coc_profiles WHERE id = p_profile_a;
  SELECT coc_tag INTO v_tag_b FROM public.user_coc_profiles WHERE id = p_profile_b;
  IF v_tag_a IS NULL OR v_tag_b IS NULL THEN
    RAISE EXCEPTION 'Profilo non trovato per lo scambio';
  END IF;

  -- A cede p_card_a_gave (deve avere qty_state>=2 → -1)
  UPDATE public.card_event_collections
     SET qty_state = qty_state - 1, updated_at = NOW()
   WHERE coc_tag = v_tag_a AND card_key = p_card_a_gave AND qty_state >= 2
  RETURNING category INTO v_cat_a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo A non ha più il doppione richiesto (%).', p_card_a_gave;
  END IF;

  -- B cede p_card_b_gave (deve avere qty_state>=2 → -1)
  UPDATE public.card_event_collections
     SET qty_state = qty_state - 1, updated_at = NOW()
   WHERE coc_tag = v_tag_b AND card_key = p_card_b_gave AND qty_state >= 2
  RETURNING category INTO v_cat_b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo B non ha più il doppione richiesto (%).', p_card_b_gave;
  END IF;

  IF p_kind = 'self' THEN
    -- Self: si riceve sempre, la quantità si somma a quella già posseduta (anche se >0).
    INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    VALUES (v_tag_a, p_card_b_gave, v_cat_b, 1)
    ON CONFLICT (coc_tag, card_key)
    DO UPDATE SET qty_state = card_event_collections.qty_state + 1, updated_at = NOW();

    INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    VALUES (v_tag_b, p_card_a_gave, v_cat_a, 1)
    ON CONFLICT (coc_tag, card_key)
    DO UPDATE SET qty_state = card_event_collections.qty_state + 1, updated_at = NOW();
  ELSE
    -- P2P (account diversi): si riceve solo se non si possiede già (sblocco carta nuova).
    UPDATE public.card_event_collections
       SET qty_state = 1, updated_at = NOW()
     WHERE coc_tag = v_tag_a AND card_key = p_card_b_gave AND qty_state = 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Il profilo A ha già sbloccato la carta richiesta (%).', p_card_b_gave;
    END IF;

    UPDATE public.card_event_collections
       SET qty_state = 1, updated_at = NOW()
     WHERE coc_tag = v_tag_b AND card_key = p_card_a_gave AND qty_state = 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Il profilo B ha già sbloccato la carta richiesta (%).', p_card_a_gave;
    END IF;
  END IF;

  INSERT INTO public.card_event_trade_log
    (kind, room_id, proposal_id, profile_a, profile_b, card_a_gave, card_b_gave)
  VALUES
    (p_kind, p_room_id, p_proposal_id, p_profile_a, p_profile_b, p_card_a_gave, p_card_b_gave);

  IF p_proposal_id IS NOT NULL THEN
    UPDATE public.card_event_proposals
       SET status = 'accepted', resolved_at = NOW()
     WHERE id = p_proposal_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.apply_card_trade(TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID) IS
  'Applica atomicamente uno scambio: p2p richiede che il ricevente non possieda già la carta, self somma sempre la quantità ricevuta. Chiamare solo da SERVICE_ROLE dopo aver validato la richiesta lato API.';


-- ───────────────────────────────────────────────────────────────────────
-- 2) COLONNA "MAZZO PUBBLICO" su user_coc_profiles
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.user_coc_profiles
  ADD COLUMN IF NOT EXISTS card_deck_public BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS user_coc_profiles_card_deck_public_idx
  ON public.user_coc_profiles (card_deck_public)
  WHERE card_deck_public = true;

COMMENT ON COLUMN public.user_coc_profiles.card_deck_public IS
  'Evento Clash of Cards: se true, il mazzo di questo profilo è visibile nella sezione "Mazzi pubblici" per suggerire scambi ad altri utenti CoCBoard.';


-- ───────────────────────────────────────────────────────────────────────
-- 3) SELF-MATCH: semaforo verde/giallo (sostituisce find_self_card_matches)
--    NB: la firma della funzione cambia (nuove colonne in output), quindi va
--    prima eliminata la versione precedente (CREATE OR REPLACE non basta).
-- ───────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.find_self_card_matches(UUID);

CREATE OR REPLACE FUNCTION public.find_self_card_matches(p_user_id UUID)
RETURNS TABLE (
    profile_a            UUID,
    coc_tag_a            TEXT,
    profile_b            UUID,
    coc_tag_b            TEXT,
    card_a_to_b          TEXT, -- carta che A cede a B
    card_b_to_a          TEXT, -- carta che B cede ad A
    category             TEXT,
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


-- ═══════════════════════════════════════════════════════════════════════
-- Fine script. Se non vedi errori sopra, tutte le funzionalità (quantità
-- libera, mazzi pubblici, semaforo verde/giallo) sono ora attive.
-- ═══════════════════════════════════════════════════════════════════════
