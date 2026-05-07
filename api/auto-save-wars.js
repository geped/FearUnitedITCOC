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
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    try {
        const auth = isAuthorized(req);
        if (!auth.ok) return res.status(401).json({ error: auth.reason });

        const proxyUrl = process.env.RENDER_PROXY_URL;
        if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata.' });
        const syncHeaders = { 'x-sync-key': process.env.SYNC_SECRET || '' };
        const clanTag = req.query.clanTag || req.body?.clanTag;

        // Ping bot per tenerlo sveglio (evita spin-down Render free tier)
        const botUrl = process.env.BOT_HEALTH_URL;
        if (botUrl) {
            fetch(botUrl, { signal: AbortSignal.timeout(5000) }).catch(() => {});
        }

        if (clanTag) {
            const r = await fetch(`${proxyUrl}/save-war?clanTag=${encodeURIComponent(clanTag)}`, {
                method: 'POST', headers: syncHeaders,
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || 'Errore proxy');
            return res.status(200).json(data);
        }
        const [classicRes, cwlRes, raidsRes] = await Promise.allSettled([
            fetch(`${proxyUrl}/save-all-wars`, { method: 'POST', headers: syncHeaders }).then(r => r.json()),
            fetch(`${proxyUrl}/save-all-cwl`,  { method: 'POST', headers: syncHeaders }).then(r => r.json()),
            fetch(`${proxyUrl}/save-all-raids`, { method: 'POST', headers: syncHeaders }).then(r => r.json()),
        ]);
        res.status(200).json({
            classic: classicRes.status === 'fulfilled' ? classicRes.value : { error: classicRes.reason?.message },
            cwl:     cwlRes.status === 'fulfilled'     ? cwlRes.value     : { error: cwlRes.reason?.message },
            raids:   raidsRes.status === 'fulfilled'   ? raidsRes.value   : { error: raidsRes.reason?.message },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
