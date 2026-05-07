'use strict';
/**
 * UI impostazioni notifiche – CoCBoard Bot
 *
 * Menu gerarchico: lista categorie → sub-menu singola categoria → toggle flag.
 * Sola lettura: ospiti e utenti non capo possono vedere lo stato.
 * Modifica: solo Capo / Co-Capo / Admin CoCBoard (isCapoOrCoCapo).
 */

const { Markup } = require('telegraf');
const tauth = require('./telegram-auth');

const ON  = '✅';
const OFF = '⚪';
const tog = (v) => (v === true ? ON : OFF);
const CUSTOM_MIN_PRESETS = [15, 30, 45, 60, 90, 120, 180, 240];
const pendingCustomInput = new Map(); // key: chatId:userId -> 'war' | 'cwl'
const AUTO_DELETE_MS = 20_000;

// ─────────────────────────────────────────────────────────────────────────────
// Definizione categorie e flag
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    id: 'war',
    emoji: '⚔️',
    name: 'Guerra Classica',
    master: 'war_alerts_enabled',
    flags: [
      { key: 'war_prep_start',  label: 'Preparazione iniziata' },
      { key: 'war_start_alert', label: 'Guerra iniziata' },
      { key: 'war_missing_4h',  label: 'Avviso 4 ore prima fine' },
      { key: 'war_missing_1h',  label: 'Avviso 1 ora prima fine' },
      { key: 'war_missing_15m', label: 'Avviso 15 min prima fine' },
      { key: 'war_3star',       label: 'Guerra perfetta (tutte 3★)' },
      { key: 'war_result',      label: 'Recap finale' },
    ],
  },
  {
    id: 'cwl',
    emoji: '🏆',
    name: 'CWL',
    master: 'cwl_alerts_enabled',
    flags: [
      { key: 'cwl_prep_start',       label: 'Preparazione round' },
      { key: 'cwl_round_start',      label: 'Inizio round' },
      { key: 'cwl_missing_4h',       label: 'Avviso 4 ore prima fine' },
      { key: 'cwl_missing_1h',       label: 'Avviso 1 ora prima fine' },
      { key: 'cwl_missing_15m',      label: 'Avviso 15 min prima fine' },
      { key: 'cwl_round_end',        label: 'Fine round (recap)' },
      { key: 'cwl_end',              label: 'Fine stagione CWL' },
      { key: 'cwl_league_promotion', label: 'Promozione lega' },
      { key: 'cwl_league_demotion',  label: 'Retrocessione lega' },
    ],
  },
  {
    id: 'raids',
    emoji: '🏛',
    name: 'Raid Capitale',
    master: 'capital_raids_enabled',
    flags: [
      { key: 'raid_start',              label: 'Inizio weekend raid' },
      { key: 'raid_district_destroyed', label: 'Distretto nemico distrutto' },
      { key: 'raid_clan_cleared',       label: 'Clan nemico eliminato' },
      { key: 'raid_capital_fallen',     label: 'Nostra capitale caduta' },
      { key: 'raid_end',                label: 'Fine raid' },
      { key: 'raid_loot_milestone',     label: 'Milestone oro (50k/100k…)' },
    ],
  },
  {
    id: 'activity',
    emoji: '👥',
    name: 'Attività Clan',
    master: 'clan_activity_enabled',
    flags: [
      { key: 'clan_member_join',   label: 'Nuovo membro' },
      { key: 'clan_member_leave',  label: 'Membro esce' },
      { key: 'clan_role_promoted', label: 'Promozione ruolo' },
      { key: 'clan_role_demoted',  label: 'Retrocessione ruolo' },
      { key: 'clan_level_up',      label: 'Livello clan aumenta' },
      { key: 'clan_war_streak',    label: 'Serie vittorie consecutive' },
      { key: 'clan_name_change',   label: 'Cambio nome clan' },
    ],
  },
];

const CAT_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

/** Tutti i key validi (master + sub-flag + clan_games standalone). */
const ALL_FLAG_KEYS = new Set([
  'clan_games_enabled',
  ...CATEGORIES.flatMap((c) => [c.master, ...c.flags.map((f) => f.key)]),
]);

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard builders
// ─────────────────────────────────────────────────────────────────────────────

function countActive(s, cat) {
  return cat.flags.filter((f) => s[f.key] === true).length;
}

