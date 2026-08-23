const { proxyFetch } = require('./_utils/proxy-client');

module.exports = async (req, res) => {
    try {
        const clanTag = req.query.clanTag;
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const data = await proxyFetch(res, '/cwl-live', { clanTag });
        if (data) {
            // Cache condivisa breve sulla CDN Edge Vercel: assorbe richieste ripetute
            // (sito + Mini App + bot) senza richiamare Render ad ogni singola richiesta.
            res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=120');
            res.status(200).json(data);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
