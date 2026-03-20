# Testing Patterns

**Analysis Date:** 2026-03-20

## Test Framework

**Runner:** None detected
- No `jest.config.*`, `vitest.config.*`, or `mocha` configuration files found
- No test runner listed in `package.json` scripts
- `package.json` has no `devDependencies` at all

**Assertion Library:** None

**Run Commands:**
```bash
# No test commands defined
# package.json scripts section is absent
```

## Test File Organization

**Status:** No test files exist in the codebase.

A search for `*.test.*` and `*.spec.*` across the project returned zero results.

## What This Means

This is a zero-test codebase. There are no unit tests, integration tests, or end-to-end tests for any module:
- `app.js` (4597 lines) — no tests
- `render-proxy/index.js` (624 lines) — no tests
- `api/*.js` serverless functions — no tests
- `api/generate-bonuses.js` contains the `calculateMerit()` pure function which is the only clearly unit-testable logic — not tested

## Testable Logic

The following pure or near-pure functions exist and could be unit tested without mocking:

**`api/generate-bonuses.js`**
```js
function calculateMerit(stats, history) {
    let score = (stats.stars || 0) * 100 + (stats.destructionPercentage || 0);
    if (stats.attacksRequired != null && stats.attacksMade != null) {
        score -= (stats.attacksRequired - stats.attacksMade) * 500;
    }
    if (history?.received_last_month) score = 0;
    return Math.max(score, 0);
}
```

**`render-proxy/index.js`**
```js
function parseClanTag(raw) { /* normalizes tag, adds # prefix */ }
function encodeTag(tag) { return encodeURIComponent(tag); }
```

**`api/register-with-coc.js`**
```js
function normalizeTag(raw) { /* same logic as parseClanTag */ }
```

**`app.js` (frontend)**
```js
function thImgSrc(level) { /* returns image path based on level */ }
function resolveLoginEmail(input) { /* converts username to internal email */ }
function leagueTierNameIt(name) { /* translates league tier name to Italian */ }
function cocRole(role) { /* maps API role to display label */ }
```

## If Tests Were Added

**Recommended framework:** Vitest (compatible with Node.js, zero-config)

**Recommended structure:**
```
tests/
  unit/
    calculateMerit.test.js
    parseClanTag.test.js
    resolveLoginEmail.test.js
  integration/
    api/
      sync-members.test.js     # mock fetch + supabase
      generate-bonuses.test.js # mock supabase
```

**Example unit test pattern (Vitest):**
```js
import { describe, it, expect } from 'vitest'
import { calculateMerit } from '../api/generate-bonuses.js'

describe('calculateMerit', () => {
  it('calculates score: stars × 100 + destruction%', () => {
    const stats = { stars: 5, destructionPercentage: 87.5, attacksMade: 2, attacksRequired: 2 }
    expect(calculateMerit(stats, null)).toBe(587.5)
  })

  it('deducts 500 per missed attack', () => {
    const stats = { stars: 3, destructionPercentage: 60, attacksMade: 1, attacksRequired: 2 }
    expect(calculateMerit(stats, null)).toBe(3 * 100 + 60 - 500) // -140 → clamped to 0
    expect(calculateMerit(stats, null)).toBe(0)
  })

  it('returns 0 when received_last_month is true', () => {
    const stats = { stars: 10, destructionPercentage: 100, attacksMade: 2, attacksRequired: 2 }
    expect(calculateMerit(stats, { received_last_month: true })).toBe(0)
  })
})
```

**Mocking pattern for Supabase in API functions:**
```js
import { vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }))
  }))
}))
```

**Mocking pattern for `fetch` (CoC API proxying):**
```js
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ items: [] }),
  status: 200,
})
```

## Coverage

**Requirements:** None enforced (no config, no CI pipeline)

**Current state:** 0% coverage — no tests exist

## Risk Areas Without Tests

The following areas carry the highest risk from untested changes:

| Area | File | Risk |
|------|------|------|
| Bonus score formula | `api/generate-bonuses.js` | Score calculation errors go unnoticed until CWL season |
| Tag normalization | `render-proxy/index.js`, `api/register-with-coc.js` | Duplicate/broken tag format breaks all API calls |
| Login email resolution | `app.js` `resolveLoginEmail()` | Auth failures for users |
| CWL stats aggregation | `render-proxy/index.js` `getCwlStats()` | Complex loop logic with silent errors |
| Role mapping (CoC → app) | `api/register-with-coc.js` `COC_ROLE_MAP` | Incorrect role assignment on registration |

---

*Testing analysis: 2026-03-20*
