-- Evento "Clash of Cards" (temporaneo, agosto-settembre 2026)
-- Tracciamento manuale della collezione carte per profilo CoC + toggle admin.
-- Esegui su Supabase (SQL Editor) oppure via migrazione MCP.

-- Impostazioni globali evento (riga singola)
CREATE TABLE IF NOT EXISTS public.card_event_settings (
    id          SMALLINT PRIMARY KEY DEFAULT 1,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    ends_at     TIMESTAMPTZ NOT NULL DEFAULT '2026-09-02T08:00:00Z',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT card_event_settings_singleton CHECK (id = 1)
);

INSERT INTO public.card_event_settings (id, enabled, ends_at)
VALUES (1, true, '2026-09-02T08:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Collezione carte per profilo CoC (chiave = coc_tag + card_key del catalogo statico)
CREATE TABLE IF NOT EXISTS public.card_event_collections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coc_tag     TEXT NOT NULL REFERENCES public.user_coc_profiles (coc_tag) ON DELETE CASCADE,
    card_key    TEXT NOT NULL,
    category    TEXT NOT NULL CHECK (category IN ('elixir', 'dark_elixir', 'builder_base', 'super_troop')),
    qty_state   SMALLINT NOT NULL DEFAULT 0 CHECK (qty_state IN (0, 1, 2)),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT card_event_collections_unique UNIQUE (coc_tag, card_key)
);

CREATE INDEX IF NOT EXISTS card_event_collections_tag_idx
  ON public.card_event_collections (coc_tag);

CREATE INDEX IF NOT EXISTS card_event_collections_category_qty_idx
  ON public.card_event_collections (category, qty_state);

ALTER TABLE public.card_event_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_event_collections ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.card_event_settings IS
  'Evento Clash of Cards: interruttore globale + data fine (2 set 2026 08:00 UTC). Accesso solo SERVICE_ROLE.';
COMMENT ON TABLE public.card_event_collections IS
  'Evento Clash of Cards: stato manuale carte per profilo (0=non posseduta, 1=posseduta, 2=doppione+). Accesso solo SERVICE_ROLE.';
