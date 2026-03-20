---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: milestone
status: unknown
stopped_at: Phase 2 context gathered
last_updated: "2026-03-20T23:48:19.265Z"
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 2
  completed_plans: 2
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-20)

**Core value:** Admin e co-capi possono gestire l'intero ciclo CWL e visualizzare statistiche di clan da un'unica interfaccia browser
**Current focus:** Phase 01 — Equipment Fix e Asset Mapper

## Current Position

Phase: 01 (Equipment Fix e Asset Mapper) — EXECUTING
Plan: 1 of 2

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01-equipment-fix-e-asset-mapper P01 | 8 | 2 tasks | 2 files |
| Phase 01-equipment-fix-e-asset-mapper P02 | 6 | 1 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.0]: Vercel Hobby 12/12 functions in uso — NON aggiungere file in api/ senza rimuoverne uno
- [v1.0]: render-proxy su Render.com piano gratuito — cold start mitigato con warm-up in sync-members
- [Roadmap]: Bug fix prima di nuove feature — equipment e rankings in Phases 1-2 prima di refactoring strutturale
- [Roadmap]: ARCH-01 (asset mapper) in Phase 1 — i fix equipment toccano le stesse mappe, evita doppio lavoro
- [Roadmap]: ARCH-02 (shared state) in Phase 3 — prerequisito per Phase 4 e Phase 5
- [Phase 01]: Battle Drill categoria 'troop' mantenuta in UNIT_COC_SLUG — solo slug corretto da 'battleram' a 'battle-drill'
- [Phase 01]: Stick Horse slug 'stick-horse' committato nonostante 404 su coc.guide — onerror fallback gia' gestisce immagini mancanti
- [Phase 01]: Safety net groups['__altro__'] preservata in app.js — solo rimossa l'iterazione forEach di rendering
- [Phase 01-equipment-fix-e-asset-mapper]: _unitFallbackColor() mantenuta con TODO — nessun call site, rimozione demandata
- [Phase 01-equipment-fix-e-asset-mapper]: SVG stella inline nel template HTML — zero dipendenze file esterni

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Verificare slug CDN coc.guide per "stick-horse" e "battle-drill" prima di committare i fix — EQUIP-03 placeholder e' il safety net
- [Phase 1]: Dopo il fix locationId verificare GET /v1/locations/global/rankings/players in produzione
- [Phase 3]: Selettore CSS globale .subtab-btn in switchWarTab() va scopato a contenitore prima di aggiungere il quinto gruppo sotto-tab
- [Phase 4]: window._warLogMap va namespaciato per clan tag prima che WarDetailView sia condiviso tra "Il mio clan" e "Cerca"

## Session Continuity

Last session: 2026-03-20T23:48:19.261Z
Stopped at: Phase 2 context gathered
Resume file: .planning/phases/02-rankings-polish/02-CONTEXT.md
