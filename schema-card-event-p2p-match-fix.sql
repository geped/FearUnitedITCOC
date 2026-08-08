-- ═══════════════════════════════════════════════════════════════════════
-- Fix matching P2P: carta "mancante" = qty=0 OPPURE riga assente in DB.
-- Prima find_card_matches / apply_card_trade richiedevano una riga con
-- qty_state = 0; in pratica le carte non trovate non hanno riga → match
-- sempre vuoti e accettazione scambio falliva.
-- Esegui in Supabase SQL Editor (Run without RLS se richiesto).
-- ═══════════════════════════════════════════════════════════════════════

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
  others AS (
    SELECT p.coc_tag, p.user_id
    FROM public.user_coc_profiles p
    WHERE p.user_id <> (SELECT user_id FROM me) AND p.coc_tag <> p_coc_tag
  ),
  other_dupes AS (
    SELECT o.coc_tag AS other_coc_tag, o.user_id AS other_user_id, c.card_key, c.category
    FROM others o
    JOIN public.card_event_collections c
      ON c.coc_tag = o.coc_tag AND c.qty_state >= 2
  )
  SELECT DISTINCT
    od.other_coc_tag,
    od.other_user_id,
    md.card_key AS card_give,
    od.card_key AS card_get,
    md.category AS category
  FROM my_dupes md
  JOIN other_dupes od
    ON od.category = md.category
   AND od.card_key <> md.card_key
  -- Io NON possiedo la carta che riceverei (assente o qty=0)
  WHERE COALESCE(
    (SELECT qty_state FROM public.card_event_collections
      WHERE coc_tag = p_coc_tag AND card_key = od.card_key),
    0
  ) = 0
  -- L'altro NON possiede la carta che gli cederei (assente o qty=0)
  AND COALESCE(
    (SELECT qty_state FROM public.card_event_collections
      WHERE coc_tag = od.other_coc_tag AND card_key = md.card_key),
    0
  ) = 0;
$$;

COMMENT ON FUNCTION public.find_card_matches(TEXT) IS
  'Matching P2P: doppione (qty>=2) vs mancante (qty=0 o riga assente), stessa categoria. Carta assente in collezione conta come mancante.';

CREATE OR REPLACE FUNCTION public.apply_card_trade(
    p_kind        TEXT,
    p_profile_a   UUID,
    p_profile_b   UUID,
    p_card_a_gave TEXT,
    p_card_b_gave TEXT,
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
  v_qty   INT;
BEGIN
  SELECT coc_tag INTO v_tag_a FROM public.user_coc_profiles WHERE id = p_profile_a;
  SELECT coc_tag INTO v_tag_b FROM public.user_coc_profiles WHERE id = p_profile_b;
  IF v_tag_a IS NULL OR v_tag_b IS NULL THEN
    RAISE EXCEPTION 'Profilo non trovato per lo scambio';
  END IF;

  UPDATE public.card_event_collections
     SET qty_state = qty_state - 1, updated_at = NOW()
   WHERE coc_tag = v_tag_a AND card_key = p_card_a_gave AND qty_state >= 2
  RETURNING category INTO v_cat_a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo A non ha più il doppione richiesto (%).', p_card_a_gave;
  END IF;

  UPDATE public.card_event_collections
     SET qty_state = qty_state - 1, updated_at = NOW()
   WHERE coc_tag = v_tag_b AND card_key = p_card_b_gave AND qty_state >= 2
  RETURNING category INTO v_cat_b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo B non ha più il doppione richiesto (%).', p_card_b_gave;
  END IF;

  IF p_kind = 'self' THEN
    INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    VALUES (v_tag_a, p_card_b_gave, v_cat_b, 1)
    ON CONFLICT (coc_tag, card_key)
    DO UPDATE SET qty_state = card_event_collections.qty_state + 1, updated_at = NOW();

    INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    VALUES (v_tag_b, p_card_a_gave, v_cat_a, 1)
    ON CONFLICT (coc_tag, card_key)
    DO UPDATE SET qty_state = card_event_collections.qty_state + 1, updated_at = NOW();
  ELSE
    -- P2P: ricevente non deve già possedere (qty>=1). Assenza riga = OK (mancante).
    SELECT qty_state INTO v_qty FROM public.card_event_collections
     WHERE coc_tag = v_tag_a AND card_key = p_card_b_gave;
    IF COALESCE(v_qty, 0) >= 1 THEN
      RAISE EXCEPTION 'Il profilo A ha già sbloccato la carta richiesta (%).', p_card_b_gave;
    END IF;
    INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    VALUES (v_tag_a, p_card_b_gave, v_cat_b, 1)
    ON CONFLICT (coc_tag, card_key)
    DO UPDATE SET qty_state = 1, updated_at = NOW()
    WHERE card_event_collections.qty_state = 0;

    SELECT qty_state INTO v_qty FROM public.card_event_collections
     WHERE coc_tag = v_tag_b AND card_key = p_card_a_gave;
    IF COALESCE(v_qty, 0) >= 1 THEN
      RAISE EXCEPTION 'Il profilo B ha già sbloccato la carta richiesta (%).', p_card_a_gave;
    END IF;
    INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    VALUES (v_tag_b, p_card_a_gave, v_cat_a, 1)
    ON CONFLICT (coc_tag, card_key)
    DO UPDATE SET qty_state = 1, updated_at = NOW()
    WHERE card_event_collections.qty_state = 0;
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
  'Applica scambio: p2p richiede ricevente senza carta (qty=0 o riga assente) e fa upsert a 1; self somma sempre.';
