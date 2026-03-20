const { proxyFetch } = require('./_utils/proxy-client');

module.exports = async (req, res) => {
    try {
        const clanTag = req.query.clanTag;
        if (!clanTag) return res.status(400).json({ error: 'clanTag obbligatorio.' });
        const data = await proxyFetch(res, '/clan-members', { clanTag });
        if (data) res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
