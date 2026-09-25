'use strict';

/**
 * Calcolo progresso villaggio vs max TH corrente e max globale.
 */

const { loadDataset, getIconUrl, getCategoryIconUrl } = require('./village-progress-dataset');
const { emptyCost } = require('./village-progress-parser');

const HOME_CATS = [
  'townhall',
  'defenses',
  'resources',
  'army_buildings',
  'walls',
  'traps',
  'heroes',
  'pets',
  'equipment',
  'troops',
  'spells',
  'siege',
  'helpers',
  'guardians',
  'crafted',
];

const BUILDER_CATS = ['buildings', 'traps', 'troops', 'heroes'];

const DISCLAIMER =
  'Stime senza boost, rune, sconti Gold Pass o coda builder. I moduli crafting senza dati possono essere incompleti.';

function emptyCat() {
  return {
    pct_th: 1,
    pct_global: 1,
    missing: [],
    cost_th: emptyCost(),
    time_sec_th: 0,
    cost_global: emptyCost(),
    time_sec_global: 0,
    current_levels: 0,
    max_levels_th: 0,
    current_levels_global: 0,
    max_levels_global: 0,
  };
}

function addCost(dst, resource, amount) {
  const k = resource && dst[resource] != null ? resource : 'other';
  dst[k] = (dst[k] || 0) + (amount || 0);
}

function mergeCost(a, b) {
  const out = emptyCost();
  for (const k of Object.keys(out)) out[k] = (a[k] || 0) + (b[k] || 0);
  return out;
}

function expandLevels(ownedRows) {
  const levels = [];
  for (const row of ownedRows) {
    const n = Math.max(1, Number(row.cnt || 1));
    for (let i = 0; i < n; i++) levels.push(Number(row.lvl || 0));
  }
  levels.sort((a, b) => b - a);
  return levels;
}

function costFromTo(ent, fromLvl, toLvl) {
  const cost = emptyCost();
  let time = 0;
  const from = Math.max(0, Number(fromLvl) || 0);
  const to = Math.max(0, Number(toLvl) || 0);
  for (let L = from + 1; L <= to; L++) {
    addCost(cost, ent.costResources?.[L] || 'other', Number(ent.costs?.[L] || 0));
    time += Number(ent.times?.[L] || 0);
  }
  return { cost, time };
}

function pct(num, den) {
  if (!den || den <= 0) return 1;
  return Math.max(0, Math.min(1, num / den));
}

function analyzeEntity(ent, ownedRows, hallLevel, hallGlobal) {
  const maxLvlTh = Number(ent.maxLevelByTh[hallLevel - 1] || 0);
  const maxLvlG = Number(ent.maxLevelByTh[hallGlobal - 1] || 0);
  const expectedTh = Number(ent.maxCountByTh[hallLevel - 1] || 0);
  const expectedG = Number(ent.maxCountByTh[hallGlobal - 1] || 0);
  const ownedLevels = expandLevels(ownedRows);

  const out = {
    current_levels: 0,
    max_levels_th: 0,
    current_levels_global: 0,
    max_levels_global: 0,
    cost_th: emptyCost(),
    time_sec_th: 0,
    cost_global: emptyCost(),
    time_sec_global: 0,
    missing: [],
  };

  if (expectedTh > 0 && maxLvlTh > 0) {
    out.max_levels_th = expectedTh * maxLvlTh;
    for (let i = 0; i < expectedTh; i++) {
      const lvl = i < ownedLevels.length ? ownedLevels[i] : 0;
      const capped = Math.min(lvl, maxLvlTh);
      out.current_levels += capped;
      if (capped < maxLvlTh) {
        const gap = costFromTo(ent, capped, maxLvlTh);
        out.cost_th = mergeCost(out.cost_th, gap.cost);
        out.time_sec_th += gap.time;
        out.missing.push({
          scope: 'th',
          dataId: ent.dataId,
          name: ent.nameIt || ent.name,
          nameEn: ent.name,
          icon: getIconUrl(ent.dataId),
          from: capped,
          to: maxLvlTh,
          piece: i + 1,
        });
      }
    }
  }

  if (expectedG > 0 && maxLvlG > 0) {
    out.max_levels_global = expectedG * maxLvlG;
    for (let i = 0; i < expectedG; i++) {
      const lvl = i < ownedLevels.length ? ownedLevels[i] : 0;
      const capped = Math.min(lvl, maxLvlG);
      out.current_levels_global += capped;
      if (capped < maxLvlG) {
        const gap = costFromTo(ent, capped, maxLvlG);
        out.cost_global = mergeCost(out.cost_global, gap.cost);
        out.time_sec_global += gap.time;
      }
    }
  }

  return out;
}

