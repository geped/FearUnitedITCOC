'use strict';

/**
 * Carica dataset statico data/coc-village/entities.json (+ icons.json).
 */

const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'coc-village');
const CDN_FALLBACK = 'https://cdn.jsdelivr.net/npm/clash-of-clans-data@0.18.0/';

let _cache = null;
let _icons = null;

function loadIcons() {
  if (_icons) return _icons;
  try {
    _icons = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'icons.json'), 'utf8'));
  } catch (_) {
    _icons = { cdnBase: CDN_FALLBACK, byDataId: {}, categoryIcons: {} };
  }
  if (!_icons.cdnBase) _icons.cdnBase = CDN_FALLBACK;
  if (!_icons.byDataId) _icons.byDataId = {};
  if (!_icons.categoryIcons) _icons.categoryIcons = {};
  return _icons;
}

function loadDataset() {
  if (_cache) return _cache;
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'entities.json'), 'utf8'));
  const byId = new Map();
  for (const e of raw.entities || []) {
    byId.set(Number(e.dataId), e);
  }
  const icons = loadIcons();
  _cache = {
    version: raw.version || 'unknown',
    globalMaxTh: Number(raw.globalMaxTh || 18),
    globalMaxBh: Number(raw.globalMaxBh || 10),
    entities: raw.entities || [],
    byId,
    cdnBase: icons.cdnBase || CDN_FALLBACK,
    icons,
  };
  return _cache;
}

function getEntity(dataId) {
  return loadDataset().byId.get(Number(dataId)) || null;
}

function _absUrl(ds, pathOrUrl) {
  if (!pathOrUrl) return null;
  const s = String(pathOrUrl);
  if (/^https?:\/\//i.test(s)) return s;
  return ds.cdnBase + s.replace(/^\//, '');
}

/** Evita mapping errati tipo Town Hall → weapons/inferno-artillery. */
function _isBadIconPath(p) {
  if (!p) return true;
  const s = String(p);
  if (s.includes('/weapons/')) return true;
  if (s.includes('inferno-artillery') && !s.includes('town-hall/normal')) return true;
  return false;
}

/**
 * @param {number|string} dataId
 * @param {{ level?: number }} [opts]
 */
function getIconUrl(dataId, opts = {}) {
  const ds = loadDataset();
  const id = Number(dataId);
  if (!Number.isFinite(id)) return null;
  const key = String(id);
  const ent = ds.byId.get(id);

  // Municipio: sempre path normale (mai weapon skin), livello se noto
  if (id === 1000001 || ent?.id === 'town-hall') {
    const lvl = Math.max(1, Math.min(18, Number(opts.level) || 1));
    return `${ds.cdnBase}images/home/town-hall/normal/level-${lvl}.png`;
  }

  const row = ds.icons?.byDataId?.[key];
  if (row?.url && !_isBadIconPath(row.url)) return row.url;
  if (row?.path && !_isBadIconPath(row.path)) return _absUrl(ds, row.path);

  if (ent?.icon && !_isBadIconPath(ent.icon)) return _absUrl(ds, ent.icon);

  // Fallback da slug id entità (heroes/pets/equipment usano icon.png)
  if (ent?.id) {
    const village = ent.village === 'builder' ? 'builder' : 'home';
    const slug = String(ent.id);
    const candidates = [];
    if (ent.category === 'heroes') candidates.push(`images/${village}/heroes/${slug}/icon.png`);
    if (ent.category === 'pets') candidates.push(`images/home/pets/${slug}/icon.png`);
    if (ent.category === 'equipment') candidates.push(`images/home/hero-equipment/${slug}/icon.png`);
    if (ent.category === 'troops') candidates.push(`images/${village}/troops/${slug}/icon.png`);
    if (ent.category === 'spells') candidates.push(`images/home/spells/${slug}/icon.png`);
    if (ent.category === 'siege') candidates.push(`images/home/siege-machines/${slug}/icon.png`);
    candidates.push(`images/${village}/defenses/${slug}/normal/level-1.png`);
    candidates.push(`images/${village}/other/${slug}/normal/level-1.png`);
    if (candidates[0]) return _absUrl(ds, candidates[0]);
  }
  return null;
}

function getCategoryIconUrl(category) {
  const ds = loadDataset();
  const row = ds.icons?.categoryIcons?.[category];
  if (row?.url && !_isBadIconPath(row.url)) return row.url;
  if (row?.path && !_isBadIconPath(row.path)) return _absUrl(ds, row.path);
  return null;
}

/**
 * Riempie icon URL mancanti/errati in un summary già calcolato o salvato.
 * Utile per snapshot storici e per garantire icone fresche dal dataset.
 */
function rehydrateSummaryIcons(summary) {
  if (!summary || typeof summary !== 'object') return summary;

  const fixMissing = (list) => {
    if (!Array.isArray(list)) return;
    for (const m of list) {
      if (!m || m.dataId == null) continue;
      const url = getIconUrl(m.dataId, { level: m.to || m.from || 1 });
      if (url) m.icon = url;
    }
  };

  const fixVillage = (v) => {
    if (!v?.categories) return;
    for (const [cat, bucket] of Object.entries(v.categories)) {
      if (!bucket) continue;
      const catUrl = getCategoryIconUrl(cat);
      if (catUrl) bucket.icon = catUrl;
      fixMissing(bucket.missing);
    }
  };

  fixVillage(summary.home);
  fixVillage(summary.builder);
  if (Array.isArray(summary.active_upgrades)) {
    for (const u of summary.active_upgrades) {
      if (!u || u.dataId == null) continue;
      const url = getIconUrl(u.dataId, { level: u.lvl || 1 });
      if (url) u.icon = url;
    }
  }
  return summary;
}

module.exports = {
  loadDataset,
  getEntity,
  getIconUrl,
  getCategoryIconUrl,
  rehydrateSummaryIcons,
  CDN_FALLBACK,
};
