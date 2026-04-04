'use strict';

const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const { isUserAllowed, rateLimitOk } = require('./lib/access');
const api = require('./lib/cocboard-api');
const sb = require('./lib/supabase');
const fmt = require('./lib/format');
const tauth = require('./lib/telegram-auth');
const sbcCommunity = require('./lib/supabase-community');
const cv = require('./lib/community-validation');
const comm = require('./lib/community-handlers');
const privateUi = require('./lib/private-ui-cleanup');

const PORT = Number(process.env.PORT) || 3001;

/** Wizard registrazione / login (testo multi-step) */
const pendingAuth = new Map();
/** Cerca giocatore/clan (testo) — anche senza login */
const pendingSearch = new Map();
/** Wizard collegamento chat ↔ clan (solo privato) */
const pendingLinkWizard = new Map();
/** Wizard community: tag manuale chat globale, bozza reclutamento */
const pendingCommunity = new Map();
/** Dopo login da Community (profilo CoCBoard) → scelta chat globale vs menù */
const postAuthGlobalResume = new Map();

let cachedTgBotUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');

async function ensureTgBotUsername(telegram) {
  if (cachedTgBotUsername) return cachedTgBotUsername;
  try {
    const me = await telegram.getMe();
    cachedTgBotUsername = (me.username || '').replace(/^@/, '');
  } catch (_) {}
  return cachedTgBotUsername;
}

function privateChatUrl(username) {
  const u = (username || '').replace(/^@/, '');
  return u ? `https://t.me/${u}` : '';
}

function chatKind(ctx) {
  return ctx.chat?.type || 'private';
}

/** Gruppo, supergruppo o canale (dove serve collegamento clan). */
function isLinkedChatContext(ctx) {
  const t = chatKind(ctx);
  return t === 'group' || t === 'supergroup' || t === 'channel';
}

/** Capo / Co-Capo / Admin: collegano la chat al clan. */
function isClanLeader(user) {
  const r = user?.user_metadata?.role || 'utente';
  return ['admin', 'capo', 'co-capo'].includes(r);
}

function normClanTagEq(a, b) {
  if (!a || !b) return false;
  const x = String(a).trim().toUpperCase();
  const y = String(b).trim().toUpperCase();
  const xa = x.startsWith('#') ? x : `#${x}`;
  const yb = y.startsWith('#') ? y : `#${y}`;
  return xa === yb;
}

/** Errore API Telegram: chat inesistente o bot non più membro → riga su DB da eliminare. */
function isTelegramChatStaleError(err) {
  const code = err?.response?.error_code;
  const desc = String(err?.response?.description || err?.message || '').toLowerCase();
  if (code === 429) return false;
  if (code === 400) {
    if (desc.includes('not found')) return true;
    if (desc.includes('chat not found')) return true;
    if (desc.includes('peer_id_invalid')) return true;
    return false;
  }
  if (code === 403) {
    if (desc.includes('bot is not a member')) return true;
    if (desc.includes('not a member of')) return true;
    if (desc.includes('kicked')) return true;
    return false;
  }
  return false;
}

/** Rimuove da Supabase i collegamenti a gruppi/canali eliminati o da cui il bot è uscito. */
async function pruneStaleTelegramChatLinksForClan(telegram, clanTagRaw) {
  let ids;
  try {
    ids = await sb.listTelegramChatIdsForClan(clanTagRaw);
  } catch (_) {
    return;
  }
  if (!ids.length) return;
  let me;
  try {
    me = await telegram.getMe();
  } catch (_) {
    return;
  }
  const botId = me.id;
  for (const chatId of ids) {
    try {
      await telegram.getChat(chatId);
    } catch (e) {
      if (isTelegramChatStaleError(e)) await sb.deleteTelegramChatLink(chatId).catch(() => {});
      continue;
    }
    try {
      const member = await telegram.getChatMember(chatId, botId);
      if (member.status === 'left' || member.status === 'kicked') {
        await sb.deleteTelegramChatLink(chatId).catch(() => {});
      }
    } catch (e) {
      if (isTelegramChatStaleError(e)) await sb.deleteTelegramChatLink(chatId).catch(() => {});
    }
  }
}

/** Callback che non richiedono dati clan (gruppo/canale). */
const GROUP_LIGHT_CALLBACKS = new Set([
  'menu',
  'noop',
  'nav_search',
  'nav_rank',
  'helpbtn',
  'auth_guest_help',
  'auth_logout',
  'srch_p',
  'srch_c',
  'rk_p_i',
  'rk_p_g',
  'rk_c_i',
  'rk_c_g',
]);

function isClanHeavyCallback(data) {
  if (!data) return false;
  if (GROUP_LIGHT_CALLBACKS.has(data)) return false;
  if (data.startsWith('tut:')) return false;
  if (data.startsWith('addgrp_')) return false;
  return true;
}

/** In gruppo collegato tutti leggono dati clan; solo «nolink» blocca. */
async function getGroupChatGate(ctx) {
  if (!isLinkedChatContext(ctx)) {
    return { allowClanMenus: true, reason: 'private' };
  }
  const linked = await sb.getTelegramChatLink(ctx.chat.id).catch(() => null);
  if (!linked) {
    return { allowClanMenus: false, reason: 'nolink' };
  }
  return { allowClanMenus: true, reason: 'ok', linkedTag: linked.clan_tag };
}

async function blockGroupClanCallback(ctx) {
  if (!isLinkedChatContext(ctx) || !ctx.callbackQuery) return false;
  const d = ctx.callbackQuery.data || '';
  if (!isClanHeavyCallback(d)) return false;
  const gate = await getGroupChatGate(ctx);
  if (gate.allowClanMenus) return false;
  await ctx.answerCbQuery('Chat non collegata al clan').catch(() => {});
  await ctx.reply(fmt.formatGroupClanGateLong(gate), { parse_mode: 'HTML', ...backMenuKb() }).catch(() => {});
  return true;
}

async function blockGroupClanCommand(ctx) {
  if (!isLinkedChatContext(ctx) || !ctx.message?.text) return false;
  const t = ctx.message.text.trim();
  if (!t.startsWith('/')) return false;
  if (t.startsWith('/linkclan') || t.startsWith('/unlinkclan')) return false;
  const clanCmds = ['/membri', '/info', '/cwl', '/bonus', '/guerre', '/setclan', '/logout_clan', '/clan'];
  if (!clanCmds.some((c) => t.startsWith(c))) return false;
  const gate = await getGroupChatGate(ctx);
  if (gate.allowClanMenus) return false;
  await ctx.reply(fmt.formatGroupClanGateLong(gate), { parse_mode: 'HTML' }).catch(() => {});
  return true;
}

/** Gruppo → linked clan; privato → clan utente loggato. */
async function resolveEffectiveClanContext(ctx) {
  if (isLinkedChatContext(ctx)) {
    const linked = await sb.getTelegramChatLink(ctx.chat.id).catch(() => null);
    if (linked?.clan_tag) {
      let clanName = linked.clan_tag;
      try { const i = await api.clanInfo(linked.clan_tag); clanName = i.name || linked.clan_tag; } catch (_) {}
      return { clanTag: linked.clan_tag, clanName, hasOverride: false };
    }
  }
  if (ctx.cocboardUser && ctx.from?.id) {
    return getClanContextAuthed(ctx.from.id, ctx.cocboardUser);
  }
  return { clanTag: null, clanName: null, hasOverride: false };
}

async function resolveEffectiveClanTag(ctx) {
  return (await resolveEffectiveClanContext(ctx)).clanTag;
}

/** Callback che sono lettura dati clan (ammessi per ospiti in gruppi collegati). */
function isGroupClanReadCallback(d) {
  if (!d) return false;
  if (d === 'info' || d === 'cwl' || d === 'war_menu' || d === 'menu') return true;
  if (d === 'bonus:hist' || d === 'bonus:hof') return true;
  if (/^bonus:\d+$/.test(d)) return true;
  if (/^mb\d+$/.test(d)) return true;
  if (d.startsWith('cwl_v:')) return true;
  if (d.startsWith('war:')) return true;
  return false;
}

function isGroupClanReadCommand(t) {
  return ['/membri', '/info', '/cwl', '/bonus', '/guerre', '/start', '/cocboard'].some((c) => t.startsWith(c));
}

async function answerCbLoading(ctx, text = '⏳ Caricamento…') {
  if (ctx.callbackQuery) await ctx.answerCbQuery(text).catch(() => {});
}

function guardUserId(ctx) {
  return ctx.from?.id ?? ctx.callbackQuery?.from?.id;
}

function isPublicCallbackData(d) {
  if (!d) return false;
  return (
    d === 'menu' ||
    d === 'nav_search' ||
    d === 'nav_rank' ||
    d === 'srch_p' ||
    d === 'srch_c' ||
    d === 'rk_p_i' ||
    d === 'rk_p_g' ||
    d === 'rk_c_i' ||
    d === 'rk_c_g' ||
    d === 'noop'
  );
}

/** Community: chat globale + reclutamento anche senza login (owner queue esclusa). */
function isCommunityOpenGuestCallback(d) {
  if (!d) return false;
  return (
    d === 'comm_hub' ||
    d === 'comm_global' ||
    d === 'comm_gman' ||
    d === 'comm_gauth' ||
    d === 'comm_gprof' ||
    d === 'comm_gprof_sf' ||
    d === 'comm_gprof_sm' ||
    d === 'comm_postauth_global_join' ||
    d === 'comm_global_leave' ||
    d === 'comm_global_status' ||
    d === 'comm_recruit' ||
    d === 'comm_recruit_list' ||
    d === 'comm_recruit_send' ||
    d === 'comm_recruit_quick' ||
    d === 'comm_recruit_guided' ||
    d === 'recg_skip_link' ||
    d === 'recg_skip_media' ||
    d === 'recg_confirm' ||
    d === 'recg_cancel'
  );
}

/** Ospite in chat privata: scorciatoie web solo dopo login (menù autenticato). */
function buildPrivateGuestKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔑 Accedi', 'auth_login'), Markup.button.callback('📝 Registrati', 'auth_register')],
    [Markup.button.callback('💬 Community', 'comm_hub')],
    [Markup.button.callback('🔍 Cerca', 'nav_search'), Markup.button.callback('📊 Classifica', 'nav_rank')],
    [Markup.button.callback('ℹ️ Guida e tutorial', 'auth_guest_help')],
  ]);
}

/** Gruppo: login solo in privato; cerca/classifica pubbliche. */
function buildGroupGuestKb(botUsername) {
  const rows = [];
  const url = privateChatUrl(botUsername);
  if (url) {
    rows.push([Markup.button.url('🔐 Accedi / Registrati (privato)', url)]);
  }
  rows.push(
    [Markup.button.callback('🔍 Cerca', 'nav_search'), Markup.button.callback('📊 Classifica', 'nav_rank')],
    [Markup.button.callback('ℹ️ Guida gruppo', 'auth_guest_help')]
  );
  return Markup.inlineKeyboard(rows);
}

async function getClanContextAuthed(telegramUserId, user) {
  const saved = await sb.getSavedClanTag(telegramUserId).catch(() => null);
  if (saved) {
    try {
      const info = await api.clanInfo(saved);
      return { clanTag: saved, clanName: info.name || saved, hasOverride: true };
    } catch {
      return { clanTag: saved, clanName: saved, hasOverride: true };
    }
  }
  const raw = user?.user_metadata?.coc_clan_tag;
  if (!raw) return { clanTag: null, clanName: null, hasOverride: false };
  const u = String(raw).trim().toUpperCase();
  const tag = u.startsWith('#') ? u : `#${u}`;
  try {
    const info = await api.clanInfo(tag);
    return { clanTag: tag, clanName: info.name || tag, hasOverride: false };
  } catch {
    return { clanTag: tag, clanName: tag, hasOverride: false };
  }
}

async function resolveClanTagForCommands(telegramUserId, user) {
  const c = await getClanContextAuthed(telegramUserId, user);
  return c.clanTag;
}

