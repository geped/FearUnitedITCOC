'use strict';

const MEMBERS_PER_PAGE = 12;
const MAX_MESSAGE = 3900;

const DIV = '━━━━━━━━━━━━━━━━';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseTagArg(text) {
  if (!text) return null;
  const t = String(text).trim().toUpperCase();
  if (!t) return null;
  return t.startsWith('#') ? t : `#${t}`;
}

/** Schermata iniziale: nessun accesso senza account (come il sito). */
function formatGuestWelcome() {
  return (
    `⚔️ <b>CoCBoard</b>\n` +
    `<i>Stessi account del sito web.</i>\n\n` +
    `${DIV}\n` +
    `🔒 <b>Accesso richiesto</b>\n` +
    `${DIV}\n\n` +
    `Per usare il bot devi <b>accedere</b> o <b>registrarti</b> con le stesse credenziali della dashboard.\n\n` +
    `<i>Durante Accedi/Registrati scrivi <code>/cancel</code> per annullare.</i>`
  );
}

function formatGuestSnack() {
  return '🔒 Accedi o registrati con i pulsanti qui sotto.';
}

function formatGuestHelp() {
  return (
    `${DIV}\n❓ <b>Aiuto</b> (ospite)\n${DIV}\n\n` +
    `• <b>Accedi</b> — nome utente / tag <code>#...</code> / email + password (come su cocboard)\n` +
    `• <b>Registrati</b> — tag giocatore + chiave API in-game + password (come sul sito)\n` +
    `• Poi avrai membro, CWL, bonus e guerre sul <b>tuo</b> clan profilo.\n` +
    `• <b>Logout</b> — cancella sessione sul bot, annulla wizard e svuota messaggi in coda su Telegram.\n\n` +
    `<code>/start</code> — torna a questo schermo`
  );
}

/** Menù dopo login Supabase */
function formatAuthedMenuIntro({ displayName, clanTag, clanName, hasClanOverride }) {
  if (!clanTag) {
    return (
      `⚔️ <b>CoCBoard</b>\n` +
      `${DIV}\n` +
      `👋 Ciao <b>${escapeHtml(displayName || 'giocatore')}</b>\n` +
      `${DIV}\n\n` +
      `⚠️ <b>Nessun clan</b> sul profilo.\n` +
      `Entra in un clan in game oppure imposta un tag con:\n<code>/setclan #TAG</code>\n\n` +
      `Poi potrai usare membro, CWL, bonus e guerre.`
    );
  }
  const src = hasClanOverride ? ' (override /setclan)' : ' (dal profilo CoC)';
  return (
    `⚔️ <b>CoCBoard</b>\n` +
    `${DIV}\n` +
    `👋 <b>${escapeHtml(displayName || 'Comandante')}</b>\n` +
    `🏠 <b>${escapeHtml(clanName || clanTag)}</b> <code>${escapeHtml(clanTag)}</code>${src}\n` +
    `${DIV}\n\n` +
    `Scegli un’azione o <code>/help</code>.`
  );
}

function formatClanInfo(info) {
  const lines = [
    `${DIV}`,
    `🏰 <b>${escapeHtml(info.name || 'Clan')}</b> <code>${escapeHtml(info.tag || '')}</code>`,
    `${DIV}`,
    `📊 Livello <b>${info.clanLevel ?? '—'}</b> · 👥 Membri <b>${info.members ?? '—'}</b>`,
    `⚔️ Vittorie guerra <b>${info.warWins ?? '—'}</b> · 🏆 Trofei richiesti <b>${info.requiredTrophies ?? '—'}</b>`,
  ];
  if (info.warLeague?.name) lines.push(`🛡️ Lega guerra: <b>${escapeHtml(info.warLeague.name)}</b>`);
  if (info.description) {
    lines.push('');
    lines.push(`📝 <i>${escapeHtml(info.description.slice(0, 420))}</i>`);
  }
  return lines.join('\n');
}

