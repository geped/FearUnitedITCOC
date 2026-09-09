'use strict';

/**
 * Cache persistente dei file_id Telegram per asset statici del bot.
 * Evita di ricaricare MB di immagini su ogni tap menu (banda Render → Telegram).
 *
 * Ordine di lookup: variabili d'ambiente → JSON su disco → upload una tantum.
 * Dopo il primo upload in produzione, copia i file_id nelle env Render per sopravvivere ai redeploy:
 *   TELEGRAM_FILE_ID_WELCOME, TELEGRAM_FILE_ID_CWL_HEADER, TELEGRAM_FILE_ID_WAR_HEADER
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'telegram-photo-cache.json');

const ENV_BY_KEY = {
  welcome: 'TELEGRAM_FILE_ID_WELCOME',
  cwl_header: 'TELEGRAM_FILE_ID_CWL_HEADER',
  war_header: 'TELEGRAM_FILE_ID_WAR_HEADER',
};

function readDiskCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch (_) {
    return {};
  }
}

function writeDiskCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('[telegram-photo-cache] write failed:', e.message);
  }
}

function getCachedFileId(cacheKey) {
  const envName = ENV_BY_KEY[cacheKey];
  if (envName && process.env[envName]) {
    return String(process.env[envName]).trim();
  }
  const disk = readDiskCache();
  return disk[cacheKey] || null;
}

function setCachedFileId(cacheKey, fileId) {
  if (!fileId) return;
  const disk = readDiskCache();
  if (disk[cacheKey] === fileId) return;
  disk[cacheKey] = fileId;
  writeDiskCache(disk);
  const envName = ENV_BY_KEY[cacheKey];
  console.log(
    `[telegram-photo-cache] cached ${cacheKey} → imposta ${envName}=${fileId} su Render per persistenza tra redeploy`,
  );
}

/**
 * Invia foto statica: riusa file_id se in cache, altrimenti upload da disco e salva file_id.
 * @param {object} ctx - Telegraf context
 * @param {string} cacheKey - chiave cache (welcome | cwl_header | war_header)
 * @param {string} filePath - path assoluto immagine locale
 * @param {object} [extraOpts] - opzioni replyWithPhoto (parse_mode, ecc.)
 */
async function replyWithCachedPhoto(ctx, cacheKey, filePath, extraOpts = {}) {
  if (!ctx?.replyWithPhoto) return null;

  const cached = getCachedFileId(cacheKey);
  if (cached) {
    return ctx.replyWithPhoto(cached, extraOpts).catch(async (e) => {
      console.warn('[telegram-photo-cache] file_id stale', cacheKey, e.message);
      if (!fs.existsSync(filePath)) return null;
      const msg = await ctx.replyWithPhoto({ source: fs.createReadStream(filePath) }, extraOpts).catch(() => null);
      if (msg?.photo?.length) {
        setCachedFileId(cacheKey, msg.photo[msg.photo.length - 1].file_id);
      }
      return msg;
    });
  }

  if (!fs.existsSync(filePath)) return null;
  const msg = await ctx.replyWithPhoto({ source: fs.createReadStream(filePath) }, extraOpts).catch(() => null);
  if (msg?.photo?.length) {
    setCachedFileId(cacheKey, msg.photo[msg.photo.length - 1].file_id);
  }
  return msg;
}

module.exports = {
  getCachedFileId,
  setCachedFileId,
  replyWithCachedPhoto,
};
