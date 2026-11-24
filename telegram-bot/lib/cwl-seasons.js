'use strict';

/**
 * Stagioni CWL: chiavi e doppie CWL nello stesso mese.
 *
 * Le chiavi stagione in cwl_history / cwl_seasons / cwl_wars possono essere:
 *  - "YYYY-MM"     → storico salvato prima del formato CoC API (fino a luglio 2026)
 *  - "YYYY-MM-NN"  → chiave CoC API del gruppo lega (es. "2026-11-02"); NON è un giorno da mostrare
 *
 * Mesi con DUE CWL (evento Supercell): ogni chiave è una CWL distinta e non va accorpata.
 * Deve restare allineato a DOUBLE_CWL_MONTHS in app.js e alla sezione "Stagioni CWL" di CLAUDE.md.
 */
const DOUBLE_CWL_MONTHS = {
  '2026-06': {
    first: '2026-06',
    second: '2026-06-16',
    note: 'Giugno 2026: CWL regolare (inizio mese) + CWL bonus (dal 15-16 giugno).',
    statsCopied: true, // le statistiche salvate per la 2ª CWL sono una copia della 1ª
  },
};

const MONTHS_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

/** 1 o 2 se la stagione è in un mese con doppia CWL, altrimenti 0. */
function cwlDoubleIndex(season) {
  const s = String(season || '');
  const d = DOUBLE_CWL_MONTHS[s.slice(0, 7)];
  if (!d) return 0;
  if (s === d.second) return 2;
  if (s === d.first) return 1;
  return 0;
}

function cwlSeasonStatsUnavailable(season) {
  const d = DOUBLE_CWL_MONTHS[String(season || '').slice(0, 7)];
  return !!(d && d.statsCopied && season === d.second);
}

/** "novembre 2026", "giugno 2026 · 1ª CWL", "giugno 2026 · 2ª CWL (bonus)". */
function cwlSeasonLabelIt(season) {
  const s = String(season || '').trim();
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return s || '—';
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return s;
  const idx = cwlDoubleIndex(s);
  const suffix = idx === 1 ? ' · 1ª CWL' : idx === 2 ? ' · 2ª CWL (bonus)' : '';
  return `${MONTHS_IT[mo - 1]} ${m[1]}${suffix}`;
}

/** Stagione CWL precedente presente nell'elenco (chiavi in qualsiasi ordine). */
function prevCwlSeasonKey(season, allKeys) {
  const s = String(season || '');
  const sorted = [...new Set((allKeys || []).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  return sorted.find((k) => k.localeCompare(s) < 0) || null;
}

module.exports = {
  DOUBLE_CWL_MONTHS,
  cwlDoubleIndex,
  cwlSeasonStatsUnavailable,
  cwlSeasonLabelIt,
  prevCwlSeasonKey,
};
