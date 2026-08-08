'use strict';

const raidCap = require('./raid-capital');

const MEMBERS_PER_PAGE = 12;
const BONUS_PER_PAGE = 10;
const RANKINGS_SHOWN = 25;
const MAX_MESSAGE = 3900;

const DIV = '━━━━━━━━━━━━━━━━';
const DIV2 = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

/** locationId come su CoCBoard (app.js RANK_LOCATIONS). */
const RANK_LOCATION_ITALY = '32000094';
const RANK_LOCATION_GLOBAL = 'global';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Testo multi-riga senza `<pre>` (escape HTML). I newline restano `\n`: in parse_mode HTML
 * Telegram non supporta il tag `<br>` (400 Unsupported start tag "br") — solo `\n` per andare a capo.
 */
function telegramHtmlPlainBlock(plain) {
  if (plain == null || plain === '') return '';
  return escapeHtml(String(plain));
}

function parseTagArg(text) {
  if (!text) return null;
  const t = String(text).trim().toUpperCase();
  if (!t) return null;
  return t.startsWith('#') ? t : `#${t}`;
}

/** Chat privata: login sicuro. */
function formatGuestWelcomePrivate() {
  return (
    `👋 <b>Benvenuto su CoCBoard!</b>\n` +
    `${DIV2}\n\n` +
    `Il bot Telegram del tuo clan — dati CoC in tempo reale, CWL, bonus, guerre e molto altro.\n\n` +
    `📌 <b>Anche senza account puoi:</b>\n` +
    `• 🌍 <b>Community</b> — chat globale inter-clan e reclutamento\n` +
    `• 🔍 <b>Cerca</b> — villaggio (#tag) o clan (nome)\n` +
    `• 📊 <b>Classifica</b> — top trofei Italia e mondo\n\n` +
    `🔐 <b>Con Accedi / Registrati sblocchi:</b>\n` +
    `Clan, CWL live, bonus stagionali, registro guerre e il tuo profilo — accessibili anche dalla <b>Mini App</b> web direttamente da Telegram.\n\n` +
    `👇 <i>Tocca un pulsante qui sotto per iniziare!</i>`
  );
}

/**
 * Gruppo / supergruppo: niente password qui (visibile a tutti).
 * @param {string} [privateChatUrl] es. https://t.me/BotName
 */
/** Ruolo in-game CoC API → etichetta italiana (mai «Admin» sito). */
function mapCoCRoleToItalian(role) {
  if (!role) return '';
  const r = String(role).toLowerCase().replace(/\s+/g, '');
  const map = {
    leader: 'Capo',
    coleader: 'Co-capo',
    'co-leader': 'Co-capo',
    elder: 'Anziano',
    member: 'Membro',
    admin: 'Anziano', // API CoC usa "admin" per l'anziano in clan
  };
  return map[r] || escapeHtml(String(role));
}

function formatGuestWelcomeGroup(privateChatUrl) {
  const open =
    privateChatUrl && String(privateChatUrl).trim()
      ? `\n\n🔗 <a href="${escapeHtml(String(privateChatUrl).trim())}"><b>Accedi o registrati in chat privata</b></a>\n<i>→ poi torna qui: si sblocca tutto!</i>`
      : '\n\n<i>Aprimi in <b>chat privata</b> per Accedi e Registrati.</i>';
  return (
    `👋 <b>Ciao! Sono CoCBoard</b> <i>· il bot di gestione clan CoC</i>\n` +
    `${DIV2}\n\n` +
    `📌 <b>Cosa puoi fare qui:</b>\n` +
    `• 🔍 <b>Cerca</b> — villaggio (#tag) o clan (nome)\n` +
    `• 📊 <b>Classifica</b> — top trofei Italia / mondo\n\n` +
    `🔓 <b>Vuoi vedere clan, CWL, bonus e guerre?</b>\n` +
    `Fai login in chat privata con il bot — poi qui si sblocca tutto (clan collegato).` +
    open +
    `\n\n<i>Usa <code>/cocboard</code> per aprire il menù.</i>`
  );
}

function formatPrivateOnlyWizard() {
  return (
    `🔒 <b>Passaggio sensibile</b>\n\n` +
    `Password e chiavi API non vanno scritte <b>nel gruppo</b>.\n\n` +
    `👉 Apri la <b>chat privata</b> con il bot e usa <b>Accedi</b> o <b>Registrati</b> lì.`
  );
}

function formatGroupBotAdded() {
  return (
    `👋 <b>CoCBoard è arrivato nel gruppo!</b>\n` +
    `${DIV2}\n\n` +
    `Sono il bot di gestione clan per Clash of Clans — dati live, CWL, bonus e guerre direttamente qui.\n\n` +
    `📌 <b>Come iniziare:</b>\n` +
    `• Scrivi <code>/cocboard</code> per aprire il menù (meglio di <code>/start</code>: evita conflitti con altri bot).\n` +
    `• Usa i <b>pulsanti</b> oppure <code>/cerca</code>, <code>/classifica</code> e gli altri comandi.\n\n` +
    `🔗 <b>Collegare il clan al gruppo</b>\n` +
    `Un Capo o Co-Capo deve ottenere il <b>token</b> dal bot (menu → Aggiungi a canale/gruppo) e digitare <code>/linkclan TOKEN</code> qui — poi tutti vedono Membri, CWL e guerre.\n\n` +
    `🔐 <b>Login e password</b> vanno fatti sempre in <b>chat privata</b> con il bot, mai nel gruppo.\n\n` +
    `<i>💡 Consiglio: fixa questo messaggio così tutti sanno come usarmi!</i>`
  );
}

function formatGuestSnack() {
  return '🔐 Apri il menù: <b>Accedi</b> o <b>Registrati</b> (solo in chat privata).';
}

function formatGuestHelp() {
  return (
    `${DIV}\n📖 <b>Guida rapida</b> (privato)\n${DIV}\n\n` +
    `<b>Senza account</b>\n` +
    `• <b>Cerca</b> / <b>Classifica</b> — villaggio o clan, classifiche trofei\n` +
    `• <b>Community</b> — <b>Chat globale</b>: con account CoCBoard scegli se mostrare tag/TH/XP o solo nome e ✅; senza account riga <code>nome#TAG</code> solo testo, senza emoticon (nel nome <b>non</b> usare ✅ — riservato ai profili verificati)\n` +
    `• <b>Regole chat globale</b> — niente link (web, Telegram, store), niente link CoC, niente tag <code>#</code> nel testo del messaggio; niente spam. Il bot applica <b>strike</b>: avvisi, poi <b>mute</b> temporaneo, poi <b>ban</b> dalla stanza. Per contestazioni contatta chi gestisce il bot.\n` +
    `• <b>Uscita chat globale</b> — automatica con comandi <code>/</code> (tranne <code>/esci_chat_global</code> e <code>/annulla_reclutamento</code>), <code>/cocboard</code>, <code>/start</code> o pulsanti <b>Menù</b> / <b>Community</b>; alla finestra i messaggi della stanza in questa chat vengono rimossi.\n` +
    `• <b>Reclutamento</b> — leggi annunci; invia bozza come ospite (nome Telegram) o con account\n\n` +
    `<b>Accedi</b>\n` +
    `Username, tag <code>#...</code> o email → password.\n\n` +
    `<b>Registrati</b>\n` +
    `Tag villaggio → chiave API in-game → password → email (facoltativa).\n\n` +
    `<b>Dopo il login</b>\n` +
    `Menù completo + pulsanti <b>(web)</b> (Mini App). Se apri il <b>(web)</b> da qui, l’accesso al sito è <b>automatico</b> (stessa sessione del bot sul dispositivo).\n\n` +
    `<b>Logout</b>\n` +
    `Dal menù se sei dentro.\n\n` +
    `<code>/start</code> · <code>/cocboard</code> · <code>/cancel</code>`
  );
}

function formatGroupHelp() {
  return (
    `${DIV}\n📖 <b>Guida gruppo</b>\n${DIV}\n\n` +
    `• <b>Cerca / Classifica</b> — anche senza login.\n` +
    `• <b>Clan, CWL, bonus</b> — dopo <b>Accedi in chat privata</b>, usa i pulsanti anche qui.\n` +
    `• Non inviare <b>password</b> in gruppo: usa la chat privata con il bot.\n\n` +
    `<code>/cocboard</code> — menù · <code>/cerca</code> · <code>/classifica</code>`
  );
}

/** Banner sotto al menù in gruppo/canale in base al collegamento chat↔clan. */
function formatGroupMenuBanner(gate) {
  if (!gate || gate.reason === 'private' || gate.reason === 'ok') return '';
  if (gate.reason === 'nolink') {
    if (gate.isLeader) {
      return (
        `\n\n🔗 <i>Questa chat non è collegata a un clan. In <b>privato</b>: «Aggiungi a canale/gruppo», poi invia qui <code>/linkclan TOKEN</code>.</i>`
      );
    }
    return (
      `\n\n🔗 <i>Chiedi a <b>Capo</b>/<b>Co-Capo</b>/<b>Admin</b> di collegare il bot (privato → Aggiungi a canale/gruppo).</i>`
    );
  }
  if (gate.reason === 'wrongclan') {
    return (
      `\n\n⚠️ <i>Questa chat è del clan <code>${escapeHtml(gate.linkedTag || '')}</code>; il tuo profilo è su <code>${escapeHtml(gate.yourTag || '—')}</code>.</i>`
    );
  }
  if (gate.reason === 'noteligible') {
    return `\n\n🔒 <i>Account non riconosciuto come membro clan (registrati con API CoC in privato).</i>`;
  }
  return '';
}

function formatGroupClanGateLong(gate) {
  if (!gate) return `${DIV}\n⚠️ Accesso dati clan non disponibile.\n${DIV}`;
  if (gate.reason === 'nolink') {
    if (gate.isLeader) {
      return (
        `${DIV}\n🔗 <b>Collega questa chat al clan</b>\n${DIV}\n\n` +
        `1. Apri il bot in <b>chat privata</b>\n` +
        `2. Menù → <b>Aggiungi a canale/gruppo</b> e segui i passi\n` +
        `3. Aggiungi il bot qui come <b>admin</b>\n` +
        `4. Invia in questa chat: <code>/linkclan TOKEN</code> (token che ti dà il bot)\n\n` +
        `<i>TOKEN valido ~1 ora, un solo uso.</i>`
      );
    }
    return (
      `${DIV}\n🔗 <b>Chat non collegata</b>\n${DIV}\n\n` +
        `I dati clan compariranno quando un <b>Capo</b>, <b>Co-Capo</b> o <b>Admin</b> completa il collegamento dal bot in privato.`
    );
  }
  if (gate.reason === 'wrongclan') {
    return (
      `${DIV}\n⚠️ <b>Clan diverso</b>\n${DIV}\n\n` +
      `Questa chat è per <code>${escapeHtml(gate.linkedTag || '')}</code>.\n` +
      `Il tuo profilo CoCBoard è su <code>${escapeHtml(gate.yourTag || '—')}</code>.\n\n` +
      `<i>Apri il bot in privato se serve cambiare contesto.</i>`
    );
  }
  if (gate.reason === 'noteligible') {
    return (
      `${DIV}\n🔒 <b>Profilo non idoneo</b>\n${DIV}\n\n` +
        `Serve un account registrato con <b>chiave API CoC</b> e villaggio nel clan.\n` +
        `Registrati in <b>chat privata</b> con il bot.`
    );
  }
  return `${DIV}\n⚠️ Operazione non disponibile.\n${DIV}`;
}

