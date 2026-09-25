'use strict';

/**
 * Parser export JSON in-game CoC → items tipizzati.
 */

const { getEntity } = require('./village-progress-dataset');

function normalizeTag(raw) {
  if (raw == null || !String(raw).trim()) return null;
  const u = String(raw).trim().toUpperCase().replace(/^#+/, '');
  return u ? `#${u}` : null;
}

const HOME_SECTIONS = [
  ['buildings', 'buildings'],
  ['traps', 'traps'],
  ['units', 'units'],
  ['siege_machines', 'siege'],
  ['heroes', 'heroes'],
  ['spells', 'spells'],
  ['pets', 'pets'],
  ['equipment', 'equipment'],
  ['helpers', 'helpers'],
  ['guardians', 'guardians'],
];

const BUILDER_SECTIONS = [
  ['buildings2', 'buildings'],
  ['traps2', 'traps'],
  ['units2', 'units'],
  ['heroes2', 'heroes'],
];

const TH_DATA_ID = 1000001;
const BH_DATA_ID = 1000034; // Builder Hall — verify; fallback scan buildings2

function emptyCost() {
  return { gold: 0, elixir: 0, dark: 0, builder_gold: 0, other: 0 };
}

function pushItem(out, row, village, sectionHint) {
  if (!row || row.data == null) return;
  const dataId = Number(row.data);
  const ent = getEntity(dataId);
  const lvl = Number(row.lvl ?? 0);
  const cnt = Math.max(1, Number(row.cnt ?? 1));
  const item = {
    dataId,
    lvl,
    cnt,
    village,
    category: ent?.category || sectionHint || 'other',
    name: ent?.nameIt || ent?.name || `ID ${dataId}`,
    gear_up: row.gear_up ? 1 : 0,
    timer: row.timer != null ? Number(row.timer) : null,
    weapon: row.weapon != null ? Number(row.weapon) : null,
    helper_cooldown: row.helper_cooldown != null ? Number(row.helper_cooldown) : null,
  };
  out.push(item);

  // Crafted defense / crafting station nested types+modules
  if (Array.isArray(row.types)) {
    for (const t of row.types) {
      const typeId = Number(t.data);
      const typeEnt = getEntity(typeId);
      out.push({
        dataId: typeId,
        lvl: Number(t.lvl ?? 1),
        cnt: 1,
        village,
        category: 'crafted',
        name: typeEnt?.nameIt || typeEnt?.name || `Tipo ${typeId}`,
        gear_up: 0,
        timer: t.timer != null ? Number(t.timer) : null,
      });
      for (const m of t.modules || []) {
        const modId = Number(m.data);
        const modEnt = getEntity(modId);
        out.push({
          dataId: modId,
          lvl: Number(m.lvl ?? 0),
          cnt: 1,
          village,
          category: 'crafted',
          name: modEnt?.nameIt || modEnt?.name || `Modulo ${modId}`,
          gear_up: 0,
          timer: m.timer != null ? Number(m.timer) : null,
        });
      }
    }
  }
}

/**
 * @param {object|string} rawInput
 * @returns {{ tag: string, gameTimestamp: number, thLevel: number, bhLevel: number|null, items: object[], raw: object }}
 */
function parseVillageExport(rawInput) {
  let raw = rawInput;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (_) {
      const e = new Error('JSON non valido.');
      e.status = 400;
      throw e;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const e = new Error('Export villaggio non valido: oggetto JSON richiesto.');
    e.status = 400;
    throw e;
  }

  const tag = normalizeTag(raw.tag);
  if (!tag) {
    const e = new Error('Campo tag mancante o non valido nell\'export.');
    e.status = 400;
    throw e;
  }

  const gameTimestamp = Number(raw.timestamp);
  if (!Number.isFinite(gameTimestamp) || gameTimestamp <= 0) {
    const e = new Error('Campo timestamp mancante o non valido nell\'export.');
    e.status = 400;
    throw e;
  }

  const items = [];
  for (const [key, hint] of HOME_SECTIONS) {
    for (const row of raw[key] || []) pushItem(items, row, 'home', hint);
  }
  for (const [key, hint] of BUILDER_SECTIONS) {
    for (const row of raw[key] || []) pushItem(items, row, 'builder', hint);
  }

  let thLevel = null;
  for (const it of items) {
    if (it.village === 'home' && it.dataId === TH_DATA_ID) {
      thLevel = Math.max(thLevel || 0, it.lvl);
    }
  }
  if (!thLevel) {
    const e = new Error('Municipio (Town Hall) non trovato nell\'export.');
    e.status = 400;
    throw e;
  }

  let bhLevel = null;
  for (const it of items) {
    if (it.village !== 'builder') continue;
    const ent = getEntity(it.dataId);
    if (ent && (ent.id === 'builder-hall' || /builder hall/i.test(ent.name || ''))) {
      bhLevel = Math.max(bhLevel || 0, it.lvl);
    }
  }
  // Fallback: building with highest max as BH often dataId 1000034
  if (!bhLevel) {
    for (const it of items) {
      if (it.dataId === BH_DATA_ID) bhLevel = Math.max(bhLevel || 0, it.lvl);
    }
  }

  return { tag, gameTimestamp, thLevel, bhLevel, items, raw };
}

module.exports = {
  parseVillageExport,
  emptyCost,
  TH_DATA_ID,
  BH_DATA_ID,
};
