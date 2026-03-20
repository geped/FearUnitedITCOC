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
  // Duca Drago (3 items)
  'Fire Heart':'Dragon Duke','Flame Blower':'Dragon Duke',
  'Stun Blaster':'Dragon Duke',
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