/** Menù dopo login Supabase */
function formatAuthedMenuIntro({
  displayName,
  clanTag,
  clanName,
  hasClanOverride,
  chatHint,
  groupMenuBanner,
  cocTag,
  clanRole,
  profilesCount,
}) {
  const hint = chatHint ? `\n\n📍 <i>${escapeHtml(chatHint)}</i>` : '';
  const banner = groupMenuBanner ? groupMenuBanner : '';
  const villaggio = cocTag
    ? `\n🎯 Profilo: <code>${escapeHtml(cocTag)}</code>${clanRole ? ` · ${escapeHtml(clanRole)}` : ''}`
    : '';
  const multi =
    Number(profilesCount) > 1
      ? `\n👤 Profili CoC: <b>${Number(profilesCount)}</b> — Account → «Profili CoC» per cambiare`
      : '';
  if (!clanTag) {
    return (
      `⚔️ <b>CoCBoard</b>\n` +
      `${DIV2}\n` +
      `👤 <b>${escapeHtml(displayName || 'Giocatore')}</b>${villaggio}${multi}\n` +
      `${DIV}\n\n` +
      `⚠️ <b>Nessun clan</b> collegato al profilo.\n\n` +
      `• Entra in un clan in game, oppure\n` +
      `• Imposta un tag: <code>/setclan #TAG</code>\n\n` +
      `Poi sblocchi: membri, CWL, bonus, guerre.` +
      hint +
      banner
    );
  }
  const src = hasClanOverride ? '\n📌 <i>Clan da /setclan (override)</i>' : '\n📌 <i>Clan dal profilo villaggio</i>';
  return (
    `⚔️ <b>CoCBoard</b>\n` +
    `${DIV2}\n` +
    `👤 <b>${escapeHtml(displayName || 'Giocatore')}</b>${villaggio}${multi}\n` +
    `🏠 <b>${escapeHtml(clanName || clanTag)}</b>\n` +
    `<code>${escapeHtml(clanTag)}</code>${src}\n` +
    `${DIV}\n` +
    hint +
    banner
  );
}

/** Menù ospite in gruppo/canale COLLEGATO a un clan (nessun login). */
function formatLinkedGroupGuestIntro({ clanTag, clanName, botUsername }) {
  const privUrl = botUsername ? `https://t.me/${String(botUsername).replace(/^@/, '')}` : '';
  const loginHint = privUrl
    ? `\n\n🔐 Per <b>Bonus</b> e <b>versione web</b>: <a href="${privUrl}">accedi in privato</a>.`
    : '\n\n🔐 Per Bonus e versione web: accedi in chat privata con il bot.';
  return (
    `⚔️ <b>CoCBoard</b>\n` +
    `${DIV2}\n` +
    `🏠 <b>${escapeHtml(clanName || clanTag)}</b>\n` +
    `└ Tag <code>${escapeHtml(clanTag)}</code>\n` +
    `${DIV}\n\n` +
    `📖 Dati clan pubblici — scegli una sezione.` +
    loginHint
  );
}

function formatTutorialStep(step) {
  if (step === 1) {
    return (
      `📚 <b>Tutorial 1/3 — Menù e Community</b>\n\n` +
      `In alto nel menù trovi <b>Community</b> (chat globale + reclutamento), poi <b>Cerca</b> e <b>Classifica</b>.\n` +
      `Sotto, se hai un clan: <b>Membri</b>, <b>CWL</b>, <b>Bonus</b>, <b>Profilo</b>.\n` +
      `I pulsanti <b>(web)</b> aprono la Mini App: <b>non devi rifare il login</b> se hai già usato <b>Accedi</b> sul bot — la sessione resta sul telefono.\n\n` +
      `<i><code>/skip</code> per saltare.</i>`
    );
  }
  if (step === 2) {
    return (
      `📚 <b>Tutorial 2/3 — Chat globale</b>\n\n` +
      `In stanza, chi usa il profilo CoCBoard ha il simbolo <b>✅</b> accanto al nome.\n` +
      `Per uscire dalla stanza: <b>Esci</b>, oppure <code>/start</code>, <code>/cocboard</code>, un altro comando <code>/</code>, o il pulsante <b>Menù</b> — ricevi un avviso e non ricevi più i messaggi della stanza.\n\n` +
      `<i><code>/skip</code> per saltare.</i>`
    );
  }
  return (
    `📚 <b>Tutorial 3/3 — Gruppo e account</b>\n\n` +
      `Nel <b>gruppo Telegram</b> servono Capo/Co-Capo/Admin che colleghino la chat con il bot (<code>/linkclan</code>).\n` +
      `Password e chiavi API <b>solo in privato</b> con il bot.\n\n` +
      `📖 <code>/help</code> · <b>Logout</b> nel menù.\n\n` +
      `Tocca <b>Apri menù</b> o <code>/skip</code>.`
  );
}

function formatClanInfo(info) {
  const lines = [
    `${DIV}\n🏰 <b>Scheda clan</b>\n${DIV}`,
    `<b>${escapeHtml(info.name || 'Clan')}</b> <code>${escapeHtml(info.tag || '')}</code>`,
    `${DIV2}`,
    `📊 Livello clan · <b>${info.clanLevel ?? '—'}</b>`,
    `👥 Membri · <b>${info.members ?? '—'}</b>`,
    `⚔️ Vittorie guerra · <b>${info.warWins ?? '—'}</b>`,
    `🏆 Trofei richiesti · <b>${info.requiredTrophies ?? '—'}</b>`,
  ];
  if (info.warLeague?.name) lines.push(`🛡️ Lega guerra · <b>${escapeHtml(info.warLeague.name)}</b>`);
  if (info.description) {
    lines.push('');
    lines.push(`📝 <b>Descrizione</b>\n<i>${escapeHtml(info.description.slice(0, 420))}</i>`);
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
    const roleIt = m.role ? ` · ${mapCoCRoleToItalian(m.role)}` : '';
    return `${m.clanRank ?? '—'}. ${escapeHtml(m.name)} — ${th} | ${m.trophies ?? 0}🏆${roleIt}`;
  });
  const head =
    `${DIV}\n👥 <b>Elenco membri</b>\n${DIV}\n` +
    `<code>${escapeHtml(clanTagHint || '')}</code>\n` +
    `📄 Pag. <b>${p + 1}</b>/<b>${pages}</b> · <b>${total}</b> membri\n` +
    `${DIV2}\n` +
    `<i># · Nome — TH | Trofei | ruolo</i>`;
  return { text: `${head}\n\n${lines.join('\n')}`, page: p, pages };
}

