'use strict';

/**
 * Carica dataset statico data/coc-village/entities.json.
 */

const path = require('path');
const fs = require('fs');

let _cache = null;

function loadDataset() {
  if (_cache) return _cache;
  const file = path.join(__dirname, '..', '..', 'data', 'coc-village', 'entities.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map();
  for (const e of raw.entities || []) {
    byId.set(Number(e.dataId), e);
  }
  _cache = {
    version: raw.version || 'unknown',
    globalMaxTh: Number(raw.globalMaxTh || 18),
    globalMaxBh: Number(raw.globalMaxBh || 10),
    entities: raw.entities || [],
    byId,
  };
  return _cache;
}

function getEntity(dataId) {
  return loadDataset().byId.get(Number(dataId)) || null;
}

module.exports = {
  loadDataset,
  getEntity,
};
