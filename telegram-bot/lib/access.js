'use strict';

const lastHit = new Map();

/**
 * Se TELEGRAM_ALLOWED_IDS è impostato (lista separata da virgole), solo quegli user id possono usare il bot.
 * Se vuoto: accesso libero (usa in produzione solo in canale privato o con log).
 */
function isUserAllowed(telegramUserId) {
  const raw = process.env.TELEGRAM_ALLOWED_IDS;
  if (!raw || !String(raw).trim()) return true;
  const allowed = new Set(
    String(raw)
      .split(',')
      .map((s) => Number(String(s).trim()))
      .filter((n) => Number.isFinite(n))
  );
  return allowed.has(Number(telegramUserId));
}

function rateLimitOk(telegramUserId, minMs = 800) {
  const id = Number(telegramUserId);
  const now = Date.now();
  const prev = lastHit.get(id) || 0;
  if (now - prev < minMs) return false;
  lastHit.set(id, now);
  return true;
}

module.exports = { isUserAllowed, rateLimitOk };