async function handlePendingSearch(ctx) {
  const uid = ctx.from?.id;
  if (uid == null) return;
  const p = pendingSearch.get(uid);
  if (!p) return;
  const textRaw = (ctx.message?.text || '').trim();
  if (textRaw === '/cancel') {
    pendingSearch.delete(uid);
    await ctx.reply('Ricerca annullata.', backMenuKb());
    return;
  }
  if (!textRaw || textRaw.startsWith('/')) return;
  pendingSearch.delete(uid);
  try {
    if (p.kind === 'player') {
      const tag = fmt.parseTagArg(textRaw);
      if (!tag) {
        await ctx.reply('Tag non valido. Esempio: <code>#2ABC</code>', { parse_mode: 'HTML', ...backMenuKb() });
        return;
      }
      const data = await api.lookupPlayer(tag);
      await ctx.reply(fmt.formatPlayerSummary(data), { parse_mode: 'HTML', ...backMenuKb() });
      return;
    }
    if (p.kind === 'clan') {
      if (textRaw.length < 3) {
        await ctx.reply('Scrivi almeno 3 caratteri per il nome del clan.', backMenuKb());
        return;
      }
      const data = await api.searchClans(textRaw);
      const txt = fmt.formatClanSearch(data.items || []);
      await ctx.reply(txt, { parse_mode: 'HTML', ...backMenuKb() });
    }
  } catch (e) {
    await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...backMenuKb() });
  }
}

function linkClanConfirmKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Conferma questo clan', 'addgrp_ok')],
    [Markup.button.callback('✏️ Cambia tag clan', 'addgrp_chg')],
    [Markup.button.callback('« Annulla', 'addgrp_can')],
  ]);
}

async function presentLinkClanChoice(ctx, clanTag) {
  const uid = ctx.from?.id;
  let clanName = clanTag;
  try {
    const info = await api.clanInfo(clanTag);
    clanName = info.name || clanTag;
  } catch (e) {
    await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...backMenuKb() });
    if (uid != null) pendingLinkWizard.delete(uid);
    return;
  }
  const body =
    `🔗 <b>Collegamento chat</b>\n\n` +
    `Clan: <b>${fmt.escapeHtml(clanName)}</b> <code>${fmt.escapeHtml(clanTag)}</code>\n\n` +
    `Confermi?`;
  const kb = linkClanConfirmKb();
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(body, { parse_mode: 'HTML', ...kb });
    }
  } else {
    await ctx.reply(body, { parse_mode: 'HTML', ...kb });
  }
}

async function handlePendingLinkWizard(ctx) {
  const uid = ctx.from?.id;
  if (uid == null || isLinkedChatContext(ctx)) return;
  const w = pendingLinkWizard.get(uid);
  if (!w?.awaitingTag) return;
  const textRaw = (ctx.message.text || '').trim();
  const tag = fmt.parseTagArg(textRaw);
  if (!tag) {
    await ctx.reply('Tag non valido. Esempio: <code>#2ABC</code>', { parse_mode: 'HTML' });
    return;
  }
  try {
    await api.clanInfo(tag);
  } catch (e) {
    await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
    return;
  }
  pendingLinkWizard.set(uid, { clanTag: tag });
  await presentLinkClanChoice(ctx, tag);
}

async function startAddGroupWizard(ctx) {
  if (!ctx.from?.id) return;
  if (isLinkedChatContext(ctx)) return;
  if (!isClanLeader(ctx.cocboardUser)) {
    await ctx.answerCbQuery('Solo Capo / Co-Capo / Admin.').catch(() => {});
    return;
  }
  const uid = ctx.from.id;
  const { clanTag } = await getClanContextAuthed(uid, ctx.cocboardUser);
  if (!clanTag) {
    await ctx.answerCbQuery('Imposta un clan').catch(() => {});
    const hint = '⚠️ Imposta prima un clan sul profilo o con <code>/setclan #TAG</code>.';
    try {
      await ctx.editMessageText(hint, { parse_mode: 'HTML', ...backMenuKb() });
    } catch (_) {
      await ctx.reply(hint, { parse_mode: 'HTML', ...backMenuKb() });
    }
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  pendingLinkWizard.set(uid, { clanTag });
  await presentLinkClanChoice(ctx, clanTag);
}

const GLOBAL_CHAT_LEAVE_HINT =
  '👋 <i>Sei uscito dalla <b>chat globale</b>.</i> Non ricevi più i messaggi della stanza. Per rientrare: <b>Community → Chat globale</b>.';

/** Se iscritto attivo alla chat globale: disiscrive, elimina hub, pending. @returns {boolean} se era in stanza */
async function leaveGlobalIfActive(ctx, opts = {}) {
  const notify = opts.notify === true;
  const uid = ctx.from?.id;
  if (uid == null || isLinkedChatContext(ctx) || ctx.chat?.type !== 'private') return false;
  const active = await sbcCommunity.isActiveInGlobalChat(uid).catch(() => false);
  if (!active) return false;
  const sub = await sbcCommunity.getGlobalSubscriber(uid).catch(() => null);
  if (sub?.hub_message_id != null) {
    try {
      await ctx.telegram.deleteMessage(uid, Number(sub.hub_message_id));
    } catch (_) {}
  }
  await privateUi.purgeGlobalEphemeralOnly(ctx.telegram, uid).catch(() => {});
  await sbcCommunity.deactivateGlobalSubscriber(uid).catch(() => {});
  pendingCommunity.delete(uid);
  if (notify) {
    await ctx.reply(GLOBAL_CHAT_LEAVE_HINT, { parse_mode: 'HTML' }).catch(() => {});
  }
  return true;
}

async function sendPostAuthGlobalChoice(ctx) {
  const text =
    `✅ <b>Accesso effettuato.</b>\n\n` +
    `Vuoi entrare in <b>chat globale</b> con il profilo CoCBoard (✅ verificato in chat) oppure aprire il <b>menù principale</b>?`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('🌍 Chat globale (profilo ✅)', 'comm_postauth_global_join')],
    [Markup.button.callback('🏠 Menù principale', 'menu')],
  ]);
  await ctx.reply(text, { parse_mode: 'HTML', ...kb });
}

