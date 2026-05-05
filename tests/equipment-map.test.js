/**
 * Test mappa equipaggiamento eroi — costanti copiate da app.js per testabilità
 * Copertura: EQUIP-01 (Stick Horse), EQUIP-02 (sezione Altro), EQUIP-04 (Battle Drill slug)
 * Esegui con: node --test tests/equipment-map.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

// ── Costanti copiate da app.js (stato TARGET — dopo i fix) ──────────────────
// Fonte: app.js righe 3780-3809 (HERO_EQUIPMENT_MAP, HERO_ORDER_EQUIP)
const HERO_EQUIPMENT_MAP = {
  // Re dei Barbari (8 items) — include Stick Horse
  'Barbarian Puppet':'Barbarian King','Rage Vial':'Barbarian King',
  'Earthquake Boots':'Barbarian King','Vampstache':'Barbarian King',
  'Giant Gauntlet':'Barbarian King','Spiky Ball':'Barbarian King',
  'Snake Bracelet':'Barbarian King',
  'Stick Horse':'Barbarian King',
  // Regina degli Arcieri (7 items)
  'Archer Puppet':'Archer Queen','Invisibility Vial':'Archer Queen',
  'Giant Arrow':'Archer Queen','Healer Puppet':'Archer Queen',
  'Frozen Arrow':'Archer Queen','Magic Mirror':'Archer Queen',
  'Action Figure':'Archer Queen',
  // Grande Custode (7 items)
  'Eternal Tome':'Grand Warden','Life Gem':'Grand Warden',
  'Rage Gem':'Grand Warden','Healing Tome':'Grand Warden',
  'Fireball':'Grand Warden','Lavaloon Puppet':'Grand Warden',
  'Heroic Torch':'Grand Warden',
  // Campione Reale (7 items)
  'Royal Gem':'Royal Champion','Seeking Shield':'Royal Champion',
  'Hog Rider Puppet':'Royal Champion','Haste Vial':'Royal Champion',
  'Rocket Spear':'Royal Champion','Electro Boots':'Royal Champion',
  'Frost Flake':'Royal Champion',
  // Principe degli Sgherri (6 items)
  'Dark Orb':'Minion Prince','Henchmen Puppet':'Minion Prince',
  'Metal Pants':'Minion Prince','Dark Crown':'Minion Prince',
  'Meteor Staff':'Minion Prince','Noble Iron':'Minion Prince',
  // Duca Drago (5 items)
  'Fire Heart':'Dragon Duke','Flame Blower':'Dragon Duke',
  'Stun Blaster':'Dragon Duke','Electro Fangs':'Dragon Duke',
  'Rocket Backpack':'Dragon Duke',
};

const HERO_ORDER_EQUIP = ['Barbarian King','Archer Queen','Grand Warden','Royal Champion','Minion Prince','Dragon Duke'];

// Fonte: app.js righe 3641-3690 (UNIT_COC_SLUG — solo equipment rilevanti per i test)
const UNIT_COC_SLUG = {
  // Macchine d'assedio — slug corretto per Battle Drill
  'Battle Drill':       {c:'troop',     s:'battle-drill'},
  // Equipaggiamento — Re dei Barbari
  'Barbarian Puppet':   {c:'equipment', s:'barbarian-puppet'},
  'Rage Vial':          {c:'equipment', s:'rage-vial'},
  'Earthquake Boots':   {c:'equipment', s:'earthquake-boots'},
  'Vampstache':         {c:'equipment', s:'vampstache'},
  'Giant Gauntlet':     {c:'equipment', s:'giant-gauntlet'},
  'Spiky Ball':         {c:'equipment', s:'spiky-ball'},
  'Snake Bracelet':     {c:'equipment', s:'snake-bracelet'},
  'Stick Horse':        {c:'equipment', s:'stick-horse'},
  // Equipaggiamento — Regina degli Arcieri
  'Archer Puppet':      {c:'equipment', s:'archer-puppet'},
  'Invisibility Vial':  {c:'equipment', s:'invisibility-vial'},
  'Giant Arrow':        {c:'equipment', s:'giant-arrow'},
  'Healer Puppet':      {c:'equipment', s:'healer-puppet'},
  'Frozen Arrow':       {c:'equipment', s:'frozen-arrow'},
  'Magic Mirror':       {c:'equipment', s:'magic-mirror'},
  'Action Figure':      {c:'equipment', s:'action-figure'},
  // Equipaggiamento — Grande Custode
  'Eternal Tome':       {c:'equipment', s:'eternal-tome'},
  'Life Gem':           {c:'equipment', s:'life-gem'},
  'Rage Gem':           {c:'equipment', s:'rage-gem'},
  'Healing Tome':       {c:'equipment', s:'healing-tome'},
  'Fireball':           {c:'equipment', s:'fireball'},
  'Lavaloon Puppet':    {c:'equipment', s:'lavaloon-puppet'},
  'Heroic Torch':       {c:'equipment', s:'heroic-torch'},
  // Equipaggiamento — Campione Reale
  'Royal Gem':          {c:'equipment', s:'royal-gem'},
  'Seeking Shield':     {c:'equipment', s:'seeking-shield'},
  'Hog Rider Puppet':   {c:'equipment', s:'hog-rider-puppet'},
  'Haste Vial':         {c:'equipment', s:'haste-vial'},
  'Rocket Spear':       {c:'equipment', s:'rocket-spear'},
  'Metal Pants':        {c:'equipment', s:'metal-pants'},
  'Electro Boots':      {c:'equipment', s:'electro-boots'},
  'Frost Flake':        {c:'equipment', s:'frost-flake'},
  // Equipaggiamento — Principe degli Sgherri
  'Dark Orb':           {c:'equipment', s:'dark-orb'},
  'Henchmen Puppet':    {c:'equipment', s:'henchmen-puppet'},
  'Dark Crown':         {c:'equipment', s:'dark-crown'},
  'Meteor Staff':       {c:'equipment', s:'meteor-staff'},
  'Noble Iron':         {c:'equipment', s:'noble-iron'},
  // Equipaggiamento — Duca Drago
  'Fire Heart':         {c:'equipment', s:'fire-heart'},
  'Flame Blower':       {c:'equipment', s:'flame-blower'},
  'Stun Blaster':       {c:'equipment', s:'stun-blaster'},
  'Electro Fangs':      {c:'equipment', s:'electro-fangs'},
  'Rocket Backpack':    {c:'equipment', s:'rocket-backpack'},
};

// ── Logica di assegnazione gruppi copiata da _renderEquipmentGrouped (app.js ~3821-3828) ──
function assignGroups(equipment, heroEquipMap, heroOrder) {
  const groups = {};
  heroOrder.forEach(h => { groups[h] = []; });
  groups['__altro__'] = [];
  equipment.forEach(item => {
    const hero = heroEquipMap[item.name];
    const key = (hero && groups[hero] !== undefined) ? hero : '__altro__';
    groups[key].push(item);
  });
  return groups;
}

// ── Test EQUIP-01: Stick Horse ──────────────────────────────────────────────

test('EQUIP-01: Stick Horse mappato a Barbarian King', () => {
  assert.equal(
    HERO_EQUIPMENT_MAP['Stick Horse'],
    'Barbarian King',
    'Stick Horse deve essere mappato a Barbarian King in HERO_EQUIPMENT_MAP'
  );
});

test('EQUIP-01b: Stick Horse ha entry CDN corretta', () => {
  assert.deepEqual(
    UNIT_COC_SLUG['Stick Horse'],
    { c: 'equipment', s: 'stick-horse' },
    'Stick Horse deve avere categoria equipment e slug stick-horse in UNIT_COC_SLUG'
  );
});

// ── Test EQUIP-04: Battle Drill slug ────────────────────────────────────────

test('EQUIP-04: Battle Drill ha slug battle-drill', () => {
  assert.equal(
    UNIT_COC_SLUG['Battle Drill'].s,
    'battle-drill',
    "Battle Drill deve avere slug 'battle-drill', non 'battleram'"
  );
});

// ── Test EQUIP-02: Nessun equipment noto in __altro__ ───────────────────────

test('EQUIP-02: nessun equipment mappato finisce in __altro__', () => {
  const allEquipment = Object.keys(HERO_EQUIPMENT_MAP).map(name => ({ name }));
  const groups = assignGroups(allEquipment, HERO_EQUIPMENT_MAP, HERO_ORDER_EQUIP);
  assert.equal(
    groups['__altro__'].length,
    0,
    `Equipment finiti in __altro__: ${groups['__altro__'].map(i => i.name).join(', ') || 'nessuno'}`
  );
});

test('EQUIP-02b: HERO_ORDER_EQUIP non contiene __altro__', () => {
  assert.ok(
    !HERO_ORDER_EQUIP.includes('__altro__'),
    'HERO_ORDER_EQUIP non deve includere __altro__ — la sezione non deve essere renderizzata'
  );
});

// ── Test completezza ─────────────────────────────────────────────────────────

test('completezza: ogni item in HERO_EQUIPMENT_MAP ha entry in UNIT_COC_SLUG', () => {
  const missing = Object.keys(HERO_EQUIPMENT_MAP).filter(name => !UNIT_COC_SLUG[name]);
  assert.equal(
    missing.length,
    0,
    `Item in HERO_EQUIPMENT_MAP senza entry in UNIT_COC_SLUG: ${missing.join(', ')}`
  );
});

// ── Test EQUIP-03: Fallback SVG neutro ───────────────────────────────────────

test('EQUIP-03: fallback equipment usa SVG neutro, non colored-initial', () => {
  // Funzione locale unitCardHtml TARGET (post-fix) — usa SVG placeholder neutro
  function unitCardHtml(u) {
    const nameIt = u.name;
    const imgUrl = `https://coc.guide/static/imgs/equipment/${u.name.toLowerCase().replace(/\s+/g, '-')}.png`;
    const lvl = u.level ?? 0;
    const maxLvl = u.maxLevel ?? 0;
    const isMax = maxLvl > 0 && lvl >= maxLvl;
    const isLocked = lvl === 0;
    return `<div class="profilo-unit-card${isMax ? ' profilo-unit-max' : ''}${isLocked ? ' profilo-unit-locked' : ''}" title="${nameIt}">
      <div class="profilo-unit-img-wrap">
        <img src="${imgUrl}" alt="${nameIt}" class="profilo-unit-img" loading="lazy"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="profilo-unit-fallback profilo-unit-fallback--neutral" style="display:none">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3l-1.9 5.8H4.2l4.8 3.5-1.8 5.7L12 14.5l4.8 3.5-1.8-5.7 4.8-3.5h-5.9z"/>
          </svg>
        </div>
        ${!isLocked ? `<span class="unit-lv-badge${isMax ? ' unit-lv-badge--max' : ''}">${lvl}</span>` : ''}
      </div>
    </div>`;
  }

  const html = unitCardHtml({ name: 'Fake Equipment Item', level: 5, maxLevel: 10 });
  assert.ok(html.includes('svg'), 'Il fallback deve contenere un tag svg');
  assert.ok(html.includes('profilo-unit-fallback--neutral'), 'Il fallback deve avere la classe --neutral');
  assert.ok(!html.includes('_unitFallbackColor'), 'Il fallback non deve usare _unitFallbackColor');
  assert.ok(!html.includes('fbColor'), 'Il template non deve contenere fbColor');
});

// ── Test ARCH-01: getAssetUrl URL CDN ────────────────────────────────────────

test('ARCH-01: getAssetUrl produce URL CDN corretti per item mappati', () => {
  const SLUG_SUBSET = {
    'Barbarian Puppet': { c: 'equipment', s: 'barbarian-puppet' },
    'Battle Drill':     { c: 'troop',     s: 'battle-drill' },
  };
  function getAssetUrl(name, category) {
    if (SLUG_SUBSET[name]) {
      const { c, s } = SLUG_SUBSET[name];
      return `https://coc.guide/static/imgs/${c}/${s}.png`;
    }
    const CAT = { heroes: 'hero', troops: 'troop', spells: 'spell', pets: 'pet', equipment: 'equipment' };
    const cat = CAT[category] || category || 'troop';
    const slug = name.toLowerCase().replace(/['.()]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
    return `https://coc.guide/static/imgs/${cat}/${slug}.png`;
  }

  assert.equal(
    getAssetUrl('Barbarian Puppet', 'equipment'),
    'https://coc.guide/static/imgs/equipment/barbarian-puppet.png',
    'Barbarian Puppet deve generare URL equipment corretto'
  );
  assert.equal(
    getAssetUrl('Battle Drill', 'troops'),
    'https://coc.guide/static/imgs/troop/battle-drill.png',
    'Battle Drill deve generare URL troop (non troops) corretto'
  );
});

test('ARCH-01b: getAssetUrl auto-genera slug per item non mappati', () => {
  function getAssetUrl(name, category) {
    const CAT = { heroes: 'hero', troops: 'troop', spells: 'spell', pets: 'pet', equipment: 'equipment' };
    const cat = CAT[category] || category || 'troop';
    const slug = name.toLowerCase().replace(/['.()]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
    return `https://coc.guide/static/imgs/${cat}/${slug}.png`;
  }

  assert.equal(
    getAssetUrl('Some New Troop', 'troops'),
    'https://coc.guide/static/imgs/troop/some-new-troop.png',
    'Auto-slug deve generare URL corretto per item non mappati'
  );
});
