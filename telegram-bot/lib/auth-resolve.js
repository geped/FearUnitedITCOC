'use strict';

/** Stessa logica di resolveLoginEmail in app.js (sito web). */
function resolveLoginEmail(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (s.includes('@')) return s;
  if (s.startsWith('#')) return s.slice(1).toLowerCase() + '@cocboard.internal';
  return s.toLowerCase().replace(/[^a-z0-9]/g, '_') + '@cocboard.internal';
}

module.exports = { resolveLoginEmail };