async function handlePendingMessage(ctx) {
  const uid = ctx.from?.id;
  if (uid == null) return;
  if (isLinkedChatContext(ctx)) {
    await ctx.reply(fmt.formatPrivateOnlyWizard(), { parse_mode: 'HTML' });
    return;
  }
  const textRaw = (ctx.message.text || '').trim();
  if (textRaw === '/cancel') {
    pendingAuth.delete(uid);
    pendingLinkWizard.delete(uid);
    await ctx.reply('Operazione annullata.');
    await sendGuestMenu(ctx);
    return;
  }

  const p = pendingAuth.get(uid);
  if (!p) return;

  if (p.kind === 'login') {
    if (p.step === 1) {
      p.username = textRaw;
      p.step = 2;
      await ctx.reply(
        '🔒 Invia la <b>password</b>.\n<i>Elimina i messaggi con tutore sensibile se preferisci.</i>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (p.step === 2) {
      pendingAuth.delete(uid);
      const pwd = textRaw;
      let loadingMsg = null;
      try {
        await ctx.deleteMessage().catch(() => {});
        loadingMsg = await ctx.reply('⏳ <b>Accesso in corso…</b>', { parse_mode: 'HTML' });
        const data = await tauth.signInWithPasswordFromInput(p.username, pwd);
        await sb.saveAuthSession(uid, data.session, data.user);
        if (loadingMsg?.message_id) {
          await ctx.telegram.deleteMessage(uid, loadingMsg.message_id).catch(() => {});
        }
        await ctx.reply('✅ <b>Accesso effettuato.</b>', { parse_mode: 'HTML' });
        if (postAuthGlobalResume.get(uid) === 'global_profile') {
          postAuthGlobalResume.delete(uid);
          await sendPostAuthGlobalChoice(ctx);
        } else {
          await reopenMainMenu(ctx, data.user);
        }
      } catch (e) {
        if (loadingMsg?.message_id) {
          await ctx.telegram.deleteMessage(uid, loadingMsg.message_id).catch(() => {});
        }
        postAuthGlobalResume.delete(uid);
        await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
        await sendGuestMenu(ctx);
      }
    }
    return;
  }

  if (p.kind === 'reg') {
    if (p.step === 1) {
      const tag = fmt.parseTagArg(textRaw);
      if (!tag) {
        await ctx.reply('Tag non valido. Invia un tag tipo <code>#2ABC</code>', { parse_mode: 'HTML' });
        return;
      }
      p.tag = tag;
      p.step = 2;
      await ctx.reply(
        '🔑 Invia la <b>chiave API</b> dall’app CoC (Impostazioni → Altre impostazioni → Chiave API).',
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (p.step === 2) {
      if (textRaw.length < 8) {
        await ctx.reply('Chiave API troppo corta. Riprova.');
        return;
      }
      p.apiToken = textRaw;
      p.step = 3;
      await ctx.reply('🔒 Scegli una <b>password</b> (minimo 6 caratteri) per l’account CoCBoard.', {
        parse_mode: 'HTML',
      });
      return;
    }
    if (p.step === 3) {
      if (textRaw.length < 6) {
        await ctx.reply('Password troppo corta (min 6). Riprova.');
        return;
      }
      await ctx.deleteMessage().catch(() => {});
      p.password = textRaw;
      p.step = 4;
      await ctx.reply(
        '📧 Invia un’<b>email</b> per recupero password (opzionale).\nScrivi <code>-</code> per saltare.',
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (p.step === 4) {
      const emailOpt = textRaw === '-' ? undefined : textRaw;
      if (emailOpt && !emailOpt.includes('@')) {
        await ctx.reply('Email non valida. Riprova o <code>-</code>', { parse_mode: 'HTML' });
        return;
      }
      pendingAuth.delete(uid);
      let loadingMsg = null;
      try {
        loadingMsg = await ctx.reply('⏳ <b>Caricamento…</b>', { parse_mode: 'HTML' });
        const reg = await api.registerWithCoc({
          playerTag: p.tag,
          apiToken: p.apiToken,
          password: p.password,
          email: emailOpt,
        });
        const sign = await tauth.signInWithEmailPassword(reg.email, p.password);
        await sb.saveAuthSession(uid, sign.session, sign.user);
        if (loadingMsg?.message_id) {
          await ctx.telegram.deleteMessage(uid, loadingMsg.message_id).catch(() => {});
        }
        await ctx.reply(`✅ Registrato come <b>${fmt.escapeHtml(reg.username)}</b>.`, { parse_mode: 'HTML' });
        if (postAuthGlobalResume.get(uid) === 'global_profile') {
          postAuthGlobalResume.delete(uid);
          await sendPostAuthGlobalChoice(ctx);
        } else {
          await reopenMainMenu(ctx, sign.user);
        }
      } catch (e) {
        if (loadingMsg?.message_id) {
          await ctx.telegram.deleteMessage(uid, loadingMsg.message_id).catch(() => {});
        }
        postAuthGlobalResume.delete(uid);
        await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
        await sendGuestMenu(ctx);
      }
    }
  }
}

async function showTutorialMessage(ctx, step) {
  const body = fmt.formatTutorialStep(step);
  const rows = [];
  if (step < 3) {
    rows.push([Markup.button.callback('Avanti ➡️', `tut:${step + 1}`)]);
  } else {
    rows.push([Markup.button.callback('✅ Apri menù', 'tut:done')]);
  }
  rows.push([Markup.button.callback('⏭ Salta tutorial', 'tut:skip')]);
  await ctx.reply(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  if (ctx.chat?.type === 'private') await refreshPrivateReplyKeyboard(ctx);
}

async function reopenMainMenu(ctx, user) {
  ctx.cocboardUser = user;
  const uid = ctx.from?.id;
  if (uid != null && !isLinkedChatContext(ctx)) {
    try {
      const row = await sb.getFullRow(uid);
      if (row && row.tutorial_completed_at == null) {
        await showTutorialMessage(ctx, 1);
        return;
      }
    } catch (_) {}
  }
  await sendMainMenu(ctx);
}

/** Etichette tastiera reply (chat privata) — devono coincidere con l’handler testo. */
const PRIVATE_RK_MENU = 'Menu principale';
const PRIVATE_RK_HELP = 'Help';
const PRIVATE_RK_EXIT_GLOBAL = 'Esci dalla chat globale';
const PRIVATE_RK_CANCEL_RECRUIT = 'Annulla reclutamento';

/** Ultimo messaggio usato solo per tenere visibile la reply keyboard (stesso uid → sostituito a ogni refresh). */
const privateReplyKeyboardAnchorIds = new Map();

privateUi.setOnBeforePrivateUiWipe((uid) => {
  privateReplyKeyboardAnchorIds.delete(uid);
});

async function buildPrivateReplyKeyboardMarkup(uid) {
  const rows = [[Markup.button.text(PRIVATE_RK_MENU), Markup.button.text(PRIVATE_RK_HELP)]];
  if (await sbcCommunity.isActiveInGlobalChat(uid).catch(() => false)) {
    rows.push([Markup.button.text(PRIVATE_RK_EXIT_GLOBAL)]);
  }
  const p = pendingCommunity.get(uid);
  if (p?.kind === 'recruit_guided' || p?.kind === 'recruit_body') {
    rows.push([Markup.button.text(PRIVATE_RK_CANCEL_RECRUIT)]);
  }
  return Markup.keyboard(rows).resize().persistent(true);
}

async function refreshPrivateReplyKeyboard(ctx) {
  if (ctx.chat?.type !== 'private' || ctx.from?.id == null) return;
  const uid = ctx.from.id;
  const chatId = ctx.chat.id;
  const prev = privateReplyKeyboardAnchorIds.get(uid);
  if (prev != null) {
    try {
      await ctx.telegram.deleteMessage(chatId, prev);
    } catch (_) {}
    privateReplyKeyboardAnchorIds.delete(uid);
  }
  let kb;
  try {
    kb = await buildPrivateReplyKeyboardMarkup(uid);
  } catch (_) {
    return;
  }
  const sendAnchor = async (text) => {
    const msg = await ctx.telegram.sendMessage(chatId, text, { reply_markup: kb.reply_markup });
    if (msg?.message_id) {
      privateReplyKeyboardAnchorIds.set(uid, msg.message_id);
      privateUi.notePrivateUiMessage(uid, msg.message_id);
    }
  };
  try {
    await sendAnchor('·');
  } catch (_) {
    try {
      await sendAnchor('\u2060');
    } catch (_) {}
  }
}

async function dispatchHelpCommand(ctx) {
  if (!ctx.from?.id) return;
  const sess = await tauth.getValidSession(ctx.from.id);
  if (!sess) {
    await ensureTgBotUsername(ctx.telegram);
    const text = isLinkedChatContext(ctx) ? fmt.formatGroupHelp() : fmt.formatGuestHelp();
    const kb = isLinkedChatContext(ctx) ? buildGroupGuestKb(cachedTgBotUsername) : buildPrivateGuestKb();
    await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    if (ctx.chat?.type === 'private') await refreshPrivateReplyKeyboard(ctx);
    return;
  }
  const lines = [
    `${fmt.DIV}`,
    `📖 <b>Aiuto CoCBoard</b>`,
    `${fmt.DIV}`,
    '',
    `🔍 <b>Cerca e classifica</b> (anche senza account)`,
    `Pulsanti nel menù o <code>/player</code> · <code>/cerca_clan</code>`,
    '',
    `💬 <b>Community</b> (anche ospite)`,
    `Chat globale e reclutamento dal menù.`,
    '',
    `🏰 <b>Clan</b>`,
    `<code>/setclan #TAG</code> — altro clan\n<code>/logout_clan</code> — rimuovi override`,
    '',
    `📊 <b>Dati clan</b>`,
    `<code>/membri</code> · <code>/info</code> · <code>/cwl</code> · <code>/bonus</code> · <code>/guerre</code>`,
    '',
    `🚪 <code>/esci</code> o <b>Logout</b> nel menù`,
    '',
    `🔗 <b>Gruppo / canale</b> (Capo / Co-Capo / Admin)`,
    `Menù → <b>Aggiungi a canale/gruppo</b>, poi in chat: <code>/linkclan TOKEN</code> · <code>/unlinkclan</code>`,
    '',
    `<code>/cocboard</code> — menù (gruppo/canale consigliato) · <code>/start</code> — menù (privato)`,
  ];
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  if (ctx.chat?.type === 'private') await refreshPrivateReplyKeyboard(ctx);
}

function safeAnswerCb(ctx) {
  try {
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  } catch (_) {}
}

function guardMiddleware() {
  return async (ctx, next) => {
    const uid = guardUserId(ctx);
    if (uid == null) return next();
    if (!isUserAllowed(uid)) {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Accesso non autorizzato.').catch(() => {});
      else await ctx.reply('Accesso non autorizzato.').catch(() => {});
      return;
    }
    if (!rateLimitOk(uid)) {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Rallenta un attimo.').catch(() => {});
      else if (ctx.message) await ctx.reply('⏳ Rallenta un attimo.').catch(() => {});
      return;
    }
    return next();
  };
}

async function sendGuestMenu(ctx) {
  await ensureTgBotUsername(ctx.telegram);
  if (isLinkedChatContext(ctx)) {
    const linked = await sb.getTelegramChatLink(ctx.chat.id).catch(() => null);
    if (linked?.clan_tag) return sendLinkedGroupGuestMenu(ctx, linked.clan_tag);
  }
  const group = isLinkedChatContext(ctx);
  const text = group
    ? fmt.formatGuestWelcomeGroup(privateChatUrl(cachedTgBotUsername))
    : fmt.formatGuestWelcomePrivate();
  const kb = group ? buildGroupGuestKb(cachedTgBotUsername) : buildPrivateGuestKb();
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...kb });
  }
  if (!group) await refreshPrivateReplyKeyboard(ctx);
}

async function sendLinkedGroupGuestMenu(ctx, clanTag) {
  let clanName = clanTag;
  try { const info = await api.clanInfo(clanTag); clanName = info.name || clanTag; } catch (_) {}
  await ensureTgBotUsername(ctx.telegram);
  const intro = fmt.formatLinkedGroupGuestIntro({ clanTag, clanName, botUsername: cachedTgBotUsername });
  const rows = [
    [Markup.button.callback('👥 Membri', 'mb0'), Markup.button.callback('🏰 Info clan', 'info')],
    [Markup.button.callback('🏆 CWL live', 'cwl'), Markup.button.callback('📜 Registro guerre', 'war_menu')],
    [Markup.button.callback('🔍 Cerca', 'nav_search'), Markup.button.callback('📊 Classifica', 'nav_rank')],
  ];
  const url = privateChatUrl(cachedTgBotUsername);
  if (url) {
    rows.push([Markup.button.url('🔐 Accedi per Bonus e Web App (privato)', url)]);
  }
  rows.push([Markup.button.callback('❓ Aiuto', 'helpbtn')]);
  const kb = Markup.inlineKeyboard(rows);
  if (ctx.callbackQuery) {
    try { await ctx.editMessageText(intro, { parse_mode: 'HTML', ...kb }); }
    catch (_) { await ctx.reply(intro, { parse_mode: 'HTML', ...kb }); }
  } else {
    await ctx.reply(intro, { parse_mode: 'HTML', ...kb });
  }
}

async function buildWebAppHandoffUrl(ctx, extraParams = {}) {
  const base = (process.env.COCBOARD_SITE_HOME_URL || '').trim().replace(/\/$/, '');
  if (!base || !ctx.from?.id) return null;
  await tauth.getValidSession(ctx.from.id);
  const code = await sb.createWebAppHandoff(ctx.from.id);
  const q = new URLSearchParams({ tg_h: code });
  Object.entries(extraParams).forEach(([k, v]) => {
    if (v != null && v !== '') q.set(k, String(v));
  });
  return `${base}/?${q.toString()}`;
}

async function mainMenuKeyboard(ctx, user, hasClanTag) {
  const rows = [];
  const leader = user ? isClanLeader(user) : false;
  const grp = isLinkedChatContext(ctx);
  if (!grp) {
    rows.push([Markup.button.callback('💬 Community', 'comm_hub')]);
  }
  rows.push([
    Markup.button.callback('🔍 Cerca', 'nav_search'),
    Markup.button.callback('📊 Classifica', 'nav_rank'),
  ]);
  let showClanRows = !!hasClanTag;
  if (grp) {
    const g = await getGroupChatGate(ctx);
    showClanRows = g.allowClanMenus;
  }
  if (showClanRows) {
    rows.push(
      [Markup.button.callback('👥 Membri', 'mb0'), Markup.button.callback('🏰 Info clan', 'info')],
      [Markup.button.callback('🏆 CWL live', 'cwl'), Markup.button.callback('📜 Registro guerre', 'war_menu')]
    );
    rows.push([Markup.button.callback('🎁 Bonus', 'bonus:0')]);
    if (user?.user_metadata?.coc_tag) {
      rows.push([Markup.button.callback('👤 Il mio profilo', 'me')]);
    }
  } else if (!hasClanTag) {
    rows.push([Markup.button.callback('🏰 Come impostare il clan', 'setclan_help')]);
  }
  if (leader && !grp) {
    rows.push([Markup.button.callback('➕ Aggiungi a canale/gruppo', 'add_group_bot')]);
  }
  if (!grp && user) {
    try {
      const webPairs = [
        ['🏆 CWL live', 'cwl_warlog', '📜 Registro guerre', 'warlog'],
        ['🎁 Bonus', 'bonus', '🏰 Info / Membri', 'members'],
        ['👤 Profilo', 'profilo', '🔍 Cerca', 'cerca'],
      ];
      for (const [la, ta, lb, tb] of webPairs) {
        const ua = await buildWebAppHandoffUrl(ctx, { open_tab: ta });
        const ub = await buildWebAppHandoffUrl(ctx, { open_tab: tb });
        if (
          ua &&
          ub &&
          String(ua).startsWith('https://') &&
          String(ub).startsWith('https://')
        ) {
          rows.push([
            Markup.button.webApp(`${la} (web)`, ua),
            Markup.button.webApp(`${lb} (web)`, ub),
          ]);
        }
      }
      const wr = await buildWebAppHandoffUrl(ctx, { open_tab: 'rankings' });
      if (wr && String(wr).startsWith('https://')) {
        rows.push([Markup.button.webApp('📊 Classifica (web)', wr)]);
      }
    } catch (_) {}
  }
  rows.push(
    [Markup.button.callback('⚙️ Account', 'acct'), Markup.button.callback('❓ Aiuto', 'helpbtn')],
    [Markup.button.callback('🚪 Logout', 'auth_logout')]
  );
  return Markup.inlineKeyboard(rows);
}

async function sendMainMenu(ctx) {
  const uid = ctx.from?.id;
  const sess = await tauth.getValidSession(uid);
  const user = sess?.user || ctx.cocboardUser;
  if (!user) return sendGuestMenu(ctx);

  const meta = user.user_metadata || {};
  const display = meta.username || (user.email || '').split('@')[0] || 'Comandante';
  const { clanTag, clanName, hasOverride } = await resolveEffectiveClanContext(ctx);
  const grp = isLinkedChatContext(ctx);
  const intro = fmt.formatAuthedMenuIntro({
    displayName: display,
    clanTag,
    clanName,
    hasClanOverride: hasOverride,
    chatHint: grp ? 'Sei in gruppo o canale.' : '',
    groupMenuBanner: '',
  });
  const kb = await mainMenuKeyboard(ctx, user, !!clanTag);
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(intro, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(intro, { parse_mode: 'HTML', ...kb });
    }
  } else {
    await ctx.reply(intro, { parse_mode: 'HTML', ...kb });
  }
  if (!grp && ctx.chat?.type === 'private') await refreshPrivateReplyKeyboard(ctx);
}

function backMenuKb() {
  return Markup.inlineKeyboard([[Markup.button.callback('« Menù', 'menu')]]);
}

function buildMembersKb(page, pages) {
  const row = [];
  if (page > 0) row.push(Markup.button.callback('◀', `mb${page - 1}`));
  row.push(Markup.button.callback(`· ${page + 1}/${pages} ·`, 'noop'));
  if (page < pages - 1) row.push(Markup.button.callback('▶', `mb${page + 1}`));
  return Markup.inlineKeyboard([row, [Markup.button.callback('« Menù', 'menu')]]);
}

function pickWebhookDomain() {
  const manual = (process.env.TELEGRAM_WEBHOOK_DOMAIN || '').trim();
  if (manual) return manual.replace(/\/$/, '');
  const render = (process.env.RENDER_EXTERNAL_URL || '').trim();
  if (render) return render.replace(/\/$/, '');
  return '';
}

function pickWebhookPath() {
  const p = (process.env.TELEGRAM_WEBHOOK_SECRET_PATH || '').trim();
  if (p) return p.startsWith('/') ? p : `/${p}`;
  if ((process.env.RENDER_EXTERNAL_URL || '').trim()) return '/tg/cocboard-webhook';
  return '';
}

function webhookPublicUrl() {
  const domain = pickWebhookDomain();
  const pathRaw = pickWebhookPath();
  if (!domain || !pathRaw) return null;
  const path = pathRaw.startsWith('/') ? pathRaw : `/${pathRaw}`;
  return `${String(domain).replace(/\/$/, '')}${path}`;
}

/** Svuota la coda update lato Telegram (non riavvia il processo Render). */
async function refreshWebhookDropPending(telegram) {
  const url = webhookPublicUrl();
  if (!url) return;
  const secretToken = (process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN || '').trim();
  try {
    await telegram.setWebhook(url, {
      secret_token: secretToken || undefined,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      drop_pending_updates: true,
    });
    console.log('[cocboard-bot] setWebhook(drop_pending_updates) dopo logout');
  } catch (e) {
    console.error('[cocboard-bot] refreshWebhookDropPending', e.message || e);
  }
}

async function performFullLogout(ctx, { viaCommand }) {
  const uid = ctx.from?.id;
  if (uid == null) {
    if (viaCommand) await ctx.reply('⚠️ Comando non applicabile.').catch(() => {});
    else await ctx.answerCbQuery('Errore: mittente sconosciuto').catch(() => {});
    return;
  }
  try {
    await sb.clearAuthSession(uid);
  } catch (e) {
    console.error('[cocboard-bot] clearAuthSession', e.message || e);
  }
  pendingAuth.delete(uid);
  pendingSearch.delete(uid);
  pendingLinkWizard.delete(uid);
  pendingCommunity.delete(uid);
  postAuthGlobalResume.delete(uid);
  const subG = await sbcCommunity.getGlobalSubscriber(uid).catch(() => null);
  if (subG?.hub_message_id != null) {
    try {
      await ctx.telegram.deleteMessage(uid, Number(subG.hub_message_id));
    } catch (_) {}
  }
  await privateUi.purgeGlobalEphemeralOnly(ctx.telegram, uid).catch(() => {});
  await sbcCommunity.deactivateGlobalSubscriber(uid).catch(() => {});
  await refreshWebhookDropPending(ctx.telegram);
  if (viaCommand) {
    await ctx
      .reply(
        '👋 <b>Logout:</b> sessione sul bot cancellata; wizard annullato; messaggi in coda su Telegram ignorati.',
        { parse_mode: 'HTML' }
      )
      .catch(() => {});
  } else {
    await ctx.answerCbQuery('Logout: sessione e coda azzerate.').catch(() => {});
  }
  await sendGuestMenu(ctx);
}

function parseCwlViewKey(raw) {
  if (raw === 'ov') return { view: 'ov', pPage: 0, rIdx: 0 };
  if (raw === 'g') return { view: 'g', pPage: 0, rIdx: 0 };
  const pm = /^p:(\d+)$/.exec(raw);
  if (pm) return { view: 'p', pPage: Number(pm[1]), rIdx: 0 };
  const rm = /^r:(\d+)$/.exec(raw);
  if (rm) return { view: 'r', pPage: 0, rIdx: Number(rm[1]) };
  return { view: 'ov', pPage: 0, rIdx: 0 };
}

function warSubmenuKb() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🏹 War classiche', 'war:classic'),
      Markup.button.callback('🏆 Cronologia leghe', 'war:cwl'),
    ],
    [Markup.button.callback('« Menù', 'menu')],
  ]);
}

