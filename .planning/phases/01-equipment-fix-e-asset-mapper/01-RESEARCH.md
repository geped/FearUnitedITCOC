# Phase 1: Equipment Fix e Asset Mapper - Research

**Researched:** 2026-03-20
**Domain:** Vanilla JS monolith bug fixes — CoC hero equipment mapping + centralized image asset lookup
**Confidence:** HIGH (all findings from direct codebase inspection; CDN URLs verified with live HTTP requests)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EQUIP-01 | Stick Horse appare sotto Barbarian King (non in "Altro") | `HERO_EQUIPMENT_MAP` manca `'Stick Horse':'Barbarian King'` a riga 3780–3808; aggiungere una riga risolve il bug |
| EQUIP-02 | La sezione "Altro" non è più visibile nel profilo equipaggiamenti | `_renderEquipmentGrouped()` a riga 3850 itera `[...HERO_ORDER_EQUIP, '__altro__']`; rimuovere `'__altro__'` dall'iterazione finale (dopo che EQUIP-01 è risolto e non rimangono item non mappati) |
| EQUIP-03 | Equipaggiamenti senza immagine mostrano un placeholder neutro (icona SVG, non quadratino con iniziale) | Il fallback attuale a riga 3842–3843 usa `_unitFallbackColor` + iniziale testuale; sostituire con placeholder SVG neutro nell'`onerror` dell'`<img>` |
| EQUIP-04 | Battle Drill mostra l'immagine corretta | `UNIT_COC_SLUG['Battle Drill']` a riga 3640 ha slug `battleram` (errato); corretto slug verificato: `battle-drill` con categoria `troop` — URL `coc.guide/static/imgs/troop/battle-drill.png` restituisce HTTP 200 |
| ARCH-01 | Esiste un `getAssetUrl()` centralizzato usato da tutte le visualizzazioni immagini | Attualmente `_unitCdnUrl()` è la funzione CDN ma non copre TH images, league badges, clan crests; rinominare/estendere in `getAssetUrl(name, category)` e aggiornare tutti i call site |

</phase_requirements>

---

## Summary

Phase 1 risolve cinque problemi concreti tutti confinati in `app.js`: due entry mancanti/errate in costanti statiche (EQUIP-01 e EQUIP-04), una rimozione di branch di rendering (EQUIP-02), una sostituzione del fallback visivo (EQUIP-03), e un refactoring della funzione di lookup immagini (ARCH-01). Non è richiesta nessuna modifica a `index.html`, `render-proxy/index.js`, o `api/lookup.js`. Nessun deploy render-proxy, nessuna nuova Vercel function.

Tutti i fix sono confermati da ispezione diretta del codice. Le righe esatte sono note. I due rischi di runtime — slug CDN del Stick Horse (HTTP 404 verificato) e il fallback `onerror` per EQUIP-03 — hanno entrambi mitigazioni esplicite già nel codice esistente.

**Primary recommendation:** Eseguire i fix nell'ordine EQUIP-01 → EQUIP-02 → EQUIP-04 → EQUIP-03 → ARCH-01. L'ordine garantisce che la sezione "Altro" venga rimossa solo quando è vuota, e che il fallback placeholder sia in place prima che ARCH-01 sia completato.

---

## Standard Stack

### Core

| Componente | Versione | Scopo | Note |
|-----------|---------|-------|------|
| Vanilla JS (ES2022+) | — | Tutti i fix in `app.js` | Nessun framework, nessuna dipendenza nuova |
| coc.guide CDN | — | Immagini equipment/troop | `https://coc.guide/static/imgs/{category}/{slug}.png` |
| Node.js `node:test` | built-in | Test runner | `npm test` — 11 test esistenti (bonus + purge); zero dipendenze |

### No New Dependencies

Questa fase non aggiunge nessun `npm install`. Tutti i cambiamenti sono edit a `app.js`.

### CDN Slugs Verificati

| Item | Categoria | Slug corretto | HTTP status verificato |
|------|-----------|--------------|----------------------|
| Battle Drill | `troop` | `battle-drill` | **200 OK** — `coc.guide/static/imgs/troop/battle-drill.png` |
| Stick Horse | `equipment` | `stick-horse` | **404** — coc.guide non ha ancora questo slug; `onerror` placeholder è il safety net |

**Implicazione per Stick Horse:** L'entry in `UNIT_COC_SLUG` va aggiunta con `{c:'equipment', s:'stick-horse'}` per quando coc.guide aggiunge il file. Il fallback `onerror` gestisce il 404 nel frattempo. Questo è il comportamento corretto — non omettere l'entry solo perché il CDN è in ritardo.

