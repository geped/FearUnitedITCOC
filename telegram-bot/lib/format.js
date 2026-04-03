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

function formatCwl(data) {
  if (!data || data.state === 'notInWar') {
    return `${DIV}\n🏆 <b>CWL</b>\n${DIV}\n\n<i>Nessuna guerra lega attiva o clan fuori dalla CWL.</i>`;
  }
  const lines = [
    `${DIV}`,
    `🏆 <b>CWL live</b> · ${escapeHtml(data.leagueNameIt || data.leagueNameEn || 'Lega')}`,
    `${DIV}`,
    `📅 Stagione <code>${escapeHtml(data.season || '—')}</code> · stato <b>${escapeHtml(data.state || '—')}</b>`,
  ];
  if (data.ourPosition != null) {
    lines.push(`🥇 Posizione gruppo: <b>${data.ourPosition}</b> / ${data.groupStandings?.length || '?'}`);
  }
  const top = (data.players || []).slice(0, 15);
  if (top.length) {
    lines.push('');
    lines.push(`⭐ <b>Migliori stelle (roster)</b>`);
    top.forEach((pl, i) => {
      lines.push(
        `${i + 1}. ${escapeHtml(pl.name)} — ${pl.stars ?? 0}★ · ${(pl.destruction ?? 0).toFixed?.(1) ?? pl.destruction}%`
      );
    });
  }
  return lines.join('\n');
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
  formatWarLog,
  formatBonuses,
  formatPlayerSummary,
  formatClanSearch,
  formatSetclanHelp,
  formatAccountPanel,
  chunkForTelegram,
};
