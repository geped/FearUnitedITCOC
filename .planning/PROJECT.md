# CoCBoard — Fear United IT Dashboard

## What This Is

Dashboard web per la gestione del clan Clash of Clans **Fear United IT** (`#2J2VLPP9R`).
Permette agli admin del clan di sincronizzare membri, calcolare bonus CWL, gestire il war log e visualizzare statistiche comparative. UI in italiano, accessible via browser senza installazione.

## Core Value

Admin e co-capi possono gestire l'intero ciclo CWL — assegnazione bonus, storico guerre e performance membri — da un'unica interfaccia senza uscire dal browser.

## Requirements

### Validated (v1.0 — shippped 2026-03-20)

- ✓ Sincronizzazione giornaliera roster clan da CoC API — Phase 1
- ✓ Calcolo bonus CWL con formula merit (stelle/req×40 + distruz_media×0.2 + fatti/req×20) — Phase 1
- ✓ Storico CWL per stagione (cwl_history) — Phase 1
- ✓ War log guerre classiche — Phase 1
- ✓ Gestione utenti con ruoli (admin, co-capo, anziano, membro, utente) — Phase 1
- ✓ Auth Supabase con login username@fearunited.internal — Phase 1
- ✓ RLS corretto su cwl_bonuses (SELECT-only per anon) e members (write via SERVICE_ROLE_KEY) — Phase 1
- ✓ Endpoint admin protetti da requireRole JWT — Phase 1
- ✓ Proxy Render.com con SERVICE_ROLE_KEY per scritture — Phase 1
- ✓ purge-ex-players con auth corretta — Phase 1
- ✓ proxy-client.js e require-role.js come utility condivise — Phase 1
- ✓ schema-MASTER.sql unificato — Phase 1
- ✓ 11 test unitari (formula bonus + logica purge) — Phase 1
- ✓ Warm-up render-proxy da sync-members cron — Phase 1

### Active (v2.0)

- [ ] Fix Hero Equipment: Stick Horse sotto Barbarian King, eliminazione sezione "Altro"
- [ ] Fix asset mancanti equipaggiamenti: placeholder standard invece di iniziale
- [ ] Fix Battle Drill: immagine corretta
- [ ] Fix classifiche globali: "Giocatori + Globale" e "Clan + Globale" funzionanti
- [ ] Fix colonna TH in classifiche: mostra livello corretto (non "?")
- [ ] Aggiornamento stemmi leghe e visualizzazione clan crest nelle classifiche
- [ ] Classifiche interattive: nomi cliccabili, refresh forzato
- [ ] Ristrutturazione "Il mio clan": War Log come sotto-tab, sezioni Membri/War Classiche/Cronologia CWL
- [ ] WarDetailView riutilizzabile per guerre classiche e CWL (con 7 turni)
- [ ] Ricerca clan avanzata: filtri membri, paese, tipo, TH minimo
- [ ] UI "Cerca clan" identica a "Il mio clan" con stesso dettaglio
- [ ] Asset mapper centralizzato (ID truppa/equipment → percorso immagine)
- [ ] Stato globale condiviso per clan visualizzato (mio clan e cerca)

### Out of Scope

- Ricerca membro per nome — CoC API non espone endpoint di ricerca per nome nativo; richiederebbe scan su clan specifici
- Notifiche push/email automatiche per guerre — complessità elevata, non richiesta
- Multi-clan support — prodotto single-clan by design
- React/Vue o altro framework — vanilla JS è la scelta tecnica confermata

## Context

**Stack:** Vanilla JS SPA (app.js monolite 4650 righe) + Vercel serverless (12 functions Hobby) + Render.com Express proxy + Supabase PostgreSQL.

**Vincoli critici:**
- Vercel Hobby: max 12 serverless functions — attualmente 12/12
- Vercel Hobby: cron solo giornaliero
- app.js è un monolite — tutte le modifiche UI avvengono lì
- Render.com piano gratuito: cold start ~30s dopo 15min inattività

**Bug noti (da piano strategico):**
- Stick Horse mappato in "Altro" invece che sotto Barbarian King
- Battle Drill mostra immagine errata
- Classifiche globali restituiscono notFound / nessun dato
- Colonna TH mostra "?" invece del livello
- Stemmi leghe obsoleti

## Constraints

- **Tech stack**: Vanilla JS, no framework — architettura esistente non va rivoluzionata
- **Vercel Hobby 12 functions**: non aggiungere nuove function senza rimuoverne una
- **Render.com gratuito**: cold start accettato, nessun upgrade pianificato
- **app.js monolite**: modifiche incrementali, non riscrittura

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vanilla JS no framework | Semplicità, zero build step, nessuna dipendenza | ✓ Good |
| Supabase + Vercel + Render | Hobby plan gratuito, sufficiente per clan privato | ✓ Good |
| proxy-client.js utility | Riduce duplicazione boilerplate API da 11.59% a ~3% | ✓ Good |
| Bug fix prima di nuove feature (v2.0) | Valore immediato, meno rischio di regressioni | — Pending |
| Asset mapper centralizzato | Facilita correzione futura di immagini sbagliate | — Pending |

---
*Last updated: 2026-03-20 after v2.0 milestone initialization*