function formatMembersPage(items, page, clanTagHint) {
  const sorted = [...(items || [])].sort((a, b) => (a.clanRank ?? 999) - (b.clanRank ?? 999));
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / MEMBERS_PER_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = sorted.slice(p * MEMBERS_PER_PAGE, (p + 1) * MEMBERS_PER_PAGE);
  const lines = slice.map((m) => {
    const th = m.townHallLevel != null ? `TH${m.townHallLevel}` : 'TH?';
    const role = m.role ? ` · ${escapeHtml(String(m.role))}` : '';
    return `${m.clanRank ?? '—'}. ${escapeHtml(m.name)} — ${th} | ${m.trophies ?? 0}🏆${role}`;
  });
  const head =
    `${DIV}\n` +
    `👥 <b>Membri</b> · <code>${escapeHtml(clanTagHint || '')}</code>\n` +
    `📄 Pagina <b>${p + 1}</b> di <b>${pages}</b> · ${total} in lista\n` +
    `${DIV}`;
  return { text: `${head}\n\n${lines.join('\n')}`, page: p, pages };
}

const CWL_PLAYERS_PER_PAGE = 8;
const CWL_ROUND_ATTACK_LINES = 18;

const CWL_STATE_IT = {
  notInWar: 'Nessuna CWL attiva',
  preparation: 'Preparazione gruppo',
  inWar: 'CWL in corso',
  ended: 'CWL terminata',
  warEnded: 'Guerra terminata',
};

const CWL_ROUND_RESULT_IT = {
  win: 'Vittoria',
  lose: 'Sconfitta',
  draw: 'Pareggio',
  ongoing: 'In corso',
  preparation: 'Preparazione',
};

function cwlPlayerAvgDestruction(p) {
  const made = p.attacks_made || 0;
  if (made <= 0) return '—';
  return `${(p.destruction / made).toFixed(1)}%`;
}

function cwlGroupAvgDest(s) {
  const w = s.warCount || 0;
  if (w <= 0) return '—';
  return `${(s.totalDestr / w).toFixed(1)}%`;
}

function formatCwlEmpty() {
  return `${DIV}\n🏆 <b>CWL</b>\n${DIV}\n\n<i>Nessuna guerra lega attiva o clan fuori dalla CWL.</i>`;
}

/** Panoramica: stagione, stato lega, posizione, formazione (come card live sul sito). */
function formatCwlOverview(data) {
  if (!data || data.state === 'notInWar') return formatCwlEmpty();
  const st = CWL_STATE_IT[data.state] || data.state || '—';
  const lines = [
    `${DIV}`,
    `🏆 <b>CWL live</b> · ${escapeHtml(data.leagueNameIt || data.leagueNameEn || 'Lega')}`,
    `${DIV}`,
    `📅 Stagione <code>${escapeHtml(data.season || '—')}</code>`,
    `📌 Stato lega: <b>${escapeHtml(st)}</b>`,
    `👥 Formazione: <b>${data.teamSize ?? '—'}</b> vs <b>${data.teamSize ?? '—'}</b>`,
  ];
  if (data.ourPosition != null && (data.groupStandings || []).length) {
    lines.push(
      `🥇 <b>Posizione nel gruppo:</b> ${data.ourPosition} / ${data.groupStandings.length}`
    );
  }
  const rounds = data.roundsData || [];
  lines.push(`⚔️ <b>Turni war</b> nel dato: <b>${rounds.length}</b> / 7`);
  const nPl = (data.players || []).length;
  if (nPl) lines.push(`📋 Giocatori nel roster: <b>${nPl}</b>`);
  lines.push('');
  lines.push(`<i>Usa i pulsanti: Gruppo, Roster, Turni — come sulla dashboard CoCBoard.</i>`);
  return lines.join('\n');
}

/** Classifica gruppo (8 clan): stelle e distruzione media come sul sito. */
function formatCwlGroup(data) {
  if (!data || data.state === 'notInWar') return formatCwlEmpty();
  const gs = data.groupStandings || [];
  if (!gs.length) {
    return `${DIV}\n🏅 <b>Classifica gruppo</b>\n${DIV}\n\n<i>Nessun dato classifica.</i>`;
  }
  const lines = [
    `${DIV}`,
    `🏅 <b>Classifica gruppo CWL</b>`,
    `📅 <code>${escapeHtml(data.season || '—')}</code> · ${escapeHtml(data.leagueNameIt || data.leagueNameEn || '')}`,
    `${DIV}`,
    `<i>Ordine: stelle, poi distruzione media sui turni giocati.</i>`,
    '',
  ];
  gs.forEach((c, i) => {
    const us = data.ourPosition === i + 1 ? ' ⭐' : '';
    const nm = escapeHtml(c.name || c.tag || '—');
    lines.push(
      `${i + 1}. ${nm}${us}\n   ${c.stars ?? 0}★ · media ${cwlGroupAvgDest(c)} distruzione`
    );
  });
  return lines.join('\n');
}

