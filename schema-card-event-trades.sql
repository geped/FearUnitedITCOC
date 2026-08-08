-- Evento "Clash of Cards" — Fase 2: scambio carte (matching, room 1-a-1, room self, log)
-- Dipende da schema-card-event.sql (card_event_collections) e schema-user-coc-profiles.sql
-- (user_coc_profiles). Esegui su Supabase (SQL Editor) oppure via migrazione MCP.

-- ─────────────────────────────────────────────────────────────────────────
-- STANZE 1-a-1 (tra due account CoCBoard diversi)
-- Una riga per coppia di profili, indipendentemente da chi ha iniziato.
-- profile_lo/profile_hi sono sempre ordinati (lo < hi) per garantire UNIQUE
-- senza duplicare la riga a seconda dell'ordine di creazione.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.card_event_rooms (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_lo    UUID NOT NULL REFERENCES public.user_coc_profiles (id) ON DELETE CASCADE,
    profile_hi    UUID NOT NULL REFERENCES public.user_coc_profiles (id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT card_event_rooms_pair_unique UNIQUE (profile_lo, profile_hi),
    CONSTRAINT card_event_rooms_ordered CHECK (profile_lo < profile_hi)
);

CREATE INDEX IF NOT EXISTS card_event_rooms_lo_idx ON public.card_event_rooms (profile_lo);
CREATE INDEX IF NOT EXISTS card_event_rooms_hi_idx ON public.card_event_rooms (profile_hi);

