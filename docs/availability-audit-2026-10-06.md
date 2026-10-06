# Audit disponibilità e timeout — 6 ottobre 2026

## Perimetro e prove

Analisi statica di API Vercel, client HTTP condivisi, proxy Render,
bootstrap del bot, configurazione cron e principali chiamate frontend.
Test locali con Node. Nessun accesso ai log o alle impostazioni live dei provider:
questo audit non attribuisce i 3718 timeout segnalati a una route specifica.
L'email identifica `fearunited-coc`; `.vercel/project.json` identifica `cocboard`.
Prima di una verifica live va stabilito quale deployment serve il traffico reale.

Il proprietario conferma che il monitor esterno è **cron-job.org**, non GitHub
Actions. Nel checkout non è presente `.github/workflows`. GitHub CLI non risulta
autenticata. URL, frequenze, metodi e storico del monitor non sono ancora noti.
Un job di disponibilità deve raggiungere direttamente l'URL pubblico Render
`/health`, ad esempio ogni 5 minuti, invece di passare da una funzione Vercel.
I job di sincronizzazione/salvataggio restano distinti e richiedono i relativi
header di autenticazione. Nessun secret va inserito nell'URL.
Il monitor esterno può risvegliare Render ma non supera quote o indisponibilità
del provider; controllare gli errori e l'eventuale disabilitazione del job.

Configurazione poi fornita: cron-job.org chiama ogni 5 minuti
`https://cocboard.vercel.app/api/lookup?type=ping`, timeout 30s, Authorization.
Questo genera circa 2016 invocazioni Vercel/settimana. Il codice ping attende
Render fino a 28s: può fallire durante un risveglio più lungo. Corretto il falso
successo HTTP 200 per risposte Render non-2xx; mantenuto il limite specifico 28s.
Configurazione consigliata per il solo keepalive: GET diretto
`https://fearuniteditcoc.onrender.com/health` ogni 5 minuti, nessun header segreto,
notifiche fallimento/recupero/disattivazione attive. L'URL va confermato nella
dashboard Render. Questa configurazione è proposta, non applicata al job esterno.
Il segreto condiviso in chat va ruotato nelle impostazioni; non è salvato qui.

## Correzioni preparate

| Problema | Correzione |
| --- | --- |
| Fetch senza scadenza nel proxy e in diversi endpoint | Helper HTTP condiviso: cancellazione anche durante lettura body, cancellazione del chiamante preservata, nessun retry automatico delle scritture |
| Sync: health 35s + richiesta 50s dentro funzione da 60s | Eliminato preflight; singola chiamata con limite 45s |
| Cron GET rifiutati da sync e salvataggi | GET autenticato supportato; POST manuali mantenuti |
| Cron sync senza clanTag | Lettura clan dai membri, deduplicazione e massimo tre sync concorrenti, deadline globale di 50s |
| Batch salvataggi HTTP 4xx/5xx apparivano riusciti | Controllo status upstream e risposta 502 per fallimenti parziali |
| Timeout/risposta HTML Render nel client comune | Errore controllato 503/502, no-store, Retry-After per timeout |
| Durata non esplicita negli endpoint principali | Budget di 60s per API root e admin |
| Ping localhost inefficace rispetto all'ingress Render | Uso RENDER_EXTERNAL_URL se configurato; resta best effort |
| Fetch DB nel proxy senza scadenza | Client Supabase del proxy usa fetch limitato a 15s |

Il limite HTTP è per richiesta, non una deadline complessiva di tutte le operazioni
di un endpoint. Query DB multiple e cicli CWL possono ancora superare il budget
globale. Un timeout della connessione Vercel non annulla una scrittura già avviata
su Render: non introdurre retry ciechi di operazioni mutanti.

## Rischi residui da verificare in produzione

- Render: standby dopo 15 minuti senza traffico inbound; risveglio circa un minuto.
  Il self-ping non riparte da un processo spento e non protegge da restart o quote.
- Render: 750 ore gratuite mensili condivise dal workspace. Due servizi sempre
  attivi superano la quota; verificare che sia attivo solo il servizio unificato.
- Banda e build sono limitate. Senza metodo di pagamento Render può sospendere
  il servizio a quota esaurita; con pagamento può applicare costi extra.
- Vercel Hobby: cron minimo giornaliero. Config attuale ha quattro dichiarazioni
  giornaliere sullo stesso endpoint di salvataggio: verificare comportamento e
  accettazione nel progetto live; non usarle come monitor di disponibilità.
- Batch proxy: Promise.allSettled su tutti i clan senza limite di concorrenza.
  Le routine CWL effettuano più richieste e scritture; servono conteggi reali dei
  clan e durate prima di dimensionare batch o introdurre checkpoint persistenti.
- Loop bot: intervalli in memoria cessano durante standby/restart. I loop del
  bootstrap unificato possono sovrapporre tick se la durata supera l'intervallo.
- Bootstrap webhook: drop_pending_updates=true può scartare messaggi accumulati
  durante un fermo. La scelta richiede valutare anche i wizard in memoria, perché
  processare messaggi vecchi dopo un restart può applicarli a uno stato diverso.
- Client bot: fallback da proxy locale a Vercel può ripetere la stessa richiesta
  verso il backend fallito, aumentando attese; raccogliere tempi e tipo di errore.
- Frontend: molte fetch senza deadline. Non aggiungere retry universali perché
  includono registrazione, carte e altre operazioni mutanti.
- Supabase: query lato Vercel e paginazione di grandi elenchi restano da misurare.
  Valutare quote, indici e pause del piano gratuito dalla dashboard reale.

## Verifica operativa necessaria

1. Confermare progetto Vercel, dominio e URL backend effettivi.
2. Filtrare runtime logs per FUNCTION_INVOCATION_TIMEOUT, route, timestamp,
   duration; correlare con restart/deploy Render.
3. Verificare Fluid Compute e configurazione effettiva dopo deploy.
4. Controllare utilizzo gratuito Vercel/Render/Supabase e servizi duplicati.
5. Verificare sync manuale, cron GET autenticato, salvataggi e webhook Telegram.
6. Confrontare tasso di timeout e 503 controllati dopo deploy: trasformare 504
   in 503 evita il kill della funzione ma non dimostra disponibilità del backend.

## Vincolo economico

Le modifiche non introducono dipendenze, piani o servizi a pagamento.
Con la piattaforma attuale è possibile migliorare la disponibilità gratuitamente,
ma non garantire backend continuamente attivo h24 o costo nullo a qualsiasi carico.
Nessun monitor o ping elimina quote, restart e limitazioni dei piani gratuiti.

Fonti:
- https://render.com/docs/free
- https://vercel.com/docs/functions/configuring-functions/duration
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://vercel.com/docs/cron-jobs/manage-cron-jobs
