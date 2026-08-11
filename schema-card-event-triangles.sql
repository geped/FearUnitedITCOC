-- ═══════════════════════════════════════════════════════════════════════
-- Evento "Clash of Cards" — Scambi a tre (triangoli / cicli)
-- Esegui in Supabase SQL Editor DOPO schema-card-event-escrow.sql.
-- Idempotente.
--
-- Regole (variante A):
--  - Ciclo A→C, B→A, C→B: ognuno cede un doppione (qty≥2) e riceve una mancante (qty=0)
--  - Stessa categoria, 3 carte diverse, 3 profili distinti
--  - Preferenza matching lato app: cicli con almeno un qty≥3
--  - P2P: proposta + accettazione degli altri due → apply atomico
--  - Self: Applica subito senza multi-consenso
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- 0) OUTBOX: nuovi kind per triangoli
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.card_event_notify_outbox
  DROP CONSTRAINT IF EXISTS card_event_notify_outbox_kind_check;
ALTER TABLE public.card_event_notify_outbox
  ADD CONSTRAINT card_event_notify_outbox_kind_check
  CHECK (kind IN (
    'match', 'message', 'proposal', 'trade_done', 'committed',
    'triangle_match', 'triangle_proposal', 'triangle_done'
  ));


-- ───────────────────────────────────────────────────────────────────────
-- 1) TRADE LOG: kind triangle + profilo C
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.card_event_trade_log
  DROP CONSTRAINT IF EXISTS card_event_trade_log_kind_check;
ALTER TABLE public.card_event_trade_log
  ADD CONSTRAINT card_event_trade_log_kind_check
  CHECK (kind IN ('p2p', 'self', 'triangle'));

ALTER TABLE public.card_event_trade_log
  ADD COLUMN IF NOT EXISTS profile_c UUID REFERENCES public.user_coc_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.card_event_trade_log
  ADD COLUMN IF NOT EXISTS card_c_gave TEXT;
ALTER TABLE public.card_event_trade_log
  ADD COLUMN IF NOT EXISTS triangle_id UUID;

COMMENT ON COLUMN public.card_event_trade_log.profile_c IS
  'Terzo profilo in uno scambio a tre (kind=triangle). NULL per p2p/self.';
COMMENT ON COLUMN public.card_event_trade_log.card_c_gave IS
  'Carta ceduta dal profilo C nel triangolo (va a B).';


-- ───────────────────────────────────────────────────────────────────────
-- 2) TABELLA proposte triangolo
--    Semantica ciclo:
--      A cede card_a_gives → riceve C (card_a va a C)
--      B cede card_b_gives → riceve A (card_b va a A)
--      C cede card_c_gives → riceve B (card_c va a B)
-- ───────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.card_event_triangle_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN ('p2p', 'self')),
  category        TEXT NOT NULL,
  profile_a       UUID NOT NULL REFERENCES public.user_coc_profiles(id) ON DELETE CASCADE,
  profile_b       UUID NOT NULL REFERENCES public.user_coc_profiles(id) ON DELETE CASCADE,
  profile_c       UUID NOT NULL REFERENCES public.user_coc_profiles(id) ON DELETE CASCADE,
  card_a_gives    TEXT NOT NULL,
  card_b_gives    TEXT NOT NULL,
  card_c_gives    TEXT NOT NULL,
  created_by      UUID NOT NULL REFERENCES public.user_coc_profiles(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'stale')),
  accept_a        BOOLEAN NOT NULL DEFAULT false,
  accept_b        BOOLEAN NOT NULL DEFAULT false,
  accept_c        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  CONSTRAINT card_event_triangle_distinct_profiles
    CHECK (profile_a <> profile_b AND profile_b <> profile_c AND profile_a <> profile_c),
  CONSTRAINT card_event_triangle_distinct_cards
    CHECK (card_a_gives <> card_b_gives AND card_b_gives <> card_c_gives AND card_a_gives <> card_c_gives)
);

CREATE INDEX IF NOT EXISTS card_event_triangle_status_idx
  ON public.card_event_triangle_proposals (status);
CREATE INDEX IF NOT EXISTS card_event_triangle_profiles_idx
  ON public.card_event_triangle_proposals (profile_a, profile_b, profile_c);

