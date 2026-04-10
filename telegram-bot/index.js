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
const bonusAssist = require('./lib/bonus-assistant');

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
/** Supporto: ticket attivo per admin (chat continua) + aperture utente. */
const adminActiveSupportTicket = new Map(); // adminUid -> ticketId
const pendingSupportOpen = new Map(); // uid -> true (apertura esplicita supporto)
const pendingManualReportTarget = new Map(); // adminUid -> reportId

const SUPPORT_RK_TAKE = 'Ticket: presa in carico';
const SUPPORT_RK_WAIT = 'Ticket: in attesa utente';
const SUPPORT_RK_CLOSE = 'Ticket: chiudi';
const SUPPORT_RK_BAN = 'Ticket: permaban utente';
const SUPPORT_RK_UNBAN = 'Ticket: rimuovi ban';
const SUPPORT_RK_EXIT = 'Esci ticket supporto';
const SUPPORT_MAX_REOPEN = 3;
const SUPPORT_MAX_PHOTO_PER_SESSION = 2;
/** Righe per pagina nel flusso «Assegna bonus» (limite pulsanti Telegram). */
const BONUS_ASSIGN_PAGE_SIZE = 6;
/** Paginazione lista candidati nel wizard assistito. */
const BONUS_WIZARD_PAGE = 6;
/** Stato wizard bonus: uid → risultato runBonusAssistant + metadati. */
const bonusWizardByUid = new Map();

let cachedTgBotUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
/** Anti-spam avvisi guerra: chatId -> key avvisi già inviati per endTime corrente. */
const warAlertMemory = new Map();
/**
 * Anti-spam avvisi raid capitale.
 * key: `${chatId}:raid:${startTime}` → { initialized: bool, destroyed: Set<`${enemyTag}:${districtId}`> }
 * Sul primo poll dopo un restart si inizializza senza inviare (evita ri-notifiche di distretti già noti).
 */
const raidAlertMemory = new Map();
/** Traccia l'ultimo messaggio menù per chat (privata + gruppo): consente la cancellazione al re-invio di /cocboard. */
const _lastMenuMsgByChat = new Map();
function _trackMenuMsg(chatId, messageId) {
  if (chatId != null && messageId != null) _lastMenuMsgByChat.set(Number(chatId), Number(messageId));
}
async function _deleteTrackedMenuMsg(telegram, chatId) {
  if (chatId == null) return;
  const mid = _lastMenuMsgByChat.get(Number(chatId));
  if (!mid) return;
  _lastMenuMsgByChat.delete(Number(chatId));
  await telegram.deleteMessage(Number(chatId), mid).catch(() => {});
}
const TELEGRAPH_TUTORIAL_URL = (process.env.TELEGRAPH_TUTORIAL_URL || 'https://telegra.ph/CoCBoard-Bot-Guida-04-07').trim();

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

function isGroupLikeContext(ctx) {
  const t = chatKind(ctx);
  return t === 'group' || t === 'supergroup';
}

/** Telegram limita i bottoni web_app in gruppi/canali: in quei contesti usa Direct App Link
 *  (t.me/bot/home?startapp=TAB o TAB__CLANTAG) che apre la Mini App nativa nella chat.
 *  clanTag viene codificato nel payload affinché la Mini App ospite sappia quale clan mostrare. */
function webLaunchButton(ctx, label, url, tab, clanTag) {
  if (isLinkedChatContext(ctx)) {
    if (tab && MINI_APP_WEB_TABS.has(tab)) {
      const botUser = (cachedTgBotUsername || 'cocboardbot').replace(/^@/, '');
      const rawTag = (clanTag || '').replace(/^#/, '').trim();
      const startParam = rawTag ? `${tab}__${rawTag}` : tab;
      return Markup.button.url(label, `https://t.me/${botUser}/home?startapp=${startParam}`);
    }
    return Markup.button.url(label, url);
  }
  return Markup.button.webApp(label, url);
}

const MINI_APP_WEB_TABS = new Set(['cwl_warlog', 'warlog', 'bonus', 'members', 'profilo', 'cerca', 'rankings']);
const MINI_APP_GUEST_ALLOWED_TABS = new Set(['cwl_warlog', 'warlog', 'bonus', 'members', 'cerca', 'rankings']);

function parseRequestedMiniAppTabFromCommand(ctx) {
  const txt = String(ctx.message?.text || '').trim();
  if (!txt.startsWith('/')) return null;
  const parts = txt.split(/\s+/);
  const arg = String(parts[1] || '').trim();
  if (!arg.startsWith('webtab_')) return null;
  const tab = arg.slice('webtab_'.length);
  return MINI_APP_WEB_TABS.has(tab) ? tab : null;
}

function isCoCboardAdminUser(user) {
  const role = user?.user_metadata?.role || '';
  return String(role).toLowerCase() === 'admin';
}

function isCoCboardModeratorUser(user) {
  return user?.user_metadata?.telegram_moderator === true;
}

/** Admin web oppure moderatore Telegram (staff ticket + segnalazioni globali). */
async function isSupportStaff(ctx) {
  const uid = ctx.from?.id;
  if (uid == null) return false;
  if (cv.isBotOwnerTelegramUser(uid)) return true;
  const sess = await tauth.getValidSession(uid).catch(() => null);
  if (!sess?.user) return false;
  if (isCoCboardAdminUser(sess.user)) return true;
  return isCoCboardModeratorUser(sess.user);
}

function normalizeBotCommandName(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('/')) return '';
  const cmd = raw.split(/\s+/)[0].toLowerCase();
  const bare = cmd.split('@')[0];
  return bare;
}

async function isExplicitGroupInvocation(ctx) {
  const txt = (ctx.message?.text || '').trim();
  if (!txt) return false;
  if (txt.startsWith('/')) return true;
  const botUsername = (await ensureTgBotUsername(ctx.telegram)).toLowerCase();
  if (!botUsername) return false;
  const low = txt.toLowerCase();
  return low.includes(`@${botUsername}`);
}

async function isTelegramChatAdmin(ctx) {
  if (!isGroupLikeContext(ctx) || ctx.from?.id == null || ctx.chat?.id == null) return false;
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return member?.status === 'administrator' || member?.status === 'creator';
  } catch (_) {
    return false;
  }
}

/** Capo / Co-Capo / Admin: collegano la chat al clan. */
function isClanLeader(user) {
  const r = user?.user_metadata?.role || 'utente';
  return ['admin', 'capo', 'co-capo'].includes(r);
}

/** Capo / Co-Capo / Admin: assegnazione bonus CWL dal bot. */
function isCapoOrCoCapoForBonus(user) {
  const r = user?.user_metadata?.role || 'utente';
  return r === 'admin' || r === 'capo' || r === 'co-capo';
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
  if (d === 'menu' || d === 'noop') return true;
  if (d === 'clan_home' || d === 'clan_webapps') return true;
  if (d === 'info' || d === 'cwl' || d === 'war_menu') return true;
  if (d === 'bonus:hist' || d === 'bonus:hof') return true;
  if (/^bonus:\d+$/.test(d)) return true;
  if (/^bonus:sv:\d{4}-\d{2}$/.test(d)) return true;
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

function resetSupportContextForUser(uid) {
  if (uid == null) return;
  pendingSupportOpen.delete(uid);
  adminActiveSupportTicket.delete(uid);
  pendingManualReportTarget.delete(uid);
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
    d === 'notif_menu' ||
    d === 'notif_war' ||
    d === 'notif_cwl' ||
    d === 'notif_raids' ||
    d === 'notif_games' ||
    d === 'support_open' ||
    d === 'support_user_manage' ||
    d === 'support_user_menu' ||
    d === 'support_user_reopen' ||
    d === 'support_user_new' ||
    d === 'support_user_cancel_active' ||
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
    d === 'comm_global_report' ||
    d === 'comm_global_mode' ||
    d === 'comm_global_quick' ||
    d === 'comm_recruit' ||
    d === 'comm_recruit_list' ||
    d === 'comm_recruit_send' ||
    d === 'comm_recruit_quick' ||
    d === 'comm_recruit_guided' ||
    d === 'recg_skip_link' ||
    d === 'recg_skip_media' ||
    d === 'recg_confirm' ||
    d === 'recg_cancel' ||
    d === 'support_open'
  );
}

/** Ospite in chat privata: scorciatoie web solo dopo login (menù autenticato). */
function buildPrivateGuestKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔑 Accedi', 'auth_login'), Markup.button.callback('📝 Registrati', 'auth_register')],
    [Markup.button.callback('💬 Community', 'comm_hub')],
    [Markup.button.callback('🔍 Cerca', 'nav_search'), Markup.button.callback('📊 Classifica', 'nav_rank')],
    [Markup.button.callback('📩 Contatta amministratore', 'support_open')],
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
    [Markup.button.url('📘 Tutorial', TELEGRAPH_TUTORIAL_URL)],
    [Markup.button.callback('ℹ️ Guida gruppo', 'auth_guest_help')]
  );
  return Markup.inlineKeyboard(rows);
}

function normalizeCoCClanTag(raw) {
  if (raw == null || !String(raw).trim()) return null;
  const u = String(raw).trim().toUpperCase();
  return u.startsWith('#') ? u : `#${u}`;
}

/** Tag villaggio da profilo Supabase o riga telegram_links (stesso ordine di priorità ragionevole). */
async function resolvePlayerTagForClanLookup(telegramUserId, user) {
  const meta = user?.user_metadata || {};
  let t = meta.coc_tag;
  if (t && String(t).trim()) {
    const u = String(t).trim().toUpperCase();
    return u.startsWith('#') ? u : `#${u}`;
  }
  const row = await sb.getTelegramRow(telegramUserId).catch(() => null);
  t = row?.player_tag;
  if (t && String(t).trim()) {
    const u = String(t).trim().toUpperCase();
    return u.startsWith('#') ? u : `#${u}`;
  }
  return null;
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
  const metaClan = normalizeCoCClanTag(user?.user_metadata?.coc_clan_tag);
  if (metaClan) {
    try {
      const info = await api.clanInfo(metaClan);
      return { clanTag: metaClan, clanName: info.name || metaClan, hasOverride: false };
    } catch {
      return { clanTag: metaClan, clanName: metaClan, hasOverride: false };
    }
  }
  // Profilo CoC live: coc_clan_tag su Auth può essere vuoto se l'utente è entrato in clan dopo la registrazione
  // o se i metadati non sono stati aggiornati — stesso player tag usato per login/registrazione.
  const playerTag = await resolvePlayerTagForClanLookup(telegramUserId, user);
  if (playerTag) {
    try {
      const p = await api.lookupPlayer(playerTag);
      const ct = p?.clan?.tag;
      if (ct && String(ct).trim()) {
        const tag = normalizeCoCClanTag(ct);
        const name = (p.clan && p.clan.name) || tag;
        if (tag) {
          return { clanTag: tag, clanName: name || tag, hasOverride: false };
        }
      }
    } catch (_) {}
  }
  return { clanTag: null, clanName: null, hasOverride: false };
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
const PRIVATE_RK_REPORT_GLOBAL = '🚩 Segnala (chat globale)';
const PRIVATE_RK_CANCEL_RECRUIT = 'Annulla reclutamento';

/** Ultimo messaggio usato solo per tenere visibile la reply keyboard (stesso uid → sostituito a ogni refresh). */
const privateReplyKeyboardAnchorIds = new Map();

privateUi.setOnBeforePrivateUiWipe((uid) => {
  privateReplyKeyboardAnchorIds.delete(uid);
});

async function buildPrivateReplyKeyboardMarkup(uid) {
  const rows = [[Markup.button.text(PRIVATE_RK_MENU), Markup.button.text(PRIVATE_RK_HELP)]];
  if (adminActiveSupportTicket.has(uid)) {
    rows.push([Markup.button.text(SUPPORT_RK_TAKE), Markup.button.text(SUPPORT_RK_WAIT)]);
    rows.push([Markup.button.text(SUPPORT_RK_CLOSE), Markup.button.text(SUPPORT_RK_EXIT)]);
    rows.push([Markup.button.text(SUPPORT_RK_BAN), Markup.button.text(SUPPORT_RK_UNBAN)]);
  }
  if (await sbcCommunity.isActiveInGlobalChat(uid).catch(() => false)) {
    rows.push([Markup.button.text(PRIVATE_RK_REPORT_GLOBAL), Markup.button.text(PRIVATE_RK_EXIT_GLOBAL)]);
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
    `🆘 <b>Supporto</b>`,
    `<code>/assistenza</code>`,
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

async function isSupportAdmin(ctx) {
  const uid = ctx.from?.id;
  if (uid == null) return false;
  if (cv.isBotOwnerTelegramUser(uid)) return true;
  const sess = await tauth.getValidSession(uid).catch(() => null);
  return isCoCboardAdminUser(sess?.user);
}

function supportAdminPanelKb(openGlobalReportsCount = null, webAppUrl = null) {
  const globalLabel =
    Number.isFinite(Number(openGlobalReportsCount)) && Number(openGlobalReportsCount) > 0
      ? `🚩 Segnalazioni chat globale (${Number(openGlobalReportsCount)})`
      : '🚩 Segnalazioni chat globale';
  const rows = [];
  if (webAppUrl && String(webAppUrl).startsWith('https://')) {
    rows.push([Markup.button.webApp('🌐 CoCBoardBot (Mini App)', webAppUrl)]);
  }
  rows.push(
    [Markup.button.callback(globalLabel, 'support_admin_global_reports')],
    [Markup.button.callback('🗂 Ticket chiusi', 'support_admin_closed')],
    [Markup.button.callback('🚫 Utenti bannati', 'support_admin_banned_users')],
    [Markup.button.callback('📬 Segnalazioni attive', 'support_admin_open')],
    [Markup.button.callback('👤 Solo miei assegnati', 'support_admin_mine')],
    [Markup.button.callback('📊 Statistiche bot', 'support_admin_stats')],
    [Markup.button.callback('📄 Export CSV metriche', 'support_admin_csv')],
    [Markup.button.callback('« Menù', 'menu')],
  );
  return Markup.inlineKeyboard(rows);
}

/** Tastierino admin bot + link Mini App verso tab CoCBoardBot (open_tab=botadmin). */
async function supportAdminPanelKbAsync(ctx, openGlobalReportsCount = null) {
  let wu = null;
  try {
    wu = await buildWebAppHandoffUrl(ctx, { open_tab: 'botadmin' });
  } catch (_) {}
  return supportAdminPanelKb(openGlobalReportsCount, wu);
}

function supportModeratorPanelKb(openGlobalReportsCount = null, webAppUrl = null) {
  const globalLabel =
    Number.isFinite(Number(openGlobalReportsCount)) && Number(openGlobalReportsCount) > 0
      ? `🚩 Segnalazioni chat globale (${Number(openGlobalReportsCount)})`
      : '🚩 Segnalazioni chat globale';
  const rows = [];
  if (webAppUrl && String(webAppUrl).startsWith('https://')) {
    rows.push([Markup.button.webApp('🌐 CoCBoardBot (Mini App)', webAppUrl)]);
  }
  rows.push(
    [Markup.button.callback(globalLabel, 'support_admin_global_reports')],
    [Markup.button.callback('📬 Ticket attivi', 'support_admin_open')],
    [Markup.button.callback('👤 Solo miei assegnati', 'support_admin_mine')],
    [Markup.button.callback('« Menù', 'menu')],
  );
  return Markup.inlineKeyboard(rows);
}

async function supportModeratorPanelKbAsync(ctx, openGlobalReportsCount = null) {
  let wu = null;
  try {
    wu = await buildWebAppHandoffUrl(ctx, { open_tab: 'botadmin' });
  } catch (_) {}
  return supportModeratorPanelKb(openGlobalReportsCount, wu);
}

async function supportHomeKbAsync(ctx, openGlobalReportsCount = null) {
  if (await isSupportAdmin(ctx)) return supportAdminPanelKbAsync(ctx, openGlobalReportsCount);
  return supportModeratorPanelKbAsync(ctx, openGlobalReportsCount);
}

async function sendSupportAdminPanel(ctx, text) {
  const n = await sb.listGlobalChatReports(['open', 'in_review'], 200).then((r) => (r || []).length).catch(() => 0);
  const full = await isSupportAdmin(ctx);
  const title =
    text ||
    (full ? '🛠 <b>Pannello amministratore bot</b>' : '🛡 <b>Pannello moderatori CoCBoardBot</b>');
  const kb = await supportHomeKbAsync(ctx, n);
  await ctx.reply(title, { parse_mode: 'HTML', ...kb });
}

function supportTicketListKb(rows, includeClosed = true) {
  const buttons = (rows || []).slice(0, 20).map((r) => [
    Markup.button.callback(`🎫 #${r.id} · utente ${r.telegram_user_id} · ${r.status}`, `support_admin_ticket:${r.id}`),
  ]);
  if (includeClosed) buttons.push([Markup.button.callback('🗂 Ticket chiusi', 'support_admin_closed')]);
  buttons.push([Markup.button.callback('« CoCBoardBot', 'support_admin_home')]);
  return Markup.inlineKeyboard(buttons);
}

function supportTicketAdminKb(ticketId, fullAdmin = true) {
  const rows = [
    [
      Markup.button.callback('✅ Presa in carico', `support_admin_take:${ticketId}`),
      Markup.button.callback('💬 Rispondi', `support_admin_reply:${ticketId}`),
    ],
    [
      Markup.button.callback('⏸ In attesa utente', `support_admin_wait:${ticketId}`),
      Markup.button.callback('🔒 Chiudi ticket', `support_admin_close:${ticketId}`),
    ],
  ];
  if (fullAdmin) {
    rows.push([
      Markup.button.callback('🚫 Permaban utente', `support_admin_ban:${ticketId}`),
      Markup.button.callback('✅ Rimuovi ban', `support_admin_unban:${ticketId}`),
    ]);
  }
  rows.push([Markup.button.callback('« Segnalazioni attive', 'support_admin_open')]);
  rows.push([Markup.button.callback('🏠 CoCBoardBot', 'support_admin_home')]);
  return Markup.inlineKeyboard(rows);
}

function globalReportListKb(rows) {
  const buttons = (rows || []).slice(0, 20).map((r) => [
    Markup.button.callback(`🚩 #${r.id} · ${r.status} · utente ${r.reporter_telegram_user_id}`, `support_admin_greport:${r.id}`),
  ]);
  buttons.push([Markup.button.callback('« CoCBoardBot', 'support_admin_home')]);
  return Markup.inlineKeyboard(buttons);
}

function globalReportAdminKb(report, opts = {}) {
  const fullAdmin = opts.fullAdmin !== false;
  const id = Number(report?.id);
  const hasTarget = report?.reported_target_telegram_user_id != null;
  const isMuted = opts.isMuted === true;
  const rows = [
    [Markup.button.callback('📌 Prendi in carico', `support_admin_greport_take:${id}`)],
    [Markup.button.callback('✅ Archivia', `support_admin_greport_archive:${id}`)],
  ];
  if (hasTarget) {
    if (!isMuted) {
      rows.push([
        Markup.button.callback('🔇 Mute 2h', `support_admin_greport_muteh:${id}:2`),
        Markup.button.callback('🔇 4h', `support_admin_greport_muteh:${id}:4`),
        Markup.button.callback('🔇 8h', `support_admin_greport_muteh:${id}:8`),
      ]);
      rows.push([
        Markup.button.callback('🔇 16h', `support_admin_greport_muteh:${id}:16`),
        Markup.button.callback('🔇 24h', `support_admin_greport_muteh:${id}:24`),
        Markup.button.callback('🔇 48h', `support_admin_greport_muteh:${id}:48`),
      ]);
    } else {
      rows.push([
        Markup.button.callback('🔈 Unmute', `support_admin_greport_unmute:${id}`),
        Markup.button.callback('🔇 Cambia durata', `support_admin_greport_remute:${id}`),
      ]);
    }
    if (fullAdmin) rows.push([Markup.button.callback('🚫 Ban utente', `support_admin_greport_ban:${id}`)]);
  }
  if (!hasTarget && fullAdmin) {
    rows.push([Markup.button.callback('🎯 Imposta target manuale', `support_admin_greport_target:${id}`)]);
  }
  if (fullAdmin) rows.push([Markup.button.callback('🚫 Utenti bannati', 'support_admin_banned_users')]);
  rows.push([Markup.button.callback('« Segnalazioni globali', 'support_admin_global_reports')]);
  return Markup.inlineKeyboard(rows);
}

function bannedUsersListKb(rows) {
  const buttons = (rows || []).slice(0, 20).map((r) => [
    Markup.button.callback(
      `🚫 ${r.telegram_user_id} · ${r.reason ? String(r.reason).slice(0, 22) : 'n/a'}`,
      `support_admin_banned:${r.telegram_user_id}`
    ),
  ]);
  buttons.push([Markup.button.callback('« CoCBoardBot', 'support_admin_home')]);
  return Markup.inlineKeyboard(buttons);
}

function bannedUserAdminKb(telegramUserId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Rimuovi ban', `support_admin_unban_user:${telegramUserId}`)],
    [Markup.button.callback('🔈 Unmute', `support_admin_unmute_user:${telegramUserId}`)],
    [
      Markup.button.callback('🔇 2h', `support_admin_mute_userh:${telegramUserId}:2`),
      Markup.button.callback('🔇 4h', `support_admin_mute_userh:${telegramUserId}:4`),
      Markup.button.callback('🔇 8h', `support_admin_mute_userh:${telegramUserId}:8`),
    ],
    [
      Markup.button.callback('🔇 16h', `support_admin_mute_userh:${telegramUserId}:16`),
      Markup.button.callback('🔇 24h', `support_admin_mute_userh:${telegramUserId}:24`),
      Markup.button.callback('🔇 48h', `support_admin_mute_userh:${telegramUserId}:48`),
    ],
    [Markup.button.callback('🚫 Utenti bannati', 'support_admin_banned_users')],
    [Markup.button.callback('« Pannello admin', 'support_admin_home')],
  ]);
}

async function showSupportOpenPrompt(ctx) {
  const txt =
    `📩 <b>Contatta amministratore</b>\n\n` +
    `🟣 <b>Modalità attiva:</b> <i>Supporto</i>\n\n` +
    `Invia qui il tuo problema (testo + max 2 immagini).\n` +
    `File non ammessi: zip, documenti, audio, video, sticker.\n\n` +
    `Se hai già un ticket aperto, il messaggio verrà aggiunto lì.`;
  const kb = Markup.inlineKeyboard([[Markup.button.callback('« Menù', 'menu')]]);
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(txt, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(txt, { parse_mode: 'HTML', ...kb });
    }
  } else {
    await ctx.reply(txt, { parse_mode: 'HTML', ...kb });
  }
}

