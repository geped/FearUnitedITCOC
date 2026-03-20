/**
 * Test logica purge ex-player — verifica calcolo scadenza 6 mesi
 * Esegui con: node --test tests/purge-logic.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Logica estratta da api/purge-ex-players.js
function shouldPurge(lastActiveSeason, retentionMonths, referenceDateStr) {
    if (!lastActiveSeason) return false;
    const [y, m] = lastActiveSeason.split('-').map(Number);
    const lastDate = new Date(y, m - 1, 1);
    const cutoff = new Date(referenceDateStr);
    cutoff.setMonth(cutoff.getMonth() - retentionMonths);
    return lastDate < cutoff;
}

const RETENTION = 6;

test('giocatore inattivo da 7 mesi → deve essere purgato', () => {
    const result = shouldPurge('2025-07', RETENTION, '2026-03-01');
    assert.equal(result, true, 'stagione 2025-07 con ref 2026-03 deve essere purgata');
});

test('giocatore inattivo da esattamente 6 mesi → purgato (il cutoff include la data esatta)', () => {
    const result = shouldPurge('2025-09', RETENTION, '2026-03-01');
    assert.equal(result, true, 'stagione al limite esatto viene purgata');
});

test('giocatore inattivo da 5 mesi → non purgato', () => {
    const result = shouldPurge('2025-10', RETENTION, '2026-03-01');
    assert.equal(result, false, 'stagione recente non deve essere purgata');
});

test('giocatore con stagione attiva questo mese → non purgato', () => {
    const result = shouldPurge('2026-03', RETENTION, '2026-03-20');
    assert.equal(result, false, 'stagione corrente non deve essere purgata');
});

test('stagione null/undefined → non purgato (dati mancanti)', () => {
    assert.equal(shouldPurge(null, RETENTION, '2026-03-01'), false);
    assert.equal(shouldPurge(undefined, RETENTION, '2026-03-01'), false);
});
