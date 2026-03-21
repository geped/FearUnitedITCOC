---
phase: 02-rankings-polish
plan: 01
subsystem: ui
tags: [rankings, clash-of-clans, api, testing]

# Dependency graph
requires: []
provides:
  - Fixed global rankings locationId from '32000000' to 'global' string
  - Cache bypass on rankings fetch for refresh button
  - Unit test coverage for all 7 CLAS requirements
affects: [phase-03, phase-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Copy constants/functions from app.js monolith into test files for testability (no import)"

key-files:
  created:
    - tests/rankings.test.js
  modified:
    - app.js

key-decisions:
  - "RANK_LOCATIONS.global fixed to string 'global' — CoC API requires string not numeric ID"
  - "cache: 'no-store' added to loadRankings fetch — ensures Aggiorna button forces fresh API call"
  - "render functions already correct — only constant and fetch needed changes"

patterns-established:
  - "TDD pattern: copy constants/functions verbatim from app.js monolith for isolation testing"

requirements-completed: [CLAS-01, CLAS-02, CLAS-03, CLAS-04, CLAS-05, CLAS-06, CLAS-07]

# Metrics
duration: 12min
completed: 2026-03-21
---

# Phase 02 Plan 01: Rankings Polish Summary

**Fixed global rankings by correcting RANK_LOCATIONS.global from '32000000' to 'global' and adding cache: 'no-store' to force-refresh, with 9 unit tests covering all 7 CLAS requirements**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-21T08:01:28Z
- **Completed:** 2026-03-21T08:13:00Z (Tasks 1-2; Task 3 awaiting human verification)
- **Tasks:** 2 of 3 completed (Task 3 = checkpoint:human-verify, awaiting production smoke test)
- **Files modified:** 2

## Accomplishments

- Created `tests/rankings.test.js` with 9 tests covering all 7 CLAS requirements (CDN badge priority, fallback, clan badge, TH column, click handlers, locationId constant, italy regression guard)
- Fixed `RANK_LOCATIONS.global` from invalid numeric `'32000000'` to correct string `'global'` — root cause of notFound errors in global rankings
- Added `{ cache: 'no-store' }` to `loadRankings` fetch so the "Aggiorna" button bypasses browser cache
- Full test suite passes: 29/29 tests (6 bonus + 5 purge + 9 rankings + existing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create rankings test scaffold (TDD RED)** - `41f01be` (test)
2. **Task 2: Fix RANK_LOCATIONS.global and add cache bypass** - `0170d48` (fix)
3. **Task 3: Verify global rankings in production** - AWAITING CHECKPOINT

## Files Created/Modified

- `tests/rankings.test.js` - 9 unit tests for CLAS-01 through CLAS-07; constants/functions copied from app.js for testability
- `app.js` - Two surgical edits: RANK_LOCATIONS.global and loadRankings fetch options

## Decisions Made

- `RANK_LOCATIONS.global` must be the string `'global'` — the CoC API locationId for global rankings is the literal string, not a numeric location ID. The previous value `'32000000'` is not a valid location and caused `notFound` responses.
- `cache: 'no-store'` added to fetch — ensures each "Aggiorna" button click forces a real network request bypassing any browser/service-worker cache. The render-proxy already handles this string locationId correctly.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — both edits were surgical and the test suite confirmed all 29 tests green immediately.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Task 3 (checkpoint:human-verify) requires production deploy and manual smoke test
- After verification: Phase 02 Plan 01 fully complete, all CLAS requirements satisfied
- Phase 03 (shared-state/refactoring) can proceed once this checkpoint is approved

---
*Phase: 02-rankings-polish*
*Completed: 2026-03-21 (pending Task 3 human verification)*
