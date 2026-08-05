const { createClient } = require('@supabase/supabase-js');
const { requireRole } = require('../_utils/require-role');

module.exports = async (req, res) => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configurata.' });

    const supabase = createClient(process.env.SUPABASE_URL, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    const isBotScope = String(req.query?.scope || '').toLowerCase() === 'bot';
    if (isBotScope) {
        const panel = await authenticateBotPanel(req);
        if (panel.error) return res.status(panel.status).json({ error: panel.error });
        return handleBotAdmin(req, res, supabase, panel);
    }

    const authError = await requireRole(req, ['admin']);
    if (authError) return res.status(authError.status).json({ error: authError.error });

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

        const resolvedEmail = email || `${username.toLowerCase().replace(/[^a-z0-9]/g, '_')}@cocboard.internal`;

        const { data, error } = await supabase.auth.admin.createUser({
            email: resolvedEmail,
            password,
            email_confirm: true,
            user_metadata: { role: role || 'utente', username: username || '' }
        });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ ok: true, user: data.user });
    }

    // PUT — aggiorna ruolo, username, flag moderatore Telegram, password
    if (req.method === 'PUT') {
        const { userId, role, username, newPassword, telegram_moderator } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId obbligatorio.' });

        const { data: cur, error: ge } = await supabase.auth.admin.getUserById(userId);
        if (ge || !cur?.user) return res.status(404).json({ error: 'Utente non trovato.' });

        if (
            role === undefined &&
            username === undefined &&
            newPassword === undefined &&
            telegram_moderator === undefined
        ) {
            return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
        }

        const merged = { ...(cur.user.user_metadata || {}) };
        if (role !== undefined) {
            merged.role = role;
            if (String(role).toLowerCase() === 'admin') {
                merged.account_is_admin = true;
            } else if (merged.account_is_admin === true && String(role).toLowerCase() !== 'admin') {
                // Demote admin account: clear sticky flag; keep clan_role if present
                merged.account_is_admin = false;
                if (merged.clan_role) merged.role = merged.clan_role;
            }
        }
        if (username !== undefined) merged.username = username;
        if (telegram_moderator !== undefined) merged.telegram_moderator = !!telegram_moderator;

        const updates = { user_metadata: merged };
        if (role !== undefined) {
            updates.app_metadata = {
                ...(cur.user.app_metadata || {}),
                is_admin: String(role).toLowerCase() === 'admin',
            };
        }
        if (newPassword) {
            if (newPassword.length < 6) return res.status(400).json({ error: 'Password min 6 caratteri.' });
            updates.password = newPassword;
        }

        const { error } = await supabase.auth.admin.updateUserById(userId, updates);
        if (error) return res.status(500).json({ error: error.message });

        // Allinea prefs.account_is_admin se tabella presente
        if (role !== undefined) {
            try {
                await supabase.from('user_account_prefs').upsert(
                    {
                        user_id: userId,
                        account_is_admin: String(role).toLowerCase() === 'admin',
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'user_id' },
                );
            } catch (_) {}
        }

        if (telegram_moderator !== undefined) {
            await syncTelegramStaffModeratorRow(supabase, userId, !!telegram_moderator);
        }
        return res.status(200).json({ ok: true });
    }

    // DELETE — elimina utente
    if (req.method === 'DELETE') {
        const { userId } = req.body;
        await syncTelegramStaffModeratorRow(supabase, userId, false);
        const { error } = await supabase.auth.admin.deleteUser(userId);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
};

async function authenticateBotPanel(req) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (!token) return { error: 'Autenticazione richiesta. Passa il token JWT nell\'header Authorization.', status: 401 };

    const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: { user }, error } = await anon.auth.getUser(token);
    if (error || !user) return { error: 'Token non valido o scaduto.', status: 401 };

    const role = user.user_metadata?.role || 'utente';
    const isModerator = user.user_metadata?.telegram_moderator === true;
    const isAdmin =
        role === 'admin' ||
        user.user_metadata?.account_is_admin === true ||
        user.app_metadata?.is_admin === true;
    if (!isAdmin && !isModerator) {
        return { error: 'Accesso negato al pannello CoCBoardBot.', status: 403 };
    }
    return { user, isAdmin, isModerator };
}

function botNeedsFullAdmin(panel, res) {
    if (!panel.isAdmin) {
        res.status(403).json({ error: 'Operazione riservata agli amministratori.' });
        return true;
    }
    return false;
}

