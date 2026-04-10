'use strict';

/**
 * Client verso gli stessi endpoint pubblici del sito (Vercel → render-proxy).
 */
function apiBase() {
  const b = process.env.COCBOARD_API_BASE;
  if (!b || !String(b).trim()) throw new Error('COCBOARD_API_BASE non configurata.');
  return String(b).replace(/\/$/, '');
}

async function fetchJson(path, searchParams = {}) {
  const url = new URL(path, apiBase() + '/');
  for (const [k, v] of Object.entries(searchParams)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.href, {
    signal: AbortSignal.timeout(28000),
    headers: { Accept: 'application/json' },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.message === 'string' && data.message) ||
      `Errore HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function clanMembers(clanTag) {
  return fetchJson('/api/clan-members', { clanTag });
}

async function clanInfo(clanTag) {
  return fetchJson('/api/clan-info', { clanTag });
}

async function cwlStats(clanTag) {
  return fetchJson('/api/cwl-stats', { clanTag });
}

async function warLog(clanTag) {
  return fetchJson('/api/war-log', { clanTag });
}

async function currentWar(clanTag) {
  return fetchJson('/api/lookup', { type: 'current-war', clanTag });
}

async function capitalRaids(clanTag) {
  return fetchJson('/api/lookup', { type: 'capital-raids', clanTag });
}

/** Salva la war conclusa per il clan (POST /api/auto-save-wars). */
async function saveWar(clanTag) {
  const url = new URL('/api/auto-save-wars', apiBase() + '/');
  url.searchParams.set('clanTag', String(clanTag));
  const r = await fetch(url.href, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = typeof data.error === 'string' ? data.error : `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data;
}

async function lookupPlayer(playerTag) {
  return fetchJson('/api/lookup', { type: 'player', playerTag });
}

async function searchClans(q) {
  return fetchJson('/api/lookup', { type: 'search-clans', q });
}

/** Classifiche CoC (stesso endpoint del sito: Italia vs globale). */
async function rankings(rankType, locationId) {
  return fetchJson('/api/lookup', { type: 'rankings', rankType, locationId });
}

/** Stessa registrazione del sito (POST /api/register-with-coc). */
async function registerWithCoc({ playerTag, apiToken, password, email }) {
  const url = new URL('/api/register-with-coc', apiBase() + '/');
  const r = await fetch(url.href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      playerTag,
      apiToken,
      password,
      ...(email ? { email } : {}),
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = typeof data.error === 'string' ? data.error : `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data;
}

module.exports = {
  fetchJson,
  clanMembers,
  clanInfo,
  cwlStats,
  warLog,
  currentWar,
  capitalRaids,
  saveWar,
  lookupPlayer,
  searchClans,
  rankings,
  registerWithCoc,
};
