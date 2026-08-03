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

function normTag(tag) {
  return String(tag || '').replace(/^#/, '').toUpperCase();
}

function encodeClanTag(tag) {
  const t = String(tag || '').trim();
  const withHash = t.startsWith('#') ? t : `#${t}`;
  return encodeURIComponent(withHash);
}

/** Chiamata diretta CoC API (stesso token del proxy Render) — evita Vercel e self-HTTP. */
async function fetchCocApi(path, timeoutMs = 20000) {
  const token = process.env.COC_API_TOKEN;
  if (!token) throw new Error('COC_API_TOKEN mancante');
  const r = await fetch(`https://api.clashofclans.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.reason || data.message || `CoC HTTP ${r.status}`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * Guerre CWL attive del clan via API CoC diretta (leaguegroup + solo war del clan).
 * Molto più affidabile di /api/cwl-stats via Vercel per le notifiche.
 */
async function cwlActiveWarsDirect(clanTag) {
  const raw = String(clanTag || '').trim();
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  const norm = normTag(withHash);
  const lg = await fetchCocApi(`/clans/${encodeClanTag(withHash)}/currentwar/leaguegroup`, 25000);
  if (!lg || lg.state === 'notInWar') {
    return { state: 'notInWar', season: null, roundsData: [], groupStandings: [] };
  }

  const warTagToRound = {};
  (lg.rounds || []).forEach((round, idx) => {
    (round.warTags || []).filter((t) => t && t !== '#0').forEach((wt) => {
      warTagToRound[wt] = idx + 1;
    });
  });
  const warTags = Object.keys(warTagToRound);
  const warResults = await Promise.all(
    warTags.map(async (wt) => {
      try {
        const w = await fetchCocApi(`/clanwarleagues/wars/${encodeURIComponent(wt)}`, 20000);
        return w && w.state !== 'notInWar' ? w : null;
      } catch (_) {
        return null;
      }
    }),
  );

  const roundsData = [];
  for (let i = 0; i < warTags.length; i++) {
    const war = warResults[i];
    if (!war) continue;
    const ourSide =
      normTag(war.clan?.tag) === norm ? war.clan
        : normTag(war.opponent?.tag) === norm ? war.opponent
          : null;
    if (!ourSide) continue;
    const theirSide = ourSide === war.clan ? war.opponent : war.clan;
    const mapMembers = (members) =>
      (members || []).map((m) => ({
        tag: m.tag,
        name: m.name,
        thLevel: m.townhallLevel ?? m.townHallLevel ?? null,
        mapPosition: m.mapPosition ?? null,
        attacks: (m.attacks || []).map((a) => ({
          defenderTag: a.defenderTag,
          stars: a.stars,
          destruction: a.destructionPercentage,
          order: a.order,
        })),
      }));
    roundsData.push({
      roundNumber: warTagToRound[warTags[i]] || roundsData.length + 1,
      state: war.state,
      startTime: war.startTime || null,
      preparationStartTime: war.preparationStartTime || null,
      endTime: war.endTime || null,
      teamSize: war.teamSize || 15,
      attacksPerMember: war.attacksPerMember || 1,
      clan: {
        tag: ourSide.tag,
        name: ourSide.name,
        stars: ourSide.stars || 0,
        destruction: +(ourSide.destructionPercentage || 0).toFixed(2),
        members: mapMembers(ourSide.members),
      },
      opponent: {
        tag: theirSide?.tag,
        name: theirSide?.name || 'Sconosciuto',
        stars: theirSide?.stars || 0,
        destruction: +(theirSide?.destructionPercentage || 0).toFixed(2),
        members: mapMembers(theirSide?.members),
      },
    });
  }
  roundsData.sort((a, b) => (a.roundNumber || 0) - (b.roundNumber || 0));

  const groupStandings = (lg.clans || []).map((c) => ({
    tag: c.tag,
    name: c.name,
    stars: 0,
    warCount: 0,
  }));

  return {
    state: lg.state,
    season: lg.season || null,
    leagueNameEn: null,
    leagueNameIt: null,
    teamSize: roundsData[0]?.teamSize || 15,
    groupStandings,
    roundsData,
    players: [],
  };
}

async function currentWarDirect(clanTag) {
  const raw = String(clanTag || '').trim();
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  try {
    const war = await fetchCocApi(`/clans/${encodeClanTag(withHash)}/currentwar`, 20000);
    if (war && war.state && war.state !== 'notInWar') return war;
  } catch (_) {}
  const cwl = await cwlActiveWarsDirect(withHash);
  const wars = listCwlWarsFromStats(cwl);
  return (
    wars.find((r) => r.state === 'inWar' || r.state === 'preparation') ||
    wars[wars.length - 1] ||
    { state: 'notInWar' }
  );
}

async function clanMembers(clanTag) {
  return fetchJson('/api/clan-members', { clanTag });
}

async function clanInfo(clanTag) {
  if (process.env.COC_API_TOKEN) {
    try {
      return await fetchCocApi(`/clans/${encodeClanTag(clanTag)}`, 15000);
    } catch (e) {
      console.warn('[cocboard-api] clanInfo direct failed', e.message);
    }
  }
  try {
    const data = await fetchCoC('/clan-info', '/api/clan-info', { clanTag }, 20000);
    return data;
  } catch (_) {
    return fetchJson('/api/clan-info', { clanTag });
  }
}

async function cwlStats(clanTag) {
  if (process.env.COC_API_TOKEN) {
    try {
      return await cwlActiveWarsDirect(clanTag);
    } catch (e) {
      console.warn('[cocboard-api] cwl direct failed', e.message);
    }
  }
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
  const total = Math.max(rounds.length, 7);
  return rounds.map((r) => mapCwlRoundToWar(r, total)).filter(Boolean);
}

async function currentWar(clanTag) {
  if (process.env.COC_API_TOKEN) {
    try {
      return await currentWarDirect(clanTag);
    } catch (e) {
      console.warn('[cocboard-api] currentWar direct failed', e.message);
    }
  }
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
