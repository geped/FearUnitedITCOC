#!/usr/bin/env node
/**
 * Rigenera data/coc-village/entities.json + icons.json da clash-of-clans-data.
 *
 * Uso:
 *   node scripts/build-coc-village-dataset.mjs                 # scarica da jsDelivr
 *   node scripts/build-coc-village-dataset.mjs --local=<dir>   # legge un pacchetto estratto
 *                                                              # (npm pack clash-of-clans-data@X && tar xzf …)
 *
 * Le icone restano servite da jsDelivr (cdnBase in icons.json), versione = VERSION_PKG.
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VERSION_PKG = '0.19.1';
const DATA_MONTH = '2026-10';
const BASE = `https://cdn.jsdelivr.net/npm/clash-of-clans-data@${VERSION_PKG}/`;
const OUT_DIR = path.join(__dirname, '..', 'data', 'coc-village');
/** TH massimo coperto dal pacchetto dati (non il TH massimo del gioco). */
const DATA_MAX_TH = 18;
const LOCAL_ARG = process.argv.find((a) => a.startsWith('--local='));
const LOCAL_DIR = LOCAL_ARG ? path.resolve(LOCAL_ARG.slice('--local='.length)) : null;

/** Icona rappresentativa per categoria (percorsi relativi al pacchetto). */
const CATEGORY_ICONS = {
  townhall: 'images/home/town-hall/normal/level-14.png',
  defenses: 'images/home/defenses/cannon/normal/level-1.png',
  resources: 'images/home/resource-buildings/gold-mine/normal/level-1.png',
  army_buildings: 'images/home/army-buildings/army-camp/normal/level-1.png',
  walls: 'images/home/defenses/wall/normal/level-1.png',
  traps: 'images/home/traps/bomb/normal/level-1.png',
  heroes: 'images/home/heroes/barbarian-king/icon.png',
  pets: 'images/home/pets/lassi/icon.png',
  equipment: 'images/home/hero-equipment/barbarian-puppet/icon.png',
  troops: 'images/home/troops/barbarian/icon.png',
  spells: 'images/home/spells/lightning-spell/icon.png',
  siege: 'images/home/siege-machines/wall-wrecker/icon.png',
  guardians: 'images/home/guardians/longshot/normal/level-1.png',
  crafted: 'images/home/defenses/crafting-station/normal/level-1.png',
  buildings: 'images/builder/defenses/cannon/normal/level-1.png',
  helpers: 'images/home/other/helper-hut/normal/level-1.png',
};

