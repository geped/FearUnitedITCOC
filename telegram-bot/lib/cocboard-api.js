'use strict';

/**
 * Client verso gli stessi endpoint pubblici del sito (Vercel → render-proxy),
 * oppure direttamente al proxy locale quando bot e proxy condividono il processo Render.
 *
 * In CWL `/currentwar` spesso restituisce `notInWar`: serve `/cwl-live` (più lento).
 * Passare da Vercel Hobby (~10s max) fa fallire le notifiche → preferiamo 127.0.0.1.
 */

function apiBase() {
  const b = process.env.COCBOARD_API_BASE;
  if (!b || !String(b).trim()) throw new Error('COCBOARD_API_BASE non configurata.');
  return String(b).replace(/\/$/, '');
}

/** True sul servizio unificato Render (proxy CoC + bot). */
function canUseLocalProxy() {
  return Boolean(
    process.env.SYNC_SECRET &&
    process.env.COC_API_TOKEN &&
    (process.env.PORT || process.env.RENDER_EXTERNAL_URL),
  );
}

function localProxyBase() {
  const port = Number(process.env.PORT) || 3000;
  return `http://127.0.0.1:${port}`;
}

async function fetchJson(path, searchParams = {}, timeoutMs = 28000) {
  const url = new URL(path, apiBase() + '/');
  for (const [k, v] of Object.entries(searchParams)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.href, {
    signal: AbortSignal.timeout(timeoutMs),
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

async function fetchLocalProxy(path, searchParams = {}, timeoutMs = 55000) {
  const url = new URL(path, localProxyBase() + '/');
  for (const [k, v] of Object.entries(searchParams)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.href, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json',
      'x-sync-key': process.env.SYNC_SECRET || '',
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.message === 'string' && data.message) ||
      `Proxy HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

/** Preferisce proxy locale; fallback Vercel. */
async function fetchCoC(proxyPath, vercelPath, searchParams, timeoutMs = 55000) {
  if (canUseLocalProxy()) {
    try {
      return await fetchLocalProxy(proxyPath, searchParams, timeoutMs);
    } catch (e) {
      console.warn('[cocboard-api] local proxy failed', proxyPath, e.message);
    }
  }
  return fetchJson(vercelPath, searchParams, Math.min(timeoutMs, 28000));
}

async function clanMembers(clanTag) {
  return fetchJson('/api/clan-members', { clanTag });
}

async function clanInfo(clanTag) {
  try {
    const data = await fetchCoC('/clan-info', '/api/clan-info', { clanTag }, 20000);
    return data;
  } catch (_) {
    return fetchJson('/api/clan-info', { clanTag });
  }
}

async function cwlStats(clanTag) {
  const data = await fetchCoC('/cwl-live', '/api/cwl-stats', { clanTag }, 55000);
  return data;
}

async function warLog(clanTag) {
  return fetchJson('/api/war-log', { clanTag });
}

/** Converte un round di cwl-stats nel formato “war” usato dalle notifiche. */
function mapCwlRoundToWar(round, totalRounds = 7) {
  if (!round || !round.state) return null;
  const mapMembers = (members) =>
    (Array.isArray(members) ? members : []).map((m) => ({
      name: m?.name,
      tag: m?.tag,
      mapPosition: m?.mapPosition ?? null,
      townHallLevel: m?.thLevel ?? m?.townHallLevel ?? m?.townhallLevel ?? null,
      attacks: (Array.isArray(m?.attacks) ? m.attacks : []).map((a) => ({
        stars: Number(a?.stars || 0),
        destructionPercentage: Number(a?.destruction ?? a?.destructionPercentage ?? 0),
        defenderTag: a?.defenderTag || null,
      })),
    }));
  const n = Number(round.roundNumber);
  return {
    state: round.state === 'ended' ? 'warEnded' : round.state,
    warType: 'cwl',
    roundNumber: Number.isFinite(n) && n > 0 ? n : null,
    totalRounds: Number(totalRounds) || 7,
    teamSize: Number(round.teamSize || 0),
    attacksPerMember: Number(round.attacksPerMember || 1),
    endTime: round.endTime || null,
    startTime: round.startTime || null,
    preparationStartTime: round.preparationStartTime || null,
    clan: {
      name: round?.clan?.name || '',
      tag: round?.clan?.tag || null,
      stars: Number(round?.clan?.stars || 0),
      destructionPercentage: Number(round?.clan?.destruction ?? round?.clan?.destructionPercentage ?? 0),
      members: mapMembers(round?.clan?.members),
    },
    opponent: {
      name: round?.opponent?.name || '',
      tag: round?.opponent?.tag || null,
      stars: Number(round?.opponent?.stars || 0),
      destructionPercentage: Number(
        round?.opponent?.destruction ?? round?.opponent?.destructionPercentage ?? 0,
      ),
      members: mapMembers(round?.opponent?.members),
    },
  };
}

/** Tutte le guerre CWL della stagione corrente (prep / inWar / ended). */
function listCwlWarsFromStats(cwl) {
  const rounds = Array.isArray(cwl?.roundsData) ? cwl.roundsData : [];
  const total = rounds.length || 7;
  return rounds.map((r) => mapCwlRoundToWar(r, total)).filter(Boolean);
}

async function currentWar(clanTag) {
  let war = null;
  try {
    war = await fetchCoC('/current-war', '/api/lookup', { type: 'current-war', clanTag }, 20000);
  } catch (_) {
    war = await fetchJson('/api/lookup', { type: 'current-war', clanTag }).catch(() => null);
  }
  // In CWL `/currentwar` spesso è notInWar: fallback su cwl-live.
  const state = String(war?.state || '');
  if (state && state !== 'notInWar') return war;

  const cwl = await cwlStats(clanTag).catch(() => null);
  const wars = listCwlWarsFromStats(cwl);
  if (!wars.length) return war || { state: 'notInWar' };

  const active =
    wars.find((r) => r && (r.state === 'inWar' || r.state === 'preparation')) ||
    wars[wars.length - 1];
  return active || war || { state: 'notInWar' };
}

async function capitalRaids(clanTag) {
  try {
    return await fetchCoC('/capital-raids', '/api/lookup', { type: 'capital-raids', clanTag }, 25000);
  } catch (_) {
    return fetchJson('/api/lookup', { type: 'capital-raids', clanTag });
  }
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
  mapCwlRoundToWar,
  listCwlWarsFromStats,
  capitalRaids,
  saveWar,
  lookupPlayer,
  searchClans,
  rankings,
  registerWithCoc,
  canUseLocalProxy,
};
