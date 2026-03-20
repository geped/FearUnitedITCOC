# Report Analisi Criticità e Refactoring - CoCBoard

**Data:** 20 Marzo 2026
**Analisi effettuata su:** Repository FearUnitedCoC

## 1. Panoramica delle Criticità Riscontrate

L'analisi automatizzata tramite `jscpd` e l'ispezione manuale hanno evidenziato tre aree principali di debito tecnico che aumentano il rischio di bug e rendono difficile la manutenzione.

### A. Duplicazione nelle API Serverless (Cartella `/api/`)
L'analisi `jscpd` ha rilevato una duplicazione dell'**11.59%** nelle funzioni serverless di Vercel. 
- **File coinvolti:** `clan-info.js`, `clan-members.js`, `cwl-stats.js`, `war-log.js`, `sync-members.js`.
- **Problema:** Ogni endpoint implementa autonomamente la logica di chiamata alla Clash of Clans API (o al proxy Render), la gestione del caching e la gestione degli errori. Se cambia il token o l'URL del proxy, bisogna modificare 5+ file.
- **Evidenza:** I blocchi di inizializzazione e i pattern di fetch sono identici tra `cwl-stats.js` e `war-log.js`.

### B. Il Monolito `app.js` (2636 righe)
Il file `app.js` contiene tutta la logica della Single Page Application (SPA).
- **Problema "Spaghetti Code":** Gestione dello stato, manipolazione del DOM (creazione tabelle), chiamate API e logica di calcolo (bonus CWL) sono tutte mescolate nello stesso file.
- **Rischio:** Modificare una funzione di UI (es. un modale) potrebbe inavvertitamente rompere una logica di calcolo dei bonus a causa di variabili globali o dipendenze non esplicite.

### C. Gestione degli Stili in `style.css` (2071 righe)
Simile a `app.js`, il file CSS è diventato difficile da navigare.
- **Problema:** Molti stili per componenti specifici (es. tabelle bonus, profili giocatori) sono sparsi nel file, rendendo difficile l'identificazione di selettori inutilizzati o conflitti.

---

## 2. Strategia di Refactoring Consigliata (Anti-Spaghetti)

L'obiettivo è decongestionare i file principali senza rompere le funzionalità (approccio *Surgical Refactoring*).

### Soluzione per le API: "Common CoC Client"
Estrarre la logica ripetuta in un modulo di utility condiviso.
1. Creare `api/_utils/coc-client.js`.
2. Centralizzare qui la configurazione (fetch, proxy URL, headers).
3. Importare questo client negli endpoint esistenti.
   *   *Vantaggio:* Riduzione immediata del codice duplicato e punto unico di configurazione.

### Soluzione per `app.js`: "Feature-Based Separation"
Senza "spezzare" il file in modo traumatico, si consiglia di spostare i blocchi logici in file separati mantenendo `app.js` come orchestratore principale.
1. **Bonus Logic:** Estrarre la formula `(stelle * 100) + destruction%...` in un file `js/logic/bonus-calculator.js`.
2. **UI Components:** Creare moduli per la generazione delle tabelle (es. `js/ui/table-generator.js`).
3. **API Layer:** Spostare le chiamate `fetch` verso Supabase e Vercel in `js/services/api-service.js`.

### Soluzione per evitare l'effetto "Spaghetti"
- **Incapsulamento:** Usare oggetti o classi per isolare lo stato di diverse sezioni della dashboard (es. `CWLManager`, `MemberManager`).
- **Data-Driven UI:** Invece di iniettare HTML tramite stringhe giganti in `app.js`, usare funzioni che accettano dati e restituiscono elementi DOM puliti.

---

## 3. Prossimi Passi per Claude

Per procedere con le modifiche in sicurezza:
1. **Test-Driven Refactoring:** Prima di spostare logica critica (come il calcolo bonus), scrivere dei test unitari per garantire che l'output rimanga identico.
2. **Migrazione Incrementale:** Non riscrivere tutto in una volta. Iniziare dalle API (meno rischiose) e poi passare alla logica di calcolo in `app.js`.
3. **Verifica Funzionalità:** Dopo ogni spostamento di codice, verificare che la UI carichi correttamente i dati e che i bonus vengano calcolati senza errori.

---
**Nota finale:** La struttura attuale è funzionale ma fragile. Il refactoring proposto mira a rendere il sistema modulare e pronto per future espansioni (es. gestione multi-clan o nuove leghe).