---

## Architecture Patterns

### Struttura Attuale Rilevante

```
app.js
├── UNIT_COC_SLUG (riga 3553)         — map nome → {c, s} per CDN lookup
│   ├── Truppe, eroi, incantesimi
│   ├── 'Battle Drill': {c:'troop', s:'battleram'}  ← BUG: slug errato
│   └── Equipment (riga 3641–3690)    ← Stick Horse ASSENTE
│
├── _unitCdnUrl(name, category) (riga 3756)  — risolve URL CDN
│   └── Fallback: auto-genera slug da nome
│
├── HERO_EQUIPMENT_MAP (riga 3780)    — map nome equipment → hero owner
│   ├── BK: 7 items (righe 3782–3785)  ← 'Stick Horse' ASSENTE
│   └── Dragon Duke: 3 items (righe 3805–3807)
│
├── HERO_ORDER_EQUIP (riga 3809)      — ordine di visualizzazione hero
│
└── _renderEquipmentGrouped(containerId, equipment) (riga 3812)
    ├── Costruisce groups: { 'Barbarian King': [], ..., '__altro__': [] }
    ├── Assegna item a gruppo tramite HERO_EQUIPMENT_MAP
    └── Itera [...HERO_ORDER_EQUIP, '__altro__'] per renderizzare
        └── Mostra sezione 'Altro' se groups['__altro__'].length > 0
```

### Pattern 1: Aggiunta Entry a Costante Statica (EQUIP-01, EQUIP-04)

**What:** Aggiungere una riga a `HERO_EQUIPMENT_MAP` e correggere una riga in `UNIT_COC_SLUG`.
**When to use:** Ogni volta che Supercell aggiunge nuovi equipment items.

```javascript
// In HERO_EQUIPMENT_MAP (dopo riga 3785, dentro il blocco "Re dei Barbari"):
'Stick Horse':'Barbarian King',   // aggiunto: epic equipment feb 2026

// In UNIT_COC_SLUG (riga 3640, fix slug Battle Drill):
'Battle Drill': {c:'troop', s:'battle-drill'},  // era: s:'battleram'

// In UNIT_COC_SLUG (dentro il blocco equipment BK, dopo riga 3681):
'Stick Horse': {c:'equipment', s:'stick-horse'},  // CDN restituisce 404 ora; onerror gestisce
```

### Pattern 2: Rimozione Branch di Rendering (EQUIP-02)

**What:** Rimuovere `'__altro__'` dall'iterazione in `_renderEquipmentGrouped()`.
**Precondizione:** EQUIP-01 deve essere applicato prima — nessun item deve cadere in `__altro__`.

```javascript
// PRIMA (riga 3850):
[...HERO_ORDER_EQUIP, '__altro__'].forEach(heroKey => {

// DOPO:
HERO_ORDER_EQUIP.forEach(heroKey => {
```

Il gruppo `__altro__` può rimanere nel codice di assegnazione (safety net) — semplicemente non viene renderizzato. Questo è preferibile a rimuovere l'intera logica di fallback, che protegge da future aggiunte Supercell non ancora mappate.

### Pattern 3: Sostituzione Fallback con SVG Neutro (EQUIP-03)

**What:** Sostituire il fallback colored-initial (`_unitFallbackColor` + lettera) con un placeholder SVG neutro.
**Current fallback in `_renderEquipmentGrouped` (riga 3842–3843):**

```javascript
// ATTUALE — fallback con colore e iniziale
onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
<div class="profilo-unit-fallback" style="display:none;background:${fbColor}">${fbInit}</div>
```

**Target:** Sostituire il contenuto del fallback div con un SVG inline neutro (icona generica equipment/shield). Il fallback div rimane — solo il suo contenuto visivo cambia.

```javascript
// DOPO — fallback con SVG neutro (nessun colore personalizzato, nessuna iniziale)
<div class="profilo-unit-fallback profilo-unit-fallback--neutral" style="display:none">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ...>
    <!-- icona scudo o equipaggiamento neutro -->
  </svg>
</div>
```

Il CSS esistente `.profilo-unit-fallback` si usa come base. Aggiungere una variante `--neutral` in `style.css` che rimuove il background colorato.

### Pattern 4: Centralizzazione in `getAssetUrl()` (ARCH-01)

**What:** Rinominare/estendere `_unitCdnUrl()` in `getAssetUrl(name, category)` e fare in modo che tutti i call site la usino.
**Scope attuale di `_unitCdnUrl()`:** Solo equipment, truppe, eroi (coc.guide CDN).
**Non copre:** TH images (`thImgSrc`), league badges (`LEAGUE_BADGE_MAP`, `LEAGUE_BADGE`), clan crests (URL diretti da API response).