async function showSupportEntryHub(ctx) {
  const uid = ctx.from?.id;
  if (uid == null || isLinkedChatContext(ctx)) return;
  const openT = await sb.getOpenTicketForUser(uid).catch(() => null);
  const closedT = await sb.getLatestClosedPendingTicketForUser(uid).catch(() => null);
  if (openT) {
    const body =
      `📩 <b>Supporto</b>\n\n` +
      `🟣 <b>Modalità attiva:</b> <i>Supporto</i>\n\n` +
      `Hai un ticket attivo: <b>#${openT.id}</b>.\n` +
      `Scrivi ora il tuo messaggio (testo + max ${SUPPORT_MAX_PHOTO_PER_SESSION} immagini in questa sessione).`;
    await ctx.reply(body, { parse_mode: 'HTML', ...supportManageKb(true, Boolean(closedT)) }).catch(() => {});
    return;
  }
  const body =
    `📩 <b>Supporto</b>\n\n` +
    `🟣 <b>Modalità attiva:</b> <i>Supporto</i>\n\n` +
    `Apri un nuovo ticket oppure riapri l’ultimo chiuso (max ${SUPPORT_MAX_REOPEN} riaperture).\n` +
    `Per ogni sessione ticket: massimo ${SUPPORT_MAX_PHOTO_PER_SESSION} immagini.`;
  await ctx.reply(body, { parse_mode: 'HTML', ...supportManageKb(false, Boolean(closedT)) }).catch(() => {});
}

function closedTicketUserKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🧰 Gestisci ticket', 'support_user_manage')],
    [Markup.button.callback('🏠 Torna al menù', 'support_user_menu')],
    [Markup.button.callback('♻️ Riapri ticket', 'support_user_reopen')],
    [Markup.button.callback('🆕 Nuovo ticket', 'support_user_new')],
  ]);
}

function supportManageKb(hasOpen, hasClosed) {
  const rows = [];
  if (hasOpen) rows.push([Markup.button.callback('💬 Continua ticket attivo', 'support_user_manage')]);
  if (hasClosed) rows.push([Markup.button.callback('♻️ Riapri ticket chiuso', 'support_user_reopen')]);
  rows.push([Markup.button.callback('🆕 Apri nuovo ticket', 'support_user_new')]);
  rows.push([Markup.button.callback('🏠 Torna al menù', 'support_user_menu')]);
  return Markup.inlineKeyboard(rows);
}

/** Dopo apertura ticket da pulsante «Apri nuovo ticket»: solo uscita verso il menù (le altre opzioni restano in /assistenza). */
function supportActiveSessionSimpleKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('↩️ Annulla ticket e torna al menù', 'support_user_cancel_active')],
  ]);
}

function formatSupportWritePromptHtml(ticketId) {
  return (
    `📩 <b>Ticket #${ticketId}</b>\n\n` +
    `🟣 <b>Supporto attivo:</b> i prossimi messaggi verranno inviati al ticket.\n` +
    `<i>Per uscire: usa «Torna al menù» o /start.</i>\n\n` +
    `Scrivi qui il messaggio per il supporto (testo e fino a <b>${SUPPORT_MAX_PHOTO_PER_SESSION}</b> immagini in questa sessione).`
  );
}

async function notifyAdminsTicketUpdate(ctx, ticketId, senderLabel, text, photoFileId) {
  const ticket = await sb.getTicketById(ticketId).catch(() => null);
  if (!ticket) return;
  const targets = new Set();
  if (ticket.assigned_admin_id != null) targets.add(Number(ticket.assigned_admin_id));
  cv.parseOwnerTelegramIds().forEach((id) => targets.add(Number(id)));
  const body = `📨 Ticket #${ticketId} · ${senderLabel}\nUtente: <code>${ticket.telegram_user_id}</code>\n${fmt.escapeHtml(text || '')}`.trim();
  for (const aid of targets) {
    if (!Number.isFinite(aid)) continue;
    // Se l'admin è già nella chat del ticket attivo, inoltra direttamente in realtime.
    if (adminActiveSupportTicket.get(aid) === Number(ticketId)) {
      const livePrefix = senderLabel === 'utente' ? '🙋 Utente' : '📨 Aggiornamento';
      const liveBody = `${livePrefix} · ticket #${ticketId}\n${fmt.escapeHtml(text || '')}`.trim();
      if (photoFileId) {
        await ctx.telegram
          .sendPhoto(aid, photoFileId, {
            caption: liveBody.slice(0, 900),
            parse_mode: 'HTML',
          })
          .catch(() => {});
      } else if (String(text || '').trim()) {
        await ctx.telegram.sendMessage(aid, liveBody, { parse_mode: 'HTML' }).catch(() => {});
      }
      continue;
    }
    const kb = Markup.inlineKeyboard([[Markup.button.callback(`Apri ticket #${ticketId}`, `support_admin_ticket:${ticketId}`)]]);
    if (photoFileId) {
      await ctx.telegram
        .sendPhoto(aid, photoFileId, {
          caption: body.slice(0, 900),
          parse_mode: 'HTML',
          reply_markup: kb.reply_markup,
        })
        .catch(() => {});
    } else {
      await ctx.telegram
        .sendMessage(aid, body, { parse_mode: 'HTML', reply_markup: kb.reply_markup })
        .catch(() => {});
    }
  }
}

async function performAdminTicketAction(ctx, ticketId, actionText) {
  const t = await sb.getTicketById(ticketId).catch(() => null);
  if (!t) {
    await ctx.reply('Ticket non trovato.');
    adminActiveSupportTicket.delete(ctx.from.id);
    await refreshPrivateReplyKeyboard(ctx);
    return;
  }
  if (actionText === SUPPORT_RK_TAKE) {
    await sb.setTicketStatus(ticketId, 'in_progress', ctx.from?.id).catch(() => {});
    await sb.appendSupportMessage(ticketId, { from_role: 'system', text: 'Ticket preso in carico da un amministratore.' }).catch(() => {});
    if (t.telegram_user_id) {
      await ctx.telegram.sendMessage(t.telegram_user_id, '✅ Il tuo ticket è stato preso in carico da un amministratore.').catch(() => {});
    }
    await ctx.reply(`Ticket #${ticketId} preso in carico.`);
    return;
  }
  if (actionText === SUPPORT_RK_WAIT) {
    await sb.setTicketStatus(ticketId, 'waiting_user', ctx.from?.id).catch(() => {});
    if (t.telegram_user_id) {
      await ctx.telegram.sendMessage(t.telegram_user_id, '⏸ Ticket in attesa di un tuo riscontro.').catch(() => {});
    }
    await ctx.reply(`Ticket #${ticketId} impostato in attesa utente.`);
    return;
  }
  if (actionText === SUPPORT_RK_CLOSE) {
    await sb.setTicketStatus(ticketId, 'closed_pending_purge', ctx.from?.id).catch(() => {});
    await sb.appendSupportMessage(ticketId, { from_role: 'system', text: 'Ticket chiuso: purge definitivo tra 7 giorni.' }).catch(() => {});
    if (t.telegram_user_id) {
      await ctx.telegram
        .sendMessage(
          t.telegram_user_id,
          '🔒 Ticket chiuso. Entro 7 giorni verrà eliminato definitivamente.\nSe vuoi, puoi riaprirlo entro 7 giorni; dopo dovrai aprire un nuovo ticket.',
          { ...closedTicketUserKb() }
        )
        .catch(() => {});
    }
    await ctx.reply(`Ticket #${ticketId} chiuso (purge tra 7 giorni).`);
    return;
  }
  if (actionText === SUPPORT_RK_BAN) {
    await sb.setTelegramUserBanned(t.telegram_user_id, true, `Permaban da ticket #${ticketId}`, ctx.from?.id).catch(() => {});
    await ctx.reply(`🚫 Utente <code>${t.telegram_user_id}</code> bannato.`, { parse_mode: 'HTML' });
    return;
  }
  if (actionText === SUPPORT_RK_UNBAN) {
    await sb.setTelegramUserBanned(t.telegram_user_id, false, `Unban da ticket #${ticketId}`, ctx.from?.id).catch(() => {});
    await ctx.reply(`✅ Ban rimosso per utente <code>${t.telegram_user_id}</code>.`, { parse_mode: 'HTML' });
    return;
  }
}

async function handleSupportInboundMessage(ctx) {
  if (ctx.chat?.type !== 'private' || !ctx.from?.id || !ctx.message) return false;
  const uid = ctx.from.id;
  const txt = (ctx.message.text || '').trim();
  if (txt.startsWith('/')) return false;
  // Se l'utente è dentro la chat globale, la priorità è sempre il relay community.
  const inGlobalChat = await sbcCommunity.isActiveInGlobalChat(uid).catch(() => false);
  if (inGlobalChat) return false;
  // Non intercettare se l'utente è in altri wizard attivi.
  if (pendingAuth.has(uid) || pendingSearch.has(uid) || pendingLinkWizard.has(uid) || pendingCommunity.has(uid)) return false;

  const hasPhoto = Array.isArray(ctx.message.photo) && ctx.message.photo.length > 0;
  const hasText = Boolean(ctx.message.text || ctx.message.caption);
  const unsupportedAttachment =
    ctx.message.document || ctx.message.video || ctx.message.audio || ctx.message.voice || ctx.message.sticker || ctx.message.animation;

  if (unsupportedAttachment) {
    await ctx
      .reply('❌ In supporto sono ammessi solo <b>testo</b> e <b>immagini</b> (max 2 per ticket). Altri file non sono accettati.', {
        parse_mode: 'HTML',
      })
      .catch(() => {});
    return true;
  }
  if (!hasPhoto && !hasText) return false;

  const explicitlyOpened = pendingSupportOpen.get(uid) === true;
  if (!explicitlyOpened) return false;
  let ticket = await sb.getOpenTicketForUser(uid).catch(() => null);
  let justCreatedTicket = false;
  if (!ticket) {
    try {
      ticket = await sb.createSupportTicket(uid, 'Richiesta supporto Telegram');
      justCreatedTicket = true;
    } catch (e) {
      console.error('[cocboard-bot] handleSupportInboundMessage createSupportTicket', e?.message || e);
      pendingSupportOpen.delete(uid);
      await ctx
        .reply(
          '❌ Impossibile aprire il ticket (errore database). Chiedi allo staff di controllare su Supabase le tabelle ticket e su Render la variabile <code>SUPABASE_SERVICE_ROLE_KEY</code> (deve essere la chiave <b>service_role</b>, non la anon).',
          { parse_mode: 'HTML' }
        )
        .catch(() => {});
      return true;
    }
  }
  pendingSupportOpen.delete(uid);

  if (ticket.status === 'closed_pending_purge') {
    await sb.setTicketStatus(ticket.id, 'open', null).catch(() => {});
    await ctx.reply('♻️ Ticket riaperto. Puoi continuare la conversazione.', { parse_mode: 'HTML' }).catch(() => {});
  }

  let photoFileId = null;
  if (hasPhoto) {
    const sessionIdx = Number(ticket.session_index || 1);
    const photoCount = await sb.countTicketPhotosInSession(ticket.id, sessionIdx).catch(() => 0);
    if (photoCount >= SUPPORT_MAX_PHOTO_PER_SESSION) {
      await ctx.reply(`⚠️ Hai già inviato ${SUPPORT_MAX_PHOTO_PER_SESSION} immagini in questa sessione ticket.`, {
        parse_mode: 'HTML',
      });
      return true;
    }
    photoFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  }
  const bodyText = (ctx.message.text || ctx.message.caption || '').trim();
  await sb
    .appendSupportMessage(ticket.id, {
      from_role: 'user',
      from_telegram_user_id: uid,
      text: bodyText || null,
      photo_file_id: photoFileId,
          session_index: Number(ticket.session_index || 1),
    })
    .catch(() => {});
  await sb.insertUsageEvent({ telegram_user_id: uid, telegram_chat_id: uid, chat_type: 'private', event_type: 'support_msg' }).catch(() => {});
  await notifyAdminsTicketUpdate(ctx, ticket.id, 'utente', bodyText || (photoFileId ? '[immagine]' : ''), photoFileId);
  const confirmText = justCreatedTicket
    ? `✅ <b>Ticket #${ticket.id}</b> aperto.\n📨 Messaggio inviato al supporto.`
    : '📨 Messaggio inviato al supporto.';
  await ctx
    .reply(confirmText, { parse_mode: 'HTML', ...(justCreatedTicket ? supportActiveSessionSimpleKb() : {}) })
    .catch(() => {});
  return true;
}

