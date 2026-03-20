module.exports = async (req, res) => {
    try {
        const proxyUrl = process.env.RENDER_PROXY_URL;
        // Warm-up del proxy prima della sync (evita cold start per gli utenti)
        if (proxyUrl) fetch(`${proxyUrl}/health`).catch(() => {});
        if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata su Vercel.' });
        const clanTag = req.query.clanTag || req.body?.clanTag;
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const response = await fetch(
            `${proxyUrl}/sync?clanTag=${encodeURIComponent(clanTag)}`,
            { method: 'POST', headers: { 'x-sync-key': process.env.SYNC_SECRET || '' } }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Errore proxy');
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