const CWL_PLAYERS_PER_PAGE = 8;

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
    `<i>Stelle attacco + 10⭐ per vittoria di turno · poi distruzione.</i>`,
    '',
  ];
  gs.forEach((c, i) => {
    const us = data.ourPosition === i + 1 ? ' ⭐' : '';
    const nm = escapeHtml(c.name || c.tag || '—');
    const bonus = Number(c.bonusStars || 0);
    const bonusTxt = bonus > 0 ? ` · +${bonus} bonus vittorie` : '';
    const wins = Number(c.wins || 0);
    lines.push(
      `${i + 1}. ${nm}${us}\n   ${c.stars ?? 0}★ (${wins}W${bonusTxt}) · media ${cwlGroupAvgDest(c)} distruzione`
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

  const ourAtkLines = [];
  const oppAtkLines = [];
  const defMap = rd.defenderMap || {};
  const pushAttacks = (members, out) => {
    for (const m of members || []) {
      for (const a of m.attacks || []) {
        const d = defMap[a.defenderTag] || {};
        const atkNo = Number.isFinite(Number(a.order)) ? `#${Number(a.order)} ` : '';
        out.push(
          `• ${atkNo}<b>${escapeHtml(m.name || '?')}</b> → <b>${escapeHtml(d.name || a.defenderTag || '?')}</b>` +
            `\n  ⭐ ${a.stars ?? 0} · 💥 ${a.destruction ?? 0}%`
        );
      }
    }
  };
  pushAttacks(c.members, ourAtkLines);
  pushAttacks(o.members, oppAtkLines);
  const totalAttacks = ourAtkLines.length + oppAtkLines.length;
  if (totalAttacks > 0) {
    lines.push(`<b>Attacchi completi</b> · <i>${totalAttacks} azioni</i>`, '');
    if (ourAtkLines.length) {
      lines.push('📍 <b>Nostri attacchi</b>', '');
      ourAtkLines.forEach((l) => lines.push(l));
      lines.push('');
    }
    if (oppAtkLines.length) {
      lines.push('🛡️ <b>Attacchi avversari</b>', '');
      oppAtkLines.forEach((l) => lines.push(l));
    }
  } else {
    lines.push('<i>Nessun attacco registrato in questo turno.</i>');
  }
  return lines.join('\n');
}

/** 🏆 Lega: classifica gruppo (come tab Lega sul sito — solo standings). */
function formatCwlLega(data) {
  if (!data || data.state === 'notInWar') return formatCwlEmpty();
  const gs = data.groupStandings || [];
  const lines = [
    `${DIV}`,
    `🏆 <b>Classifica Lega CWL</b>`,
    `📅 <code>${escapeHtml(data.season || '—')}</code> · ${escapeHtml(data.leagueNameIt || data.leagueNameEn || 'Lega')}`,
    `${DIV}`,
    '',
  ];
  if (gs.length) {
    lines.push('<i>Tocca un clan nei pulsanti sotto per esplorarlo (come sul sito).</i>', '');
    gs.forEach((c, i) => {
      const us = data.ourPosition === i + 1 ? ' ◀' : '';
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
      const nm = escapeHtml(c.name || c.tag || '—');
      lines.push(`${medal} ${nm}${us}\n   ${c.stars ?? 0}★ · ${cwlGroupAvgDest(c)} media`);
    });
    if (data.ourPosition != null) {
      lines.push('', `📍 Nostra posizione: <b>${data.ourPosition}</b> / ${gs.length}`);
    }
  } else {
    lines.push('<i>Classifica non ancora disponibile.</i>');
  }
  return lines.join('\n');
}

/** 👁 Anteprima: composizione TH per round (come tab Anteprima sul sito). */
function formatCwlAnteprima(data, rIdx) {
  if (!data || data.state === 'notInWar') return formatCwlEmpty();
  const rounds = data.roundsData || [];
  if (!rounds.length) {
    return `${DIV}\n👁 <b>Anteprima CWL</b>\n${DIV}\n\n<i>Nessun turno disponibile.</i>`;
  }
  const idx = Math.min(Math.max(0, rIdx), rounds.length - 1);
  const rd = rounds[idx];
  const rn = rd.roundNumber ?? idx + 1;
  const c = rd.clan || {};
  const o = rd.opponent || {};

  function thComp(members) {
    if (!members?.length) return '<i>Nessun dato roster</i>';
    const counts = {};
    members.forEach((m) => {
      const lv = m.thLevel || m.townhallLevel || 0;
      if (lv) counts[lv] = (counts[lv] || 0) + 1;
    });
    const entries = Object.entries(counts).sort((a, b) => +b[0] - +a[0]);
    if (!entries.length) return '<i>Nessun dato TH</i>';
    return entries.map(([lv, n]) => `TH${lv}×${n}`).join(' · ');
  }

  const stateLabel = formatWarStateIt(rd.state);
  const lines = [
    `${DIV}`,
    `👁 <b>Anteprima · Turno ${rn}</b> / ${rounds.length} · ${stateLabel}`,
    `${DIV}`,
    '',
    `🛡️ <b>${escapeHtml(c.name || 'Noi')}</b>`,
    `   ${thComp(c.members)}`,
    `   ⭐ ${c.stars ?? 0} stelle · 💥 ${Number(c.destruction ?? 0).toFixed(1)}%`,
    '',
    `⚔️ <b>${escapeHtml(o.name || 'Avversario')}</b>`,
    `   ${thComp(o.members)}`,
    `   ⭐ ${o.stars ?? 0} stelle · 💥 ${Number(o.destruction ?? 0).toFixed(1)}%`,
  ];
  return lines.join('\n');
}

/** ⚖️ Confronto: matchup posizione-per-posizione per round (come tab Confronto sul sito). */
function formatCwlConfronto(data, rIdx) {
  if (!data || data.state === 'notInWar') return formatCwlEmpty();
  const rounds = data.roundsData || [];
  if (!rounds.length) {
    return `${DIV}\n⚖️ <b>Confronto CWL</b>\n${DIV}\n\n<i>Nessun turno disponibile.</i>`;
  }
  const idx = Math.min(Math.max(0, rIdx), rounds.length - 1);
  const rd = rounds[idx];
  const rn = rd.roundNumber ?? idx + 1;
  const c = rd.clan || {};
  const o = rd.opponent || {};
  const sortM = (arr) => [...(arr || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const us = sortM(c.members);
  const them = sortM(o.members);
  const n = Math.max(us.length, them.length);

  if (!n) {
    return `${DIV}\n⚖️ <b>Confronto · Turno ${rn}</b>\n${DIV}\n\n<i>Nessun dato roster per questo turno.</i>`;
  }

  const cName = escapeHtml((c.name || 'Noi').slice(0, 10));
  const oName = escapeHtml((o.name || 'Avv.').slice(0, 10));
  const lines = [
    `${DIV}`,
    `⚖️ <b>Confronto · Turno ${rn}</b> / ${rounds.length} · ${formatWarStateIt(rd.state)}`,
    `${DIV}`,
    `<b>🛡️ ${cName}</b> vs <b>⚔️ ${oName}</b>`,
    '',
  ];

  for (let i = 0; i < Math.min(n, 20); i++) {
    const a = us[i];
    const b = them[i];
    const thA = a ? `TH${a.thLevel || a.townhallLevel || a.townHallLevel || '?'}` : '—';
    const thB = b ? `TH${b.thLevel || b.townhallLevel || b.townHallLevel || '?'}` : '—';
    const nA = a ? escapeHtml(String(a.name || '—').slice(0, 14)) : '—';
    const nB = b ? escapeHtml(String(b.name || '—').slice(0, 14)) : '—';
    // War rank 1…N (come sul sito): non usare mapPosition grezzo (ha buchi in CWL).
    const rank = String(i + 1).padStart(2);
    const starsA = a ? (a.attacks || []).reduce((s, atk) => s + (atk.stars || 0), 0) : null;
    const starStr = starsA != null && a?.attacks?.length ? ` ${starsA}★` : '';
    lines.push(`#${rank} <b>${nA}</b> (${thA})${starStr} vs #${rank} <b>${nB}</b> (${thB})`);
  }
  if (n > 20) lines.push(`<i>… e altri ${n - 20}</i>`);

  return lines.join('\n');
}

function getCwlPlayerPageCount(data) {
  const n = (data?.players || []).length;
  return Math.max(1, Math.ceil(n / CWL_PLAYERS_PER_PAGE));
}

function getCwlRoundCount(data) {
  return Math.max(0, (data?.roundsData || []).length);
}

/** Indice 0-based del turno “attivo” (come sul sito: inWar → preparation → ultimo giocato). */
function getDefaultCwlRoundIndex(data) {
  const rounds = data?.roundsData || [];
  if (!rounds.length) return 0;
  let idx = rounds.findIndex((r) => r.state === 'inWar');
  if (idx < 0) idx = rounds.findIndex((r) => r.state === 'preparation');
  if (idx < 0) {
    let last = -1;
    for (let i = 0; i < rounds.length; i++) {
      const st = rounds[i].state;
      if (st !== 'notInWar' && st !== 'warEnded' && st !== 'ended') last = i;
    }
    if (last >= 0) idx = last;
  }
  if (idx < 0) {
    for (let i = rounds.length - 1; i >= 0; i--) {
      const st = rounds[i].state;
      if (st === 'warEnded' || st === 'ended') {
        idx = i;
        break;
      }
    }
  }
  return idx >= 0 ? idx : 0;
}

function filterClassicWarItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((w) => {
    const wt = (w.warType || '').toLowerCase();
    if (wt === 'cwl') return false;
    if (!w.opponent?.name) return false;
    const maxStars = (w.teamSize || 50) * 3;
    if ((w.clan?.stars || 0) > maxStars) return false;
    return true;
  });
}

function filterCwlWarItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((w) => {
    const wt = (w.warType || '').toLowerCase();
    const maxStars = (w.teamSize || 50) * 3;
    const isAggregated = (w.clan?.stars || 0) > maxStars;
    return (wt === 'cwl' || !w.opponent?.name || isAggregated) && w.endTime;
  });
}

function formatWarLogClassic(data) {
  const items = filterClassicWarItems(data?.items || data);
  if (!items.length) {
    return (
      `${DIV}\n🏹 <b>War classiche</b>\n${DIV}\n\n` +
        `<i>Nessuna war classica nel log, oppure il registro clan non è pubblico in CoC.</i>`
    );
  }
  const slice = items.slice(0, 10);
  const lines = slice.map((w) => {
    const c = w.clan || {};
    const o = w.opponent || {};
    const r = w.result ? String(w.result) : '';
    const icon = r === 'win' ? '✅' : r === 'lose' ? '❌' : '⚖️';
    const lbl = r === 'win' ? 'Vittoria' : r === 'lose' ? 'Sconfitta' : r === 'tie' ? 'Pareggio' : r || '—';
    return (
      `${icon} <b>${escapeHtml(lbl)}</b>\n` +
      `   └ ${escapeHtml(c.name)} <b>${c.stars ?? 0}</b>★ vs <b>${o.stars ?? 0}</b>★ ${escapeHtml(o.name)}`
    );
  });
  return (
    `${DIV}\n🏹 <b>War classiche</b> <i>(max 10)</i>\n${DIV}\n${DIV2}\n\n${lines.join('\n\n')}`
  );
}

/** Riepilogo stagioni da war-log (come tab Cronologia Leghe sul sito, versione compatta). */
function formatWarLogCwlHistory(data) {
  const raw = filterCwlWarItems(data?.items || data);
  if (!raw.length) {
    return (
      `${DIV}\n🏆 <b>Cronologia leghe (CWL)</b>\n${DIV}\n\n` +
        `<i>Nessuna guerra CWL nel log API, oppure registro non pubblico.</i>`
    );
  }
  const warSeasonMap = {};
  raw.forEach((w) => {
    const s = w.endTime.slice(0, 4) + '-' + w.endTime.slice(4, 6);
    if (!warSeasonMap[s]) {
      warSeasonMap[s] = { wins: 0, losses: 0, draws: 0, wars: 0, stars: 0 };
    }
    const ws = warSeasonMap[s];
    ws.wars++;
    if (w.result === 'win') ws.wins++;
    else if (w.result === 'lose') ws.losses++;
    else ws.draws++;
    ws.stars += w.clan?.stars || 0;
  });
  const seasons = Object.keys(warSeasonMap).sort((a, b) => b.localeCompare(a));
  const lines = seasons.slice(0, 12).map((s) => {
    const m = warSeasonMap[s];
    return (
      `📅 <b>${escapeHtml(s)}</b> · ${m.wars} war · ` +
      `✅${m.wins} ❌${m.losses} ⚖️${m.draws} · ⭐${m.stars}`
    );
  });
  return (
    `${DIV}\n🏆 <b>Cronologia leghe (CWL)</b>\n${DIV}\n` +
      `<i>Da API war-log (come sul sito). Ultime stagioni:</i>\n\n${lines.join('\n\n')}`
  );
}

/**
 * @param {'ov'|'lg'|'g'|'p'|'r'|'ant'|'cf'} view
 */
function formatCwlScreen(data, view, pPage, rIdx) {
  if (!data || data.state === 'notInWar') {
    return { text: formatCwlEmpty(), view: 'lg', pPage: 0, rIdx: 0 };
  }
  const pPages = getCwlPlayerPageCount(data);
  const rCount = getCwlRoundCount(data);
  const pClamped = Math.min(Math.max(0, pPage), pPages - 1);
  const rClamped = rCount ? Math.min(Math.max(0, rIdx), rCount - 1) : 0;
  let text;
  switch (view) {
    case 'ov':
      text = formatCwlOverview(data);
      break;
    case 'lg':
      text = formatCwlLega(data);
      break;
    case 'g': // backward compat
      text = formatCwlGroup(data);
      break;
    case 'p':
      text = formatCwlPlayersPage(data, pClamped);
      break;
    case 'r':
      text = formatCwlRoundDetail(data, rClamped);
      break;
    case 'ant':
      text = formatCwlAnteprima(data, rClamped);
      break;
    case 'cf':
      text = formatCwlConfronto(data, rClamped);
      break;
    default:
      text = formatCwlLega(data);
      view = 'lg';
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
  return formatWarLogClassic(data);
}

// ─── Registro guerre: browse + dettaglio (allineato alla web app + Supabase) ───

const WAR_LOG_CLASSIC_PAGE_SIZE = 5;
const WAR_LOG_CWL_SEASON_PAGE_SIZE = 7;

function seasonFromWarEndTime(endTime) {
  if (!endTime || endTime.length < 6) return '';
  return endTime.slice(0, 4) + '-' + endTime.slice(4, 6);
}

function normMemberTh(m) {
  return m.townhallLevel ?? m.thLevel ?? m.th_level ?? 0;
}

function parseMembersJson(maybeJson) {
  if (!maybeJson) return null;
  if (Array.isArray(maybeJson)) return maybeJson;
  if (typeof maybeJson === 'string') {
    try {
      return JSON.parse(maybeJson);
    } catch (_) {
      return null;
    }
  }
  return null;
}

/** Elenco war classiche ordinate dalla più recente (stesso filtro del sito). */
function getSortedClassicWars(data) {
  const items = filterClassicWarItems(data?.items || data);
  return items.sort((a, b) => (b.endTime || '').localeCompare(a.endTime || ''));
}

function formatWarLogDateIt(endTime) {
  if (!endTime) return '—';
  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(endTime);
  if (!m) return '—';
  const mo = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const mi = Number(m[2]) - 1;
  return `${Number(m[3])} ${mo[mi] ?? m[2]} ${m[1]}`;
}

function formatWarLogDateShort(endTime) {
  if (!endTime) return '—';
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(endTime);
  if (!m) return '—';
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}

function buildDefMapFromSides(clanMembers, oppMembers) {
  const defMap = {};
  const add = (members) => {
    for (const m of members || []) {
      if (m?.tag) defMap[m.tag] = { name: m.name, pos: m.mapPosition };
    }
  };
  add(clanMembers);
  add(oppMembers);
  return defMap;
}

function buildDefMapForClassicWar(w, enriched) {
  let clanM = w.clan?.members;
  let oppM = w.opponent?.members;
  if (enriched) {
    const om = parseMembersJson(enriched.our_members);
    const pm = parseMembersJson(enriched.opp_members);
    if (om?.length) clanM = om;
    if (pm?.length) oppM = pm;
  }
  return buildDefMapFromSides(clanM, oppM);
}

function formatClassicMemberAttacksPre(m, defMap, atkPer) {
  const attacks = [...(m.attacks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const lines = [];
  const th = normMemberTh(m);
  lines.push(`#${String(m.mapPosition ?? '?').padStart(2, ' ')} ${String(m.name || '—').slice(0, 18)}  TH${th}`);
  for (let i = 0; i < atkPer; i++) {
    const a = attacks[i];
    if (!a) {
      lines.push(`  Att${i + 1}: non usato`);
      continue;
    }
    const def = defMap[a.defenderTag];
    const defL = def ? `#${def.pos} ${def.name}` : String(a.defenderTag || '?');
    lines.push(
      `  Att${i + 1} → ${defL}: ${a.stars ?? 0}★ ${(a.destructionPercentage ?? 0).toFixed(0)}%`
    );
  }
  return lines.join('\n');
}

/**
 * Dettaglio war classica (HTML) — dati API + override Supabase se presenti.
 * @param {object} w — item war-log API
 * @param {object|null} enriched — riga classic_wars o null
 */
function formatClassicWarDetailHtml(w, enriched) {
  const atkPer = enriched?.atk_per_member ?? w.attacksPerMember ?? 2;
  const teamSize = enriched?.team_size ?? w.teamSize ?? '?';
  const fmtDate = formatWarLogDateIt(w.endTime);
  const res = w.result ? String(w.result) : '';
  const resLabel = res === 'win' ? 'VITTORIA' : res === 'lose' ? 'SCONFITTA' : res === 'tie' ? 'PAREGGIO' : (res || '—').toUpperCase();

  const cName = w.clan?.name ?? enriched?.our_name ?? 'Noi';
  const oName = w.opponent?.name ?? enriched?.opp_name ?? 'Avversario';
  const cStars = w.clan?.stars ?? enriched?.our_stars ?? 0;
  const oStars = w.opponent?.stars ?? enriched?.opp_stars ?? 0;
  const cDest = Number(w.clan?.destructionPercentage ?? enriched?.our_destr ?? 0).toFixed(1);
  const oDest = Number(w.opponent?.destructionPercentage ?? enriched?.opp_destr ?? 0).toFixed(1);

  const defMap = buildDefMapForClassicWar(w, enriched);
  let clanM = parseMembersJson(enriched?.our_members) ?? w.clan?.members;
  let oppM = parseMembersJson(enriched?.opp_members) ?? w.opponent?.members;

  const hasDetail = (clanM?.length || 0) + (oppM?.length || 0) > 0;
  const savedNote = enriched
    ? '<i>📦 Dati completi da salvataggio CoCBoard.</i>\n'
    : '<i>⚠️ Salvataggio dettagliato non disponibile: mostriamo solo il riepilogo API. Sul sito il salvataggio è automatico dopo la war.</i>\n';

  const parts = [
    `${DIV}\n🏹 <b>War classica</b> · ${escapeHtml(fmtDate)}\n${DIV}\n`,
    savedNote,
    `<b>${escapeHtml(resLabel)}</b> · <b>${teamSize}v${teamSize}</b> · ${atkPer} att/gioc.\n`,
    `🛡 <b>${escapeHtml(cName)}</b> ⭐${cStars} · 💥${cDest}%\n`,
    `⚔️ <b>${escapeHtml(oName)}</b> ⭐${oStars} · 💥${oDest}%\n`,
  ];

  if (!hasDetail) {
    parts.push('\n<i>Nessun roster/attacchi nel dato disponibile.</i>');
    return parts.join('');
  }

  const sortM = (arr) => [...(arr || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const ourBlock = sortM(clanM)
    .map((m) => formatClassicMemberAttacksPre(m, defMap, atkPer))
    .join('\n\n');
  const oppBlock = sortM(oppM)
    .map((m) => formatClassicMemberAttacksPre(m, defMap, atkPer))
    .join('\n\n');

  parts.push('\n<b>━━ La nostra squadra ━━</b>\n\n');
  parts.push(telegramHtmlPlainBlock(ourBlock) + '\n');
  parts.push('\n<b>━━ ' + escapeHtml(oName) + ' ━━</b>\n\n');
  parts.push(telegramHtmlPlainBlock(oppBlock));

  return parts.join('');
}

function formatWarLogClassicListPage(itemsSorted, page) {
  const n = itemsSorted.length;
  const totalPages = Math.max(1, Math.ceil(n / WAR_LOG_CLASSIC_PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const start = p * WAR_LOG_CLASSIC_PAGE_SIZE;
  const slice = itemsSorted.slice(start, start + WAR_LOG_CLASSIC_PAGE_SIZE);

  let body = `${DIV}\n🏹 <b>War classiche</b>\n${DIV}\n\n`;
  body +=
    '<i>Tocca un pulsante per il dettaglio (stessi dati del sito: attacchi e roster se salvati su CoCBoard).</i>\n\n';
  if (!n) {
    body += '<i>Nessuna war classica nel log, oppure registro non pubblico in CoC.</i>';
    return body;
  }
  body += `<i>Elenco ${n} guerre · pag. ${p + 1}/${totalPages}</i>\n\n`;
  for (let i = 0; i < slice.length; i++) {
    const w = slice[i];
    const gIdx = start + i + 1;
    const ic = w.result === 'win' ? '✅' : w.result === 'lose' ? '❌' : '⚖️';
    const ds = formatWarLogDateIt(w.endTime);
    body +=
      `${gIdx}. ${ic} <b>${escapeHtml(ds)}</b> · ⭐${w.clan?.stars ?? 0}–${w.opponent?.stars ?? 0} · ` +
      `<b>${escapeHtml((w.opponent?.name || '—').slice(0, 36))}</b>\n`;
  }
  return body;
}

/** Unisce stagioni CWL da API war-log e da cwl_wars (DB). */
function mergeCwlSeasonBrowseData(warLogApiData, dbSeasonsList) {
  const summaries = {};
  const raw = filterCwlWarItems(warLogApiData?.items || []);
  for (const w of raw) {
    const s = seasonFromWarEndTime(w.endTime);
    if (!s) continue;
    if (!summaries[s]) summaries[s] = { wins: 0, losses: 0, draws: 0, wars: 0, stars: 0 };
    const ws = summaries[s];
    ws.wars++;
    if (w.result === 'win') ws.wins++;
    else if (w.result === 'lose') ws.losses++;
    else ws.draws++;
    ws.stars += w.clan?.stars || 0;
  }
  for (const s of dbSeasonsList || []) {
    if (!summaries[s]) summaries[s] = { wins: 0, losses: 0, draws: 0, wars: 0, stars: 0 };
  }
  const seasonsSorted = Object.keys(summaries).sort((a, b) => b.localeCompare(a));
  return { seasonsSorted, summariesBySeason: summaries };
}

const CWL_LOG_PLAYERS_PAGE_SIZE = 8;

/** Normalizza tag clan per confronto (come sul sito). */
function normClanTagFmt(tag) {
  if (!tag) return '';
  const t = String(tag).trim().toUpperCase();
  return t.startsWith('#') ? t : `#${t}`;
}

function buildCwlSeasonListButtonLabel(season, metaRow, summary) {
  const stars = metaRow?.stars != null ? metaRow.stars : summary?.stars ?? 0;
  const posLabel =
    metaRow?.position != null && metaRow.position !== ''
      ? `${Number(metaRow.position)}°`
      : '—';
  const league = metaRow?.league ? String(metaRow.league).slice(0, 22) : '—';
  let s = `📅 ${season} · ${posLabel} · ${league} · ⭐${stars}`;
  if (s.length > 64) s = `${s.slice(0, 61)}…`;
  return s;
}

/**
 * @param {Record<string, object>} metaBySeason — da cwl_seasons (chiave YYYY-MM)
 */
function formatWarLogCwlSeasonListPage(seasonsSorted, summariesBySeason, page, metaBySeason) {
  const n = seasonsSorted.length;
  const totalPages = Math.max(1, Math.ceil(n / WAR_LOG_CWL_SEASON_PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const start = p * WAR_LOG_CWL_SEASON_PAGE_SIZE;
  const slice = seasonsSorted.slice(start, start + WAR_LOG_CWL_SEASON_PAGE_SIZE);

  let body = `${DIV}\n🏆 <b>Cronologia leghe (CWL)</b>\n${DIV}\n\n`;
  body +=
    '<i>Scegli una stagione: Lega, Player e Turni (dati salvati su CoCBoard quando disponibili).</i>\n\n';
  if (!n) {
    body += '<i>Nessuna stagione CWL nel log API né in archivio salvato.</i>';
    return body;
  }
  body += `<i>${n} stagion${n === 1 ? 'e' : 'i'} · pag. ${p + 1}/${totalPages}</i>\n\n`;
  for (let i = 0; i < slice.length; i++) {
    const s = slice[i];
    const m = summariesBySeason[s] || { wins: 0, losses: 0, draws: 0, wars: 0, stars: 0 };
    const metaRow = metaBySeason?.[s] || null;
    const stars = metaRow?.stars != null ? metaRow.stars : m.stars;
    const posLabel =
      metaRow?.position != null && metaRow.position !== ''
        ? `${Number(metaRow.position)}°`
        : '—';
    const league = metaRow?.league ? escapeHtml(String(metaRow.league)) : '—';
    body += `📅 <b>${escapeHtml(s)}</b> · ${posLabel} · ${league} · ⭐${stars}\n`;
  }
  return body;
}

/** Distruzione “totale” in stile CoCBoard (stesso criterio della salvataggio in cwl_seasons). */
function cwlGroupStandingTotalDestruction(c) {
  const td = Number(c.totalDestr) || 0;
  const ts = Number(c.teamSize) || 15;
  return Math.round(td * ts);
}

function parseGroupStandingsJson(metaRow) {
  if (!metaRow) return null;
  const raw = metaRow.group_standings ?? metaRow.groupStandings;
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function parseRosterJson(metaRow) {
  if (!metaRow) return null;
  const raw = metaRow.roster;
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function formatCwlSeasonHubHtml(season, metaRow, summary) {
  const stars = metaRow?.stars != null ? metaRow.stars : summary?.stars ?? 0;
  const posLabel =
    metaRow?.position != null && metaRow.position !== ''
      ? `${Number(metaRow.position)}°`
      : '—';
  const league = metaRow?.league ? escapeHtml(String(metaRow.league)) : '—';
  const parts = [
    `${DIV}\n🏆 <b>CWL ${escapeHtml(season)}</b>\n${DIV}\n`,
    `<b>${posLabel}</b> in classifica · <b>${league}</b> · ⭐<b>${stars}</b>\n\n`,
    '<i>Scegli cosa visualizzare:</i>',
  ];
  return parts.join('');
}

function formatCwlLeagueStandingsHtml(groupStandings, ourClanTag) {
  const us = normClanTagFmt(ourClanTag);
  if (!groupStandings?.length) {
    return '<i>Classifica di gruppo non disponibile per questa stagione (salvataggio incompleto).</i>';
  }
  const sorted = [...groupStandings].sort((a, b) => {
    if ((b.stars ?? 0) !== (a.stars ?? 0)) return (b.stars ?? 0) - (a.stars ?? 0);
    const bd = cwlGroupStandingTotalDestruction(b);
    const ad = cwlGroupStandingTotalDestruction(a);
    return bd - ad;
  });
  const lines = [];
  lines.push('<b>Classifica gruppo</b>\n');
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    const mark = normClanTagFmt(c.tag) === us ? '➤ ' : '';
    const name = escapeHtml(String(c.name || '—').slice(0, 28));
    const dest = cwlGroupStandingTotalDestruction(c);
    lines.push(`${medal} ${mark}<b>${name}</b>`);
    lines.push(`   ⭐ ${c.stars ?? 0} · 💥 ${dest} <i>(tot.)</i>`);
  }
  return lines.join('\n');
}

function formatCwlPlayersLogHtml(players, page) {
  if (!players?.length) {
    return '<i>Elenco giocatori non disponibile per questa stagione (salvataggio roster sul sito).</i>';
  }
  const sorted = [...players].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
  const totalPages = Math.max(1, Math.ceil(sorted.length / CWL_LOG_PLAYERS_PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const start = p * CWL_LOG_PLAYERS_PAGE_SIZE;
  const slice = sorted.slice(start, start + CWL_LOG_PLAYERS_PAGE_SIZE);

  let body = `<b>Giocatori</b> <i>(${sorted.length} · pag. ${p + 1}/${totalPages})</i>\n\n`;
  for (let i = 0; i < slice.length; i++) {
    const pl = slice[i];
    const idx = start + i + 1;
    const th = pl.th_level ?? pl.thLevel ?? '?';
    const avg =
      pl.attacks_made > 0
        ? `${(Number(pl.destruction) / pl.attacks_made).toFixed(1)}%`
        : '—';
    const nm = escapeHtml(String(pl.name || '—').slice(0, 22));
    body += `${idx}. TH${th} <b>${nm}</b>\n`;
    body += `   ⭐ ${pl.stars ?? 0} · 💥 ${avg} · ⚔ ${pl.attacks_made ?? 0}/${pl.attacks_required ?? 1}\n`;
  }
  return body;
}

/** Esito turno CWL dal punto di vista del clan salvato (campo result in cwl_wars). */
function formatCwlRoundOutcomeHtml(row) {
  const r = String(row?.result || '').toLowerCase();
  if (r === 'win') return '✅ <b>Vittoria</b>';
  if (r === 'lose') return '❌ <b>Sconfitta</b>';
  if (r === 'tie' || r === 'draw') return '⚖️ <b>Pareggio</b>';
  if (r === 'preparation') return '🛡 <i>Preparazione</i>';
  if (r === 'ongoing') return '⚔️ <i>In corso</i>';
  if (!row?.result) return '<i>Esito —</i>';
  return `<i>Esito: ${escapeHtml(String(row.result))}</i>`;
}

function formatCwlTurnsOverviewHtml(dbWarsRows) {
  const rows = [...(dbWarsRows || [])].sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
  if (!rows.length) {
    return '<i>Nessun turno salvato.</i>';
  }
  let body = '<b>Turni</b> — scegli un turno per i dettagli attacchi.\n\n';
  for (const row of rows) {
    const rn = row.round ?? '?';
    const opp = escapeHtml(String(row.opp_name || '—').slice(0, 26));
    body += `⚔ <b>T${rn}</b> vs ${opp}\n`;
    body += `   ${formatCwlRoundOutcomeHtml(row)}\n`;
    body += `   ⭐ ${row.our_stars ?? 0}–${row.opp_stars ?? 0} · 💥 ${Number(row.our_destr ?? 0).toFixed(1)}% — ${Number(row.opp_destr ?? 0).toFixed(1)}%\n\n`;
  }
  return body;
}

function formatCwlAttackLinesForMember(m, defMap, atkPer) {
  const attacks = [...(m.attacks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const lines = [];
  const th = normMemberTh(m);
  lines.push(`#${String(m.mapPosition ?? '?').padStart(2, ' ')} ${String(m.name || '—').slice(0, 18)}  TH${th}`);
  for (let i = 0; i < atkPer; i++) {
    const a = attacks[i];
    if (!a) {
      lines.push(`  Att${i + 1}: non usato`);
      continue;
    }
    const def = defMap[a.defenderTag];
    const defL = def ? `#${def.pos} ${def.name}` : String(a.defenderTag || '?');
    const dp = Number(a.destructionPercentage ?? a.destruction ?? 0);
    lines.push(`  Att${i + 1} → ${defL}: ${a.stars ?? 0}★ ${dp.toFixed(0)}%`);
  }
  return lines.join('\n');
}

function formatCwlRoundSideAttacksHtml(sideMembers, defMap, atkPer, title) {
  const sortM = (arr) => [...(arr || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const arr = sortM(sideMembers);
  if (!arr.length) {
    return `<i>${escapeHtml(title)}: nessun dato.</i>`;
  }
  const block = arr.map((m) => formatCwlAttackLinesForMember(m, defMap, atkPer)).join('\n\n');
  return `<b>${escapeHtml(title)}</b>\n\n${telegramHtmlPlainBlock(block)}`;
}

/** Header compatto per scelta lato (turno salvato in cwl_wars). */
function formatCwlSavedRoundBridgeHtml(row) {
  if (!row) return '<i>Turno non trovato.</i>';
  const opp = escapeHtml(String(row.opp_name || '—').slice(0, 28));
  return (
    `⚔️ <b>Turno ${row.round ?? '?'}</b> vs <b>${opp}</b>\n` +
    `${formatCwlRoundOutcomeHtml(row)}\n` +
    `⭐ ${row.our_stars ?? 0}–${row.opp_stars ?? 0} · 💥 ${Number(row.our_destr ?? 0).toFixed(1)}% — ${Number(row.opp_destr ?? 0).toFixed(1)}%\n\n` +
    `<i>Scegli il lato:</i>`
  );
}

/** Dettaglio attacchi un lato per riga cwl_wars (usa stesso defMap del sito). */
function formatCwlSavedRoundSideHtml(row, side /* 'us' | 'op' */) {
  if (!row) return '<i>Turno non trovato.</i>';
  const atkPer = 1;
  const defMap = buildDefMapFromCwlRoundRow(row);
  const clanM = parseMembersJson(row.our_members);
  const oppM = parseMembersJson(row.opp_members);
  if (side === 'us') {
    return formatCwlRoundSideAttacksHtml(clanM, defMap, atkPer, 'Il mio clan');
  }
  return formatCwlRoundSideAttacksHtml(oppM, defMap, atkPer, 'Clan avversario');
}

function getCwlPlayersLogPageCount(players) {
  const n = (players || []).length;
  return Math.max(1, Math.ceil(n / CWL_LOG_PLAYERS_PAGE_SIZE));
}

function cwlResultLabelIt(r) {
  const x = String(r || '').toLowerCase();
  if (x === 'win') return 'Vittoria';
  if (x === 'lose') return 'Sconfitta';
  if (x === 'tie' || x === 'draw') return 'Pareggio';
  return r || '—';
}

function buildDefMapFromCwlRoundRow(row) {
  const clanM = parseMembersJson(row.our_members);
  const oppM = parseMembersJson(row.opp_members);
  let defMap = buildDefMapFromSides(clanM, oppM);
  const dm = row.defender_map;
  if (dm && typeof dm === 'object') {
    defMap = { ...defMap };
    for (const [tag, info] of Object.entries(dm)) {
      if (!defMap[tag] && info) {
        defMap[tag] = { name: info.name || info.n, pos: info.mapPosition ?? info.pos };
      }
    }
  }
  return defMap;
}

function formatCwlRoundBlockHtml(r, defMap, atkPer) {
  const sortM = (arr) => [...(arr || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const our = sortM(r.clan.members);
  const opp = sortM(r.opponent.members);
  if (!our.length && !opp.length) {
    return '<i>Nessun roster nel dato — solo punteggio aggregato.</i>\n';
  }
  const oName = r.opponent.name || 'Avversario';
  const ourTxt = our.map((m) => formatClassicMemberAttacksPre(m, defMap, atkPer)).join('\n\n');
  const oppTxt = opp.map((m) => formatClassicMemberAttacksPre(m, defMap, atkPer)).join('\n\n');
  let out = '<b>━━ La nostra squadra ━━</b>\n\n';
  out += our.length ? telegramHtmlPlainBlock(ourTxt) + '\n' : '<i>—</i>\n';
  out += '\n<b>━━ ' + escapeHtml(oName) + ' ━━</b>\n\n';
  out += opp.length ? telegramHtmlPlainBlock(oppTxt) : '<i>—</i>';
  return out;
}

/**
 * Dettaglio stagione CWL: turni da cwl_wars se presenti, altrimenti solo API aggregate.
 */
function formatCwlSeasonDetailHtml(season, warLogApiData, dbWarsRows, seasonMeta) {
  const lines = [`${DIV}\n🏆 <b>CWL ${escapeHtml(season)}</b>\n${DIV}\n`];

  if (seasonMeta?.league) {
    lines.push(
      `Lega: <b>${escapeHtml(String(seasonMeta.league))}</b>` +
        (seasonMeta.position != null ? ` · Posizione gruppo: <b>${escapeHtml(String(seasonMeta.position))}</b>` : '') +
        '\n\n'
    );
  }

  const dbSorted = [...(dbWarsRows || [])].sort((a, b) => (a.round ?? 0) - (b.round ?? 0));

  if (dbSorted.length) {
    lines.push('<i>📦 Turni con dettaglio da salvataggio CoCBoard.</i>\n\n');
    for (const row of dbSorted) {
      const atkPer = 1;
      const defMap = buildDefMapFromCwlRoundRow(row);
      const r = {
        roundNumber: row.round,
        result: row.result,
        clan: {
          stars: row.our_stars ?? 0,
          destruction: Number(row.our_destr ?? 0),
          members: parseMembersJson(row.our_members),
        },
        opponent: {
          name: row.opp_name || 'Avversario',
          stars: row.opp_stars ?? 0,
          destruction: Number(row.opp_destr ?? 0),
          members: parseMembersJson(row.opp_members),
        },
      };
      const lbl = cwlResultLabelIt(r.result);
      lines.push(`━━ <b>Turno ${r.roundNumber}</b> · ${escapeHtml(lbl)} ━━\n`);
      lines.push(
        `vs <b>${escapeHtml(r.opponent.name)}</b> · ⭐ ${r.clan.stars}–${r.opponent.stars} · ` +
          `💥 ${r.clan.destruction.toFixed(1)}% — ${r.opponent.destruction.toFixed(1)}%\n\n`
      );
      lines.push(formatCwlRoundBlockHtml(r, defMap, atkPer));
      lines.push('\n');
    }
    return lines.join('');
  }

  // Fallback: solo war-log API (senza membri)
  const raw = filterCwlWarItems(warLogApiData?.items || []);
  const filtered = raw.filter((w) => seasonFromWarEndTime(w.endTime) === season);
  filtered.sort((a, b) => (a.endTime || '').localeCompare(b.endTime || ''));
  if (!filtered.length) {
    lines.push('<i>Nessun dato per questa stagione (né API né archivio).</i>');
    return lines.join('');
  }
  lines.push('<i>Solo riepilogo da API war-log (nessun salvataggio turni su CoCBoard per questa stagione).</i>\n\n');
  filtered.forEach((w, i) => {
    const lbl = cwlResultLabelIt(w.result);
    lines.push(
      `━━ <b>Turno ${i + 1}</b> · ${escapeHtml(lbl)} ━━\n` +
        `vs <b>${escapeHtml(w.opponent?.name || '—')}</b> · ⭐ ${w.clan?.stars ?? 0}–${w.opponent?.stars ?? 0} · ` +
        `💥 ${Number(w.clan?.destructionPercentage ?? 0).toFixed(1)}% — ${Number(w.opponent?.destructionPercentage ?? 0).toFixed(1)}%\n\n`
    );
  });
  return lines.join('');
}

function formatAddBotToGroupHelp({ botUsername, clanTag, linkToken }) {
  const u = botUsername ? `@${String(botUsername).replace(/^@/, '')}` : 'il bot';
  const tagLine = clanTag ? `\n🏷 <b>Clan:</b> <code>${escapeHtml(clanTag)}</code>\n` : '';
  const tokBlock = linkToken
    ? `\n${DIV2}\n` +
      `📋 <b>Copia e incolla nel gruppo:</b>\n\n` +
      `<code>/linkclan ${escapeHtml(linkToken)}</code>\n\n` +
      `<i><b>Clicca per copiare</b> il comando qui sopra, poi incollalo nella chat del gruppo/canale.</i>\n` +
      `<i>Token valido ≈1 ora, un solo uso.</i>\n`
    : '';
  return (
    `${DIV}\n➕ <b>Collegare il bot a gruppo / canale</b>\n${DIV}\n` +
    tagLine +
    `\n<b>Passi</b>\n` +
    `1️⃣ Aggiungi ${u} al gruppo o canale e rendilo <b>amministratore</b>.\n` +
    `2️⃣ Copia il comando qui sotto e incollalo <b>in quella chat</b>.\n` +
    `3️⃣ Il bot elimina il messaggio e conferma il collegamento.\n` +
    `4️⃣ Tutti nel gruppo potranno consultare membri, CWL e guerre.\n` +
    `5️⃣ Massimo <b>3</b> gruppi/canali collegati per lo stesso clan.\n` +
    tokBlock +
    `\n<i>Per scollegare (solo leader):</i> <code>/unlinkclan</code> <i>nel gruppo.</i>`
  );
}

const MONTHS_IT = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
];

/** season 'YYYY-MM' o 'YYYY-MM-DD' → Stagione aprile '26 */
function formatSeasonLabelIt(season) {
  if (!season || typeof season !== 'string') return '—';
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(season.trim());
  if (full) {
    const y = Number(full[1]);
    const mo = Number(full[2]);
    const day = Number(full[3]);
    if (mo < 1 || mo > 12) return escapeHtml(season);
    const yy = String(y).slice(-2);
    return `Stagione ${day} ${MONTHS_IT[mo - 1]} '${yy}`;
  }
  const m = /^(\d{4})-(\d{2})$/.exec(season.trim());
  if (!m) return escapeHtml(season);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return escapeHtml(season);
  const yy = String(y).slice(-2);
  return `Stagione ${MONTHS_IT[mo - 1]} '${yy}`;
}

function rowReceivedBonus(h) {
  return h.bonus_assigned === true;
}

/** Testi aggiuntivi per bonus Telegram: storico per stagione + classifica riceventi. */
function formatBonusHistoryBySeason(historyRows, maxSeasons = 14) {
  const rows = (historyRows || []).filter(rowReceivedBonus);
  if (!rows.length) {
    return `${DIV2}\n📅 <b>Storico bonus per stagione</b>\n\n<i>Nessun dato in cwl_history per questo clan.</i>`;
  }
  const bySeason = new Map();
  for (const h of rows) {
    const s = h.season;
    if (!s) continue;
    if (!bySeason.has(s)) bySeason.set(s, []);
    bySeason.get(s).push(h);
  }
  const seasons = [...bySeason.keys()].sort((a, b) => b.localeCompare(a)).slice(0, maxSeasons);
  const parts = [`${DIV2}\n📅 <b>Storico bonus (per stagione)</b>\n`];
  for (const s of seasons) {
    const list = bySeason.get(s) || [];
    const lines = list
      .slice()
      .sort((a, b) => (b.bonus_score ?? 0) - (a.bonus_score ?? 0))
      .map((h) => {
        const sc = h.bonus_score != null ? h.bonus_score : '—';
        const asg = h.bonus_assigned ? ' ✓' : '';
        return `   • ${escapeHtml(h.player_name)} — bonus <b>${sc}</b>${asg}`;
      });
    parts.push(`\n<b>${formatSeasonLabelIt(s)}</b>\n${lines.join('\n')}`);
  }
  return parts.join('\n');
}

function formatBonusReceiversLeaderboard(historyRows, topN = 18) {
  const rows = (historyRows || []).filter(rowReceivedBonus);
  if (!rows.length) {
    return `${DIV2}\n🏆 <b>Chi ha ricevuto più bonus</b>\n\n<i>Nessun dato.</i>`;
  }
  const agg = new Map();
  for (const h of rows) {
    const name = h.player_name || '—';
    if (!agg.has(name)) agg.set(name, { count: 0, seasons: new Set() });
    const o = agg.get(name);
    o.count += 1;
    if (h.season) o.seasons.add(h.season);
  }
  const sorted = [...agg.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, topN);
  const lines = sorted.map(([name, o], i) => {
    const when = [...o.seasons].sort((a, b) => b.localeCompare(a)).slice(0, 8).map(formatSeasonLabelIt).join(', ');
    return `${i + 1}. <b>${escapeHtml(name)}</b> — <b>${o.count}</b> volte\n   └ ${when || '—'}`;
  });
  return `${DIV2}\n🏆 <b>Classifica riceventi bonus</b>\n\n<i>Colonna «quando»: stagioni in cui risulta bonus (da storico).</i>\n\n${lines.join('\n\n')}`;
}

function formatBonusesPage(rows, page, clanTagHint) {
  if (!rows || !rows.length) {
    return {
      text:
        `${DIV}\n🎁 <b>Bonus CWL</b>\n${DIV}\n\n` +
        `<i>Nessun bonus salvato per questo clan.\n` +
        `Vengono calcolati dalla dashboard CoCBoard (admin).</i>`,
      page: 0,
      pages: 1,
    };
  }
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / BONUS_PER_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = rows.slice(p * BONUS_PER_PAGE, (p + 1) * BONUS_PER_PAGE);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = slice.map((r, i) => {
    const absRank = p * BONUS_PER_PAGE + i + 1;
    const medal = absRank <= 3 ? `${medals[absRank - 1]} ` : '';
    const flag = r.received_last_month ? '\n   └ <i>🔁 Bonus già assegnato il mese scorso</i>' : '';
    return `${medal}<b>#${r.rank ?? absRank}</b> ${escapeHtml(r.name)}\n   └ Punteggio merito <b>${r.score ?? 0}</b>${flag}`;
  });
  const head =
    `${DIV}\n🎁 <b>Ranking bonus CWL</b>\n${DIV}\n` +
    `🏷 <code>${escapeHtml(clanTagHint || '')}</code>\n` +
    `📄 Pagina <b>${p + 1}</b> / <b>${pages}</b> · <b>${total}</b> giocatori\n` +
    `${DIV2}`;
  return { text: `${head}\n\n${lines.join('\n\n')}`, page: p, pages };
}

/** Compat: prima pagina sola. */
function formatBonuses(rows) {
  return formatBonusesPage(rows || [], 0, '').text;
}

function formatRankings(data, rankType, areaLabel) {
  const items = (data && data.items) || [];
  if (!items.length) {
    return `${DIV}\n📊 <b>Classifica</b>\n${DIV}\n\n<i>Nessun dato (API CoC vuota o errore).</i>`;
  }
  const isPlayer = rankType === 'players' || rankType === 'players-builder-base';
  const head =
    `${DIV}\n📊 <b>Classifica · ${isPlayer ? 'Giocatori' : 'Clan'}</b>\n${DIV}\n` +
    `🌍 <b>${escapeHtml(areaLabel)}</b>\n` +
    `${DIV2}\n` +
    `<i>Fonte: API Clash of Clans · max ${RANKINGS_SHOWN}</i>\n`;
  const slice = items.slice(0, RANKINGS_SHOWN);
  const lines = slice.map((it) => {
    const rk = it.rank ?? '—';
    if (isPlayer) {
      const cn = it.clan?.name ? escapeHtml(it.clan.name) : '—';
      const ct = it.clan?.tag ? ` <code>${escapeHtml(it.clan.tag)}</code>` : '';
      return `${rk}. <b>${escapeHtml(it.name || '')}</b> <code>${escapeHtml(it.tag || '')}</code>\n   └ 🏆 <b>${it.trophies ?? '—'}</b> trofei · clan ${cn}${ct}`;
    }
    const pts = it.points != null ? it.points : it.clanPoints;
    return `${rk}. <b>${escapeHtml(it.name || '')}</b> <code>${escapeHtml(it.tag || '')}</code>\n   └ 👥 ${it.members ?? '—'} membri · liv. <b>${it.level ?? '—'}</b> · <b>${pts ?? '—'}</b> pt`;
  });
  return `${head}\n\n${lines.join('\n\n')}`;
}

function formatPlayerSummary(p) {
  if (!p) return `${DIV}\n👤 <b>Giocatore</b>\n${DIV}\n\n<i>Non trovato.</i>`;
  const lines = [
    `${DIV}\n👤 <b>Profilo villaggio</b>\n${DIV}`,
    `<b>${escapeHtml(p.name)}</b> <code>${escapeHtml(p.tag || '')}</code>`,
    `${DIV2}`,
    `🏠 Municipio · <b>TH ${p.townHallLevel ?? '—'}</b>`,
    `🏆 Trofei · <b>${p.trophies ?? '—'}</b>`,
    `⭐ Esperienza · <b>${p.expLevel ?? '—'}</b>`,
  ];
  if (p.clan?.name) lines.push(`⚔️ Clan · ${escapeHtml(p.clan.name)} <code>${escapeHtml(p.clan.tag || '')}</code>`);
  if (p.role) lines.push(`👔 Ruolo in clan · <i>${mapCoCRoleToItalian(p.role)}</i>`);
  return lines.join('\n');
}

function formatClanSearch(items) {
  if (!items || !items.length) {
    return `${DIV}\n🔍 <b>Ricerca clan</b>\n${DIV}\n\n<i>Nessun clan corrisponde alla ricerca.</i>`;
  }
  const lines = items.slice(0, 15).map((c, i) => {
    return `${i + 1}. <b>${escapeHtml(c.name)}</b> <code>${escapeHtml(c.tag || '')}</code>\n   └ 👥 ${c.members ?? '?'} membri · lvl ${c.level ?? '—'}`;
  });
  return `${DIV}\n🔍 <b>Risultati ricerca clan</b>\n${DIV}\n${DIV2}\n\n${lines.join('\n\n')}`;
}

function formatSearchMenuIntro() {
  return (
    `${DIV}\n🔍 <b>Cerca</b>\n${DIV}\n\n` +
    `Scegli il tipo e poi invia il testo richiesto.\n\n` +
    `• <b>Villaggio</b> — tag tipo <code>#2ABC</code>\n` +
    `• <b>Clan</b> — parte del nome (min. 3 caratteri)\n\n` +
    `Oppure in chat: <code>/player #TAG</code> e <code>/cerca_clan nome</code>.\n\n` +
    `<i>In privato, con login, puoi aprire anche la <b>versione web</b> (Mini App).</i>`
  );
}

function formatRankMenuIntro() {
  return (
    `${DIV}\n📊 <b>Classifica trofei</b>\n${DIV}\n\n` +
    `Stessi dati della sezione “Cerca” sul sito CoCBoard.\n\n` +
    `Scegli area e tipo (giocatori o clan).`
  );
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
  while (rest.length > MAX_MESSAGE) {
    const win = rest.slice(0, MAX_MESSAGE);
    let cut = -1;
    const preEnd = win.lastIndexOf('</pre>');
    if (preEnd !== -1) cut = preEnd + 6;
    if (cut <= 0) {
      const brEnd = win.lastIndexOf('<br>');
      if (brEnd > MAX_MESSAGE * 0.4) cut = brEnd + 4;
    }
    if (cut <= 0) {
      cut = rest.lastIndexOf('\n', MAX_MESSAGE);
    }
    if (cut <= 0) cut = MAX_MESSAGE;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length) parts.push(rest);
  return parts;
}

// ─── GUERRA CLASSICA LIVE ────────────────────────────────────────────────────

const WAR_LIVE_PLAYERS_PER_PAGE = 10;
const WAR_LIVE_PLAN_PER_PAGE = 12;

/** Parsa il formato ora CoC "20230814T100000.000Z" → Date */
function parseCocTime(t) {
  if (!t) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(t);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
}

function warLiveStateLabel(state) {
  switch (state) {
    case 'preparation': return '🛡 Giorno di preparazione';
    case 'inWar':       return '⚔️ Giorno di guerra';
    case 'warEnded':    return '🏁 Guerra terminata';
    default:            return '😴 Non in guerra';
  }
}

/** Countdown (suggestion 3) */
function warLiveCountdown(data) {
  const now = Date.now();
  let target = null;
  let prefix = '';
  if (data.state === 'preparation') { target = parseCocTime(data.startTime); prefix = 'Inizio guerra'; }
  else if (data.state === 'inWar')  { target = parseCocTime(data.endTime);   prefix = 'Fine guerra'; }
  if (!target) return null;
  const diff = target - now;
  if (diff <= 0) return `⏱ ${prefix}: <b>terminato</b>`;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  if (h > 0) return `⏱ ${prefix}: <b>${h}h ${String(m).padStart(2,'0')}m</b>`;
  return `⏱ ${prefix}: <b>${m}m ${String(s).padStart(2,'0')}s</b>`;
}

function warLiveHoursLeft(data) {
  if (data.state !== 'inWar' || !data.endTime) return null;
  const t = parseCocTime(data.endTime);
  if (!t) return null;
  const diff = t - Date.now();
  return diff > 0 ? diff / 3_600_000 : 0;
}

function heroLevelShort(member, heroName) {
  if (!member?.heroes) return '—';
  const h = member.heroes.find(h => h.name === heroName);
  return h ? String(h.level) : '—';
}

/** Stima vittoria (suggestion 6) */
function warLiveWinProbability(data) {
  const c = data?.clan;
  const o = data?.opponent;
  const teamSize = data?.teamSize || 0;
  if (!c || !o || !teamSize) return null;
  const cStars = c.stars ?? 0;
  const oStars = o.stars ?? 0;
  const cDest  = c.destructionPercentage ?? 0;
  const oDest  = o.destructionPercentage ?? 0;

  if (data.state === 'warEnded') {
    if (cStars > oStars) return { label: '🏆 Vittoria', pct: null };
    if (cStars < oStars) return { label: '❌ Sconfitta', pct: null };
    if (cDest > oDest)   return { label: '🏆 Vittoria (distruzione)', pct: null };
    if (cDest < oDest)   return { label: '❌ Sconfitta (distruzione)', pct: null };
    return { label: '⚖️ Pareggio', pct: null };
  }
  if (data.state !== 'inWar') return null;

  const maxStars = teamSize * 3;
  const starDiff = cStars - oStars;
  let pct;
  if (starDiff !== 0) {
    pct = 50 + (starDiff / maxStars) * 120;
  } else {
    pct = 50 + (cDest - oDest) * 0.5;
  }
  pct = Math.round(Math.min(99, Math.max(1, pct)));
  const label = pct >= 65 ? '🟢 In vantaggio' : pct >= 50 ? '🟡 Equilibrio' : pct >= 35 ? '🟠 In svantaggio' : '🔴 Situazione critica';
  return { label, pct };
}

function formatWarLiveOverview(data) {
  const c = data.clan || {};
  const o = data.opponent || {};
  const teamSize = data.teamSize || '?';
  const atkPer  = data.attacksPerMember || 2;
  const cStars   = c.stars ?? 0;
  const oStars   = o.stars ?? 0;
  const cAtk     = c.attacks ?? 0;
  const oAtk     = o.attacks ?? 0;
  const cDest    = Number(c.destructionPercentage ?? 0).toFixed(1);
  const oDest    = Number(o.destructionPercentage ?? 0).toFixed(1);
  const totalAtk = Number.isFinite(Number(teamSize)) ? Number(teamSize) * atkPer : '?';
  const starIcon = cStars > oStars ? '🏆' : cStars < oStars ? '❌' : '⚖️';
  const countdown = warLiveCountdown(data);
  const wp = warLiveWinProbability(data);

  const lines = [
    DIV,
    `⚔️ <b>Guerra classica live</b>`,
    DIV,
    `📌 Stato: <b>${warLiveStateLabel(data.state)}</b>`,
  ];
  if (countdown) lines.push(countdown);
  lines.push('');
  lines.push(`🏠 <b>${escapeHtml(c.name || '—')}</b>  vs  <b>${escapeHtml(o.name || '—')}</b>`);
  lines.push(`👥 ${teamSize}v${teamSize} · ${atkPer} attacchi/giocatore`);
  lines.push('');
  lines.push(`⭐ Stelle:      <b>${cStars}</b>  ${starIcon}  <b>${oStars}</b>`);
  lines.push(`⚔️ Attacchi:   <b>${cAtk}/${totalAtk}</b>  ·  Avv. <b>${oAtk}/${totalAtk}</b>`);
  lines.push(`💥 Distruzione: <b>${cDest}%</b>  ·  Avv. <b>${oDest}%</b>`);

  if (wp) {
    lines.push('');
    lines.push(wp.pct != null
      ? `📊 Stima vittoria: ${wp.label} (<b>${wp.pct}%</b>)`
      : `📊 Risultato: ${wp.label}`);
  }

  // Stato attacchi sempre visibile durante la guerra
  if (data.state === 'inWar') {
    const members = c.members || [];
    const done    = members.filter(m => (m.attacks?.length ?? 0) >= atkPer);
    const partial = atkPer > 1 ? members.filter(m => (m.attacks?.length ?? 0) === 1) : [];
    const zero    = members.filter(m => (m.attacks?.length ?? 0) === 0);
    const hoursLeft = warLiveHoursLeft(data);
    const isUrgent = hoursLeft !== null && hoursLeft < 4;
    lines.push('');
    const partialBit = atkPer > 1 ? ` · 🟡 ${partial.length}` : '';
    lines.push(`📊 Attacchi: ✅ ${done.length}${partialBit} · 🔴 ${zero.length}`);
    if (zero.length) {
      const urgent = isUrgent ? ' ⚠️' : '';
      lines.push(`🔴 Non ha ancora attaccato${urgent}: ${zero.slice(0, 8).map(m => escapeHtml(m.name || '?')).join(', ')}${zero.length > 8 ? ` +${zero.length - 8}` : ''}`);
    }
    if (partial.length && atkPer > 1) {
      lines.push(`🟡 1 attacco rimasto: ${partial.slice(0, 6).map(m => escapeHtml(m.name || '?')).join(', ')}${partial.length > 6 ? ` +${partial.length - 6}` : ''}`);
    }
    if (isUrgent && (zero.length + partial.length > 0)) {
      lines.push(`⚠️ Meno di ${Math.ceil(hoursLeft)}h alla fine!`);
    }
  }

  return lines.join('\n');
}

function formatWarLivePlayers(data, side = 'us', page = 0) {
  const sideObj   = side === 'us' ? data.clan : data.opponent;
  const sideLabel = side === 'us' ? `🏠 ${escapeHtml(data.clan?.name || 'Nostro clan')}` : `⚔️ ${escapeHtml(data.opponent?.name || 'Avversario')}`;
  const members   = [...(sideObj?.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const atkPer    = data.attacksPerMember || 2;
  const inWar     = data.state === 'inWar' || data.state === 'warEnded';

  if (!members.length) {
    return `${DIV}\n👥 <b>Giocatori — ${sideLabel}</b>\n${DIV}\n\n<i>Nessun dato giocatori.</i>`;
  }

  const PAGE_SIZE  = WAR_LIVE_PLAYERS_PER_PAGE;
  const totalPages = Math.ceil(members.length / PAGE_SIZE);
  const p          = Math.min(Math.max(0, page), totalPages - 1);
  const slice      = members.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);

  // Defender lookup (both sides) for attack target resolution
  const defMap = {};
  [...(data.clan?.members || []), ...(data.opponent?.members || [])].forEach(m => {
    defMap[m.tag] = { name: m.name, pos: m.mapPosition, th: m.townhallLevel };
  });

  const starsStr = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));

  const lines = [
    DIV,
    `👥 <b>Giocatori — ${sideLabel}</b>`,
    `<i>Pagina ${p + 1}/${totalPages}</i>`,
    DIV,
  ];

  for (const m of slice) {
    const pos  = m.mapPosition ?? '?';
    const th   = m.townhallLevel ?? '?';
    const name = escapeHtml(m.name || '—');

    if (!inWar) {
      lines.push(`<b>${pos}.</b> TH${th} <b>${name}</b>`);
      continue;
    }

    const attacks = [...(m.attacks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const totalStars = attacks.reduce((s, a) => s + (a.stars ?? 0), 0);
    const atkDone = attacks.length;
    const warn = (data.state === 'inWar' && atkDone < atkPer) ? ' ⚠️' : '';

    lines.push(`\n<b>${pos}.</b> TH${th} <b>${name}</b> — ${totalStars}★${warn}`);
    for (let i = 0; i < atkPer; i++) {
      const a = attacks[i];
      if (!a) {
        lines.push(`   ▸ Attacco ${i + 1}: <i>Non utilizzato</i>`);
        continue;
      }
      const def = defMap[a.defenderTag];
      const defLabel = def ? `#${def.pos} ${escapeHtml(def.name)} (TH${def.th})` : (a.defenderTag ?? '?');
      const destr = (a.destructionPercentage ?? 0).toFixed(0);
      lines.push(`   ▸ Attacco ${i + 1}: ${starsStr(a.stars ?? 0)} ${destr}% → ${defLabel}`);
    }
  }

  return lines.join('\n');
}

function getWarLivePlayersPageCount(data, side = 'us') {
  const sideObj = side === 'us' ? data?.clan : data?.opponent;
  return Math.max(1, Math.ceil((sideObj?.members?.length ?? 0) / WAR_LIVE_PLAYERS_PER_PAGE));
}

function formatWarLivePreview(data) {
  const c = data.clan || {};
  const o = data.opponent || {};
  const ourMembers  = [...(c.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const themMembers = [...(o.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const atkPer  = data.attacksPerMember || 2;
  const inWar   = data.state === 'inWar' || data.state === 'warEnded';
  const countdown = warLiveCountdown(data);

  // Defender lookup per risolvere i tag
  const defMap = {};
  [...ourMembers, ...themMembers].forEach(m => {
    defMap[m.tag] = { name: m.name, pos: m.mapPosition, th: m.townhallLevel };
  });

  const st = (n) => '★'.repeat(n ?? 0) + '☆'.repeat(Math.max(0, 3 - (n ?? 0)));
  const pad = (s, len) => String(s ?? '').slice(0, len).padEnd(len);

  const lines = [DIV, `👁 <b>Anteprima</b>`, DIV];
  if (countdown) lines.push(countdown);
  lines.push('');

  if (!inWar) {
    // Pre-guerra: composizione TH
    const countTh = (arr) => { const m = {}; arr.forEach(p => { const t = p.townhallLevel ?? 0; if (t) m[t] = (m[t] || 0) + 1; }); return m; };
    const thStr = (map) => Object.entries(map).sort((a,b) => +b[0]-+a[0]).map(([lv,n]) => `TH${lv}×${n}`).join(' ') || '—';
    lines.push(`🏠 <b>${escapeHtml(c.name || 'Noi')}</b>: ${thStr(countTh(ourMembers))}`);
    lines.push(`⚔️ <b>${escapeHtml(o.name || 'Avversario')}</b>: ${thStr(countTh(themMembers))}`);
    return lines.join('\n');
  }

  // ── Attacchi del nostro clan ──
  const ourAtks = ourMembers.flatMap(m => (m.attacks || []).map(a => ({ m, a }))).sort((x,y) => (x.a.order ?? 0) - (y.a.order ?? 0));
  const totalUs = ourMembers.length * atkPer;
  lines.push(`⚔️ <b>Attacchi Noi</b> — ${c.attacks ?? 0}/${totalUs}`);
  if (!ourAtks.length) {
    lines.push('<i>Nessun attacco ancora.</i>');
  } else {
    const rows = ourAtks.map(({ m, a }) => {
      const def = defMap[a.defenderTag];
      const defLabel = def ? `#${String(def.pos).padStart(2)} ${pad(def.name,9)} TH${def.th}` : '?';
      return `#${String(m.mapPosition ?? '?').padStart(2)} ${pad(m.name,9)} → ${defLabel}: ${st(a.stars)} ${(a.destructionPercentage ?? 0).toFixed(0)}%`;
    });
    lines.push(`<pre>${rows.join('\n')}</pre>`);
  }

  lines.push('');

  // ── Attacchi ricevuti (difese) ──
  const theirAtks = themMembers.flatMap(m => (m.attacks || []).map(a => ({ m, a }))).sort((x,y) => (x.a.order ?? 0) - (y.a.order ?? 0));
  const totalThem = themMembers.length * atkPer;
  lines.push(`🛡 <b>Difese Noi</b> — ricevuti ${o.attacks ?? 0}/${totalThem}`);
  if (!theirAtks.length) {
    lines.push('<i>Nessun attacco ricevuto.</i>');
  } else {
    const rows = theirAtks.map(({ m, a }) => {
      const def = defMap[a.defenderTag];
      const defLabel = def ? `#${String(def.pos).padStart(2)} ${pad(def.name,9)}` : '?';
      return `#${String(m.mapPosition ?? '?').padStart(2)} ${pad(m.name,9)} → ${defLabel}: ${st(a.stars)} ${(a.destructionPercentage ?? 0).toFixed(0)}%`;
    });
    lines.push(`<pre>${rows.join('\n')}</pre>`);
  }

  return lines.join('\n');
}

const WAR_LIVE_CONFRONTO_PER_PAGE = 10;

function formatWarLiveConfronto(data, page = 0) {
  const c = data.clan || {};
  const o = data.opponent || {};
  const ourMembers  = [...(c.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const themMembers = [...(o.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const maxRows     = Math.max(ourMembers.length, themMembers.length);

  if (!maxRows) {
    return `${DIV}\n⚖ <b>Confronto</b>\n${DIV}\n\n<i>Nessun dato.</i>`;
  }

  const heroSum = (m) => {
    if (!m?.heroes) return '—';
    const bk = m.heroes.find(h => h.name === 'Barbarian King')?.level ?? 0;
    const aq = m.heroes.find(h => h.name === 'Archer Queen')?.level ?? 0;
    const gw = m.heroes.find(h => h.name === 'Grand Warden')?.level ?? 0;
    const rc = m.heroes.find(h => h.name === 'Royal Champion')?.level ?? 0;
    const total = bk + aq + gw + rc;
    return total > 0 ? String(total) : '—';
  };

  const totalPages = Math.max(1, Math.ceil(maxRows / WAR_LIVE_CONFRONTO_PER_PAGE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const start = p * WAR_LIVE_CONFRONTO_PER_PAGE;
  const end = Math.min(start + WAR_LIVE_CONFRONTO_PER_PAGE, maxRows);

  const cName = escapeHtml((c.name || 'Noi').slice(0, 8));
  const oName = escapeHtml((o.name || 'Avv').slice(0, 8));

  const lines = [
    DIV,
    `⚖ <b>Confronto — Σ Eroi</b>`,
    `<i>Pagina ${p + 1}/${totalPages}</i>`,
    DIV,
    '',
  ];

  const header = `#  │ TH │ Σ  │ ${cName.padEnd(8)} ║ ${oName.padEnd(8)} │ TH │ Σ`;
  const sep    = `───┼────┼────┼──────────╬──────────┼────┼───`;

  const rows = [header, sep];
  for (let i = start; i < end; i++) {
    const a = ourMembers[i];
    const b = themMembers[i];
    // War rank (1…N), allineato al confronto CWL / sito
    const pos = String(i + 1).padStart(2);
    const aTh  = a ? `TH${String(a.townhallLevel ?? a.townHallLevel ?? '?').padEnd(2)}` : '    ';
    const aSum = a ? String(heroSum(a)).padStart(3) : '  —';
    const aName = a ? escapeHtml((a.name || '—').slice(0, 8)).padEnd(8) : '        ';
    const bTh  = b ? `TH${String(b.townhallLevel ?? b.townHallLevel ?? '?').padEnd(2)}` : '    ';
    const bSum = b ? String(heroSum(b)).padStart(3) : '  —';
    const bName = b ? escapeHtml((b.name || '—').slice(0, 8)).padEnd(8) : '        ';
    rows.push(`${pos} │ ${aTh}│${aSum} │ ${aName} ║ ${bName} │ ${bTh}│${bSum}`);
  }

  lines.push(`<pre>${rows.join('\n')}</pre>`);
  return lines.join('\n');
}

function getWarLiveConfrontoPageCount(data) {
  const maxRows = Math.max(data?.clan?.members?.length ?? 0, data?.opponent?.members?.length ?? 0);
  return Math.max(1, Math.ceil(maxRows / WAR_LIVE_CONFRONTO_PER_PAGE));
}

/** Score planner (lower = better): |ΔTH|×2 + stelle×5 + attacchi×3 */
function warLivePlanScorePrimary(attackerTh, s) {
  const thDiff = Math.abs(attackerTh - (s.th ?? 0));
  return thDiff * 2 + (s.bestStars ?? 0) * 5 + (s.times ?? 0) * 3;
}

function warLivePlanScoreSecondary(attackerTh, s) {
  let sc = warLivePlanScorePrimary(attackerTh, s);
  if ((s.bestStars ?? 0) === 2) sc -= 10; // preferenza cleanup su 2★
  return sc;
}

function formatWarLivePlan(data, page = 0) {
  const c      = data.clan || {};
  const o      = data.opponent || {};
  const atkPer = data.attacksPerMember || 2;

  const warStateRaw = data.state || '';
  const warState    = warStateRaw === 'ended' ? 'warEnded' : warStateRaw;
  const warClosed   = warState === 'warEnded';

  const ourMembers = [...(c.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const oppMembers = [...(o.members || [])].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));

  // Stato offensive sui villaggi avversari (solo le nostre stelle su di loro)
  const defStatus = {};
  for (const opp of oppMembers) {
    const atksOnBase = ourMembers.flatMap(m => (m.attacks || []).filter(a => a.defenderTag === opp.tag));
    const best = atksOnBase.reduce(
      (b, a) => (a.stars > b.stars || (a.stars === b.stars && a.destructionPercentage > b.destructionPercentage)) ? a : b,
      { stars: 0, destructionPercentage: 0 }
    );
    defStatus[opp.tag] = { pos: opp.mapPosition, name: opp.name, th: opp.townhallLevel, bestStars: best.stars, bestDest: best.destructionPercentage, times: atksOnBase.length };
  }

  const totalWarMembers = ourMembers.length || (data.teamSize ?? 0);
  const soglia          = Math.floor(totalWarMembers / 2) + 1;
  const attackedCount   = ourMembers.filter(m => (m.attacks?.length ?? 0) >= 1).length;
  const mostrarSecondo =
    warState === 'inWar' && atkPer >= 2 && attackedCount >= soglia;

  const needAtk   = ourMembers.filter(m => (m.attacks?.length ?? 0) < atkPer);
  const openBases = oppMembers.filter(opp => (defStatus[opp.tag]?.bestStars ?? 0) < 3);

  const PAGE_SIZE = WAR_LIVE_PLAN_PER_PAGE;
  const totalPgs  = Math.max(1, Math.ceil(needAtk.length / PAGE_SIZE));
  const p         = Math.min(Math.max(0, page), totalPgs - 1);
  const slice     = needAtk.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);

  const lines = [
    DIV,
    `📋 <b>Planner attacchi</b>`,
    `<i>${needAtk.length} giocator${needAtk.length === 1 ? 'e' : 'i'} con attacchi rimanenti — pag. ${p + 1}/${totalPgs}</i>`,
    DIV,
  ];

  if (warClosed) {
    lines.push('<i>🏁 Guerra terminata — nessun suggerimento (war chiusa).</i>');
    return lines.join('\n');
  }

  if (!needAtk.length) {
    lines.push('<i>✅ Tutti i giocatori hanno completato i propri attacchi.</i>');
    return lines.join('\n');
  }

  if (warState === 'preparation') {
    lines.push(`<i>🛡 Preparazione: solo target primari (1 per giocatore, esclusivi).</i>`);
  } else if (warState === 'inWar' && !mostrarSecondo) {
    lines.push('<i>⚔️ Solo target primari finché non raggiunta la soglia sul 1° attacco.</i>');
  } else if (mostrarSecondo) {
    lines.push(`<i>⚔️ Soglia 1° attacchi raggiunta (${attackedCount}/${totalWarMembers}, ≥${soglia}): anche target per il 2° attacco.</i>`);
  }

  const pad = (s, len) => String(s ?? '').slice(0, len).padEnd(len);

  // ── Target primario: greedy esclusivo in ordine mapPosition, 1 base per attaccante ──
  const needOrder = [...needAtk].sort((a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99));
  const assignedPrimary = new Set();
  /** @type {Map<string, { s: object, opp: object, score: number } | null>} */
  const primaryByTag = new Map();

  for (const m of needOrder) {
    const attackerTh = m.townhallLevel ?? 0;
    const available  = openBases.filter(opp => !assignedPrimary.has(opp.tag));
    const scored = available
      .map(opp => {
        const s = defStatus[opp.tag];
        return { s, opp, score: warLivePlanScorePrimary(attackerTh, s) };
      })
      .sort((a, b) => a.score - b.score || (a.s.pos ?? 99) - (b.s.pos ?? 99));
    const best = scored[0];
    if (best) {
      assignedPrimary.add(best.opp.tag);
      primaryByTag.set(m.tag, best);
    } else {
      primaryByTag.set(m.tag, null);
    }
  }

  // ── Target secondario: solo inWar, soglia, atkPer≥2; pool con regole tempo / primari ──
  /** @type {Map<string, { s: object, opp: object, score: number } | null>} */
  const secondaryByTag = new Map();
  if (mostrarSecondo) {
    const hoursLeft = warLiveHoursLeft(data);
    const timeGe4h  = hoursLeft == null ? false : hoursLeft >= 4;

    const excludedFromPool = new Set();
    if (timeGe4h) {
      for (const m of ourMembers) {
        if ((m.attacks?.length ?? 0) !== 0) continue;
        const prim = primaryByTag.get(m.tag);
        if (prim?.opp?.tag) excludedFromPool.add(prim.opp.tag);
      }
    }

    const poolOpp = oppMembers.filter(opp => {
      if ((defStatus[opp.tag]?.bestStars ?? 0) >= 3) return false;
      if (excludedFromPool.has(opp.tag)) return false;
      return true;
    });

    const needSecondary = needOrder.filter(m => (m.attacks?.length ?? 0) >= 1 && (m.attacks?.length ?? 0) < atkPer);
    const assignedSec = new Set();

    for (const m of needSecondary) {
      const attackerTh = m.townhallLevel ?? 0;
      const available = poolOpp.filter(opp => !assignedSec.has(opp.tag));
      const scored = available
        .map(opp => {
          const s = defStatus[opp.tag];
          return { s, opp, score: warLivePlanScoreSecondary(attackerTh, s) };
        })
        .sort((a, b) => a.score - b.score || (a.s.pos ?? 99) - (b.s.pos ?? 99));
      const best = scored[0];
      if (best) {
        assignedSec.add(best.opp.tag);
        secondaryByTag.set(m.tag, best);
      } else {
        secondaryByTag.set(m.tag, null);
      }
    }
  }

  const rows = [];
  for (const m of slice) {
    const atkLeft    = atkPer - (m.attacks?.length ?? 0);
    const attackerTh = m.townhallLevel ?? 0;
    rows.push(`#${String(m.mapPosition ?? '?').padStart(2)} ${pad(m.name || '—', 11)} TH${attackerTh} — ${atkLeft} atk`);

    const prim = primaryByTag.get(m.tag);
    if (prim) {
      const s = prim.s;
      const status = s.bestStars === 0 ? '[intatta]' : `[${s.bestStars}★ ${Number(s.bestDest).toFixed(0)}%]`;
      rows.push(`  1° → #${String(s.pos).padStart(2)} ${pad(s.name, 10)} TH${s.th} ${status}`);
    } else {
      rows.push('  1° → nessuna base disponibile');
    }

    const showSec =
      mostrarSecondo &&
      (m.attacks?.length ?? 0) >= 1 &&
      (m.attacks?.length ?? 0) < atkPer;

    if (showSec) {
      const sec = secondaryByTag.get(m.tag);
      if (sec) {
        const s = sec.s;
        const status = s.bestStars === 0 ? '[intatta]' : `[${s.bestStars}★ ${Number(s.bestDest).toFixed(0)}%]`;
        rows.push(`  2° → #${String(s.pos).padStart(2)} ${pad(s.name, 10)} TH${s.th} ${status}`);
      } else {
        rows.push('  2° → nessuna base disponibile (2° att.)');
      }
    }
  }

  lines.push(`<pre>${rows.join('\n')}</pre>`);
  return lines.join('\n');
}

function getWarLivePlanPageCount(data) {
  const warStateRaw = data?.state || '';
  const warState    = warStateRaw === 'ended' ? 'warEnded' : warStateRaw;
  if (warState === 'warEnded') return 1;

  const c      = data?.clan;
  const atkPer = data?.attacksPerMember || 2;
  const need   = (c?.members || []).filter(m => (m.attacks?.length ?? 0) < atkPer);
  return Math.max(1, Math.ceil(need.length / WAR_LIVE_PLAN_PER_PAGE));
}

function formatWarLiveScreen(data, view = 'ov', pPage = 0, side = 'us') {
  if (!data || data.state === 'notInWar') {
    return {
      text: `${DIV}\n⚔️ <b>Guerra classica live</b>\n${DIV}\n\n<i>Nessuna guerra in corso al momento.</i>`,
      view: 'ov', pPage: 0, side: 'us',
    };
  }
  let text;
  switch (view) {
    case 'p':    text = formatWarLivePlayers(data, side, pPage); break;
    case 'prev': text = formatWarLivePreview(data); break;
    case 'cf':   text = formatWarLiveConfronto(data, pPage); break;
    case 'plan': text = formatWarLivePlan(data, pPage); break;
    default:     text = formatWarLiveOverview(data); view = 'ov'; break;
  }
  return { text, view, pPage, side };
}

module.exports = {
  MEMBERS_PER_PAGE,
  BONUS_PER_PAGE,
  CWL_PLAYERS_PER_PAGE,
  RANKINGS_SHOWN,
  RANK_LOCATION_ITALY,
  RANK_LOCATION_GLOBAL,
  DIV,
  DIV2,
  escapeHtml,
  parseTagArg,
  formatGuestWelcomePrivate,
  formatGuestWelcomeGroup,
  formatPrivateOnlyWizard,
  formatGroupBotAdded,
  formatGuestSnack,
  formatGuestHelp,
  formatGroupHelp,
  formatAuthedMenuIntro,
  formatClanInfo,
  formatMembersPage,
  formatCwl,
  formatCwlScreen,
  formatCwlEmpty,
  formatCwlLega,
  formatCwlAnteprima,
  formatCwlConfronto,
  getCwlPlayerPageCount,
  getCwlRoundCount,
  getDefaultCwlRoundIndex,
  formatWarLog,
  formatWarLogClassic,
  formatWarLogCwlHistory,
  WAR_LOG_CLASSIC_PAGE_SIZE,
  WAR_LOG_CWL_SEASON_PAGE_SIZE,
  getSortedClassicWars,
  formatWarLogClassicListPage,
  formatClassicWarDetailHtml,
  mergeCwlSeasonBrowseData,
  formatWarLogCwlSeasonListPage,
  CWL_LOG_PLAYERS_PAGE_SIZE,
  normClanTagFmt,
  buildCwlSeasonListButtonLabel,
  parseGroupStandingsJson,
  parseRosterJson,
  formatCwlSeasonHubHtml,
  formatCwlLeagueStandingsHtml,
  formatCwlPlayersLogHtml,
  getCwlPlayersLogPageCount,
  formatCwlTurnsOverviewHtml,
  formatCwlRoundSideAttacksHtml,
  formatCwlSavedRoundBridgeHtml,
  formatCwlSavedRoundSideHtml,
  formatCwlSeasonDetailHtml,
  formatWarLogDateShort,
  formatAddBotToGroupHelp,
  formatGroupMenuBanner,
  formatGroupClanGateLong,
  formatLinkedGroupGuestIntro,
  formatTutorialStep,
  formatBonuses,
  formatBonusesPage,
  formatBonusHistoryBySeason,
  formatBonusReceiversLeaderboard,
  mapCoCRoleToItalian,
  formatSeasonLabelIt,
  formatRankings,
  formatPlayerSummary,
  formatClanSearch,
  formatSearchMenuIntro,
  formatRankMenuIntro,
  formatSetclanHelp,
  formatAccountPanel,
  chunkForTelegram,
  formatWarLiveScreen,
  formatWarLiveOverview,
  formatWarLivePlayers,
  formatWarLivePreview,
  formatWarLiveConfronto,
  formatWarLivePlan,
  getWarLivePlayersPageCount,
  getWarLiveConfrontoPageCount,
  getWarLivePlanPageCount,
  WAR_LIVE_PLAYERS_PER_PAGE,
  WAR_LIVE_CONFRONTO_PER_PAGE,
  WAR_LIVE_PLAN_PER_PAGE,
  // Raid Capitale
  formatRaidCapitalPage: raidCap.formatRaidCapitalPage,
  formatRaidCountdownMessage: raidCap.formatRaidCountdownMessage,
  formatRaidEndMessage: raidCap.formatRaidEndMessage,
  RAID_MEMBERS_PER_PAGE: raidCap.RAID_MEMBERS_PER_PAGE,
};
