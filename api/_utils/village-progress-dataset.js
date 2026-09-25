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

function getIconUrl(dataId) {
  const ds = loadDataset();
  const key = String(dataId);
  const row = ds.icons?.byDataId?.[key];
  if (row?.url) return row.url;
  if (row?.path) return ds.cdnBase + row.path;
  const ent = ds.byId.get(Number(dataId));
  if (ent?.icon) return ds.cdnBase + ent.icon;
  return null;
}

function getCategoryIconUrl(category) {
  const ds = loadDataset();
  const row = ds.icons?.categoryIcons?.[category];
  if (row?.url) return row.url;
  if (row?.path) return ds.cdnBase + row.path;
  return null;
}

module.exports = {
  loadDataset,
  getEntity,
  getIconUrl,
  getCategoryIconUrl,
  CDN_FALLBACK,
};
