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
        } else {
            return res.status(400).json({ error: 'type non valido. Usa: player, search-clans, rankings' });
        }
        const r = await fetch(`${proxyUrl}${proxyPath}`, {
            headers: { 'x-sync-key': process.env.SYNC_SECRET || '' },
        });
        const data = await r.json();
        res.status(r.status).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
