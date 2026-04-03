module.exports = async (req, res) => {
    try {
        const proxyUrl = process.env.RENDER_PROXY_URL;
        if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata.' });
        const { type } = req.query;
        let proxyPath;
        if (type === 'player') {
            const tag = req.query.playerTag;
            if (!tag) return res.status(400).json({ error: 'playerTag obbligatorio.' });
            proxyPath = `/player?playerTag=${encodeURIComponent(tag)}`;
        } else if (type === 'search-clans') {
            const q = req.query.q;
            if (!q) return res.status(400).json({ error: 'q obbligatorio.' });
            proxyPath = `/search-clans?q=${encodeURIComponent(q)}`;
        } else if (type === 'rankings') {
            const rankType = req.query.rankType;
            const locationId = req.query.locationId;
            if (!rankType || !locationId) return res.status(400).json({ error: 'rankType e locationId obbligatori.' });
            proxyPath = `/rankings?type=${encodeURIComponent(rankType)}&locationId=${encodeURIComponent(locationId)}`;
        } else if (type === 'locations') {
            proxyPath = '/locations';
        } else if (type === 'ping') {
            // Keep-alive esterno verso Render: il self-ping su localhost non evita spin-down / cambio IP.
            const authHeader = req.headers['authorization'] || '';
            const cronSecret = process.env.CRON_SECRET || '';
            const syncSecret = process.env.SYNC_SECRET || '';
            const providedKey = authHeader.replace('Bearer ', '').trim();
            if (!cronSecret && !syncSecret) {
                return res.status(401).json({ error: 'CRON_SECRET o SYNC_SECRET non configurati.' });
            }
            const validCron = cronSecret && providedKey === cronSecret;
            const validSync = syncSecret && providedKey === syncSecret;
            if (!validCron && !validSync) {
                return res.status(401).json({ error: 'Non autorizzato.' });
            }
            const started = Date.now();
            let r;
            try {
                r = await fetch(`${proxyUrl}/health`, {
                    signal: AbortSignal.timeout(20000),
                });
            } catch (e) {
                return res.status(502).json({ ok: false, error: e.message || 'fetch fallita' });
            }
            const ms = Date.now() - started;
            return res.status(200).json({ ok: r.ok, status: r.status, ms });
        } else {
            return res.status(400).json({ error: 'type non valido. Usa: player, search-clans, rankings, locations, ping' });
        }
        const r = await fetch(`${proxyUrl}${proxyPath}`, {
            headers: { 'x-sync-key': process.env.SYNC_SECRET || '' },
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok && data && typeof data === 'object' && data.error == null) {
            const msg =
                data.message ||
                (data.reason && data.message ? `${data.reason}: ${data.message}` : data.reason) ||
                'Errore proxy CoC';
            data.error = typeof msg === 'string' ? msg : JSON.stringify(data);
        }
        res.status(r.status).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