async function buildMainKb(sb, chatId) {
  const s = await sb.getChatNotificationSettings(chatId).catch(() => ({}));
  const rows = CATEGORIES.map((cat) => {
    const masterOn = s[cat.master] === true;
    const active   = countActive(s, cat);
    const total    = cat.flags.length;
    const suffix   = masterOn
      ? (active === 0 ? ` ${ON} 0/${total}` : ` ${ON} ${active}/${total}`)
      : ` ${OFF}`;
    return [Markup.button.callback(`${cat.emoji} ${cat.name}${suffix}`, `notif_cat:${cat.id}`)];
  });
  rows.push([Markup.button.callback(
    `🎯 Giochi del clan ${tog(s.clan_games_enabled === true)}`,
    'notif_tog:clan_games_enabled',
  )]);
  rows.push([Markup.button.callback('⏱ Alert personalizzati', 'notif_custom_menu')]);
  rows.push([Markup.button.callback('« Menù', 'menu')]);
  return Markup.inlineKeyboard(rows);
}

function fmtLeadMinutes(minutes) {
  const m = Number(minutes || 0);
  if (!Number.isFinite(m) || m <= 0) return 'non impostato';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h > 0 && r > 0) return `${h}h ${r}m`;
  if (h > 0) return `${h}h`;
  return `${r}m`;
}

function customStatusLine(label, enabled, paused, leadMinutes) {
  const state = enabled ? (paused ? '⏸ in pausa' : '✅ attivo') : '⚪ disattivato';
  return `${label}: ${state} · preavviso ${fmtLeadMinutes(leadMinutes)}`;
}

async function buildCustomMainKb(sb, chatId) {
  const c = await sb.getChatCustomAlertSettings(chatId).catch(() => ({}));
  const rows = [
    [Markup.button.callback(`⚔️ Guerra (${fmtLeadMinutes(c.war_lead_minutes)})`, 'notif_custom_edit:war')],
    [Markup.button.callback(`🏆 CWL (${fmtLeadMinutes(c.cwl_lead_minutes)})`, 'notif_custom_edit:cwl')],
    [Markup.button.callback('« Avvisi', 'notif_menu')],
  ];
  return Markup.inlineKeyboard(rows);
}

async function buildCustomEditKb(sb, chatId, kind) {
  const c = await sb.getChatCustomAlertSettings(chatId).catch(() => ({}));
  const isWar = kind === 'war';
  const enabled = isWar ? c.war_enabled === true : c.cwl_enabled === true;
  const paused = isWar ? c.war_paused === true : c.cwl_paused === true;
  const rows = [];
  for (let i = 0; i < CUSTOM_MIN_PRESETS.length; i += 2) {
    const a = CUSTOM_MIN_PRESETS[i];
    const b = CUSTOM_MIN_PRESETS[i + 1];
    const pair = [Markup.button.callback(`${fmtLeadMinutes(a)}`, `notif_custom_set:${kind}:${a}`)];
    if (b) pair.push(Markup.button.callback(`${fmtLeadMinutes(b)}`, `notif_custom_set:${kind}:${b}`));
    rows.push(pair);
  }
  rows.push([Markup.button.callback('✍️ Inserisci ore/minuti manualmente', `notif_custom_input:${kind}`)]);
  rows.push([Markup.button.callback(`${enabled ? ON : OFF} Attiva alert`, `notif_custom_toggle:${kind}`)]);
  rows.push([Markup.button.callback(`${paused ? '▶️ Riprendi' : '⏸ Pausa'}`, `notif_custom_pause:${kind}`)]);
  rows.push([Markup.button.callback('🗑 Elimina alert', `notif_custom_delete:${kind}`)]);
  rows.push([Markup.button.callback('« Alert personalizzati', 'notif_custom_menu')]);
  return Markup.inlineKeyboard(rows);
}

function buildCustomMainText(c) {
  return (
    '⏱ <b>Alert personalizzati</b>\n\n' +
    'Scegli quando ricevere l’avviso automatico prima della fine guerra/round.\n' +
    'Puoi modificare, mettere in pausa o eliminare l’alert quando vuoi.\n\n' +
    `${customStatusLine('⚔️ Guerra', c.war_enabled === true, c.war_paused === true, c.war_lead_minutes)}\n` +
    `${customStatusLine('🏆 CWL', c.cwl_enabled === true, c.cwl_paused === true, c.cwl_lead_minutes)}`
  );
}

