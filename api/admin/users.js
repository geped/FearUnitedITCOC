const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configurata.' });

    const supabase = createClient(process.env.SUPABASE_URL, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    // GET — lista utenti
    if (req.method === 'GET') {
        const { data, error } = await supabase.auth.admin.listUsers({ perPage: 200 });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ users: data.users });
    }

    // POST — crea utente
    if (req.method === 'POST') {
        const { email, password, username, role } = req.body;
        if (!password) return res.status(400).json({ error: 'Password obbligatoria.' });

        // Genera email fittizia prevedibile se non fornita
        const resolvedEmail = email || `${username.toLowerCase().replace(/[^a-z0-9]/g, '_')}@fearunited.internal`;


        const { data, error } = await supabase.auth.admin.createUser({
            email: resolvedEmail,
            password,
            email_confirm: true,          // nessuna email di verifica
            user_metadata: { role: role || 'utente', username: username || '' }
        });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ ok: true, user: data.user });
    }

    // PUT — aggiorna ruolo, username e/o password
    if (req.method === 'PUT') {
        const { userId, role, username, newPassword } = req.body;
        const updates = {};
        const meta = {};
        if (role !== undefined) meta.role = role;
        if (username !== undefined) meta.username = username;
        if (Object.keys(meta).length) updates.user_metadata = meta;
        if (newPassword) {
            if (newPassword.length < 6) return res.status(400).json({ error: 'Password min 6 caratteri.' });
            updates.password = newPassword;
        }
        if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
        const { error } = await supabase.auth.admin.updateUserById(userId, updates);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
    }

    // DELETE — elimina utente
    if (req.method === 'DELETE') {
        const { userId } = req.body;
        const { error } = await supabase.auth.admin.deleteUser(userId);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
};
