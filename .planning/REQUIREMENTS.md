# Requirements: CoCBoard v2.0 — Evoluzione UI/UX

**Defined:** 2026-03-20
**Core Value:** Admin e co-capi possono gestire l'intero ciclo CWL e visualizzare statistiche di clan da un'unica interfaccia browser

---

## v2.0 Requirements

### Equipment & Profilo

- [x] **EQUIP-01**: L'utente vede lo "Stick Horse" correttamente elencato sotto il Barbarian King (non nella sezione "Altro")
- [x] **EQUIP-02**: La sezione "Altro" per gli equipaggiamenti non è più presente nel profilo
- [x] **EQUIP-03**: Gli equipaggiamenti senza immagine mostrano un placeholder standard (icona neutra) invece del quadratino con l'iniziale
- [x] **EQUIP-04**: Il Battle Drill (Trivella da battaglia) mostra l'immagine corretta

### Classifiche

- [ ] **CLAS-01**: La classifica "Giocatori + Globale" si carica senza errore `notFound`
- [ ] **CLAS-02**: La classifica "Clan + Globale" mostra dati (non "Nessun dato")
- [ ] **CLAS-03**: Gli stemmi delle leghe visualizzati sono quelli attuali (non le versioni obsolete)
- [ ] **CLAS-04**: Le tabelle classifiche mostrano lo stemma del clan (clan crest) oltre al nome
- [ ] **CLAS-05**: La colonna TH nelle classifiche mostra il livello numerico corretto — *nota ricerca: dipende da CLAS-01/02 (stesso root cause: locationId sbagliato); si risolve automaticamente con il fix rankings*
- [ ] **CLAS-06**: Il tasto "Aggiorna" forza una chiamata fresca all'API CoC (ignora cache)
- [ ] **CLAS-07**: Cliccando il nome di un giocatore/clan in classifica si apre il relativo profilo o dettaglio

### Il Mio Clan — Struttura

- [ ] **CLAN-01**: La sezione "Registro Guerre" è integrata come sotto-tab di "Il mio clan" (non sezione di navigazione separata)
- [ ] **CLAN-02**: "Il mio clan" ha tre sotto-tab navigabili: Membri, War Classiche, Cronologia CWL
- [ ] **CLAN-03**: Cliccando su una guerra classica si apre un WarDetailView con attacchi effettuati, stelle, distruzione e performance per membro
- [ ] **CLAN-04**: Cliccando su una stagione CWL si apre il dettaglio con suddivisione per i 7 turni (giorni) e risultati per turno

### Cerca — Avanzato

- [ ] **CERCA-01**: La ricerca clan supporta filtri: numero minimo/massimo membri, paese, tipo clan (aperto / su invito / chiuso), livello clan minimo; il filtro "TH minimo" è client-side (CoC API non espone minTownHallLevel server-side)
- [ ] **CERCA-02**: Un clan cercato viene visualizzato con UI identica a "Il mio clan" (stesse sotto-tab: Membri, War Classiche, Cronologia CWL)
- [ ] **CERCA-03**: Anche per i clan cercati sono disponibili i dettagli attacchi, stelle e cronologia CWL (non solo info base)

### Architettura & Refactoring

- [x] **ARCH-01**: Esiste un asset mapper JS centralizzato che associa ogni ID truppa/equipaggiamento al percorso della sua immagine; tutte le visualizzazioni immagini lo usano
- [ ] **ARCH-02**: Esiste un oggetto di stato globale condiviso per il clan attualmente visualizzato, usato sia da "Il mio clan" che da "Cerca"

---

## v3.0 Requirements (deferred)

### Ricerca Avanzata

- **CERCA-04**: Ricerca membro per nome (richiederebbe scan su clan o endpoint non standard CoC API)

### Import & Automazione

- **IMP-01**: UI integrata per import bonus da Excel (eliminazione flusso Python manuale)

### Performance

- **PERF-01**: Cache in-memory nel render-proxy per `/cwl-live` (riduce fetch CoC API da ~30 a 1 per TTL)
- **PERF-02**: `purge-ex-players` usa query SQL aggregata invece di full table scan in memoria

### Robustezza

- **ROB-01**: Bonus CWL salvati per tag giocatore (non per nome stringa) — richiede migrazione schema

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Ricerca membro per nome | CoC API non espone endpoint nativo; richiederebbe scan su clan specifici — complessità sproporzionata |
| Notifiche push/email automatiche guerre | Complessità elevata, non richiesta nel piano strategico |
| Multi-clan support | Prodotto single-clan by design |
| React/Vue o altro framework | Vanilla JS è la scelta tecnica consolidata |
| Mobile app nativa | Web-first |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EQUIP-01 | Phase 1 | Complete |
| EQUIP-02 | Phase 1 | Complete |
| EQUIP-03 | Phase 1 | Complete |
| EQUIP-04 | Phase 1 | Complete |
| CLAS-01 | Phase 2 | Pending |
| CLAS-02 | Phase 2 | Pending |
| CLAS-03 | Phase 2 | Pending |
| CLAS-04 | Phase 2 | Pending |
| CLAS-05 | Phase 2 | Pending |
| CLAS-06 | Phase 2 | Pending |
| CLAS-07 | Phase 2 | Pending |
| CLAN-01 | Phase 3 | Pending |
| CLAN-02 | Phase 3 | Pending |
| CLAN-03 | Phase 4 | Pending |
| CLAN-04 | Phase 4 | Pending |
| CERCA-01 | Phase 5 | Pending |
| CERCA-02 | Phase 5 | Pending |
| CERCA-03 | Phase 5 | Pending |
| ARCH-01 | Phase 1 | Complete |
| ARCH-02 | Phase 3 | Pending |

**Coverage:**
- v2.0 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after v2.0 milestone initialization*