function guardMiddleware() {
  return async (ctx, next) => {
    const uid = guardUserId(ctx);
    if (uid == null) return next();
    try {
      const restr = await sb.getTelegramUserRestriction(uid);
      if (restr?.banned === true) {
        if (ctx.callbackQuery) await ctx.answerCbQuery('Account bloccato.').catch(() => {});
        else if (ctx.message) {
          await ctx
            .reply('🚫 Questo account è stato bloccato dall’amministratore del bot. Contatta il supporto se pensi sia un errore.')
            .catch(() => {});
        }
        return;
      }
      const mutedUntil = restr?.muted_until ? new Date(restr.muted_until).getTime() : 0;
      if (mutedUntil > Date.now()) {
        const untilStr = new Date(mutedUntil).toLocaleString('it-IT', { timeZone: 'UTC' });
        if (ctx.callbackQuery) await ctx.answerCbQuery('Account in limitazione temporanea.').catch(() => {});
        else if (ctx.message) {
          await ctx
            .reply(`🔇 Account in limitazione temporanea fino a ${untilStr} UTC. Contatta il supporto se necessario.`)
            .catch(() => {});
        }
        return;
      }
    } catch (_) {}
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
      _trackMenuMsg(ctx.chat?.id, ctx.callbackQuery.message?.message_id);
    } catch (_) {
      const m = await ctx.reply(text, { parse_mode: 'HTML', ...kb });
      _trackMenuMsg(ctx.chat?.id, m?.message_id);
    }
  } else {
    const m = await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    _trackMenuMsg(ctx.chat?.id, m?.message_id);
  }
  if (!group) await refreshPrivateReplyKeyboard(ctx);
}

async function sendLinkedGroupGuestMenu(ctx, clanTag) {
  let clanName = clanTag;
  try { const info = await api.clanInfo(clanTag); clanName = info.name || clanTag; } catch (_) {}
  await ensureTgBotUsername(ctx.telegram);
  const intro = fmt.formatLinkedGroupGuestIntro({ clanTag, clanName, botUsername: cachedTgBotUsername });
  const rows = [
    [Markup.button.callback(shortClanButtonLabel(clanName, clanTag), 'clan_home')],
    [Markup.button.callback('🔍 Cerca', 'nav_search'), Markup.button.callback('📊 Classifica', 'nav_rank')],
  ];
  const url = privateChatUrl(cachedTgBotUsername);
  if (url) {
    rows.push([Markup.button.url('🔐 Accedi / Registrati (privato)', url)]);
  }
  rows.push([Markup.button.url('📘 Tutorial', TELEGRAPH_TUTORIAL_URL)]);
  rows.push([Markup.button.callback('❓ Aiuto', 'helpbtn')]);
  const kb = Markup.inlineKeyboard(rows);
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(intro, { parse_mode: 'HTML', ...kb });
      _trackMenuMsg(ctx.chat?.id, ctx.callbackQuery.message?.message_id);
    } catch (_) {
      const m = await ctx.reply(intro, { parse_mode: 'HTML', ...kb });
      _trackMenuMsg(ctx.chat?.id, m?.message_id);
    }
  } else {
    const m = await ctx.reply(intro, { parse_mode: 'HTML', ...kb });
    _trackMenuMsg(ctx.chat?.id, m?.message_id);
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

function buildGuestWebUrl(openTab) {
  const base = (process.env.COCBOARD_SITE_HOME_URL || '').trim().replace(/\/$/, '');
  if (!base) return null;
  const q = new URLSearchParams({ open_tab: String(openTab || '') });
  return `${base}/?${q.toString()}`;
}

async function renderMiniAppLaunchForTab(ctx, tab) {
  const isPrivate = !isLinkedChatContext(ctx);
  if (!isPrivate) return false;
  const sess = await tauth.getValidSession(ctx.from?.id).catch(() => null);
  const authed = !!sess?.user;
  if (authed) ctx.cocboardUser = sess.user;
  if (!authed && !MINI_APP_GUEST_ALLOWED_TABS.has(tab)) {
    await ctx.reply('🔒 Sezione disponibile solo dopo login. Da ospite puoi usare le altre funzioni web.', {
      parse_mode: 'HTML',
    });
    return true;
  }
  let url = null;
  if (authed) {
    try {
      url = await buildWebAppHandoffUrl(ctx, { open_tab: tab });
    } catch (_) {
      url = null;
    }
  } else {
    url = buildGuestWebUrl(tab);
  }
  if (!url || !String(url).startsWith('https://')) {
    await ctx.reply('⚠️ Mini App non disponibile al momento.');
    return true;
  }
  const kb = Markup.inlineKeyboard([[Markup.button.webApp('📱 Apri Mini App', url)], [Markup.button.callback('« Menù', 'menu')]]);
  const body =
    `📱 <b>Mini App CoCBoard</b>\n\n` +
    `Sezione: <code>${fmt.escapeHtml(tab)}</code>\n` +
    `${authed ? 'Accesso verificato attivo.' : 'Accesso ospite attivo.'}`;
  await ctx.reply(body, { parse_mode: 'HTML', ...kb });
  return true;
}

function shortClanButtonLabel(clanName, clanTag) {
  const normalizedName = String(clanName || '').replace(/\s+/g, ' ').trim();
  const normalizedTag = String(clanTag || '').trim();
  const base = normalizedName || normalizedTag || 'Il tuo clan';
  const short = base.length > 20 ? `${base.slice(0, 20)}…` : base;
  return `🏠 ${short}`;
}

async function clanBackButtonLabel(ctx) {
  try {
    const info = await resolveEffectiveClanContext(ctx);
    if (info?.clanName || info?.clanTag) return `« ${shortClanButtonLabel(info.clanName, info.clanTag).replace(/^🏠\s*/, '')}`;
  } catch (_) {}
  return '« Indietro';
}

async function mainMenuKeyboard(ctx, user, hasClanTag, clanTag, clanName) {
  const rows = [];
  const leader = user ? isClanLeader(user) : false;
  const grp = isLinkedChatContext(ctx);
  let showClanRows = !!hasClanTag;
  if (grp) {
    const g = await getGroupChatGate(ctx);
    showClanRows = g.allowClanMenus;
  }
  if (showClanRows) {
    if (grp) {
      rows.push([
        Markup.button.callback(shortClanButtonLabel(clanName, clanTag), 'clan_home'),
        Markup.button.callback('🔔 Gestione avvisi', 'notif_menu'),
      ]);
    } else {
      rows.push([Markup.button.callback(shortClanButtonLabel(clanName, clanTag), 'clan_home')]);
    }
  } else if (!hasClanTag) {
    rows.push([Markup.button.callback('🏰 Come impostare il clan', 'setclan_help')]);
  }
  if (!grp) {
    rows.push([Markup.button.callback('💬 Community', 'comm_hub')]);
  }
  rows.push([
    Markup.button.callback('🔍 Cerca', 'nav_search'),
    Markup.button.callback('📊 Classifica', 'nav_rank'),
  ]);
  if (leader && !grp) {
    rows.push([Markup.button.callback('➕ Aggiungi a canale/gruppo', 'add_group_bot')]);
  }
  if (!grp && (isCoCboardAdminUser(user) || isCoCboardModeratorUser(user))) {
    rows.push([Markup.button.callback('🛠 CoCBoardBot', 'support_admin_home')]);
  }
  if (!grp) {
    rows.push([Markup.button.callback('📩 Contatta amministratore', 'support_open')]);
  }
  rows.push(
    [Markup.button.callback('⚙️ Account', 'acct'), Markup.button.callback('❓ Aiuto', 'helpbtn')],
    [Markup.button.callback('🚪 Logout', 'auth_logout')]
  );
  return Markup.inlineKeyboard(rows);
}

async function renderClanHubMenu(ctx) {
  const tag = await resolveEffectiveClanTag(ctx);
  if (!tag) {
    await ctx.answerCbQuery('Nessun clan disponibile').catch(() => {});
    return sendMainMenu(ctx);
  }
  const sess = await tauth.getValidSession(ctx.from?.id).catch(() => null);
  const isAuthed = !!sess?.user;
  if (isAuthed) ctx.cocboardUser = sess.user;
  const grp = isLinkedChatContext(ctx);
  await ensureTgBotUsername(ctx.telegram);
  const info = await resolveEffectiveClanContext(ctx);
  const label = shortClanButtonLabel(info?.clanName, info?.clanTag || tag).replace(/^🏠\s*/, '');
  const tagLine = info?.clanTag ? `\n<code>${fmt.escapeHtml(info.clanTag)}</code>` : '';
  const body =
    `${fmt.DIV}\n🏠 <b>${fmt.escapeHtml(label)}</b>${tagLine}\n${fmt.DIV}\n\n` +
    `Sezione clan e strumenti dedicati.`;
  const rows = [
    [Markup.button.callback('👥 Membri', 'mb0'), Markup.button.callback('🏰 Info clan', 'info')],
  ];
  if (isAuthed) {
    rows.push([Markup.button.callback('👤 Il mio profilo', 'me'), Markup.button.callback('🎁 Bonus', 'bonus:0')]);
  } else {
    rows.push([Markup.button.callback('🎁 Bonus', 'bonus:0')]);
  }
  rows.push([Markup.button.callback('🏆 CWL live', 'cwl'), Markup.button.callback('📜 Registro guerre', 'war_menu')]);
  rows.push(
    [Markup.button.callback('📱 Visualizza come mini app', 'clan_webapps')],
    [Markup.button.callback('« Menù', 'menu')]
  );
  try {
    await ctx.editMessageText(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  } catch (_) {
    await ctx.reply(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  }
}

async function renderClanWebAppsMenu(ctx) {
  const body =
    `${fmt.DIV}\n📱 <b>Mini App CoCBoard</b>\n${fmt.DIV}\n\n` +
    `Apri le sezioni web del clan direttamente da Telegram.`;
  const rows = [];
  const webPairsBase = [
    ['🏆 CWL live (web)', 'cwl_warlog', '📜 Registro guerre (web)', 'warlog'],
    ['🎁 Bonus (web)', 'bonus', '🏰 Info / Membri (web)', 'members'],
    ['🔍 Cerca (web)', 'cerca', '📊 Classifica (web)', 'rankings'],
  ];
  const sess = await tauth.getValidSession(ctx.from?.id).catch(() => null);
  const isAuthed = !!sess?.user;
  if (isAuthed) ctx.cocboardUser = sess.user;
  await ensureTgBotUsername(ctx.telegram);
  const loginUrl = privateChatUrl(cachedTgBotUsername);
  // Clan tag per ospiti in gruppo: codificato nel startapp così la Mini App sa quale clan mostrare
  const guestClanTag = (!isAuthed && isLinkedChatContext(ctx))
    ? await resolveEffectiveClanTag(ctx).catch(() => null)
    : null;
  const grp = isLinkedChatContext(ctx);
  const webPairs = isAuthed
    ? [...webPairsBase, ['👤 Profilo (web)', 'profilo', null, null]]
    : webPairsBase;
  for (const [la, ta, lb, tb] of webPairs) {
    try {
      const lockedA = !isAuthed && !MINI_APP_GUEST_ALLOWED_TABS.has(ta);
      let ua = null;
      if (!lockedA) {
        if (grp) ua = buildGuestWebUrl(ta);
        else if (isAuthed) ua = await buildWebAppHandoffUrl(ctx, { open_tab: ta });
        else ua = buildGuestWebUrl(ta);
      }
      if (lockedA) {
        if (grp) {
          const botUser = (cachedTgBotUsername || 'cocboardbot').replace(/^@/, '');
          const rawTag = (guestClanTag || '').replace(/^#/, '').trim();
          const sp = rawTag ? `${ta}__${rawTag}` : ta;
          rows.push([Markup.button.url(`${la} 🔒`, `https://t.me/${botUser}/home?startapp=${sp}`)]);
        } else if (loginUrl) {
          rows.push([Markup.button.url(`${la} 🔒`, loginUrl)]);
        } else {
          rows.push([Markup.button.callback(`${la} 🔒`, 'noop')]);
        }
        continue;
      }
      if (!ua || !String(ua).startsWith('https://')) continue;
      if (!lb || !tb) {
        rows.push([webLaunchButton(ctx, la, ua, ta, guestClanTag)]);
        continue;
      }
      const lockedB = !isAuthed && !MINI_APP_GUEST_ALLOWED_TABS.has(tb);
      let ub = null;
      if (!lockedB) {
        if (grp) ub = buildGuestWebUrl(tb);
        else if (isAuthed) ub = await buildWebAppHandoffUrl(ctx, { open_tab: tb });
        else ub = buildGuestWebUrl(tb);
      }
      if (lockedB) {
        if (grp) {
          const botUser = (cachedTgBotUsername || 'cocboardbot').replace(/^@/, '');
          const rawTag = (guestClanTag || '').replace(/^#/, '').trim();
          const sp = rawTag ? `${tb}__${rawTag}` : tb;
          rows.push([webLaunchButton(ctx, la, ua, ta, guestClanTag), Markup.button.url(`${lb} 🔒`, `https://t.me/${botUser}/home?startapp=${sp}`)]);
        } else if (loginUrl) {
          rows.push([webLaunchButton(ctx, la, ua, ta, guestClanTag), Markup.button.url(`${lb} 🔒`, loginUrl)]);
        } else {
          rows.push([webLaunchButton(ctx, la, ua, ta, guestClanTag), Markup.button.callback(`${lb} 🔒`, 'noop')]);
        }
      } else if (ub && String(ub).startsWith('https://')) {
        rows.push([webLaunchButton(ctx, la, ua, ta, guestClanTag), webLaunchButton(ctx, lb, ub, tb, guestClanTag)]);
      } else {
        rows.push([webLaunchButton(ctx, la, ua, ta, guestClanTag)]);
      }
    } catch (_) { /* singolo tab fallito — prosegui con i successivi */ }
  }
  if (rows.length === 0) {
    rows.push([Markup.button.callback('ℹ️ Mini app non disponibile', 'noop')]);
  }
  rows.push([Markup.button.callback(await clanBackButtonLabel(ctx), 'clan_home'), Markup.button.callback('« Menù', 'menu')]);
  try {
    await ctx.editMessageText(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  } catch (_) {
    await ctx.reply(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  }
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
  const kb = await mainMenuKeyboard(ctx, user, !!clanTag, clanTag, clanName);
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(intro, { parse_mode: 'HTML', ...kb });
      _trackMenuMsg(ctx.chat?.id, ctx.callbackQuery.message?.message_id);
    } catch (_) {
      const m = await ctx.reply(intro, { parse_mode: 'HTML', ...kb });
      _trackMenuMsg(ctx.chat?.id, m?.message_id);
    }
  } else {
    const m = await ctx.reply(intro, { parse_mode: 'HTML', ...kb });
    _trackMenuMsg(ctx.chat?.id, m?.message_id);
  }
  if (!grp && ctx.chat?.type === 'private') await refreshPrivateReplyKeyboard(ctx);
}

function backMenuKb() {
  return Markup.inlineKeyboard([[Markup.button.callback('« Menù', 'menu')]]);
}

function clanBackKb() {
  return Markup.inlineKeyboard([[Markup.button.callback('« Indietro', 'clan_home'), Markup.button.callback('« Menù', 'menu')]]);
}

function notifLabel(on) {
  return on ? '✅ ON' : '⚪ OFF';
}

async function notificationMenuKb(chatId) {
  const s = await sb.getChatNotificationSettings(chatId).catch(() => ({}));
  return Markup.inlineKeyboard([
    [Markup.button.callback(`⚔️ Guerra ${notifLabel(s.war_alerts_enabled === true)}`, 'notif_war')],
    [Markup.button.callback(`🏆 CWL ${notifLabel(s.cwl_alerts_enabled === true)}`, 'notif_cwl')],
    [Markup.button.callback(`🏛 Raid capitale ${notifLabel(s.capital_raids_enabled === true)}`, 'notif_raids')],
    [Markup.button.callback(`🎯 Giochi del clan ${notifLabel(s.clan_games_enabled === true)}`, 'notif_games')],
    [Markup.button.callback('« Menù', 'menu')],
  ]);
}

function buildMembersKb(page, pages) {
  const row = [];
  if (page > 0) row.push(Markup.button.callback('◀', `mb${page - 1}`));
  row.push(Markup.button.callback(`· ${page + 1}/${pages} ·`, 'noop'));
  if (page < pages - 1) row.push(Markup.button.callback('▶', `mb${page + 1}`));
  return Markup.inlineKeyboard([row, [Markup.button.callback('« Indietro', 'clan_home'), Markup.button.callback('« Menù', 'menu')]]);
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
    [Markup.button.callback('« Indietro', 'clan_home'), Markup.button.callback('« Menù', 'menu')],
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
      tab(view === 'ov', '📊 Panoramica', 'cwl_v:ov'),
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

  if (view !== 'ov') rows.push([Markup.button.callback('« CWL live', 'cwl_v:ov')]);
  rows.push([Markup.button.callback('« Indietro', 'clan_home'), Markup.button.callback('« Menù', 'menu')]);
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
  const kb = await buildCwlNavKb(data, formatted, webAppUrl);
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
    [Markup.button.callback('« Bonus', 'bonus:0'), Markup.button.callback('« Menù', 'menu')],
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

function bonusAssignSeasonLabelIt(season) {
  const [y, m] = String(season).split('-');
  if (!y || !m) return String(season);
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}

async function renderBonusAssignSeasonPick(ctx, clanTag) {
  const seasons = await sb.listCwlSeasonsForClan(clanTag).catch(() => []);
  const backKb = Markup.inlineKeyboard([
    [Markup.button.callback('« Bonus', 'bonus:0')],
    [Markup.button.callback('« Menù', 'menu')],
  ]);
  if (!seasons.length) {
    const txt =
      `${fmt.DIV}\n✏️ <b>Assegna bonus CWL</b>\n${fmt.DIV}\n\n` +
      `<i>Nessuna stagione in <code>cwl_history</code> per questo clan.</i>\n` +
      `Salva prima una stagione dalla scheda <b>Assegna</b> o dalla CWL live su CoCBoard.`;
    try {
      await ctx.editMessageText(txt, { parse_mode: 'HTML', ...backKb });
    } catch (_) {
      await ctx.reply(txt, { parse_mode: 'HTML', ...backKb });
    }
    return;
  }
  const rows = seasons.map((s) => [Markup.button.callback(`📅 ${bonusAssignSeasonLabelIt(s)}`, `bonus:azp:${s}`)]);
  rows.push([Markup.button.callback('« Bonus', 'bonus:0')]);
  const txt =
    `${fmt.DIV}\n✏️ <b>Assegna bonus CWL</b>\n${fmt.DIV}\n\n` +
    `Scegli la <b>stessa stagione</b> (<code>YYYY-MM</code>) che usi sul sito. ` +
    `Poi potrai usare <b>manuale</b> o <b>assistito</b> (suggerimento + conferma).`;
  try {
    await ctx.editMessageText(txt, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  } catch (_) {
    await ctx.reply(txt, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  }
}

async function renderBonusAssignPage(ctx, clanTag, season, page) {
  const all = await sb.fetchCwlHistoryFullSeason(clanTag, season).catch(() => []);
  if (!all.length) {
    await renderBonusAssignSeasonPick(ctx, clanTag);
    return;
  }
  const totalPages = Math.max(1, Math.ceil(all.length / BONUS_ASSIGN_PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const slice = all.slice(p * BONUS_ASSIGN_PAGE_SIZE, (p + 1) * BONUS_ASSIGN_PAGE_SIZE);
  const assignedN = all.filter((r) => r.bonus_assigned).length;
  const tagDisp = clanTag.startsWith('#') ? clanTag : `#${clanTag}`;
  let body =
    `${fmt.DIV}\n✏️ <b>Assegna bonus</b> · <i>${fmt.escapeHtml(bonusAssignSeasonLabelIt(season))}</i>\n` +
    `<code>${fmt.escapeHtml(tagDisp)}</code>\n${fmt.DIV}\n\n` +
    `🏆 <b>${assignedN}</b> con bonus su <b>${all.length}</b> righe.\n` +
    `Tocca un pulsante per <b>assegnare</b> o <b>rimuovere</b> il bonus.\n\n`;
  for (const r of slice) {
    const mark = r.bonus_assigned ? '✅' : '·';
    body += `${mark} <b>${fmt.escapeHtml(r.player_name)}</b> — score ${r.bonus_score ?? '—'}\n`;
  }
  if (totalPages > 1) body += `\n<i>Pagina ${p + 1}/${totalPages}</i>`;
  const kbRows = [];
  for (let i = 0; i < slice.length; i++) {
    const r = slice[i];
    const mark = r.bonus_assigned ? '✅' : '⬜';
    const short = String(r.player_name || '—').slice(0, 26);
    kbRows.push([Markup.button.callback(`${mark} ${short}`, `bonus:ast:${season}:${p}:${i}`)]);
  }
  const nav = [];
  if (p > 0) nav.push(Markup.button.callback('◀', `bonus:asp:${season}:${p - 1}`));
  if (totalPages > 1) nav.push(Markup.button.callback(`· ${p + 1}/${totalPages} ·`, 'noop'));
  if (p < totalPages - 1) nav.push(Markup.button.callback('▶', `bonus:asp:${season}:${p + 1}`));
  if (nav.length) kbRows.push(nav);
  kbRows.push([
    Markup.button.callback('« Stagioni', 'bonus:as'),
    Markup.button.callback('« Modalità', `bonus:azp:${season}`),
  ]);
  kbRows.push([Markup.button.callback('« Bonus', 'bonus:0')]);
  try {
    await ctx.editMessageText(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbRows) });
  } catch (_) {
    await ctx.reply(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbRows) });
  }
}

async function renderBonusAssignModePick(ctx, clanTag, season) {
  bonusWizardByUid.delete(ctx.from?.id);
  const tagDisp = clanTag.startsWith('#') ? clanTag : `#${clanTag}`;
  const body =
    `${fmt.DIV}\n✏️ <b>Assegna bonus</b> · <i>${fmt.escapeHtml(bonusAssignSeasonLabelIt(season))}</i>\n` +
    `<code>${fmt.escapeHtml(tagDisp)}</code>\n${fmt.DIV}\n\n` +
    `• <b>Manuale</b> — come la tabella web (pagina per pagina).\n` +
    `• <b>Assistito</b> — quanti bonus, criteri (es. escludi chi ha avuto bonus la stagione precedente, partecipazione, attacchi completi, peso TH sul roster); ` +
    `poi modifichi la lista e salvi.`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Manuale', `bonus:azm:${season}`)],
    [Markup.button.callback('🧮 Assistito', `bonus:aw:${season}`)],
    [Markup.button.callback('« Stagioni', 'bonus:as')],
    [Markup.button.callback('« Bonus', 'bonus:0')],
  ]);
  try {
    await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
  } catch (_) {
    await ctx.reply(body, { parse_mode: 'HTML', ...kb });
  }
}

async function renderBonusWizardSlots(ctx, clanTag, season) {
  bonusWizardByUid.delete(ctx.from?.id);
  const tagDisp = clanTag.startsWith('#') ? clanTag : `#${clanTag}`;
  const body =
    `${fmt.DIV}\n🧮 <b>Assistito</b> · ${fmt.escapeHtml(bonusAssignSeasonLabelIt(season))}\n` +
    `<code>${fmt.escapeHtml(tagDisp)}</code>\n${fmt.DIV}\n\n` +
    `Quanti <b>bonus</b> vuoi assegnare in questa stagione?`;
  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('2', `bonus:awn:${season}:2`),
      Markup.button.callback('3', `bonus:awn:${season}:3`),
      Markup.button.callback('4', `bonus:awn:${season}:4`),
      Markup.button.callback('5', `bonus:awn:${season}:5`),
    ],
    [
      Markup.button.callback('6', `bonus:awn:${season}:6`),
      Markup.button.callback('7', `bonus:awn:${season}:7`),
      Markup.button.callback('8', `bonus:awn:${season}:8`),
      Markup.button.callback('9', `bonus:awn:${season}:9`),
    ],
    [Markup.button.callback('« Modalità stagione', `bonus:azp:${season}`)],
  ]);
  try {
    await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
  } catch (_) {
    await ctx.reply(body, { parse_mode: 'HTML', ...kb });
  }
}

async function renderBonusWizardPresets(ctx, clanTag, season, slots) {
  const tagDisp = clanTag.startsWith('#') ? clanTag : `#${clanTag}`;
  const body =
    `${fmt.DIV}\n🧮 <b>Criteri suggerimento</b>\n${fmt.DIV}\n` +
    `<code>${fmt.escapeHtml(tagDisp)}</code> · <b>${slots}</b> bonus\n\n` +
    `• <b>Standard</b> — esclude chi ha avuto bonus nella <b>stagione precedente</b> (mese prima), solo partecipanti CWL, merito con <b>peso TH</b> (vs mediana roster).\n` +
    `• <b>Strict</b> — come Standard + tutti gli <b>attacchi richiesti</b> completati.\n` +
    `• <b>Solo peso TH</b> — ordina per merito aggiustato col TH (niente filtri su partecipazione o stagione precedente).\n` +
    `• <b>Solo score</b> — roster attivo, ordine per score salvato in storico.\n\n` +
    `<i>Non abbiamo in database TH avversario per singolo attacco; il peso TH è un’euristica sul roster.</i>`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('⭐ Standard', `bonus:awm:${season}:${slots}:11`)],
    [Markup.button.callback('⚙️ Strict', `bonus:awm:${season}:${slots}:15`)],
    [Markup.button.callback('📊 Solo peso TH', `bonus:awm:${season}:${slots}:8`)],
    [Markup.button.callback('📋 Solo score', `bonus:awm:${season}:${slots}:0`)],
    [Markup.button.callback('« Numero bonus', `bonus:aw:${season}`)],
  ]);
  try {
    await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
  } catch (_) {
    await ctx.reply(body, { parse_mode: 'HTML', ...kb });
  }
}

