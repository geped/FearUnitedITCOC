-- ═══════════════════════════════════════════════════════════════════════
-- Evento "Clash of Cards" — Fase 4: scambio "a due fasi" (escrow) + regole UX
-- Esegui in Supabase SQL Editor DOPO schema-card-event-ALL-IN-ONE.sql (fase 1-3).
-- Idempotente: puoi rilanciarlo senza errori anche se già applicato in parte.
--
-- Contiene:
--  1) card_event_proposals: colonna proposer_committed + stato "stale"
--  2) commit_card_trade_offer / refund_card_trade_offer (escrow "Applica subito")
--  3) apply_card_trade: nuovo parametro p_skip_a_debit (salta il débito già fatto in escrow)
--  4) find_self_card_matches: solo scambi "verde" (nessun giallo tra i propri profili)
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- 0) OUTBOX NOTIFICHE: nuovo kind "committed" (l'altro giocatore ha ceduto la
--    sua carta in escrow, tocca a te completare lo scambio)
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.card_event_notify_outbox
  DROP CONSTRAINT IF EXISTS card_event_notify_outbox_kind_check;
ALTER TABLE public.card_event_notify_outbox
  ADD CONSTRAINT card_event_notify_outbox_kind_check
  CHECK (kind IN ('match', 'message', 'proposal', 'trade_done', 'committed'));


-- ───────────────────────────────────────────────────────────────────────
-- 1) COLONNA proposer_committed + nuovo stato "stale"
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.card_event_proposals
  ADD COLUMN IF NOT EXISTS proposer_committed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.card_event_proposals.proposer_committed IS
  'true = il proponente ha già ceduto davvero il suo doppione (tasto "Applica subito"), in attesa che l''altro faccia lo stesso. false = proposta "in discussione" (tasto "Proponi scambio" classico), nessuna carta ancora spostata.';

ALTER TABLE public.card_event_proposals
  DROP CONSTRAINT IF EXISTS card_event_proposals_status_check;
ALTER TABLE public.card_event_proposals
  ADD CONSTRAINT card_event_proposals_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'stale'));

COMMENT ON COLUMN public.card_event_proposals.status IS
  'pending = in attesa; accepted = completata; rejected = rifiutata dal destinatario; cancelled = annullata dal proponente; stale = non più applicabile perché una delle due collezioni è cambiata (auto-invalidata).';


