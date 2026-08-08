'use strict';
/**
 * Notifiche estese – CoCBoard Bot
 * Guerra Classica, CWL, Raid Capitale, Attività Clan.
 *
 * Ogni funzione viene chiamata ogni 60 secondi (war/raid) o ogni 5 minuti
 * (attività clan). Lo stato in memoria viene azzerato al riavvio del processo;
 * le notifiche di transizione (prep_start, war_start, …) non vengono riproposte
 * al primo ciclo dopo restart (per evitare falsi allarmi).
 */

const api = require('./cocboard-api');
const fmt = require('./format');
const raidCap = require('./raid-capital');

// ─────────────────────────────────────────────────────────────────────────────
// State memories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * warStateMem: key `${chatId}:${clanTag}`
 * value: { state, endTime, sent: Set<string> }
 * "state" è lo stato letto all'ultimo ciclo. "sent" tiene traccia dei tipi di
 * notifica già inviati per la guerra corrente (anti-spam e anti-duplicati).
 */
const warStateMem = new Map();

/**
 * raidStateMem: key `${chatId}:${clanTag}`
 * value: { state, startTime, destroyed: Set, clearedEnemies: Set, sent: Set }
 */
const raidStateMem = new Map();

/**
 * clanStateMem: key `${clanTag}` (condiviso tra chat, snapshot unico per clan)
 * value: { members: Map<tag,{name,role}>, level, name }
 * La notifica viene comunque inviata per ogni singola chat che la richiede.
 */
const clanStateMem = new Map();
const cwlSeasonMem = new Map(); // key `${chatId}:${clanTag}` -> { season, state, leagueNameEn, sent:Set<string> }
const cwlStatsCache = new Map(); // key clanTag -> { ts, data }

let lastClanActivityRun = 0;
const CWL_STATS_CACHE_MS = 45 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function parseCocTime(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`);
}

/** Inizio battle: startTime, oppure stima da endTime/−24h o preparationStartTime/+23h. */
function resolveBattleStart(war) {
  let startDate = parseCocTime(war?.startTime);
  if (startDate) return startDate;
  const endD = parseCocTime(war?.endTime);
  if (endD) return new Date(endD.getTime() - 24 * 3600 * 1000);
  const prepD = parseCocTime(war?.preparationStartTime);
  if (prepD) return new Date(prepD.getTime() + 23 * 3600 * 1000);
  return null;
}

function warMemKey(chatId, clanTag, war) {
  const warId = war?.endTime || `r${war?.roundNumber || 0}`;
  return `${chatId}:${clanTag}:${warId}`;
}

function getOrCreateWarMem(chatId, clanTag, war) {
  const memKey = warMemKey(chatId, clanTag, war);
  let prev = warStateMem.get(memKey);
  if (!prev) {
    prev = { state: 'unknown', endTime: war?.endTime ?? null, sent: new Set() };
    warStateMem.set(memKey, prev);
  }
  return prev;
}

/**
 * Alert personalizzati in attesa di soglia (niente API: solo confronto orologio).
 * key: `${chatId}:${kind}:${warKey}`
 * value: { chatId, clanTag, kind, leadMin, targetMs, warKey, payload, isCwl }
 */
const pendingCustomAlerts = new Map();

function clearCustomSentForChat(chatId, clanTag) {
  const prefix = `${Number(chatId)}:${String(clanTag)}:`;
  for (const [k, mem] of warStateMem.entries()) {
    if (!String(k).startsWith(prefix) || !mem?.sent) continue;
    for (const s of [...mem.sent]) {
      if (String(s).startsWith('custom_start:') || String(s).startsWith('custom_end:')) {
        mem.sent.delete(s);
      }
    }
  }
  for (const [k] of pendingCustomAlerts.entries()) {
    if (k.startsWith(`${Number(chatId)}:`)) pendingCustomAlerts.delete(k);
  }
}

function msLabel(ms) {
  if (ms <= 0) return '0 min';
  // floor: allinea al timer di gioco (ceil mostrava ~1 min in più)
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const r = mins % 60;
    return r > 0 ? `${h}h ${r} min` : `${h}h`;
  }
  return `${mins} min`;
}

function leadMs(minutes) {
  return Number(minutes || 0) * 60 * 1000;
}

/** True se il tempo residuo è entro la soglia (puntuale, senza anticipo). */
function withinCustomLead(remainingMs, leadMinutes) {
  const lead = leadMs(leadMinutes);
  if (!(lead > 0) || !Number.isFinite(remainingMs)) return false;
  return remainingMs > 0 && remainingMs <= lead;
}

function leadLabel(minutes) {
  const n = Number(minutes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 min';
  const h = Math.floor(n / 60);
  const r = n % 60;
  if (h > 0 && r > 0) return `${h}h ${r} min`;
  if (h > 0) return `${h}h`;
  return `${r} min`;
}

function warOutcome(war) {
  const cs = war?.clan?.stars || 0;
  const os = war?.opponent?.stars || 0;
  const cd = Number(war?.clan?.destructionPercentage || 0);
  const od = Number(war?.opponent?.destructionPercentage || 0);
  if (cs > os || (cs === os && cd > od)) return '🏆 Vittoria';
  if (cs < os || (cs === os && cd < od)) return '💀 Sconfitta';
  return '🤝 Pareggio';
}

function memberTh(m) {
  const v = m?.townHallLevel ?? m?.townhallLevel ?? m?.thLevel;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function missingAttacks(war, side = 'clan') {
  const aPM = war?.attacksPerMember || 1;
  const members = side === 'opponent' ? (war?.opponent?.members || []) : (war?.clan?.members || []);
  return members
    .filter((m) => (m.attacks?.length || 0) < aPM)
    .map((m) => ({
      name: m.name,
      th: memberTh(m),
      mapPosition: m.mapPosition ?? null,
      missing: aPM - (m.attacks?.length || 0),
    }))
    .sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
}

/** Villaggi con meno di 3★ in difesa (best attack ricevuto). */
function villagesNotThreeStarred(war, side = 'clan') {
  const defenders = side === 'opponent' ? (war?.opponent?.members || []) : (war?.clan?.members || []);
  const attackers = side === 'opponent' ? (war?.clan?.members || []) : (war?.opponent?.members || []);
  const bestByDef = new Map();
  for (const atkMember of attackers) {
    for (const a of atkMember.attacks || []) {
      const tag = a.defenderTag;
      if (!tag) continue;
      const prev = bestByDef.get(tag) || { stars: 0, destruction: 0 };
      const stars = Number(a.stars || 0);
      const destr = Number(a.destructionPercentage || 0);
      if (stars > prev.stars || (stars === prev.stars && destr > prev.destruction)) {
        bestByDef.set(tag, { stars, destruction: destr });
      }
    }
  }
  return defenders
    .map((m) => {
      const best = bestByDef.get(m.tag) || { stars: 0, destruction: 0 };
      return {
        name: m.name,
        th: memberTh(m),
        mapPosition: m.mapPosition ?? null,
        bestStars: best.stars,
        bestDest: best.destruction,
      };
    })
    .filter((v) => v.bestStars < 3)
    .sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
}

function formatMissingLine(m) {
  const th = m.th != null ? ` TH${m.th}` : '';
  const pos = m.mapPosition != null ? `#${m.mapPosition} ` : '';
  return `• ${pos}${fmt.escapeHtml(m.name || '—')}${th} (${m.missing} att.)`;
}

function formatOpenBaseLine(v) {
  const th = v.th != null ? ` TH${v.th}` : '';
  const pos = v.mapPosition != null ? `#${v.mapPosition} ` : '';
  const st = v.bestStars > 0 ? `${v.bestStars}★` : '0★';
  return `• ${pos}${fmt.escapeHtml(v.name || '—')}${th} · ${st}`;
}

function roleLabel(role) {
  return ({ member: 'Membro', admin: 'Anziano', coLeader: 'Co-Capo', leader: 'Capo' })[role] || (role || '?');
}
function roleRank(role) {
  return ({ member: 1, admin: 2, coLeader: 3, leader: 4 })[role] || 0;
}

function leagueRank(leagueNameEn) {
  const order = {
    'Bronze League III': 1,
    'Bronze League II': 2,
    'Bronze League I': 3,
    'Silver League III': 4,
    'Silver League II': 5,
    'Silver League I': 6,
    'Gold League III': 7,
    'Gold League II': 8,
    'Gold League I': 9,
    'Crystal League III': 10,
    'Crystal League II': 11,
    'Crystal League I': 12,
    'Master League III': 13,
    'Master League II': 14,
    'Master League I': 15,
    'Champion League III': 16,
    'Champion League II': 17,
    'Champion League I': 18,
    'Titan League III': 19,
    'Titan League II': 20,
    'Titan League I': 21,
    'Legend League': 22,
  };
  return order[String(leagueNameEn || '').trim()] || 0;
}