function buildCwlNavKb(data, spec, webAppUrl) {
  const { view, pPage, rIdx } = spec;
  if (!data || data.state === 'notInWar') {
    return Markup.inlineKeyboard([[Markup.button.callback('« Menù', 'menu')]]);
  }
  const pPages = fmt.getCwlPlayerPageCount(data);
  const rCount = fmt.getCwlRoundCount(data);
  const defaultRoundIdx = fmt.getDefaultCwlRoundIndex(data);
  const turniIdx = view === 'r' ? rIdx : defaultRoundIdx;

  const tab = (active, short, payload) =>
    Markup.button.callback(active ? `· ${short} ·` : short, payload);

  const rows = [
    [
      tab(view === 'ov', '📊 Pan', 'cwl_v:ov'),
      tab(view === 'g', '🏅 Gruppo', 'cwl_v:g'),
    ],
    [
      tab(view === 'p', '👥 Roster', 'cwl_v:p:0'),
      tab(view === 'r', '⚔️ Turni', `cwl_v:r:${turniIdx}`),
    ],
  ];

  if (view === 'p' && pPages > 1) {
    const prev = Math.max(0, pPage - 1);
    const next = Math.min(pPages - 1, pPage + 1);
    rows.push([
      Markup.button.callback('◀', `cwl_v:p:${prev}`),
      Markup.button.callback(`· ${pPage + 1}/${pPages} ·`, 'noop'),
      Markup.button.callback('▶', `cwl_v:p:${next}`),
    ]);
  }

  if (view === 'r' && rCount > 1) {
    const prev = Math.max(0, rIdx - 1);
    const next = Math.min(rCount - 1, rIdx + 1);
    rows.push([
      Markup.button.callback('◀ Turno', `cwl_v:r:${prev}`),
      Markup.button.callback(`· ${rIdx + 1}/${rCount} ·`, 'noop'),
      Markup.button.callback('Turno ▶', `cwl_v:r:${next}`),
    ]);
  }

  if (view === 'r' && webAppUrl) {
    rows.push([Markup.button.webApp('🌐 Visualizza versione web', webAppUrl)]);
  }

  rows.push([Markup.button.callback('« Menù', 'menu')]);
  return Markup.inlineKeyboard(rows);
}

async function loadAndShowCwl(ctx, clanTag, viewSpec) {
  const data = await api.cwlStats(clanTag);
  let webAppUrl = null;
  if (
    data?.state !== 'notInWar' &&
    viewSpec.view === 'r' &&
    ctx?.from?.id != null &&
    !isLinkedChatContext(ctx) &&
    ctx.cocboardUser
  ) {
    try {
      const idx = fmt.getDefaultCwlRoundIndex(data);
      const rn = (data.roundsData || [])[idx]?.roundNumber;
      const extra = { open_tab: 'cwl_warlog' };
      if (rn != null) extra.cwl_round = String(rn);
      webAppUrl = await buildWebAppHandoffUrl(ctx, extra);
      if (webAppUrl && !String(webAppUrl).startsWith('https://')) webAppUrl = null;
    } catch (e) {
      console.warn('[cocboard-bot] webApp handoff', e.message || e);
    }
  }
  const formatted = fmt.formatCwlScreen(data, viewSpec.view, viewSpec.pPage, viewSpec.rIdx);
  const kb = buildCwlNavKb(data, formatted, webAppUrl);
  return { text: formatted.text, kb, data };
}

async function sendCwlMessages(ctx, text, kb) {
  const parts = fmt.chunkForTelegram(text);
  for (let i = 0; i < parts.length; i++) {
    const extra = i === parts.length - 1 ? kb : {};
    await ctx.reply(parts[i], { parse_mode: 'HTML', ...extra });
  }
}

async function editOrReplyCwl(ctx, text, kb) {
  const parts = fmt.chunkForTelegram(text);
  try {
    await ctx.editMessageText(parts[0], { parse_mode: 'HTML', ...kb });
  } catch (_) {
    await ctx.reply(parts[0], { parse_mode: 'HTML', ...kb });
  }
  for (let i = 1; i < parts.length; i++) {
    await ctx.reply(parts[i], { parse_mode: 'HTML' });
  }
}

function bonusHistHofBackKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('« Bonus attuali', 'bonus:0'), Markup.button.callback('« Menù', 'menu')],
  ]);
}

async function editOrReplyChunkedHtml(ctx, text, kb) {
  const parts = fmt.chunkForTelegram(text);
  try {
    await ctx.editMessageText(parts[0], { parse_mode: 'HTML', ...kb });
  } catch (_) {
    await ctx.reply(parts[0], { parse_mode: 'HTML', ...kb });
  }
  for (let i = 1; i < parts.length; i++) {
    await ctx.reply(parts[i], { parse_mode: 'HTML' });
  }
}

function rankPickKb() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⭐ Gioc. Italia', 'rk_p_i'),
      Markup.button.callback('⭐ Gioc. Mondo', 'rk_p_g'),
    ],
    [
      Markup.button.callback('🏰 Clan Italia', 'rk_c_i'),
      Markup.button.callback('🏰 Clan Mondo', 'rk_c_g'),
    ],
    [Markup.button.callback('« Menù', 'menu')],
  ]);
}

async function buildSearchPickKb(ctx) {
  const rows = [
    [
      Markup.button.callback('👤 Villaggio (#tag)', 'srch_p'),
      Markup.button.callback('🏰 Clan (nome)', 'srch_c'),
    ],
  ];
  if (!isLinkedChatContext(ctx) && ctx.from?.id) {
    try {
      const sess = await tauth.getValidSession(ctx.from.id);
      if (sess) {
        const wctx = { ...ctx, cocboardUser: sess.user };
        const wu = await buildWebAppHandoffUrl(wctx, { open_tab: 'cerca' });
        if (wu && String(wu).startsWith('https://')) {
          rows.push([Markup.button.webApp('🌐 Cerca (versione web)', wu)]);
        }
      }
    } catch (_) {}
  }
  rows.push([Markup.button.callback('« Menù', 'menu')]);
  return Markup.inlineKeyboard(rows);
}

async function buildBonusKeyboard(ctx, page, pages) {
  const row = [];
  if (pages > 1) {
    if (page > 0) row.push(Markup.button.callback('◀', `bonus:${page - 1}`));
    row.push(Markup.button.callback(`· ${page + 1}/${pages} ·`, 'noop'));
    if (page < pages - 1) row.push(Markup.button.callback('▶', `bonus:${page + 1}`));
  }
  const rows = row.length ? [row] : [];
  rows.push([Markup.button.callback('📅 Storico per stagione', 'bonus:hist'), Markup.button.callback('🏆 Classifica riceventi', 'bonus:hof')]);
  if (!isLinkedChatContext(ctx) && ctx.cocboardUser) {
    try {
      const wu = await buildWebAppHandoffUrl(ctx, { open_tab: 'bonus' });
      if (wu && String(wu).startsWith('https://')) {
        rows.push([Markup.button.webApp('🌐 Gestisci bonus (web)', wu)]);
      }
    } catch (_) {}
  }
  rows.push([Markup.button.callback('« Menù', 'menu')]);
  return Markup.inlineKeyboard(rows);
}

async function registerBotCommands(telegram) {
  try {
    const priv = [
      { command: 'start', description: 'Menù principale' },
      { command: 'cocboard', description: 'Menù CoCBoard' },
      { command: 'help', description: 'Aiuto' },
      { command: 'cerca', description: 'Cerca villaggio o clan' },
      { command: 'classifica', description: 'Classifiche trofei' },
      { command: 'esci_chat_global', description: 'Esci dalla chat globale' },
      { command: 'annulla_reclutamento', description: 'Annulla bozza reclutamento' },
    ];
    const grp = [
      { command: 'cocboard', description: 'Menù CoCBoard' },
      { command: 'cerca', description: 'Cerca villaggio o clan' },
      { command: 'classifica', description: 'Classifiche trofei' },
      { command: 'help', description: 'Aiuto' },
    ];
    await telegram.setMyCommands(priv, { scope: { type: 'all_private_chats' } });
    await telegram.setMyCommands(grp, { scope: { type: 'all_group_chats' } });
    await telegram.setMyCommands(grp, { scope: { type: 'all_chat_administrators' } });
  } catch (e) {
    console.warn('[cocboard-bot] setMyCommands', e.message || e);
  }
}

