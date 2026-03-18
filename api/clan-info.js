module.exports = async (req, res) => {
    try {
        const proxyUrl = process.env.RENDER_PROXY_URL;
        if (!proxyUrl) return res.status(500).json({ error: 'RENDER_PROXY_URL non configurata.' });
        const clanTag = req.query.clanTag;
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const response = await fetch(`${proxyUrl}/clan-info?clanTag=${encodeURIComponent(clanTag)}`, {
            headers: { 'x-sync-key': process.env.SYNC_SECRET || '' }
        });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json(data);
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