async function runBonusWizardComputeAndShow(ctx, clanTag, season, slots, mask) {
  const historyRows = await sb.fetchCwlHistoryFullSeason(clanTag, season).catch(() => []);
  if (!historyRows.length) {
    await ctx.answerCbQuery('Nessun dato per questa stagione').catch(() => {});
    await renderBonusAssignModePick(ctx, clanTag, season);
    return;
  }
  const prev = bonusAssist.prevSeasonYM(season);
  let prevSet = new Set();
  if (prev && (mask & bonusAssist.EXCL_PREV)) {
    prevSet = await sb.fetchBonusAssignedNamesForSeason(clanTag, prev).catch(() => new Set());
  }
  let thMap = new Map();
  if (mask & bonusAssist.TH_WEIGHT) {
    thMap = await sb.fetchMembersThByNameForClan(clanTag).catch(() => new Map());
  }
  const result = bonusAssist.runBonusAssistant({
    clanTag,
    season,
    maxSlots: slots,
    mask,
    historyRows,
    prevSeasonBonusNames: prevSet,
    thByNameLower: thMap,
  });
  bonusWizardByUid.set(ctx.from.id, { ...result, wizardPage: 0 });
  await renderBonusWizardCandidatePage(ctx, 0);
}

async function renderBonusWizardCandidatePage(ctx, page) {
  const uid = ctx.from?.id;
  const st = uid != null ? bonusWizardByUid.get(uid) : null;
  if (!st || !Array.isArray(st.candidates)) {
    await ctx.answerCbQuery('Sessione scaduta: riapri Assistito.').catch(() => {});
    return;
  }
  const { candidates, selected, maxSlots, season, mask, medianTh, clanTag } = st;
  const totalP = Math.max(1, Math.ceil(candidates.length / BONUS_WIZARD_PAGE));
  const p = Math.min(Math.max(0, page), totalP - 1);
  st.wizardPage = p;
  bonusWizardByUid.set(uid, st);
  const start = p * BONUS_WIZARD_PAGE;
  const slice = candidates.slice(start, start + BONUS_WIZARD_PAGE);
  const tagDisp = clanTag.startsWith('#') ? clanTag : `#${clanTag}`;
  let body =
    `${fmt.DIV}\n🧮 <b>Conferma bonus</b> · <i>${fmt.escapeHtml(bonusAssignSeasonLabelIt(season))}</i>\n` +
    `<code>${fmt.escapeHtml(tagDisp)}</code>\n${fmt.DIV}\n` +
    `<b>${selected.size}</b>/<b>${maxSlots}</b> selezionati · <i>${fmt.escapeHtml(bonusAssist.maskLabelIt(mask))}</i>`;
  if ((mask & bonusAssist.TH_WEIGHT) && medianTh > 0) {
    body += `\nMediana TH roster: <b>${medianTh}</b>.`;
  }
  const nEligible = candidates.filter((c) => c.eligible === true).length;
  body +=
    `\n\n<i>Lista: prima i <b>${nEligible}</b> idonei al preset, poi gli altri (selezionabili fino a ${maxSlots}). ` +
    `Pulsanti con <b>*</b> = fuori dal preset. ` +
    `Salvataggio = solo giocatori attivi/non secondari in questa stagione.</i>\n\n<b>Candidati</b> (pag. ${p + 1}/${totalP}):\n`;
  for (const c of slice) {
    const on = selected.has(c.player_name);
    const tag = c.eligible === false ? ' <i>(fuori preset)</i>' : '';
    body += `${on ? '✅' : '·'} ${fmt.escapeHtml(c.player_name)}${tag} — <code>${c.meritAdj}</code>${c.th ? ` TH${c.th}` : ''}\n`;
  }
  const kb = [];
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    const gi = start + i;
    const on = selected.has(c.player_name);
    const short = String(c.player_name || '—').slice(0, 18);
    const suf = c.eligible === false ? ' *' : '';
    kb.push([Markup.button.callback(`${on ? '✅' : '⬜'} ${short}${suf}`, `bonus:awt:${season}:${gi}`)]);
  }
  const nav = [];
  if (p > 0) nav.push(Markup.button.callback('◀', `bonus:awp:${season}:${p - 1}`));
  if (totalP > 1) nav.push(Markup.button.callback(`· ${p + 1}/${totalP} ·`, 'noop'));
  if (p < totalP - 1) nav.push(Markup.button.callback('▶', `bonus:awp:${season}:${p + 1}`));
  if (nav.length) kb.push(nav);
  kb.push([
    Markup.button.callback('💾 Salva', `bonus:awy:${season}`),
    Markup.button.callback('« Criteri', `bonus:awr:${season}`),
  ]);
  kb.push([Markup.button.callback('« Modalità stagione', `bonus:azp:${season}`), Markup.button.callback('« Bonus', 'bonus:0')]);
  try {
    await ctx.editMessageText(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kb) });
  } catch (_) {
    await ctx.reply(body, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kb) });
  }
}

async function buildBonusKeyboard(ctx) {
  const rows = [];
  rows.push([Markup.button.callback('📅 Storico per stagione', 'bonus:hist')]);
  if (ctx.cocboardUser && isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
    rows.push([Markup.button.callback('✏️ Assegna / Modifica bonus', 'bonus:as')]);
  }
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

async function renderBonusSeasonPicker(ctx, clanTag) {
  const seasons = await sb.listCwlSeasonsForClan(clanTag).catch(() => []);
  const backKb = Markup.inlineKeyboard([
    [Markup.button.callback('« Bonus', 'bonus:0'), Markup.button.callback('« Menù', 'menu')],
  ]);
  if (!seasons.length) {
    const txt = `${fmt.DIV}\n📅 <b>Storico bonus per stagione</b>\n${fmt.DIV}\n\n<i>Nessun dato storico per questo clan.</i>`;
    try { await ctx.editMessageText(txt, { parse_mode: 'HTML', ...backKb }); }
    catch (_) { await ctx.reply(txt, { parse_mode: 'HTML', ...backKb }); }
    return;
  }
  const rows = seasons.map((s) => [Markup.button.callback(`📅 ${bonusAssignSeasonLabelIt(s)}`, `bonus:sv:${s}`)]);
  rows.push([Markup.button.callback('« Bonus', 'bonus:0'), Markup.button.callback('« Menù', 'menu')]);
  const txt = `${fmt.DIV}\n📅 <b>Storico bonus per stagione</b>\n${fmt.DIV}\n\nScegli la stagione da visualizzare:`;
  try { await ctx.editMessageText(txt, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }); }
  catch (_) { await ctx.reply(txt, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }); }
}

