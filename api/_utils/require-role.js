const { createClient } = require('@supabase/supabase-js');

/**
 * Verifica il JWT dell'utente chiamante e controlla che abbia uno dei ruoli richiesti.
 * Legge il token dall'header: Authorization: Bearer <jwt>
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

  const role = user.user_metadata?.role || 'utente';

  if (!allowedRoles.includes(role)) {
    return {
      status: 403,
      error: `Accesso negato. Ruolo richiesto: ${allowedRoles.join(' o ')}. Ruolo attuale: ${role}.`
    };
  }

  return null; // autorizzato
}

module.exports = { requireRole };
