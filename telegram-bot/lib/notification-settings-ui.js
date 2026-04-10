'use strict';
/**
 * UI impostazioni notifiche – CoCBoard Bot
 *
 * Menu gerarchico: lista categorie → sub-menu singola categoria → toggle flag.
 * Sola lettura: ospiti e utenti non capo possono vedere lo stato.
 * Modifica: solo Capo / Co-Capo / Admin CoCBoard (isCapoOrCoCapo).
 */

const { Markup } = require('telegraf');

const ON  = '✅';
const OFF = '⚪';
const tog = (v) => (v === true ? ON : OFF);

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
  rows.push([Markup.button.callback('« Menù', 'menu')]);
  return Markup.inlineKeyboard(rows);
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
    if (!ctx.cocboardUser || !isCapoOrCoCapo(ctx.cocboardUser)) {
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
