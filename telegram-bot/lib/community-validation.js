'use strict';

const EPOCH_SEC = 300;
const RECRUIT_TTL_MS = 24 * 60 * 60 * 1000;
const GLOBAL_MSG_MAX_LEN = 900;

function currentEpochIndex() {
  return Math.floor(Date.now() / 1000 / EPOCH_SEC);
}

function epochStartIso(epochIndex) {
  return new Date(epochIndex * EPOCH_SEC * 1000).toISOString();
}

/**
 * Link ufficiale profilo clan CoC, es.:
 * https://link.clashofclans.com/it?action=OpenClanProfile&tag=2J2VLPP9R
 */
function extractOfficialClanLink(text) {
  if (!text || typeof text !== 'string') return null;
  const re = /https:\/\/link\.clashofclans\.com\/[a-z]{2}\?[^\s<>"']+/gi;
  const m = re.exec(text);
  return m ? m[0].replace(/[)\].,;]+$/, '') : null;
}

function isOfficialClanProfileLink(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!/^https:\/\/link\.clashofclans\.com\/[a-z]{2}\?/i.test(u)) return false;
  if (!/[?&]action=OpenClanProfile\b/i.test(u)) return false;
  if (!/[?&]tag=[0-9A-Z]{3,}\b/i.test(u)) return false;
  return true;
}

function recruitmentTextValid(text) {
  const t = String(text || '').trim();
  if (t.length < 12) return { ok: false, reason: 'Testo troppo corto.' };
  if (t.length > 3500) return { ok: false, reason: 'Testo troppo lungo.' };
  const link = extractOfficialClanLink(t);
  if (!link) return { ok: false, reason: 'Includi il link ufficiale del clan (link.clashofclans.com … OpenClanProfile … tag=…).' };
  if (!isOfficialClanProfileLink(link)) return { ok: false, reason: 'Il link clan non è nel formato ufficiale CoC.' };
  return { ok: true, link };
}

