---
phase: 01-equipment-fix-e-asset-mapper
plan: 02
subsystem: ui
tags: [vanilla-js, css, svg, asset-mapper, fallback]

# Dependency graph
requires:
  - phase: 01-equipment-fix-e-asset-mapper
    plan: 01
    provides: UNIT_COC_SLUG corretta, HERO_EQUIPMENT_MAP completa, test equipment-map esistenti
provides:
  - "getAssetUrl() come unica funzione CDN lookup per unit/equipment images"
  - "Fallback SVG stella neutra in _renderEquipmentGrouped e _renderUnits (EQUIP-03)"
  - "Test EQUIP-03, ARCH-01, ARCH-01b aggiunti (20 test totali)"
affects: [Phase 02, Phase 03, Phase 04 — chiunque usi getAssetUrl o rendering unit card]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getAssetUrl(name, category): unica funzione CDN — lookup da UNIT_COC_SLUG con auto-slug fallback"
    - "Fallback immagine: SVG inline neutro con classe CSS --neutral, mai colored-initial"

key-files:
  created: []
  modified:
    - app.js
    - style.css
    - tests/equipment-map.test.js

key-decisions:
  - "_unitFallbackColor() mantenuta in app.js con commento TODO — nessun call site residuo, rimozione demandata a fase futura"
  - "SVG stella inline nei template HTML — nessuna dipendenza da file esterni, funziona offline"
  - "Classe --neutral usa background transparent !important per override del background dinamico precedente"

patterns-established:
  - "Unit card fallback: sempre SVG inline neutro, mai testo/colore dinamico per nomi"
  - "Asset CDN lookup: sempre tramite getAssetUrl(), mai _unitCdnUrl (rimosso)"

requirements-completed: [EQUIP-03, ARCH-01]

# Metrics
duration: 8min
completed: 2026-03-20
---

# Phase 01 Plan 02: Equipment Fix e Asset Mapper (SVG Placeholder + getAssetUrl) Summary

**SVG stella neutra sostituisce il fallback colored-initial in tutti i template unit card, e _unitCdnUrl e' rinominata getAssetUrl centralizzata**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-20T22:48:37Z
- **Completed:** 2026-03-20T22:56:00Z
- **Tasks:** 1 di 2 (Task 2 e' checkpoint human-verify)
- **Files modified:** 3

## Accomplishments
- Rinominata `_unitCdnUrl` in `getAssetUrl` con aggiornamento di tutti i call site (ARCH-01)
- Sostituito fallback colored-initial con SVG stella neutra in `_renderEquipmentGrouped` e `_renderUnits` (EQUIP-03)
- Aggiunta classe CSS `.profilo-unit-fallback--neutral` con SVG sizing
- Aggiunti 3 test: EQUIP-03, ARCH-01, ARCH-01b — totale 20 test, tutti passano

## Task Commits

Each task was committed atomically:

1. **Task 1: Aggiungere test EQUIP-03 e ARCH-01, implementare SVG placeholder e rinominare getAssetUrl** - `8d6783d` (fix)

**Plan metadata:** (pending after checkpoint approval)

## Files Created/Modified
- `app.js` - _unitCdnUrl -> getAssetUrl (rename), fallback colored-initial -> SVG neutro in unitCardHtml e _renderUnits
- `style.css` - Aggiunta `.profilo-unit-fallback--neutral` e `.profilo-unit-fallback--neutral svg`
- `tests/equipment-map.test.js` - Aggiunti test EQUIP-03, ARCH-01, ARCH-01b

## Decisions Made
- `_unitFallbackColor()` mantenuta con TODO comment — ha solo la definizione, nessun call site; rimozione sicura ma demandata
- SVG inline (non file esterno) per massima portabilita' e zero dipendenze
- Classe `--neutral` usa `background: transparent !important` per sovrascrivere l'eventuale background inline precedente

## Deviations from Plan

None - piano eseguito esattamente come scritto.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Task 2 (checkpoint:human-verify) e' in attesa di verifica visiva dell'utente
- Dopo approvazione: Phase 1 completata, pronta per Phase 2
- getAssetUrl() e' l'API stabile per le fasi future che aggiungono nuove unit

---
*Phase: 01-equipment-fix-e-asset-mapper*
*Completed: 2026-03-20 (Task 1 — pending verifica visiva Task 2)*
