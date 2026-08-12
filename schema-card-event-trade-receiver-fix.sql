-- Evento "Clash of Cards" — fix: il ricevente può già possedere la carta ceduta
-- ══════════════════════════════════════════════════════════
-- 0) find_self_card_matches — self trade discovery
--    Sostituisce la versione originale che usava INNER JOIN su qty_state=0
--    (filtrava i match dove uno dei due aveva già la carta).
--    La nuova versione usa LEFT JOIN + flag a_already_has_target / b_already_has_target.
--    ATTENZIONE: la firma cambia (colonne extra) → va prima eliminata.
-- ══════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.find_self_card_matches(UUID);

CREATE OR REPLACE FUNCTION public.find_self_card_matches(p_user_id UUID)
RETURNS TABLE (
    profile_a            UUID,
    coc_tag_a            TEXT,
    profile_b            UUID,
    coc_tag_b            TEXT,
    card_a_to_b          TEXT,
    card_b_to_a          TEXT,
    category             TEXT,
    a_already_has_target BOOLEAN,
    b_already_has_target BOOLEAN
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
  LEFT JOIN public.card_event_collections a_existing
    ON a_existing.coc_tag = a.coc_tag AND a_existing.card_key = cb.card_key
  LEFT JOIN public.card_event_collections b_existing
    ON b_existing.coc_tag = b.coc_tag AND b_existing.card_key = ca.card_key
  WHERE a.id < b.id
    AND (
      COALESCE(a_existing.qty_state, 0) = 0
      OR COALESCE(b_existing.qty_state, 0) = 0
    );
$$;

COMMENT ON FUNCTION public.find_self_card_matches(UUID) IS
  'Trova carte scambiabili tra profili dello stesso account. Mostra scambi dove almeno un lato riceve una carta nuova (verde) oppure entrambi ricevono qualcosa di già posseduto (giallo). Richiede qty>=2 per cedere; il ricevente può già avere la carta.';


-- Evento "Clash of Cards" — fix: il ricevente può già possedere la carta ceduta
-- (aggiunge al conteggio anziché sbloccarla da 0).
-- Allineato alla regola del gioco: solo chi PROPONE deve beneficiare (ricevere
-- una carta che non ha), ma chi accetta può ricevere un doppione.
-- Corregge anche il debit che usava qty_state=2 fisso invece di qty_state>=2.
--
-- Applica su Supabase → SQL Editor (oppure via MCP).
-- Dipende da schema-card-event-trades.sql e schema-card-event-triangles.sql già applicati.

-- ══════════════════════════════════════════════════════════
-- 1) apply_card_trade — scambio P2P 2 profili
-- ══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.apply_card_trade(
    p_kind        TEXT,          -- 'p2p' | 'self'
    p_profile_a   UUID,
    p_profile_b   UUID,
    p_card_a_gave TEXT,          -- carta ceduta da A (A: qty-1, B: qty+1)
    p_card_b_gave TEXT,          -- carta ceduta da B (B: qty-1, A: qty+1)
    p_room_id     UUID DEFAULT NULL,
    p_proposal_id UUID DEFAULT NULL,
    p_skip_a_debit BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_tag_a TEXT;
  v_tag_b TEXT;
BEGIN
  SELECT coc_tag INTO v_tag_a FROM public.user_coc_profiles WHERE id = p_profile_a;
  SELECT coc_tag INTO v_tag_b FROM public.user_coc_profiles WHERE id = p_profile_b;
  IF v_tag_a IS NULL OR v_tag_b IS NULL THEN
    RAISE EXCEPTION 'Profilo non trovato per lo scambio';
  END IF;

  -- A cede p_card_a_gave (qty_state - 1, richiede almeno 2 copie)
  IF NOT p_skip_a_debit THEN
    UPDATE public.card_event_collections
       SET qty_state = qty_state - 1, updated_at = NOW()
     WHERE coc_tag = v_tag_a AND card_key = p_card_a_gave AND qty_state >= 2;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Il profilo A non ha più il doppione richiesto (%).', p_card_a_gave;
    END IF;
  END IF;

  -- B cede p_card_b_gave (qty_state - 1, richiede almeno 2 copie)
  UPDATE public.card_event_collections
     SET qty_state = qty_state - 1, updated_at = NOW()
   WHERE coc_tag = v_tag_b AND card_key = p_card_b_gave AND qty_state >= 2;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo B non ha più il doppione richiesto (%).', p_card_b_gave;
  END IF;

  -- A riceve p_card_b_gave: categoria presa dalla riga di B (cedente, ancora presente)
  INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    SELECT v_tag_a, p_card_b_gave, category, 1
      FROM public.card_event_collections
     WHERE coc_tag = v_tag_b AND card_key = p_card_b_gave
  ON CONFLICT (coc_tag, card_key)
  DO UPDATE SET qty_state = card_event_collections.qty_state + 1, updated_at = NOW();

  -- B riceve p_card_a_gave: categoria presa dalla riga di A (cedente, ancora presente)
  INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    SELECT v_tag_b, p_card_a_gave, category, 1
      FROM public.card_event_collections
     WHERE coc_tag = v_tag_a AND card_key = p_card_a_gave
  ON CONFLICT (coc_tag, card_key)
  DO UPDATE SET qty_state = card_event_collections.qty_state + 1, updated_at = NOW();

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

COMMENT ON FUNCTION public.apply_card_trade(TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, BOOLEAN) IS
  'Applica atomicamente uno scambio di carte tra due profili. Il ricevente può già possedere la carta (qty+1). Chi cede deve avere qty≥2.';


-- ══════════════════════════════════════════════════════════
-- 2) apply_card_triangle — ciclo a 3 (p2p e self)
-- ══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.apply_card_triangle(
    p_kind        TEXT,   -- 'p2p' | 'self'
    p_profile_a   UUID,
    p_profile_b   UUID,
    p_profile_c   UUID,
    p_card_a      TEXT,   -- A cede → C riceve
    p_card_b      TEXT,   -- B cede → A riceve
    p_card_c      TEXT,   -- C cede → B riceve
    p_triangle_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tag_a TEXT;
  v_tag_b TEXT;
  v_tag_c TEXT;
  v_cat_a TEXT;
  v_cat_b TEXT;
  v_cat_c TEXT;
BEGIN
  IF p_profile_a IS NULL OR p_profile_b IS NULL OR p_profile_c IS NULL THEN
    RAISE EXCEPTION 'Profili triangolo incompleti.';
  END IF;
  IF p_profile_a = p_profile_b OR p_profile_b = p_profile_c OR p_profile_a = p_profile_c THEN
    RAISE EXCEPTION 'I tre profili del triangolo devono essere distinti.';
  END IF;
  IF p_card_a IS NULL OR p_card_b IS NULL OR p_card_c IS NULL
     OR p_card_a = p_card_b OR p_card_b = p_card_c OR p_card_a = p_card_c THEN
    RAISE EXCEPTION 'Le tre carte del triangolo devono essere distinte.';
  END IF;

  SELECT coc_tag INTO v_tag_a FROM public.user_coc_profiles WHERE id = p_profile_a;
  SELECT coc_tag INTO v_tag_b FROM public.user_coc_profiles WHERE id = p_profile_b;
  SELECT coc_tag INTO v_tag_c FROM public.user_coc_profiles WHERE id = p_profile_c;
  IF v_tag_a IS NULL OR v_tag_b IS NULL OR v_tag_c IS NULL THEN
    RAISE EXCEPTION 'Profilo non trovato per il triangolo.';
  END IF;

  -- Debito A (cede a C, deve avere qty≥2)
  UPDATE public.card_event_collections
     SET qty_state = qty_state - 1, updated_at = NOW()
   WHERE coc_tag = v_tag_a AND card_key = p_card_a AND qty_state >= 2
  RETURNING category INTO v_cat_a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo A non ha più il doppione richiesto (%).', p_card_a;
  END IF;

  -- Debito B (cede a A, deve avere qty≥2)
  UPDATE public.card_event_collections
     SET qty_state = qty_state - 1, updated_at = NOW()
   WHERE coc_tag = v_tag_b AND card_key = p_card_b AND qty_state >= 2
  RETURNING category INTO v_cat_b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo B non ha più il doppione richiesto (%).', p_card_b;
  END IF;

  -- Debito C (cede a B, deve avere qty≥2)
  UPDATE public.card_event_collections
     SET qty_state = qty_state - 1, updated_at = NOW()
   WHERE coc_tag = v_tag_c AND card_key = p_card_c AND qty_state >= 2
  RETURNING category INTO v_cat_c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo C non ha più il doppione richiesto (%).', p_card_c;
  END IF;

  IF v_cat_a IS DISTINCT FROM v_cat_b OR v_cat_b IS DISTINCT FROM v_cat_c THEN
    RAISE EXCEPTION 'Le carte del triangolo devono essere della stessa categoria.';
  END IF;

  -- Crediti: C riceve A, A riceve B, B riceve C.
  -- Sia per 'p2p' che 'self': qty+1 (il ricevente può già avere la carta).
  INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    SELECT v_tag_c, p_card_a, v_cat_a, 1
  ON CONFLICT (coc_tag, card_key)
  DO UPDATE SET qty_state = card_event_collections.qty_state + 1, updated_at = NOW();

  INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    SELECT v_tag_a, p_card_b, v_cat_b, 1
  ON CONFLICT (coc_tag, card_key)
  DO UPDATE SET qty_state = card_event_collections.qty_state + 1, updated_at = NOW();

  INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    SELECT v_tag_b, p_card_c, v_cat_c, 1
  ON CONFLICT (coc_tag, card_key)
  DO UPDATE SET qty_state = card_event_collections.qty_state + 1, updated_at = NOW();

  INSERT INTO public.card_event_trade_log
    (kind, profile_a, profile_b, profile_c, card_a_gave, card_b_gave, card_c_gave, triangle_id)
  VALUES
    ('triangle', p_profile_a, p_profile_b, p_profile_c, p_card_a, p_card_b, p_card_c, p_triangle_id);

  IF p_triangle_id IS NOT NULL THEN
    UPDATE public.card_event_triangle_proposals
       SET status = 'accepted', resolved_at = NOW(),
           accept_a = true, accept_b = true, accept_c = true
     WHERE id = p_triangle_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.apply_card_triangle(TEXT, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID) IS
  'Applica atomicamente uno scambio a tre (ciclo A→C, B→A, C→B). Chi cede deve avere qty≥2; il ricevente può già avere la carta (qty+1). Solo SERVICE_ROLE.';