-- Proposte di scambio dentro una stanza 1-a-1.
CREATE TABLE IF NOT EXISTS public.card_event_proposals (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id           UUID NOT NULL REFERENCES public.card_event_rooms (id) ON DELETE CASCADE,
    proposer_profile  UUID NOT NULL REFERENCES public.user_coc_profiles (id) ON DELETE CASCADE,
    card_give         TEXT NOT NULL, -- carta che il proponente cede (deve averne 2+)
    card_get          TEXT NOT NULL, -- carta che il proponente riceve (deve averne 0)
    category          TEXT NOT NULL CHECK (category IN ('elixir', 'dark_elixir', 'builder_base', 'super_troop')),
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS card_event_proposals_room_idx ON public.card_event_proposals (room_id);
CREATE INDEX IF NOT EXISTS card_event_proposals_status_idx ON public.card_event_proposals (room_id, status);

-- Messaggi chat della stanza 1-a-1 (testo libero o riferimento a una proposta/evento di sistema).
CREATE TABLE IF NOT EXISTS public.card_event_room_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id         UUID NOT NULL REFERENCES public.card_event_rooms (id) ON DELETE CASCADE,
    sender_profile  UUID REFERENCES public.user_coc_profiles (id) ON DELETE SET NULL,
    kind            TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'proposal', 'system')),
    body            TEXT,
    proposal_id     UUID REFERENCES public.card_event_proposals (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS card_event_room_messages_room_idx
  ON public.card_event_room_messages (room_id, created_at);

-- Storico scambi completati (sia 1-a-1 accettati, sia self-trade applicati diretti).
-- Utile per una vista "storico scambi" e per debug/anti-abuso.
CREATE TABLE IF NOT EXISTS public.card_event_trade_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            TEXT NOT NULL CHECK (kind IN ('p2p', 'self')),
    room_id         UUID REFERENCES public.card_event_rooms (id) ON DELETE SET NULL,
    proposal_id     UUID REFERENCES public.card_event_proposals (id) ON DELETE SET NULL,
    profile_a       UUID NOT NULL REFERENCES public.user_coc_profiles (id) ON DELETE CASCADE,
    profile_b       UUID NOT NULL REFERENCES public.user_coc_profiles (id) ON DELETE CASCADE,
    card_a_gave     TEXT NOT NULL,
    card_b_gave     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS card_event_trade_log_profile_a_idx ON public.card_event_trade_log (profile_a);
CREATE INDEX IF NOT EXISTS card_event_trade_log_profile_b_idx ON public.card_event_trade_log (profile_b);

ALTER TABLE public.card_event_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_event_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_event_room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_event_trade_log ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- MATCHING: carte scambiabili tra un profilo e tutti gli altri (account diversi)
-- Regola: stessa categoria, io ho card_give in doppione (qty_state=2), l'altro
-- non la possiede (qty_state=0) e viceversa per card_get.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_card_matches(p_coc_tag TEXT)
RETURNS TABLE (
    other_coc_tag TEXT,
    other_user_id UUID,
    card_give     TEXT,
    card_get      TEXT,
    category      TEXT
)
LANGUAGE sql STABLE
AS $$
  WITH me AS (
    SELECT user_id FROM public.user_coc_profiles WHERE coc_tag = p_coc_tag
  ),
  my_dupes AS (
    SELECT card_key, category FROM public.card_event_collections
    WHERE coc_tag = p_coc_tag AND qty_state = 2
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
   AND other_dupe.qty_state = 2
   AND other_dupe.card_key = mg.card_key;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- MATCHING: carte scambiabili tra i profili dello STESSO account CoCBoard
-- (stanza "self", applicazione diretta senza negoziazione).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_self_card_matches(p_user_id UUID)
RETURNS TABLE (
    profile_a  UUID,
    coc_tag_a  TEXT,
    profile_b  UUID,
    coc_tag_b  TEXT,
    card_a_to_b TEXT, -- carta che A cede a B
    card_b_to_a TEXT, -- carta che B cede ad A
    category    TEXT
)
LANGUAGE sql STABLE
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
    ON ca.coc_tag = a.coc_tag AND ca.qty_state = 2
  JOIN public.card_event_collections cb
    ON cb.coc_tag = b.coc_tag AND cb.qty_state = 2 AND cb.category = ca.category
  JOIN public.card_event_collections a_missing
    ON a_missing.coc_tag = a.coc_tag AND a_missing.qty_state = 0 AND a_missing.card_key = cb.card_key
  JOIN public.card_event_collections b_missing
    ON b_missing.coc_tag = b.coc_tag AND b_missing.qty_state = 0 AND b_missing.card_key = ca.card_key
  WHERE a.id < b.id; -- evita coppie duplicate (A→B e B→A sono la stessa proposta)
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- APPLICAZIONE ATOMICA DI UNO SCAMBIO (usata sia per accept p2p sia per self)
-- Aggiorna le collezioni di entrambi i profili e registra lo storico.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_card_trade(
    p_kind        TEXT,          -- 'p2p' | 'self'
    p_profile_a   UUID,
    p_profile_b   UUID,
    p_card_a_gave TEXT,          -- carta ceduta da A (A: 2 -> 1, B: 0 -> 1)
    p_card_b_gave TEXT,          -- carta ceduta da B (B: 2 -> 1, A: 0 -> 1)
    p_room_id     UUID DEFAULT NULL,
    p_proposal_id UUID DEFAULT NULL
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

  -- A cede p_card_a_gave (deve avere qty_state=2 → passa a 1)
  UPDATE public.card_event_collections
     SET qty_state = 1, updated_at = NOW()
   WHERE coc_tag = v_tag_a AND card_key = p_card_a_gave AND qty_state = 2;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo A non ha più il doppione richiesto (%).', p_card_a_gave;
  END IF;

  -- B cede p_card_b_gave (deve avere qty_state=2 → passa a 1)
  UPDATE public.card_event_collections
     SET qty_state = 1, updated_at = NOW()
   WHERE coc_tag = v_tag_b AND card_key = p_card_b_gave AND qty_state = 2;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo B non ha più il doppione richiesto (%).', p_card_b_gave;
  END IF;

  -- A riceve p_card_b_gave (deve avere qty_state=0 → passa a 1)
  UPDATE public.card_event_collections
     SET qty_state = 1, updated_at = NOW()
   WHERE coc_tag = v_tag_a AND card_key = p_card_b_gave AND qty_state = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo A ha già sbloccato la carta richiesta (%).', p_card_b_gave;
  END IF;

  -- B riceve p_card_a_gave (deve avere qty_state=0 → passa a 1)
  UPDATE public.card_event_collections
     SET qty_state = 1, updated_at = NOW()
   WHERE coc_tag = v_tag_b AND card_key = p_card_a_gave AND qty_state = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il profilo B ha già sbloccato la carta richiesta (%).', p_card_a_gave;
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

COMMENT ON TABLE public.card_event_rooms IS
  'Evento Clash of Cards: stanza privata di scambio tra due profili di account diversi. Accesso solo SERVICE_ROLE.';
COMMENT ON TABLE public.card_event_proposals IS
  'Evento Clash of Cards: proposte di scambio (pending/accepted/rejected/cancelled) dentro una stanza.';
COMMENT ON TABLE public.card_event_room_messages IS
  'Evento Clash of Cards: chat privata della stanza (testo libero + eventi proposta/sistema).';
COMMENT ON TABLE public.card_event_trade_log IS
  'Evento Clash of Cards: storico scambi completati (p2p accettati o self applicati).';
COMMENT ON FUNCTION public.find_card_matches(TEXT) IS
  'Trova carte scambiabili tra un profilo e tutti i profili di altri account (stessa categoria, doppione ↔ mancante).';
COMMENT ON FUNCTION public.find_self_card_matches(UUID) IS
  'Trova carte scambiabili tra i profili dello stesso account CoCBoard (stanza self, applicazione diretta).';
COMMENT ON FUNCTION public.apply_card_trade(TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID) IS
  'Applica atomicamente uno scambio di carte tra due profili e registra lo storico. Chiamare solo da SERVICE_ROLE dopo aver validato la richiesta lato API.';
