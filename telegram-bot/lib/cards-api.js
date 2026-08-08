'use strict';

/**
 * Client evento "Clash of Cards" (scambio carte) verso /api/lookup (Vercel).
 * Stesso pattern JWT di profiles-api.js. Usato da cards-ui.js dopo login.
 */

function apiBase() {
  const b = process.env.COCBOARD_API_BASE;
  if (!b || !String(b).trim()) throw new Error('COCBOARD_API_BASE non configurata.');
  return String(b).replace(/\/$/, '');
}

async function callCards(type, accessToken, { method = 'GET', body = null, params = null } = {}) {
  const url = new URL('/api/lookup', apiBase() + '/');
  url.searchParams.set('type', type);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const headers = { Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const opts = { method, headers, signal: AbortSignal.timeout(25000) };
  if (body != null) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url.href, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.status = r.status;
    err.code = data.code;
    err.body = data;
    throw err;
  }
  return data;
}

async function catalog() {
  return callCards('cards-catalog', null, { method: 'GET' });
}

async function getCollection(accessToken) {
  return callCards('cards-get', accessToken, { method: 'GET' });
}

async function saveCard(accessToken, { cocTag, cardKey, qtyState }) {
  return callCards('cards-save', accessToken, {
    method: 'POST',
    body: { coc_tag: cocTag, card_key: cardKey, qty_state: qtyState },
  });
}

async function adminToggle(accessToken, enabled) {
  return callCards('cards-admin-toggle', accessToken, { method: 'POST', body: { enabled: enabled === true } });
}

async function matches(accessToken, profileId) {
  return callCards('cards-matches', accessToken, { method: 'GET', params: { profile_id: profileId } });
}

async function selfMatches(accessToken) {
  return callCards('cards-self-matches', accessToken, { method: 'GET' });
}

async function rooms(accessToken) {
  return callCards('cards-rooms', accessToken, { method: 'GET' });
}

async function roomOpen(accessToken, { profileId, otherCocTag }) {
  return callCards('cards-room-open', accessToken, {
    method: 'POST',
    body: { profile_id: profileId, other_coc_tag: otherCocTag },
  });
}

async function roomDetail(accessToken, roomId) {
  return callCards('cards-room-detail', accessToken, { method: 'GET', params: { room_id: roomId } });
}

async function roomSend(accessToken, { roomId, profileId, body }) {
  return callCards('cards-room-send', accessToken, {
    method: 'POST',
    body: { room_id: roomId, profile_id: profileId, body },
  });
}

async function propose(accessToken, { roomId, profileId, cardGive, cardGet }) {
  return callCards('cards-propose', accessToken, {
    method: 'POST',
    body: { room_id: roomId, profile_id: profileId, card_give: cardGive, card_get: cardGet },
  });
}

async function respond(accessToken, { proposalId, profileId, action }) {
  return callCards('cards-respond', accessToken, {
    method: 'POST',
    body: { proposal_id: proposalId, profile_id: profileId, action },
  });
}

async function selfApply(accessToken, { profileA, profileB, cardAToB, cardBToA }) {
  return callCards('cards-self-apply', accessToken, {
    method: 'POST',
    body: { profile_a: profileA, profile_b: profileB, card_a_to_b: cardAToB, card_b_to_a: cardBToA },
  });
}

async function tradeLog(accessToken) {
  return callCards('cards-trade-log', accessToken, { method: 'GET' });
}

async function publicList(accessToken, profileId) {
  return callCards('cards-public-list', accessToken, { method: 'GET', params: { profile_id: profileId } });
}

async function publicToggle(accessToken, profileId, isPublic) {
  return callCards('cards-public-toggle', accessToken, {
    method: 'POST',
    body: { profile_id: profileId, is_public: isPublic === true },
  });
}

module.exports = {
  catalog,
  getCollection,
  saveCard,
  adminToggle,
  matches,
  selfMatches,
  rooms,
  roomOpen,
  roomDetail,
  roomSend,
  propose,
  respond,
  selfApply,
  tradeLog,
  publicList,
  publicToggle,
};