async function registerBotCommands(telegram) {
  try {
    const priv = [
      { command: 'start', description: 'Menù principale' },
      { command: 'cocboard', description: 'Menù CoCBoard' },
      { command: 'help', description: 'Aiuto' },
      { command: 'assistenza', description: 'Apri ticket supporto' },
      { command: 'adminbot', description: 'Pannello staff bot (admin / moderatori)' },
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
      { command: 'assistenza', description: 'Supporto in privato' },
      { command: 'coc_off', description: 'Spegni bot in questa chat (admin)' },
      { command: 'coc_on', description: 'Riattiva bot in questa chat (admin)' },
      { command: 'coc_status', description: 'Stato bot in questa chat' },
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

  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id ?? null;
    const chatId = ctx.chat?.id ?? null;
    const chatType = ctx.chat?.type || null;
    let eventType = 'update';
    if (ctx.callbackQuery) eventType = 'callback';
    else if (ctx.message?.text?.startsWith('/')) eventType = 'command';
    else if (ctx.message) eventType = 'message';
    sb.insertUsageEvent({ telegram_user_id: uid, telegram_chat_id: chatId, chat_type: chatType, event_type: eventType }).catch(() => {});
    return next();
  });

  /** Gruppi/canali: interruttore ON/OFF chat. Se OFF accetta solo /coc_on. */
  bot.use(async (ctx, next) => {
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return next();
    const cmd = normalizeBotCommandName(ctx.message?.text || '');
    if (cmd === '/coc_on') return next();
    let enabled = true;
    try {
      const st = await sb.getTelegramChatControl(ctx.chat.id);
      enabled = st?.bot_enabled !== false;
    } catch (_) {
      enabled = true;
    }
    if (enabled) return next();
    if (ctx.message?.text && cmd) {
      await ctx
        .reply(
          '🤫 Bot in pausa in questa chat. Solo un admin può riattivarlo con <code>/coc_on</code>.',
          { parse_mode: 'HTML' }
        )
        .catch(() => {});
    } else if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Bot in pausa: usa /coc_on').catch(() => {});
    }
    return;
  });

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
    if (d.startsWith('comm_')) {
      // Entrando nei flussi Community azzera eventuale stato supporto pendente.
      resetSupportContextForUser(uid);
    }
    if (
      d === 'noop' ||
      d === 'comm_global_leave' ||
      d === 'comm_global_status' ||
      d === 'comm_global_report' ||
      d === 'comm_global_mode' ||
      d === 'comm_global_quick'
    ) {
      return next();
    }
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
      resetSupportContextForUser(ctx.from.id);
      // Obbligatorio qui: questo ramo faceva next() prima del blocco leaveGlobalIfActive sotto.
      if (ctx.chat?.type === 'private') {
        await leaveGlobalIfActive(ctx, { notify: true });
      }
      return next();
    }
    if (ctx.chat?.type === 'private' && txt.startsWith('/')) {
      const cmd = txt.split(/\s+/)[0].toLowerCase().split('@')[0];
      if (cmd !== '/assistenza') {
        resetSupportContextForUser(ctx.from.id);
      }
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
    const adminTicketId = adminActiveSupportTicket.get(ctx.from.id);
    const pendingRid = pendingManualReportTarget.get(ctx.from.id);
    if (pendingRid && ctx.message?.text && !txt.startsWith('/')) {
      if (!(await isSupportAdmin(ctx))) {
        pendingManualReportTarget.delete(ctx.from.id);
        await ctx.reply('🔒 Solo gli amministratori possono impostare un target manuale.');
        return;
      }
      const targetId = Number(String(ctx.message.text || '').trim());
      if (!Number.isFinite(targetId)) {
        await ctx.reply('Formato non valido. Invia solo Telegram User ID numerico.');
        return;
      }
      await sb
        .setGlobalChatReportStatus(
          pendingRid,
          'in_review',
          ctx.from?.id,
          `Target manuale impostato: ${targetId}`,
          'manual_target'
        )
        .catch(() => {});
      await sb
        .setGlobalReportTargetTelegramUser(pendingRid, targetId, ctx.from?.id)
        .catch(async () => {
          await ctx.reply('❌ Errore salvataggio target manuale.');
        });
      pendingManualReportTarget.delete(ctx.from.id);
      await ctx.reply(`✅ Target manuale impostato per segnalazione #${pendingRid}: <code>${targetId}</code>.`, {
        parse_mode: 'HTML',
      });
      return;
    }
    if (adminTicketId && ctx.message) {
      if (txt === '/cancel') {
        adminActiveSupportTicket.delete(ctx.from.id);
        await refreshPrivateReplyKeyboard(ctx);
        await ctx.reply('Uscito dalla modalità ticket.');
        return;
      }
      const messageText = (ctx.message.text || ctx.message.caption || '').trim();
      const photo = Array.isArray(ctx.message.photo) && ctx.message.photo.length ? ctx.message.photo[ctx.message.photo.length - 1] : null;
      if (!messageText && !photo) {
        await ctx.reply('Invia testo (opzionalmente con immagine).');
        return;
      }
      const tk = await sb.getTicketById(adminTicketId).catch(() => null);
      if (!tk) {
        adminActiveSupportTicket.delete(ctx.from.id);
        await refreshPrivateReplyKeyboard(ctx);
        await ctx.reply('Ticket non trovato.');
        return;
      }
      const replyRole = isCoCboardAdminUser(ctx.cocboardUser) ? 'admin' : 'moderator';
      await sb
        .appendSupportMessage(adminTicketId, {
          from_role: replyRole,
          from_telegram_user_id: ctx.from.id,
          text: messageText || null,
          photo_file_id: photo?.file_id || null,
          session_index: Number(tk.session_index || 1),
        })
        .catch(() => {});
      await sb.setTicketStatus(adminTicketId, 'in_progress', ctx.from.id).catch(() => {});
      if (tk.telegram_user_id) {
        if (photo?.file_id) {
          await ctx.telegram
            .sendPhoto(tk.telegram_user_id, photo.file_id, {
              caption: messageText ? `👮 Supporto:\n${messageText}` : '👮 Supporto ha inviato un’immagine.',
            })
            .catch(() => {});
        } else {
          await ctx.telegram.sendMessage(tk.telegram_user_id, `👮 Supporto:\n${messageText}`).catch(() => {});
        }
      }
      await sb
        .insertUsageEvent({
          telegram_user_id: ctx.from.id,
          telegram_chat_id: ctx.chat?.id,
          chat_type: ctx.chat?.type,
          event_type: 'support_admin_msg',
          payload: { ticket_id: adminTicketId },
        })
        .catch(() => {});
      return;
    }
    const handledComm = await comm.tryHandleEarlyMessage(ctx, pendingCommunity, {
      isLinkedChatContext,
      sendMainMenu,
      sendGuestMenu,
      backMenuKb,
      tauth,
      createGlobalReport: createGlobalReportFromCommunity,
    });
    if (handledComm) return;
    if (await handleSupportInboundMessage(ctx)) return;
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
      t.startsWith('/assistenza') ||
      t.startsWith('/player') ||
      t.startsWith('/cerca_clan') ||
      t.startsWith('/cerca') ||
      t.startsWith('/classifica') ||
      t.startsWith('/linkclan') ||
      t.startsWith('/unlinkclan') ||
      t.startsWith('/coc_off') ||
      t.startsWith('/coc_on') ||
      t.startsWith('/coc_status') ||
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
      /^rad:\d+$/.test(cbDataEarly) ||
      cbDataEarly === 'support_admin_home' ||
      cbDataEarly === 'support_admin_stats' ||
      cbDataEarly === 'support_admin_open' ||
      cbDataEarly === 'support_admin_mine' ||
      cbDataEarly === 'support_admin_global_reports' ||
      cbDataEarly === 'support_admin_banned_users' ||
      cbDataEarly === 'support_admin_csv' ||
      /^support_admin_(ticket|take|reply|wait|close|ban|unban|greport|greport_take|greport_archive|greport_ban|greport_target|greport_unmute|greport_remute|banned|unban_user|unmute_user):\d+$/.test(
        cbDataEarly
      ) ||
      /^support_admin_greport_muteh:\d+:(2|4|8|16|24|48)$/.test(cbDataEarly) ||
      /^support_admin_mute_userh:\d+:(2|4|8|16|24|48)$/.test(cbDataEarly) ||
      cbDataEarly === 'support_admin_global_reports_open' ||
      cbDataEarly === 'support_admin_global_reports_resolved' ||
      cbDataEarly === 'support_admin_global_reports_all' ||
      cbDataEarly === 'support_admin_closed'
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
      if (isLinkedChatContext(ctx)) {
        const explicit = await isExplicitGroupInvocation(ctx);
        if (!explicit) return;
      }
      await sendGuestMenu(ctx);
      return;
    }
    return;
  });

  async function handleCocboardCommand(ctx) {
    if (!ctx.from?.id) return;
    try {
      await ensureTgBotUsername(ctx.telegram);
      const requestedTab = parseRequestedMiniAppTabFromCommand(ctx);
      // Cancella il menù precedente se il comando arriva fresco (non da callback).
      if (!ctx.callbackQuery && ctx.chat?.id) {
        await _deleteTrackedMenuMsg(ctx.telegram, ctx.chat.id);
      }
      // Hard reset stati transient all'avvio menù, evita blocchi su primo ingresso.
      pendingAuth.delete(ctx.from.id);
      pendingSearch.delete(ctx.from.id);
      pendingLinkWizard.delete(ctx.from.id);
      pendingCommunity.delete(ctx.from.id);
      pendingSupportOpen.delete(ctx.from.id);
      adminActiveSupportTicket.delete(ctx.from.id);
      if (requestedTab && ctx.chat?.type === 'private') {
        const launched = await renderMiniAppLaunchForTab(ctx, requestedTab);
        if (launched) return;
      }
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

  async function createGlobalReportFromCommunity(payload) {
      const reporterTag = payload?.reporterDisplayTag ? String(payload.reporterDisplayTag).toUpperCase() : null;
      const raw = String(payload?.reportedMessageText || '');
      const first = raw.split('\n')[0] || '';
      let targetTag = null;
      const tagMatch = first.match(/#([0-9A-Z]{9})/);
      if (tagMatch) targetTag = `#${tagMatch[1]}`;
      const targetNameRaw = first.replace(/✅/g, '').replace(/#([0-9A-Z]{9})/g, '').trim();
      let targetId = null;
      let targetName = targetNameRaw || null;
      if (targetTag) {
        try {
          const s = await sbcCommunity.getGlobalSubscriberByDisplayTag(targetTag);
          if (s?.telegram_user_id != null) {
            targetId = Number(s.telegram_user_id);
            if (s.display_name) targetName = s.display_name;
          }
        } catch (_) {}
      }
      const row = await sb.insertGlobalChatReport({
        reporterTelegramUserId: payload.reporterTelegramUserId,
        reporterDisplayName: payload.reporterDisplayName,
        reporterDisplayTag: reporterTag,
        reason: payload.reason,
        reportedMessageText: raw,
        reportedTargetTelegramUserId: targetId,
        reportedTargetDisplayName: targetName,
      });
      const owners = cv.parseOwnerTelegramIds();
      if (owners.length) {
        const ping =
          `🚩 Nuova segnalazione chat globale <b>#${row.id}</b>\n` +
          `Motivo: ${fmt.escapeHtml(String(payload.reason || ''))}\n` +
          `Apri: <code>/adminbot</code> → Segnalazioni chat globale`;
        for (const oid of owners) {
          await bot.telegram
            .sendMessage(Number(oid), ping, { parse_mode: 'HTML', disable_notification: true })
            .catch(() => {});
        }
      }
      return row;
  }

  const earlyCommDeps = {
    isLinkedChatContext,
    sendMainMenu,
    sendGuestMenu,
    backMenuKb,
    tauth,
    createGlobalReport: createGlobalReportFromCommunity,
  };

  handlePrivateReplyKeyboardShortcuts = async (ctx, raw) => {
    const t = raw.trim();
    const activeTid = adminActiveSupportTicket.get(ctx.from.id);
    if (activeTid && [SUPPORT_RK_TAKE, SUPPORT_RK_WAIT, SUPPORT_RK_CLOSE, SUPPORT_RK_BAN, SUPPORT_RK_UNBAN].includes(t)) {
      await performAdminTicketAction(ctx, activeTid, t);
      await refreshPrivateReplyKeyboard(ctx);
      return true;
    }
    if (activeTid && t === SUPPORT_RK_EXIT) {
      adminActiveSupportTicket.delete(ctx.from.id);
      await refreshPrivateReplyKeyboard(ctx);
      await ctx.reply('Uscito dalla modalità ticket supporto.');
      return true;
    }
    if (t === PRIVATE_RK_MENU) {
      adminActiveSupportTicket.delete(ctx.from.id);
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
      adminActiveSupportTicket.delete(ctx.from.id);
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
    if (t === PRIVATE_RK_REPORT_GLOBAL) {
      const active = await sbcCommunity.isActiveInGlobalChat(ctx.from.id).catch(() => false);
      if (!active) {
        await ctx.reply('ℹ️ Non sei in <b>chat globale</b>.', { parse_mode: 'HTML' }).catch(() => {});
        await refreshPrivateReplyKeyboard(ctx);
        return true;
      }
      pendingCommunity.set(ctx.from.id, { kind: 'global_report' });
      await ctx
        .reply(
          `🚩 <b>Segnala messaggio</b>\n\n` +
            `Rispondi a un messaggio della chat globale e scrivi il motivo (es. <i>spam ripetuto</i>).`,
          { parse_mode: 'HTML' }
        )
        .catch(() => {});
      await refreshPrivateReplyKeyboard(ctx);
      return true;
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
  bot.command('start', handleCocboardCommand);
  bot.command('cocboard', handleCocboardCommand);

  bot.command('help', async (ctx) => {
    if (!ctx.from?.id) return;
    await dispatchHelpCommand(ctx);
  });

  bot.command('assistenza', async (ctx) => {
    if (isLinkedChatContext(ctx)) {
      await ensureTgBotUsername(ctx.telegram);
      const url = privateChatUrl(cachedTgBotUsername);
      if (url) {
        await ctx.reply(`📩 Assistenza disponibile in privato: <a href="${url}">apri chat bot</a>`, { parse_mode: 'HTML' });
      }
      return;
    }
    await leaveGlobalIfActive(ctx, { notify: true });
    resetSupportContextForUser(ctx.from.id);
    pendingSupportOpen.set(ctx.from.id, true);
    await showSupportEntryHub(ctx);
  });

  bot.command('adminbot', async (ctx) => {
    if (!ctx.from?.id || isLinkedChatContext(ctx)) return;
    const ok = await isSupportStaff(ctx);
    if (!ok) {
      await ctx.reply('🔒 Sezione riservata allo staff CoCBoardBot (admin o moderatori).').catch(() => {});
      return;
    }
    await sendSupportAdminPanel(ctx);
  });

  bot.command('coc_status', async (ctx) => {
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) {
      await ctx.reply('Usa <code>/coc_status</code> in gruppo/supergruppo/canale.', { parse_mode: 'HTML' }).catch(() => {});
      return;
    }
    const st = await sb.getTelegramChatControl(ctx.chat.id).catch(() => ({ bot_enabled: true }));
    const on = st?.bot_enabled !== false;
    await ctx
      .reply(on ? '✅ Bot attivo in questa chat.' : '🤫 Bot in pausa in questa chat. Usa <code>/coc_on</code>.', {
        parse_mode: 'HTML',
      })
      .catch(() => {});
  });

  bot.command('coc_off', async (ctx) => {
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) {
      await ctx.reply('Usa <code>/coc_off</code> in gruppo/supergruppo/canale.', { parse_mode: 'HTML' }).catch(() => {});
      return;
    }
    const isTgAdmin = await isTelegramChatAdmin(ctx);
    const sess = ctx.from?.id != null ? await tauth.getValidSession(ctx.from.id).catch(() => null) : null;
    const isAppAdmin = (sess?.user?.user_metadata?.role || '') === 'admin';
    if (!isTgAdmin && !isAppAdmin) {
      await ctx.reply('Solo amministratori chat o ruolo <b>admin</b> CoCBoard possono usare questo comando.', { parse_mode: 'HTML' });
      return;
    }
    await sb.setTelegramChatEnabled(ctx.chat.id, false, ctx.from?.id).catch((e) => {
      throw new Error(e.message || 'Errore salvataggio stato chat');
    });
    await ctx
      .reply('🤫 Bot <b>spento</b> in questa chat. Per riattivarlo: <code>/coc_on</code>.', { parse_mode: 'HTML' })
      .catch(() => {});
  });

  bot.command('coc_on', async (ctx) => {
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) {
      await ctx.reply('Usa <code>/coc_on</code> in gruppo/supergruppo/canale.', { parse_mode: 'HTML' }).catch(() => {});
      return;
    }
    const isTgAdmin = await isTelegramChatAdmin(ctx);
    const sess = ctx.from?.id != null ? await tauth.getValidSession(ctx.from.id).catch(() => null) : null;
    const isAppAdmin = (sess?.user?.user_metadata?.role || '') === 'admin';
    if (!isTgAdmin && !isAppAdmin) {
      await ctx.reply('Solo amministratori chat o ruolo <b>admin</b> CoCBoard possono usare questo comando.', { parse_mode: 'HTML' });
      return;
    }
    await sb.setTelegramChatEnabled(ctx.chat.id, true, ctx.from?.id).catch((e) => {
      throw new Error(e.message || 'Errore salvataggio stato chat');
    });
    await ctx.reply('✅ Bot riattivato in questa chat.', { parse_mode: 'HTML' }).catch(() => {});
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
      let hist = [];
      let aliasMap = {};
      try {
        [hist, aliasMap] = await Promise.all([
          sb.fetchCwlHistoryBonusRows(clanTag),
          sb.fetchPlayerAliasesForClan(clanTag),
        ]);
      } catch (_) {}
      const normalized = hist.map((h) => ({
        ...h,
        player_name: aliasMap[String(h.player_name || '').toLowerCase()] || h.player_name,
      }));
      const body = fmt.formatBonusReceiversLeaderboard(normalized);
      const kb = await buildBonusKeyboard(ctx);
      await ctx.reply(body, { parse_mode: 'HTML', ...kb });
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

  bot.action('support_open', async (ctx) => {
    safeAnswerCb(ctx);
    if (isLinkedChatContext(ctx)) {
      await ensureTgBotUsername(ctx.telegram);
      const url = privateChatUrl(cachedTgBotUsername);
      if (url) {
        await ctx.reply(`📩 Supporto in privato: <a href="${url}">apri chat bot</a>`, { parse_mode: 'HTML' });
      }
      return;
    }
    await leaveGlobalIfActive(ctx, { notify: true });
    resetSupportContextForUser(ctx.from.id);
    pendingSupportOpen.set(ctx.from.id, true);
    await showSupportEntryHub(ctx);
  });

  bot.action('support_user_manage', async (ctx) => {
    safeAnswerCb(ctx);
    if (isLinkedChatContext(ctx)) return;
    const uid = ctx.from?.id;
    if (uid == null) return;
    const t = await sb.getOpenTicketForUser(uid).catch(() => null);
    const c = await sb.getLatestClosedPendingTicketForUser(uid).catch(() => null);
    if (!t) {
      await showSupportEntryHub(ctx);
      return;
    }
    const text =
      `🎫 Ticket attivo: <b>#${t.id}</b>\n` +
      `Riaperture usate: <b>${Math.min(Number(t.reopen_count || 0), SUPPORT_MAX_REOPEN)}</b>/${SUPPORT_MAX_REOPEN}\n` +
      `Sessione corrente: <b>${Number(t.session_index || 1)}</b>\n` +
      `🟣 <b>Supporto attivo:</b> i prossimi messaggi verranno inviati al ticket.\n` +
      `<i>Per uscire: «Torna al menù» o /start.</i>\n\n` +
      `Scrivi qui per inviare messaggi al supporto.`;
    pendingSupportOpen.set(uid, true);
    await ctx.reply(text, { parse_mode: 'HTML', ...supportManageKb(true, Boolean(c)) }).catch(() => {});
  });

  bot.action('support_user_menu', async (ctx) => {
    safeAnswerCb(ctx);
    if (isLinkedChatContext(ctx)) return;
    resetSupportContextForUser(ctx.from?.id);
    const sess = await tauth.getValidSession(ctx.from.id).catch(() => null);
    if (sess) {
      ctx.cocboardUser = sess.user;
      await sendMainMenu(ctx);
    } else {
      await sendGuestMenu(ctx);
    }
  });

  bot.action('support_user_reopen', async (ctx) => {
    safeAnswerCb(ctx);
    if (isLinkedChatContext(ctx)) return;
    const uid = ctx.from?.id;
    if (uid == null) return;
    const r = await sb.reopenSupportTicket(uid).catch(() => ({ ok: false, reason: 'Errore riapertura ticket.' }));
    if (!r?.ok || !r.ticket) {
      await ctx.reply(`❌ ${r?.reason || 'Nessun ticket chiuso recente da riaprire.'}`);
      return;
    }
    await sb.appendSupportMessage(r.ticket.id, {
      from_role: 'system',
      text: `Ticket riaperto dall’utente (sessione ${r.ticket.session_index}).`,
      session_index: Number(r.ticket.session_index || 1),
    }).catch(() => {});
    pendingSupportOpen.set(uid, true);
    await ctx.reply(
      `♻️ Ticket #${r.ticket.id} riaperto.\n` +
        `🟣 <b>Supporto attivo:</b> i prossimi messaggi verranno inviati al ticket.\n` +
        `<i>Per uscire: «Torna al menù» o /start.</i>\n\n` +
        `Sessione ${r.ticket.session_index}: puoi inviare fino a ${SUPPORT_MAX_PHOTO_PER_SESSION} immagini.`,
      { parse_mode: 'HTML' }
    );
  });

  bot.action('support_user_new', async (ctx) => {
    safeAnswerCb(ctx);
    if (isLinkedChatContext(ctx)) return;
    const uid = ctx.from?.id;
    if (uid == null) return;
    const t = await sb.getOpenTicketForUser(uid).catch(() => null);
    if (t) {
      await ctx.reply(`Hai già un ticket aperto (#${t.id}). Scrivi qui per continuare.`);
      return;
    }
    let ticket;
    try {
      ticket = await sb.createSupportTicket(uid, 'Richiesta supporto Telegram');
    } catch (e) {
      console.error('[cocboard-bot] support_user_new createSupportTicket', e?.message || e);
      await ctx
        .reply(
          '❌ Impossibile aprire il ticket (errore database). Su Supabase esegui <code>schema-support-tickets-ensure.sql</code> (cartella telegram-bot); su Render verifica <code>SUPABASE_SERVICE_ROLE_KEY</code> = chiave <b>service_role</b>.',
          { parse_mode: 'HTML' }
        )
        .catch(() => {});
      return;
    }
    await sb
      .insertUsageEvent({
        telegram_user_id: uid,
        telegram_chat_id: uid,
        chat_type: 'private',
        event_type: 'support_ticket_create',
        payload: { ticket_id: ticket.id },
      })
      .catch(() => {});
    pendingSupportOpen.set(uid, true);
    await ctx
      .reply(formatSupportWritePromptHtml(ticket.id), { parse_mode: 'HTML', ...supportActiveSessionSimpleKb() })
      .catch(() => {});
  });

  bot.action('support_user_cancel_active', async (ctx) => {
    if (isLinkedChatContext(ctx)) return;
    const uid = ctx.from?.id;
    if (uid == null) return;
    const t = await sb.getOpenTicketForUser(uid).catch(() => null);
    resetSupportContextForUser(uid);
    if (t) {
      const sid = Number(t.session_index || 1);
      await sb.setTicketStatus(t.id, 'closed_pending_purge', null).catch(() => {});
      await sb
        .appendSupportMessage(t.id, {
          from_role: 'system',
          text: 'Ticket annullato dall’utente (chiusura anticipata).',
          session_index: sid,
        })
        .catch(() => {});
    }
    await ctx.answerCbQuery(t ? 'Ticket annullato' : undefined).catch(() => {});
    const sess = await tauth.getValidSession(uid).catch(() => null);
    if (sess) {
      ctx.cocboardUser = sess.user;
      await sendMainMenu(ctx);
    } else {
      await sendGuestMenu(ctx);
    }
  });

  bot.action('support_admin_home', async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    resetSupportContextForUser(ctx.from?.id);
    await refreshPrivateReplyKeyboard(ctx);
    await sendSupportAdminPanel(ctx);
  });

  bot.action('support_admin_stats', async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const s = (await sb.getAdminDashboardStats().catch(() => null)) || {
      linkedChats: 0,
      pausedChats: 0,
      dau: 0,
      wau: 0,
    };
    const body =
      `📊 <b>Statistiche bot</b>\n\n` +
      `• Chat collegate: <b>${s.linkedChats}</b>\n` +
      `• Chat in pausa (/coc_off): <b>${s.pausedChats}</b>\n` +
      `• Utenti attivi 24h (DAU): <b>${s.dau}</b>\n` +
      `• Utenti attivi 7gg (WAU): <b>${s.wau}</b>`;
    await ctx.reply(body, { parse_mode: 'HTML', ...(await supportAdminPanelKbAsync(ctx)) });
  });

  bot.action('support_admin_open', async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const n = await sb.listGlobalChatReports(['open', 'in_review'], 200).then((r) => (r || []).length).catch(() => 0);
    const full = await isSupportAdmin(ctx);
    const rows = await sb.listActiveSupportTickets(25).catch(() => []);
    if (!rows.length) {
      await ctx.reply('📭 Nessun ticket attivo.', { parse_mode: 'HTML', ...(await supportHomeKbAsync(ctx, n)) });
      return;
    }
    await ctx.reply('📬 <b>Ticket assistenza</b>', { parse_mode: 'HTML', ...supportTicketListKb(rows, full) });
  });

  bot.action('support_admin_closed', async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const rows = await sb
      .listActiveSupportTickets(80)
      .then((all) => (all || []).filter((t) => String(t.status) === 'closed_pending_purge').slice(0, 30))
      .catch(() => []);
    if (!rows.length) {
      await ctx.reply('📭 Nessun ticket chiuso in attesa purge.', { parse_mode: 'HTML', ...(await supportAdminPanelKbAsync(ctx)) });
      return;
    }
    await ctx.reply('🗂 <b>Ticket chiusi</b>', { parse_mode: 'HTML', ...supportTicketListKb(rows) });
  });

  bot.action('support_admin_mine', async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const n = await sb.listGlobalChatReports(['open', 'in_review'], 200).then((r) => (r || []).length).catch(() => 0);
    const full = await isSupportAdmin(ctx);
    const rows = await sb.listActiveSupportTicketsAssignedTo(ctx.from.id, 25).catch(() => []);
    if (!rows.length) {
      await ctx.reply('📭 Nessun ticket assegnato a te.', { parse_mode: 'HTML', ...(await supportHomeKbAsync(ctx, n)) });
      return;
    }
    await ctx.reply('👤 <b>Ticket assegnati a me</b>', { parse_mode: 'HTML', ...supportTicketListKb(rows, full) });
  });

  async function renderGlobalReportsAdminList(ctx, statuses, title) {
    const n = await sb.listGlobalChatReports(['open', 'in_review'], 200).then((r) => (r || []).length).catch(() => 0);
    const rows = await sb.listGlobalChatReports(statuses, 30).catch(() => []);
    if (!rows.length) {
      await ctx.reply('📭 Nessuna segnalazione chat globale da gestire.', { parse_mode: 'HTML', ...(await supportHomeKbAsync(ctx, n)) });
      return;
    }
    const baseRows = globalReportListKb(rows).reply_markup.inline_keyboard;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('🟠 Aperte/In review', 'support_admin_global_reports_open')],
      [Markup.button.callback('✅ Risolte/Archiviate', 'support_admin_global_reports_resolved')],
      [Markup.button.callback('📚 Tutte', 'support_admin_global_reports_all')],
      ...baseRows,
    ]);
    await ctx.reply(title, { parse_mode: 'HTML', ...kb });
  }

  bot.action('support_admin_global_reports', async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    await renderGlobalReportsAdminList(ctx, ['open', 'in_review'], '🚩 <b>Segnalazioni chat globale</b> (aperte/in review)');
  });

  bot.action('support_admin_global_reports_open', async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    await renderGlobalReportsAdminList(ctx, ['open', 'in_review'], '🚩 <b>Segnalazioni chat globale</b> (aperte/in review)');
  });

  bot.action('support_admin_global_reports_resolved', async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    await renderGlobalReportsAdminList(ctx, ['resolved', 'archived'], '🚩 <b>Segnalazioni chat globale</b> (risolte/archiviate)');
  });

  bot.action('support_admin_global_reports_all', async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    await renderGlobalReportsAdminList(
      ctx,
      ['open', 'in_review', 'resolved', 'archived'],
      '🚩 <b>Segnalazioni chat globale</b> (tutte)'
    );
  });

  bot.action(/^support_admin_greport:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const full = await isSupportAdmin(ctx);
    pendingManualReportTarget.delete(ctx.from?.id);
    adminActiveSupportTicket.delete(ctx.from?.id);
    await refreshPrivateReplyKeyboard(ctx);
    const rid = Number(ctx.match[1]);
    const r = await sb.getGlobalChatReportById(rid).catch(() => null);
    if (!r) {
      await ctx.reply('Segnalazione non trovata.');
      return;
    }
    const targetLine = r.reported_target_telegram_user_id
      ? `<code>${r.reported_target_telegram_user_id}</code>${r.reported_target_display_name ? ` (${fmt.escapeHtml(r.reported_target_display_name)})` : ''}`
      : '<i>non identificato automaticamente</i>';
    const restr =
      r.reported_target_telegram_user_id != null
        ? await sb.getTelegramUserRestriction(Number(r.reported_target_telegram_user_id)).catch(() => null)
        : null;
    const isMuted = Boolean(restr?.muted_until && new Date(restr.muted_until).getTime() > Date.now());
    const body =
      `🚩 <b>Segnalazione #${r.id}</b>\n` +
      `Stato: <b>${fmt.escapeHtml(r.status)}</b>\n` +
      `Segnalante: <code>${r.reporter_telegram_user_id}</code> · ${fmt.escapeHtml(r.reporter_display_name || 'Utente')}\n` +
      `Target: ${targetLine}\n` +
      `Motivo: ${fmt.escapeHtml(r.reason || '')}\n\n` +
      `<b>Messaggio segnalato</b>:\n${fmt.escapeHtml(String(r.reported_message_text || '').slice(0, 1300))}` +
      (isMuted ? `\n\n🔇 <i>Target attualmente in mute fino a ${fmt.escapeHtml(new Date(restr.muted_until).toLocaleString('it-IT', { timeZone: 'UTC' }))} UTC.</i>` : '');
    await ctx.reply(body, { parse_mode: 'HTML', ...globalReportAdminKb(r, { isMuted, fullAdmin: full }) });
  });

  bot.action(/^support_admin_greport_take:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const rid = Number(ctx.match[1]);
    await sb.setGlobalChatReportStatus(rid, 'in_review', ctx.from?.id, 'Presa in carico', 'none').catch(() => {});
    await ctx.reply(`📌 Segnalazione #${rid} presa in carico.`);
  });

  bot.action(/^support_admin_greport_archive:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const rid = Number(ctx.match[1]);
    await sb.setGlobalChatReportStatus(rid, 'archived', ctx.from?.id, 'Archiviata da admin', 'archive').catch(() => {});
    await ctx.reply(`✅ Segnalazione #${rid} archiviata.`);
  });

  bot.action(/^support_admin_greport_mute24:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const rid = Number(ctx.match[1]);
    const hours = 24;
    const r = await sb.getGlobalChatReportById(rid).catch(() => null);
    const targetId = r?.reported_target_telegram_user_id != null ? Number(r.reported_target_telegram_user_id) : null;
    if (!targetId) {
      await ctx.reply('Target non identificato: impossibile applicare mute automatico.');
      return;
    }
    const untilIso = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    await sb.setTelegramUserMutedUntil(targetId, untilIso, `Limitazione ${hours}h da segnalazione chat globale #${rid}`, ctx.from?.id).catch(() => {});
    await sb.setGlobalChatReportStatus(rid, 'resolved', ctx.from?.id, `Mute ${hours}h applicato`, `mute${hours}h`).catch(() => {});
    await ctx.telegram
      .sendMessage(
        targetId,
        `🔇 Hai ricevuto una limitazione temporanea di ${hours}h per violazione regole in chat globale.\nMotivo: ${fmt.escapeHtml(
          r?.reason || ''
        )}\nSe ritieni ci sia un errore, contatta un amministratore.`,
        { parse_mode: 'HTML' }
      )
      .catch(() => {});
    await ctx.reply(`🔇 Mute ${hours}h applicato a <code>${targetId}</code>.`, { parse_mode: 'HTML' });
  });

  bot.action(/^support_admin_greport_muteh:(\d+):(2|4|8|16|24|48)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const rid = Number(ctx.match[1]);
    const hours = Number(ctx.match[2]);
    const r = await sb.getGlobalChatReportById(rid).catch(() => null);
    const targetId = r?.reported_target_telegram_user_id != null ? Number(r.reported_target_telegram_user_id) : null;
    if (!targetId) {
      await ctx.reply('Target non identificato: impossibile applicare mute automatico.');
      return;
    }
    const untilIso = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    await sb.setTelegramUserMutedUntil(targetId, untilIso, `Limitazione ${hours}h da segnalazione chat globale #${rid}`, ctx.from?.id).catch(() => {});
    await sb.setGlobalChatReportStatus(rid, 'resolved', ctx.from?.id, `Mute ${hours}h applicato`, `mute${hours}h`).catch(() => {});
    await ctx.telegram
      .sendMessage(
        targetId,
        `🔇 Hai ricevuto una limitazione temporanea di ${hours}h per violazione regole in chat globale.\nMotivo: ${fmt.escapeHtml(
          r?.reason || ''
        )}\nSe ritieni ci sia un errore, contatta un amministratore.`,
        { parse_mode: 'HTML' }
      )
      .catch(() => {});
    await ctx.reply(`🔇 Mute ${hours}h applicato a <code>${targetId}</code>.`, { parse_mode: 'HTML' });
  });

  bot.action(/^support_admin_greport_unmute:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const rid = Number(ctx.match[1]);
    const r = await sb.getGlobalChatReportById(rid).catch(() => null);
    const targetId = r?.reported_target_telegram_user_id != null ? Number(r.reported_target_telegram_user_id) : null;
    if (!targetId) {
      await ctx.reply('Target non identificato.');
      return;
    }
    await sb.setTelegramUserMutedUntil(targetId, null, `Unmute da segnalazione chat globale #${rid}`, ctx.from?.id).catch(() => {});
    await sb.setGlobalChatReportStatus(rid, 'resolved', ctx.from?.id, 'Unmute eseguito', 'unmute').catch(() => {});
    await ctx.telegram.sendMessage(targetId, '🔈 La tua limitazione mute è stata rimossa.').catch(() => {});
    await ctx.reply(`🔈 Unmute eseguito per <code>${targetId}</code>.`, { parse_mode: 'HTML' });
  });

  bot.action(/^support_admin_greport_remute:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const rid = Number(ctx.match[1]);
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback('2h', `support_admin_greport_muteh:${rid}:2`),
        Markup.button.callback('4h', `support_admin_greport_muteh:${rid}:4`),
        Markup.button.callback('8h', `support_admin_greport_muteh:${rid}:8`),
      ],
      [
        Markup.button.callback('16h', `support_admin_greport_muteh:${rid}:16`),
        Markup.button.callback('24h', `support_admin_greport_muteh:${rid}:24`),
        Markup.button.callback('48h', `support_admin_greport_muteh:${rid}:48`),
      ],
    ]);
    await ctx.reply('⏱ Seleziona nuova durata mute:', kb);
  });

  bot.action(/^support_admin_greport_ban:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const rid = Number(ctx.match[1]);
    const r = await sb.getGlobalChatReportById(rid).catch(() => null);
    const targetId = r?.reported_target_telegram_user_id != null ? Number(r.reported_target_telegram_user_id) : null;
    if (!targetId) {
      await ctx.reply('Target non identificato: impossibile bannare automaticamente.');
      return;
    }
    await sb.setTelegramUserBanned(targetId, true, `Ban da segnalazione chat globale #${rid}`, ctx.from?.id).catch(() => {});
    await sb.setGlobalChatReportStatus(rid, 'resolved', ctx.from?.id, 'Ban applicato', 'ban').catch(() => {});
    await ctx.telegram
      .sendMessage(
        targetId,
        `🚫 Sei stato bannato dall'uso del bot per violazione regole in chat globale.\nMotivo: ${fmt.escapeHtml(
          r?.reason || ''
        )}\nContatta un amministratore per eventuale richiesta di unban.`,
        { parse_mode: 'HTML' }
      )
      .catch(() => {});
    await ctx.reply(`🚫 Utente <code>${targetId}</code> bannato.`, { parse_mode: 'HTML' });
  });

  bot.action(/^support_admin_greport_target:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const rid = Number(ctx.match[1]);
    pendingManualReportTarget.set(ctx.from.id, rid);
    await refreshPrivateReplyKeyboard(ctx);
    await ctx.reply(
      `🎯 Invia ora il <b>Telegram User ID</b> del target per segnalazione #${rid}.\n` +
        `Formato: solo numero (es. <code>123456789</code>).`,
      { parse_mode: 'HTML' }
    );
  });

  bot.action('support_admin_banned_users', async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const rows = await sb.listBannedTelegramUsers(40).catch(() => []);
    if (!rows.length) {
      await ctx.reply('📭 Nessun utente bannato.', { parse_mode: 'HTML', ...(await supportAdminPanelKbAsync(ctx)) });
      return;
    }
    await ctx.reply('🚫 <b>Utenti bannati</b>', { parse_mode: 'HTML', ...bannedUsersListKb(rows) });
  });

  bot.action(/^support_admin_banned:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const uid = Number(ctx.match[1]);
    const restr = await sb.getTelegramUserRestriction(uid).catch(() => null);
    if (!restr?.banned) {
      await ctx.reply('Utente non più bannato.');
      return;
    }
    const body =
      `🚫 <b>Utente bannato</b>\n` +
      `Utente: <code>${uid}</code>\n` +
      `Motivo: ${fmt.escapeHtml(restr.reason || 'n/d')}\n` +
      `Ultimo update: ${fmt.escapeHtml(String(restr.updated_at || 'n/d'))}`;
    await ctx.reply(body, { parse_mode: 'HTML', ...bannedUserAdminKb(uid) });
  });

  bot.action(/^support_admin_unban_user:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const uid = Number(ctx.match[1]);
    await sb.setTelegramUserBanned(uid, false, 'Unban da sezione utenti bannati', ctx.from?.id).catch(() => {});
    await sb.setTelegramUserMutedUntil(uid, null, 'Limitazioni rimosse', ctx.from?.id).catch(() => {});
    await ctx.telegram
      .sendMessage(uid, '✅ Il tuo ban è stato rimosso. Ora puoi tornare a usare il bot.', { parse_mode: 'HTML' })
      .catch(() => {});
    await ctx.reply(`✅ Ban rimosso per utente <code>${uid}</code>.`, { parse_mode: 'HTML' });
  });

  bot.action(/^support_admin_mute_user24:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const uid = Number(ctx.match[1]);
    const hours = 24;
    const untilIso = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    await sb.setTelegramUserMutedUntil(uid, untilIso, `Limitazione ${hours}h da sezione utenti bannati`, ctx.from?.id).catch(() => {});
    await ctx.telegram
      .sendMessage(
        uid,
        `🔇 Hai ricevuto una limitazione temporanea di ${hours}h sull’utilizzo del bot. Contatta un amministratore per chiarimenti.`,
        { parse_mode: 'HTML' }
      )
      .catch(() => {});
    await ctx.reply(`🔇 Mute ${hours}h applicato a <code>${uid}</code>.`, { parse_mode: 'HTML' });
  });

  bot.action(/^support_admin_mute_userh:(\d+):(2|4|8|16|24|48)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const uid = Number(ctx.match[1]);
    const hours = Number(ctx.match[2]);
    const untilIso = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    await sb.setTelegramUserMutedUntil(uid, untilIso, `Limitazione ${hours}h da sezione utenti bannati`, ctx.from?.id).catch(() => {});
    await ctx.telegram
      .sendMessage(
        uid,
        `🔇 Hai ricevuto una limitazione temporanea di ${hours}h sull’utilizzo del bot. Contatta un amministratore per chiarimenti.`,
        { parse_mode: 'HTML' }
      )
      .catch(() => {});
    await ctx.reply(`🔇 Mute ${hours}h applicato a <code>${uid}</code>.`, { parse_mode: 'HTML' });
  });

  bot.action(/^support_admin_unmute_user:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const uid = Number(ctx.match[1]);
    await sb.setTelegramUserMutedUntil(uid, null, 'Unmute da sezione utenti bannati', ctx.from?.id).catch(() => {});
    await ctx.telegram.sendMessage(uid, '🔈 La tua limitazione mute è stata rimossa.').catch(() => {});
    await ctx.reply(`🔈 Unmute eseguito per <code>${uid}</code>.`, { parse_mode: 'HTML' });
  });

  bot.action(/^support_admin_ticket:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const full = await isSupportAdmin(ctx);
    pendingManualReportTarget.delete(ctx.from?.id);
    const tid = Number(ctx.match[1]);
    const t = await sb.getTicketById(tid).catch(() => null);
    if (!t) {
      await ctx.reply('Ticket non trovato.');
      return;
    }
    const msgs = await sb.listSupportMessages(tid, 200).catch(() => []);
    const photoCount = msgs.filter((m) => !!m.photo_file_id).length;
    const body =
      `🎫 <b>Ticket #${t.id}</b>\n` +
      `Utente: <code>${t.telegram_user_id}</code>\n` +
      `Stato: <b>${fmt.escapeHtml(t.status)}</b>\n` +
      `Messaggi: <b>${msgs.length}</b> · Immagini: <b>${photoCount}</b>\n\n` +
      `<i>Cronologia completa (fino a 200 messaggi) qui sotto.</i>`;
    adminActiveSupportTicket.set(ctx.from.id, t.id);
    await refreshPrivateReplyKeyboard(ctx);
    await ctx.reply(body, { parse_mode: 'HTML' });
    for (const m of msgs) {
      const who =
        m.from_role === 'admin'
          ? '👮 Admin'
          : m.from_role === 'moderator'
            ? '🛡 Moderatore'
            : m.from_role === 'system'
              ? 'ℹ️ Sistema'
              : '🙋 Utente';
      const txt = String(m.text || '').trim();
      if (m.photo_file_id) {
        const caption = `${who} · ticket #${t.id}` + (txt ? `\n${txt.slice(0, 700)}` : '');
        await ctx.telegram.sendPhoto(ctx.chat.id, m.photo_file_id, { caption }).catch(() => {});
      } else if (txt) {
        await ctx.telegram.sendMessage(ctx.chat.id, `${who} · ticket #${t.id}\n${txt}`).catch(() => {});
      }
    }
    await ctx.reply('Azioni ticket:', {
      ...supportTicketAdminKb(t.id, full),
      parse_mode: 'HTML',
    });
  });

  bot.action(/^support_admin_take:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const tid = Number(ctx.match[1]);
    adminActiveSupportTicket.set(ctx.from.id, tid);
    await refreshPrivateReplyKeyboard(ctx);
    await sb.setTicketStatus(tid, 'in_progress', ctx.from?.id).catch(() => {});
    await sb.appendSupportMessage(tid, { from_role: 'system', text: 'Ticket preso in carico dallo staff.' }).catch(() => {});
    const t = await sb.getTicketById(tid).catch(() => null);
    if (t?.telegram_user_id) {
      const staffLabel = (await isSupportAdmin(ctx)) ? 'un amministratore' : 'uno staff moderatore';
      await ctx.telegram
        .sendMessage(t.telegram_user_id, `✅ Il tuo ticket è stato preso in carico da ${staffLabel}.`, { parse_mode: 'HTML' })
        .catch(() => {});
    }
    await ctx.reply(`Ticket #${tid} preso in carico.`);
  });

  bot.action(/^support_admin_reply:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const tid = Number(ctx.match[1]);
    adminActiveSupportTicket.set(ctx.from.id, tid);
    await refreshPrivateReplyKeyboard(ctx);
    await ctx.reply(`💬 Ticket #${tid} attivo. Scrivi normalmente in chat per rispondere all’utente.`);
  });

  bot.action(/^support_admin_wait:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const tid = Number(ctx.match[1]);
    adminActiveSupportTicket.set(ctx.from.id, tid);
    await refreshPrivateReplyKeyboard(ctx);
    await sb.setTicketStatus(tid, 'waiting_user', ctx.from?.id).catch(() => {});
    const t = await sb.getTicketById(tid).catch(() => null);
    if (t?.telegram_user_id) {
      await ctx.telegram.sendMessage(t.telegram_user_id, '⏸ Ticket in attesa di un tuo riscontro.', { parse_mode: 'HTML' }).catch(() => {});
    }
    await ctx.reply(`Ticket #${tid} impostato in attesa utente.`);
  });

  bot.action(/^support_admin_close:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportStaff(ctx))) return;
    const tid = Number(ctx.match[1]);
    adminActiveSupportTicket.set(ctx.from.id, tid);
    await refreshPrivateReplyKeyboard(ctx);
    await sb.setTicketStatus(tid, 'closed_pending_purge', ctx.from?.id).catch(() => {});
    await sb.appendSupportMessage(tid, { from_role: 'system', text: 'Ticket chiuso: purge definitivo tra 7 giorni.' }).catch(() => {});
    const t = await sb.getTicketById(tid).catch(() => null);
    if (t?.telegram_user_id) {
      await ctx.telegram
        .sendMessage(
          t.telegram_user_id,
          '🔒 Ticket chiuso. Entro 7 giorni verrà eliminato definitivamente.\n' +
            'Se vuoi, puoi riaprirlo entro 7 giorni; dopo dovrai aprire un nuovo ticket.',
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🏠 Torna al menù', 'support_user_menu')],
              [Markup.button.callback('♻️ Riapri ticket', 'support_user_reopen')],
              [Markup.button.callback('🆕 Nuovo ticket', 'support_user_new')],
            ]),
          }
        )
        .catch(() => {});
    }
    await ctx.reply(`Ticket #${tid} chiuso (purge tra 7 giorni).`);
  });

  bot.action(/^support_admin_ban:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const tid = Number(ctx.match[1]);
    adminActiveSupportTicket.set(ctx.from.id, tid);
    await refreshPrivateReplyKeyboard(ctx);
    const t = await sb.getTicketById(tid).catch(() => null);
    if (!t?.telegram_user_id) {
      await ctx.reply('Utente ticket non trovato.');
      return;
    }
    await sb.setTelegramUserBanned(t.telegram_user_id, true, `Permaban da ticket #${tid}`, ctx.from?.id).catch(() => {});
    await ctx.reply(`🚫 Utente <code>${t.telegram_user_id}</code> bannato.`, { parse_mode: 'HTML' });
  });

  bot.action(/^support_admin_unban:(\d+)$/, async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const tid = Number(ctx.match[1]);
    adminActiveSupportTicket.set(ctx.from.id, tid);
    await refreshPrivateReplyKeyboard(ctx);
    const t = await sb.getTicketById(tid).catch(() => null);
    if (!t?.telegram_user_id) {
      await ctx.reply('Utente ticket non trovato.');
      return;
    }
    await sb.setTelegramUserBanned(t.telegram_user_id, false, `Unban da ticket #${tid}`, ctx.from?.id).catch(() => {});
    await ctx.reply(`✅ Ban rimosso per utente <code>${t.telegram_user_id}</code>.`, { parse_mode: 'HTML' });
  });

  bot.action('support_admin_csv', async (ctx) => {
    safeAnswerCb(ctx);
    if (!(await isSupportAdmin(ctx))) return;
    const rows = await sb.getUsageDailyStats(21).catch(() => []);
    const header = 'day,events,unique_users,unique_chats,commands,callbacks,messages';
    const body = rows
      .map((r) => [r.day, r.events, r.unique_users, r.unique_chats, r.commands, r.callbacks, r.messages].join(','))
      .join('\n');
    const csv = `${header}\n${body}\n`;
    await ctx.telegram
      .sendDocument(
        ctx.chat.id,
        { source: Buffer.from(csv, 'utf8'), filename: `cocboard-metrics-${new Date().toISOString().slice(0, 10)}.csv` },
        { caption: '📄 Export metriche giornaliere (ultimi 21 giorni).' }
      )
      .catch(async () => {
        await ctx.reply('❌ Export CSV non riuscito.');
      });
  });

  bot.action('auth_logout', async (ctx) => {
    await performFullLogout(ctx, { viaCommand: false });
  });

  bot.action('noop', async (ctx) => {
    safeAnswerCb(ctx);
  });

  bot.action('menu', async (ctx) => {
    safeAnswerCb(ctx);
    if (ctx.from?.id != null) {
      pendingCommunity.delete(ctx.from.id);
      resetSupportContextForUser(ctx.from.id);
    }
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

  bot.action('clan_home', async (ctx) => {
    safeAnswerCb(ctx);
    await renderClanHubMenu(ctx);
  });

  bot.action('clan_webapps', async (ctx) => {
    safeAnswerCb(ctx);
    await renderClanWebAppsMenu(ctx);
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

  bot.action('notif_menu', async (ctx) => {
    safeAnswerCb(ctx);
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return;
    const kb = await notificationMenuKb(ctx.chat.id);
    const body =
      `🔔 <b>Notifiche chat</b>\n\n` +
      `Configura avvisi automatici per questa chat.\n` +
      `<i>Predefinito: tutto OFF.</i>\n` +
      `<i>Solo admin chat o admin CoCBoard possono modificare.</i>`;
    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(body, { parse_mode: 'HTML', ...kb });
    }
  });

  async function toggleChatNotif(ctx, key) {
    if (!isLinkedChatContext(ctx) || !ctx.chat?.id) return;
    const tgAdmin = await isTelegramChatAdmin(ctx);
    const sess = ctx.from?.id != null ? await tauth.getValidSession(ctx.from.id).catch(() => null) : null;
    const appAdmin = isCoCboardAdminUser(sess?.user);
    if (!tgAdmin && !appAdmin) {
      await ctx.answerCbQuery('Solo amministratori chat o admin CoCBoard.').catch(() => {});
      return;
    }
    const cur = await sb.getChatNotificationSettings(ctx.chat.id).catch(() => ({}));
    const next = !(cur?.[key] === true);
    await sb.upsertChatNotificationSettings(ctx.chat.id, { [key]: next }, ctx.from?.id).catch(() => {});
    await ctx.answerCbQuery(next ? 'Attivata' : 'Disattivata').catch(() => {});
    const kb = await notificationMenuKb(ctx.chat.id);
    await ctx.editMessageReplyMarkup(kb.reply_markup).catch(() => {});
  }

  bot.action('notif_war', async (ctx) => toggleChatNotif(ctx, 'war_alerts_enabled'));
  bot.action('notif_cwl', async (ctx) => toggleChatNotif(ctx, 'cwl_alerts_enabled'));
  bot.action('notif_raids', async (ctx) => toggleChatNotif(ctx, 'capital_raids_enabled'));
  bot.action('notif_games', async (ctx) => toggleChatNotif(ctx, 'clan_games_enabled'));

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
    const addUrl = cachedTgBotUsername
      ? `https://t.me/${cachedTgBotUsername}?startgroup=linkclan_${encodeURIComponent(token)}`
      : null;
    const kb = addUrl
      ? Markup.inlineKeyboard([
          [Markup.button.url('➕ Seleziona canale/gruppo (picker Telegram)', addUrl)],
          [Markup.button.callback('« Menù', 'menu')],
        ])
      : backMenuKb();
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
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
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...clanBackKb() });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...clanBackKb() });
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
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    let hist = [];
    let aliasMap = {};
    try {
      [hist, aliasMap] = await Promise.all([
        sb.fetchCwlHistoryBonusRows(clanTag),
        sb.fetchPlayerAliasesForClan(clanTag),
      ]);
    } catch (_) {}
    const normalized = hist.map((h) => ({
      ...h,
      player_name: aliasMap[String(h.player_name || '').toLowerCase()] || h.player_name,
    }));
    const body = fmt.formatBonusReceiversLeaderboard(normalized);
    const kb = await buildBonusKeyboard(ctx);
    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb });
    } catch (_) {
      await ctx.reply(body, { parse_mode: 'HTML', ...kb });
    }
  });

  bot.action('bonus:hist', async (ctx) => {
    await answerCbLoading(ctx);
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    await renderBonusSeasonPicker(ctx, clanTag);
  });

  bot.action(/^bonus:sv:(\d{4}-\d{2})$/, async (ctx) => {
    await answerCbLoading(ctx);
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    const season = ctx.match[1];
    let rows = [];
    try {
      rows = await sb.fetchCwlHistoryFullSeason(clanTag, season);
    } catch (e) {
      await ctx.answerCbQuery(String(e.message || 'Errore').slice(0, 200)).catch(() => {});
      return;
    }
    const received = rows.filter((r) => r.bonus_assigned).sort((a, b) => (b.bonus_score ?? 0) - (a.bonus_score ?? 0));
    const label = fmt.escapeHtml(bonusAssignSeasonLabelIt(season));
    let body = `${fmt.DIV}\n🏆 <b>Bonus assegnati</b> · <i>${label}</i>\n${fmt.DIV}\n\n`;
    if (!received.length) {
      body += `<i>Nessun bonus assegnato per questa stagione.</i>`;
    } else {
      body += received.map((r, i) => {
        const sc = r.bonus_score != null ? r.bonus_score : '—';
        return `${i + 1}. <b>${fmt.escapeHtml(r.player_name)}</b> — merito <b>${sc}</b>`;
      }).join('\n');
    }
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('« Stagioni', 'bonus:hist'), Markup.button.callback('« Bonus', 'bonus:0')],
    ]);
    try { await ctx.editMessageText(body, { parse_mode: 'HTML', ...kb }); }
    catch (_) { await ctx.reply(body, { parse_mode: 'HTML', ...kb }); }
  });

  bot.action('bonus:hof', async (ctx) => {
    await answerCbLoading(ctx);
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    let hist = [];
    let aliasMap = {};
    try {
      [hist, aliasMap] = await Promise.all([
        sb.fetchCwlHistoryBonusRows(clanTag),
        sb.fetchPlayerAliasesForClan(clanTag),
      ]);
    } catch (e) {
      await ctx.answerCbQuery(String(e.message || 'Errore dati').slice(0, 200)).catch(() => {});
      return;
    }
    const normalized = hist.map((h) => ({
      ...h,
      player_name: aliasMap[String(h.player_name || '').toLowerCase()] || h.player_name,
    }));
    const body = fmt.formatBonusReceiversLeaderboard(normalized);
    await editOrReplyChunkedHtml(ctx, body, bonusHistHofBackKb());
  });

  bot.action('bonus:as', async (ctx) => {
    await answerCbLoading(ctx);
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo possono assegnare i bonus.').catch(() => {});
      return;
    }
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan collegato.').catch(() => {});
      return;
    }
    await renderBonusAssignSeasonPick(ctx, clanTag);
  });

  bot.action(/^bonus:azp:(\d{4}-\d{2})$/, async (ctx) => {
    await answerCbLoading(ctx);
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo.').catch(() => {});
      return;
    }
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    await renderBonusAssignModePick(ctx, clanTag, ctx.match[1]);
  });

  /** Messaggi vecchi con callback stagione diretto → stessa schermata modalità. */
  bot.action(/^bonus:asz:(\d{4}-\d{2})$/, async (ctx) => {
    await answerCbLoading(ctx);
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo.').catch(() => {});
      return;
    }
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    await renderBonusAssignModePick(ctx, clanTag, ctx.match[1]);
  });

  bot.action(/^bonus:azm:(\d{4}-\d{2})$/, async (ctx) => {
    await answerCbLoading(ctx);
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo.').catch(() => {});
      return;
    }
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    await renderBonusAssignPage(ctx, clanTag, ctx.match[1], 0);
  });

  bot.action(/^bonus:aw:(\d{4}-\d{2})$/, async (ctx) => {
    await answerCbLoading(ctx);
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo.').catch(() => {});
      return;
    }
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    await renderBonusWizardSlots(ctx, clanTag, ctx.match[1]);
  });

  bot.action(/^bonus:awn:(\d{4}-\d{2}):(\d+)$/, async (ctx) => {
    await answerCbLoading(ctx);
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo.').catch(() => {});
      return;
    }
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) return;
    const season = ctx.match[1];
    const slots = Math.min(9, Math.max(2, Number(ctx.match[2]) || 6));
    await renderBonusWizardPresets(ctx, clanTag, season, slots);
  });

  bot.action(/^bonus:awm:(\d{4}-\d{2}):(\d+):(\d+)$/, async (ctx) => {
    await answerCbLoading(ctx);
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo.').catch(() => {});
      return;
    }
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) return;
    const season = ctx.match[1];
    const slots = Math.min(9, Math.max(2, Number(ctx.match[2]) || 6));
    const mask = Math.min(31, Math.max(0, Number(ctx.match[3]) || 0));
    await runBonusWizardComputeAndShow(ctx, clanTag, season, slots, mask);
  });

  bot.action(/^bonus:awp:(\d{4}-\d{2}):(\d+)$/, async (ctx) => {
    await answerCbLoading(ctx);
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo.').catch(() => {});
      return;
    }
    const season = ctx.match[1];
    const st = bonusWizardByUid.get(ctx.from.id);
    if (!st || st.season !== season) {
      await ctx.answerCbQuery('Sessione scaduta').catch(() => {});
      return;
    }
    const page = Number(ctx.match[2]) || 0;
    await renderBonusWizardCandidatePage(ctx, page);
  });

  bot.action(/^bonus:awt:(\d{4}-\d{2}):(\d+)$/, async (ctx) => {
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo.').catch(() => {});
      return;
    }
    const season = ctx.match[1];
    const idx = Number(ctx.match[2]) || 0;
    const st = bonusWizardByUid.get(ctx.from.id);
    if (!st || st.season !== season || !st.candidates[idx]) {
      await ctx.answerCbQuery('Non disponibile').catch(() => {});
      return;
    }
    const name = st.candidates[idx].player_name;
    if (st.selected.has(name)) {
      st.selected.delete(name);
      await ctx.answerCbQuery('Rimosso').catch(() => {});
    } else {
      if (st.selected.size >= st.maxSlots) {
        await ctx.answerCbQuery(`Massimo ${st.maxSlots} bonus`).catch(() => {});
        await renderBonusWizardCandidatePage(ctx, st.wizardPage || 0);
        return;
      }
      st.selected.add(name);
      await ctx.answerCbQuery('Aggiunto').catch(() => {});
    }
    bonusWizardByUid.set(ctx.from.id, st);
    await renderBonusWizardCandidatePage(ctx, st.wizardPage || 0);
  });

  bot.action(/^bonus:awr:(\d{4}-\d{2})$/, async (ctx) => {
    await answerCbLoading(ctx);
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo.').catch(() => {});
      return;
    }
    const season = ctx.match[1];
    const st = bonusWizardByUid.get(ctx.from.id);
    if (!st || st.season !== season) {
      await ctx.answerCbQuery('Riprendi da Assistito').catch(() => {});
      return;
    }
    await renderBonusWizardPresets(ctx, st.clanTag, season, st.maxSlots);
  });

  bot.action(/^bonus:awy:(\d{4}-\d{2})$/, async (ctx) => {
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo.').catch(() => {});
      return;
    }
    const season = ctx.match[1];
    const st = bonusWizardByUid.get(ctx.from.id);
    if (!st || st.season !== season) {
      await ctx.answerCbQuery('Sessione scaduta').catch(() => {});
      return;
    }
    if (st.selected.size === 0) {
      await ctx.answerCbQuery('Seleziona almeno un giocatore').catch(() => {});
      return;
    }
    if (st.selected.size > st.maxSlots) {
      await ctx.answerCbQuery(`Troppi selezionati (max ${st.maxSlots})`).catch(() => {});
      return;
    }
    try {
      const n = await sb.applyBonusSelectionForSeason(st.clanTag, season, [...st.selected]);
      bonusWizardByUid.delete(ctx.from.id);
      await ctx.answerCbQuery(`Salvati ${n} record`).catch(() => {});
      const tagDisp = st.clanTag.startsWith('#') ? st.clanTag : `#${st.clanTag}`;
      const done =
        `✅ <b>Bonus salvati</b> · ${fmt.escapeHtml(bonusAssignSeasonLabelIt(season))}\n` +
        `<code>${fmt.escapeHtml(tagDisp)}</code>\n\n` +
        `Assegnati: <b>${st.selected.size}</b> — ${fmt.escapeHtml([...st.selected].join(', '))}`;
      try {
        await ctx.editMessageText(done, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('« Bonus', 'bonus:0')],
            [Markup.button.callback('« Menù', 'menu')],
          ]),
        });
      } catch (_) {
        await ctx.reply(done, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('« Menù', 'menu')]]),
        });
      }
    } catch (e) {
      await ctx.answerCbQuery(String(e.message || 'Errore').slice(0, 180)).catch(() => {});
    }
  });

  bot.action(/^bonus:asp:(\d{4}-\d{2}):(\d+)$/, async (ctx) => {
    await answerCbLoading(ctx);
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo.').catch(() => {});
      return;
    }
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) return;
    const season = ctx.match[1];
    const page = Number(ctx.match[2]) || 0;
    await renderBonusAssignPage(ctx, clanTag, season, page);
  });

  bot.action(/^bonus:ast:(\d{4}-\d{2}):(\d+):(\d+)$/, async (ctx) => {
    if (!ctx.cocboardUser || !isCapoOrCoCapoForBonus(ctx.cocboardUser)) {
      await ctx.answerCbQuery('Solo Capo e Co-Capo.').catch(() => {});
      return;
    }
    const clanTag = await resolveEffectiveClanTag(ctx);
    if (!clanTag) {
      await ctx.answerCbQuery('Nessun clan').catch(() => {});
      return;
    }
    const season = ctx.match[1];
    const page = Number(ctx.match[2]) || 0;
    const idx = Number(ctx.match[3]) || 0;
    const all = await sb.fetchCwlHistoryFullSeason(clanTag, season).catch(() => []);
    const totalPages = Math.max(1, Math.ceil(all.length / BONUS_ASSIGN_PAGE_SIZE));
    const p = Math.min(Math.max(0, page), totalPages - 1);
    const slice = all.slice(p * BONUS_ASSIGN_PAGE_SIZE, (p + 1) * BONUS_ASSIGN_PAGE_SIZE);
    const row = slice[idx];
    if (!row) {
      await ctx.answerCbQuery('Riga non valida').catch(() => {});
      return;
    }
    const next = { ...row, bonus_assigned: !row.bonus_assigned };
    try {
      await sb.upsertCwlHistoryAssignRow(next);
    } catch (e) {
      await ctx.answerCbQuery(String(e.message || 'Errore salvataggio').slice(0, 200)).catch(() => {});
      return;
    }
    await ctx.answerCbQuery(next.bonus_assigned ? 'Bonus assegnato' : 'Bonus rimosso').catch(() => {});
    await renderBonusAssignPage(ctx, clanTag, season, p);
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
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('« Registro guerre', 'war_menu')],
      [Markup.button.callback('« Indietro', 'clan_home'), Markup.button.callback('« Menù', 'menu')],
    ]);
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
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('« Registro guerre', 'war_menu')],
      [Markup.button.callback('« Indietro', 'clan_home'), Markup.button.callback('« Menù', 'menu')],
    ]);
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
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...clanBackKb() });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...clanBackKb() });
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

