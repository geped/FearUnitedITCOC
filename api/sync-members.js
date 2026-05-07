function isAuthorized(req) {
    const authHeader = req.headers['authorization'] || '';
    const provided = String(authHeader).replace(/^Bearer\s+/i, '').trim();
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    const syncSecret = (process.env.SYNC_SECRET || '').trim();
    if (!cronSecret && !syncSecret) return { ok: false, reason: 'CRON_SECRET o SYNC_SECRET non configurati.' };
    const ok = (cronSecret && provided === cronSecret) || (syncSecret && provided === syncSecret);
    return ok ? { ok: true } : { ok: false, reason: 'Non autorizzato.' };
}

module.exports = async (req, res) => {
    try {
        const auth = isAuthorized(req);
        if (!auth.ok) return res.status(401).json({ error: auth.reason });

        const proxyUrl = process.env.RENDER_PROXY_URL;
        if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata su Vercel.' });
        const clanTag = req.query.clanTag || req.body?.clanTag;
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });

        // Attende il risveglio del proxy (Render free: cold start ~15–40s). Fire-and-forget non basta:
        // la POST /sync partiva subito e falliva in timeout mentre l’istanza dormiva.
        try {
            await fetch(`${proxyUrl}/health`, { signal: AbortSignal.timeout(35000) });
        } catch (_) {
            /* prosegui comunque: a volte /health lento ma /sync risponde */
        }

        const response = await fetch(
            `${proxyUrl}/sync?clanTag=${encodeURIComponent(clanTag)}`,
            {
                method: 'POST',
                headers: { 'x-sync-key': process.env.SYNC_SECRET || '' },
                signal: AbortSignal.timeout(50000),
            }
        );
        const raw = await response.text();
        let data = {};
        try {
            data = JSON.parse(raw);
        } catch (_) {
            throw new Error(
                response.ok
                    ? 'Risposta proxy non valida.'
                    : `Proxy HTTP ${response.status}: ${raw.slice(0, 200)}`
            );
        }
        if (!response.ok) throw new Error(data.error || `Errore proxy (${response.status})`);
        res.status(200).json(data);
    } catch (err) {
        const msg = err.name === 'TimeoutError' || err.message?.includes('timed out')
            ? 'Timeout: il server di sync è ancora in avvio (Render). Riprova tra 30–60 secondi.'
            : err.message;
        res.status(500).json({ error: msg });
    }
};
