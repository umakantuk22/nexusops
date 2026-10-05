import test from 'node:test';
import assert from 'node:assert';
import { hashPassword, verifyPassword, signJwt, verifyJwt, generateSecureToken } from '../../src/lib/crypto.js';

test('Crypto: Password hashing & verification', async () => {
  const password = 'SuperSecureP@ssword2026!';
  const hash = await hashPassword(password);

  assert.ok(hash.includes(':'), 'Hash must contain salt delimiter');
  
  const isValid = await verifyPassword(password, hash);
  assert.strictEqual(isValid, true, 'Valid password must verify');

  const isInvalid = await verifyPassword('WrongPassword', hash);
  assert.strictEqual(isInvalid, false, 'Invalid password must not verify');

  const emptyCheck = await verifyPassword('', hash);
  assert.strictEqual(emptyCheck, false, 'Empty password must fail gracefully');
});

test('Crypto: Password hashing requires minimum length', async () => {
  await assert.rejects(
    async () => {
      await hashPassword('short');
    },
    { message: /at least 8 characters/ }
  );
});

test('Crypto: JWT signing, verification, and tamper detection', () => {
  const payload = { userId: 'usr_123', email: 'user@nexus.io' };
  const token = signJwt(payload, 3600);

  assert.ok(token, 'Token must be generated');
  const decoded = verifyJwt(token);
  assert.strictEqual(decoded.userId, payload.userId);
  assert.strictEqual(decoded.email, payload.email);

  // Tamper detection: change payload character
  const parts = token.split('.');
  const tamperedToken = `${parts[0]}.${parts[1]}x.${parts[2]}`;

  assert.throws(
    () => {
      verifyJwt(tamperedToken);
    },
    { message: /Invalid token signature/ }
  );
});

test('Crypto: JWT expiration check', () => {
  const payload = { userId: 'usr_expired' };
  // Expired 10 seconds ago
  const token = signJwt(payload, -10);

  assert.throws(
    () => {
      verifyJwt(token);
    },
    { message: /Token has expired/ }
  );
});

test('Crypto: Secure token generation', () => {
  const token1 = generateSecureToken(32);
  const token2 = generateSecureToken(32);
  assert.strictEqual(token1.length, 64); // 32 bytes in hex = 64 chars
  assert.notStrictEqual(token1, token2, 'Random tokens must be unique');
});