const IT_NAMES = {
  'Town Hall': 'Municipio',
  'Builder Hall': 'Builder Hall',
  Cannon: 'Cannone',
  'Archer Tower': 'Torre Arcieri',
  Mortar: 'Mortaio',
  'Air Defense': 'Difesa Aerea',
  'Wizard Tower': 'Torre Maghi',
  'Air Sweeper': 'Spazzatore',
  'Hidden Tesla': 'Tesla Nascosta',
  'Bomb Tower': 'Torre Bombe',
  'X-Bow': 'X-Bow',
  'Inferno Tower': 'Torre Inferno',
  'Eagle Artillery': 'Artiglieria Aquila',
  Scattershot: 'Spargitore',
  "Builder's Hut": 'Capanna Costruttore',
  'Builders Hut': 'Capanna Costruttore',
  'Spell Tower': 'Torre Incantesimi',
  Monolith: 'Monolite',
  Firespitter: 'Sputafuoco',
  Wall: 'Muro',
  'Multi-Archer Tower': 'Torre Multi-Arcieri',
  'Ricochet Cannon': 'Cannone Rimbalzo',
  'Multi-Gear Tower': 'Torre Multi-Ingranaggio',
  Bomb: 'Bomba',
  'Spring Trap': 'Trappola a Molla',
  'Giant Bomb': 'Bomba Gigante',
  'Air Bomb': 'Bomba Aerea',
  'Seeking Air Mine': 'Mina Aerea',
  'Skeleton Trap': 'Trappola Scheletri',
  'Tornado Trap': 'Trappola Tornado',
  'Giga Bomb': 'Giga Bomba',
  'Gold Mine': "Miniera d'Oro",
  'Elixir Collector': 'Collettore Elisir',
  'Gold Storage': 'Deposito Oro',
  'Elixir Storage': 'Deposito Elisir',
  'Dark Elixir Drill': 'Trivella Elisir Nero',
  'Dark Elixir Storage': 'Deposito Elisir Nero',
  'Clan Castle': 'Castello del Clan',
  'Army Camp': 'Campo Truppe',
  Barracks: 'Caserme',
  'Dark Barracks': 'Caserme Oscure',
  Laboratory: 'Laboratorio',
  'Spell Factory': 'Fabbrica Incantesimi',
  'Dark Spell Factory': 'Fabbrica Incantesimi Oscuri',
  Workshop: 'Officina',
  'Pet House': 'Casa Famigli',
  'Hero Hall': 'Sala Eroi',
  Blacksmith: 'Fabbro',
  'Barbarian King': 'Re Barbaro',
  'Archer Queen': 'Regina Arcieri',
  'Grand Warden': 'Gran Sorvegliante',
  'Royal Champion': 'Campionessa Reale',
  'Minion Prince': 'Principe Minion',
  'Battle Machine': 'Macchina da Guerra',
  'Battle Copter': 'Elicottero da Guerra',
  'Crafting Station': 'Stazione Crafting',
  'Crafted Defense': 'Difesa Artigianale',
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchJson(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function walk(files, prefix = '') {
  const out = [];
  for (const f of files || []) {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    if (f.type === 'directory') out.push(...walk(f.files, p));
    else if (f.name.endsWith('.json')) out.push(p);
  }
  return out;
}

function timeToSec(t) {
  if (!t || typeof t !== 'object') return 0;
  return (t.days || 0) * 86400 + (t.hours || 0) * 3600 + (t.minutes || 0) * 60 + (t.seconds || 0);
}

function resourceKey(r) {
  const s = String(r || '').toLowerCase();
  if (s.includes('dark')) return 'dark';
  if (s.includes('elixir')) return 'elixir';
  if (s.includes('gold')) return 'gold';
  if (s.includes('builder') || s.includes('star')) return 'builder_gold';
  return 'other';
}

function categoryFrom(entity, filePath) {
  const cat = String(entity.category || '').toLowerCase();
  const base = entity.base === 'builder' ? 'builder' : 'home';
  if (base === 'builder') {
    if (cat.includes('trap')) return 'traps';
    if (cat.includes('troop') || cat.includes('unit')) return 'troops';
    if (cat.includes('hero')) return 'heroes';
    return 'buildings';
  }
  if (cat.includes('crafted')) return 'crafted';
  if (filePath.includes('/walls/') || entity.name === 'Wall') return 'walls';
  if (filePath.includes('/traps/')) return 'traps';
  if (filePath.includes('/defenses/') || cat === 'defense') return 'defenses';
  if (filePath.includes('/resources/') || cat === 'resource') return 'resources';
  if (filePath.includes('/army/') || cat === 'army') return 'army_buildings';
  if (filePath.includes('/heroes/') || cat === 'hero') return 'heroes';
  if (filePath.includes('/pets/') || cat === 'pet') return 'pets';
  if (filePath.includes('/equipment/') || cat.includes('equipment')) return 'equipment';
  if (filePath.includes('/troops/') || cat === 'troop') return 'troops';
  if (filePath.includes('/spells/') || cat === 'spell') return 'spells';
  if (filePath.includes('/siege') || cat.includes('siege')) return 'siege';
  if (filePath.includes('/helpers/') || cat.includes('helper')) return 'helpers';
  if (filePath.includes('/guardians/') || cat.includes('guardian')) return 'guardians';
  if (entity.id === 'town-hall' || entity.name === 'Town Hall') return 'townhall';
  if (filePath.includes('/research/') || cat === 'research') return 'troops';
  return 'army_buildings';
}

function walkLocal(dir, rel) {
  const out = [];
  for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = `${rel}/${ent.name}`;
    if (ent.isDirectory()) out.push(...walkLocal(dir, p));
    else if (ent.name.endsWith('.json')) out.push(p);
  }
  return out;
}

async function listDataFiles() {
  if (LOCAL_DIR) {
    const localVer = JSON.parse(fs.readFileSync(path.join(LOCAL_DIR, 'package.json'), 'utf8')).version;
    if (localVer !== VERSION_PKG) {
      throw new Error(`Pacchetto locale ${localVer} ≠ VERSION_PKG ${VERSION_PKG}`);
    }
    return walkLocal(LOCAL_DIR, 'data');
  }
  const pkg = await fetchJson(`https://data.jsdelivr.com/v1/packages/npm/clash-of-clans-data@${VERSION_PKG}`);
  const dataDir = pkg.files.find((x) => x.name === 'data');
  return walk(dataDir.files, 'data');
}

function loadEntity(rel) {
  if (LOCAL_DIR) return Promise.resolve(JSON.parse(fs.readFileSync(path.join(LOCAL_DIR, rel), 'utf8')));
  return fetchJson(BASE + rel);
}

/** images.icon, altrimenti immagine "normal" del livello 1. */
function iconPathOf(entity) {
  if (entity.images && typeof entity.images.icon === 'string') return entity.images.icon;
  // Difese artigianali: images = [{ fromEffectiveLevel, normal }, …]
  if (Array.isArray(entity.images) && entity.images[0] && typeof entity.images[0].normal === 'string') {
    return entity.images[0].normal;
  }
  const lv0 = Array.isArray(entity.levels) ? entity.levels[0] : null;
  const imgs = lv0 && lv0.images;
  if (imgs && typeof imgs === 'object') {
    if (typeof imgs.normal === 'string') return imgs.normal;
    const first = Object.values(imgs).find((v) => typeof v === 'string');
    if (first) return first;
  }
  return null;
}

async function main() {
  const all = (await listDataFiles())
    .filter((p) => p.startsWith('data/home/') || p.startsWith('data/builder/'))
    .sort();

  const entities = [];
  const BATCH = 20;
  for (let start = 0; start < all.length; start += BATCH) {
    const slice = all.slice(start, start + BATCH);
    const results = await Promise.all(
      slice.map(async (rel) => ({ rel, entity: await loadEntity(rel) }))
    );
    for (const { rel, entity } of results) {
      if (entity.dataId == null) continue;
      const levels = Array.isArray(entity.levels) ? entity.levels : [];
      const maxLevelByTh = new Array(DATA_MAX_TH).fill(0);
      const maxCountByTh = new Array(DATA_MAX_TH).fill(0);
      const costs = [];
      const times = [];
      const costResources = [];

      for (const lv of levels) {
        const L = Number(lv.level);
        const thReq = Number(lv.townHallRequired || lv.builderHallRequired || 1);
        for (let th = thReq; th <= DATA_MAX_TH; th++) {
          maxLevelByTh[th - 1] = Math.max(maxLevelByTh[th - 1], L);
        }
        costs[L] = Number(lv.buildCost || lv.researchCost || lv.upgradeCost || 0);
        times[L] = timeToSec(lv.buildTime || lv.researchTime || lv.upgradeTime);
        costResources[L] = resourceKey(
          lv.buildCostResource || lv.researchCostResource || lv.upgradeCostResource
        );
      }
      let last = 0;
      for (let th = 0; th < DATA_MAX_TH; th++) {
        if (maxLevelByTh[th] > 0) last = maxLevelByTh[th];
        else maxLevelByTh[th] = last;
      }

      const apt = entity.availablePerTownHall || entity.availablePerBuilderHall || [];
      for (const row of apt) {
        const th = Number(row.townHallLevel || row.builderHallLevel || 0);
        if (th < 1 || th > DATA_MAX_TH) continue;
        maxCountByTh[th - 1] =
          row.countAfterMerges != null ? Number(row.countAfterMerges) : Number(row.count || 0);
      }
      let lastC = 0;
      for (let th = 0; th < DATA_MAX_TH; th++) {
        if (apt.length) {
          const has = apt.some((r) => Number(r.townHallLevel || r.builderHallLevel) === th + 1);
          if (has) lastC = maxCountByTh[th];
          else maxCountByTh[th] = lastC;
        } else {
          maxCountByTh[th] = maxLevelByTh[th] > 0 ? 1 : 0;
        }
      }

      const name = entity.name || entity.id;
      entities.push({
        dataId: Number(entity.dataId),
        id: entity.id || null,
        name,
        nameIt: IT_NAMES[name] || name,
        village: entity.base === 'builder' ? 'builder' : 'home',
        category: categoryFrom(entity, rel),
        maxLevelByTh,
        maxCountByTh,
        costs,
        times,
        costResources,
        ...(iconPathOf(entity) ? { icon: iconPathOf(entity) } : {}),
      });
    }
    process.stdout.write(`\r${Math.min(start + BATCH, all.length)}/${all.length}`);
  }
  console.log('\nEntities:', entities.length);

  const version = `${DATA_MONTH}-coc-data-${VERSION_PKG}`;
  const byDataId = {};
  for (const e of entities) {
    if (!e.icon) continue;
    byDataId[e.dataId] = {
      path: e.icon,
      url: BASE + e.icon,
      name: e.name,
      id: e.id,
      category: e.category,
      village: e.village,
    };
  }
  const categoryIcons = {};
  for (const [cat, p] of Object.entries(CATEGORY_ICONS)) categoryIcons[cat] = { path: p, url: BASE + p };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, 'entities.json'),
    JSON.stringify({ version, globalMaxTh: DATA_MAX_TH, globalMaxBh: 10, entities })
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'icons.json'),
    JSON.stringify({ version, cdnBase: BASE, byDataId, categoryIcons })
  );
  fs.writeFileSync(path.join(OUT_DIR, 'VERSION'), `${version}\n`);
  console.log('Wrote', OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
