'use strict';

/**
 * Evento "Clash of Cards" (agosto-settembre 2026) — catalogo statico delle 60 carte.
 * Fonte: annuncio ufficiale Supercell + wiki Clash of Clans (dedotto, non un elenco
 * ufficiale pubblicato carta per carta). Le voci marcate `verified:false` sono le più
 * recenti aggiunte al gioco e potrebbero non corrispondere esattamente al set carte
 * reale: se un giocatore segnala un nome mancante/sbagliato, si corregge qui in un
 * punto solo (nessun'altra parte del codice dipende dai nomi, solo da `card_key`).
 *
 * Icone: stesso CDN già usato in app.js (coc.guide con fallback wikia per le unità
 * più recenti), duplicato qui perché questo file gira lato server (Node/CommonJS)
 * mentre le mappe equivalenti in app.js sono per il browser.
 */

const WIKIA_OVERRIDE = {
  meteor_golem: 'https://static.wikia.nocookie.net/clashofclans/images/6/66/Meteor_Golem_Info.png/revision/latest',
  super_valkyrie: 'https://static.wikia.nocookie.net/clashofclans/images/2/25/Super_Valkyrie_Info.png/revision/latest',
  ruin_witch: 'https://static.wikia.nocookie.net/clashofclans/images/f/f0/Ruin_Witch_Info.png/revision/latest',
};

const COC_GUIDE_SLUG_OVERRIDE = {
  baby_dragon: 'babydragon',
  lava_hound: 'lavahound',
  hog_rider: 'hog-rider',
  wall_breaker: 'wall-breaker',
  apprentice_warden: 'apprentice-warden',
  raged_barbarian: 'barbarian2',
  sneaky_archer: 'archer2',
  boxer_giant: 'giant2',
  beta_minion: 'minion2',
  bomber: 'bomber2',
  cannon_cart: 'moving-cannon',
  night_witch: 'dark-witch',
  drop_ship: 'drop-ship',
  super_p_e_k_k_a: 'pekka2',
  hog_glider: 'hog-glider',
  p_e_k_k_a: 'pekka',
};

