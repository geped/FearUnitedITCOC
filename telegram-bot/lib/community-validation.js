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
};