async function replyRanking(ctx, rankType, locationId, areaLabel) {
  const data = await api.rankings(rankType, locationId);
  const txt = fmt.formatRankings(data, rankType, areaLabel);
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('« Classifiche', 'nav_rank')],
    [Markup.button.callback('« Menù', 'menu')],
  ]);
  try {
    await ctx.editMessageText(txt, { parse_mode: 'HTML', ...kb });
  } catch (_) {
    await ctx.reply(txt, { parse_mode: 'HTML', ...kb });
  }
}

function setupBot(bot) {
  /** Assegnato dopo la definizione di handleCocboardCommand (scorciatoie tastiera reply). */
  let handlePrivateReplyKeyboardShortcuts = null;

  bot.use(guardMiddleware());

  /** Chat privata: traccia reply/sendMessage e edit* (menù aggiornati con callback senza nuove reply). */
  bot.use(async (ctx, next) => {
    privateUi.attachPrivateUiTracking(ctx);
    return next();
  });

  /** Privato + callback: elimina bolle precedenti (menù, CWL multi-messaggio, annunci, relay chat globale…). */
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private' || ctx.from?.id == null || !ctx.callbackQuery) return next();
    const d = ctx.callbackQuery.data || '';
    if (privateUi.callbackSkipsUiWipe(d)) return next();
    await privateUi.wipePrivateConversationUi(ctx.telegram, ctx.from.id);
    return next();
  });

  /** Privato + comando /…: stessa pulizia (es. /start dopo un elenco annunci). */
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private' || ctx.from?.id == null || !ctx.message?.text) return next();
    const t = ctx.message.text.trim();
    if (!t.startsWith('/')) return next();
    await privateUi.wipePrivateConversationUi(ctx.telegram, ctx.from.id);
    return next();
  });

  /** Uscita silenziosa dalla chat globale su quasi tutti i callback (tranne hub stanza). */
  bot.use(async (ctx, next) => {
    if (!ctx.callbackQuery) return next();
    if (isLinkedChatContext(ctx)) return next();
    const uid = ctx.from?.id;
    if (uid == null || ctx.chat?.type !== 'private') return next();
    const d = ctx.callbackQuery.data || '';
    if (d === 'noop' || d === 'comm_global_leave' || d === 'comm_global_status') return next();
    const notifyLeave = d === 'menu' || d === 'comm_hub';
    await leaveGlobalIfActive(ctx, { notify: notifyLeave });
    return next();
  });

  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const txt = (ctx.message?.text || '').trim();
    if (ctx.chat?.type === 'private' && ctx.message?.text && handlePrivateReplyKeyboardShortcuts) {
      const userTapMid = ctx.message.message_id;
      const userTapChatId = ctx.chat.id;
      const handledKb = await handlePrivateReplyKeyboardShortcuts(ctx, txt);
      if (handledKb && userTapMid != null) {
        try {
          await ctx.telegram.deleteMessage(userTapChatId, userTapMid);
        } catch (_) {}
      }
      if (handledKb) return;
    }
    if (txt === '/start' || txt === '/cocboard') {
      pendingAuth.delete(ctx.from.id);
      pendingSearch.delete(ctx.from.id);
      pendingLinkWizard.delete(ctx.from.id);
      pendingCommunity.delete(ctx.from.id);
      // Obbligatorio qui: questo ramo faceva next() prima del blocco leaveGlobalIfActive sotto.
      if (ctx.chat?.type === 'private') {
        await leaveGlobalIfActive(ctx, { notify: true });
      }
      return next();
    }
    if (pendingLinkWizard.has(ctx.from.id) && ctx.message?.text) {
      if (txt === '/cancel') {
        pendingLinkWizard.delete(ctx.from.id);
        await ctx.reply('Collegamento annullato.', backMenuKb());
        const sess = await tauth.getValidSession(ctx.from.id);
        if (sess) {
          ctx.cocboardUser = sess.user;
          await sendMainMenu(ctx);
        } else {
          await sendGuestMenu(ctx);
        }
        return;
      }
      if (!txt.startsWith('/')) {
        await handlePendingLinkWizard(ctx);
        return;
      }
    }
    if (pendingAuth.has(ctx.from.id) && ctx.message?.text && txt === '/cancel') {
      pendingAuth.delete(ctx.from.id);
      pendingLinkWizard.delete(ctx.from.id);
      await ctx.reply('Operazione annullata.');
      await sendGuestMenu(ctx);
      return;
    }
    if (pendingAuth.has(ctx.from.id) && ctx.message?.text && !txt.startsWith('/')) {
      await handlePendingMessage(ctx);
      return;
    }
    if (pendingSearch.has(ctx.from.id) && ctx.message?.text && !txt.startsWith('/')) {
      await handlePendingSearch(ctx);
      return;
    }
    const handledComm = await comm.tryHandleEarlyMessage(ctx, pendingCommunity, {
      isLinkedChatContext,
      sendMainMenu,
      sendGuestMenu,
      backMenuKb,
      tauth,
    });
    if (handledComm) return;
    if (ctx.chat?.type === 'private' && ctx.message?.text) {
      const raw = ctx.message.text.trim();
      if (raw.startsWith('/')) {
        const cmd = raw.split(/\s+/)[0].toLowerCase().split('@')[0];
        if (cmd !== '/esci_chat_global' && cmd !== '/annulla_reclutamento') {
          await leaveGlobalIfActive(ctx, { notify: true });
        }
      }
    }
    return next();
  });

  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid == null) return next();
    const t = (ctx.message?.text || '').trim();
    if (
      t.startsWith('/start') ||
      t.startsWith('/cocboard') ||
      t.startsWith('/help') ||
      t.startsWith('/player') ||
      t.startsWith('/cerca_clan') ||
      t.startsWith('/cerca') ||
      t.startsWith('/classifica') ||
      t.startsWith('/linkclan') ||
      t.startsWith('/unlinkclan') ||
      t.startsWith('/skip')
    ) {
      return next();
    }
    if (ctx.callbackQuery?.data?.startsWith('auth_')) return next();
    const cbDataEarly = ctx.callbackQuery?.data || '';
    if (
      /^rva:\d+$/.test(cbDataEarly) ||
      /^rvr:\d+$/.test(cbDataEarly) ||
      cbDataEarly === 'comm_owner_queue' ||
      /^rad:\d+$/.test(cbDataEarly)
    ) {
      if (cv.isBotOwnerTelegramUser(ctx.from?.id)) return next();
    }
    if (pendingSearch.has(uid)) return next();
    const d = ctx.callbackQuery?.data || '';
    if (isPublicCallbackData(d)) return next();
    if (isCommunityOpenGuestCallback(d)) return next();
    if (/^web_open:/.test(d)) return next();

    const session = await tauth.getValidSession(uid);
    if (session) {
      ctx.cocboardUser = session.user;
      ctx.cocboardSession = session.session;
      if (await blockGroupClanCallback(ctx)) return;
      if (ctx.message?.text && (await blockGroupClanCommand(ctx))) return;
      return next();
    }
    // Guest in linked group: allow clan-read callbacks/commands
    if (isLinkedChatContext(ctx)) {
      const linked = await sb.getTelegramChatLink(ctx.chat.id).catch(() => null);
      if (linked?.clan_tag) {
        ctx.cocboardLinkedClanTag = linked.clan_tag;
        const cbData = ctx.callbackQuery?.data || '';
        const cmdTxt = (ctx.message?.text || '').trim();
        if (isGroupClanReadCallback(cbData) || isGroupClanReadCommand(cmdTxt)) {
          return next();
        }
      }
    }
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('🔒 Accedi per questa funzione.').catch(() => {});
      await ensureTgBotUsername(ctx.telegram);
      const gkb = isLinkedChatContext(ctx) ? buildGroupGuestKb(cachedTgBotUsername) : buildPrivateGuestKb();
      await ctx.reply(fmt.formatGuestSnack(), { parse_mode: 'HTML', ...gkb }).catch(() => {});
      return;
    }
    if (ctx.message && ctx.message.text) {
      await sendGuestMenu(ctx);
      return;
    }
    return;
  });

  async function handleCocboardCommand(ctx) {
    if (!ctx.from?.id) return;
    try {
      const sess = await tauth.getValidSession(ctx.from.id);
      if (sess) {
        ctx.cocboardUser = sess.user;
        return await sendMainMenu(ctx);
      }
      if (isLinkedChatContext(ctx)) {
        const linked = await sb.getTelegramChatLink(ctx.chat.id).catch(() => null);
        if (linked?.clan_tag) return await sendLinkedGroupGuestMenu(ctx, linked.clan_tag);
      }
      return await sendGuestMenu(ctx);
    } catch (e) {
      console.error('[cocboard-bot] menù cocboard', e);
      await ctx
        .reply(
          '⚠️ Errore temporaneo. Controlla su Render/PC i log e che SUPABASE_URL sia https://…supabase.co (non la dashboard).'
        )
        .catch(() => {});
    }
  }

  const earlyCommDeps = {
    isLinkedChatContext,
    sendMainMenu,
    sendGuestMenu,
    backMenuKb,
    tauth,
  };

  handlePrivateReplyKeyboardShortcuts = async (ctx, raw) => {
    const t = raw.trim();
    if (t === PRIVATE_RK_MENU) {
      await privateUi.wipePrivateConversationUi(ctx.telegram, ctx.from.id);
      pendingAuth.delete(ctx.from.id);
      pendingSearch.delete(ctx.from.id);
      pendingLinkWizard.delete(ctx.from.id);
      pendingCommunity.delete(ctx.from.id);
      await leaveGlobalIfActive(ctx, { notify: true });
      await handleCocboardCommand(ctx);
      return true;
    }
    if (t === PRIVATE_RK_HELP) {
      await privateUi.wipePrivateConversationUi(ctx.telegram, ctx.from.id);
      await dispatchHelpCommand(ctx);
      return true;
    }
    if (t === PRIVATE_RK_EXIT_GLOBAL) {
      const active = await sbcCommunity.isActiveInGlobalChat(ctx.from.id).catch(() => false);
      if (!active) {
        await ctx.reply('ℹ️ Non sei in <b>chat globale</b>.', { parse_mode: 'HTML' }).catch(() => {});
        await refreshPrivateReplyKeyboard(ctx);
        return true;
      }
      await privateUi.wipePrivateConversationUi(ctx.telegram, ctx.from.id);
      const prev = ctx.message.text;
      ctx.message.text = '/esci_chat_global';
      const handled = await comm.tryHandleEarlyMessage(ctx, pendingCommunity, earlyCommDeps);
      ctx.message.text = prev;
      return handled;
    }
    if (t === PRIVATE_RK_CANCEL_RECRUIT) {
      const p = pendingCommunity.get(ctx.from.id);
      if (!p || (p.kind !== 'recruit_guided' && p.kind !== 'recruit_body')) {
        await ctx.reply('ℹ️ Nessuna <b>bozza reclutamento</b> attiva da annullare.', { parse_mode: 'HTML' }).catch(() => {});
        await refreshPrivateReplyKeyboard(ctx);
        return true;
      }
      await privateUi.wipePrivateConversationUi(ctx.telegram, ctx.from.id);
      const prev = ctx.message.text;
      ctx.message.text = '/annulla_reclutamento';
      const handled = await comm.tryHandleEarlyMessage(ctx, pendingCommunity, earlyCommDeps);
      ctx.message.text = prev;
      return handled;
    }
    return false;
  };

  bot.start(handleCocboardCommand);
  bot.command('cocboard', handleCocboardCommand);

  bot.command('help', async (ctx) => {
    if (!ctx.from?.id) return;
    await dispatchHelpCommand(ctx);
  });

  bot.command('esci', async (ctx) => {
    if (!ctx.from?.id) return;
    try {
      await performFullLogout(ctx, { viaCommand: true });
    } catch (e) {
      await ctx.reply(String(e.message || ''));
    }
  });

  bot.command('skip', async (ctx) => {
    if (!ctx.from?.id) return;
    if (isLinkedChatContext(ctx)) {
      await ctx.reply('Usa <code>/skip</code> in <b>chat privata</b> con il bot.', { parse_mode: 'HTML' });
      return;
    }
    const sess = await tauth.getValidSession(ctx.from.id);
    if (!sess) {
      await ctx.reply('Serve aver effettuato l’accesso.');
      return;
    }
    await sb.markTutorialCompleted(ctx.from.id).catch(() => {});
    ctx.cocboardUser = sess.user;
    await sendMainMenu(ctx);
  });

  bot.command('linkclan', async (ctx) => {
    if (!isLinkedChatContext(ctx)) {
      await ctx.reply('Usa <code>/linkclan TOKEN</code> nel <b>gruppo o canale</b> da collegare (non in privato).', {
        parse_mode: 'HTML',
      });
      return;
    }
    const uid = ctx.from?.id;
    if (uid == null) return;
    const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
    const token = arg.toLowerCase();
    if (!token) {
      await ctx.reply(
        'Uso: <code>/linkclan TOKEN</code>\n\nIl TOKEN lo ricevi in <b>privato</b> dal bot dopo «Aggiungi a canale/gruppo».',
        { parse_mode: 'HTML' }
      );
      return;
    }
    const sess = await tauth.getValidSession(uid);
    if (!sess) {
      await ensureTgBotUsername(ctx.telegram);
      const url = privateChatUrl(cachedTgBotUsername);
      const hint = url
        ? `🔐 Prima <b>Accedi</b> in privato: <a href="${url}">apri il bot</a>`
        : '🔐 Prima accedi in chat privata con il bot.';
      await ctx.reply(hint, { parse_mode: 'HTML' });
      return;
    }
    if (!isClanLeader(sess.user)) {
      await ctx.reply('Solo <b>Capo</b>, <b>Co-Capo</b> o <b>Admin</b> possono collegare la chat al clan.', {
        parse_mode: 'HTML',
      });
      return;
    }
    let clanTag;
    try {
      clanTag = await sb.peekPendingChatLink(token, uid);
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
      return;
    }
    if (!clanTag) {
      await ctx.reply(
        'Token non valido, scaduto o già usato. Generane uno nuovo: in <b>privato</b> menù → «Aggiungi a canale/gruppo».',
        { parse_mode: 'HTML' }
      );
      return;
    }
    try {
      await pruneStaleTelegramChatLinksForClan(ctx.telegram, clanTag);
      const can = await sb.canLinkChatToClan(ctx.chat.id, clanTag);
      if (!can) {
        await ctx.reply(
          '⚠️ Massimo <b>3</b> gruppi/canali collegati per questo clan.\n' +
            'Scollegane uno con <code>/unlinkclan</code> in una chat ancora attiva, oppure riprova: ' +
            'i gruppi eliminati o da cui il bot è stato tolto vengono rimossi automaticamente dal conteggio.',
          { parse_mode: 'HTML' }
        );
        return;
      }
      const consumed = await sb.consumePendingChatLink(token, uid);
      if (!consumed) {
        await ctx.reply('Token non più valido. Generane uno nuovo in privato.', { parse_mode: 'HTML' });
        return;
      }
      await ctx.deleteMessage().catch(() => {});
      await sb.upsertTelegramChatLink(ctx.chat.id, clanTag, uid, ctx.chat.type);
      await ctx.reply(
        `✅ Chat collegata al clan <code>${fmt.escapeHtml(clanTag)}</code>.\n\n` +
          `Ora chiunque nel gruppo può consultare <b>Membri</b>, <b>CWL</b>, <b>Guerre</b> senza login.\n` +
          `Usa <code>/cocboard</code> per aprire il menù.`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
    }
  });

  bot.command('unlinkclan', async (ctx) => {
    if (!isLinkedChatContext(ctx)) {
      await ctx.reply('Usa <code>/unlinkclan</code> nel <b>gruppo o canale</b> da scollegare.', { parse_mode: 'HTML' });
      return;
    }
    const uid = ctx.from?.id;
    if (uid == null) return;
    const sess = await tauth.getValidSession(uid);
    if (!sess) {
      await ctx.reply('Serve aver effettuato l’accesso (in privato).', { parse_mode: 'HTML' });
      return;
    }
    if (!isClanLeader(sess.user)) {
      await ctx.reply('Solo <b>Capo</b>, <b>Co-Capo</b> o <b>Admin</b> possono scollegare la chat.', {
        parse_mode: 'HTML',
      });
      return;
    }
    try {
      await sb.deleteTelegramChatLink(ctx.chat.id);
      await ctx.reply('🔗 Collegamento tra questa chat e il clan <b>rimosso</b>.', { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML' });
    }
  });

  bot.command('setclan', async (ctx) => {
    const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
    const tag = fmt.parseTagArg(arg);
    if (!tag) {
      await ctx.reply(fmt.formatSetclanHelp(), { parse_mode: 'HTML', ...backMenuKb() });
      return;
    }
    try {
      const info = await api.clanInfo(tag);
      await sb.setSavedClanTag(ctx.from.id, tag);
      await ctx.reply(
        `✅ Clan impostato su <b>${fmt.escapeHtml(info.name)}</b> <code>${fmt.escapeHtml(info.tag || tag)}</code>`,
        { parse_mode: 'HTML', ...backMenuKb() }
      );
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.command('logout_clan', async (ctx) => {
    try {
      await sb.clearSavedClanOnly(ctx.from.id);
      await ctx.reply(
        '🔓 Override clan rimosso. Si usa di nuovo il clan sul profilo account (se presente).',
        { parse_mode: 'HTML', ...backMenuKb() }
      );
    } catch (e) {
      await ctx.reply(String(e.message || ''), { ...backMenuKb() });
    }
  });

  async function cmdNeedClan(ctx, fn) {
    const tag = await resolveEffectiveClanTag(ctx);
    if (!tag) {
      await ctx.reply(
        '⚠️ Nessun clan disponibile. Usa <code>/setclan #TAG</code> o assicurati di essere in un clan in game.',
        { parse_mode: 'HTML', ...backMenuKb() }
      );
      return;
    }
    return fn(tag);
  }

  bot.command('membri', async (ctx) => {
    await cmdNeedClan(ctx, async (clanTag) => {
      const data = await api.clanMembers(clanTag);
      const { text, page, pages } = fmt.formatMembersPage(data.items, 0, clanTag);
      await ctx.reply(text, { parse_mode: 'HTML', ...buildMembersKb(page, pages) });
    });
  });

  bot.command('info', async (ctx) => {
    await cmdNeedClan(ctx, async (clanTag) => {
      const info = await api.clanInfo(clanTag);
      await ctx.reply(fmt.formatClanInfo(info), { parse_mode: 'HTML', ...backMenuKb() });
    });
  });

  bot.command('cwl', async (ctx) => {
    await cmdNeedClan(ctx, async (clanTag) => {
      const { text, kb } = await loadAndShowCwl(ctx, clanTag, { view: 'ov', pPage: 0, rIdx: 0 });
      await sendCwlMessages(ctx, text, kb);
    });
  });

  bot.command('bonus', async (ctx) => {
    await cmdNeedClan(ctx, async (clanTag) => {
      let rows = null;
      try {
        rows = await sb.fetchBonusesForClan(clanTag);
      } catch (_) {
        rows = null;
      }
      const { text, page, pages } = fmt.formatBonusesPage(rows || [], 0, clanTag);
      const kb = await buildBonusKeyboard(ctx, page, pages);
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    });
  });

  bot.command('guerre', async (ctx) => {
    await cmdNeedClan(ctx, async () => {
      await ctx.reply(
        `${fmt.DIV}\n📜 <b>Registro guerre</b>\n${fmt.DIV}\n\n` +
          `Come sul sito: due sezioni distinte.\n\n` +
          `• 🏹 <b>War classiche</b> — log war normali\n` +
          `• 🏆 <b>Cronologia leghe</b> — riepilogo stagioni CWL da API`,
        { parse_mode: 'HTML', ...warSubmenuKb() }
      );
    });
  });

  bot.command('player', async (ctx) => {
    const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
    const tag = fmt.parseTagArg(arg);
    if (!tag) {
      await ctx.reply('Usa: /player #TAG');
      return;
    }
    const data = await api.lookupPlayer(tag);
    await ctx.reply(fmt.formatPlayerSummary(data), { parse_mode: 'HTML', ...backMenuKb() });
  });

  bot.command('cerca_clan', async (ctx) => {
    const q = (ctx.message.text || '').replace(/^\/cerca_clan\s*/i, '').trim();
    if (q.length < 3) {
      await ctx.reply('Usa: /cerca_clan nome (almeno 3 caratteri)');
      return;
    }
    const data = await api.searchClans(q);
    await ctx.reply(fmt.formatClanSearch(data.items || []), { parse_mode: 'HTML', ...backMenuKb() });
  });

  bot.command('cerca', async (ctx) => {
    const kb = await buildSearchPickKb(ctx);
    await ctx.reply(fmt.formatSearchMenuIntro(), { parse_mode: 'HTML', ...kb });
  });

  bot.command('classifica', async (ctx) => {
    await ctx.reply(fmt.formatRankMenuIntro(), { parse_mode: 'HTML', ...rankPickKb() });
  });

  bot.command('clan', async (ctx) => {
    await ctx.reply(
      `Usa <code>/setclan #TAG</code> per il clan da mostrare,\no <code>/cerca_clan nome</code> per cercare.`,
      { parse_mode: 'HTML', ...backMenuKb() }
    );
  });

  bot.action('auth_login_for_global', async (ctx) => {
    safeAnswerCb(ctx);
    if (isLinkedChatContext(ctx)) {
      await ensureTgBotUsername(ctx.telegram);
      const url = privateChatUrl(cachedTgBotUsername);
      if (url) {
        await ctx.reply(`🔐 <b>Accedi in privato</b>\n\n<a href="${url}">Apri la chat con il bot</a>`, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(fmt.formatPrivateOnlyWizard(), { parse_mode: 'HTML' });
      }
      return;
    }
    const uid = ctx.from?.id;
    if (uid == null) return;
    postAuthGlobalResume.set(uid, 'global_profile');
    pendingSearch.delete(uid);
    pendingAuth.set(uid, { kind: 'login', step: 1 });
    await ctx.reply(
      '🔑 <b>Accedi</b> (per la chat globale con profilo ✅)\n\n' +
        'Invia <b>nome utente</b>, <b>tag</b> <code>#...</code> o <b>email</b>.',
      { parse_mode: 'HTML' }
    );
  });

  bot.action('auth_register_for_global', async (ctx) => {
    safeAnswerCb(ctx);
    if (isLinkedChatContext(ctx)) {
      await ensureTgBotUsername(ctx.telegram);
      const url = privateChatUrl(cachedTgBotUsername);
      if (url) {
        await ctx.reply(`🔐 <b>Registrati in privato</b>\n\n<a href="${url}">Apri la chat con il bot</a>`, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(fmt.formatPrivateOnlyWizard(), { parse_mode: 'HTML' });
      }
      return;
    }
    const uid = ctx.from?.id;
    if (uid == null) return;
    postAuthGlobalResume.set(uid, 'global_profile');
    pendingSearch.delete(uid);
    pendingAuth.set(uid, { kind: 'reg', step: 1 });
    await ctx.reply('📝 <b>Registrati</b>\n\nInvia il <b>tag villaggio</b> (es. <code>#2ABC</code>).', { parse_mode: 'HTML' });
  });

  bot.action('auth_login', async (ctx) => {
    safeAnswerCb(ctx);
    if (isLinkedChatContext(ctx)) {
      await ensureTgBotUsername(ctx.telegram);
      const url = privateChatUrl(cachedTgBotUsername);
      if (url) {
        await ctx.reply(`🔐 <b>Accedi in privato</b>\n\n<a href="${url}">Apri la chat con il bot</a>`, {
          parse_mode: 'HTML',
        });
      } else {
        await ctx.reply(fmt.formatPrivateOnlyWizard(), { parse_mode: 'HTML' });
      }
      return;
    }
    postAuthGlobalResume.delete(ctx.from.id);
    pendingSearch.delete(ctx.from.id);
    pendingAuth.set(ctx.from.id, { kind: 'login', step: 1 });
    await ctx.reply(
      '🔑 <b>Accedi</b> (come su CoCBoard)\n\n' +
        'Invia <b>nome utente</b>, <b>tag</b> <code>#...</code> o <b>email</b>.',
      { parse_mode: 'HTML' }
    );
  });

  bot.action('auth_register', async (ctx) => {
    safeAnswerCb(ctx);
    if (isLinkedChatContext(ctx)) {
      await ensureTgBotUsername(ctx.telegram);
      const url = privateChatUrl(cachedTgBotUsername);
      if (url) {
        await ctx.reply(`🔐 <b>Registrati in privato</b>\n\n<a href="${url}">Apri la chat con il bot</a>`, {
          parse_mode: 'HTML',
        });
      } else {
        await ctx.reply(fmt.formatPrivateOnlyWizard(), { parse_mode: 'HTML' });
      }
      return;
    }
    postAuthGlobalResume.delete(ctx.from.id);
    pendingSearch.delete(ctx.from.id);
    pendingAuth.set(ctx.from.id, { kind: 'reg', step: 1 });
    await ctx.reply(
      '📝 <b>Registrati</b>\n\nInvia il <b>tag giocatore</b> (es. <code>#2ABC</code>).',
      { parse_mode: 'HTML' }
    );
  });

  bot.action('auth_guest_help', async (ctx) => {
    safeAnswerCb(ctx);
    await ensureTgBotUsername(ctx.telegram);
    const text = isLinkedChatContext(ctx) ? fmt.formatGroupHelp() : fmt.formatGuestHelp();
    const kb = isLinkedChatContext(ctx) ? buildGroupGuestKb(cachedTgBotUsername) : buildPrivateGuestKb();
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('auth_logout', async (ctx) => {
    await performFullLogout(ctx, { viaCommand: false });
  });

  bot.action('noop', async (ctx) => {
    safeAnswerCb(ctx);
  });

  bot.action('menu', async (ctx) => {
    safeAnswerCb(ctx);
    if (ctx.from?.id != null) pendingCommunity.delete(ctx.from.id);
    const sess = await tauth.getValidSession(ctx.from.id);
    if (sess) {
      ctx.cocboardUser = sess.user;
      return sendMainMenu(ctx);
    }
    if (isLinkedChatContext(ctx)) {
      const linked = await sb.getTelegramChatLink(ctx.chat.id).catch(() => null);
      if (linked?.clan_tag) return sendLinkedGroupGuestMenu(ctx, linked.clan_tag);
    }
    return sendGuestMenu(ctx);
  });

  bot.action('setclan_help', async (ctx) => {
    safeAnswerCb(ctx);
    const text = fmt.formatSetclanHelp();
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...backMenuKb() });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.action('acct', async (ctx) => {
    safeAnswerCb(ctx);
    const uid = ctx.from.id;
    const u = ctx.cocboardUser;
    const meta = u?.user_metadata || {};
    const saved = await sb.getSavedClanTag(uid).catch(() => null);
    const text = fmt.formatAccountPanel({
      username: meta.username || (u?.email || '').split('@')[0],
      cocTag: meta.coc_tag,
      profileClanTag: meta.coc_clan_tag,
      savedClanOverride: saved,
    });
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('🚪 Logout', 'auth_logout')],
      [Markup.button.callback('« Menù', 'menu')],
    ]);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('helpbtn', async (ctx) => {
    safeAnswerCb(ctx);
    const body =
      `${fmt.DIV}\n📖 <b>Aiuto rapido</b>\n${fmt.DIV}\n\n` +
      `• <b>Cerca / Classifica / Community</b> — anche da ospite\n` +
      `• Dopo login: scorciatoie <b>(web)</b> (CWL live = turni in Registri guerre; Bonus = bonus)\n` +
      `• <code>/setclan</code> · <code>/player</code> · <code>/cerca_clan</code> · <code>/esci</code>\n` +
      `• Dettagli: <code>/help</code>`;
    await ctx
      .editMessageText(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('« Menù', 'menu')]]) })
      .catch(async () => {
        await ctx.reply(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('« Menù', 'menu')]]) });
      });
  });

  bot.action('nav_search', async (ctx) => {
    safeAnswerCb(ctx);
    const intro = fmt.formatSearchMenuIntro();
    const kb = await buildSearchPickKb(ctx);
    try {
      await ctx.editMessageText(intro, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(intro, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('nav_rank', async (ctx) => {
    safeAnswerCb(ctx);
    const intro = fmt.formatRankMenuIntro();
    try {
      await ctx.editMessageText(intro, { parse_mode: 'HTML', ...rankPickKb() });
    } catch (_) {
      await ctx.reply(intro, { parse_mode: 'HTML', ...rankPickKb() });
    }
  });

  bot.action('srch_p', async (ctx) => {
    safeAnswerCb(ctx);
    if (!ctx.from?.id) return;
    pendingAuth.delete(ctx.from.id);
    pendingSearch.set(ctx.from.id, { kind: 'player' });
    await ctx.reply(
      '👤 Invia il <b>tag villaggio</b> (es. <code>#2ABC</code>).\n<code>/cancel</code> per annullare.',
      { parse_mode: 'HTML' }
    );
  });

  bot.action('srch_c', async (ctx) => {
    safeAnswerCb(ctx);
    if (!ctx.from?.id) return;
    pendingAuth.delete(ctx.from.id);
    pendingSearch.set(ctx.from.id, { kind: 'clan' });
    await ctx.reply(
      '🏰 Invia <b>parte del nome</b> del clan (min. 3 caratteri).\n<code>/cancel</code> per annullare.',
      { parse_mode: 'HTML' }
    );
  });

  bot.action('rk_p_i', async (ctx) => {
    safeAnswerCb(ctx);
    try {
      await replyRanking(ctx, 'players', fmt.RANK_LOCATION_ITALY, 'Italia');
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...rankPickKb() }).catch(() => {});
    }
  });

  bot.action('rk_p_g', async (ctx) => {
    safeAnswerCb(ctx);
    try {
      await replyRanking(ctx, 'players', fmt.RANK_LOCATION_GLOBAL, 'Mondo');
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...rankPickKb() }).catch(() => {});
    }
  });

  bot.action('rk_c_i', async (ctx) => {
    safeAnswerCb(ctx);
    try {
      await replyRanking(ctx, 'clans', fmt.RANK_LOCATION_ITALY, 'Italia');
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...rankPickKb() }).catch(() => {});
    }
  });

  bot.action('rk_c_g', async (ctx) => {
    safeAnswerCb(ctx);
    try {
      await replyRanking(ctx, 'clans', fmt.RANK_LOCATION_GLOBAL, 'Mondo');
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...rankPickKb() }).catch(() => {});
    }
  });

  bot.action(/^tut:(.+)$/, async (ctx) => {
    if (isLinkedChatContext(ctx)) {
      await ctx.answerCbQuery('Il tutorial è solo in chat privata.').catch(() => {});
      return;
    }
    const sub = ctx.match[1];
    const uid = ctx.from?.id;
    if (uid == null) return;
    if (sub === 'skip' || sub === 'done') {
      await sb.markTutorialCompleted(uid).catch(() => {});
      await ctx.answerCbQuery().catch(() => {});
      try {
        await ctx.deleteMessage();
      } catch (_) {}
      const sess = await tauth.getValidSession(uid);
      if (sess) ctx.cocboardUser = sess.user;
      return sendMainMenu(ctx);
    }
    const step = Number(sub);
    if (step < 1 || step > 3) {
      await ctx.answerCbQuery().catch(() => {});
      return;
    }
    await ctx.answerCbQuery().catch(() => {});
    const body = fmt.formatTutorialStep(step);
    const rows = [];
    if (step < 3) rows.push([Markup.button.callback('Avanti ➡️', `tut:${step + 1}`)]);
    else rows.push([Markup.button.callback('✅ Apri menù', 'tut:done')]);
    rows.push([Markup.button.callback('⏭ Salta tutorial', 'tut:skip')]);
    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
    } catch (_) {
      await ctx.reply(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
    }
  });

  bot.action('addgrp_ok', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    const uid = ctx.from?.id;
    if (uid == null) return;
    const w = pendingLinkWizard.get(uid);
    if (!w?.clanTag) {
      await ctx.answerCbQuery('Riapri da menù: Aggiungi a canale/gruppo.').catch(() => {});
      return;
    }
    await ctx.answerCbQuery('Genero il token…').catch(() => {});
    let token;
    try {
      token = await sb.createPendingChatLink(uid, w.clanTag);
    } catch (e) {
      await ctx.reply(`❌ ${fmt.escapeHtml(String(e.message || ''))}`, { parse_mode: 'HTML', ...backMenuKb() }).catch(() => {});
      return;
    }
    pendingLinkWizard.delete(uid);
    await ensureTgBotUsername(ctx.telegram);
    const text = fmt.formatAddBotToGroupHelp({
      botUsername: cachedTgBotUsername,
      clanTag: w.clanTag,
      linkToken: token,
    });
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...backMenuKb() });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.action('addgrp_chg', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    const uid = ctx.from?.id;
    if (uid == null) return;
    if (!pendingLinkWizard.has(uid)) {
      await ctx.answerCbQuery().catch(() => {});
      return;
    }
    pendingLinkWizard.set(uid, { awaitingTag: true });
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply(
      '✏️ Invia il <b>tag clan</b> (es. <code>#2ABC</code>).\n<code>/cancel</code> per annullare.',
      { parse_mode: 'HTML' }
    );
  });

  bot.action('addgrp_can', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    pendingLinkWizard.delete(ctx.from.id);
    await ctx.answerCbQuery().catch(() => {});
    const sess = await tauth.getValidSession(ctx.from.id);
    if (sess) {
      ctx.cocboardUser = sess.user;
      await sendMainMenu(ctx);
    } else {
      await sendGuestMenu(ctx);
    }
  });

  bot.action(/^mb(\d+)$/, async (ctx) => {
    await answerCbLoading(ctx);
    const page = Number(ctx.match[1]) || 0;
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan collegato').catch(() => {});
      return;
    }
    const data = await api.clanMembers(clanTag);
    const { text, page: p, pages } = fmt.formatMembersPage(data.items, page, clanTag);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...buildMembersKb(p, pages) });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...buildMembersKb(p, pages) });
    }
  });

  bot.action('info', async (ctx) => {
    await answerCbLoading(ctx);
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan collegato').catch(() => {});
      return;
    }
    const info = await api.clanInfo(clanTag);
    const text = fmt.formatClanInfo(info);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...backMenuKb() });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.action('cwl', async (ctx) => {
    await answerCbLoading(ctx);
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan collegato').catch(() => {});
      return;
    }
    const { text, kb } = await loadAndShowCwl(ctx, clanTag, { view: 'ov', pPage: 0, rIdx: 0 });
    await editOrReplyCwl(ctx, text, kb);
  });

  bot.action(/^cwl_v:(.+)$/, async (ctx) => {
    await answerCbLoading(ctx);
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan collegato').catch(() => {});
      return;
    }
    const key = ctx.match[1];
    const spec = parseCwlViewKey(key);
    const { text, kb } = await loadAndShowCwl(ctx, clanTag, spec);
    await editOrReplyCwl(ctx, text, kb);
  });

  bot.action(/^bonus:(\d+)$/, async (ctx) => {
    await answerCbLoading(ctx);
    const page = Number(ctx.match[1]) || 0;
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    let rows = null;
    try {
      rows = await sb.fetchBonusesForClan(clanTag);
    } catch (_) {
      rows = null;
    }
    const { text, page: p, pages } = fmt.formatBonusesPage(rows || [], page, clanTag);
    const kb = await buildBonusKeyboard(ctx, p, pages);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('bonus:hist', async (ctx) => {
    await answerCbLoading(ctx);
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    let hist = [];
    try {
      hist = await sb.fetchCwlHistoryBonusRows(clanTag);
    } catch (e) {
      await ctx.answerCbQuery(String(e.message || 'Errore dati').slice(0, 200)).catch(() => {});
      return;
    }
    const body = fmt.formatBonusHistoryBySeason(hist);
    await editOrReplyChunkedHtml(ctx, body, bonusHistHofBackKb());
  });

  bot.action('bonus:hof', async (ctx) => {
    await answerCbLoading(ctx);
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    let hist = [];
    try {
      hist = await sb.fetchCwlHistoryBonusRows(clanTag);
    } catch (e) {
      await ctx.answerCbQuery(String(e.message || 'Errore dati').slice(0, 200)).catch(() => {});
      return;
    }
    const body = fmt.formatBonusReceiversLeaderboard(hist);
    await editOrReplyChunkedHtml(ctx, body, bonusHistHofBackKb());
  });

  bot.action('war_menu', async (ctx) => {
    safeAnswerCb(ctx);
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan collegato').catch(() => {});
      return;
    }
    const body =
      `${fmt.DIV}\n📜 <b>Registro guerre</b>\n${fmt.DIV}\n\n` +
      `Scegli (come su CoCBoard → Registri Guerre):`;
    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...warSubmenuKb() });
    } catch (_) {
      await ctx.reply(body, { parse_mode: 'HTML', ...warSubmenuKb() });
    }
  });

  bot.action('war:classic', async (ctx) => {
    await answerCbLoading(ctx);
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan collegato').catch(() => {});
      return;
    }
    const data = await api.warLog(clanTag);
    const text = fmt.formatWarLogClassic(data);
    const kb = Markup.inlineKeyboard([[Markup.button.callback('« Registro guerre', 'war_menu')], [Markup.button.callback('« Menù', 'menu')]]);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('war:cwl', async (ctx) => {
    await answerCbLoading(ctx);
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan collegato').catch(() => {});
      return;
    }
    const data = await api.warLog(clanTag);
    const text = fmt.formatWarLogCwlHistory(data);
    const kb = Markup.inlineKeyboard([[Markup.button.callback('« Registro guerre', 'war_menu')], [Markup.button.callback('« Menù', 'menu')]]);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('add_group_bot', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    if (!ctx.cocboardUser) {
      await ctx.answerCbQuery('Accedi prima.').catch(() => {});
      return;
    }
    await startAddGroupWizard(ctx);
  });

  bot.action('group_clan_locked_hint', async (ctx) => {
    await ctx.answerCbQuery('Usa il menù: se la chat è collegata al tuo clan vedrai i dati.').catch(() => {});
  });

  bot.action('me', async (ctx) => {
    safeAnswerCb(ctx);
    const tag = ctx.cocboardUser?.user_metadata?.coc_tag;
    if (!tag) {
      await ctx.answerCbQuery('Nessun villaggio sul profilo').catch(() => {});
      return;
    }
    const data = await api.lookupPlayer(tag);
    const text = fmt.formatPlayerSummary(data);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...backMenuKb() });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...backMenuKb() });
    }
  });

  bot.on('my_chat_member', async (ctx) => {
    try {
      const chat = ctx.chat;
      if (!chat || !['group', 'supergroup', 'channel'].includes(chat.type)) return;
      const me = await ctx.telegram.getMe();
      const nn = ctx.myChatMember?.new_chat_member;
      if (nn?.user?.id !== me.id) return;
      if (nn.status === 'left' || nn.status === 'kicked') {
        await sb.deleteTelegramChatLink(chat.id).catch(() => {});
        return;
      }
      if (nn.status !== 'member' && nn.status !== 'administrator') return;
      if (chat.type !== 'group' && chat.type !== 'supergroup') return;
      await ctx.reply(fmt.formatGroupBotAdded(), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔍 Cerca', 'nav_search'), Markup.button.callback('📊 Classifica', 'nav_rank')],
          [Markup.button.callback('❓ Aiuto', 'helpbtn')],
        ]),
      });
    } catch (_) {}
  });

  const WEB_OPEN_TAB = {
    cwl_warlog: 'cwl_warlog',
    cwl: 'cwl_warlog',
    warlog: 'warlog',
    bonus: 'bonus',
    profilo: 'profilo',
    clan: 'members',
    members: 'members',
    cerca: 'cerca',
    rankings: 'rankings',
  };

  bot.action(/^web_open:(\w+)$/, async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    const uid = ctx.from?.id;
    if (uid == null) return;
    const key = ctx.match[1];
    const openTab = WEB_OPEN_TAB[key];
    if (!openTab) {
      await ctx.answerCbQuery('Sconosciuto').catch(() => {});
      return;
    }
    const sess = await tauth.getValidSession(uid);
    if (!sess) {
      await ctx.answerCbQuery('Accedi prima (Accedi / Registrati).').catch(() => {});
      await ensureTgBotUsername(ctx.telegram);
      await ctx
        .reply('🔐 Per aprire CoCBoard nel browser devi aver fatto l’accesso.', { parse_mode: 'HTML', ...buildPrivateGuestKb() })
        .catch(() => {});
      return;
    }
    ctx.cocboardUser = sess.user;
    let wu;
    try {
      wu = await buildWebAppHandoffUrl(ctx, { open_tab: openTab });
    } catch (_) {}
    if (!wu || !String(wu).startsWith('https://')) {
      await ctx.answerCbQuery('Web non disponibile.').catch(() => {});
      return;
    }
    await ctx.answerCbQuery().catch(() => {});
    const titles = {
      cwl_warlog: 'CWL live (turni)',
      cwl: 'CWL live (turni)',
      warlog: 'Registro guerre',
      bonus: 'Bonus CWL',
      profilo: 'Il mio profilo',
      clan: 'Info clan',
      members: 'Membri',
      cerca: 'Cerca',
      rankings: 'Classifica',
    };
    await ctx
      .reply(`🌐 <b>${titles[key] || 'CoCBoard'}</b> — apri la Mini App o il sito.`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.webApp('Apri CoCBoard (web)', wu)]]),
      })
      .catch(() => {});
  });

  comm.registerCommunityHandlers(bot, {
    pendingCommunity,
    isLinkedChatContext,
    tauth,
    sendMainMenu,
    sendGuestMenu,
    backMenuKb,
    refreshPrivateReplyKeyboard,
  });

  bot.catch((err, ctx) => {
    console.error(err);
    const msg = err?.message || 'Errore sconosciuto';
    ctx.reply(`❌ Errore: ${msg}`).catch(() => {});
  });
}

