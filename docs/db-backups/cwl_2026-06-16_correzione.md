# Correzione stagione CWL `2026-06-16` (2ª CWL di giugno 2026) — 2026-11-24

**Problema.** Il 2026-08-02 alle 22:25 (ora italiana), durante una sessione di sviluppo, la stagione
`2026-06-16` è stata creata nel database come **copia** della 1ª CWL di giugno (`2026-06`) con una
query manuale (non presente nel repository né nelle migrazioni Supabase). Round, roster e statistiche
per giocatore della 2ª CWL non erano quindi reali.

**Fonti verificate.** Database (tutte le tabelle e i backup), storico Git completo (372 commit),
migrazioni Supabase, registro guerre CoC API. Le statistiche per giocatore e per round della 2ª CWL
non sono recuperabili da nessuna fonte.

**Recuperato dal registro guerre CoC API:**

| CWL | Fine | Formato | Stelle (vittorie incluse) | Distruzione (somma round) |
| --- | ---- | ------- | ------------------------- | ------------------------- |
| 1ª `2026-06` | 2026-06-09 | 15 vs 15 | 349 | 646,3 |
| 2ª `2026-06-16` | 2026-06-24 | 11 vs 11 | 224 | 667,9 |

**Modifiche (transazione unica, clan `#2J2VLPP9R`):**

- `cwl_seasons` `2026-06-16`: lega, posizione, stelle, attacchi, classifica gruppo e roster → `NULL`
  (erano copiati); `destruction` = 7347 (667,9 × 11, stessa formula delle altre stagioni).
- `cwl_wars` `2026-06-16`: rimossi i 7 round copiati dalla 1ª CWL.
- `cwl_history` `2026-06-16`: 34 righe con statistiche azzerate e `participated = NULL`;
  mantenuti i 4 bonus assegnati (geky888, ♠Aman♠, Pexy, Geped™).

**Backup:** `cwl_seasons_backup_20261124`, `cwl_wars_backup_20261124`, `cwl_history_backup_20261124`
(le righe `2026-06-16` di quest'ultimo sono identiche a quelle prima della correzione).
