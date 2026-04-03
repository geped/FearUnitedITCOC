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

function getDefaultClanTag() {
  const t = process.env.DEFAULT_CLAN_TAG || '#2J2VLPP9R';
  const s = String(t).trim().toUpperCase();
  return s.startsWith('#') ? s : `#${s}`;
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

async function lookupPlayer(playerTag) {
  return fetchJson('/api/lookup', { type: 'player', playerTag });
}

async function searchClans(q) {
  return fetchJson('/api/lookup', { type: 'search-clans', q });
}

module.exports = {
  fetchJson,
  getDefaultClanTag,
  clanMembers,
  clanInfo,
  cwlStats,
  warLog,
  lookupPlayer,
  searchClans,
};
