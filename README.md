# Piattaforma Web Clan CWL

Questo progetto fornisce una dashboard front-end per gestire i membri di un clan Clash of Clans e calcolare i bonus CWL in base alle regole di merito.

## Struttura

- `index.html` - interfaccia utente principale
- `style.css` - stili base
- `firebase-config.js` - configurazione Firebase fornita dall'utente
- `app.js` - logica JavaScript per sincronizzare membri, calcolare punteggi e generare classifiche

## Architettura dati (Firestore)

Si usano due collezioni:

- `members` - documenti indicizzati per tag (senza #) con informazioni nome, ruolo, `firstSeen` (timestamp di primo rilevamento).
- `cwl_bonuses` - storico dei bonus assegnati (tag, data, banding)

## Funzionalità

1. **Sincronizzazione live** dei membri tramite l'API ufficiale di Supercell (clan tag `#2J2VLPP9R`, token incluso nel codice). Gli ingressi vengono salvati in Firestore.
2. **Visualizzazione** della tabella membri, con evidenza (sfondo rosso chiaro) per chi è entrato negli ultimi 7 giorni.
3. **Generazione classifica bonus** tramite un algoritmo che:
   - assegna punti per stelle e percentuale di distruzione
   - penalizza attacchi mancati
   - azzera punteggio se il giocatore ha già ricevuto bonus il mese precedente
4. Possibilità di estendere facilmente l'algoritmo con dati reali (war log, performance storica).

## Note di sviluppo

- Il calcolo dei punteggi usa attualmente dati fittizi; è necessario integrare gli endpoint di guerra per raccogliere statistiche reali.
- Le credenziali sono inserite direttamente per semplicità; in produzione vanno gestite tramite variabili ambiente o Cloud Functions.
- Per ospitare si può usare Firebase Hosting collegato al progetto `clanmanagercwl`. 

## Prossimi passi possibili

- Implementare l'alert visivo per richieste CWL da nuovi membri.
- Aggiungere report donate/ricevute.
- Automatizzare l'inserimento dei bonus e la rotazione storica.

## Backend (Cloud Functions)

Una directory `functions/` contiene un piccolo servizio Node.js per Firebase:

1. **syncMembers** – funzione pianificata (ogni 6 ore) che chiama l'API Supercell e aggiorna la collezione `members`.
2. **generateBonuses** – endpoint HTTPS/manuale che ricalcola le classifiche, applica penalità rotazione e popola `cwl_bonuses`.

Per avviare l'emulatore locale:

```bash
cd functions
npm install
npm run serve
```

### Inizializzare Firebase nel progetto

Devi eseguire `firebase init` **dalla cartella di progetto** (`C:\Users\pedro\Desktop\Claude\FearUnitedCoC`), non dalla tua home. Se lo lanci da un livello superiore vedrai il messaggio "You're about to initialize a Firebase project in this directory: C:\Users\pedro".

Quando ti vengono chieste le funzionalità, seleziona almeno:

- **Functions** (per le Cloud Functions già presenti)
- **Firestore** (se vuoi emulare o impostare regole/index)
- **Emulators** (puoi includere Firestore e Functions nell'emulatore)

Usando la barra spazio e Invio per confermare.

Dopo l'inizializzazione avrai un `firebase.json` e una sottocartella `functions` configurata.

Per il deploy reale serve la CLI Firebase (`firebase login` + `firebase deploy --only functions`).

Puoi invocare `generateBonuses` via chiamata HTTP (o pianificarla con un altro trigger se desiderato).

---

Questa base consente ai sistemi automatizzati di generare l'intero stack front-end e back-end; la logica umana si concentra solo sulle regole di merito e sulla configurazione dei database.