function buildCustomEditText(kind, c) {
  const isWar = kind === 'war';
  const title = isWar ? '⚔️ Guerra classica' : '🏆 CWL';
  const enabled = isWar ? c.war_enabled === true : c.cwl_enabled === true;
  const paused = isWar ? c.war_paused === true : c.cwl_paused === true;
  const lead = isWar ? c.war_lead_minutes : c.cwl_lead_minutes;
  return (
    `${title} · <b>alert personalizzato</b>\n\n` +
    `Stato: ${enabled ? (paused ? '⏸ in pausa' : '✅ attivo') : '⚪ disattivato'}\n` +
    `Preavviso: <b>${fmtLeadMinutes(lead)}</b>\n\n` +
    '<i>Quando il tempo rimanente scende sotto la soglia scelta, il bot invia un unico avviso.</i>'
  );
}

function parseLeadMinutesInput(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  const hhmm = s.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h >= 0 && h <= 24 && m >= 0 && m < 60) {
      const total = h * 60 + m;
      return total >= 1 && total <= 1440 ? total : null;
    }
  }
  const hOnly = s.match(/^(\d{1,2})\s*h$/);
  if (hOnly) {
    const total = Number(hOnly[1]) * 60;
    return total >= 1 && total <= 1440 ? total : null;
  }
  const mOnly = s.match(/^(\d{1,4})\s*m$/);
  if (mOnly) {
    const total = Number(mOnly[1]);
    return total >= 1 && total <= 1440 ? total : null;
  }
  const hm = s.match(/^(\d{1,2})\s*h\s*(\d{1,2})\s*m$/);
  if (hm) {
    const total = Number(hm[1]) * 60 + Number(hm[2]);
    return total >= 1 && total <= 1440 ? total : null;
  }
  const plain = s.match(/^\d{1,4}$/);
  if (plain) {
    const total = Number(s);
    return total >= 1 && total <= 1440 ? total : null;
  }
  return null;
}

async function ensureSessionUser(ctx) {
  if (ctx.cocboardUser) return ctx.cocboardUser;
  const uid = ctx.from?.id;
  if (uid == null) return null;
  const sess = await tauth.getValidSession(uid).catch(() => null);
  if (sess?.user) ctx.cocboardUser = sess.user;
  return ctx.cocboardUser || null;
}

async function deleteLater(telegram, chatId, messageId, delayMs = AUTO_DELETE_MS) {
  if (!telegram || chatId == null || messageId == null) return;
  setTimeout(() => {
    telegram.deleteMessage(chatId, messageId).catch(() => {});
  }, delayMs);
}

async function replyEphemeral(ctx, text, extra = {}) {
  const sent = await ctx.reply(text, extra).catch(() => null);
  if (sent?.message_id != null && ctx.chat?.id != null) {
    await deleteLater(ctx.telegram, ctx.chat.id, sent.message_id);
  }
  return sent;
}

