# Roadmap: CoCBoard v2.0 — UI/UX Evolution

## Overview

v2.0 evolves the existing working dashboard in five focused phases. Phases 1 and 2 eliminate the visible broken things (wrong equipment grouping, broken global leaderboards) and polish the rankings area before any structural work begins. Phase 3 restructures "Il mio clan" with sub-tabs and lays the shared-state foundation. Phase 4 builds the reusable WarDetailView component that both clan contexts need. Phase 5 completes the milestone by delivering advanced clan search with full sub-tab parity. All changes land in app.js and render-proxy/index.js — no new Vercel functions, no new dependencies.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Equipment Fix e Asset Mapper** - Corregge i bug equipaggiamenti eroe e centralizza la gestione degli asset immagine
- [ ] **Phase 2: Rankings Polish** - Completa la sezione classifiche con stemmi, clan crest, righe cliccabili e refresh forzato
- [ ] **Phase 3: Ristrutturazione "Il mio clan" e Stato Condiviso** - Introduce le sotto-tab e il foundation architetturale per i dati clan
- [ ] **Phase 4: WarDetailView Component** - Aggiunge il dettaglio attacchi per guerre classiche e turni CWL
- [ ] **Phase 5: Cerca Clan Avanzato** - Filtri ricerca avanzati e UI "Cerca clan" identica a "Il mio clan"

## Phase Details

### Phase 1: Equipment Fix e Asset Mapper
**Goal**: Gli utenti vedono gli equipaggiamenti degli eroi raggruppati correttamente, con immagini giuste e un placeholder per gli asset mancanti
**Depends on**: Nothing (first phase)
**Requirements**: EQUIP-01, EQUIP-02, EQUIP-03, EQUIP-04, ARCH-01
**Success Criteria** (what must be TRUE):
  1. Lo Stick Horse appare sotto il Barbarian King nel profilo eroe, non nella sezione "Altro"
  2. La sezione "Altro" non e' piu' visibile nel profilo equipaggiamenti
  3. Il Battle Drill mostra l'immagine corretta (non un'immagine sbagliata)
  4. Gli equipaggiamenti senza immagine mostrano un'icona placeholder neutra (non il quadratino con l'iniziale)
  5. Tutti i punti di rendering immagini usano la funzione centralizzata getAssetUrl() — nessuna logica immagine duplicata in app.js
**Plans**: 2 plans
Plans:
- [ ] 01-01-PLAN.md — Test + fix costanti statiche (EQUIP-01, EQUIP-02, EQUIP-04)
- [ ] 01-02-PLAN.md — SVG placeholder + getAssetUrl centralizzata (EQUIP-03, ARCH-01)

### Phase 2: Rankings Polish
**Goal**: La sezione classifiche e' completamente funzionante: dati globali caricati, stemmi corretti, clan crest visibili, righe cliccabili, refresh manuale disponibile
**Depends on**: Phase 1
**Requirements**: CLAS-01, CLAS-02, CLAS-03, CLAS-04, CLAS-05, CLAS-06, CLAS-07
**Success Criteria** (what must be TRUE):
  1. La classifica "Giocatori + Globale" si carica e mostra dati reali (nessun errore notFound)
  2. La classifica "Clan + Globale" mostra dati (non "Nessun dato")
  3. La colonna TH nelle classifiche mostra il livello numerico corretto per ogni giocatore
  4. Gli stemmi delle leghe visualizzati sono quelli attuali e ogni riga clan mostra il clan crest
  5. Il tasto "Aggiorna" forza una chiamata fresca all'API e cliccando un nome si apre il profilo relativo
**Plans**: TBD

### Phase 3: Ristrutturazione "Il mio clan" e Stato Condiviso
**Goal**: "Il mio clan" e' navigabile tramite tre sotto-tab distinte, con stato condiviso corretto e senza regressioni sui selettori CSS delle sotto-tab esistenti
**Depends on**: Phase 2
**Requirements**: CLAN-01, CLAN-02, ARCH-02
**Success Criteria** (what must be TRUE):
  1. "Il mio clan" mostra tre sotto-tab navigabili: Membri, War Classiche, Cronologia CWL
  2. Il "Registro Guerre" non e' piu' un tab di navigazione principale separato — e' accessibile come sotto-tab di "Il mio clan"
  3. Navigare tra le sotto-tab non deattiva per errore le sotto-tab attive in altre sezioni della pagina
  4. L'oggetto window._viewedClan e' disponibile e mantiene i dati del clan attualmente visualizzato
**Plans**: TBD

### Phase 4: WarDetailView Component
**Goal**: Cliccando su una guerra classica o su un turno CWL si apre un dettaglio completo con attacchi, stelle e distruzione per membro
**Depends on**: Phase 3
**Requirements**: CLAN-03, CLAN-04
**Success Criteria** (what must be TRUE):
  1. Cliccando una guerra classica nel tab "War Classiche" si apre il dettaglio con attacchi effettuati, stelle e distruzione per ogni membro
  2. Cliccando una stagione CWL nel tab "Cronologia CWL" si apre il dettaglio suddiviso per i 7 turni con risultati per turno
  3. Il dettaglio guerra e' generato da una singola funzione buildWarDetailHTML() condivisa (non da codice duplicato per i due contesti)
**Plans**: TBD

### Phase 5: Cerca Clan Avanzato
**Goal**: La ricerca clan supporta filtri avanzati e il clan cercato viene visualizzato con la stessa UI completa di "Il mio clan"
**Depends on**: Phase 4
**Requirements**: CERCA-01, CERCA-02, CERCA-03
**Success Criteria** (what must be TRUE):
  1. La ricerca clan accetta filtri: numero min/max membri, paese, tipo clan (aperto/su invito/chiuso), livello clan minimo; il filtro TH minimo e' applicato client-side
  2. Un clan cercato viene visualizzato con le stesse tre sotto-tab di "Il mio clan": Membri, War Classiche, Cronologia CWL
  3. Anche per i clan cercati sono disponibili i dettagli attacchi e la cronologia CWL (non solo le info base)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Equipment Fix e Asset Mapper | 0/2 | Planned | - |
| 2. Rankings Polish | 0/? | Not started | - |
| 3. Ristrutturazione "Il mio clan" e Stato Condiviso | 0/? | Not started | - |
| 4. WarDetailView Component | 0/? | Not started | - |
| 5. Cerca Clan Avanzato | 0/? | Not started | - |