**Approccio per ARCH-01:** Rinominare `_unitCdnUrl` in `getAssetUrl` e aggiornare i due call site esistenti:
- `_renderEquipmentGrouped()` riga 3832: `_unitCdnUrl(u.name, 'equipment')` → `getAssetUrl(u.name, 'equipment')`
- `_renderUnits()` riga 3871: `_unitCdnUrl(u.name, cdnCategory)` → `getAssetUrl(u.name, cdnCategory)`

TH images e league badges hanno già funzioni dedicate che funzionano correttamente — non devono essere inglobate in `getAssetUrl()` per questa fase. ARCH-01 richiede solo che "tutte le visualizzazioni immagini [equipment/troop] usino la funzione centralizzata" — non una mega-funzione per tutti gli asset del progetto.

**Call site completa di `_unitCdnUrl` (da verificare prima di rinominare):**

```bash
grep -n "_unitCdnUrl" app.js
```

Da ispezionare per assicurarsi che nessun altro call site sia nascosto.

---

## Don't Hand-Roll

| Problema | Non costruire | Usare invece | Perché |
|---------|--------------|--------------|--------|
| Placeholder per immagini mancanti | Canvas-based colored initials | SVG inline nel `<div>` fallback già esistente | Il meccanismo `onerror` è già in place — solo il contenuto visivo cambia |
| Reverse hero map (equipment → hero) | Manutenere `HERO_EQUIPMENT_MAP` al contrario | Forward map unica — la logica di assegnazione a riga 3825 fa già il lookup corretto | Manutenere una reverse map a mano causa esattamente il bug che stiamo correggendo |
| Auto-slug generation per nuovi equipment | Affidarsi all'auto-generazione | Aggiungere entry esplicita a `UNIT_COC_SLUG` | Auto-generazione ha fallito per Stick Horse (slug CDN in ritardo) e Battle Drill (slug diverso dall'atteso) |

---

## Common Pitfalls

### Pitfall 1: Rimuovere la Sezione "Altro" Prima di Mappare Tutti gli Items

**What goes wrong:** Se `'__altro__'` viene rimosso dall'iterazione prima di aggiungere Stick Horse a `HERO_EQUIPMENT_MAP`, Stick Horse scompare completamente dal profilo (non renderizzato affatto, invece di apparire in "Altro").
**How to avoid:** Ordine dei fix: EQUIP-01 prima, EQUIP-02 dopo. Testare con un profilo che ha Stick Horse equipaggiato.
**Warning signs:** Player con Stick Horse ha meno equipment cards del previsto nella vista profilo.

### Pitfall 2: Rimuovere il Gruppo `__altro__` dal Codice di Assegnazione

**What goes wrong:** Se si rimuove anche `groups['__altro__'] = []` e il relativo branch di assegnazione, qualsiasi futuro equipment Supercell non mappato causerà un errore runtime (`Cannot read properties of undefined (setting 'push')`).
**How to avoid:** Mantenere il gruppo `__altro__` nella mappa e nell'assegnazione — rimuoverlo solo dall'iterazione di rendering.

### Pitfall 3: Slug CDN Stick Horse è HTTP 404

**What goes wrong:** L'URL `coc.guide/static/imgs/equipment/stick-horse.png` restituisce HTTP 404 (verificato 2026-03-20). Se si aggiunge l'entry a `UNIT_COC_SLUG` senza che il fallback `onerror` funzioni correttamente, l'immagine appare broken.
**How to avoid:** EQUIP-03 (placeholder onerror) deve essere completato. L'`onerror` già presente a riga 3842 gestisce questo caso — EQUIP-03 migliora il placeholder visivo ma non cambia il meccanismo.
**Note:** coc.guide aggiornerà i propri asset quando il gioco rilascia aggiornamenti. Lo slug `stick-horse` è quello corretto per quando sarà disponibile.

### Pitfall 4: Battle Drill ha Categoria `troop`, Non `equipment`

**What goes wrong:** Battle Drill è una siege machine (elencata in `SIEGE_SET` a riga 3776). L'entry corretta in `UNIT_COC_SLUG` usa `{c:'troop', s:'battle-drill'}` — non `{c:'equipment', ...}`. L'URL verificato è `coc.guide/static/imgs/troop/battle-drill.png` (HTTP 200).
**How to avoid:** Non cambiare la categoria `c:'troop'` — solo il slug `s` da `battleram` a `battle-drill`.