function parseOwnerTelegramIds() {
  const raw = (process.env.BOT_OWNER_TELEGRAM_IDS || process.env.BOT_OWNER_TELEGRAM_ID || '').trim();
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function isBotOwnerTelegramUser(userId) {
  const ids = parseOwnerTelegramIds();
  return ids.includes(Number(userId));
}

/** Tag clan senza # per URL (es. 2J2VLPP9R). */
function normClanTagForUrl(tagRaw) {
  let t = String(tagRaw || '')
    .trim()
    .toUpperCase()
    .replace(/^#/, '');
  if (!/^[0-9A-Z]{3,15}$/.test(t)) return null;
  return t;
}

function buildOfficialClanLinkFromTag(tagRaw) {
  const t = normClanTagForUrl(tagRaw);
  if (!t) return null;
  return `https://link.clashofclans.com/en?action=OpenClanProfile&tag=${t}`;
}

function msUntilNextEpochBoundary() {
  const cur = currentEpochIndex();
  const nextSec = (cur + 1) * EPOCH_SEC;
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.max(0, (nextSec - nowSec) * 1000);
}

function formatCountdownIt(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Ospiti non possono usare caratteri che imitano la spunta verificata del bot. */
const FAKE_VERIFICATION_CHARS_RE = /✅|✔️|☑|\u2705|\u2713|\u2714/;

/** Link / reclutamento / tag villaggio nel corpo del messaggio (vietato in chat globale). */
const GLOBAL_BODY_URL_RE = /https?:\/\/|\bwww\.|t\.me\/|telegram\.me\//i;
const GLOBAL_BODY_COC_RE = /link\.clashofclans\.com|openclanprofile|play\.google\.com\/store|apps\.apple\.com/i;
const GLOBAL_BODY_INGAME_TAG_RE = /#[0-9A-Z]{8,15}(?![0-9A-Z])/i;

function containsFakeVerificationMarker(text) {
  return FAKE_VERIFICATION_CHARS_RE.test(String(text || ''));
}

/**
 * Emoji / pittogrammi (es. 🛡 😀) e sequenze bandiera — non ammessi nel formato manuale nome#TAG.
 * Tenta Unicode Extended_Pictographic, con fallback compatibile su runtime Node/ICU più vecchi.
 */
function containsEmojiOrPictograph(text) {
  const s = String(text || '');
  try {
    if (new RegExp('\\p{Extended_Pictographic}', 'u').test(s)) return true;
  } catch (_) {
    // Fallback pragmatico: blocca i principali blocchi Unicode usati da emoji/pittogrammi.
    if (/[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\uD83C-\uDBFF\uDC00-\uDFFF]/.test(s)) return true;
  }
  if (/[\u{1F1E6}-\u{1F1FF}]{2}/u.test(s)) return true;
  return false;
}

/** Link ufficiale profilo giocatore CoC (tag senza # nell’URL). */
function buildOpenPlayerProfileUrl(displayTag, lang = 'it') {
  const raw = String(displayTag || '')
    .trim()
    .toUpperCase()
    .replace(/^#/, '');
  if (!/^[0-9A-Z]{3,15}$/.test(raw)) return null;
  const l = String(lang || 'it').toLowerCase();
  const loc = /^[a-z]{2}$/.test(l) ? l : 'it';
  return `https://link.clashofclans.com/${loc}?action=OpenPlayerProfile&tag=${raw}`;
}

/** Per attributo href in parse_mode HTML (Telegram richiede &amp;). */
function escapeTelegramHtmlHref(url) {
  return String(url || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

/**
 * Regole messaggi in chat globale (solo testo visibile agli altri).
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function validateGlobalChatMessageBody(text) {
  const t = String(text || '');
  if (GLOBAL_BODY_URL_RE.test(t)) {
    return { ok: false, reason: 'Non sono ammessi link o indirizzi web nella chat globale.' };
  }
  if (GLOBAL_BODY_COC_RE.test(t)) {
    return { ok: false, reason: 'Non sono ammessi link di gioco, store o profili clan nella chat globale.' };
  }
  if (GLOBAL_BODY_INGAME_TAG_RE.test(t)) {
    return {
      ok: false,
      reason:
        'Nel messaggio non inserire tag villaggio/clan (es. <code>#XXXXXXXX</code>). Il tag è già mostrato nell’intestazione se verificato.',
    };
  }
  return { ok: true };
}

const GLOBAL_CHAT_RATE_MAX = 12;
const GLOBAL_CHAT_RATE_WINDOW_MS = 60 * 1000;

/** @type {Map<number, number[]>} */
const globalChatRateBuckets = new Map();

/**
 * Limite messaggi per minuto (anti-spam).
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function checkGlobalChatRateLimit(telegramUserId) {
  const uid = Number(telegramUserId);
  if (!Number.isFinite(uid)) return { ok: true };
  const now = Date.now();
  let arr = globalChatRateBuckets.get(uid) || [];
  arr = arr.filter((ts) => now - ts < GLOBAL_CHAT_RATE_WINDOW_MS);
  if (arr.length >= GLOBAL_CHAT_RATE_MAX) {
    return { ok: false, reason: 'Stai inviando troppi messaggi. Attendi un minuto e riprova.' };
  }
  arr.push(now);
  globalChatRateBuckets.set(uid, arr);
  return { ok: true };
}

module.exports = {
  EPOCH_SEC,
  RECRUIT_TTL_MS,
  GLOBAL_MSG_MAX_LEN,
  currentEpochIndex,
  epochStartIso,
  extractOfficialClanLink,
  isOfficialClanProfileLink,
  recruitmentTextValid,
  isBotOwnerTelegramUser,
  parseOwnerTelegramIds,
  normClanTagForUrl,
  buildOfficialClanLinkFromTag,
  msUntilNextEpochBoundary,
  formatCountdownIt,
  containsFakeVerificationMarker,
  containsEmojiOrPictograph,
  buildOpenPlayerProfileUrl,
  escapeTelegramHtmlHref,
  validateGlobalChatMessageBody,
  checkGlobalChatRateLimit,
  GLOBAL_CHAT_RATE_MAX,
};