async function getCachedCwlStats(clanTag) {
  const key = String(clanTag || '');
  const now = Date.now();
  const hit = cwlStatsCache.get(key);
  if (hit && (now - hit.ts) < CWL_STATS_CACHE_MS) return hit.data;
  const data = await api.cwlStats(clanTag);
  cwlStatsCache.set(key, { ts: now, data });
  if (cwlStatsCache.size > 200) {
    const k = cwlStatsCache.keys().next();
    if (!k.done) cwlStatsCache.delete(k.value);
  }
  return data;
}

/** Invia messaggio a chatId; cancella il link se la chat è stale/inaccessibile. @returns {boolean} */
async function sendToChat(telegram, chatId, text, onStale) {
  try {
    await telegram.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    return true;
  } catch (e) {
    const s = String(e.message || '');
    if (s.includes('chat not found') || s.includes('bot was kicked') ||
        s.includes('bot is not a member') || s.includes('Forbidden') ||
        s.includes('deactivated')) {
      if (onStale) await onStale().catch(() => {});
    } else {
      console.warn('[notif-war] send failed', chatId, s);
    }
    return false;
  }
}

function cwlTurnLabel(war) {
  const n = Number(war?.roundNumber);
  if (!Number.isFinite(n) || n <= 0) return '';
  // CWL = 7 turni; roundsData può avere solo i round già creati dall'API
  const total = Math.max(Number(war?.totalRounds) || 0, 7);
  return ` · Turno ${n}/${total}`;
}

function buildWarAlertMsg(war, missing, isCwl, timeLabel) {
  const label = isCwl ? '🏆 CWL' : '⚔️ Guerra';
  const cn    = fmt.escapeHtml(war?.clan?.name || '');
  const on    = fmt.escapeHtml(war?.opponent?.name || '');
  const cs    = Number(war?.clan?.stars || 0);
  const os    = Number(war?.opponent?.stars || 0);
  const cd    = Number(war?.clan?.destructionPercentage || 0).toFixed(1);
  const od    = Number(war?.opponent?.destructionPercentage || 0).toFixed(1);
  const turn  = isCwl ? cwlTurnLabel(war) : '';
  const hdr   = `${label} · <b>${cn}</b> vs <b>${on}</b>${turn}\n<b>${timeLabel}</b>`;
  const score = `📊 Stato attuale: <b>${cs}★</b> (${cd}%) vs <b>${os}★</b> (${od}%)`;

  const missOurs = missing || missingAttacks(war, 'clan');
  const missOpp  = missingAttacks(war, 'opponent');
  const openOurs = villagesNotThreeStarred(war, 'clan');
  const openOpp  = villagesNotThreeStarred(war, 'opponent');

  const parts = [`${hdr}\n${score}`];
  if (!missOurs.length) {
    parts.push('✅ Tutti i nostri giocatori hanno completato gli attacchi!');
  } else {
    parts.push(`<b>Attacchi mancanti (noi):</b>\n${missOurs.slice(0, 15).map(formatMissingLine).join('\n')}`);
  }
  if (missOpp.length) {
    parts.push(`<b>Attacchi mancanti (avversari):</b>\n${missOpp.slice(0, 15).map(formatMissingLine).join('\n')}`);
  }
  if (openOurs.length) {
    parts.push(`<b>Villaggi non 3★ (nostri):</b>\n${openOurs.slice(0, 12).map(formatOpenBaseLine).join('\n')}`);
  }
  if (openOpp.length) {
    parts.push(`<b>Villaggi non 3★ (avversari):</b>\n${openOpp.slice(0, 12).map(formatOpenBaseLine).join('\n')}`);
  }
  return parts.join('\n\n');
}

function buildWarFinalMsg(war, isCwl, streakInfo) {
  const c    = war?.clan || {};
  const o    = war?.opponent || {};
  const turn = isCwl ? cwlTurnLabel(war) : '';
  const lbl  = isCwl ? `🏆 Recap round CWL${turn}` : '⚔️ Recap guerra';
  const out  = warOutcome(war);
  const miss = missingAttacks(war, 'clan');
  let body   = `📣 <b>${lbl}</b>\n${out} · ${c.stars||0}★ vs ${o.stars||0}★ · ${Number(c.destructionPercentage||0).toFixed(1)}% vs ${Number(o.destructionPercentage||0).toFixed(1)}%`;
  if (miss.length) {
    body += `\n\n<b>Non hanno attaccato:</b>\n${miss.slice(0, 15).map(formatMissingLine).join('\n')}`;
  } else {
    body += `\n✅ Tutti hanno completato gli attacchi.`;
  }
  if (streakInfo && streakInfo.won && Number(streakInfo.streak) > 0) {
    body += `\n\n🔥 <b>Serie vittorie!</b>\nIl clan è ora a <b>${Number(streakInfo.streak)}</b> vittorie consecutive.`;
  }
  return body;
}