function buildVillage(ds, ownedById, village, hallLevel, hallGlobal, categories) {
  const cats = {};
  for (const c of categories) cats[c] = emptyCat();

  if (!hallLevel) {
    return {
      pct_th: 0,
      pct_global: 0,
      categories: cats,
      cost_th: emptyCost(),
      time_sec_th: 0,
      cost_global: emptyCost(),
      time_sec_global: 0,
      missing_count: 0,
    };
  }

  let curTh = 0;
  let maxTh = 0;
  let curG = 0;
  let maxG = 0;
  let costTh = emptyCost();
  let timeTh = 0;
  let costG = emptyCost();
  let timeG = 0;

  for (const ent of ds.entities) {
    if (ent.village !== village) continue;
    const expTh = Number(ent.maxCountByTh[hallLevel - 1] || 0);
    const expG = Number(ent.maxCountByTh[hallGlobal - 1] || 0);
    const maxLTh = Number(ent.maxLevelByTh[hallLevel - 1] || 0);
    const maxLG = Number(ent.maxLevelByTh[hallGlobal - 1] || 0);
    if ((expTh <= 0 || maxLTh <= 0) && (expG <= 0 || maxLG <= 0)) continue;

    const analysis = analyzeEntity(ent, ownedById.get(ent.dataId) || [], hallLevel, hallGlobal);
    const catKey = categories.includes(ent.category) ? ent.category : categories[categories.length - 1];
    const bucket = cats[catKey];

    bucket.current_levels += analysis.current_levels;
    bucket.max_levels_th += analysis.max_levels_th;
    bucket.current_levels_global += analysis.current_levels_global;
    bucket.max_levels_global += analysis.max_levels_global;
    bucket.cost_th = mergeCost(bucket.cost_th, analysis.cost_th);
    bucket.time_sec_th += analysis.time_sec_th;
    bucket.cost_global = mergeCost(bucket.cost_global, analysis.cost_global);
    bucket.time_sec_global += analysis.time_sec_global;
    for (const m of analysis.missing) bucket.missing.push(m);

    curTh += analysis.current_levels;
    maxTh += analysis.max_levels_th;
    curG += analysis.current_levels_global;
    maxG += analysis.max_levels_global;
    costTh = mergeCost(costTh, analysis.cost_th);
    timeTh += analysis.time_sec_th;
    costG = mergeCost(costG, analysis.cost_global);
    timeG += analysis.time_sec_global;
  }

  for (const c of categories) {
    const b = cats[c];
    b.pct_th = pct(b.current_levels, b.max_levels_th);
    b.pct_global = pct(b.current_levels_global, b.max_levels_global);
    b.icon = getCategoryIconUrl(c);
    b.label = c;
    b.missing = b.missing.slice(0, 50);
  }

  return {
    pct_th: pct(curTh, maxTh),
    pct_global: pct(curG, maxG),
    categories: cats,
    cost_th: costTh,
    time_sec_th: timeTh,
    cost_global: costG,
    time_sec_global: timeG,
    missing_count: Object.values(cats).reduce((s, b) => s + (b.missing?.length || 0), 0),
  };
}

/**
 * @param {{ thLevel: number, bhLevel: number|null, items: object[], gameTimestamp: number }} parsed
 */
function calculateProgress(parsed) {
  const ds = loadDataset();
  const th = Math.max(1, Math.min(18, Number(parsed.thLevel) || 1));
  const bh =
    parsed.bhLevel != null ? Math.max(1, Math.min(ds.globalMaxBh, Number(parsed.bhLevel))) : null;

  const ownedById = new Map();
  for (const it of parsed.items || []) {
    const id = Number(it.dataId);
    if (!ownedById.has(id)) ownedById.set(id, []);
    ownedById.get(id).push(it);
  }

  const home = buildVillage(ds, ownedById, 'home', th, ds.globalMaxTh, HOME_CATS);
  const builder = bh
    ? buildVillage(ds, ownedById, 'builder', bh, ds.globalMaxBh, BUILDER_CATS)
    : buildVillage(ds, ownedById, 'builder', null, ds.globalMaxBh, BUILDER_CATS);

  const active_upgrades = [];
  for (const it of parsed.items || []) {
    if (it.timer == null || !(Number(it.timer) > 0)) continue;
    active_upgrades.push({
      name: it.name,
      dataId: it.dataId,
      icon: getIconUrl(it.dataId),
      lvl: it.lvl,
      village: it.village,
      eta_unix: Number(parsed.gameTimestamp) + Number(it.timer),
      timer: Number(it.timer),
    });
  }
  active_upgrades.sort((a, b) => a.eta_unix - b.eta_unix);

  return {
    th_level: th,
    bh_level: bh,
    home,
    builder,
    active_upgrades: active_upgrades.slice(0, 30),
    disclaimer: DISCLAIMER,
    dataset_version: ds.version,
  };
}

module.exports = {
  calculateProgress,
  HOME_CATS,
  BUILDER_CATS,
  DISCLAIMER,
};
