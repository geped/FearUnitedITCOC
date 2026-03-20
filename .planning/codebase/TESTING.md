# Testing Patterns

**Analysis Date:** 2026-03-20 (aggiornato post-fix criticità)

---

## Test Framework

**Runner:** Node.js built-in `node:test` (nessuna dipendenza esterna)
- Configurato in `package.json` → `"test": "node --test tests/*.test.js"`
- Nessun `jest.config.*` o `vitest.config.*` — volutamente zero-config

**Assertion Library:** `node:assert/strict` (built-in)

**Run Commands:**
```bash
npm test
# oppure direttamente:
node --test tests/*.test.js
```

---

## Test File Organization

```
tests/
  bonus-calculator.test.js   # 6 test per calculateMerit()
  purge-logic.test.js        # 5 test per shouldPurge()
```

**Totale:** 11 test, tutti ✓ passati.

---

## Test esistenti

### `tests/bonus-calculator.test.js` — Formula merit CWL

Testa la funzione `calculateMerit(stats, history)` estratta da `api/generate-bonuses.js`.

Formula testata:
```js
merit = (stars / req) * 40 + (destruction / made) * 0.2 + (made / req) * 20
```

| Test | Input | Atteso |
|------|-------|--------|
| Score massimo | 7att, 21★, 700% | 160 |
| Anti-duplicati | `received_last_month: true` | 0 |
| Nessun attacco | 0/7, 0★, 0% | 0 |
| Partecipazione parziale penalizza | 3/7 vs 7/7 attacchi | parziale < pieno |
| Divisione per zero su `attacksRequired=0` | — | non lancia eccezioni |
| Arrotondamento | score con decimali | max 1 decimale |

### `tests/purge-logic.test.js` — Logica purge ex-membri

Testa la funzione `shouldPurge(lastActiveSeason, retentionMonths, referenceDate)` estratta da `api/purge-ex-players.js`.

Retention configurata: **6 mesi**.

| Test | Input | Atteso |
|------|-------|--------|
| Inattivo 7 mesi | stagione 2025-07, ref 2026-03 | true (purga) |
| Inattivo esattamente 6 mesi | stagione 2025-09, ref 2026-03 | true (incluso nel cutoff) |
| Inattivo 5 mesi | stagione 2025-10, ref 2026-03 | false (non purgare) |
| Stagione corrente | stagione 2026-03, ref 2026-03-20 | false |
| Stagione null/undefined | null, undefined | false (dati mancanti) |

---

## Aree Coperte vs Non Coperte

### Coperte ✓
- Formula calcolo bonus CWL (`calculateMerit`)
- Logica di scadenza purge ex-membri (`shouldPurge`)

### Non coperte ✗ (rischio noto)

| Area | File | Rischio |
|------|------|---------|
| Proxy CoC API (fetch chain) | `render-proxy/index.js` | Regressioni su aggregazione CWL stats |
| Auth JWT middleware | `api/_utils/require-role.js` | Bypass accidentale protezione endpoints |
| Tag normalization | `render-proxy/index.js` `parseClanTag()` | Tag malformati rompono tutte le chiamate CoC |
| Login dual-domain | `app.js` `resolveLoginEmail()` | Auth failure per utenti con account legacy |
| Filtro guerra CWL vs classica | `app.js` riga ~2420 | Inclusione errata CWL nel war log classico |

---

## Se si aggiungessero più test

**Pattern raccomandato** (compatibile con il runner attuale `node:test`):

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Estrai la funzione da testare nel file sorgente o copiane la logica
function myPureFunction(input) { ... }

test('descrizione caso', () => {
    const result = myPureFunction(input);
    assert.equal(result, expected);
});
```

**Candidati prioritari:**
1. `parseClanTag()` in `render-proxy/index.js` — funzione pura, alta criticità
2. `requireRole()` in `api/_utils/require-role.js` — verifica estrazione token Bearer
3. Formula destrizione media — `destructionPercentage / attacksMade` usata in `renderCwlTable()`

---

*Testing analysis: 2026-03-20 — aggiornato post-fix 16 criticità*
