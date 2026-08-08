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

// URL verificati (HTTP 200) sul wiki ufficiale Clash of Clans Fandom, ago 2026.
// coc.guide non copre molti di questi slug (equipment/pet inesistenti sul loro CDN,
// oppure slug/nome cambiato) quindi per queste carte si usa direttamente il wiki.
const WIKIA_OVERRIDE = {
  meteor_golem: 'https://static.wikia.nocookie.net/clashofclans/images/2/21/Meteor_Golem_info.png/revision/latest',
  super_valkyrie: 'https://static.wikia.nocookie.net/clashofclans/images/2/25/Super_Valkyrie_Info.png/revision/latest',
  ruin_witch: 'https://static.wikia.nocookie.net/clashofclans/images/2/23/Ruin_Witch_info.png/revision/latest',
  minion: 'https://static.wikia.nocookie.net/clashofclans/images/a/a4/Minion_info.png/revision/latest',
  hog_rider: 'https://static.wikia.nocookie.net/clashofclans/images/5/54/Hog_Rider_info.png/revision/latest',
  valkyrie: 'https://static.wikia.nocookie.net/clashofclans/images/7/7d/Valkyrie_info.png/revision/latest',
  witch: 'https://static.wikia.nocookie.net/clashofclans/images/4/4a/Witch_info.png/revision/latest',
  lava_hound: 'https://static.wikia.nocookie.net/clashofclans/images/0/0a/Lava_Hound_info.png/revision/latest',
  druid: 'https://static.wikia.nocookie.net/clashofclans/images/9/9a/Druid_info.png/revision/latest',
  furnace: 'https://static.wikia.nocookie.net/clashofclans/images/2/23/Furnace_info.png/revision/latest',
  beta_minion: 'https://static.wikia.nocookie.net/clashofclans/images/6/63/Beta_Minion_info.png/revision/latest',
  drop_ship: 'https://static.wikia.nocookie.net/clashofclans/images/1/17/Drop_Ship_info.png/revision/latest',
  power_pekka: 'https://static.wikia.nocookie.net/clashofclans/images/1/1f/Power_P.E.K.K.A_info.png/revision/latest',
  super_barbarian: 'https://static.wikia.nocookie.net/clashofclans/images/1/1c/Super_Barbarian_info.png/revision/latest',
  super_archer: 'https://static.wikia.nocookie.net/clashofclans/images/e/ea/Super_Archer_info.png/revision/latest',
  super_giant: 'https://static.wikia.nocookie.net/clashofclans/images/d/d9/Super_Giant_info.png/revision/latest',
  sneaky_goblin: 'https://static.wikia.nocookie.net/clashofclans/images/f/ff/Sneaky_Goblin_info.png/revision/latest',
  super_wall_breaker: 'https://static.wikia.nocookie.net/clashofclans/images/b/b1/Super_Wall_Breaker_info.png/revision/latest',
  rocket_balloon: 'https://static.wikia.nocookie.net/clashofclans/images/9/9e/Rocket_Balloon_info.png/revision/latest',
  inferno_dragon: 'https://static.wikia.nocookie.net/clashofclans/images/d/de/Inferno_Dragon_info.png/revision/latest',
  super_yeti: 'https://static.wikia.nocookie.net/clashofclans/images/1/19/Super_Yeti_info.png/revision/latest',
  super_witch: 'https://static.wikia.nocookie.net/clashofclans/images/7/7c/Super_Witch_info.png/revision/latest',
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
  card('dke_minion', 'dark_elixir', 'Minion', 'Servitore', { wikiaKey: 'minion' }),
  card('dke_hog_rider', 'dark_elixir', 'Hog Rider', 'Cavalcatore di Cinghiale', { wikiaKey: 'hog_rider' }),
  card('dke_valkyrie', 'dark_elixir', 'Valkyrie', 'Valchiria', { wikiaKey: 'valkyrie' }),
  card('dke_golem', 'dark_elixir', 'Golem', 'Golem'),
  card('dke_witch', 'dark_elixir', 'Witch', 'Strega', { wikiaKey: 'witch' }),
  card('dke_lava_hound', 'dark_elixir', 'Lava Hound', 'Segugio di Lava', { wikiaKey: 'lava_hound' }),
  card('dke_bowler', 'dark_elixir', 'Bowler', 'Bocciatore'),
  card('dke_ice_golem', 'dark_elixir', 'Ice Golem', 'Golem di Ghiaccio'),
  card('dke_headhunter', 'dark_elixir', 'Headhunter', 'Cacciatore di Teste'),
  card('dke_apprentice_warden', 'dark_elixir', 'Apprentice Warden', 'Custode Apprendista'),
  card('dke_druid', 'dark_elixir', 'Druid', 'Druido', { wikiaKey: 'druid' }),
  card('dke_furnace', 'dark_elixir', 'Furnace', 'Fornace', { wikiaKey: 'furnace' }),
  card('dke_ruin_witch', 'dark_elixir', 'Ruin Witch', 'Strega delle Rovine', { wikiaKey: 'ruin_witch', verified: false }),

  // ── Carte Base Costruttore (11) ────────────────────────────────────────
  card('bb_raged_barbarian', 'builder_base', 'Raged Barbarian', 'Barbaro Furioso'),
  card('bb_sneaky_archer', 'builder_base', 'Sneaky Archer', 'Arciera Furtiva'),
  card('bb_boxer_giant', 'builder_base', 'Boxer Giant', 'Gigante Pugile'),
  card('bb_beta_minion', 'builder_base', 'Beta Minion', 'Beta Servitore', { wikiaKey: 'beta_minion' }),
  card('bb_bomber', 'builder_base', 'Bomber', 'Bombarolo'),
  card('bb_baby_dragon', 'builder_base', 'Baby Dragon', 'Piccolo Drago'),
  card('bb_cannon_cart', 'builder_base', 'Cannon Cart', 'Carrello Cannone'),
  card('bb_night_witch', 'builder_base', 'Night Witch', 'Strega Notturna'),
  card('bb_drop_ship', 'builder_base', 'Drop Ship', 'Nave Lanciatore', { wikiaKey: 'drop_ship' }),
  // Rinominata in game da "Super P.E.K.K.A" a "Power P.E.K.K.A" (l'API CoC restituisce
  // ora questo nome per la truppa builder base).
  card('bb_super_pekka', 'builder_base', 'Power P.E.K.K.A', 'Power P.E.K.K.A', { wikiaKey: 'power_pekka' }),
  card('bb_hog_glider', 'builder_base', 'Hog Glider', 'Aliante Cinghiale'),

  // ── Super Truppe (17) ──────────────────────────────────────────────────
  card('st_super_barbarian', 'super_troop', 'Super Barbarian', 'Super Barbaro', { wikiaKey: 'super_barbarian' }),
  card('st_super_archer', 'super_troop', 'Super Archer', 'Super Arciera', { wikiaKey: 'super_archer' }),
  card('st_super_giant', 'super_troop', 'Super Giant', 'Super Gigante', { wikiaKey: 'super_giant' }),
  card('st_sneaky_goblin', 'super_troop', 'Sneaky Goblin', 'Goblin Furtivo', { wikiaKey: 'sneaky_goblin' }),
  card('st_super_wall_breaker', 'super_troop', 'Super Wall Breaker', 'Super Spaccamuri', { wikiaKey: 'super_wall_breaker' }),
  card('st_rocket_balloon', 'super_troop', 'Rocket Balloon', 'Mongolfiera Razzo', { wikiaKey: 'rocket_balloon' }),
  card('st_super_wizard', 'super_troop', 'Super Wizard', 'Super Mago'),
  card('st_super_dragon', 'super_troop', 'Super Dragon', 'Super Drago'),
  card('st_inferno_dragon', 'super_troop', 'Inferno Dragon', 'Drago Inferno', { wikiaKey: 'inferno_dragon' }),
  card('st_super_miner', 'super_troop', 'Super Miner', 'Super Minatore'),
  card('st_super_yeti', 'super_troop', 'Super Yeti', 'Super Yeti', { wikiaKey: 'super_yeti' }),
  card('st_super_minion', 'super_troop', 'Super Minion', 'Super Servitore'),
  card('st_super_hog_rider', 'super_troop', 'Super Hog Rider', 'Super Cavalcatore'),
  card('st_super_valkyrie', 'super_troop', 'Super Valkyrie', 'Super Valchiria', { wikiaKey: 'super_valkyrie' }),
  card('st_super_witch', 'super_troop', 'Super Witch', 'Super Strega', { wikiaKey: 'super_witch' }),
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
