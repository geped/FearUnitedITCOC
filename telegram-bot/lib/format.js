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

/** Intestazione menù principale */
function formatMainMenuIntro({ clanLabel, clanTag, isCustomClan, defaultTag }) {
  const clanLine = isCustomClan
    ? `🏠 <b>Il tuo clan</b>\n<code>${escapeHtml(clanTag)}</code> · ${clanLabel}`
    : `🏠 <b>Clan predefinito</b>\n<code>${escapeHtml(defaultTag)}</code> · ${clanLabel}\n<i>Usa 🔐 Account → Login per il tuo.</i>`;
  return (
    `⚔️ <b>CoCBoard</b>\n` +
    `<i>Dashboard clan su Telegram</i>\n\n` +
    `${DIV}\n` +
    `${clanLine}\n` +
    `${DIV}\n\n` +
    `Scegli un’azione qui sotto o usa <code>/help</code>.`
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

function formatLoginHelp(defaultTag) {
  return (
    `${DIV}\n🔐 <b>Login clan</b>\n${DIV}\n\n` +
    `Imposta il <b>tag del clan</b> che vuoi gestire (stessi dati del sito per quel tag).\n\n` +
    `1️⃣ Comando:\n<code>/login #TAGCLAN</code>\n\n` +
    `2️⃣ Esempio:\n<code>/login #2ABC0XYZ</code>\n\n` +
    `Fino al login usi il clan predefinito del bot:\n<code>${escapeHtml(defaultTag)}</code>\n\n` +
    `<i>Bonus CWL in elenco sono quelli salvati su Supabase per quel tag (se presenti).</i>`
  );
}

function formatAccountPanel({ playerTag, clanTag, defaultTag }) {
  const p = playerTag ? `<code>${escapeHtml(playerTag)}</code>` : '<i>non collegato</i>';
  const c = clanTag ? `<code>${escapeHtml(clanTag)}</code>` : `<i>predefinito ${escapeHtml(defaultTag)}</i>`;
  return (
    `${DIV}\n⚙️ <b>Account</b>\n${DIV}\n\n` +
    `🏠 <b>Clan attivo</b>\n${c}\n\n` +
    `👤 <b>Villaggio (profilo)</b>\n${p}\n\n` +
    `Comandi:\n` +
    `<code>/login #CLAN</code> — cambia clan\n` +
    `<code>/logout_clan</code> — torna al predefinito\n` +
    `<code>/link #GIOCATORE</code> — collega villaggio\n` +
    `<code>/unlink</code> — rimuovi villaggio e preferenze`
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
  formatMainMenuIntro,
  formatClanInfo,
  formatMembersPage,
  formatCwl,
  formatWarLog,
  formatBonuses,
  formatPlayerSummary,
  formatClanSearch,
  formatLoginHelp,
  formatAccountPanel,
  chunkForTelegram,
};