function buildCwlStandingsMsg(cwl, war) {
  const rows = Array.isArray(cwl?.groupStandings) ? [...cwl.groupStandings] : [];
  rows.sort((a, b) => {
    const as = Number(a?.stars || 0);
    const bs = Number(b?.stars || 0);
    if (bs !== as) return bs - as;
    return Number(b?.totalDestr || 0) - Number(a?.totalDestr || 0);
  });
  const turn = cwlTurnLabel(war);
  const lines = rows.slice(0, 8).map((c, i) => {
    const name = fmt.escapeHtml(c?.name || '—');
    const stars = Number(c?.stars || 0);
    const wins = c?.wins != null ? Number(c.wins) : null;
    const winPart = wins != null && Number.isFinite(wins) ? ` (${wins}W)` : '';
    return `${i + 1}. <b>${name}</b> — ${stars}⭐${winPart}`;
  });
  if (!lines.length) {
    return `📊 <b>CWL · Classifica gruppo${turn}</b>\n<i>Dati classifica non disponibili.</i>`;
  }
  return `📊 <b>CWL · Classifica gruppo${turn}</b>\n${lines.join('\n')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guerra Classica + CWL
// ─────────────────────────────────────────────────────────────────────────────

async function runExtendedWarAlerts(bot, sb) {
  let links = [];
  try {
    links = await sb.listEnabledTelegramChatLinks();
  } catch (e) {
    console.warn('[notif-war] list links:', e.message);
    return;
  }
  for (const link of links) {
    const chatId  = Number(link.telegram_chat_id);
    const clanTag = link.clan_tag;
    if (!Number.isFinite(chatId) || !clanTag) continue;
    try {
      await _warAlertsForChat(bot.telegram, chatId, clanTag, sb);
    } catch (e) {
      const s = String(e.message || '');
      if (s.includes('chat not found') || s.includes('bot was kicked') ||
          s.includes('Forbidden') || s.includes('deactivated')) {
        await sb.deleteTelegramChatLink(chatId).catch(() => {});
      } else {
        console.warn('[notif-war] chat', chatId, e.message);
      }
    }
  }
  // Pulizia memoria
  if (warStateMem.size > 800) {
    const k = warStateMem.keys().next();
    if (!k.done) warStateMem.delete(k.value);
  }
}

async function _cwlSeasonAlerts(telegram, chatId, clanTag, sb, notif, cwl) {
  const key = `${chatId}:${clanTag}`;
  const prev = cwlSeasonMem.get(key) || { season: null, state: 'unknown', leagueNameEn: null, sent: new Set() };
  const sent = prev.sent;
  const curSeason = String(cwl?.season || '');
  const curState = String(cwl?.state || '');
  const curLeague = String(cwl?.leagueNameEn || cwl?.leagueNameIt || '');
  const send = (text) => sendToChat(telegram, chatId, text, () => sb.deleteTelegramChatLink(chatId));

  const isActive =
    curState &&
    curState !== 'notInWar' &&
    curState !== 'ended' &&
    curState !== 'unknown';
  const newSeason = curSeason && prev.season && prev.season !== curSeason;
  // Cold-start / primo ciclo: memorizza senza notificare (evita «CWL iniziata!» a ogni redeploy)
  const coldStart = prev.state === 'unknown';

  if (
    !coldStart &&
    notif.cwl_season_start === true &&
    (((prev.state === 'notInWar' || prev.state === 'ended' || !prev.state) && isActive) || newSeason) &&
    curSeason
  ) {
    const sk = `season_start:${curSeason}`;
    if (!sent.has(sk)) {
      sent.add(sk);
      const league = fmt.escapeHtml(cwl?.leagueNameIt || cwl?.leagueNameEn || '—');
      const size = Number(cwl?.teamSize || 15);
      const clans = Array.isArray(cwl?.groupStandings) ? cwl.groupStandings.length : 8;
      await send(
        `🏆 <b>CWL iniziata!</b>\n` +
        `Lega: <b>${league}</b> · ${size}v${size} · ${clans} clan nel gruppo\n` +
        `Stagione: <b>${fmt.escapeHtml(curSeason)}</b>`,
      );
    }
  } else if (coldStart && curSeason && isActive) {
    sent.add(`season_start:${curSeason}`);
  }

  if (
    notif.cwl_end === true &&
    prev.state &&
    prev.state !== 'unknown' &&
    prev.state !== 'notInWar' &&
    prev.state !== 'ended' &&
    curState === 'ended'
  ) {
    const endKey = `cwl_end:${curSeason || prev.season || 'na'}`;
    if (!sent.has(endKey)) {
      sent.add(endKey);
      await send(`🏁 <b>Stagione CWL terminata</b>\nStagione: <b>${fmt.escapeHtml(curSeason || prev.season || '—')}</b>`);
    }
  }

  const prevRank = leagueRank(prev.leagueNameEn);
  const curRank = leagueRank(curLeague);
  if (prevRank > 0 && curRank > 0 && prevRank !== curRank) {
    const lk = `cwl_league:${curSeason || 'na'}:${curLeague}`;
    if (!sent.has(lk)) {
      sent.add(lk);
      if (curRank > prevRank && notif.cwl_league_promotion === true) {
        await send(`📈 <b>Promozione CWL</b>\nNuova lega: <b>${fmt.escapeHtml(curLeague)}</b>`);
      } else if (curRank < prevRank && notif.cwl_league_demotion === true) {
        await send(`📉 <b>Retrocessione CWL</b>\nNuova lega: <b>${fmt.escapeHtml(curLeague)}</b>`);
      }
    }
  }

  cwlSeasonMem.set(key, {
    season: curSeason || prev.season || null,
    state: curState || prev.state || 'unknown',
    leagueNameEn: curLeague || prev.leagueNameEn || null,
    sent,
  });
}

/**
 * Processa una singola guerra (classica o un round CWL).
 * Mem key per-guerra: permette overlap prep+battle senza perdere stato.
 */
async function _processSingleWarAlerts({
  telegram, chatId, clanTag, sb, notif, custom, war, isCwl, overlapPrep, cwl,
}) {
  if (!war) return;
  const state = String(war?.state || '');
  if (!state || state === 'notInWar') return;

  // Sub-flag fissi solo se master ON; custom lead è indipendente (customCfg sotto)
  const masterOn = isCwl
    ? notif?.cwl_alerts_enabled === true
    : notif?.war_alerts_enabled === true;

  const warId = war.endTime || `r${war.roundNumber || 0}`;
  const memKey = `${chatId}:${clanTag}:${warId}`;
  const prevMem = warStateMem.get(memKey) || { state: 'unknown', endTime: null, sent: new Set() };
  const sent = prevMem.sent;

  warStateMem.set(memKey, { state: state || 'notInWar', endTime: war?.endTime ?? null, sent });

  const now = Date.now();
  const endDate = parseCocTime(war?.endTime);
  const leftMs = endDate ? endDate.getTime() - now : Infinity;
  const noisy = prevMem.state !== 'unknown';
  const turn = isCwl ? cwlTurnLabel(war) : '';

  if (!noisy && war?.endTime) {
    // Solo transizioni “una tantum”: NON pre-segnare countdown/custom/roster.
    // NON fare return: i countdown devono poter partire al primo ciclo post-deploy.
    if (state === 'preparation') {
      sent.add('prep:' + war.endTime);
      sent.add('prep_next:' + war.endTime);
    }
    if (state === 'inWar') {
      sent.add('start:' + war.endTime);
      const ts0 = war.teamSize || 0;
      if (ts0 > 0 && (war?.clan?.stars || 0) >= ts0 * 3) {
        sent.add('3star:' + war.endTime);
      }
    }
    if (state === 'warEnded' || state === 'ended') {
      sent.add('final:' + war.endTime);
      sent.add('standings:' + war.endTime);
    }
  }

  const send = async (text) => sendToChat(telegram, chatId, text, () => sb.deleteTelegramChatLink(chatId));

  const customCfg = isCwl
    ? {
        enabled: custom?.cwl_enabled === true,
        paused: custom?.cwl_paused === true,
        lead: Number(custom?.cwl_lead_minutes || 0),
      }
    : {
        enabled: custom?.war_enabled === true,
        paused: custom?.war_paused === true,
        lead: Number(custom?.war_lead_minutes || 0),
      };

  // ── Preparazione ─────────────────────────────────────────────────────────
  if (state === 'preparation') {
    const isNew = prevMem.state !== 'preparation' || prevMem.endTime !== war.endTime;
    if (noisy && isNew) {
      const cn = fmt.escapeHtml(war?.clan?.name || 'Il nostro clan');
      const on = fmt.escapeHtml(war?.opponent?.name || 'Avversario');
      if (overlapPrep && masterOn && notif.cwl_prep_next === true) {
        const key = `prep_next:${war.endTime}`;
        if (!sent.has(key)) {
          if (await send(
            `🛡 <b>🏆 CWL – Prep turno successivo${turn}</b>\n` +
            `Avversario: <b>${on}</b>\n` +
            `La battle del turno precedente è ancora in corso.\n` +
            `Scegli il roster e riempi i CC per il prossimo round.`,
          )) {
            sent.add(key);
            sent.add(`prep:${war.endTime}`);
          }
        }
      } else if (masterOn && (isCwl ? notif.cwl_prep_start === true : notif.war_prep_start === true)) {
        const key = `prep:${war.endTime}`;
        if (!sent.has(key)) {
          const lbl = isCwl ? '🏆 CWL' : '⚔️ Guerra Classica';
          if (await send(
            `🛡 <b>${lbl} – Preparazione${turn}</b>\n` +
            `${cn} vs ${on}\n` +
            `Gli attacchi inizieranno presto.`,
          )) {
            sent.add(key);
          }
        }
      }
    }

    // startTime mancante: stima da endTime (−24h) o preparationStartTime (+23h)
    const startDate = resolveBattleStart(war);
    const untilStart = startDate ? startDate.getTime() - now : NaN;
    const minsToStart = Number.isFinite(untilStart) ? Math.max(0, Math.floor(untilStart / 60000)) : Infinity;

    // Schedula alert personalizzato puntuale (invio automatico alla soglia)
    if (
      customCfg.enabled &&
      !customCfg.paused &&
      Number.isFinite(customCfg.lead) &&
      customCfg.lead > 0 &&
      startDate &&
      untilStart > 0
    ) {
      const warKey = String(war.endTime || warId);
      const pendKey = `${chatId}:${isCwl ? 'cwl' : 'war'}:start:${warKey}`;
      const sentKey = `custom_start:${warKey}`;
      if (!sent.has(sentKey)) {
        pendingCustomAlerts.set(pendKey, {
          chatId,
          clanTag,
          warKey,
          mode: 'start',
          isCwl,
          leadMin: customCfg.lead,
          targetMs: startDate.getTime() - leadMs(customCfg.lead),
          deadlineMs: startDate.getTime(),
          sentKey,
          memKey,
          text:
            `🛡 <b>${isCwl ? '🏆 CWL' : '⚔️ Guerra'} – Preparazione${turn}</b>\n` +
            `<b>${fmt.escapeHtml(war?.clan?.name || '')}</b> vs <b>${fmt.escapeHtml(war?.opponent?.name || '')}</b>\n` +
            `<b>⏰ Mancano ${leadLabel(customCfg.lead)} all'inizio della battle</b>`,
        });
      }
      // Invio immediato solo se siamo già DENTRO la soglia (niente anticipo)
      if (withinCustomLead(untilStart, customCfg.lead) && !sent.has(sentKey)) {
        const ok = await send(
          `🛡 <b>${isCwl ? '🏆 CWL' : '⚔️ Guerra'} – Preparazione${turn}</b>\n` +
          `<b>${fmt.escapeHtml(war?.clan?.name || '')}</b> vs <b>${fmt.escapeHtml(war?.opponent?.name || '')}</b>\n` +
          `<b>⏰ Mancano ${leadLabel(customCfg.lead)} all'inizio della battle</b>`,
        );
        if (ok) {
          sent.add(sentKey);
          pendingCustomAlerts.delete(pendKey);
        } else {
          console.warn('[notif-war] custom_start send failed', chatId, clanTag);
        }
      }
    } else if (customCfg.enabled && !customCfg.paused && customCfg.lead > 0) {
      console.log(
        '[notif-war] custom_start skip',
        chatId,
        clanTag,
        'minsToStart=',
        minsToStart,
        'lead=',
        customCfg.lead,
        'start=',
        war.startTime || null,
      );
    }

    // Promemoria roster ~6h prima dell'inizio battle (solo CWL)
    if (isCwl && masterOn && notif.cwl_roster_reminder === true && minsToStart <= 360 && minsToStart > 0) {
      const key = `roster:${war.endTime}`;
      if (!sent.has(key)) {
        const on = fmt.escapeHtml(war?.opponent?.name || 'Avversario');
        const size = Number(war.teamSize || 0);
        const lined = Array.isArray(war?.clan?.members) ? war.clan.members.length : 0;
        const rosterHint =
          size > 0 && lined > 0 && lined < size
            ? `\nLinea attuale: <b>${lined}/${size}</b> — conferma i partecipanti.`
            : `\nRicorda: conferma i ${size || 15} in linea e i CC di difesa.`;
        if (await send(
          `📋 <b>CWL · Prep${turn}</b>\n` +
          `Mancano ~<b>${msLabel(untilStart)}</b> alla battle vs <b>${on}</b>.` +
          rosterHint,
        )) {
          sent.add(key);
        }
      }
    }
  }

  // ── Guerra / round in corso ──────────────────────────────────────────────
  if (state === 'inWar') {
    const justStarted = prevMem.state === 'preparation' && prevMem.endTime === war.endTime;
    if (noisy && justStarted) {
      const key = `start:${war.endTime}`;
      if (!sent.has(key)) {
        sent.add(key);
        const flagStart = isCwl ? notif.cwl_round_start : notif.war_start_alert;
        if (masterOn && flagStart === true) {
          const lbl = isCwl ? `🏆 CWL – Round iniziato!${turn}` : '⚔️ Guerra iniziata!';
          const cn = fmt.escapeHtml(war?.clan?.name || '');
          const on = fmt.escapeHtml(war?.opponent?.name || '');
          const atkHint = isCwl ? '\n1 attacco a persona.' : '';
          await send(`${lbl}\n${cn} vs ${on}\nAvete <b>${msLabel(leftMs)}</b> per attaccare!${atkHint}`);
        }
      }
    }

    if (endDate && leftMs > 0) {
      const mins = Math.floor(leftMs / 60000);
      const miss = missingAttacks(war);

      if (mins <= 240 && mins > 60) {
        const key = `4h:${war.endTime}`;
        if (
          !sent.has(key) &&
          masterOn &&
          (isCwl ? notif.cwl_missing_4h : notif.war_missing_4h) === true
        ) {
          if (await send(buildWarAlertMsg(war, miss, isCwl, '⏰ 4 ore rimanenti'))) {
            sent.add(key);
          }
        }
      }
      if (mins <= 60 && mins > 15) {
        const key = `1h:${war.endTime}`;
        if (
          !sent.has(key) &&
          masterOn &&
          (isCwl ? notif.cwl_missing_1h : notif.war_missing_1h) === true
        ) {
          if (await send(buildWarAlertMsg(war, miss, isCwl, '⏰ 1 ora rimanente'))) {
            sent.add(key);
          }
        }
      }
      if (mins <= 15) {
        const key = `15m:${war.endTime}`;
        if (
          !sent.has(key) &&
          masterOn &&
          (isCwl ? notif.cwl_missing_15m : notif.war_missing_15m) === true
        ) {
          if (await send(buildWarAlertMsg(war, miss, isCwl, '⏰ 15 minuti rimanenti'))) {
            sent.add(key);
          }
        }
      }

      const cfg = customCfg;
      if (cfg.enabled && !cfg.paused && Number.isFinite(cfg.lead) && cfg.lead > 0 && leftMs > 0) {
        const warKey = String(war.endTime || warId);
        const pendKey = `${chatId}:${isCwl ? 'cwl' : 'war'}:end:${warKey}`;
        const sentKey = `custom_end:${warKey}`;
        if (!sent.has(sentKey) && endDate) {
          pendingCustomAlerts.set(pendKey, {
            chatId,
            clanTag,
            warKey,
            mode: 'end',
            isCwl,
            leadMin: cfg.lead,
            targetMs: endDate.getTime() - leadMs(cfg.lead),
            deadlineMs: endDate.getTime(),
            sentKey,
            memKey,
            text: buildWarAlertMsg(
              war,
              miss,
              isCwl,
              `⏰ Mancano ${leadLabel(cfg.lead)} alla fine del ${isCwl ? 'round' : 'guerra'}`,
            ),
          });
        }
        if (withinCustomLead(leftMs, cfg.lead) && !sent.has(sentKey)) {
          const lbl = `⏰ Mancano ${leadLabel(cfg.lead)} alla fine del ${isCwl ? 'round' : 'guerra'}`;
          if (await send(buildWarAlertMsg(war, miss, isCwl, lbl))) {
            sent.add(sentKey);
            pendingCustomAlerts.delete(pendKey);
          }
        }
      }

      const perfectEnabled = masterOn && (isCwl ? notif.cwl_3star === true : notif.war_3star === true);
      if (perfectEnabled) {
        const ts = war.teamSize || 0;
        if (ts > 0 && (war?.clan?.stars || 0) >= ts * 3) {
          const key = `3star:${war.endTime}`;
          if (!sent.has(key)) {
            sent.add(key);
            const cn = fmt.escapeHtml(war?.clan?.name || 'Il nostro clan');
            if (isCwl) {
              await send(
                `⭐⭐⭐ <b>Round CWL Perfetto!${turn}</b>\n` +
                `${cn} ha 3 stelle su tutti i villaggi del round! 🎉`,
              );
            } else {
              await send(`⭐⭐⭐ <b>Guerra Perfetta!</b>\n${cn} ha 3 stelle su tutti i villaggi! 🎉`);
            }
          }
        }
      }
    }
  }

  // ── Recap + classifica ───────────────────────────────────────────────────
  const ended = state === 'warEnded' || state === 'ended' || (endDate && endDate.getTime() <= now && state !== 'preparation');
  if (ended && state !== 'preparation') {
    const key = `final:${war.endTime}`;
    if (!sent.has(key)) {
      sent.add(key);
      if (masterOn && (isCwl ? notif.cwl_round_end : notif.war_result) === true) {
        let streakInfo = null;
        const won = warOutcome(war).includes('Vittoria');
        if (!isCwl && won && notif.clan_activity_enabled === true && notif.clan_war_streak === true) {
          try {
            const info = await api.clanInfo(clanTag);
            const streak = Number(info?.warWinStreak);
            if (Number.isFinite(streak) && streak > 0) {
              streakInfo = { won: true, streak };
              const snap = clanStateMem.get(clanTag) || {};
              clanStateMem.set(clanTag, { ...snap, warWinStreak: streak, streakAnnouncedAt: streak });
            }
          } catch (_) {}
        }
        await send(buildWarFinalMsg(war, isCwl, streakInfo));
      }
      if (isCwl && masterOn && notif.cwl_standings === true) {
        const sk = `standings:${war.endTime}`;
        if (!sent.has(sk)) {
          sent.add(sk);
          // Ricarica fresco: la cache del ciclo potrebbe avere standings a zero o pre-fine round
          cwlStatsCache.delete(String(clanTag || ''));
          const stats = await getCachedCwlStats(clanTag).catch(() => cwl);
          await send(buildCwlStandingsMsg(stats, war));
        }
      }
      if (!isCwl) {
        api.saveWar(clanTag).catch((e) => console.warn('[notif-war] auto-save', clanTag, e.message));
      }
    }
  }
}

