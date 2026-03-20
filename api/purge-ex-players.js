const { createClient } = require('@supabase/supabase-js');

/**
 * Purge ex-player data older than 6 months.
 * Chiamato dal cron job mensile (1° del mese alle 07:00 UTC).
 * Può anche essere chiamato manualmente da un admin.
 *
 * Regola: per ogni (clan_tag, player_name) che non è più nel clan,
 * se l'ultima stagione attiva (still_in_clan=true) è >= 6 mesi fa → elimina.
 */
module.exports = async (req, res) => {
    // Autenticazione: CRON_SECRET (Vercel cron) o SYNC_SECRET (chiamata manuale)
    const authHeader = req.headers['authorization'] || '';
    const cronSecret  = process.env.CRON_SECRET  || '';
    const syncSecret  = process.env.SYNC_SECRET   || '';
    const providedKey = authHeader.replace('Bearer ', '').trim();

    // Rifiuta sempre se nessun secret è configurato (nessun bypass in sviluppo)
    if (!cronSecret && !syncSecret) {
        return res.status(401).json({ error: 'CRON_SECRET o SYNC_SECRET non configurati.' });
    }
    // Accetta se il token corrisponde ad almeno uno dei secret configurati
    const validCron = cronSecret && providedKey === cronSecret;
    const validSync = syncSecret && providedKey === syncSecret;
    if (!validCron && !validSync) {
        return res.status(401).json({ error: 'Non autorizzato.' });
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY mancante.' });

    const supabase = createClient(process.env.SUPABASE_URL, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const RETENTION_MONTHS = 6;

    try {
        // 1. Carica tutti i record cwl_history (clan_tag, player_name, season, still_in_clan)
        const { data: allHistory, error: histErr } = await supabase
            .from('cwl_history')
            .select('clan_tag, player_name, season, still_in_clan');

        if (histErr) throw new Error('cwl_history: ' + histErr.message);

        // 2. Carica tutti i membri attivi (per non eliminare chi è ancora nel clan)
        const { data: activeMembers, error: membErr } = await supabase
            .from('members')
            .select('clan_tag, name');

        if (membErr) throw new Error('members: ' + membErr.message);

        // Mappa veloci: "clan_tag|name" → true
        const activeMemberSet = new Set(
            (activeMembers || []).map(m => `${m.clan_tag}|${m.name}`)
        );

        // 3. Costruisci mappa: "clan_tag|player_name" → { lastActiveSeason, hasExRecord }
        const playerData = {};
        (allHistory || []).forEach(r => {
            const key = `${r.clan_tag}|${r.player_name}`;
            if (!playerData[key]) {
                playerData[key] = { clanTag: r.clan_tag, playerName: r.player_name, lastActiveSeason: null, hasExRecord: false };
            }
            if (r.still_in_clan) {
                if (!playerData[key].lastActiveSeason || r.season > playerData[key].lastActiveSeason) {
                    playerData[key].lastActiveSeason = r.season;
                }
            } else {
                playerData[key].hasExRecord = true;
            }
        });

        // 4. Determina chi eliminare
        const now = new Date();
        const nowYear  = now.getFullYear();
        const nowMonth = now.getMonth() + 1; // 1-based
        const nowSeason = `${nowYear}-${String(nowMonth).padStart(2, '0')}`;

        const toPurge = [];
        Object.values(playerData).forEach(p => {
            // Skip se ancora membro attivo
            if (activeMemberSet.has(`${p.clanTag}|${p.playerName}`)) return;
            // Skip se non ha mai avuto un record "ex"
            if (!p.hasExRecord) return;
            // Se non ha MAI avuto una stagione attiva (solo importato come ex), purga subito
            if (!p.lastActiveSeason) {
                toPurge.push(p);
                return;
            }
            // Calcola scadenza: lastActiveSeason + RETENTION_MONTHS
            const [ly, lm] = p.lastActiveSeason.split('-').map(Number);
            // Aggiunge RETENTION_MONTHS mesi
            let expYear  = ly + Math.floor((lm - 1 + RETENTION_MONTHS) / 12);
            let expMonth = ((lm - 1 + RETENTION_MONTHS) % 12) + 1;
            const expSeason = `${expYear}-${String(expMonth).padStart(2, '0')}`;
            // Se la stagione corrente ha superato la scadenza → elimina
            if (nowSeason > expSeason) {
                toPurge.push(p);
            }
        });

        if (!toPurge.length) {
            return res.status(200).json({ ok: true, purged: 0, message: 'Nessun dato scaduto.' });
        }

        // 5. Elimina in batch (max 50 per volta per evitare timeout)
        let purgedCount = 0;
        for (const p of toPurge) {
            const { error: delHistErr } = await supabase
                .from('cwl_history')
                .delete()
                .eq('clan_tag', p.clanTag)
                .eq('player_name', p.playerName);

            if (delHistErr) {
                console.error(`Errore eliminazione cwl_history ${p.clanTag}|${p.playerName}:`, delHistErr.message);
                continue;
            }

            // Elimina anche da cwl_bonuses (player_name per questo clan_tag)
            await supabase
                .from('cwl_bonuses')
                .delete()
                .eq('clan_tag', p.clanTag)
                .eq('player_name', p.playerName);

            purgedCount++;
        }

        return res.status(200).json({
            ok: true,
            purged: purgedCount,
            message: `${purgedCount} ex-giocatori eliminati (retention > ${RETENTION_MONTHS} mesi).`,
        });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
