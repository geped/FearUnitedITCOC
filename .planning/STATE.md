# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-20)

**Core value:** Admin e co-capi possono gestire l'intero ciclo CWL e visualizzare statistiche di clan da un'unica interfaccia browser
**Current focus:** Phase 1 — Equipment Fix e Asset Mapper

## Current Position

Phase: 1 of 5 (Equipment Fix e Asset Mapper)
Plan: 0 of ? in current phase
Status: Ready to plan
Last activity: 2026-03-20 — Roadmap v2.0 creata, pronta per la pianificazione della Phase 1

Progress: [░░░░░░░░░░] 0%

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

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.0]: Vercel Hobby 12/12 functions in uso — NON aggiungere file in api/ senza rimuoverne uno
- [v1.0]: render-proxy su Render.com piano gratuito — cold start mitigato con warm-up in sync-members
- [Roadmap]: Bug fix prima di nuove feature — equipment e rankings in Phases 1-2 prima di refactoring strutturale
- [Roadmap]: ARCH-01 (asset mapper) in Phase 1 — i fix equipment toccano le stesse mappe, evita doppio lavoro
- [Roadmap]: ARCH-02 (shared state) in Phase 3 — prerequisito per Phase 4 e Phase 5

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Verificare slug CDN coc.guide per "stick-horse" e "battle-drill" prima di committare i fix — EQUIP-03 placeholder e' il safety net
- [Phase 1]: Dopo il fix locationId verificare GET /v1/locations/global/rankings/players in produzione
- [Phase 3]: Selettore CSS globale .subtab-btn in switchWarTab() va scopato a contenitore prima di aggiungere il quinto gruppo sotto-tab
- [Phase 4]: window._warLogMap va namespaciato per clan tag prima che WarDetailView sia condiviso tra "Il mio clan" e "Cerca"

## Session Continuity

Last session: 2026-03-20
Stopped at: Roadmap v2.0 creata — nessun piano ancora pianificato
Resume file: None