/** Roster con stelle, distruzione media per attacco, attacchi fatti/richiesti (come tabella bonus live). */
function formatCwlPlayersPage(data, page) {
  if (!data || data.state === 'notInWar') return formatCwlEmpty();
  const players = data.players || [];
  if (!players.length) {
    return `${DIV}\n👥 <b>Roster CWL</b>\n${DIV}\n\n<i>Nessun giocatore nel roster.</i>`;
  }
  const pages = Math.max(1, Math.ceil(players.length / CWL_PLAYERS_PER_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = players.slice(p * CWL_PLAYERS_PER_PAGE, (p + 1) * CWL_PLAYERS_PER_PAGE);
  const lines = [
    `${DIV}`,
    `👥 <b>Roster CWL</b> · live`,
    `📄 Pagina <b>${p + 1}</b> / <b>${pages}</b> · ${players.length} giocatori`,
    `${DIV}`,
    `<i>Stelle totali · distr. media/attacco · attacchi fatti/richiesti · TH</i>`,
    '',
  ];
  slice.forEach((pl, i) => {
    const idx = p * CWL_PLAYERS_PER_PAGE + i + 1;
    const th = pl.th_level != null ? `TH${pl.th_level}` : 'TH?';
    const atk =
      pl.attacks_required > 0
        ? `${pl.attacks_made ?? 0}/${pl.attacks_required}`
        : `${pl.attacks_made ?? 0}/—`;
    lines.push(
      `${idx}. <b>${escapeHtml(pl.name)}</b> (${th})\n   ${pl.stars ?? 0}★ · ${cwlPlayerAvgDestruction(pl)} · ${atk}`
    );
  });
  return lines.join('\n');
}

function formatWarStateIt(s) {
  if (s === 'preparation') return 'Preparazione';
  if (s === 'inWar') return 'In guerra';
  if (s === 'warEnded' || s === 'ended') return 'Terminata';
  return s || '—';
}

/** Dettaglio turno: avversario, risultato, stelle, attacchi (riepilogo come card war sul sito). */
function formatCwlRoundDetail(data, roundIdx) {
  if (!data || data.state === 'notInWar') return formatCwlEmpty();
  const rounds = data.roundsData || [];
  if (!rounds.length) {
    return `${DIV}\n⚔️ <b>Turni CWL</b>\n${DIV}\n\n<i>Nessun dettaglio guerra disponibile.</i>`;
  }
  const rMax = rounds.length - 1;
  const idx = Math.min(Math.max(0, roundIdx), rMax);
  const rd = rounds[idx];
  const rn = rd.roundNumber ?? idx + 1;
  const resIt = CWL_ROUND_RESULT_IT[rd.result] || rd.result || '—';
  const c = rd.clan || {};
  const o = rd.opponent || {};
  const lines = [
    `${DIV}`,
    `⚔️ <b>Turno ${rn}</b> / ${rounds.length} · ${formatWarStateIt(rd.state)}`,
    `${DIV}`,
    `🛡️ <b>Noi</b> ${escapeHtml(c.name || '')} <code>${escapeHtml(c.tag || '')}</code>`,
    `⚔️ <b>Loro</b> ${escapeHtml(o.name || '')} <code>${escapeHtml(o.tag || '')}</code>`,
    '',
    `📊 <b>${c.stars ?? 0}</b>★ (${c.destruction ?? 0}% distr.) vs <b>${o.stars ?? 0}</b>★ (${o.destruction ?? 0}%)`,
    `🎯 Risultato: <b>${escapeHtml(resIt)}</b>`,
    `🔢 Attacchi usati: ${c.attacksUsed ?? 0} vs ${o.attacksUsed ?? 0} · ${rd.attacksPerMember || 1}/giocatore`,
    '',
  ];

  const atkLines = [];
  const defMap = rd.defenderMap || {};
  const pushAttacks = (members, label) => {
    for (const m of members || []) {
      for (const a of m.attacks || []) {
        const d = defMap[a.defenderTag] || {};
        atkLines.push(
          `${label} <b>${escapeHtml(m.name)}</b> → ${escapeHtml(d.name || a.defenderTag || '?')}: ${a.stars ?? 0}★ ${a.destruction ?? 0}%`
        );
      }
    }
  };
  pushAttacks(c.members, '📍');
  pushAttacks(o.members, '🛡️');
  if (atkLines.length) {
    lines.push(`<b>Attacchi</b> <i>(max ${CWL_ROUND_ATTACK_LINES})</i>`, '');
    atkLines.slice(0, CWL_ROUND_ATTACK_LINES).forEach((l) => lines.push(l));
    if (atkLines.length > CWL_ROUND_ATTACK_LINES) {
      lines.push(`\n<i>… altri ${atkLines.length - CWL_ROUND_ATTACK_LINES} attacchi non mostrati</i>`);
    }
  } else {
    lines.push('<i>Nessun attacco registrato in questo turno.</i>');
  }
  return lines.join('\n');
}

function getCwlPlayerPageCount(data) {
  const n = (data?.players || []).length;
  return Math.max(1, Math.ceil(n / CWL_PLAYERS_PER_PAGE));
}

function getCwlRoundCount(data) {
  return Math.max(0, (data?.roundsData || []).length);
}

/**
 * @param {'ov'|'g'|'p'|'r'} view
 */
function formatCwlScreen(data, view, pPage, rIdx) {
  if (!data || data.state === 'notInWar') {
    return { text: formatCwlEmpty(), view: 'ov', pPage: 0, rIdx: 0 };
  }
  const pPages = getCwlPlayerPageCount(data);
  const rCount = getCwlRoundCount(data);
  const pClamped = Math.min(Math.max(0, pPage), pPages - 1);
  const rClamped = rCount ? Math.min(Math.max(0, rIdx), rCount - 1) : 0;
  let text;
  switch (view) {
    case 'g':
      text = formatCwlGroup(data);
      break;
    case 'p':
      text = formatCwlPlayersPage(data, pClamped);
      break;
    case 'r':
      text = formatCwlRoundDetail(data, rClamped);
      break;
    default:
      text = formatCwlOverview(data);
      view = 'ov';
  }
  return { text, view, pPage: pClamped, rIdx: rClamped };
}

/** Compat: un solo blocco testo (es. /cwl da comando). */
function formatCwl(data) {
  if (!data || data.state === 'notInWar') return formatCwlEmpty();
  const parts = [formatCwlOverview(data), '', formatCwlGroup(data)];
  const pPages = getCwlPlayerPageCount(data);
  for (let p = 0; p < pPages; p++) {
    parts.push('', formatCwlPlayersPage(data, p));
  }
  const rCount = getCwlRoundCount(data);
  for (let i = 0; i < rCount; i++) {
    parts.push('', formatCwlRoundDetail(data, i));
  }
  return parts.join('\n');
}

function formatWarLog(data) {
  const items = data.items || data;
  if (!Array.isArray(items) || !items.length) {
    return `${DIV}\n📜 <b>Registro guerre</b>\n${DIV}\n\n<i>Nessuna guerra nel log o log del clan non pubblico.</i>`;
  }
  const slice = items.slice(0, 10);
  const lines = slice.map((w) => {
    const c = w.clan || {};
    const o = w.opponent || {};
    const r = w.result ? String(w.result) : '';
    const icon = r === 'win' ? '✅' : r === 'lose' ? '❌' : '⚖️';
    return `${icon} ${escapeHtml(r || '—')} · ${escapeHtml(c.name)} <b>${c.stars ?? 0}</b>★ vs <b>${o.stars ?? 0}</b>★ ${escapeHtml(o.name)}`;
  });
  return `${DIV}\n📜 <b>Ultime guerre</b> <i>(max 10)</i>\n${DIV}\n\n${lines.join('\n')}`;
}

function formatBonuses(rows) {
  if (!rows || !rows.length) {
    return `${DIV}\n🎁 <b>Bonus CWL</b>\n${DIV}\n\n<i>Nessun bonus in database per questo clan (dati non ancora generati).</i>`;
  }
  const lines = rows.slice(0, 40).map((r) => {
    const flag = r.received_last_month ? ' 🔁' : '';
    return `${r.rank ?? '—'}. ${escapeHtml(r.name)} — <b>${r.score ?? 0}</b>${flag}`;
  });
  return `${DIV}\n🎁 <b>Ranking bonus</b>\n${DIV}\n\n${lines.join('\n')}`;
}

function formatPlayerSummary(p) {
  if (!p) return 'Giocatore non trovato.';
  const lines = [
    `${DIV}`,
    `👤 <b>${escapeHtml(p.name)}</b> <code>${escapeHtml(p.tag || '')}</code>`,
    `${DIV}`,
    `🏠 TH <b>${p.townHallLevel ?? '—'}</b> · 🏆 <b>${p.trophies ?? '—'}</b> tr · ⭐ Exp <b>${p.expLevel ?? '—'}</b>`,
  ];
  if (p.clan?.name) lines.push(`⚔️ Clan: ${escapeHtml(p.clan.name)} <code>${escapeHtml(p.clan.tag || '')}</code>`);
  if (p.role) lines.push(`👔 Ruolo: ${escapeHtml(p.role)}`);
  return lines.join('\n');
}

function formatClanSearch(items) {
  if (!items || !items.length) return `${DIV}\n🔍 <b>Ricerca clan</b>\n${DIV}\n\n<i>Nessun risultato.</i>`;
  const lines = items.slice(0, 15).map((c, i) => {
    return `${i + 1}. ${escapeHtml(c.name)} <code>${escapeHtml(c.tag || '')}</code> · ${c.members ?? '?'} membri`;
  });
  return `${DIV}\n🔍 <b>Risultati</b>\n${DIV}\n\n${lines.join('\n')}`;
}

function formatSetclanHelp() {
  return (
    `${DIV}\n🏰 <b>Clan da visualizzare</b>\n${DIV}\n\n` +
    `Se sul profilo non hai un clan o vuoi vedere <b>un altro</b> tag:\n\n` +
    `<code>/setclan #TAGCLAN</code>\n\n` +
    `<code>/logout_clan</code> — rimuovi solo l’override e torni al clan del profilo account.\n\n` +
    `<i>I bonus in elenco sono quelli presenti su Supabase per quel tag.</i>`
  );
}

function formatAccountPanel({ username, cocTag, profileClanTag, savedClanOverride }) {
  const p = cocTag ? `<code>${escapeHtml(cocTag)}</code>` : '<i>—</i>';
  const base = profileClanTag ? `<code>${escapeHtml(profileClanTag)}</code>` : '<i>nessuno sul profilo</i>';
  const ov = savedClanOverride ? `<code>${escapeHtml(savedClanOverride)}</code>` : '<i>nessuno</i>';
  return (
    `${DIV}\n⚙️ <b>Account CoCBoard</b>\n${DIV}\n\n` +
    `👤 Utente: <b>${escapeHtml(username || '—')}</b>\n` +
    `🎯 Villaggio: ${p}\n` +
    `🏠 Clan profilo: ${base}\n` +
    `📌 Override bot: ${ov}\n\n` +
    `<code>/setclan #TAG</code> · <code>/logout_clan</code>\n` +
    `<code>/esci</code> — logout da questo bot`
  );
}

function chunkForTelegram(html) {
  if (html.length <= MAX_MESSAGE) return [html];
  const parts = [];
  let rest = html;
  while (rest.length) {
    parts.push(rest.slice(0, MAX_MESSAGE));
    rest = rest.slice(MAX_MESSAGE);
  }
  return parts;
}

module.exports = {
  MEMBERS_PER_PAGE,
  CWL_PLAYERS_PER_PAGE,
  DIV,
  escapeHtml,
  parseTagArg,
  formatGuestWelcome,
  formatGuestSnack,
  formatGuestHelp,
  formatAuthedMenuIntro,
  formatClanInfo,
  formatMembersPage,
  formatCwl,
  formatCwlScreen,
  formatCwlEmpty,
  getCwlPlayerPageCount,
  getCwlRoundCount,
  formatWarLog,
  formatBonuses,
  formatPlayerSummary,
  formatClanSearch,
  formatSetclanHelp,
  formatAccountPanel,
  chunkForTelegram,
};