async function _warAlertsForChat(telegram, chatId, clanTag, sb) {
  const notif = await sb.getChatNotificationSettings(chatId).catch(() => ({}));
  const custom = await sb.getChatCustomAlertSettings(chatId).catch(() => ({}));

  const wantCwl =
    notif?.cwl_alerts_enabled === true || custom?.cwl_enabled === true;
  const wantWar =
    notif?.war_alerts_enabled === true || custom?.war_enabled === true;

  let cwl = null;
  let wars = [];
  if (wantCwl) {
    try {
      cwl = await getCachedCwlStats(clanTag);
      wars = api.listCwlWarsFromStats(cwl);
      if (notif?.cwl_alerts_enabled === true) {
        await _cwlSeasonAlerts(telegram, chatId, clanTag, sb, notif, cwl);
      }
    } catch (e) {
      console.warn('[notif-war] cwl-stats', clanTag, e.message);
    }
  }

  const war = await api.currentWar(clanTag).catch((e) => {
    console.warn('[notif-war] currentWar', clanTag, e.message);
    return null;
  });
  const warType = String(war?.warType || '').toLowerCase();
  const isCwlCurrent = warType === 'cwl';
  const warState = String(war?.state || '');

  // Guerra classica (non CWL)
  if (
    wantWar &&
    war &&
    warState &&
    warState !== 'notInWar' &&
    !isCwlCurrent
  ) {
    await _processSingleWarAlerts({
      telegram, chatId, clanTag, sb, notif, custom, war, isCwl: false, overlapPrep: false, cwl: null,
    });
  }

  // CWL: tutte le guerre attive/terminate + fallback su currentWar
  if (wantCwl) {
    let inWarRounds = wars.filter((w) => w.state === 'inWar');
    let prepRounds = wars.filter((w) => w.state === 'preparation');
    let endedRounds = wars.filter((w) => w.state === 'warEnded' || w.state === 'ended');

    // Fallback critico: cwl-stats vuoto/fallito ma currentWar ha prep/inWar (o mapped CWL)
    if (!prepRounds.length && !inWarRounds.length && war && warState && warState !== 'notInWar') {
      const fallback = isCwlCurrent || warType === 'cwl'
        ? war
        : { ...war, warType: 'cwl' };
      if (fallback.state === 'preparation') prepRounds = [fallback];
      else if (fallback.state === 'inWar') inWarRounds = [fallback];
      else if (fallback.state === 'warEnded' || fallback.state === 'ended') {
        endedRounds = [...endedRounds, fallback];
      }
      console.warn('[notif-war] CWL fallback currentWar', clanTag, fallback.state);
    }

    if (!prepRounds.length && !inWarRounds.length) {
      console.warn(
        '[notif-war] no active CWL rounds',
        clanTag,
        'cwlState=',
        cwl?.state || null,
        'rounds=',
        wars.length,
        'current=',
        warState,
        warType || '-',
      );
    }

    for (const w of prepRounds) {
      await _processSingleWarAlerts({
        telegram, chatId, clanTag, sb, notif, custom, war: w, isCwl: true,
        overlapPrep: inWarRounds.length > 0, cwl,
      });
    }
    for (const w of inWarRounds) {
      await _processSingleWarAlerts({
        telegram, chatId, clanTag, sb, notif, custom, war: w, isCwl: true,
        overlapPrep: false, cwl,
      });
    }
    // Solo round ended “recenti” o già in memoria (evita N recap su stagione intera)
    for (const w of endedRounds) {
      const wid = w.endTime || `r${w.roundNumber || 0}`;
      const memKey = `${chatId}:${clanTag}:${wid}`;
      const prev = warStateMem.get(memKey);
      const endDate = parseCocTime(w.endTime);
      const recentlyEnded = endDate && (Date.now() - endDate.getTime()) < 6 * 3600 * 1000;
      if (prev || recentlyEnded) {
        await _processSingleWarAlerts({
          telegram, chatId, clanTag, sb, notif, custom, war: w, isCwl: true,
          overlapPrep: false, cwl,
        });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Raid Capitale
// ─────────────────────────────────────────────────────────────────────────────

async function runExtendedRaidAlerts(bot, sb) {
  let links = [];
  try {
    links = await sb.listEnabledTelegramChatLinks();
  } catch (e) {
    console.warn('[notif-raid] list links:', e.message);
    return;
  }
  for (const link of links) {
    const chatId  = Number(link.telegram_chat_id);
    const clanTag = link.clan_tag;
    if (!Number.isFinite(chatId) || !clanTag) continue;
    try {
      await _raidAlertsForChat(bot.telegram, chatId, clanTag, sb);
    } catch (e) {
      const s = String(e.message || '');
      if (s.includes('chat not found') || s.includes('bot was kicked') ||
          s.includes('Forbidden') || s.includes('deactivated')) {
        await sb.deleteTelegramChatLink(chatId).catch(() => {});
      } else {
        console.warn('[notif-raid] chat', chatId, e.message);
      }
    }
  }
  if (raidStateMem.size > 500) {
    const k = raidStateMem.keys().next();
    if (!k.done) raidStateMem.delete(k.value);
  }
}

async function _raidAlertsForChat(telegram, chatId, clanTag, sb) {
  const notif = await sb.getChatNotificationSettings(chatId).catch(() => ({}));
  if (notif?.capital_raids_enabled !== true) return;

  const raidData = await api.capitalRaids(clanTag);
  const current  = (raidData?.items || [])[0];

  const memKey  = `${chatId}:${clanTag}`;
  const prevMem = raidStateMem.get(memKey) || {
    state: 'unknown', startTime: null,
    destroyed: new Set(), clearedEnemies: new Set(), sent: new Set(),
  };
  const { destroyed, clearedEnemies, sent } = prevMem;
  const send = (text) => sendToChat(telegram, chatId, text, () => sb.deleteTelegramChatLink(chatId));

  // Nessun raid attivo o raid terminato
  if (!current || current.state !== 'ongoing') {
    // Avviso fine raid
    if (current?.state === 'ended' && prevMem.state === 'ongoing') {
      const key = `end:${current.startTime}`;
      if (!sent.has(key) && notif.raid_end === true) {
        sent.add(key);
        let membersPayload = null;
        try {
          membersPayload = await api.clanMembers(clanTag);
        } catch (_) {}
        await send(raidCap.formatRaidEndMessage(current, membersPayload));
      }
    }
    raidStateMem.set(memKey, { ...prevMem, state: current?.state || 'unknown', sent });
    return;
  }

  // Raid ongoing
  const startTime = current.startTime;

  // Nuovo weekend (startTime diverso) oppure primo rilevamento
  if (!prevMem.startTime || prevMem.startTime !== startTime) {
    const initDestroyed = new Set();
    const initCleared = new Set();
    const initSent = new Set(sent);
    for (const entry of (current.attackLog || [])) {
      const et = entry.defender?.tag || 'unknown';
      let allDone = (entry.districts || []).length > 0;
      for (const d of (entry.districts || [])) {
        if ((d.destructionPercent || 0) >= 100) {
          initDestroyed.add(`${et}:${d.id}`);
        } else {
          allDone = false;
        }
      }
      if (allDone) initCleared.add(et);
    }

    // Seed milestone/loot/capitale già raggiunti (no spam post-restart mid-raid)
    const totalLootInit = (current.attackLog || []).reduce(
      (acc, e) => acc + Number(e.capitalTotalLoot || 0),
      0,
    );
    const step = 50_000;
    const reachedInit = Math.floor(totalLootInit / step);
    for (let i = 1; i <= reachedInit; i++) {
      initSent.add(`loot:${startTime}:${i * step}`);
    }
    for (const defEntry of (current.defenseLog || [])) {
      const districts = defEntry.districts || [];
      if (!districts.length) continue;
      if (districts.every((d) => Number(d.destructionPercent || 0) >= 100)) {
        initSent.add(`capital_fallen:${startTime}:${defEntry.attacker?.tag || 'unknown'}`);
      }
    }

    // Seed countdown già scaduti (no spam post-restart mid-raid)
    const endInit = raidCap.parseCocTime(current.endTime);
    if (endInit) {
      const leftInit = endInit.getTime() - Date.now();
      for (const lead of [1440, 720, 180]) {
        if (leftInit <= lead * 60 * 1000) {
          initSent.add(`missing:${startTime}:${lead}`);
        }
      }
    }

    const isColdStart = !prevMem.startTime;
    const isNewWeekend = Boolean(prevMem.startTime && prevMem.startTime !== startTime);

    if (isColdStart) {
      // Redeploy / primo ciclo: non notificare inizio già in corso
      initSent.add(`start:${startTime}`);
    } else if (isNewWeekend && notif.raid_start === true && !initSent.has(`start:${startTime}`)) {
      initSent.add(`start:${startTime}`);
      await send(
        `🏛 <b>Raid Capitale – Iniziato!</b>\n` +
        `Il weekend di raid è cominciato.\n` +
        `Ricorda di completare i tuoi attacchi entro domenica! ⚔️`,
      );
    }

    raidStateMem.set(memKey, {
      state: 'ongoing',
      startTime,
      destroyed: initDestroyed,
      clearedEnemies: initCleared,
      sent: initSent,
    });
    return;
  }

  // Transizione ended/unknown → ongoing con stesso startTime (glitch API / gap poll)
  if (prevMem.state !== 'ongoing') {
    const key = `start:${startTime}`;
    if (!sent.has(key) && notif.raid_start === true) {
      sent.add(key);
      await send(
        `🏛 <b>Raid Capitale – Iniziato!</b>\n` +
        `Il weekend di raid è cominciato.\n` +
        `Ricorda di completare i tuoi attacchi entro domenica! ⚔️`,
      );
    }
  }

  // Scansiona attackLog: nuovi distretti distrutti e clan eliminati
  for (const entry of (current.attackLog || [])) {
    const et   = entry.defender?.tag || 'unknown';
    const en   = fmt.escapeHtml(entry.defender?.name || 'Clan sconosciuto');
    let allDone = (entry.districts || []).length > 0;

    for (const d of (entry.districts || [])) {
      if ((d.destructionPercent || 0) < 100) {
        allDone = false;
        continue;
      }
      const dk = `${et}:${d.id}`;
      if (!destroyed.has(dk)) {
        destroyed.add(dk);
        const distKey = `district:${dk}`;
        if (!sent.has(distKey) && notif.raid_district_destroyed === true) {
          sent.add(distKey);
          await send(
            `🏰 <b>Raid Capitale</b>\n` +
            `⚔️ Distretto <b>${fmt.escapeHtml(d.name || 'Sconosciuto')}</b> ` +
            `di <i>${en}</i> completamente distrutto! ` +
            `(+${(d.totalLooted || 0).toLocaleString('it-IT')} oro)`,
          );
        }
      }
    }

    if (allDone && !clearedEnemies.has(et)) {
      clearedEnemies.add(et);
      const ck = `cleared:${et}`;
      if (!sent.has(ck) && notif.raid_clan_cleared === true) {
        sent.add(ck);
        const n = (entry.districts || []).length;
        await send(
          `🏛 <b>Raid Capitale – Clan eliminato!</b>\n` +
          `Tutti i ${n} distretti di <b>${en}</b> sono stati distrutti! 🎉`,
        );
      }
    }
  }

  // Loot milestone cumulativo weekend (50k, 100k, 150k, ...)
  const totalLoot = (current.attackLog || []).reduce((acc, e) => acc + Number(e.capitalTotalLoot || 0), 0);
  if (notif.raid_loot_milestone === true && totalLoot > 0) {
    const step = 50_000;
    const reached = Math.floor(totalLoot / step);
    for (let i = 1; i <= reached; i++) {
      const target = i * step;
      const mk = `loot:${startTime}:${target}`;
      if (!sent.has(mk)) {
        sent.add(mk);
        await send(`💰 <b>Raid Capitale</b>\nMilestone raggiunta: <b>${target.toLocaleString('it-IT')}</b> oro!`);
      }
    }
  }

  // Nostra capitale caduta (best effort): se un attacker nella defenseLog chiude tutti i distretti
  if (notif.raid_capital_fallen === true) {
    for (const defEntry of (current.defenseLog || [])) {
      const et = defEntry.attacker?.tag || 'unknown';
      const dKey = `capital_fallen:${startTime}:${et}`;
      if (sent.has(dKey)) continue;
      const districts = defEntry.districts || [];
      if (!districts.length) continue;
      const allDestroyed = districts.every((d) => Number(d.destructionPercent || 0) >= 100);
      if (allDestroyed) {
        sent.add(dKey);
        await send(
          `💥 <b>Raid Capitale</b>\nLa nostra capitale è stata completata al 100% da <b>${fmt.escapeHtml(defEntry.attacker?.name || 'Clan avversario')}</b>.`
        );
      }
    }
  }

  // Countdown fine raid: 1g / 12h / 3h + custom
  const endDate = raidCap.parseCocTime(current.endTime);
  if (endDate) {
    const leftMs = endDate.getTime() - Date.now();
    const includeList = notif.raid_missing_include_list === true;
    let membersPayload = null;
    const needList = includeList;
    const fixedLeads = [
      { mins: 1440, flag: 'raid_missing_1d' },
      { mins: 720, flag: 'raid_missing_12h' },
      { mins: 180, flag: 'raid_missing_3h' },
    ];
    const custom = await sb.getChatCustomAlertSettings(chatId).catch(() => ({}));
    const customLead = Number(custom?.raid_lead_minutes || 0);
    const customOn =
      custom?.raid_enabled === true &&
      custom?.raid_paused !== true &&
      Number.isFinite(customLead) &&
      customLead > 0;

    const dueLeads = [];
    for (const L of fixedLeads) {
      if (notif[L.flag] !== true) continue;
      if (!raidCap.leadReached(leftMs, L.mins)) continue;
      const key = `missing:${startTime}:${L.mins}`;
      if (sent.has(key)) continue;
      dueLeads.push({ mins: L.mins, key });
    }
    if (customOn && raidCap.leadReached(leftMs, customLead)) {
      const key = `missing:${startTime}:custom:${customLead}`;
      if (!sent.has(key)) dueLeads.push({ mins: customLead, key });
    }

    if (dueLeads.length) {
      if (needList) {
        try {
          membersPayload = await api.clanMembers(clanTag);
        } catch (_) {}
      }
      for (const L of dueLeads) {
        const text = raidCap.formatRaidCountdownMessage(
          current,
          membersPayload,
          L.mins,
          includeList,
        );
        if (await send(text)) sent.add(L.key);
      }
    }
  }

  raidStateMem.set(memKey, { state: 'ongoing', startTime, destroyed, clearedEnemies, sent });
}

// ─────────────────────────────────────────────────────────────────────────────
// Attività Clan (ogni 5 minuti)
// ─────────────────────────────────────────────────────────────────────────────

async function runClanActivityAlerts(bot, sb) {
  const now = Date.now();
  if (now - lastClanActivityRun < 5 * 60 * 1000) return;
  lastClanActivityRun = now;

  let links = [];
  try {
    links = await sb.listEnabledTelegramChatLinks();
  } catch (e) {
    console.warn('[notif-activity] list links:', e.message);
    return;
  }

  // Dedup API: recupera dati clan una sola volta per clanTag
  const clanCache = new Map(); // clanTag → { info, members } | null
  for (const link of links) {
    const ct = link.clan_tag;
    if (!ct || clanCache.has(ct)) continue;
    try {
      const [info, mdata] = await Promise.all([
        api.clanInfo(ct),
        api.clanMembers(ct),
      ]);
      clanCache.set(ct, { info, members: mdata?.items || [] });
    } catch (_) {
      clanCache.set(ct, null);
    }
  }

  for (const link of links) {
    const chatId  = Number(link.telegram_chat_id);
    const clanTag = link.clan_tag;
    if (!Number.isFinite(chatId) || !clanTag) continue;

    const notif = await sb.getChatNotificationSettings(chatId).catch(() => ({}));
    if (notif?.clan_activity_enabled !== true) continue;

    const clanData = clanCache.get(clanTag);
    if (!clanData) continue;

    const { info, members } = clanData;
    const prev = clanStateMem.get(clanTag);

    // Primo rilevamento: inizializza senza notificare
    if (!prev) {
      clanStateMem.set(clanTag, {
        members: new Map(members.map((m) => [m.tag, { name: m.name, role: m.role }])),
        level: info?.clanLevel ?? null,
        name:  info?.name     ?? null,
        warWinStreak: info?.warWinStreak ?? null,
      });
      continue;
    }

    const send = (text) =>
      sendToChat(bot.telegram, chatId, text, () => sb.deleteTelegramChatLink(chatId));

    const curMembers = new Map(members.map((m) => [m.tag, { name: m.name, role: m.role }]));

    // Nuovi membri
    for (const [tag, cur] of curMembers) {
      if (!prev.members.has(tag)) {
        if (notif.clan_member_join === true) {
          await send(`👋 <b>Nuovo membro!</b>\n<b>${fmt.escapeHtml(cur.name)}</b> si è unito al clan.`);
        }
      } else {
        const old = prev.members.get(tag);
        if (old.role !== cur.role) {
          const oldRank = roleRank(old.role);
          const newRank = roleRank(cur.role);
          const n = fmt.escapeHtml(cur.name);
          if (newRank > oldRank && notif.clan_role_promoted === true) {
            await send(`⬆️ <b>Promozione</b>\n<b>${n}</b>: ${roleLabel(old.role)} → <b>${roleLabel(cur.role)}</b>`);
          } else if (newRank < oldRank && notif.clan_role_demoted === true) {
            await send(`⬇️ <b>Retrocessione</b>\n<b>${n}</b>: ${roleLabel(old.role)} → ${roleLabel(cur.role)}`);
          }
        }
      }
    }

    // Membri usciti
    for (const [tag, old] of prev.members) {
      if (!curMembers.has(tag)) {
        if (notif.clan_member_leave === true) {
          await send(`👋 <b>Membro uscito</b>\n<b>${fmt.escapeHtml(old.name)}</b> ha lasciato il clan.`);
        }
      }
    }

    // Livello clan
    const curLevel = info?.clanLevel ?? null;
    if (curLevel !== null && prev.level !== null && curLevel > prev.level && notif.clan_level_up === true) {
      await send(`🎉 <b>Livello clan!</b>\nIl clan è salito al livello <b>${curLevel}</b>! 🏅`);
    }

    // Cambio nome
    const curName = info?.name ?? null;
    if (curName && prev.name && prev.name !== curName && notif.clan_name_change === true) {
      await send(`✏️ <b>Nome clan cambiato</b>\n${fmt.escapeHtml(prev.name)} → <b>${fmt.escapeHtml(curName)}</b>`);
    }

    // Streak vittorie guerra in aumento
    const curStreak = info?.warWinStreak ?? null;
    let streakAnnouncedAt = prev.streakAnnouncedAt ?? null;
    if (
      curStreak !== null &&
      prev.warWinStreak !== null &&
      Number(curStreak) > Number(prev.warWinStreak) &&
      notif.clan_war_streak === true
    ) {
      // Se già annunciata nel recap finale guerra, non ripetere
      if (Number(streakAnnouncedAt) !== Number(curStreak)) {
        await send(`🔥 <b>Serie vittorie!</b>\nIl clan è ora a <b>${Number(curStreak)}</b> vittorie consecutive.`);
        streakAnnouncedAt = curStreak;
      }
    }

    // Aggiorna snapshot (condiviso: sovrascrivi con dati più recenti)
    clanStateMem.set(clanTag, {
      members: curMembers,
      level: curLevel,
      name:  curName,
      warWinStreak: curStreak,
      streakAnnouncedAt,
    });
  }

  if (clanStateMem.size > 200) {
    const k = clanStateMem.keys().next();
    if (!k.done) clanStateMem.delete(k.value);
  }
}

/**
 * Tick veloce: invia alert personalizzati alla soglia esatta (solo orologio, no CoC API).
 */
async function runPendingCustomAlerts(bot, sb) {
  if (!pendingCustomAlerts.size) return;
  const now = Date.now();
  const telegram = bot.telegram;
  for (const [pendKey, p] of [...pendingCustomAlerts.entries()]) {
    try {
      if (!p || p.targetMs == null) {
        pendingCustomAlerts.delete(pendKey);
        continue;
      }
      if (now < p.targetMs) continue;
      if (now >= p.deadlineMs) {
        pendingCustomAlerts.delete(pendKey);
        continue;
      }
      const mem = warStateMem.get(p.memKey) || getOrCreateWarMem(p.chatId, p.clanTag, { endTime: p.warKey });
      if (mem.sent && mem.sent.has(p.sentKey)) {
        pendingCustomAlerts.delete(pendKey);
        continue;
      }
      const ok = await sendToChat(telegram, p.chatId, p.text, () => sb.deleteTelegramChatLink(p.chatId));
      if (ok) {
        if (!mem.sent) mem.sent = new Set();
        mem.sent.add(p.sentKey);
        warStateMem.set(p.memKey, mem);
        pendingCustomAlerts.delete(pendKey);
        console.log('[notif-war] custom pending fired', pendKey, 'lead=', p.leadMin);
      }
    } catch (e) {
      console.warn('[notif-war] pending custom', pendKey, e.message);
    }
  }
}

/**
 * Stato alert personalizzato. Non anticipa: sopra soglia → waiting + schedula automatico.
 * L'invio immediato avviene solo se remainingMs <= lead (soglia già raggiunta).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force] - reinoltra anche se già inviato (solo se già in soglia)
 * @returns {Promise<{ status: string, detail: string }>}
 */
async function probeAndSendRaidCustomAlert(telegram, chatId, clanTag, sb, opts = {}) {
  const force = opts.force === true;
  const custom = await sb.getChatCustomAlertSettings(chatId).catch(() => ({}));
  const notif = await sb.getChatNotificationSettings(chatId).catch(() => ({}));
  const enabled = custom.raid_enabled === true;
  const paused = custom.raid_paused === true;
  const lead = Number(custom.raid_lead_minutes || 0);

  if (!enabled) return { status: 'disabled', detail: 'Alert raid disattivato.' };
  if (paused) return { status: 'paused', detail: 'Alert raid in pausa.' };
  if (!(lead > 0)) return { status: 'no_lead', detail: 'Preavviso raid non impostato.' };
  if (notif?.capital_raids_enabled !== true) {
    return {
      status: 'master_off',
      detail: 'Attiva prima la categoria «Raid Capitale» in Gestione avvisi.',
    };
  }

  let current = null;
  try {
    const raidData = await api.capitalRaids(clanTag);
    current = (raidData?.items || []).find((it) => it.state === 'ongoing') || null;
  } catch (e) {
    return { status: 'fetch_error', detail: `Errore lettura CoC: ${e.message || 'sconosciuto'}` };
  }
  if (!current) {
    return {
      status: 'no_raid',
      detail: 'Nessun raid capitale in corso. L’alert partirà automaticamente durante il weekend.',
    };
  }

  const endDate = raidCap.parseCocTime(current.endTime);
  if (!endDate) return { status: 'no_end', detail: 'endTime raid non disponibile dall’API.' };
  const leftMs = endDate.getTime() - Date.now();
  if (leftMs <= 0) {
    return { status: 'ended', detail: 'Il raid è già concluso (o in chiusura).' };
  }

  const memKey = `${chatId}:${clanTag}`;
  const mem = raidStateMem.get(memKey) || {
    state: 'ongoing',
    startTime: current.startTime,
    destroyed: new Set(),
    clearedEnemies: new Set(),
    sent: new Set(),
  };
  if (!mem.sent) mem.sent = new Set();
  const sentKey = `missing:${current.startTime}:custom:${lead}`;

  if (!raidCap.leadReached(leftMs, lead) && !force) {
    return {
      status: 'waiting',
      detail:
        `⏱ Soglia non ancora raggiunta. Mancano <b>${raidCap.msLabel(leftMs)}</b> ` +
        `(alert a <b>${raidCap.msLabel(lead * 60000)}</b> dalla fine).`,
    };
  }

  // force sotto soglia: reinoltra; force sopra soglia: invia comunque per prova
  if (!force && mem.sent.has(sentKey)) {
    return { status: 'already', detail: 'Avviso custom raid già inviato per questo weekend.' };
  }
  if (force && !raidCap.leadReached(leftMs, lead)) {
    return {
      status: 'waiting',
      detail:
        `⏱ Ancora fuori soglia (restano <b>${raidCap.msLabel(leftMs)}</b>). ` +
        `L’invio automatico avverrà a <b>${raidCap.msLabel(lead * 60000)}</b> dalla fine.`,
    };
  }

  let membersPayload = null;
  if (notif.raid_missing_include_list === true) {
    try {
      membersPayload = await api.clanMembers(clanTag);
    } catch (_) {}
  }
  const text = raidCap.formatRaidCountdownMessage(
    current,
    membersPayload,
    lead,
    notif.raid_missing_include_list === true,
  );
  const ok = await sendToChat(telegram, chatId, text, () => sb.deleteTelegramChatLink(chatId));
  if (ok) {
    mem.sent.add(sentKey);
    mem.state = 'ongoing';
    mem.startTime = current.startTime;
    raidStateMem.set(memKey, mem);
    return { status: 'sent', detail: `📣 Avviso raid inviato (soglia <b>${raidCap.msLabel(lead * 60000)}</b>).` };
  }
  return { status: 'send_failed', detail: 'Invio Telegram fallito (permessi chat?).' };
}

async function probeAndSendCustomAlert(telegram, chatId, clanTag, kind, sb, opts = {}) {
  const force = opts.force === true;
  if (kind === 'raid') {
    return probeAndSendRaidCustomAlert(telegram, chatId, clanTag, sb, { force });
  }
  const isCwl = kind === 'cwl';
  const custom = await sb.getChatCustomAlertSettings(chatId).catch(() => ({}));
  const enabled = isCwl ? custom.cwl_enabled === true : custom.war_enabled === true;
  const paused = isCwl ? custom.cwl_paused === true : custom.war_paused === true;
  const lead = isCwl ? Number(custom.cwl_lead_minutes || 0) : Number(custom.war_lead_minutes || 0);

  if (!enabled) return { status: 'disabled', detail: 'Alert disattivato.' };
  if (paused) return { status: 'paused', detail: 'Alert in pausa.' };
  if (!(lead > 0)) return { status: 'no_lead', detail: 'Preavviso non impostato.' };

  clearCustomSentForChat(chatId, clanTag);

  let wars = [];
  try {
    if (isCwl) {
      cwlStatsCache.delete(String(clanTag || ''));
      const cwl = await api.cwlStats(clanTag);
      wars = api.listCwlWarsFromStats(cwl).filter(
        (w) => w.state === 'preparation' || w.state === 'inWar',
      );
    } else {
      const war = await api.currentWar(clanTag);
      const wt = String(war?.warType || '').toLowerCase();
      if (war && war.state && war.state !== 'notInWar' && wt !== 'cwl') {
        wars = [war];
      }
    }
  } catch (e) {
    console.warn('[notif-war] probe fetch', clanTag, e.message);
    return {
      status: 'fetch_error',
      detail: `Errore lettura CoC: ${e.message || 'sconosciuto'}`,
    };
  }

  if (!wars.length) {
    return {
      status: 'no_war',
      detail: isCwl
        ? 'Nessun turno CWL in preparazione o in battle in questo momento. L’alert partirà automaticamente quando ci sarà un round attivo.'
        : 'Nessuna guerra classica attiva. L’alert partirà quando inizierà una guerra.',
    };
  }

  const now = Date.now();
  const send = (text) => sendToChat(telegram, chatId, text, () => sb.deleteTelegramChatLink(chatId));
  const ordered = [
    ...wars.filter((w) => w.state === 'preparation'),
    ...wars.filter((w) => w.state === 'inWar'),
  ];

  for (const war of ordered) {
    const turn = isCwl ? cwlTurnLabel(war) : '';
    const mem = getOrCreateWarMem(chatId, clanTag, war);
    mem.state = war.state;
    mem.endTime = war.endTime ?? null;
    const warKey = String(war.endTime || `r${war.roundNumber || 0}`);
    const memKey = warMemKey(chatId, clanTag, war);

    if (war.state === 'preparation') {
      const startDate = resolveBattleStart(war);
      if (!startDate) {
        return {
          status: 'no_start',
          detail: 'Turno in prep trovato ma senza orario di inizio battle (API). Riprova tra poco.',
        };
      }
      const untilStart = startDate.getTime() - now;
      if (untilStart <= 0) {
        return {
          status: 'starting',
          detail: 'La battle sta per iniziare (o è appena iniziata).',
        };
      }

      const pendKey = `${chatId}:${isCwl ? 'cwl' : 'war'}:start:${warKey}`;
      const sentKey = `custom_start:${warKey}`;
      const cn = fmt.escapeHtml(war?.clan?.name || '');
      const on = fmt.escapeHtml(war?.opponent?.name || '');
      const lbl = isCwl ? '🏆 CWL' : '⚔️ Guerra';
      const alertText =
        `🛡 <b>${lbl} – Preparazione${turn}</b>\n` +
        `<b>${cn}</b> vs <b>${on}</b>\n` +
        `<b>⏰ Mancano ${leadLabel(lead)} all'inizio della battle</b>`;

      pendingCustomAlerts.set(pendKey, {
        chatId,
        clanTag,
        warKey,
        mode: 'start',
        isCwl,
        leadMin: lead,
        targetMs: startDate.getTime() - leadMs(lead),
        deadlineMs: startDate.getTime(),
        sentKey,
        memKey,
        text: alertText,
      });

      // Sopra soglia: non anticipare — solo conferma e schedula
      if (!withinCustomLead(untilStart, lead)) {
        const fireAt = new Date(startDate.getTime() - leadMs(lead));
        return {
          status: 'waiting',
          detail:
            `⏱ Ora mancano <b>${msLabel(untilStart)}</b> all’inizio${turn}.\n` +
            `Soglia impostata: <b>${leadLabel(lead)}</b>.\n` +
            `L’alert automatico partirà quando il timer arriverà a <b>${leadLabel(lead)}</b>` +
            ` (≈ ${fireAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}).\n` +
            `<i>Prova non anticipa l’invio: verifica solo che tutto sia configurato.</i>`,
        };
      }

      if (!force && mem.sent.has(sentKey)) {
        return {
          status: 'already_sent',
          detail:
            `Alert già inviato per la soglia <b>${leadLabel(lead)}</b>.\n` +
            `Tocca di nuovo <b>📣 Prova / invia ora</b> per reinviarlo.`,
        };
      }
      mem.sent.delete(sentKey);
      const ok = await send(alertText);
      if (ok) {
        mem.sent.add(sentKey);
        pendingCustomAlerts.delete(pendKey);
        return {
          status: 'sent',
          detail: `📣 Avviso inviato: soglia <b>${leadLabel(lead)}</b> già raggiunta.`,
        };
      }
      return { status: 'send_failed', detail: 'Invio Telegram fallito (permessi chat?).' };
    }

    if (war.state === 'inWar') {
      const endDate = parseCocTime(war.endTime);
      if (!endDate) {
        return { status: 'no_end', detail: 'Battle attiva ma senza orario di fine.' };
      }
      const leftMs = endDate.getTime() - now;
      if (leftMs <= 0) {
        return { status: 'ending', detail: 'Il round sta finendo.' };
      }

      const pendKey = `${chatId}:${isCwl ? 'cwl' : 'war'}:end:${warKey}`;
      const sentKey = `custom_end:${warKey}`;
      const miss = missingAttacks(war);
      const lbl = isCwl
        ? `⏰ Mancano ${leadLabel(lead)} alla fine del round`
        : `⏰ Mancano ${leadLabel(lead)} alla fine della guerra`;
      const alertText = buildWarAlertMsg(war, miss, isCwl, lbl);

      pendingCustomAlerts.set(pendKey, {
        chatId,
        clanTag,
        warKey,
        mode: 'end',
        isCwl,
        leadMin: lead,
        targetMs: endDate.getTime() - leadMs(lead),
        deadlineMs: endDate.getTime(),
        sentKey,
        memKey,
        text: alertText,
      });

      if (!withinCustomLead(leftMs, lead)) {
        const fireAt = new Date(endDate.getTime() - leadMs(lead));
        return {
          status: 'waiting',
          detail:
            `⏱ Ora mancano <b>${msLabel(leftMs)}</b> alla fine${turn}.\n` +
            `Soglia: <b>${leadLabel(lead)}</b> — l’alert partirà automaticamente` +
            ` (≈ ${fireAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}).`,
        };
      }

      if (!force && mem.sent.has(sentKey)) {
        return {
          status: 'already_sent',
          detail:
            `Alert già inviato per la soglia <b>${leadLabel(lead)}</b>.\n` +
            `Tocca di nuovo <b>📣 Prova / invia ora</b> per reinviarlo.`,
        };
      }
      mem.sent.delete(sentKey);
      const ok = await send(alertText);
      if (ok) {
        mem.sent.add(sentKey);
        pendingCustomAlerts.delete(pendKey);
        return {
          status: 'sent',
          detail: `📣 Avviso inviato (soglia <b>${leadLabel(lead)}</b>).`,
        };
      }
      return { status: 'send_failed', detail: 'Invio Telegram fallito (permessi chat?).' };
    }
  }

  return { status: 'no_war', detail: 'Nessun turno utilizzabile.' };
}

module.exports = {
  runExtendedWarAlerts,
  runExtendedRaidAlerts,
  runClanActivityAlerts,
  runPendingCustomAlerts,
  probeAndSendCustomAlert,
};