-- ───────────────────────────────────────────────────────────────────────
-- 2) ESCROW: "Applica subito (solo il mio mazzo)" — cede subito il doppione,
--    senza bisogno del consenso dell'altro. La carta ricevuta arriva solo
--    quando l'altro fa lo stesso (o accetta), via apply_card_trade più sotto.
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.commit_card_trade_offer(
    p_proposal_id UUID,
    p_profile_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_proposal RECORD;
  v_tag      TEXT;
BEGIN
  SELECT * INTO v_proposal FROM public.card_event_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF v_proposal IS NULL THEN
    RAISE EXCEPTION 'Proposta non trovata.';
  END IF;
  IF v_proposal.proposer_profile <> p_profile_id THEN
    RAISE EXCEPTION 'Solo chi ha proposto lo scambio può confermare la propria cessione.';
  END IF;
  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'Questa proposta non è più in attesa.';
  END IF;
  IF v_proposal.proposer_committed THEN
    RETURN; -- già confermata, idempotente
  END IF;

  SELECT coc_tag INTO v_tag FROM public.user_coc_profiles WHERE id = p_profile_id;
  IF v_tag IS NULL THEN
    RAISE EXCEPTION 'Profilo non trovato.';
  END IF;

  UPDATE public.card_event_collections
     SET qty_state = qty_state - 1, updated_at = NOW()
   WHERE coc_tag = v_tag AND card_key = v_proposal.card_give AND qty_state >= 2;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Non hai più il doppione richiesto (%).', v_proposal.card_give;
  END IF;

  UPDATE public.card_event_proposals
     SET proposer_committed = true
   WHERE id = p_proposal_id;
END;
$$;

COMMENT ON FUNCTION public.commit_card_trade_offer(UUID, UUID) IS
  'Evento Clash of Cards — tasto "Applica subito" (solo il mio mazzo): scala subito il doppione del proponente per una proposta pending, senza bisogno del consenso dell''altro lato. La carta ricevuta arriva solo quando l''altro fa lo stesso (vedi apply_card_trade con p_skip_a_debit).';

CREATE OR REPLACE FUNCTION public.refund_card_trade_offer(
    p_proposal_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_proposal RECORD;
  v_tag      TEXT;
BEGIN
  SELECT * INTO v_proposal FROM public.card_event_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF v_proposal IS NULL OR v_proposal.proposer_committed IS NOT TRUE THEN
    RETURN; -- niente da rimborsare
  END IF;

  SELECT coc_tag INTO v_tag FROM public.user_coc_profiles WHERE id = v_proposal.proposer_profile;
  IF v_tag IS NOT NULL THEN
    UPDATE public.card_event_collections
       SET qty_state = qty_state + 1, updated_at = NOW()
     WHERE coc_tag = v_tag AND card_key = v_proposal.card_give;
    IF NOT FOUND THEN
      INSERT INTO public.card_event_collections (coc_tag, card_key, category, qty_state)
      VALUES (v_tag, v_proposal.card_give, v_proposal.category, 1);
    END IF;
  END IF;

  UPDATE public.card_event_proposals SET proposer_committed = false WHERE id = p_proposal_id;
END;
$$;

COMMENT ON FUNCTION public.refund_card_trade_offer(UUID) IS
  'Evento Clash of Cards — rimborsa (ripristina +1) il doppione già ceduto in escrow dal proponente, quando una proposta "Applica subito" viene annullata, rifiutata o invalidata (stale). No-op se la proposta non era stata confermata (proposer_committed=false).';


-- ───────────────────────────────────────────────────────────────────────
-- 3) apply_card_trade: nuovo parametro p_skip_a_debit (default false, retro-compatibile)
--    Quando true, salta il primo débito (A ha già ceduto in escrow) e applica solo
--    il resto: B cede, entrambi ricevono, storicizza.
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_card_trade(
    p_kind         TEXT,          -- 'p2p' | 'self'
    p_profile_a    UUID,
    p_profile_b    UUID,
    p_card_a_gave  TEXT,
    p_card_b_gave  TEXT,
    p_room_id      UUID DEFAULT NULL,
    p_proposal_id  UUID DEFAULT NULL,
    p_skip_a_debit BOOLEAN DEFAULT false
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

  IF p_skip_a_debit THEN
    -- A ha già ceduto in escrow (commit_card_trade_offer): recupera solo la categoria.
    SELECT category INTO v_cat_a FROM public.card_event_collections
     WHERE coc_tag = v_tag_a AND card_key = p_card_a_gave;
    IF v_cat_a IS NULL THEN
      RAISE EXCEPTION 'Impossibile risalire alla categoria della carta già ceduta (%).', p_card_a_gave;
    END IF;
  ELSE
    UPDATE public.card_event_collections
       SET qty_state = qty_state - 1, updated_at = NOW()
     WHERE coc_tag = v_tag_a AND card_key = p_card_a_gave AND qty_state >= 2
    RETURNING category INTO v_cat_a;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Il profilo A non ha più il doppione richiesto (%).', p_card_a_gave;
    END IF;
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

COMMENT ON FUNCTION public.apply_card_trade(TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, BOOLEAN) IS
  'Applica atomicamente uno scambio. p_skip_a_debit=true quando il profilo A ha già ceduto la sua carta in escrow (commit_card_trade_offer) e questa chiamata deve solo completare il lato B + le due ricezioni. Chiamare solo da SERVICE_ROLE dopo aver validato la richiesta lato API.';


-- ───────────────────────────────────────────────────────────────────────
-- 4) SELF-TRADE: solo "verde" — nessuno scambio se uno dei due possiede già
--    la carta che riceverebbe (rimuove il "semaforo giallo" tra i propri profili,
--    uniformando la regola anti-doppioni ovunque nell'evento).
-- ───────────────────────────────────────────────────────────────────────

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
    false AS a_already_has_target,
    false AS b_already_has_target
  FROM mine a
  JOIN mine b ON b.coc_tag <> a.coc_tag
  JOIN public.card_event_collections ca
    ON ca.coc_tag = a.coc_tag AND ca.qty_state >= 2
  JOIN public.card_event_collections cb
    ON cb.coc_tag = b.coc_tag AND cb.qty_state >= 2
   AND cb.category = ca.category AND cb.card_key <> ca.card_key
  WHERE a.id < b.id
    -- Nuova regola: niente doppioni-per-doppioni, nemmeno tra i propri profili.
    -- A deve NON possedere già la carta che B cederebbe, e viceversa.
    AND COALESCE(
      (SELECT qty_state FROM public.card_event_collections
        WHERE coc_tag = a.coc_tag AND card_key = cb.card_key), 0
    ) = 0
    AND COALESCE(
      (SELECT qty_state FROM public.card_event_collections
        WHERE coc_tag = b.coc_tag AND card_key = ca.card_key), 0
    ) = 0;
$$;

COMMENT ON FUNCTION public.find_self_card_matches(UUID) IS
  'Trova carte scambiabili tra i profili dello stesso account CoCBoard: doppione (qty>=2) su un lato, carta mancante (qty=0) sull''altro, stessa categoria. Dalla Fase 4 la regola è identica a quella P2P: nessuno scambio se uno dei due possiede già la carta che riceverebbe (niente più "semaforo giallo"). Le colonne a/b_already_has_target restano nel resultset per compatibilità con il codice esistente e sono sempre false.';


-- ═══════════════════════════════════════════════════════════════════════
-- Fine script. Se non vedi errori sopra, il meccanismo "Applica subito" a
-- due fasi (escrow) e la regola anti-doppioni uniforme sono attivi.
-- ═══════════════════════════════════════════════════════════════════════