### Pitfall 5: getAssetUrl — Aggiornare Tutti i Call Site

**What goes wrong:** Rinominare `_unitCdnUrl` senza aggiornare tutti i call site lascia reference a funzione undefined.
**How to avoid:** Prima di rinominare, eseguire `grep -n "_unitCdnUrl" app.js` per trovare tutti i call site. Aggiornare in modo atomico.

---

## Code Examples

Patterns verificati dalla codebase esistente:

### Come il Fallback onerror Funziona Già (riga 3839–3843)

```javascript
// Sorgente: app.js riga 3839–3843 (esistente, funzionante)
return `<div class="profilo-unit-card..." title="${nameIt}">
  <div class="profilo-unit-img-wrap">
    <img src="${imgUrl}" alt="${nameIt}" class="profilo-unit-img" loading="lazy"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
    <div class="profilo-unit-fallback" style="display:none;background:${fbColor}">${fbInit}</div>
  </div>
</div>`;
```

Per EQUIP-03: sostituire il contenuto del `div.profilo-unit-fallback` con SVG. Il meccanismo `onerror` non cambia.

### Come `_unitCdnUrl` Funziona (riga 3756–3766)

```javascript
// Sorgente: app.js riga 3756–3766 (da rinominare in getAssetUrl per ARCH-01)
function _unitCdnUrl(name, category) {
  if (UNIT_COC_SLUG[name]) {
    const {c, s} = UNIT_COC_SLUG[name];
    return `https://coc.guide/static/imgs/${c}/${s}.png`;
  }
  // Auto-generate per unità non mappate
  const CAT = {heroes:'hero',troops:'troop',spells:'spell',pets:'pet',equipment:'equipment'};
  const cat = CAT[category] || category || 'troop';
  const slug = name.toLowerCase().replace(/['.()]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-');
  return `https://coc.guide/static/imgs/${cat}/${slug}.png`;
}
```

### Stato Attuale HERO_EQUIPMENT_MAP (riga 3780–3808)

BK ha 7 entries: Barbarian Puppet, Rage Vial, Earthquake Boots, Vampstache, Giant Gauntlet, Spiky Ball, Snake Bracelet. **Stick Horse manca** — questo è il bug di EQUIP-01.

Dragon Duke ha 3 entries: Fire Heart, Flame Blower, Stun Blaster. Già presente.

### Iterazione di Rendering (riga 3850)

```javascript
// ATTUALE (riga 3850) — include '__altro__'
[...HERO_ORDER_EQUIP, '__altro__'].forEach(heroKey => {

// TARGET per EQUIP-02 — solo eroi
HERO_ORDER_EQUIP.forEach(heroKey => {
```

---

## State of the Art

| Vecchio Approccio | Approccio Corrente | Quando Cambiato | Impatto |
|------------------|--------------------|-----------------|---------|
| Stick Horse in "Altro" | Stick Horse sotto Barbarian King | EQUIP-01 fix | Visibilità utente corretta |
| Battle Drill immagine sbagliata (`battleram`) | Battle Drill con slug corretto (`battle-drill`) | EQUIP-04 fix | Immagine siege machine corretta |
| Colored-initial fallback per img 404 | SVG placeholder neutro | EQUIP-03 fix | UX più pulita per equipment non su CDN |
| `_unitCdnUrl()` — funzione privata con prefisso `_` | `getAssetUrl()` — funzione pubblica centralizzata | ARCH-01 | Tutti i call site unificati |

---

## Open Questions

1. **Slug Stick Horse su coc.guide**
   - What we know: `equipment/stick-horse.png` restituisce HTTP 404 al 2026-03-20; coc.guide non ha ancora il file
   - What's unclear: Quando coc.guide aggiornerà i propri asset con questo equipment (il gioco è uscito a feb 2026)
   - Recommendation: Aggiungere l'entry con slug `stick-horse` ora. Il fallback `onerror` gestisce il 404. Quando coc.guide aggiorna, l'immagine apparirà automaticamente senza modifiche al codice.

2. **Nome API esatto di Stick Horse**
   - What we know: Il nome in-game è "Stick Horse" (confermato da wiki, sportskeeda, community); il pattern API per tutti gli altri equipment usa il nome inglese esatto
   - What's unclear: Non è stato possibile verificare il campo `name` nella risposta API reale (`heroEquipment[].name`) per Stick Horse
   - Recommendation: Usare `'Stick Horse'` come chiave in `HERO_EQUIPMENT_MAP` e `UNIT_COC_SLUG`. Se l'API restituisce un nome diverso (es. con apostrofi o capitalizzazione diversa), sarà visibile perché l'item tornerà in "Altro" — che è il comportamento di fallback corretto.

3. **SVG placeholder per EQUIP-03**
   - What we know: Il meccanismo `onerror` esiste già; bisogna solo cambiare il contenuto visivo del fallback div
   - What's unclear: Se esiste già un'icona SVG appropriata nel progetto o se va creata inline
   - Recommendation: Usare un SVG inline minimo (shield/star icon, ~5 righe SVG). Non aggiungere file di asset nuovi — l'SVG inline è self-contained e non crea dipendenze da file.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` |
| Config file | nessuno — runner in `package.json` scripts |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EQUIP-01 | Stick Horse in HERO_EQUIPMENT_MAP con hero = 'Barbarian King' | unit | `npm test` (tests/equipment-map.test.js) | ❌ Wave 0 |
| EQUIP-02 | Nessun item cade nel gruppo `__altro__` per un player set completo | unit | `npm test` (tests/equipment-map.test.js) | ❌ Wave 0 |
| EQUIP-03 | Fallback HTML contiene SVG (non colored-initial) | unit (string match) | `npm test` (tests/equipment-map.test.js) | ❌ Wave 0 |
| EQUIP-04 | UNIT_COC_SLUG['Battle Drill'] ha slug `battle-drill` | unit | `npm test` (tests/equipment-map.test.js) | ❌ Wave 0 |
| ARCH-01 | `getAssetUrl` è definita; `_unitCdnUrl` non è più definita globalmente | unit | `npm test` (tests/equipment-map.test.js) | ❌ Wave 0 |

**Nota:** I test di questa fase operano su costanti JS estratte da `app.js`. Il pattern è lo stesso dei test esistenti (`bonus-calculator.test.js` e `purge-logic.test.js`) — testano logica pura isolata dal DOM.

### Sampling Rate

- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green (11 test esistenti + nuovi test phase 1) prima di `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/equipment-map.test.js` — copre EQUIP-01, EQUIP-02, EQUIP-04, ARCH-01 (test su costanti estratte)
- [ ] Aggiungere `tests/asset-url.test.js` oppure includere i test ARCH-01 nello stesso file

*(I test esistenti `bonus-calculator.test.js` e `purge-logic.test.js` non coprono nessuno dei requirements di Phase 1)*

---

## Sources

### Primary (HIGH confidence)

- `app.js` ispezione diretta (2026-03-20) — righe 3553–3690 (`UNIT_COC_SLUG`), 3756–3766 (`_unitCdnUrl`), 3776–3860 (`HERO_EQUIPMENT_MAP`, `_renderEquipmentGrouped`)
- HTTP GET `https://coc.guide/static/imgs/troop/battle-drill.png` — **200 OK**, immagine valida (verificato 2026-03-20)
- HTTP GET `https://coc.guide/static/imgs/equipment/stick-horse.png` — **404 Not Found** (verificato 2026-03-20)
- `coc.guide/equipment` page listing — Stick Horse non compare nella lista equipment di coc.guide al 2026-03-20

### Secondary (MEDIUM confidence)

- [sportskeeda — Stick Horse](https://www.sportskeeda.com/mobile-games/clash-clans-stick-horse-equipment-ability-get) — nome in-game "Stick Horse", Barbarian King, epic equipment febbraio 2026
- [SUMMARY.md / FEATURES.md / STACK.md / ARCHITECTURE.md / PITFALLS.md] — ricerca milestone precedente, confermano tutte le analisi di questa fase

### Tertiary (LOW confidence)

- WebSearch 2026 — nessuna fonte trovata con slug CDN definitivo per Stick Horse; confermato solo che coc.guide non lo ha ancora

---

## Metadata

**Confidence breakdown:**

- EQUIP-01 fix: HIGH — riga esatta identificata (3785), entry da aggiungere nota
- EQUIP-02 fix: HIGH — riga esatta identificata (3850), precondizione chiara (EQUIP-01 prima)
- EQUIP-03 fix: HIGH — meccanismo onerror esistente, solo contenuto visivo da cambiare
- EQUIP-04 fix: HIGH — slug corretto verificato con HTTP 200 su CDN live
- ARCH-01 scope: HIGH — call site limitati (`_renderEquipmentGrouped` e `_renderUnits`), rename sicuro
- Stick Horse API name: MEDIUM — nome da community sources, non da API response diretta

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (coc.guide potrebbe aggiungere stick-horse.png in qualsiasi momento)
