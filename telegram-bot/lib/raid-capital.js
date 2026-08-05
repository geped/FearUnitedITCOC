/**
 * Raid Capitale — partecipazione membri + formattazione messaggi bot.
 * API CoC: solo attacks / limit / capitalResourcesLooted (niente oro per attacco).
 */

const DIV = '━━━━━━━━━━━━━━━━';
const DIV2 = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

const RAID_MEMBERS_PER_PAGE = 12;
const TG_SAFE_CHARS = 3500;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normTag(t) {
  if (!t) return '';
  const s = String(t).trim().toUpperCase();
  return s.startsWith('#') ? s : `#${s.replace(/^#+/, '')}`;
}

function parseCocTime(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`);
}

function fmtItDate(d) {
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function msLabel(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}g`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || !parts.length) parts.push(`${m}m`);
  return parts.join(' ');
}

function attackLimitOf(m) {
  return Number(m?.attackLimit || 0) + Number(m?.bonusAttackLimit || 0);
}

function extractClanMemberList(clanMembersPayload) {
  if (!clanMembersPayload) return [];
  if (Array.isArray(clanMembersPayload)) return clanMembersPayload;
  if (Array.isArray(clanMembersPayload.items)) return clanMembersPayload.items;
  if (Array.isArray(clanMembersPayload.memberList)) return clanMembersPayload.memberList;
  return [];
}

/**
 * @returns {{
 *   done: Array, remaining: Array, none: Array,
 *   participants: Array, totalLoot: number, totalAttacks: number
 * }}
 */
function buildRaidParticipation(season, clanMembersPayload) {
  const raidMembers = Array.isArray(season?.members) ? season.members : [];
  const byTag = new Map();
  for (const m of raidMembers) {
    const tag = normTag(m.tag);
    if (!tag) continue;
    const attacks = Number(m.attacks || 0);
    const limit = attackLimitOf(m) || 5;
    const loot = Number(m.capitalResourcesLooted || 0);
    byTag.set(tag, {
      tag,
      name: m.name || tag,
      attacks,
      limit,
      loot,
      remaining: Math.max(0, limit - attacks),
    });
  }

  const roster = extractClanMemberList(clanMembersPayload);
  for (const m of roster) {
    const tag = normTag(m.tag);
    if (!tag || byTag.has(tag)) continue;
    byTag.set(tag, {
      tag,
      name: m.name || tag,
      attacks: 0,
      limit: 5,
      loot: 0,
      remaining: 5,
    });
  }

  const all = [...byTag.values()];
  const done = all
    .filter((p) => p.attacks > 0 && p.remaining <= 0)
    .sort((a, b) => b.loot - a.loot || b.attacks - a.attacks);
  const remaining = all
    .filter((p) => p.attacks > 0 && p.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining || b.loot - a.loot);
  const none = all
    .filter((p) => p.attacks <= 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'it'));
  const participants = all
    .filter((p) => p.attacks > 0)
    .sort((a, b) => b.loot - a.loot || b.attacks - a.attacks);

  const totalLoot =
    Number(season?.capitalTotalLoot) ||
    participants.reduce((s, p) => s + p.loot, 0);
  const totalAttacks =
    Number(season?.totalAttacks) ||
    participants.reduce((s, p) => s + p.attacks, 0);

  return { done, remaining, none, participants, totalLoot, totalAttacks };
}

function linePlayer(p) {
  return (
    `• <b>${escapeHtml(p.name)}</b> · ${p.attacks}/${p.limit} att · ` +
    `💰 ${Number(p.loot || 0).toLocaleString('it-IT')}`
  );
}

function formatParticipationLists(part, { maxChars = TG_SAFE_CHARS, includeDone = true } = {}) {
  const blocks = [];
  if (includeDone && part.done.length) {
    blocks.push(`✅ <b>Completati</b> (${part.done.length})\n` + part.done.map(linePlayer).join('\n'));
  }
  if (part.remaining.length) {
    blocks.push(
      `⏳ <b>Attacchi rimasti</b> (${part.remaining.length})\n` +
        part.remaining.map(linePlayer).join('\n'),
    );
  }
  if (part.none.length) {
    blocks.push(
      `❌ <b>Non hanno attaccato</b> (${part.none.length})\n` +
        part.none.map((p) => `• <b>${escapeHtml(p.name)}</b>`).join('\n'),
    );
  }
  if (!blocks.length) {
    return '<i>Nessun dato membri disponibile.</i>';
  }

  let out = '';
  let hidden = 0;
  for (const block of blocks) {
    const next = out ? `${out}\n\n${block}` : block;
    if (next.length > maxChars) {
      const lines = block.split('\n');
      let partial = lines[0] || '';
      for (let i = 1; i < lines.length; i++) {
        const tryLine = `${partial}\n${lines[i]}`;
        if ((out ? `${out}\n\n${tryLine}` : tryLine).length > maxChars) {
          hidden += lines.length - i;
          break;
        }
        partial = tryLine;
      }
      out = out ? `${out}\n\n${partial}` : partial;
      break;
    }
    out = next;
  }
  if (hidden > 0) out += `\n<i>…e altri ${hidden}</i>`;
  return out;
}

