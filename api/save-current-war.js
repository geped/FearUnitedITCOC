module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    try {
        const proxyUrl = process.env.RENDER_PROXY_URL;
        if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata.' });
        const clanTag = req.query.clanTag || req.body?.clanTag;
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const r = await fetch(
            `${proxyUrl}/save-war?clanTag=${encodeURIComponent(clanTag)}`,
            { method: 'POST', headers: { 'x-sync-key': process.env.SYNC_SECRET || '' } }
        );
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Errore proxy');
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
