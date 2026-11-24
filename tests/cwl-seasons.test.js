/**
 * Stagioni CWL: doppia CWL di giugno 2026, etichette e "CWL precedente".
 * Esegui con: node --test tests/cwl-seasons.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const c = require('../telegram-bot/lib/cwl-seasons');

const KEYS = ['2026-11-02', '2026-10-02', '2026-09-02', '2026-08-02', '2026-07', '2026-06-16', '2026-06', '2026-05'];

test('giugno 2026 ha due CWL distinte', () => {
  assert.equal(c.cwlDoubleIndex('2026-06'), 1);
  assert.equal(c.cwlDoubleIndex('2026-06-16'), 2);
  assert.equal(c.cwlDoubleIndex('2026-07'), 0);
  assert.notEqual(c.cwlSeasonLabelIt('2026-06'), c.cwlSeasonLabelIt('2026-06-16'));
});

test('le chiavi CoC API "YYYY-MM-NN" non vengono mostrate come giorni', () => {
  assert.equal(c.cwlSeasonLabelIt('2026-11-02'), 'novembre 2026');
});

test('CWL precedente: la 2ª di giugno guarda la 1ª, luglio guarda la 2ª', () => {
  assert.equal(c.prevCwlSeasonKey('2026-06-16', KEYS), '2026-06');
  assert.equal(c.prevCwlSeasonKey('2026-06', KEYS), '2026-05');
  assert.equal(c.prevCwlSeasonKey('2026-07', KEYS), '2026-06-16');
  assert.equal(c.prevCwlSeasonKey('2026-11-02', KEYS), '2026-10-02');
  assert.equal(c.prevCwlSeasonKey('2026-05', KEYS), null);
});

test('2ª CWL di giugno segnata con statistiche non registrate', () => {
  assert.equal(c.cwlSeasonStatsUnavailable('2026-06-16'), true);
  assert.equal(c.cwlSeasonStatsUnavailable('2026-06'), false);
});

test('registro doppie CWL allineato tra sito (app.js) e bot', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  for (const [month, d] of Object.entries(c.DOUBLE_CWL_MONTHS)) {
    assert.ok(app.includes(`'${month}': {`), `app.js deve dichiarare il mese ${month} in DOUBLE_CWL_MONTHS`);
    assert.ok(app.includes(`second: '${d.second}'`), `app.js deve avere second: '${d.second}'`);
  }
});
