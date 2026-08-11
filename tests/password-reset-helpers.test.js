'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// Test pure helpers without loading supabase-dependent modules
function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
}

function maskEmail(email) {
  const e = String(email || '');
  const at = e.indexOf('@');
  if (at < 1) return '***';
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const shown = local.length <= 2 ? local[0] + '*' : local.slice(0, 2) + '***';
  return `${shown}@${domain}`;
}

describe('password reset helpers', () => {
  it('hashOtp is stable and not plaintext', () => {
    const h = hashOtp('123456');
    assert.equal(h.length, 64);
    assert.equal(h, hashOtp('123456'));
    assert.notEqual(h, hashOtp('123457'));
  });

  it('maskEmail hides local part', () => {
    assert.equal(maskEmail('ab@x.com'), 'a*@x.com');
    assert.equal(maskEmail('alice@example.com'), 'al***@example.com');
  });
});