async function runCommunityMaintenance(bot) {
  try {
    await sbcCommunity.tickGlobalEpochIfNeeded();
    await comm.purgeGlobalWindowTelegramMessages(bot.telegram);
    const expired = await sbcCommunity.listExpiredRecruitmentPosts();
    for (const row of expired) {
      const ids = Array.isArray(row.delivered_message_ids) ? row.delivered_message_ids : [];
      for (const entry of ids) {
        if (entry?.chat_id != null && entry?.message_id != null) {
          try {
            await bot.telegram.deleteMessage(entry.chat_id, entry.message_id);
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 30));
        }
      }
      await sbcCommunity.deleteRecruitmentPostRow(row.id);
    }
  } catch (e) {
    console.warn('[cocboard-bot] community maintenance', e.message || e);
  }
}

/** Telegraf confronta req.url col path esatto: senza questa, `/path/` non matcha e l’update viene scartato (in chat: silenzio). */
function normalizeTelegrafWebhookPath(expectedPath) {
  return (req, _res, next) => {
    const u = req.url || '';
    const q = u.indexOf('?');
    const qs = q >= 0 ? u.slice(q) : '';
    const pathname = q >= 0 ? u.slice(0, q) : u;
    if (pathname === `${expectedPath}/` || pathname === `${expectedPath}//`) {
      req.url = expectedPath + qs;
    }
    next();
  };
}

