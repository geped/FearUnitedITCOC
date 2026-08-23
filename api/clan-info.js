const { proxyFetch } = require('./_utils/proxy-client');

module.exports = async (req, res) => {
    try {
        const clanTag = req.query.clanTag;
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const data = await proxyFetch(res, '/clan-info', { clanTag });
        if (data) {
            res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
            res.status(200).json(data);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
