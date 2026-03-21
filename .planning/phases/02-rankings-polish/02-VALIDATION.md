---
phase: 02
slug: rankings-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` (v22.x) |
| **Config file** | none — `npm test` in `package.json` |
| **Quick run command** | `node --test tests/rankings.test.js` |
| **Full suite command** | `node --test tests/*.test.js` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/rankings.test.js`
- **After every plan wave:** Run `node --test tests/*.test.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | CLAS-01, CLAS-02 | unit | `node --test tests/rankings.test.js` | ❌ Wave 0 | ⬜ pending |
| 02-01-02 | 01 | 1 | CLAS-01, CLAS-02 | unit | `node --test tests/rankings.test.js` | ❌ Wave 0 | ⬜ pending |
| 02-01-03 | 01 | 1 | CLAS-06 | manual | Browser DevTools → Network → Cache-Control header | manual-only | ⬜ pending |
| 02-01-04 | 01 | 1 | CLAS-03, CLAS-04, CLAS-05, CLAS-07 | unit | `node --test tests/rankings.test.js` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/rankings.test.js` — unit test per:
  - `RANK_LOCATIONS.global === 'global'` (CLAS-01, CLAS-02)
  - `_renderRankPlayers` output contiene `onclick="openCercaPlayer(` (CLAS-07)
  - `_renderRankClans` output contiene `c.badgeUrls?.small` o `cerca-clan-badge` (CLAS-04)
  - `thImgV(undefined)` ritorna stringa con `th-unknown` (CLAS-05 fallback)
  - CDN badge prioritizzato su fallback locale: se `iconUrls.small` presente → usato prima di `LEAGUE_BADGE_MAP` (CLAS-03)

*Existing infrastructure: `tests/bonus-calculator.test.js`, `tests/equipment-map.test.js`, `tests/purge-logic.test.js` non coprono rankings — nuova suite richiesta.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `cache: 'no-store'` presente nella request | CLAS-06 | Browser fetch cache non testabile da Node.js | DevTools → Network tab → click "Aggiorna" → ispeziona request headers → `Cache-Control: no-store` deve essere presente |
| Classifica Globale Giocatori carica dati reali | CLAS-01 | Richiede API key live su Render.com | Aprire classifiche → Globale → Giocatori → deve mostrare top 50 senza "Errore: notFound" |
| Classifica Globale Clan carica dati reali | CLAS-02 | Richiede API key live su Render.com | Aprire classifiche → Globale → Clan → deve mostrare dati senza "Nessun dato disponibile" |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
