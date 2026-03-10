const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
        return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configurata su Vercel.' });
    }

    const supabase = createClient(process.env.SUPABASE_URL, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    if (req.method === 'GET') {
        const { data, error } = await supabase.auth.admin.listUsers();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ users: data.users });
    }

    if (req.method === 'PUT') {
        const { userId, role } = req.body;
        const { error } = await supabase.auth.admin.updateUserById(userId, {
            user_metadata: { role }
        });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
        const { userId } = req.body;
        const { error } = await supabase.auth.admin.deleteUser(userId);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
};
