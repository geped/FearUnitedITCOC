'use strict';

/** Stagione YYYY-MM precedente (mese di calendario). */
function prevSeasonYM(season) {
  const [ys, ms] = String(season).split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

function computeMeritFromRow(row) {
  const req = Math.max(Number(row.attacks_required) || 0, 1);
  const made = Number(row.attacks_made) || 0;
  const stars = Number(row.stars) || 0;
  const destr = Number(row.destruction) || 0;
  const avgD = made > 0 ? destr / made : 0;
  const raw = (stars / req) * 40 + avgD * 0.2 + (made / req) * 20;
  return Math.round(raw * 10) / 10;
}

function meritForRow(row) {
  const bs = Number(row.bonus_score);
  if (Number.isFinite(bs) && bs > 0) return Math.round(bs * 10) / 10;
  return computeMeritFromRow(row);
}

/** TH sotto la mediana del roster → piccolo boost (proxy “ha performato bene col proprio TH”). */
function thAdjustMerit(merit, thLevel, medianTh, enabled) {
  if (!enabled) return merit;
  const th = Number(thLevel) || 0;
  if (!medianTh || medianTh <= 0) return merit;
  const delta = medianTh - th;
  const factor = 1 + Math.max(-0.12, Math.min(0.12, delta * 0.012));
  return Math.round(merit * factor * 10) / 10;
}

function medianThFromMap(thMap) {
  const vals = [...thMap.values()].map((n) => Number(n) || 0).filter((n) => n > 0).sort((a, b) => a - b);
  if (!vals.length) return 0;
  return vals[Math.floor(vals.length / 2)];
}

const EXCL_PREV = 1;
const REQUIRE_PART = 2;
const REQUIRE_FULL_ATK = 4;
const TH_WEIGHT = 8;

/**
 * @param {object} opts
 * @param {string} opts.clanTag
 * @param {string} opts.season
 * @param {number} opts.maxSlots
 * @param {number} opts.mask
 * @param {object[]} opts.historyRows - righe cwl_history stagione corrente
 * @param {Set<string>} opts.prevSeasonBonusNames
 * @param {Map<string, number>} opts.thByNameLower
 */
function runBonusAssistant({ clanTag, season, maxSlots, mask, historyRows, prevSeasonBonusNames, thByNameLower }) {
  const useTh = (mask & TH_WEIGHT) !== 0;
  const medianTh = useTh ? medianThFromMap(thByNameLower) : 0;

  let pool = (historyRows || []).filter((r) => r.still_in_clan !== false && !r.is_secondary);

  pool = pool.map((row) => {
    const name = String(row.player_name || '');
    const merit = meritForRow(row);
    const th = thByNameLower.get(name.toLowerCase().trim()) || 0;
    const meritAdj = thAdjustMerit(merit, th, medianTh, useTh);
    return { row, player_name: name, merit, meritAdj, th };
  });

  const passesFilter = (p) => {
    if ((mask & REQUIRE_PART) && !p.row.participated) return false;
    if ((mask & REQUIRE_FULL_ATK) && (Number(p.row.attacks_required) || 0) > 0) {
      const made = Number(p.row.attacks_made) || 0;
      const req = Number(p.row.attacks_required) || 0;
      if (made < req) return false;
    }
    if ((mask & EXCL_PREV) && prevSeasonBonusNames.has(p.player_name)) return false;
    return true;
  };

  const sortMerit = (a, b) =>
    b.meritAdj - a.meritAdj || String(a.player_name).localeCompare(String(b.player_name), 'it');

  const filtered = pool.filter(passesFilter).map((p) => ({ ...p, eligible: true })).sort(sortMerit);
  const excluded = pool
    .filter((p) => !passesFilter(p))
    .map((p) => ({ ...p, eligible: false }))
    .sort(sortMerit);
  /** Prima idonei al preset, poi esclusi (stesso merito) — in conferma il capo può attivare anche i secondi. */
  const candidates = [...filtered, ...excluded];

  const slots = Math.max(1, Math.min(9, Number(maxSlots) || 1));
  const initial = [];
  for (const p of filtered) {
    if (initial.length >= slots) break;
    initial.push(p.player_name);
  }
  for (const p of excluded) {
    if (initial.length >= slots) break;
    initial.push(p.player_name);
  }
  const selected = new Set(initial);

  return {
    candidates,
    selected,
    maxSlots: slots,
    medianTh,
    mask,
    clanTag,
    season,
    flags: { EXCL_PREV, REQUIRE_PART, REQUIRE_FULL_ATK, TH_WEIGHT },
  };
}

function maskLabelIt(mask) {
  const parts = [];
  if (mask & EXCL_PREV) parts.push('no bonus stagione prec.');
  if (mask & REQUIRE_PART) parts.push('solo partecipanti');
  if (mask & REQUIRE_FULL_ATK) parts.push('attacchi completi');
  if (mask & TH_WEIGHT) parts.push('peso TH');
  return parts.length ? parts.join(', ') : 'solo roster attivo';
}

module.exports = {
  prevSeasonYM,
  computeMeritFromRow,
  meritForRow,
  runBonusAssistant,
  maskLabelIt,
  EXCL_PREV,
  REQUIRE_PART,
  REQUIRE_FULL_ATK,
  TH_WEIGHT,
};
