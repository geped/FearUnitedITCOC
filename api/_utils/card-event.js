'use strict';

/**
 * Evento "Clash of Cards" — logica condivisa (Vercel API).
 * Fase 1: tracciamento manuale della collezione carte per profilo CoC.
 * Matching / room / chat arrivano in una fase successiva.
 */

const profilesUtil = require('./user-profiles');
const {
  CARD_EVENT_CATALOG,
  CATEGORY_ORDER,
  CATEGORY_LABEL_IT,
  CARD_BY_KEY,
  CATEGORY_TOTALS,
  TOTAL_CARDS,
} = require('./card-event-catalog');

async function getSettings(admin) {
  const { data, error } = await admin
    .from('card_event_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  // Riga singleton mancante (mai capitato in produzione, ma robusto in dev/staging)
  const { data: created, error: insErr } = await admin
    .from('card_event_settings')
    .insert({ id: 1 })
    .select('*')
    .single();
  if (insErr) throw insErr;
  return created;
}

async function setEnabled(admin, enabled) {
  const { data, error } = await admin
    .from('card_event_settings')
    .update({ enabled: enabled === true, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function isEventLive(settings) {
  if (!settings) return false;
  if (settings.enabled !== true) return false;
  const endsAt = settings.ends_at ? new Date(settings.ends_at).getTime() : 0;
  return !endsAt || Date.now() < endsAt;
}

function catalogPayload(settings) {
  return {
    ok: true,
    cards: CARD_EVENT_CATALOG,
    category_order: CATEGORY_ORDER,
    category_label_it: CATEGORY_LABEL_IT,
    category_totals: CATEGORY_TOTALS,
    total_cards: TOTAL_CARDS,
    settings: {
      enabled: settings.enabled === true,
      ends_at: settings.ends_at,
      live: isEventLive(settings),
    },
  };
}

/** Profili CoC dell'utente autenticato, con relativa collezione carte. */
async function getCollectionsForUser(admin, userId) {
  const profiles = await profilesUtil.listProfiles(admin, userId);
  if (!profiles.length) return { profiles: [], collections: {} };

  const tags = profiles.map((p) => p.coc_tag);
  const { data: rows, error } = await admin
    .from('card_event_collections')
    .select('coc_tag, card_key, qty_state')
    .in('coc_tag', tags);
  if (error) throw error;

  const collections = {};
  for (const tag of tags) collections[tag] = {};
  for (const row of rows || []) {
    if (!collections[row.coc_tag]) collections[row.coc_tag] = {};
    collections[row.coc_tag][row.card_key] = row.qty_state;
  }

  return {
    profiles: profiles.map(profilesUtil.profileToPublic),
    collections,
  };
}

async function saveCardState(admin, user, { cocTag, cardKey, qtyState }) {
  const card = CARD_BY_KEY.get(cardKey);
  if (!card) {
    const err = new Error('Carta non riconosciuta.');
    err.status = 400;
    throw err;
  }
  const qty = Number(qtyState);
  if (![0, 1, 2].includes(qty)) {
    const err = new Error('Stato carta non valido (0, 1 o 2).');
    err.status = 400;
    throw err;
  }

  const settings = await getSettings(admin);
  if (!isEventLive(settings)) {
    const err = new Error('Evento Clash of Cards non attivo.');
    err.status = 403;
    err.code = 'EVENT_NOT_LIVE';
    throw err;
  }

  const profiles = await profilesUtil.listProfiles(admin, user.id);
  const owns = profiles.some((p) => p.coc_tag === cocTag);
  if (!owns) {
    const err = new Error('Profilo non collegato al tuo account.');
    err.status = 403;
    throw err;
  }

  const { data, error } = await admin
    .from('card_event_collections')
    .upsert(
      {
        coc_tag: cocTag,
        card_key: cardKey,
        category: card.category,
        qty_state: qty,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'coc_tag,card_key' },
    )
    .select('coc_tag, card_key, qty_state')
    .single();
  if (error) throw error;

  // Best-effort, non blocca la risposta se fallisce: require lazy per evitare un
  // ciclo di dipendenza (card-trades.js richiede questo file per CARD_BY_KEY).
  try {
    const cardTrades = require('./card-trades');
    await cardTrades.notifyMatchesForTag(admin, cocTag);
  } catch (_) {}

  return { ok: true, saved: data };
}

module.exports = {
  getSettings,
  setEnabled,
  isEventLive,
  catalogPayload,
  getCollectionsForUser,
  saveCardState,
};
