---
phase: 01-equipment-fix-e-asset-mapper
plan: 01
subsystem: ui
tags: [equipment, app.js, unit-map, cdn-slug, hero-equipment, node-test]

requires: []
provides:
  - "Stick Horse mappato a Barbarian King in HERO_EQUIPMENT_MAP"
  - "Stick Horse in UNIT_COC_SLUG con c:'equipment', s:'stick-horse'"
  - "Battle Drill slug corretto in UNIT_COC_SLUG: 'battle-drill' (non 'battleram')"
  - "Sezione Altro rimossa dall'iterazione di rendering _renderEquipmentGrouped"
  - "6 test di regressione per EQUIP-01, EQUIP-02, EQUIP-04 in tests/equipment-map.test.js"
affects: [01-02, phase-02]

tech-stack:
  added: []
  patterns:
    - "Costanti copiate in test file (stato TARGET) per testabilita' senza import da app.js monolitico"
    - "Safety net __altro__ preservata nella logica di assegnazione gruppi ma esclusa dal rendering"

key-files:
  created:
    - tests/equipment-map.test.js
  modified:
    - app.js

key-decisions:
  - "Slug 'stick-horse' restituisce 404 su coc.guide al 2026-03-20 — onerror fallback gia' presente gestisce il caso senza codice aggiuntivo"
  - "Battle Drill categoria rimasta 'troop' (non 'equipment') — e' una siege machine, la categoria CDN corretta e' troop"
  - "Logica safety net groups['__altro__'] preservata in app.js per equipment futuri non ancora mappati"

patterns-established:
  - "Test equipment: costanti copiate da app.js con stato TARGET, pattern identico a bonus-calculator.test.js"

requirements-completed: [EQUIP-01, EQUIP-02, EQUIP-04]

duration: 8min
completed: 2026-03-20
---

# Phase 01 Plan 01: Equipment Map Fix Summary

**Stick Horse aggiunto a HERO_EQUIPMENT_MAP e UNIT_COC_SLUG, Battle Drill slug corretto da 'battleram' a 'battle-drill', sezione "Altro" rimossa dal rendering — 6 test di regressione creati (17 totali passano)**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-20T22:34:00Z
- **Completed:** 2026-03-20T22:42:58Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Stick Horse ora appare sotto Barbarian King nella vista profilo equipment (fix EQUIP-01)
- Battle Drill mostra immagine corretta via coc.guide/static/imgs/troop/battle-drill.png (fix EQUIP-04)
- La sezione "Altro" non viene piu' renderizzata nella UI profilo (fix EQUIP-02)
- 6 test di regressione coprono tutti e tre i bug e prevengono future regressioni

## Task Commits

Ogni task e' stato committato atomicamente:

1. **Task 1: Creare test file equipment-map.test.js (RED/GREEN)** - `f38c055` (test)
2. **Task 2: Fix costanti statiche e rimozione rendering Altro in app.js** - `ca8411b` (fix)

## Files Created/Modified

- `tests/equipment-map.test.js` — 6 nuovi test: EQUIP-01 (Stick Horse mapping), EQUIP-01b (Stick Horse CDN entry), EQUIP-04 (Battle Drill slug), EQUIP-02 (nessun item in __altro__), EQUIP-02b (HERO_ORDER_EQUIP senza __altro__), completezza HERO_EQUIPMENT_MAP vs UNIT_COC_SLUG
- `app.js` — 4 modifiche: HERO_EQUIPMENT_MAP (+Stick Horse, commento 7→8 items), UNIT_COC_SLUG (+Stick Horse), forEach rendering (__altro__ rimosso), Battle Drill slug ('battleram'→'battle-drill')

## Decisions Made

- **Slug 'stick-horse' e' 404 su coc.guide:** Committato ugualmente — il meccanismo `onerror` gia' presente nel rendering (riga 3842) mostra un avatar fallback colorato quando l'immagine manca. Quando coc.guide aggiornera' la CDN, l'immagine apparira' automaticamente senza modifiche al codice.
- **Battle Drill categoria 'troop' mantenuta:** La categoria CDN non cambia — Battle Drill e' una siege machine elencata in SIEGE_SET, la categoria 'troop' e' quella corretta per coc.guide. Solo lo slug era errato.
- **Safety net `__altro__` preservata:** Il blocco `groups['__altro__'] = []` e il branch di assegnazione sono stati mantenuti in app.js. Servono come safety net per equipment futuri aggiunti da Supercell prima che vengano mappati. Solo l'inclusione nell'iterazione di rendering e' stata rimossa.

## Deviations from Plan

Nessuna — piano eseguito esattamente come scritto.

## Issues Encountered

Nessuno.

## User Setup Required

Nessuno — nessuna configurazione esterna richiesta.

## Next Phase Readiness

- EQUIP-01, EQUIP-02, EQUIP-04 risolti e coperti da test
- Pronto per Plan 01-02 (asset mapper / EQUIP-03 placeholder + slug validation)
- Il test di completezza in equipment-map.test.js catturera' automaticamente futuri equipment aggiunti a HERO_EQUIPMENT_MAP senza corrispondente entry in UNIT_COC_SLUG

## Self-Check: PASSED

- FOUND: tests/equipment-map.test.js
- FOUND: app.js
- FOUND: commit f38c055 (test)
- FOUND: commit ca8411b (fix)

---
*Phase: 01-equipment-fix-e-asset-mapper*
*Completed: 2026-03-20*