function logIncomingWebhook(secretConfigured) {
  return (req, _res, next) => {
    const hdr = req.headers['x-telegram-bot-api-secret-token'];
    const hasHeader = hdr != null && String(hdr).length > 0;
    console.log(
      `[cocboard-bot] webhook POST url=${req.url} secret_header=${hasHeader} secret_env=${secretConfigured ? 'yes' : 'no'}`
    );
    next();
  };
}

function warnSupabaseEnv() {
  const url = (process.env.SUPABASE_URL || '').trim();
  if (!url) {
    console.warn('[cocboard-bot] SUPABASE_URL mancante: /start userà solo menu ospite e il login non funzionerà.');
    return;
  }
  if (url.includes('supabase.com/dashboard') || url.includes('/project/')) {
    console.error(
      '[cocboard-bot] SUPABASE_URL errata: hai incollato la pagina dashboard. Deve essere tipo https://xxxx.supabase.co (Project Settings → API).'
    );
  }
  if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) {
    console.warn('[cocboard-bot] SUPABASE_SERVICE_ROLE_KEY mancante.');
  }
  if (!(process.env.SUPABASE_ANON_KEY || '').trim()) {
    console.warn('[cocboard-bot] SUPABASE_ANON_KEY mancante (login impossibile).');
  }
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('Imposta TELEGRAM_BOT_TOKEN');
    process.exit(1);
  }

  warnSupabaseEnv();

  const bot = new Telegraf(token);
  setupBot(bot);

  runCommunityMaintenance(bot).catch(() => {});
  setInterval(() => {
    runCommunityMaintenance(bot).catch(() => {});
  }, 60_000);

  const webhookDomain = pickWebhookDomain();
  const webhookSecretPath = pickWebhookPath();
  const hookUrl = webhookPublicUrl();

  if (webhookDomain && webhookSecretPath && hookUrl) {
    const domain = String(webhookDomain).replace(/\/$/, '');
    const path = webhookSecretPath.startsWith('/') ? webhookSecretPath : `/${webhookSecretPath}`;
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.get('/health', (_req, res) => res.json({ ok: true, service: 'cocboard-telegram-bot' }));

    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN || '';
    const hookMw = bot.webhookCallback(path, { secretToken: secretToken || undefined });
    const logMw = logIncomingWebhook(Boolean(secretToken && String(secretToken).trim()));
    const normMw = normalizeTelegrafWebhookPath(path);
    app.post(path, normMw, logMw, hookMw);
    app.post(`${path}/`, normMw, logMw, hookMw);

    if (!secretToken && (process.env.RENDER_EXTERNAL_URL || '').trim()) {
      console.warn(
        '[cocboard-bot] Imposta TELEGRAM_WEBHOOK_SECRET_TOKEN in produzione.'
      );
    }
    const listenPort = Number(process.env.PORT) || PORT;
    app.listen(listenPort, '0.0.0.0', async () => {
      console.log(`Listening 0.0.0.0:${listenPort} webhook POST ${path}`);
      await bot.telegram.setWebhook(hookUrl, {
        secret_token: secretToken || undefined,
        allowed_updates: ['message', 'callback_query', 'my_chat_member'],
        drop_pending_updates: true,
      });
      try {
        const me = await bot.telegram.getMe();
        if (me.username) cachedTgBotUsername = me.username.replace(/^@/, '');
      } catch (_) {}
      await registerBotCommands(bot.telegram);
      console.log('Webhook set:', hookUrl);
    });
  } else {
    console.log(
      'Avvio long polling. Per webhook: TELEGRAM_WEBHOOK_* o deploy Render (RENDER_EXTERNAL_URL).'
    );
    await bot.launch();
    try {
      const me = await bot.telegram.getMe();
      if (me.username) cachedTgBotUsername = me.username.replace(/^@/, '');
    } catch (_) {}
    await registerBotCommands(bot.telegram);
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