function formatRaidCountdownMessage(season, clanMembersPayload, leadMinutes, includeList) {
  const end = parseCocTime(season?.endTime);
  const left = end ? end.getTime() - Date.now() : 0;
  const part = buildRaidParticipation(season, clanMembersPayload);
  let text =
    `🏛 <b>Raid Capitale – Promemoria</b>\n` +
    `Mancano <b>${msLabel(left)}</b> alla fine` +
    (leadMinutes ? ` (soglia ${msLabel(leadMinutes * 60000)})` : '') +
    `.\n` +
    `Fine: <b>${fmtItDate(end)}</b> (ora IT)\n` +
    `💰 Oro clan: <b>${Number(part.totalLoot || 0).toLocaleString('it-IT')}</b>`;
  if (includeList) {
    text += `\n\n${formatParticipationLists(part, { includeDone: true, maxChars: TG_SAFE_CHARS - text.length - 20 })}`;
  }
  return text;
}

function formatRaidEndMessage(season, clanMembersPayload) {
  const part = buildRaidParticipation(season, clanMembersPayload);
  const head =
    `🏛 <b>Raid Capitale – Fine weekend</b>\n` +
    `Il raid si è concluso!\n` +
    `💰 Oro totale: <b>${Number(part.totalLoot || 0).toLocaleString('it-IT')}</b>\n` +
    `⚔️ Attacchi: <b>${part.totalAttacks}</b> · Raid completati: <b>${Number(season?.raidsCompleted || 0)}</b>`;
  const lists = formatParticipationLists(part, {
    includeDone: true,
    maxChars: TG_SAFE_CHARS - head.length - 20,
  });
  return `${head}\n\n${lists}`;
}

function formatRaidCapitalPage(season, clanInfo, clanMembersPayload, page = 0) {
  if (!season) {
    return {
      text:
        `${DIV}\n🏛 <b>Raid Capitale</b>\n${DIV}\n\n` +
        `<i>Nessuna season raid disponibile dall’API CoC.</i>`,
      page: 0,
      pages: 1,
    };
  }

  const state = String(season.state || 'unknown');
  const end = parseCocTime(season.endTime);
  const start = parseCocTime(season.startTime);
  const part = buildRaidParticipation(season, clanMembersPayload);
  const league =
    clanInfo?.capitalLeague?.name ||
    clanInfo?.capitalLeague?.id ||
    null;

  const list = [
    ...part.participants,
    ...part.none.filter((n) => !part.participants.some((p) => p.tag === n.tag)),
  ];
  const pages = Math.max(1, Math.ceil(Math.max(list.length, 1) / RAID_MEMBERS_PER_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = list.slice(p * RAID_MEMBERS_PER_PAGE, (p + 1) * RAID_MEMBERS_PER_PAGE);

  const stateLabel =
    state === 'ongoing'
      ? `🟢 In corso · restano <b>${msLabel(end ? end.getTime() - Date.now() : 0)}</b>`
      : state === 'ended'
        ? '⚪ Terminato'
        : escapeHtml(state);

  const lines = [
    `${DIV}\n🏛 <b>Raid Capitale</b>\n${DIV}`,
    `Stato: ${stateLabel}`,
    start ? `Inizio: <b>${fmtItDate(start)}</b>` : null,
    end ? `Fine: <b>${fmtItDate(end)}</b> (ora IT)` : null,
    league ? `🏅 Lega capitale: <b>${escapeHtml(league)}</b>` : null,
    `${DIV2}`,
    `💰 Oro: <b>${Number(part.totalLoot || 0).toLocaleString('it-IT')}</b>`,
    `✅ Raid completati: <b>${Number(season.raidsCompleted || 0)}</b>`,
    `⚔️ Attacchi: <b>${part.totalAttacks}</b>`,
    `👥 Completati: <b>${part.done.length}</b> · In corso: <b>${part.remaining.length}</b> · Zero: <b>${part.none.length}</b>`,
    `${DIV2}`,
    `📄 Pagina <b>${p + 1}</b>/${pages}`,
  ].filter(Boolean);

  if (!slice.length) {
    lines.push('', '<i>Nessun membro in elenco.</i>');
  } else {
    lines.push('');
    for (const m of slice) {
      if (m.attacks <= 0) {
        lines.push(`❌ <b>${escapeHtml(m.name)}</b> · 0 attacchi`);
      } else if (m.remaining > 0) {
        lines.push(
          `⏳ <b>${escapeHtml(m.name)}</b> · ${m.attacks}/${m.limit} · 💰 ${m.loot.toLocaleString('it-IT')} · restano ${m.remaining}`,
        );
      } else {
        lines.push(
          `✅ <b>${escapeHtml(m.name)}</b> · ${m.attacks}/${m.limit} · 💰 ${m.loot.toLocaleString('it-IT')}`,
        );
      }
    }
  }

  if (state !== 'ongoing') {
    lines.push('', '<i>Prossimo weekend: venerdì 07:00 UTC → lunedì 07:00 UTC.</i>');
  }

  return { text: lines.join('\n'), page: p, pages };
}

function leadReached(leftMs, leadMinutes) {
  const lead = Number(leadMinutes);
  if (!Number.isFinite(lead) || lead <= 0) return false;
  if (!Number.isFinite(leftMs) || leftMs <= 0) return false;
  return leftMs <= lead * 60 * 1000;
}

module.exports = {
  RAID_MEMBERS_PER_PAGE,
  parseCocTime,
  msLabel,
  fmtItDate,
  buildRaidParticipation,
  formatParticipationLists,
  formatRaidCountdownMessage,
  formatRaidEndMessage,
  formatRaidCapitalPage,
  leadReached,
  extractClanMemberList,
  escapeHtml,
};
