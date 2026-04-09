# CoCBoard Bot — Guida (sorgente + Telegraph)

## Articolo pubblicato

Guida live: **[CoCBoard — Guida (Telegraph)](https://telegra.ph/CoCBoard--Guida-04-07)**

Per **modificarla**: apri il link → in basso **Edit** (stesso account Telegram con cui hai pubblicato) → **Publish**.

### Checklist se la pagina mostra ancora “Introduzione” o testo da bozza

Sulla [pagina attuale](https://telegra.ph/CoCBoard--Guida-04-07) succede spesso:

1. **Titolo sbagliato** — Il campo **Titolo** in alto non deve essere la prima sezione del testo. Metti lì solo: `CoCBoard — Guida`. La parola «Introduzione» va **nel corpo** come sottotitolo (formattazione H3 o grassetto), non come titolo dell’articolo.
2. **Frasi tipo «(Da formattare come citazione.)»** — Vanno **eliminate**; sono note per te, non per i lettori. Poi seleziona il paragrafo sotto e applica il pulsante **citazione** nella toolbar.
3. **Comandi con barra rovescia** (`logout\_clan`, `coc\_off`) — In **Edit**, cerca `\` e rimuovila prima di `_`. I comandi corretti sono tutt’uno: `/logout_clan`, `/esci_chat_global`, ecc.
4. **Incolla da Blocco note (Windows)** o dal blocco sotto — evita Word/HTML: a volte aggiungono escape strani.

---

## Importante: Telegraph non è Markdown

Se incolli da Cursor il testo con `#`, `**`, tabelle `|`, link `[testo](url)`, spesso Telegraph mostra tutto **letterale** (barre inverse, asterischi visibili).

**Ordine consigliato**

1. **Titolo** (campo in alto): `CoCBoard — Guida`.
2. **Corpo**: incolla da **«Corpo articolo (testo pulito)»** (fino a FINE COPIA).
3. **Formattazione**: per ogni riga tipo «Avvio», «Comandi», ecc. seleziona e scegli **Intestazione** (H3/H4) se disponibile; i due blocchi sotto «Avvio» e «Per aprire il menù» come **citazione**; comandi con **B** se vuoi.
4. **Link**: aggiungi il riferimento alla [guida Clash Manager](https://telegra.ph/Clash-Manager-Guida---It-11-07) con il pulsante link sul testo «guida Clash Manager».

---

## Corpo articolo (testo pulito, incolla in Telegraph)

Copia da qui fino a «FINE COPIA» (senza la riga FINE COPIA). Nel titolo dell’editor non ripetere questo testo.

Introduzione

CoCBoard è il bot Telegram legato alla dashboard web del clan: membri, CWL, bonus, guerre, ricerche e classifiche. Stile simile alla guida Clash Manager su Telegraph (link: telegra.ph Clash Manager Guida It).

Avvio

Dopo aver aperto il bot in chat privata, usa Accedi o Registrati. Password e chiave API in-game non vanno mai scritte nel gruppo: solo in privato con il bot.

Per aprire il menù:

In gruppo è consigliato /cocboard, così eviti conflitti con altri bot che usano /start. In privato /start e /cocboard aprono entrambi il menù.

Aggiungi il bot al gruppo del clan

Porta il bot nel gruppo o canale Telegram del clan. Per un uso completo (membri, CWL, guerre senza login per tutti) serve che Capo, Co-Capo o Admin (ruolo sul sito CoCBoard) completino il collegamento chat — clan (vedi sotto).

È utile promuovere il bot amministratore se vuoi che possa eliminare messaggi sensibili (es. token dopo il link) o gestire meglio la chat.

Collegare la chat al clan (Capo / Co-Capo / Admin)

1. Il Capo (o Co-Capo / Admin) apre il bot in privato ed effettua Accedi.
2. Dal menù sceglie «Aggiungi a canale/gruppo» e segue i passi: ottiene un TOKEN a uso singolo (valido circa un’ora).
3. Aggiunge il bot al gruppo come membro (idealmente admin).
4. Nel gruppo invia: /linkclan TOKEN (sostituisci TOKEN con quello ricevuto).

Dopo il collegamento, nel gruppo compaiono Membri, CWL, Guerre anche per chi non ha account. Massimo 3 gruppi o canali collegati per clan; per scollegare: /unlinkclan nella chat da staccare (stessi permessi).

Se il messaggio di benvenuto non compare, rimuovi il bot dal gruppo e riaggiungilo dal flusso in privato.

Accedi, registrati, clan sul profilo

Accedi — username CoCBoard, tag villaggio #… o email, poi password.

Registrati — tag villaggio, poi chiave API da CoC (Impostazioni, più, mostra chiave), password, email facoltativa.

Nessun clan in game sul profilo? Usa /setclan #TAG (override). Per tornare al clan del profilo: /logout_clan.

Cosa trovi nel menù (dopo il login)

• Community — chat globale e reclutamento (regole antispam: niente link esterni, niente cancelletto nel testo dei messaggi, strike/mute/ban). Uscita: pulsante Esci oppure /esci_chat_global; bozza reclutamento: /annulla_reclutamento.

• Cerca / Classifica — villaggio, clan, top trofei Italia e mondo.

• Membri, CWL, Bonus, Guerre, Profilo — dati del clan collegato al contesto.

• Pulsanti (web) — Mini App / sito; se hai già fatto Accedi sul bot spesso non serve reinserire la password.

Bonus CWL (solo Capo e Co-Capo in privato)

Dal menù Bonus: assegnazione manuale oppure flusso Assistito (numero bonus, criteri, es. escludere chi ha avuto bonus la stagione precedente, partecipazione, attacchi completi, peso TH sul roster). È un suggerimento: in conferma puoi aggiungere o togliere nomi fino al massimo scelto, poi Salva.

Comandi

[A] = solo amministratori della chat Telegram (o ruolo indicato).
[L] = Capo, Co-Capo o Admin CoCBoard.

Chat privata

/start, /cocboard — menù principale
/help — guida rapida
/assistenza — hub assistenza / ticket se attivo
/esci — logout
/skip — salta o completa il tutorial dopo login
/setclan #TAG — clan da mostrare (override)
/logout_clan — rimuove solo l’override setclan
/player #TAG — scheda giocatore
/adminbot — pannello admin bot (solo admin supporto)
/esci_chat_global — esci dalla chat globale
/annulla_reclutamento — annulla bozza reclutamento

Gruppo o canale (dopo collegamento clan)

/cocboard — menù clan
/membri — elenco membri
/info — info clan
/cwl — CWL
/bonus — bonus (assegnazione da [L] in privato se previsto)
/guerre — registro guerre e leghe
/cerca — menu ricerca
/classifica — menu classifiche
/cerca_clan nome — cerca clan (minimo 3 caratteri)
/clan — suggerimenti su setclan e cerca_clan
/linkclan TOKEN — [L] collega questa chat al clan
/unlinkclan — [L] scollega questa chat
/coc_status — stato bot attivo o in pausa
/coc_off — [A] pausa bot in questa chat
/coc_on — [A] riattiva bot in questa chat

Ovunque

/assistenza — in gruppo può reindirizzare alla chat privata del bot

Note finali

I dati live arrivano dall’API Clash of Clans tramite CoCBoard. War log e visibilità dipendono dalle impostazioni in game.

Per il deploy del bot: nel repository, file telegram-bot/DEPLOY-COCBOARD-BOT.md.

FINE COPIA

---

## Copia Markdown (solo per README / GitHub / note)

Questa versione serve in Cursor o su GitHub; **non** incollarla così com’è in Telegraph.

### Introduzione

**CoCBoard** è il bot Telegram legato alla dashboard web del clan: membri, CWL, bonus, guerre, ricerche e classifiche. Riferimento stile: [guida Clash Manager (Telegraph)](https://telegra.ph/Clash-Manager-Guida---It-11-07).

### Avvio

> Dopo aver aperto il bot in **chat privata**, usa **Accedi** o **Registrati**. Password e **chiave API in-game** non vanno mai scritte nel gruppo: solo in privato con il bot.

> In **gruppo** è consigliato **`/cocboard`**, così eviti conflitti con altri bot che usano **`/start`**. In privato **`/start`** e **`/cocboard`** aprono entrambi il menù.

### Aggiungi il bot al gruppo del clan

> Porta il bot nel **gruppo** o **canale** Telegram del clan. Per un uso completo serve che **Capo**, **Co-Capo** o **Admin** completino il **collegamento chat ↔ clan**.

È utile **promuovere il bot amministratore** se vuoi che possa eliminare messaggi sensibili (es. token dopo il link).

### Collegare la chat al clan **[Capo / Co-Capo / Admin]**

> 1. Il **Capo** (o Co-Capo / Admin) apre il bot in **privato** ed effettua **Accedi**.
> 2. Dal menù sceglie **«Aggiungi a canale/gruppo»** e segue i passi: ottiene un **TOKEN** a uso singolo (valido circa un’ora).
> 3. Aggiunge il bot al **gruppo** come membro (idealmente **admin**).
> 4. Nel gruppo invia: **`/linkclan TOKEN`**.

Massimo **3** gruppi/canali per clan; **`/unlinkclan`** per scollegare.

### Accedi, registrati, clan sul profilo

**Accedi** — username CoCBoard, tag **`#...`** o email, poi password.

**Registrati** — tag → **chiave API** CoC → password → email (facoltativa).

**Override:** **`/setclan #TAG`** · **`/logout_clan`** rimuove solo l’override.

### Menù dopo il login

- **Community** — chat globale e reclutamento; **`/esci_chat_global`** / **Esci**; **`/annulla_reclutamento`** per bozza reclutamento.
- **Cerca** / **Classifica**
- **Membri**, **CWL**, **Bonus**, **Guerre**, **Profilo**
- **(web)** — Mini App, spesso senza ridigitare password se già loggato.

### Bonus CWL **[Capo / Co-Capo, privato]**

Manuale o **Assistito**; conferma e **Salva**.

### Tabelle comandi (Markdown)

| Ambito | Comando | Descrizione |
|--------|---------|-------------|
| Privato | `/start`, `/cocboard` | Menù |
| Privato | `/help` | Guida |
| Privato | `/assistenza` | Assistenza |
| Privato | `/esci` | Logout |
| Privato | `/skip` | Tutorial |
| Privato | `/setclan #TAG` | Override clan |
| Privato | `/logout_clan` | Reset override |
| Privato | `/player #TAG` | Scheda player |
| Privato | `/adminbot` | Admin bot |
| Privato | `/esci_chat_global` | Esci chat globale |
| Privato | `/annulla_reclutamento` | Annulla bozza |
| Gruppo | `/cocboard` | Menù |
| Gruppo | `/membri`, `/info`, `/cwl`, `/bonus`, `/guerre` | Dati clan |
| Gruppo | `/cerca`, `/classifica` | Ricerca / ranking |
| Gruppo | `/cerca_clan nome` | Cerca clan |
| Gruppo | `/linkclan TOKEN` | **[L]** Link |
| Gruppo | `/unlinkclan` | **[L]** Unlink |
| Gruppo | `/coc_status` | Stato |
| Gruppo | `/coc_off`, `/coc_on` | **[A]** Pausa / on |

### Note finali

API Supercell; checklist deploy: `telegram-bot/DEPLOY-COCBOARD-BOT.md`.