async function buildCategoryKb(sb, chatId, catId) {
  const cat = CAT_BY_ID[catId];
  if (!cat) return null;
  const s        = await sb.getChatNotificationSettings(chatId).catch(() => ({}));
  const masterOn = s[cat.master] === true;
  const rows     = [];
  rows.push([Markup.button.callback(
    `${masterOn ? ON : OFF} Categoria ${masterOn ? 'ON' : 'OFF'} — attiva/disattiva tutto`,
    `notif_tog:${cat.master}`,
  )]);
  for (const f of cat.flags) {
    rows.push([Markup.button.callback(
      `${tog(s[f.key] === true)} ${f.label}`,
      `notif_tog:${f.key}`,
    )]);
  }
  rows.push([Markup.button.callback('« Avvisi', 'notif_menu')]);
  return Markup.inlineKeyboard(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// Testi
// ─────────────────────────────────────────────────────────────────────────────

function buildCategoryText(catId) {
  const cat = CAT_BY_ID[catId];
  if (!cat) return '<b>🔔 Notifiche</b>';
  return (
    `${cat.emoji} <b>${cat.name}</b>\n\n` +
    `Usa il primo pulsante per attivare/disattivare l'intera categoria.\n` +
    `Poi abilita i singoli avvisi che desideri ricevere.\n\n` +
    `<i>⚠️ La categoria deve essere ON affinché gli avvisi funzionino.</i>`
  );
}

const MAIN_TEXT =
  '🔔 <b>Notifiche chat</b>\n\n' +
  'Seleziona una categoria per configurare gli avvisi.\n' +
  '<i>Solo Capo / Co-Capo / Admin CoCBoard possono modificare le impostazioni.</i>';

// ─────────────────────────────────────────────────────────────────────────────
// Setup callbacks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra le action Telegraf per le impostazioni notifiche.
 * Va chiamato dentro setupBot(bot) di index.js.
 *
 * @param {import('telegraf').Telegraf} bot
 * @param {{ sb: object, safeAnswerCb: Function, isLinkedChatContext: Function, isCapoOrCoCapo: Function }} deps
 */
function setup(bot, { sb, safeAnswerCb, isLinkedChatContext, isCapoOrCoCapo }) {
  // ── Menù principale ────────────────────────────────────────────────────────
  bot.action('notif_menu', async (ctx) => {
    safeAnswerCb(ctx);
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return;
    const kb = await buildMainKb(sb, ctx.chat.id);
    try {
      await ctx.editMessageText(MAIN_TEXT, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(MAIN_TEXT, { parse_mode: 'HTML', ...kb });
    }
  });

  // ── Sub-menù categoria ─────────────────────────────────────────────────────
  bot.action(/^notif_cat:(.+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return;
    const catId = ctx.match[1];
    const kb    = await buildCategoryKb(sb, ctx.chat.id, catId);
    if (!kb) {
      await ctx.answerCbQuery('Categoria non trovata.').catch(() => {});
      return;
    }
    const text = buildCategoryText(catId);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  });

  // ── Toggle singolo flag ────────────────────────────────────────────────────
  bot.action(/^notif_tog:(.+)$/, async (ctx) => {
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return;
    const key = ctx.match[1];
    if (!ALL_FLAG_KEYS.has(key)) {
      await ctx.answerCbQuery('Flag non valido.').catch(() => {});
      return;
    }
    const actor = await ensureSessionUser(ctx);
    if (!actor || !isCapoOrCoCapo(actor)) {
      await ctx.answerCbQuery('✋ Solo Capo / Co-Capo / Admin CoCBoard.').catch(() => {});
      return;
    }
    const cur  = await sb.getChatNotificationSettings(ctx.chat.id).catch(() => ({}));
    const next = !(cur[key] === true);
    await sb.upsertChatNotificationSettings(ctx.chat.id, { [key]: next }, ctx.from?.id).catch(() => {});
    await ctx.answerCbQuery(next ? '✅ Attivato' : '⚪ Disattivato').catch(() => {});
    // Aggiorna tastiera: se è master o sub-flag di una categoria → riapri categoria, altrimenti main
    const parentCat = CATEGORIES.find((c) => c.master === key || c.flags.some((f) => f.key === key));
    if (parentCat) {
      const kb = await buildCategoryKb(sb, ctx.chat.id, parentCat.id);
      if (kb) await ctx.editMessageReplyMarkup(kb.reply_markup).catch(() => {});
    } else {
      const kb = await buildMainKb(sb, ctx.chat.id);
      await ctx.editMessageReplyMarkup(kb.reply_markup).catch(() => {});
    }
  });

  // ── Alert personalizzati (war/cwl) ────────────────────────────────────────
  bot.action('notif_custom_menu', async (ctx) => {
    safeAnswerCb(ctx);
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return;
    const c = await sb.getChatCustomAlertSettings(ctx.chat.id).catch(() => ({}));
    const kb = await buildCustomMainKb(sb, ctx.chat.id);
    const text = buildCustomMainText(c);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action(/^notif_custom_edit:(war|cwl)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return;
    const kind = ctx.match[1];
    const c = await sb.getChatCustomAlertSettings(ctx.chat.id).catch(() => ({}));
    const kb = await buildCustomEditKb(sb, ctx.chat.id, kind);
    const text = buildCustomEditText(kind, c);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action(/^notif_custom_set:(war|cwl):(\d{1,4})$/, async (ctx) => {
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return;
    const actor = await ensureSessionUser(ctx);
    if (!actor || !isCapoOrCoCapo(actor)) {
      await ctx.answerCbQuery('✋ Solo Capo / Co-Capo / Admin CoCBoard.').catch(() => {});
      return;
    }
    const kind = ctx.match[1];
    const mins = Number(ctx.match[2]);
    if (!Number.isFinite(mins) || mins < 1 || mins > 1440) {
      await ctx.answerCbQuery('Valore non valido.').catch(() => {});
      return;
    }
    const patch = kind === 'war'
      ? { war_enabled: true, war_paused: false, war_lead_minutes: mins }
      : { cwl_enabled: true, cwl_paused: false, cwl_lead_minutes: mins };
    await sb.upsertChatCustomAlertSettings(ctx.chat.id, patch, ctx.from?.id).catch(() => {});
    await ctx.answerCbQuery(`✅ Alert impostato: ${fmtLeadMinutes(mins)} prima`).catch(() => {});
    const c = await sb.getChatCustomAlertSettings(ctx.chat.id).catch(() => ({}));
    const kb = await buildCustomEditKb(sb, ctx.chat.id, kind);
    await ctx.editMessageText(buildCustomEditText(kind, c), { parse_mode: 'HTML', ...kb }).catch(() => {});
  });

  bot.action(/^notif_custom_toggle:(war|cwl)$/, async (ctx) => {
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return;
    const actor = await ensureSessionUser(ctx);
    if (!actor || !isCapoOrCoCapo(actor)) {
      await ctx.answerCbQuery('✋ Solo Capo / Co-Capo / Admin CoCBoard.').catch(() => {});
      return;
    }
    const kind = ctx.match[1];
    const c = await sb.getChatCustomAlertSettings(ctx.chat.id).catch(() => ({}));
    const enabled = kind === 'war' ? c.war_enabled === true : c.cwl_enabled === true;
    const patch = kind === 'war' ? { war_enabled: !enabled } : { cwl_enabled: !enabled };
    await sb.upsertChatCustomAlertSettings(ctx.chat.id, patch, ctx.from?.id).catch(() => {});
    await ctx.answerCbQuery(!enabled ? '✅ Alert attivato' : '⚪ Alert disattivato').catch(() => {});
    const next = await sb.getChatCustomAlertSettings(ctx.chat.id).catch(() => ({}));
    const kb = await buildCustomEditKb(sb, ctx.chat.id, kind);
    await ctx.editMessageText(buildCustomEditText(kind, next), { parse_mode: 'HTML', ...kb }).catch(() => {});
  });

  bot.action(/^notif_custom_pause:(war|cwl)$/, async (ctx) => {
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return;
    const actor = await ensureSessionUser(ctx);
    if (!actor || !isCapoOrCoCapo(actor)) {
      await ctx.answerCbQuery('✋ Solo Capo / Co-Capo / Admin CoCBoard.').catch(() => {});
      return;
    }
    const kind = ctx.match[1];
    const c = await sb.getChatCustomAlertSettings(ctx.chat.id).catch(() => ({}));
    const paused = kind === 'war' ? c.war_paused === true : c.cwl_paused === true;
    const patch = kind === 'war' ? { war_paused: !paused } : { cwl_paused: !paused };
    await sb.upsertChatCustomAlertSettings(ctx.chat.id, patch, ctx.from?.id).catch(() => {});
    await ctx.answerCbQuery(!paused ? '⏸ Alert in pausa' : '▶️ Alert riattivato').catch(() => {});
    const next = await sb.getChatCustomAlertSettings(ctx.chat.id).catch(() => ({}));
    const kb = await buildCustomEditKb(sb, ctx.chat.id, kind);
    await ctx.editMessageText(buildCustomEditText(kind, next), { parse_mode: 'HTML', ...kb }).catch(() => {});
  });

  bot.action(/^notif_custom_delete:(war|cwl)$/, async (ctx) => {
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return;
    const actor = await ensureSessionUser(ctx);
    if (!actor || !isCapoOrCoCapo(actor)) {
      await ctx.answerCbQuery('✋ Solo Capo / Co-Capo / Admin CoCBoard.').catch(() => {});
      return;
    }
    const kind = ctx.match[1];
    const patch = kind === 'war'
      ? { war_enabled: false, war_paused: false, war_lead_minutes: null }
      : { cwl_enabled: false, cwl_paused: false, cwl_lead_minutes: null };
    await sb.upsertChatCustomAlertSettings(ctx.chat.id, patch, ctx.from?.id).catch(() => {});
    await ctx.answerCbQuery('🗑 Alert eliminato').catch(() => {});
    const next = await sb.getChatCustomAlertSettings(ctx.chat.id).catch(() => ({}));
    const kb = await buildCustomEditKb(sb, ctx.chat.id, kind);
    await ctx.editMessageText(buildCustomEditText(kind, next), { parse_mode: 'HTML', ...kb }).catch(() => {});
  });

  bot.action(/^notif_custom_input:(war|cwl)$/, async (ctx) => {
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id || !ctx.from?.id) return;
    const actor = await ensureSessionUser(ctx);
    if (!actor || !isCapoOrCoCapo(actor)) {
      await ctx.answerCbQuery('✋ Solo Capo / Co-Capo / Admin CoCBoard.').catch(() => {});
      return;
    }
    const kind = ctx.match[1];
    const key = `${ctx.chat.id}:${ctx.from.id}`;
    pendingCustomInput.set(key, kind);
    await ctx.answerCbQuery('✍️ Inserisci il tempo nel prossimo messaggio').catch(() => {});
    await replyEphemeral(
      ctx,
      `✍️ Inserisci il preavviso per ${kind === 'war' ? 'guerra' : 'CWL'}.\n` +
      'Formati: <code>90</code>, <code>90m</code>, <code>2h</code>, <code>2h 30m</code>, <code>1:45</code>.',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('« Indietro', `notif_custom_edit:${kind}`)],
          [Markup.button.callback('« Alert personalizzati', 'notif_custom_menu')],
        ]),
      },
    );
  });

  bot.action('notif_custom_cancel_input', async (ctx) => {
    safeAnswerCb(ctx);
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id || !ctx.from?.id) return;
    const key = `${ctx.chat.id}:${ctx.from.id}`;
    pendingCustomInput.delete(key);
    await ctx.answerCbQuery('Annullato').catch(() => {});
    const c = await sb.getChatCustomAlertSettings(ctx.chat.id).catch(() => ({}));
    const kb = await buildCustomMainKb(sb, ctx.chat.id);
    const text = buildCustomMainText(c);
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb }).catch(() => {});
  });

  // Consuma input manuale ore/minuti solo se l'utente è in stato "pending"
  bot.on('text', async (ctx, next) => {
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id || !ctx.from?.id) return next();
    const key = `${ctx.chat.id}:${ctx.from.id}`;
    const kind = pendingCustomInput.get(key);
    if (!kind) return next();
    pendingCustomInput.delete(key);
    const actor = await ensureSessionUser(ctx);
    if (!actor || !isCapoOrCoCapo(actor)) {
      await replyEphemeral(ctx, '✋ Solo Capo / Co-Capo / Admin CoCBoard possono configurare gli alert.');
      return;
    }
    const mins = parseLeadMinutesInput(ctx.message?.text || '');
    if (!mins) {
      await replyEphemeral(
        ctx,
        'Formato non valido. Esempi: <code>90</code>, <code>90m</code>, <code>2h</code>, <code>2h 30m</code>, <code>1:45</code>.',
        { parse_mode: 'HTML' },
      );
      return;
    }
    const patch = kind === 'war'
      ? { war_enabled: true, war_paused: false, war_lead_minutes: mins }
      : { cwl_enabled: true, cwl_paused: false, cwl_lead_minutes: mins };
    await sb.upsertChatCustomAlertSettings(ctx.chat.id, patch, ctx.from?.id).catch(() => {});
    await replyEphemeral(
      ctx,
      `✅ Alert personalizzato ${kind === 'war' ? 'guerra' : 'CWL'} impostato: <b>${fmtLeadMinutes(mins)}</b> prima.`,
      { parse_mode: 'HTML' },
    );
    if (ctx.message?.message_id != null) {
      await deleteLater(ctx.telegram, ctx.chat.id, ctx.message.message_id);
    }
  });

  // ── Compatibilità: vecchi callback (notif_war / cwl / raids / games) ───────
  // Reindirizza al nuovo menù per messaggi inviati prima dell'aggiornamento.
  for (const old of ['notif_war', 'notif_cwl', 'notif_raids', 'notif_games']) {
    bot.action(old, async (ctx) => {
      safeAnswerCb(ctx);
      if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return;
      const kb = await buildMainKb(sb, ctx.chat.id);
      try {
        await ctx.editMessageText(MAIN_TEXT, { parse_mode: 'HTML', ...kb });
      } catch (_) {
        await ctx.reply(MAIN_TEXT, { parse_mode: 'HTML', ...kb });
      }
    });
  }
}

module.exports = { setup, ALL_FLAG_KEYS, CATEGORIES, CAT_BY_ID, buildMainKb };