ALTER TABLE public.card_event_triangle_proposals ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.card_event_triangle_proposals IS
  'Proposte di scambio a tre (ciclo). P2P richiede accettazione di tutti e tre; self si applica subito senza multi-consenso.';


-- ───────────────────────────────────────────────────────────────────────
-- 3) APPLY ATOMICO triangolo
-- ───────────────────────────────────────────────────────────────────────

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
  v_qty   INT;
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

  -- Debito A (cede a C)
  UPDATE public.card_event_collections
     SET qty_state = qty_state - 1, updated_at = NOW()
   WHERE coc_tag = v_tag_a AND card_key = p_card_a AND qty_state >= 2
  RETURNING category INTO v_cat_a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo A non ha più il doppione richiesto (%).', p_card_a;
  END IF;

  -- Debito B (cede a A)
  UPDATE public.card_event_collections
     SET qty_state = qty_state - 1, updated_at = NOW()
   WHERE coc_tag = v_tag_b AND card_key = p_card_b AND qty_state >= 2
  RETURNING category INTO v_cat_b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo B non ha più il doppione richiesto (%).', p_card_b;
  END IF;

  -- Debito C (cede a B)
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

  -- Crediti: C riceve A, A riceve B, B riceve C — solo se mancanti (qty=0)
  IF p_kind = 'self' THEN
    -- Self: consente somma anche se già posseduta (come self 1↔1 storico),
    -- ma il matching lato app propone solo cicli "verdi" (tutti mancanti).
    INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    VALUES (v_tag_c, p_card_a, v_cat_a, 1)
    ON CONFLICT (coc_tag, card_key)
    DO UPDATE SET qty_state = card_event_collections.qty_state + 1, updated_at = NOW();

    INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    VALUES (v_tag_a, p_card_b, v_cat_b, 1)
    ON CONFLICT (coc_tag, card_key)
    DO UPDATE SET qty_state = card_event_collections.qty_state + 1, updated_at = NOW();

    INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    VALUES (v_tag_b, p_card_c, v_cat_c, 1)
    ON CONFLICT (coc_tag, card_key)
    DO UPDATE SET qty_state = card_event_collections.qty_state + 1, updated_at = NOW();
  ELSE
    SELECT qty_state INTO v_qty FROM public.card_event_collections
     WHERE coc_tag = v_tag_c AND card_key = p_card_a;
    IF COALESCE(v_qty, 0) >= 1 THEN
      RAISE EXCEPTION 'Il profilo C ha già sbloccato la carta (%).', p_card_a;
    END IF;
    INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    VALUES (v_tag_c, p_card_a, v_cat_a, 1)
    ON CONFLICT (coc_tag, card_key)
    DO UPDATE SET qty_state = 1, updated_at = NOW()
    WHERE card_event_collections.qty_state = 0;

    SELECT qty_state INTO v_qty FROM public.card_event_collections
     WHERE coc_tag = v_tag_a AND card_key = p_card_b;
    IF COALESCE(v_qty, 0) >= 1 THEN
      RAISE EXCEPTION 'Il profilo A ha già sbloccato la carta (%).', p_card_b;
    END IF;
    INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    VALUES (v_tag_a, p_card_b, v_cat_b, 1)
    ON CONFLICT (coc_tag, card_key)
    DO UPDATE SET qty_state = 1, updated_at = NOW()
    WHERE card_event_collections.qty_state = 0;

    SELECT qty_state INTO v_qty FROM public.card_event_collections
     WHERE coc_tag = v_tag_b AND card_key = p_card_c;
    IF COALESCE(v_qty, 0) >= 1 THEN
      RAISE EXCEPTION 'Il profilo B ha già sbloccato la carta (%).', p_card_c;
    END IF;
    INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
    VALUES (v_tag_b, p_card_c, v_cat_c, 1)
    ON CONFLICT (coc_tag, card_key)
    DO UPDATE SET qty_state = 1, updated_at = NOW()
    WHERE card_event_collections.qty_state = 0;
  END IF;

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
  'Applica atomicamente uno scambio a tre (ciclo A→C, B→A, C→B). Solo SERVICE_ROLE.';


-- ═══════════════════════════════════════════════════════════════════════
-- Fine script. Matching cicli lato Node (api/_utils/card-triangles.js).
-- ═══════════════════════════════════════════════════════════════════════
