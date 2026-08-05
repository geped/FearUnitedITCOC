const { createClient } = require('@supabase/supabase-js');

function isAccountAdmin(user) {
  const meta = user?.user_metadata || {};
  if (meta.account_is_admin === true) return true;
  if (user?.app_metadata?.is_admin === true) return true;
  return String(meta.role || '').toLowerCase() === 'admin';
}

/**
 * Verifica il JWT dell'utente chiamante e controlla che abbia uno dei ruoli richiesti.
 * Legge il token dall'header: Authorization: Bearer <jwt>
 *
 * Admin sito = account-level (role=admin | account_is_admin | app_metadata.is_admin).
 *
 * @param {object} req - Vercel request
 * @param {string[]} allowedRoles - Ruoli autorizzati (es. ['admin'], ['admin','co-capo'])
 * @returns {null|{status: number, error: string}} null se autorizzato, oggetto errore altrimenti
 */
async function requireRole(req, allowedRoles) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return { status: 401, error: 'Autenticazione richiesta. Passa il token JWT nell\'header Authorization.' };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { status: 401, error: 'Token non valido o scaduto.' };
  }

  const meta = user.user_metadata || {};
  const role = meta.role || 'utente';
  const clanRole = meta.clan_role || (role !== 'admin' ? role : 'utente');
  const accountAdmin = isAccountAdmin(user);

  const allowed = allowedRoles.some((r) => {
    if (r === 'admin') return accountAdmin;
    if (accountAdmin && (r === 'capo' || r === 'co-capo')) return true;
    if (r === role) return true;
    if (r === clanRole) return true;
    return false;
  });

  if (!allowed) {
    return {
      status: 403,
      error: `Accesso negato. Ruolo richiesto: ${allowedRoles.join(' o ')}. Ruolo attuale: ${role}.`
    };
  }

  return null; // autorizzato
}

module.exports = { requireRole, isAccountAdmin };
