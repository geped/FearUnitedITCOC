const { createClient } = require('@supabase/supabase-js');
const { requireRole } = require('../_utils/require-role');

module.exports = async (req, res) => {
    // Verifica che il chiamante sia admin
    const authError = await requireRole(req, ['admin']);
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configurata.' });

    const supabase = createClient(process.env.SUPABASE_URL, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    const isBotScope = String(req.query?.scope || '').toLowerCase() === 'bot';
    if (isBotScope) {
        return handleBotAdmin(req, res, supabase);
    }

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
        const resolvedEmail = email || `${username.toLowerCase().replace(/[^a-z0-9]/g, '_')}@cocboard.internal`;


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

async function handleBotAdmin(req, res, supabase) {
    const view = String(req.query?.view || '').toLowerCase();
    if (req.method === 'GET') {
        if (view === 'dashboard') {
            const [linked, paused, dauRows, wauRows, reportOpenRows, bannedRows] = await Promise.all([
                supabase.from('telegram_chat_links').select('telegram_chat_id'),
                supabase.from('telegram_chat_controls').select('telegram_chat_id').eq('bot_enabled', false),
                supabase.from('telegram_usage_events').select('telegram_user_id').gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
                supabase.from('telegram_usage_events').select('telegram_user_id').gte('created_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()),
                supabase.from('telegram_global_reports').select('id').in('status', ['open', 'in_review']),
                supabase.from('telegram_user_restrictions').select('telegram_user_id').eq('banned', true),
            ]);
            return res.status(200).json({
                stats: {
                    linkedChats: (linked.data || []).length,
                    pausedChats: (paused.data || []).length,
                    dau: new Set((dauRows.data || []).map((r) => Number(r.telegram_user_id))).size,
                    wau: new Set((wauRows.data || []).map((r) => Number(r.telegram_user_id))).size,
                },
                openGlobalReports: (reportOpenRows.data || []).length,
                bannedUsersCount: (bannedRows.data || []).length,
            });
        }
        if (view === 'csv') {
            const start = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString();
            const { data, error } = await supabase
                .from('telegram_usage_events')
                .select('created_at, event_type, telegram_user_id, telegram_chat_id')
                .gte('created_at', start)
                .order('created_at', { ascending: true });
            if (error) return res.status(500).json({ error: error.message });
            const map = new Map();
            for (const r of data || []) {
                const day = String(r.created_at || '').slice(0, 10);
                if (!day) continue;
                if (!map.has(day)) map.set(day, { day, events: 0, users: new Set(), chats: new Set(), commands: 0, callbacks: 0, messages: 0 });
                const row = map.get(day);
                row.events += 1;
                if (r.telegram_user_id != null) row.users.add(Number(r.telegram_user_id));
                if (r.telegram_chat_id != null) row.chats.add(Number(r.telegram_chat_id));
                if (r.event_type === 'command') row.commands += 1;
                else if (r.event_type === 'callback') row.callbacks += 1;
                else if (r.event_type === 'message') row.messages += 1;
            }
            const rows = [...map.values()].map((r) =>
                [r.day, r.events, r.users.size, r.chats.size, r.commands, r.callbacks, r.messages].join(',')
            );
            const csv = `day,events,unique_users,unique_chats,commands,callbacks,messages\n${rows.join('\n')}\n`;
            return res.status(200).json({ csv });
        }
        if (view === 'tickets') {
            const mode = String(req.query?.mode || 'open');
            if (mode === 'mine') {
                const adminTelegramUserId = await resolveAdminTelegramUserId(req, supabase);
                if (!adminTelegramUserId) return res.status(200).json({ tickets: [] });
                const { data, error } = await supabase
                    .from('telegram_support_tickets')
                    .select('*')
                    .in('status', ['in_progress', 'waiting_user', 'closed_pending_purge'])
                    .eq('assigned_admin_id', Number(adminTelegramUserId))
                    .order('updated_at', { ascending: false })
                    .limit(30);
                if (error) return res.status(500).json({ error: error.message });
                return res.status(200).json({ tickets: data || [] });
            }
            const { data, error } = await supabase
                .from('telegram_support_tickets')
                .select('*')
                .in('status', ['open', 'in_progress', 'waiting_user', 'closed_pending_purge'])
                .order('updated_at', { ascending: false })
                .limit(30);
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ tickets: data || [] });
        }
        if (view === 'ticket') {
            const id = Number(req.query?.id);
            if (!Number.isFinite(id)) return res.status(400).json({ error: 'id non valido' });
            const { data: ticket, error } = await supabase.from('telegram_support_tickets').select('*').eq('id', id).maybeSingle();
            if (error) return res.status(500).json({ error: error.message });
            if (!ticket) return res.status(404).json({ error: 'Ticket non trovato' });
            const { data: messages } = await supabase
                .from('telegram_support_messages')
                .select('*')
                .eq('ticket_id', id)
                .order('created_at', { ascending: true })
                .limit(250);
            return res.status(200).json({ ticket, messages: messages || [] });
        }
        if (view === 'global_reports') {
            const statuses = String(req.query?.statuses || 'open,in_review')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            const { data, error } = await supabase
                .from('telegram_global_reports')
                .select('*')
                .in('status', statuses)
                .order('updated_at', { ascending: false })
                .limit(60);
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ reports: data || [] });
        }
        if (view === 'global_report') {
            const id = Number(req.query?.id);
            if (!Number.isFinite(id)) return res.status(400).json({ error: 'id non valido' });
            const { data, error } = await supabase.from('telegram_global_reports').select('*').eq('id', id).maybeSingle();
            if (error) return res.status(500).json({ error: error.message });
            if (!data) return res.status(404).json({ error: 'Segnalazione non trovata' });
            return res.status(200).json({ report: data });
        }
        if (view === 'banned_users') {
            const { data, error } = await supabase
                .from('telegram_user_restrictions')
                .select('*')
                .eq('banned', true)
                .order('updated_at', { ascending: false })
                .limit(80);
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ users: data || [] });
        }
        return res.status(400).json({ error: 'view bot non supportata' });
    }

    if (req.method === 'POST' && view === 'ticket_reply') {
        const { ticketId, text } = req.body || {};
        if (!ticketId || !String(text || '').trim()) return res.status(400).json({ error: 'ticketId e text obbligatori.' });
        const { data: ticket, error: e1 } = await supabase.from('telegram_support_tickets').select('*').eq('id', Number(ticketId)).maybeSingle();
        if (e1) return res.status(500).json({ error: e1.message });
        if (!ticket) return res.status(404).json({ error: 'Ticket non trovato.' });
        const { error: e2 } = await supabase.from('telegram_support_messages').insert({
            ticket_id: Number(ticketId),
            from_role: 'admin',
            text: String(text).slice(0, 4000),
            session_index: Number(ticket.session_index || 1),
        });
        if (e2) return res.status(500).json({ error: e2.message });
        await notifyTelegram(ticket.telegram_user_id, `👮 Supporto:\n${String(text).slice(0, 3800)}`);
        return res.status(200).json({ ok: true });
    }

    if (req.method === 'PUT' && view === 'ticket_action') {
        const { ticketId, action } = req.body || {};
        const id = Number(ticketId);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'ticketId non valido.' });
        const adminTelegramUserId = await resolveAdminTelegramUserId(req, supabase);
        const { data: t, error: e1 } = await supabase.from('telegram_support_tickets').select('*').eq('id', id).maybeSingle();
        if (e1) return res.status(500).json({ error: e1.message });
        if (!t) return res.status(404).json({ error: 'Ticket non trovato.' });
        const now = new Date();
        if (action === 'take') {
            await supabase.from('telegram_support_tickets').update({ status: 'in_progress', assigned_admin_id: adminTelegramUserId || null, updated_at: now.toISOString() }).eq('id', id);
            await supabase.from('telegram_support_messages').insert({ ticket_id: id, from_role: 'system', text: 'Ticket preso in carico da un amministratore.', session_index: Number(t.session_index || 1) });
            await notifyTelegram(t.telegram_user_id, '✅ Il tuo ticket è stato preso in carico da un amministratore.');
            return res.status(200).json({ ok: true });
        }
        if (action === 'wait') {
            await supabase.from('telegram_support_tickets').update({ status: 'waiting_user', assigned_admin_id: adminTelegramUserId || null, updated_at: now.toISOString() }).eq('id', id);
            await notifyTelegram(t.telegram_user_id, '⏸ Ticket in attesa di un tuo riscontro.');
            return res.status(200).json({ ok: true });
        }
        if (action === 'close') {
            await supabase.from('telegram_support_tickets').update({
                status: 'closed_pending_purge',
                assigned_admin_id: adminTelegramUserId || null,
                closed_at: now.toISOString(),
                purge_after: new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString(),
                updated_at: now.toISOString(),
            }).eq('id', id);
            await supabase.from('telegram_support_messages').insert({ ticket_id: id, from_role: 'system', text: 'Ticket chiuso: purge definitivo tra 7 giorni.', session_index: Number(t.session_index || 1) });
            await notifyTelegram(t.telegram_user_id, '🔒 Ticket chiuso. Entro 7 giorni verrà eliminato definitivamente.');
            return res.status(200).json({ ok: true });
        }
        if (action === 'ban' || action === 'unban') {
            const banned = action === 'ban';
            const row = {
                telegram_user_id: Number(t.telegram_user_id),
                banned,
                muted_until: null,
                reason: banned ? `Permaban da ticket #${id}` : `Unban da ticket #${id}`,
                updated_by: adminTelegramUserId || null,
                updated_at: now.toISOString(),
            };
            const { error } = await supabase.from('telegram_user_restrictions').upsert(row, { onConflict: 'telegram_user_id' });
            if (error) return res.status(500).json({ error: error.message });
            if (banned) await notifyTelegram(t.telegram_user_id, '🚫 Sei stato bannato dall’utilizzo del bot. Contatta un amministratore per eventuale unban.');
            else await notifyTelegram(t.telegram_user_id, '✅ Il tuo ban è stato rimosso. Ora puoi tornare a usare il bot.');
            return res.status(200).json({ ok: true });
        }
        return res.status(400).json({ error: 'Azione ticket non valida.' });
    }

    if (req.method === 'PUT' && view === 'global_report_target') {
        const { reportId, targetTelegramUserId } = req.body || {};
        const id = Number(reportId);
        const target = Number(targetTelegramUserId);
        if (!Number.isFinite(id) || !Number.isFinite(target)) return res.status(400).json({ error: 'Parametri non validi.' });
        const { error } = await supabase
            .from('telegram_global_reports')
            .update({ reported_target_telegram_user_id: target, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
    }

    if (req.method === 'PUT' && view === 'global_report_action') {
        const { reportId, action } = req.body || {};
        const id = Number(reportId);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'reportId non valido.' });
        const adminTelegramUserId = await resolveAdminTelegramUserId(req, supabase);
        const { data: r, error: e1 } = await supabase.from('telegram_global_reports').select('*').eq('id', id).maybeSingle();
        if (e1) return res.status(500).json({ error: e1.message });
        if (!r) return res.status(404).json({ error: 'Segnalazione non trovata.' });
        if (action === 'take' || action === 'archive') {
            const patch = {
                status: action === 'take' ? 'in_review' : 'archived',
                action_taken: action === 'take' ? 'none' : 'archive',
                resolution_note: action === 'take' ? 'Presa in carico' : 'Archiviata da admin web',
                reviewed_by_telegram_user_id: adminTelegramUserId || null,
                reviewed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            const { error } = await supabase.from('telegram_global_reports').update(patch).eq('id', id);
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ ok: true });
        }
        if (action === 'mute24' || action === 'ban') {
            const target = r.reported_target_telegram_user_id != null ? Number(r.reported_target_telegram_user_id) : null;
            if (!target) return res.status(400).json({ error: 'Target non identificato. Imposta target manuale prima.' });
            const isBan = action === 'ban';
            const now = new Date();
            const row = {
                telegram_user_id: target,
                banned: isBan,
                muted_until: isBan ? null : new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                reason: isBan ? `Ban da segnalazione chat globale #${id}` : `Limitazione 24h da segnalazione chat globale #${id}`,
                updated_by: adminTelegramUserId || null,
                updated_at: now.toISOString(),
            };
            const { error: e2 } = await supabase.from('telegram_user_restrictions').upsert(row, { onConflict: 'telegram_user_id' });
            if (e2) return res.status(500).json({ error: e2.message });
            const { error: e3 } = await supabase.from('telegram_global_reports').update({
                status: 'resolved',
                action_taken: isBan ? 'ban' : 'mute24h',
                resolution_note: isBan ? 'Ban applicato da admin web' : 'Mute 24h applicato da admin web',
                reviewed_by_telegram_user_id: adminTelegramUserId || null,
                reviewed_at: now.toISOString(),
                updated_at: now.toISOString(),
            }).eq('id', id);
            if (e3) return res.status(500).json({ error: e3.message });
            if (isBan) await notifyTelegram(target, `🚫 Sei stato bannato dall'uso del bot per violazione regole in chat globale.\nMotivo: ${String(r.reason || '').slice(0, 350)}\nContatta un amministratore per eventuale unban.`);
            else await notifyTelegram(target, `🔇 Hai ricevuto una limitazione temporanea di 24h per violazione regole in chat globale.\nMotivo: ${String(r.reason || '').slice(0, 350)}\nSe ritieni ci sia un errore, contatta un amministratore.`);
            return res.status(200).json({ ok: true });
        }
        return res.status(400).json({ error: 'Azione segnalazione non valida.' });
    }

    if (req.method === 'PUT' && view === 'user_restriction_action') {
        const { telegramUserId, action } = req.body || {};
        const uid = Number(telegramUserId);
        if (!Number.isFinite(uid)) return res.status(400).json({ error: 'telegramUserId non valido.' });
        const adminTelegramUserId = await resolveAdminTelegramUserId(req, supabase);
        if (action === 'unban') {
            const { error } = await supabase.from('telegram_user_restrictions').upsert({
                telegram_user_id: uid,
                banned: false,
                muted_until: null,
                reason: 'Unban da webapp admin',
                updated_by: adminTelegramUserId || null,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'telegram_user_id' });
            if (error) return res.status(500).json({ error: error.message });
            await notifyTelegram(uid, '✅ Il tuo ban è stato rimosso. Ora puoi tornare a usare il bot.');
            return res.status(200).json({ ok: true });
        }
        if (action === 'mute24') {
            const prev = await supabase.from('telegram_user_restrictions').select('*').eq('telegram_user_id', uid).maybeSingle();
            const { error } = await supabase.from('telegram_user_restrictions').upsert({
                telegram_user_id: uid,
                banned: prev.data?.banned === true,
                muted_until: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                reason: 'Limitazione 24h da webapp admin',
                updated_by: adminTelegramUserId || null,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'telegram_user_id' });
            if (error) return res.status(500).json({ error: error.message });
            await notifyTelegram(uid, '🔇 Hai ricevuto una limitazione temporanea di 24h sull’utilizzo del bot.');
            return res.status(200).json({ ok: true });
        }
        return res.status(400).json({ error: 'Azione utente non valida.' });
    }

    return res.status(405).json({ error: 'Method not allowed (scope=bot).' });
}

async function resolveAdminTelegramUserId(req, supabase) {
    try {
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        if (!token) return null;
        const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
            auth: { autoRefreshToken: false, persistSession: false }
        });
        const { data: { user }, error } = await anon.auth.getUser(token);
        if (error || !user?.id) return null;
        const { data } = await supabase
            .from('telegram_links')
            .select('telegram_user_id')
            .eq('supabase_user_id', user.id)
            .maybeSingle();
        return data?.telegram_user_id != null ? Number(data.telegram_user_id) : null;
    } catch (_) {
        return null;
    }
}

async function notifyTelegram(chatId, text) {
    try {
        if (chatId == null) return;
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: Number(chatId), text: String(text).slice(0, 3900) }),
        });
    } catch (_) {}
}