function parseCocTimeToDate(raw) {
  const s = String(raw || '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.\d{3}Z$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
}

function listMissingWarAttacks(warData) {
  const side = warData?.clan || {};
  const apm = Number(warData?.attacksPerMember || 2);
  const members = Array.isArray(side.members) ? side.members : [];
  return members
    .map((m) => {
      const made = Array.isArray(m.attacks) ? m.attacks.length : 0;
      const missing = Math.max(0, apm - made);
      return { name: m.name || m.tag || 'Sconosciuto', made, missing };
    })
    .filter((m) => m.missing > 0)
    .sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name, 'it'));
}

function warOutcomeLabel(warData) {
  const c = warData?.clan || {};
  const o = warData?.opponent || {};
  const cs = Number(c.stars || 0);
  const os = Number(o.stars || 0);
  const cd = Number(c.destructionPercentage || 0);
  const od = Number(o.destructionPercentage || 0);
  if (cs > os) return '✅ Vinta';
  if (cs < os) return '❌ Persa';
  if (cd > od) return '✅ Vinta (tie-break distruzione)';
  if (cd < od) return '❌ Persa (tie-break distruzione)';
  return '⚖️ Pareggio';
}

function minuteCountdownLabel(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatWarAlertBody(warData, missing, minsLeft) {
  const c = warData?.clan || {};
  const o = warData?.opponent || {};
  const isCwl = String(warData?.warType || '').toLowerCase() === 'cwl';
  const modeLabel = isCwl ? 'CWL in corso' : 'Guerra in corso';
  const lineScore = `${c.stars || 0}★ vs ${o.stars || 0}★`;
  const lineDest = `${Number(c.destructionPercentage || 0).toFixed(2)}% vs ${Number(o.destructionPercentage || 0).toFixed(2)}%`;
  if (!missing.length) {
    return (
      `🚨 <b>Attenzione ${fmt.escapeHtml(c.name || 'Clan')}!</b>\n` +
      `⚔️ <b>${modeLabel}</b> · ${lineScore} · ${lineDest}\n` +
      `⏳ Mancano <b>${fmt.escapeHtml(minsLeft)}</b> alla fine\n\n` +
      `✅ Non ci sono utenti da avvisare!\n` +
      `<b>Tutti hanno già fatto il numero richiesto di attacchi</b> 🥳`
    );
  }
  const list = missing.slice(0, 15).map((m) => `• ${fmt.escapeHtml(m.name)} (${m.missing} att.)`).join('\n');
  return (
    `🚨 <b>Attenzione ${fmt.escapeHtml(c.name || 'Clan')}!</b>\n` +
    `⚔️ <b>${modeLabel}</b> · ${lineScore} · ${lineDest}\n` +
    `⏳ Mancano <b>${fmt.escapeHtml(minsLeft)}</b> alla fine\n\n` +
    `È il momento di controllare gli attacchi mancanti:\n${list}`
  );
}

function formatWarFinalRecap(warData, missing) {
  const c = warData?.clan || {};
  const o = warData?.opponent || {};
  const isCwl = String(warData?.warType || '').toLowerCase() === 'cwl';
  const modeLabel = isCwl ? 'Recap finale CWL' : 'Recap finale guerra';
  const lineScore = `${c.stars || 0}★ vs ${o.stars || 0}★`;
  const lineDest = `${Number(c.destructionPercentage || 0).toFixed(2)}% vs ${Number(o.destructionPercentage || 0).toFixed(2)}%`;
  const out = warOutcomeLabel(warData);
  if (!missing.length) {
    return (
      `📣 <b>${modeLabel}</b>\n` +
      `${out} · ${lineScore} · ${lineDest}\n\n` +
      `✅ Tutti hanno completato gli attacchi richiesti.`
    );
  }
  const list = missing.slice(0, 20).map((m) => `• ${fmt.escapeHtml(m.name)} (${m.missing} att.)`).join('\n');
  return (
    `📣 <b>${modeLabel}</b>\n` +
    `${out} · ${lineScore} · ${lineDest}\n\n` +
    `<b>Attacchi mancanti registrati:</b>\n${list}`
  );
}

async function runWarAlertsMaintenance(bot) {
  let links = [];
  try {
    links = await sb.listEnabledTelegramChatLinks();
  } catch (e) {
    console.warn('[cocboard-bot] war alerts list links', e.message || e);
    return;
  }
  for (const link of links) {
    const chatId = Number(link.telegram_chat_id);
    const clanTag = link.clan_tag;
    if (!Number.isFinite(chatId) || !clanTag) continue;
    try {
      const notif = await sb.getChatNotificationSettings(chatId).catch(() => null);
      const warAlertsOn = notif?.war_alerts_enabled === true;
      const cwlAlertsOn = notif?.cwl_alerts_enabled === true;
      const war = await api.currentWar(clanTag);
      const state = String(war?.state || '');
      if (!state || state === 'notInWar') continue;
      const isCwl = String(war?.warType || '').toLowerCase() === 'cwl';
      if (isCwl && !cwlAlertsOn) continue;
      if (!isCwl && !warAlertsOn) continue;
      const end = parseCocTimeToDate(war?.endTime);
      if (!end) continue;
      const keyRoot = `${chatId}:${war.endTime}`;
      const now = Date.now();
      const leftMs = end.getTime() - now;
      const missing = listMissingWarAttacks(war);
      let sent = warAlertMemory.get(keyRoot);
      if (!sent) {
        sent = new Set();
        warAlertMemory.set(keyRoot, sent);
      }
      if (state === 'inWar') {
        const minsLeft = Math.ceil(leftMs / 60000);
        if (minsLeft <= 60 && minsLeft > 15 && !sent.has('t60')) {
          const body = formatWarAlertBody(war, missing, minuteCountdownLabel(Math.max(0, leftMs)));
          await bot.telegram.sendMessage(chatId, body, { parse_mode: 'HTML', disable_web_page_preview: true });
          sent.add('t60');
        }
        if (minsLeft <= 15 && minsLeft > 0 && !sent.has('t15')) {
          const body = formatWarAlertBody(war, missing, minuteCountdownLabel(Math.max(0, leftMs)));
          await bot.telegram.sendMessage(chatId, body, { parse_mode: 'HTML', disable_web_page_preview: true });
          sent.add('t15');
        }
      }
      if ((state === 'warEnded' || leftMs <= 0) && !sent.has('final')) {
        const body = formatWarFinalRecap(war, missing);
        await bot.telegram.sendMessage(chatId, body, { parse_mode: 'HTML', disable_web_page_preview: true });
        sent.add('final');
        // Salva automaticamente la war conclusa (solo war classiche; CWL ignorata dal save-war endpoint)
        api.saveWar(clanTag).catch((e) => console.warn('[cocboard-bot] auto-save war', clanTag, e.message || e));
      }
    } catch (e) {
      if (isTelegramChatStaleError(e)) {
        await sb.deleteTelegramChatLink(chatId).catch(() => {});
      } else {
        console.warn('[cocboard-bot] war alerts chat', chatId, e.message || e);
      }
    }
  }
  if (warAlertMemory.size > 600) {
    // Cleanup semplice per evitare crescita non limitata dopo molte guerre.
    const first = warAlertMemory.keys().next();
    if (!first.done) warAlertMemory.delete(first.value);
  }
}

async function runRaidAlertsMaintenance(bot) {
  let links = [];
  try {
    links = await sb.listEnabledTelegramChatLinks();
  } catch (e) {
    console.warn('[cocboard-bot] raid alerts list links', e.message || e);
    return;
  }
  for (const link of links) {
    const chatId = Number(link.telegram_chat_id);
    const clanTag = link.clan_tag;
    if (!Number.isFinite(chatId) || !clanTag) continue;
    try {
      const notif = await sb.getChatNotificationSettings(chatId).catch(() => null);
      if (notif?.capital_raids_enabled !== true) continue;
      const raidData = await api.capitalRaids(clanTag);
      const current = (raidData?.items || [])[0];
      if (!current || current.state !== 'ongoing') continue;
      const startTime = current.startTime;
      const memKey = `${chatId}:raid:${startTime}`;
      if (!raidAlertMemory.has(memKey)) {
        // Primo poll dopo restart: registra distretti già distrutti senza notificare
        const already = new Set();
        for (const entry of (current.attackLog || [])) {
          const et = entry.defender?.tag || 'unknown';
          for (const d of (entry.districts || [])) {
            if ((d.destructionPercent || 0) >= 100) already.add(`${et}:${d.id}`);
          }
        }
        raidAlertMemory.set(memKey, { initialized: true, destroyed: already });
        continue;
      }
      const mem = raidAlertMemory.get(memKey);
      for (const entry of (current.attackLog || [])) {
        const enemyTag = entry.defender?.tag || 'unknown';
        const enemyName = fmt.escapeHtml(entry.defender?.name || 'Clan sconosciuto');
        for (const d of (entry.districts || [])) {
          if ((d.destructionPercent || 0) < 100) continue;
          const dk = `${enemyTag}:${d.id}`;
          if (mem.destroyed.has(dk)) continue;
          mem.destroyed.add(dk);
          const body =
            `🏰 <b>Raid Capitale</b>\n` +
            `⚔️ Distretto <b>${fmt.escapeHtml(d.name || 'Sconosciuto')}</b> ` +
            `di <i>${enemyName}</i> completamente distrutto! ` +
            `(+${(d.totalLooted || 0).toLocaleString('it-IT')} oro)`;
          await bot.telegram.sendMessage(chatId, body, { parse_mode: 'HTML', disable_web_page_preview: true });
        }
      }
    } catch (e) {
      if (isTelegramChatStaleError(e)) {
        await sb.deleteTelegramChatLink(chatId).catch(() => {});
      } else {
        console.warn('[cocboard-bot] raid alerts chat', chatId, e.message || e);
      }
    }
  }
  if (raidAlertMemory.size > 500) {
    const first = raidAlertMemory.keys().next();
    if (!first.done) raidAlertMemory.delete(first.value);
  }
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
    await sb.purgeExpiredSupportTickets().catch(() => 0);
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
  runWarAlertsMaintenance(bot).catch(() => {});
  runRaidAlertsMaintenance(bot).catch(() => {});
  setInterval(() => {
    runCommunityMaintenance(bot).catch(() => {});
    runWarAlertsMaintenance(bot).catch(() => {});
    runRaidAlertsMaintenance(bot).catch(() => {});
  }, 60_000);

  // Self-ping ogni 12 minuti per evitare spin-down Render free tier.
  // Usa l'URL esterno del servizio (RENDER_EXTERNAL_URL) — i self-ping localhost non evitano il suspend.
  const selfUrl = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
  if (selfUrl) {
    const KEEP_ALIVE_MS = 12 * 60 * 1000;
    setInterval(() => {
      fetch(`${selfUrl}/health`, { signal: AbortSignal.timeout(10000) })
        .then(() => console.log('[bot-keep-alive] ping ok', new Date().toISOString()))
        .catch((e) => console.warn('[bot-keep-alive] ping failed:', e.message));
    }, KEEP_ALIVE_MS);
  }

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
      // Piccola pausa per dare al DNS di Render il tempo di inizializzarsi al cold start
      await new Promise(r => setTimeout(r, 8000));
      try {
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
      } catch (err) {
        // DNS non ancora pronto su questo container Render — uscita pulita per forzare un restart
        console.error('[cocboard-bot] setWebhook failed, restarting:', err.message);
        process.exit(1);
      }
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
