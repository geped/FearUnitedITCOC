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

function msLabel(ms) {
  if (ms <= 0) return '0 min';
  const mins = Math.ceil(ms / 60000);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const r = mins % 60;
    return r > 0 ? `${h}h ${r} min` : `${h}h`;
  }
  return `${mins} min`;
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

/** Invia messaggio a chatId; cancella il link se la chat è stale/inaccessibile. */
async function sendToChat(telegram, chatId, text, onStale) {
  try {
    await telegram.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (e) {
    const s = String(e.message || '');
    if (s.includes('chat not found') || s.includes('bot was kicked') ||
        s.includes('bot is not a member') || s.includes('Forbidden') ||
        s.includes('deactivated')) {
      if (onStale) await onStale().catch(() => {});
    }
  }
}

function cwlTurnLabel(war) {
  const n = Number(war?.roundNumber);
  if (!Number.isFinite(n) || n <= 0) return '';
  const total = Number(war?.totalRounds) || 7;
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
  const rows = Array.isArray(cwl?.groupStandings) ? cwl.groupStandings : [];
  const turn = cwlTurnLabel(war);
  const lines = rows.slice(0, 8).map((c, i) => {
    const name = fmt.escapeHtml(c?.name || '—');
    const stars = Number(c?.stars || 0);
    const wars = Number(c?.warCount || 0);
    return `${i + 1}. <b>${name}</b> — ${stars}⭐ (${wars}W)`;
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

  const wasInactive =
    !prev.state ||
    prev.state === 'unknown' ||
    prev.state === 'notInWar' ||
    prev.state === 'ended';
  const isActive =
    curState &&
    curState !== 'notInWar' &&
    curState !== 'ended' &&
    curState !== 'unknown';
  const newSeason = curSeason && prev.season && prev.season !== curSeason;

  if (
    notif.cwl_season_start === true &&
    ((wasInactive && isActive) || newSeason) &&
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
    const endDate0 = parseCocTime(war.endTime);
    if (state === 'preparation') {
      sent.add('prep:' + war.endTime);
      sent.add('prep_next:' + war.endTime);
      const start0 = parseCocTime(war.startTime);
      if (start0) {
        const minsToStart = Math.ceil((start0.getTime() - Date.now()) / 60000);
        if (minsToStart <= 360) sent.add('roster:' + war.endTime);
      }
    }
    if (state === 'inWar') {
      sent.add('start:' + war.endTime);
      if (endDate0) {
        const mins0 = Math.ceil((endDate0.getTime() - Date.now()) / 60000);
        if (mins0 <= 240) sent.add('4h:' + war.endTime);
        if (mins0 <= 60) sent.add('1h:' + war.endTime);
        if (mins0 <= 15) sent.add('15m:' + war.endTime);
        if (custom) {
          const lead = isCwl
            ? Number(custom.cwl_lead_minutes || 0)
            : Number(custom.war_lead_minutes || 0);
          if (lead > 0 && mins0 <= lead) sent.add(`custom:${lead}:${war.endTime}`);
        }
      }
      const ts0 = war.teamSize || 0;
      if (ts0 > 0 && (war?.clan?.stars || 0) >= ts0 * 3) {
        sent.add('3star:' + war.endTime);
      }
    }
    if (state === 'warEnded' || state === 'ended') {
      sent.add('final:' + war.endTime);
      sent.add('standings:' + war.endTime);
    }
    return;
  }

  const send = (text) => sendToChat(telegram, chatId, text, () => sb.deleteTelegramChatLink(chatId));

  // ── Preparazione ─────────────────────────────────────────────────────────
  if (state === 'preparation') {
    const isNew = prevMem.state !== 'preparation' || prevMem.endTime !== war.endTime;
    if (noisy && isNew) {
      const cn = fmt.escapeHtml(war?.clan?.name || 'Il nostro clan');
      const on = fmt.escapeHtml(war?.opponent?.name || 'Avversario');
      if (overlapPrep && notif.cwl_prep_next === true) {
        const key = `prep_next:${war.endTime}`;
        if (!sent.has(key)) {
          sent.add(key);
          sent.add(`prep:${war.endTime}`); // evita doppio con prep_start
          await send(
            `🛡 <b>🏆 CWL – Prep turno successivo${turn}</b>\n` +
            `Avversario: <b>${on}</b>\n` +
            `La battle del turno precedente è ancora in corso.\n` +
            `Scegli il roster e riempi i CC per il prossimo round.`,
          );
        }
      } else if ((isCwl ? notif.cwl_prep_start === true : notif.war_prep_start === true)) {
        const key = `prep:${war.endTime}`;
        if (!sent.has(key)) {
          sent.add(key);
          const lbl = isCwl ? '🏆 CWL' : '⚔️ Guerra Classica';
          await send(
            `🛡 <b>${lbl} – Preparazione${turn}</b>\n` +
            `${cn} vs ${on}\n` +
            `Gli attacchi inizieranno presto.`,
          );
        }
      }
    }

    // Promemoria roster ~6h prima dell'inizio battle (solo CWL)
    if (isCwl && notif.cwl_roster_reminder === true) {
      const startDate = parseCocTime(war.startTime);
      if (startDate) {
        const untilStart = startDate.getTime() - now;
        const minsToStart = Math.ceil(untilStart / 60000);
        if (minsToStart <= 360 && minsToStart > 0) {
          const key = `roster:${war.endTime}`;
          if (!sent.has(key)) {
            sent.add(key);
            const on = fmt.escapeHtml(war?.opponent?.name || 'Avversario');
            const size = Number(war.teamSize || 0);
            const lined = Array.isArray(war?.clan?.members) ? war.clan.members.length : 0;
            const rosterHint =
              size > 0 && lined > 0 && lined < size
                ? `\nLinea attuale: <b>${lined}/${size}</b> — conferma i partecipanti.`
                : `\nRicorda: conferma i ${size || 15} in linea e i CC di difesa.`;
            await send(
              `📋 <b>CWL · Prep${turn}</b>\n` +
              `Mancano ~<b>${msLabel(untilStart)}</b> alla battle vs <b>${on}</b>.` +
              rosterHint,
            );
          }
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
        if (flagStart === true) {
          const lbl = isCwl ? `🏆 CWL – Round iniziato!${turn}` : '⚔️ Guerra iniziata!';
          const cn = fmt.escapeHtml(war?.clan?.name || '');
          const on = fmt.escapeHtml(war?.opponent?.name || '');
          const atkHint = isCwl ? '\n1 attacco a persona.' : '';
          await send(`${lbl}\n${cn} vs ${on}\nAvete <b>${msLabel(leftMs)}</b> per attaccare!${atkHint}`);
        }
      }
    }

    if (endDate && leftMs > 0) {
      const mins = Math.ceil(leftMs / 60000);
      const miss = missingAttacks(war);

      if (mins <= 240 && mins > 60) {
        const key = `4h:${war.endTime}`;
        if (!sent.has(key)) {
          sent.add(key);
          if ((isCwl ? notif.cwl_missing_4h : notif.war_missing_4h) === true) {
            await send(buildWarAlertMsg(war, miss, isCwl, '⏰ 4 ore rimanenti'));
          }
        }
      }
      if (mins <= 60 && mins > 15) {
        const key = `1h:${war.endTime}`;
        if (!sent.has(key)) {
          sent.add(key);
          if ((isCwl ? notif.cwl_missing_1h : notif.war_missing_1h) === true) {
            await send(buildWarAlertMsg(war, miss, isCwl, '⏰ 1 ora rimanente'));
          }
        }
      }
      if (mins <= 15) {
        const key = `15m:${war.endTime}`;
        if (!sent.has(key)) {
          sent.add(key);
          if ((isCwl ? notif.cwl_missing_15m : notif.war_missing_15m) === true) {
            await send(buildWarAlertMsg(war, miss, isCwl, '⏰ 15 minuti rimanenti'));
          }
        }
      }

      const cfg = isCwl
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
      if (cfg.enabled && !cfg.paused && Number.isFinite(cfg.lead) && cfg.lead > 0) {
        const key = `custom:${cfg.lead}:${war.endTime}`;
        if (mins <= cfg.lead && !sent.has(key)) {
          sent.add(key);
          const lbl = isCwl
            ? `⏰ ${leadLabel(cfg.lead)} alla fine del round`
            : `⏰ ${leadLabel(cfg.lead)} alla fine della guerra`;
          await send(buildWarAlertMsg(war, miss, isCwl, lbl));
        }
      }

      const perfectEnabled = isCwl ? notif.cwl_3star === true : notif.war_3star === true;
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
      if ((isCwl ? notif.cwl_round_end : notif.war_result) === true) {
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
      if (isCwl && notif.cwl_standings === true) {
        const sk = `standings:${war.endTime}`;
        if (!sent.has(sk)) {
          sent.add(sk);
          let stats = cwl;
          if (!stats?.groupStandings?.length) {
            stats = await getCachedCwlStats(clanTag).catch(() => null);
          }
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

  let cwl = null;
  if (notif?.cwl_alerts_enabled === true) {
    try {
      cwl = await getCachedCwlStats(clanTag);
      await _cwlSeasonAlerts(telegram, chatId, clanTag, sb, notif, cwl);
    } catch (_) {
      // Non bloccare il flusso principale
    }
  }

  const war = await api.currentWar(clanTag).catch(() => null);
  const isCwlCurrent = String(war?.warType || '').toLowerCase() === 'cwl';

  // Guerra classica: solo se current-war non è CWL
  if (war && !isCwlCurrent && notif?.war_alerts_enabled === true) {
    await _processSingleWarAlerts({
      telegram, chatId, clanTag, sb, notif, custom, war, isCwl: false, overlapPrep: false, cwl: null,
    });
  }

  // CWL: tutte le guerre attive/terminate della stagione (overlap prep+battle)
  if (notif?.cwl_alerts_enabled === true) {
    if (!cwl) {
      try { cwl = await getCachedCwlStats(clanTag); } catch (_) { cwl = null; }
    }
    const wars = api.listCwlWarsFromStats(cwl);
    const inWarRounds = wars.filter((w) => w.state === 'inWar');
    const prepRounds = wars.filter((w) => w.state === 'preparation');
    const endedRounds = wars.filter((w) => w.state === 'warEnded' || w.state === 'ended');

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
    for (const w of endedRounds) {
      await _processSingleWarAlerts({
        telegram, chatId, clanTag, sb, notif, custom, war: w, isCwl: true,
        overlapPrep: false, cwl,
      });
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
        const totalLoot = (current.attackLog || [])
          .reduce((acc, e) => acc + (e.capitalTotalLoot || 0), 0);
        await send(
          `🏛 <b>Raid Capitale – Fine weekend</b>\n` +
          `Il raid si è concluso!\n💰 Oro totale: <b>${totalLoot.toLocaleString('it-IT')}</b>`,
        );
      }
    }
    raidStateMem.set(memKey, { ...prevMem, state: current?.state || 'unknown' });
    return;
  }

  // Raid ongoing
  const startTime = current.startTime;

  // Primo rilevamento di questa stagione di raid → inizializza senza notificare
  if (!prevMem.startTime || prevMem.startTime !== startTime) {
    const initDestroyed = new Set();
    const initCleared   = new Set();
    for (const entry of (current.attackLog || [])) {
      const et      = entry.defender?.tag || 'unknown';
      let allDone   = (entry.districts || []).length > 0;
      for (const d of (entry.districts || [])) {
        if ((d.destructionPercent || 0) >= 100) {
          initDestroyed.add(`${et}:${d.id}`);
        } else {
          allDone = false;
        }
      }
      if (allDone) initCleared.add(et);
    }
    // Marca start come "già visto" per non notificarlo al riavvio
    const initSent = new Set(sent);
    initSent.add(`start:${startTime}`);
    raidStateMem.set(memKey, {
      state: 'ongoing', startTime,
      destroyed: initDestroyed, clearedEnemies: initCleared, sent: initSent,
    });
    return;
  }

  // Transizione not-ongoing → ongoing (vero inizio raid, bot era già in esecuzione)
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

// ─────────────────────────────────────────────────────────────────────────────
module.exports = { runExtendedWarAlerts, runExtendedRaidAlerts, runClanActivityAlerts };
