const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
    // Solo POST
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Verifica SYNC_SECRET (chiamata da script Python o da utenti admin via browser)
    const providedSecret = req.headers['x-sync-key'] || req.headers['x-import-key'];
    const syncSecret = process.env.SYNC_SECRET;
    if (!syncSecret || providedSecret !== syncSecret) {
        return res.status(401).json({ error: 'Accesso non autorizzato. Passa x-sync-key nell\'header.' });
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configurata.' });

    const supabase = createClient(process.env.SUPABASE_URL, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    const rows = req.body;
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Body deve essere un array di righe.' });

    const { error } = await supabase
        .from('cwl_history')
        .upsert(rows, { onConflict: 'player_name,season' });

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ ok: true, count: rows.length });
};