async function syncTelegramStaffModeratorRow(sb, userId, enabled) {
    try {
        const uid = String(userId || '').trim();
        if (!uid) return;
        const { data: link } = await sb
            .from('telegram_links')
            .select('telegram_user_id')
            .eq('supabase_user_id', uid)
            .maybeSingle();
        const tg = link?.telegram_user_id;
        if (enabled && tg != null) {
            await sb.from('telegram_staff_moderator_ids').upsert(
                {
                    telegram_user_id: Number(tg),
                    supabase_user_id: uid,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'telegram_user_id' }
            );
        } else {
            if (tg != null) await sb.from('telegram_staff_moderator_ids').delete().eq('telegram_user_id', Number(tg));
            await sb.from('telegram_staff_moderator_ids').delete().eq('supabase_user_id', uid);
        }
    } catch (_) {}
}

async function handleBotAdmin(req, res, supabase, panel) {
    const view = String(req.query?.view || '').toLowerCase();
    if (req.method === 'GET') {
        if (view === 'dashboard') {
            if (botNeedsFullAdmin(panel, res)) return;
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
            if (botNeedsFullAdmin(panel, res)) return;
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
        if (view === 'moderators') {
            if (botNeedsFullAdmin(panel, res)) return;
            const { data: idRows, error: e1 } = await supabase
                .from('telegram_staff_moderator_ids')
                .select('telegram_user_id, supabase_user_id');
            if (e1) return res.status(500).json({ error: e1.message });
            const moderators = [];
            for (const row of idRows || []) {
                const { data: uwrap } = await supabase.auth.admin.getUserById(row.supabase_user_id);
                const u = uwrap?.user;
                if (!u) continue;
                const m = u.user_metadata || {};
                moderators.push({
                    userId: u.id,
                    username: m.username || '',
                    role: m.role || 'utente',
                    telegram_user_id: row.telegram_user_id != null ? Number(row.telegram_user_id) : null,
                });
            }
            moderators.sort((a, b) => String(a.username || '').localeCompare(String(b.username || ''), 'it'));
            return res.status(200).json({ moderators });
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
            if (mode === 'closed') {
                if (botNeedsFullAdmin(panel, res)) return;
                const { data, error } = await supabase
                    .from('telegram_support_tickets')
                    .select('*')
                    .eq('status', 'closed_pending_purge')
                    .order('updated_at', { ascending: false })
                    .limit(30);
                if (error) return res.status(500).json({ error: error.message });
                return res.status(200).json({ tickets: data || [] });
            }
            const { data, error } = await supabase
                .from('telegram_support_tickets')
                .select('*')
                .in('status', ['open', 'in_progress', 'waiting_user'])
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
            return res.status(200).json({
                ticket,
                messages: messages || [],
                panel: { canBan: panel.isAdmin },
            });
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
            return res.status(200).json({ report: data, panel: { canBan: panel.isAdmin } });
        }
        if (view === 'banned_users') {
            if (botNeedsFullAdmin(panel, res)) return;
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
        const fromRole = panel.isAdmin ? 'admin' : 'moderator';
        const { error: e2 } = await supabase.from('telegram_support_messages').insert({
            ticket_id: Number(ticketId),
            from_role: fromRole,
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
        if ((action === 'ban' || action === 'unban') && botNeedsFullAdmin(panel, res)) return;
        const adminTelegramUserId = await resolveAdminTelegramUserId(req, supabase);
        const { data: t, error: e1 } = await supabase.from('telegram_support_tickets').select('*').eq('id', id).maybeSingle();
        if (e1) return res.status(500).json({ error: e1.message });
        if (!t) return res.status(404).json({ error: 'Ticket non trovato.' });
        const now = new Date();
        const staffWord = panel.isAdmin ? 'un amministratore' : 'uno staff moderatore';
        if (action === 'take') {
            await supabase.from('telegram_support_tickets').update({ status: 'in_progress', assigned_admin_id: adminTelegramUserId || null, updated_at: now.toISOString() }).eq('id', id);
            await supabase.from('telegram_support_messages').insert({ ticket_id: id, from_role: 'system', text: 'Ticket preso in carico dallo staff.', session_index: Number(t.session_index || 1) });
            await notifyTelegram(t.telegram_user_id, `✅ Il tuo ticket è stato preso in carico da ${staffWord}.`);
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
        if (action === 'ban' && botNeedsFullAdmin(panel, res)) return;
        const adminTelegramUserId = await resolveAdminTelegramUserId(req, supabase);
        const { data: r, error: e1 } = await supabase.from('telegram_global_reports').select('*').eq('id', id).maybeSingle();
        if (e1) return res.status(500).json({ error: e1.message });
        if (!r) return res.status(404).json({ error: 'Segnalazione non trovata.' });
        if (action === 'take' || action === 'archive') {
            const patch = {
                status: action === 'take' ? 'in_review' : 'archived',
                action_taken: action === 'take' ? 'none' : 'archive',
                resolution_note: action === 'take' ? 'Presa in carico' : 'Archiviata dallo staff',
                reviewed_by_telegram_user_id: adminTelegramUserId || null,
                reviewed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            const { error } = await supabase.from('telegram_global_reports').update(patch).eq('id', id);
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ ok: true });
        }
        if (/^mute(2|4|8|16|24|48)$/.test(action) || action === 'ban' || action === 'unmute') {
            const target = r.reported_target_telegram_user_id != null ? Number(r.reported_target_telegram_user_id) : null;
            if (!target) return res.status(400).json({ error: 'Target non identificato. Imposta target manuale prima.' });
            const isBan = action === 'ban';
            const isUnmute = action === 'unmute';
            const muteHours = /^mute(\d+)$/.test(action) ? Number(action.replace('mute', '')) : 0;
            const now = new Date();
            const prev = await supabase.from('telegram_user_restrictions').select('*').eq('telegram_user_id', target).maybeSingle();
            const row = {
                telegram_user_id: target,
                banned: isBan ? true : (prev.data?.banned === true),
                muted_until: isBan || isUnmute ? null : new Date(Date.now() + muteHours * 3600 * 1000).toISOString(),
                reason: isBan
                    ? `Ban da segnalazione chat globale #${id}`
                    : isUnmute
                        ? `Unmute da segnalazione chat globale #${id}`
                        : `Limitazione ${muteHours}h da segnalazione chat globale #${id}`,
                updated_by: adminTelegramUserId || null,
                updated_at: now.toISOString(),
            };
            const { error: e2 } = await supabase.from('telegram_user_restrictions').upsert(row, { onConflict: 'telegram_user_id' });
            if (e2) return res.status(500).json({ error: e2.message });
            const { error: e3 } = await supabase.from('telegram_global_reports').update({
                status: 'resolved',
                action_taken: isBan ? 'ban' : isUnmute ? 'unmute' : `mute${muteHours}h`,
                resolution_note: isBan
                    ? 'Ban applicato dallo staff'
                    : isUnmute
                        ? 'Unmute applicato dallo staff'
                        : `Mute ${muteHours}h applicato dallo staff`,
                reviewed_by_telegram_user_id: adminTelegramUserId || null,
                reviewed_at: now.toISOString(),
                updated_at: now.toISOString(),
            }).eq('id', id);
            if (e3) return res.status(500).json({ error: e3.message });
            if (isBan) await notifyTelegram(target, `🚫 Sei stato bannato dall'uso del bot per violazione regole in chat globale.\nMotivo: ${String(r.reason || '').slice(0, 350)}\nContatta un amministratore per eventuale unban.`);
            else if (isUnmute) await notifyTelegram(target, '🔈 La tua limitazione mute è stata rimossa da un amministratore.');
            else await notifyTelegram(target, `🔇 Hai ricevuto una limitazione temporanea di ${muteHours}h per violazione regole in chat globale.\nMotivo: ${String(r.reason || '').slice(0, 350)}\nSe ritieni ci sia un errore, contatta un amministratore.`);
            return res.status(200).json({ ok: true });
        }
        return res.status(400).json({ error: 'Azione segnalazione non valida.' });
    }

    if (req.method === 'PUT' && view === 'user_restriction_action') {
        if (botNeedsFullAdmin(panel, res)) return;
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
        if (action === 'unmute') {
            const prev = await supabase.from('telegram_user_restrictions').select('*').eq('telegram_user_id', uid).maybeSingle();
            const { error } = await supabase.from('telegram_user_restrictions').upsert({
                telegram_user_id: uid,
                banned: prev.data?.banned === true,
                muted_until: null,
                reason: 'Unmute da webapp admin',
                updated_by: adminTelegramUserId || null,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'telegram_user_id' });
            if (error) return res.status(500).json({ error: error.message });
            await notifyTelegram(uid, '🔈 La tua limitazione mute è stata rimossa.');
            return res.status(200).json({ ok: true });
        }
        if (/^mute(2|4|8|16|24|48)$/.test(action)) {
            const hours = Number(action.replace('mute', ''));
            const prev = await supabase.from('telegram_user_restrictions').select('*').eq('telegram_user_id', uid).maybeSingle();
            const { error } = await supabase.from('telegram_user_restrictions').upsert({
                telegram_user_id: uid,
                banned: prev.data?.banned === true,
                muted_until: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
                reason: `Limitazione ${hours}h da webapp admin`,
                updated_by: adminTelegramUserId || null,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'telegram_user_id' });
            if (error) return res.status(500).json({ error: error.message });
            await notifyTelegram(uid, `🔇 Hai ricevuto una limitazione temporanea di ${hours}h sull’utilizzo del bot.`);
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