function slugify(nameEn) {
  return nameEn.toLowerCase().replace(/['.()]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

function iconUrl(nameEn, wikiaKey) {
  if (wikiaKey && WIKIA_OVERRIDE[wikiaKey]) return WIKIA_OVERRIDE[wikiaKey];
  const baseSlug = slugify(nameEn).replace(/-/g, '_');
  const slug = COC_GUIDE_SLUG_OVERRIDE[baseSlug] || slugify(nameEn);
  return `https://coc.guide/static/imgs/troop/${slug}.png`;
}

function card(key, category, nameEn, nameIt, opts = {}) {
  return {
    key,
    category,
    name_en: nameEn,
    name_it: nameIt,
    icon_url: iconUrl(nameEn, opts.wikiaKey),
    verified: opts.verified !== false,
  };
}

const CARD_EVENT_CATALOG = [
  // ── Carte Elisir (19) ──────────────────────────────────────────────────
  card('elx_barbarian', 'elixir', 'Barbarian', 'Barbaro'),
  card('elx_archer', 'elixir', 'Archer', 'Arciera'),
  card('elx_giant', 'elixir', 'Giant', 'Gigante'),
  card('elx_goblin', 'elixir', 'Goblin', 'Goblin'),
  card('elx_wall_breaker', 'elixir', 'Wall Breaker', 'Spaccamuri'),
  card('elx_balloon', 'elixir', 'Balloon', 'Mongolfiera'),
  card('elx_wizard', 'elixir', 'Wizard', 'Mago'),
  card('elx_healer', 'elixir', 'Healer', 'Guaritrice'),
  card('elx_dragon', 'elixir', 'Dragon', 'Drago'),
  card('elx_pekka', 'elixir', 'P.E.K.K.A', 'P.E.K.K.A'),
  card('elx_baby_dragon', 'elixir', 'Baby Dragon', 'Piccolo Drago'),
  card('elx_miner', 'elixir', 'Miner', 'Minatore'),
  card('elx_electro_dragon', 'elixir', 'Electro Dragon', 'Drago Elettro'),
  card('elx_yeti', 'elixir', 'Yeti', 'Yeti'),
  card('elx_dragon_rider', 'elixir', 'Dragon Rider', 'Cavalcatore di Draghi'),
  card('elx_electro_titan', 'elixir', 'Electro Titan', 'Titano Elettro'),
  card('elx_root_rider', 'elixir', 'Root Rider', 'Cavalcatore di Radici'),
  card('elx_thrower', 'elixir', 'Thrower', 'Lanciatore'),
  card('elx_meteor_golem', 'elixir', 'Meteor Golem', 'Golem Meteorite', { wikiaKey: 'meteor_golem' }),

  // ── Carte Elisir Nero (13) ─────────────────────────────────────────────
  card('dke_minion', 'dark_elixir', 'Minion', 'Servitore'),
  card('dke_hog_rider', 'dark_elixir', 'Hog Rider', 'Cavalcatore di Cinghiale'),
  card('dke_valkyrie', 'dark_elixir', 'Valkyrie', 'Valchiria'),
  card('dke_golem', 'dark_elixir', 'Golem', 'Golem'),
  card('dke_witch', 'dark_elixir', 'Witch', 'Strega'),
  card('dke_lava_hound', 'dark_elixir', 'Lava Hound', 'Segugio di Lava'),
  card('dke_bowler', 'dark_elixir', 'Bowler', 'Bocciatore'),
  card('dke_ice_golem', 'dark_elixir', 'Ice Golem', 'Golem di Ghiaccio'),
  card('dke_headhunter', 'dark_elixir', 'Headhunter', 'Cacciatore di Teste'),
  card('dke_apprentice_warden', 'dark_elixir', 'Apprentice Warden', 'Custode Apprendista'),
  card('dke_druid', 'dark_elixir', 'Druid', 'Druido'),
  card('dke_furnace', 'dark_elixir', 'Furnace', 'Fornace'),
  card('dke_ruin_witch', 'dark_elixir', 'Ruin Witch', 'Strega delle Rovine', { wikiaKey: 'ruin_witch', verified: false }),

  // ── Carte Base Costruttore (11) ────────────────────────────────────────
  card('bb_raged_barbarian', 'builder_base', 'Raged Barbarian', 'Barbaro Furioso'),
  card('bb_sneaky_archer', 'builder_base', 'Sneaky Archer', 'Arciera Furtiva'),
  card('bb_boxer_giant', 'builder_base', 'Boxer Giant', 'Gigante Pugile'),
  card('bb_beta_minion', 'builder_base', 'Beta Minion', 'Beta Servitore'),
  card('bb_bomber', 'builder_base', 'Bomber', 'Bombarolo'),
  card('bb_baby_dragon', 'builder_base', 'Baby Dragon', 'Piccolo Drago'),
  card('bb_cannon_cart', 'builder_base', 'Cannon Cart', 'Carrello Cannone'),
  card('bb_night_witch', 'builder_base', 'Night Witch', 'Strega Notturna'),
  card('bb_drop_ship', 'builder_base', 'Drop Ship', 'Nave Lanciatore'),
  card('bb_super_pekka', 'builder_base', 'Super P.E.K.K.A', 'Super P.E.K.K.A'),
  card('bb_hog_glider', 'builder_base', 'Hog Glider', 'Aliante Cinghiale'),

  // ── Super Truppe (17) ──────────────────────────────────────────────────
  card('st_super_barbarian', 'super_troop', 'Super Barbarian', 'Super Barbaro'),
  card('st_super_archer', 'super_troop', 'Super Archer', 'Super Arciera'),
  card('st_super_giant', 'super_troop', 'Super Giant', 'Super Gigante'),
  card('st_sneaky_goblin', 'super_troop', 'Sneaky Goblin', 'Goblin Furtivo'),
  card('st_super_wall_breaker', 'super_troop', 'Super Wall Breaker', 'Super Spaccamuri'),
  card('st_rocket_balloon', 'super_troop', 'Rocket Balloon', 'Mongolfiera Razzo'),
  card('st_super_wizard', 'super_troop', 'Super Wizard', 'Super Mago'),
  card('st_super_dragon', 'super_troop', 'Super Dragon', 'Super Drago'),
  card('st_inferno_dragon', 'super_troop', 'Inferno Dragon', 'Drago Inferno'),
  card('st_super_miner', 'super_troop', 'Super Miner', 'Super Minatore'),
  card('st_super_yeti', 'super_troop', 'Super Yeti', 'Super Yeti'),
  card('st_super_minion', 'super_troop', 'Super Minion', 'Super Servitore'),
  card('st_super_hog_rider', 'super_troop', 'Super Hog Rider', 'Super Cavalcatore'),
  card('st_super_valkyrie', 'super_troop', 'Super Valkyrie', 'Super Valchiria', { wikiaKey: 'super_valkyrie' }),
  card('st_super_witch', 'super_troop', 'Super Witch', 'Super Strega'),
  card('st_ice_hound', 'super_troop', 'Ice Hound', 'Segugio di Ghiaccio'),
  card('st_super_bowler', 'super_troop', 'Super Bowler', 'Super Bocciatore'),
];

const CATEGORY_ORDER = ['elixir', 'dark_elixir', 'builder_base', 'super_troop'];
const CATEGORY_LABEL_IT = {
  elixir: 'Carte Elisir',
  dark_elixir: 'Carte Elisir Nero',
  builder_base: 'Carte Base Costruttore',
  super_troop: 'Carte Super Truppe',
};

const CARD_BY_KEY = new Map(CARD_EVENT_CATALOG.map((c) => [c.key, c]));
const CATEGORY_TOTALS = CATEGORY_ORDER.reduce((acc, cat) => {
  acc[cat] = CARD_EVENT_CATALOG.filter((c) => c.category === cat).length;
  return acc;
}, {});

module.exports = {
  CARD_EVENT_CATALOG,
  CATEGORY_ORDER,
  CATEGORY_LABEL_IT,
  CARD_BY_KEY,
  CATEGORY_TOTALS,
  TOTAL_CARDS: CARD_EVENT_CATALOG.length,
};
