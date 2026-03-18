module.exports = async (req, res) => {
    try {
        const proxyUrl = process.env.RENDER_PROXY_URL;
        if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata.' });
        const clanTag = req.query.clanTag || '#2J2VLPP9R';
        const r = await fetch(
            `${proxyUrl}/debug-league?clanTag=${encodeURIComponent(clanTag)}`,
            { headers: { 'x-sync-key': process.env.SYNC_SECRET || '' } }
        );
        const data = await r.json();
        res.status(r.status).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
