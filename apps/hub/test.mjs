/**
 * End-to-end checks for partycod. Not a framework — `node:test` plus `fetch` against a real
 * server on an ephemeral port with a throwaway database, so the wiring under test is the
 * wiring that ships.
 *
 * Run: node --test apps/hub
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startHub } from './src/index.js';
import { hashPassword, verifyPassword, COLOR_SLUGS } from './src/auth.js';
import { createRateLimiter, isAllowedOrigin, parseOrigins } from './src/http.js';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_GROUPS,
  INVITE_CODE_GROUP_SIZE,
  formatInviteCode,
  generateInviteCode,
  normalizeInviteCode,
} from './src/invites.js';

/** @type {string[]} */
const tempDirs = [];

/**
 * @param {object} [options]
 * @returns {Promise<{ hub: Awaited<ReturnType<typeof startHub>>, call: Function }>}
 */
async function bootHub(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partycod-test-'));
  tempDirs.push(dir);
  const hub = await startHub({
    dbPath: path.join(dir, 'hub.db'),
    port: 0,
    host: '127.0.0.1',
    // The limiter is exercised on purpose in its own test; a low limit here would make
    // every other test order-dependent.
    rateLimit: { limit: 1000 },
    ...options,
  });

  /**
   * @param {string} method
   * @param {string} route
   * @param {{ body?: unknown, token?: string|null, origin?: string, rawHeaders?: Record<string,string> }} [opts]
   */
  async function call(method, route, opts = {}) {
    /** @type {Record<string, string>} */
    const headers = { ...(opts.rawHeaders ?? {}) };
    if (opts.body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.origin) headers.origin = opts.origin;

    const res = await fetch(`http://127.0.0.1:${hub.port}${route}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      json: text.length > 0 ? JSON.parse(text) : null,
      text,
    };
  }

  return { hub, call };
}

test.after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

// ---------------------------------------------------------------------------

test('health reports identity, protocol and member count', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const empty = await call('GET', '/v1/health');
  assert.equal(empty.status, 200);
  assert.equal(empty.json.name, 'partycod');
  assert.equal(empty.json.protocol, 1);
  assert.equal(typeof empty.json.version, 'string');
  assert.equal(empty.json.members, 0);

  await call('POST', '/v1/auth/register', { body: { email: 'ann@example.com', password: 'correct horse' } });
  const one = await call('GET', '/v1/health');
  assert.equal(one.json.members, 1);
});

test('registration issues a session and the first member owns the hub', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const first = await call('POST', '/v1/auth/register', {
    body: { email: 'Ann.Smith@Example.com', password: 'correct horse battery', displayName: 'Аня' },
  });

  assert.equal(first.status, 201);
  assert.equal(typeof first.json.token, 'string');
  assert.ok(first.json.token.length >= 43, 'token carries 256 bits of entropy in base64url');
  assert.ok(first.json.expiresAt > Date.now() + 29 * 24 * 3600 * 1000, 'session lives ~30 days');

  const member = first.json.member;
  assert.deepEqual(Object.keys(member).sort(), [
    'colorSlug',
    'createdAt',
    'displayName',
    'email',
    'handle',
    'id',
    'role',
  ]);
  assert.equal(member.email, 'ann.smith@example.com', 'email is stored case-folded');
  assert.equal(member.handle, 'ann-smith');
  assert.equal(member.displayName, 'Аня');
  assert.equal(member.role, 'owner', 'first registrant becomes owner');
  assert.ok(COLOR_SLUGS.includes(member.colorSlug));

  // The rule the whole "who owns what" system rests on.
  assert.equal(member.colorSlug, 'teal', 'colours are handed out in palette order');

  const second = await call('POST', '/v1/auth/register', {
    body: { email: 'bob@example.com', password: 'hunter2' },
  });
  assert.equal(second.status, 201);
  assert.equal(second.json.member.role, 'member', 'everyone after the first is a plain member');
  assert.equal(second.json.member.handle, 'bob');
  assert.equal(second.json.member.displayName, 'bob', 'displayName falls back to the handle');
  assert.notEqual(second.json.member.colorSlug, member.colorSlug, 'colours do not collide while the palette lasts');
});

test('password_hash never appears in any response', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const reg = await call('POST', '/v1/auth/register', {
    body: { email: 'ann@example.com', password: 'sup3rs3cret' },
  });
  const me = await call('GET', '/v1/auth/me', { token: reg.json.token });
  const inn = await call('POST', '/v1/auth/login', {
    body: { email: 'ann@example.com', password: 'sup3rs3cret' },
  });

  for (const [label, res] of [['register', reg], ['me', me], ['login', inn]]) {
    assert.ok(!/password/i.test(res.text), `${label} response mentions no password field`);
    assert.ok(!res.text.includes('sup3rs3cret'), `${label} response does not echo the password`);
    assert.ok(!res.text.includes('scrypt'), `${label} response carries no hash`);
  }

  // And the database holds a hash, not the password.
  const row = hub.db.prepare('SELECT password_hash FROM member WHERE email = ?').get('ann@example.com');
  assert.match(row.password_hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(!row.password_hash.includes('sup3rs3cret'));
});

test('registering the same email twice is a 409, case-insensitively', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const first = await call('POST', '/v1/auth/register', {
    body: { email: 'ann@example.com', password: 'first-password' },
  });
  assert.equal(first.status, 201);

  const again = await call('POST', '/v1/auth/register', {
    body: { email: 'ann@example.com', password: 'another-password' },
  });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'email_taken');
  assert.ok(again.json.error.message.length > 0);
  assert.ok(!/member|sqlite|constraint/i.test(again.json.error.message), 'no internals leak into the message');

  const differentCase = await call('POST', '/v1/auth/register', {
    body: { email: 'ANN@Example.COM', password: 'another-password' },
  });
  assert.equal(differentCase.status, 409, 'case variations are the same account');

  assert.equal((await call('GET', '/v1/health')).json.members, 1);
});

test('login: right password works, wrong password and unknown email are indistinguishable', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  await call('POST', '/v1/auth/register', {
    body: { email: 'ann@example.com', password: 'correct horse' },
  });

  const good = await call('POST', '/v1/auth/login', {
    body: { email: 'ann@example.com', password: 'correct horse' },
  });
  assert.equal(good.status, 200);
  assert.equal(typeof good.json.token, 'string');
  assert.equal(good.json.member.email, 'ann@example.com');

  const wrongPassword = await call('POST', '/v1/auth/login', {
    body: { email: 'ann@example.com', password: 'correct hors' },
  });
  const unknownEmail = await call('POST', '/v1/auth/login', {
    body: { email: 'nobody@example.com', password: 'correct horse' },
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.equal(wrongPassword.json.error.code, 'invalid_credentials');
  assert.equal(unknownEmail.json.error.code, 'invalid_credentials');
  assert.deepEqual(
    wrongPassword.json,
    unknownEmail.json,
    'the response body must not tell an attacker which addresses are registered',
  );

  // Same work, therefore same timing: an unknown address still costs one scrypt run.
  const timeOf = async (body) => {
    const t0 = process.hrtime.bigint();
    await call('POST', '/v1/auth/login', { body });
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const missMs = await timeOf({ email: 'nobody@example.com', password: 'correct horse' });
  const wrongMs = await timeOf({ email: 'ann@example.com', password: 'nope' });
  assert.ok(missMs > 20, `unknown-email path still burns a scrypt run (${missMs.toFixed(1)}ms)`);
  assert.ok(
    Math.abs(missMs - wrongMs) < Math.max(missMs, wrongMs),
    `timings stay the same order of magnitude (${missMs.toFixed(1)}ms vs ${wrongMs.toFixed(1)}ms)`,
  );
});

test('login rejects a disabled member with the same generic answer', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  await call('POST', '/v1/auth/register', { body: { email: 'ann@example.com', password: 'pw-ann' } });
  hub.db.prepare('UPDATE member SET disabled_at = ? WHERE email = ?').run(Date.now(), 'ann@example.com');

  const res = await call('POST', '/v1/auth/login', {
    body: { email: 'ann@example.com', password: 'pw-ann' },
  });
  assert.equal(res.status, 401);
  assert.equal(res.json.error.code, 'invalid_credentials');
});

test('/v1/auth/me needs a live bearer token', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const reg = await call('POST', '/v1/auth/register', {
    body: { email: 'ann@example.com', password: 'correct horse' },
  });
  const token = reg.json.token;

  const withToken = await call('GET', '/v1/auth/me', { token });
  assert.equal(withToken.status, 200);
  assert.deepEqual(withToken.json.member, reg.json.member);

  for (const [label, opts] of [
    ['no header', {}],
    ['garbage token', { token: 'not-a-real-token' }],
    ['malformed scheme', { rawHeaders: { authorization: token } }],
  ]) {
    const res = await call('GET', '/v1/auth/me', opts);
    assert.equal(res.status, 401, label);
    assert.equal(res.json.error.code, 'unauthorized', label);
  }
});

test('logout invalidates the token it was called with, and nothing else', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const reg = await call('POST', '/v1/auth/register', {
    body: { email: 'ann@example.com', password: 'correct horse' },
  });
  const sessionA = reg.json.token;
  const sessionB = (
    await call('POST', '/v1/auth/login', { body: { email: 'ann@example.com', password: 'correct horse' } })
  ).json.token;
  assert.notEqual(sessionA, sessionB);

  assert.equal((await call('POST', '/v1/auth/logout')).status, 401, 'logout without a token is unauthorized');

  const out = await call('POST', '/v1/auth/logout', { token: sessionA });
  assert.equal(out.status, 204);
  assert.equal(out.text, '', '204 carries no body');

  assert.equal((await call('GET', '/v1/auth/me', { token: sessionA })).status, 401, 'the token is dead');
  assert.equal((await call('GET', '/v1/auth/me', { token: sessionB })).status, 200, 'other sessions survive');
  assert.equal((await call('POST', '/v1/auth/logout', { token: sessionA })).status, 401, 'and stays dead');

  // The row is gone, not merely flagged.
  assert.equal(hub.db.prepare('SELECT count(*) AS n FROM session').get().n, 1);

  // Credentials still work — logging out is not disabling an account.
  const back = await call('POST', '/v1/auth/login', {
    body: { email: 'ann@example.com', password: 'correct horse' },
  });
  assert.equal(back.status, 200);
});

test('an expired session is refused and swept', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const reg = await call('POST', '/v1/auth/register', {
    body: { email: 'ann@example.com', password: 'correct horse' },
  });
  hub.db.prepare('UPDATE session SET expires_at = ?').run(Date.now() - 1000);

  assert.equal((await call('GET', '/v1/auth/me', { token: reg.json.token })).status, 401);
  assert.equal(hub.db.prepare('SELECT count(*) AS n FROM session').get().n, 0);
});

test('input validation returns the documented codes', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  /** @type {Array<[string, unknown, string]>} */
  const cases = [
    ['missing email', { password: 'x' }, 'invalid_email'],
    ['not an email', { email: 'ann', password: 'x' }, 'invalid_email'],
    ['no domain dot', { email: 'ann@localhost', password: 'x' }, 'invalid_email'],
    ['missing password', { email: 'ann@example.com' }, 'invalid_password'],
    ['empty password', { email: 'ann@example.com', password: '' }, 'invalid_password'],
    ['non-string password', { email: 'ann@example.com', password: 12345 }, 'invalid_password'],
  ];

  for (const [label, body, code] of cases) {
    const res = await call('POST', '/v1/auth/register', { body });
    assert.equal(res.status, 400, label);
    assert.equal(res.json.error.code, code, label);
  }

  const notJson = await call('POST', '/v1/auth/login', {
    rawHeaders: { 'content-type': 'application/json' },
    body: undefined,
  });
  assert.equal(notJson.status, 401, 'an empty body is treated as empty credentials, not as a crash');
  assert.equal(notJson.json.error.code, 'invalid_credentials');
});

test('rate limiting stops password guessing from one address', async (t) => {
  const { hub, call } = await bootHub({ rateLimit: { limit: 3, windowMs: 60_000 } });
  t.after(() => hub.close());

  await call('POST', '/v1/auth/register', { body: { email: 'ann@example.com', password: 'correct horse' } });

  const second = await call('POST', '/v1/auth/login', { body: { email: 'ann@example.com', password: 'no' } });
  assert.equal(second.status, 401);
  const third = await call('POST', '/v1/auth/login', { body: { email: 'ann@example.com', password: 'no' } });
  assert.equal(third.status, 401);

  const blocked = await call('POST', '/v1/auth/login', {
    body: { email: 'ann@example.com', password: 'correct horse' },
  });
  assert.equal(blocked.status, 429, 'the budget is shared by register and login');
  assert.equal(blocked.json.error.code, 'rate_limited');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);

  // Reading your own profile is not an attack surface and is not throttled.
  assert.equal((await call('GET', '/v1/health')).status, 200);
});

test('the limiter defaults to 10 attempts per minute and forgets old ones', () => {
  const limiter = createRateLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < 10; i += 1) {
    assert.equal(limiter.check('1.2.3.4', t0 + i).allowed, true, `attempt ${i + 1}`);
  }
  const blocked = limiter.check('1.2.3.4', t0 + 10);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0);
  assert.equal(limiter.check('5.6.7.8', t0 + 10).allowed, true, 'buckets are per address');
  assert.equal(limiter.check('1.2.3.4', t0 + 60_001).allowed, true, 'the window slides');
});

test('CORS answers the dev preview on any loopback port and nobody else', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const dev = await call('GET', '/v1/health', { origin: 'http://localhost:5273' });
  assert.equal(dev.headers.get('access-control-allow-origin'), 'http://localhost:5273');
  assert.equal(dev.headers.get('vary'), 'Origin');

  const randomPort = await call('GET', '/v1/health', { origin: 'http://localhost:61234' });
  assert.equal(randomPort.headers.get('access-control-allow-origin'), 'http://localhost:61234');

  const evil = await call('GET', '/v1/health', { origin: 'https://evil.example.com' });
  assert.equal(evil.status, 200);
  assert.equal(evil.headers.get('access-control-allow-origin'), null, 'no header, so the browser blocks the read');

  const preflight = await call('OPTIONS', '/v1/auth/login', { origin: 'http://localhost:5273' });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/i);

  const evilPreflight = await call('OPTIONS', '/v1/auth/login', { origin: 'https://evil.example.com' });
  assert.equal(evilPreflight.status, 403);
});

test('origin allowlist from the environment replaces the loopback default', () => {
  assert.equal(parseOrigins(undefined), null);
  assert.equal(parseOrigins('  '), null);
  assert.deepEqual(parseOrigins('https://hub.example.com/, http://localhost:5273'), [
    'https://hub.example.com',
    'http://localhost:5273',
  ]);

  const list = parseOrigins('https://hub.example.com');
  assert.equal(isAllowedOrigin('https://hub.example.com', list), true);
  assert.equal(isAllowedOrigin('http://localhost:5273', list), false, 'an explicit list is exhaustive');
  assert.equal(isAllowedOrigin('http://localhost:5273', null), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:9999', null), true);
  assert.equal(isAllowedOrigin('http://evil.com', null), false);
  assert.equal(isAllowedOrigin(undefined, null), false);
});

test('unknown routes and methods answer in the documented error shape', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const missing = await call('GET', '/v1/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'not_found');

  const wrongMethod = await call('GET', '/v1/auth/login');
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.json.error.code, 'method_not_allowed');
  assert.match(wrongMethod.headers.get('allow'), /POST/);

  const wrongType = await call('POST', '/v1/auth/login', {
    rawHeaders: { 'content-type': 'text/plain' },
    body: { email: 'a@b.co', password: 'x' },
  });
  assert.equal(wrongType.status, 415, 'a cross-site "simple request" cannot reach the auth endpoints');
});

test('scrypt hashing round-trips and rejects tampering', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.match(stored, /^scrypt\$32768\$8\$1\$/);

  const [, , , , saltB64, hashB64] = stored.split('$');
  assert.equal(Buffer.from(saltB64, 'base64').length, 16, 'salt is 16 random bytes');
  assert.equal(Buffer.from(hashB64, 'base64').length, 32);
  assert.notEqual(hashPassword('correct horse battery staple'), stored, 'the salt differs every time');

  assert.equal(verifyPassword('correct horse battery staple', stored), true);
  assert.equal(verifyPassword('correct horse battery stapl', stored), false);
  assert.equal(verifyPassword('', stored), false);
  assert.equal(verifyPassword('x', 'garbage'), false, 'a corrupt row fails closed, it does not throw');
  assert.equal(verifyPassword('x', ''), false);
});

test('colour assignment stays inside the jewel palette and wraps around', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  /** @type {string[]} */
  const assigned = [];
  for (let i = 0; i < 8; i += 1) {
    const res = await call('POST', '/v1/auth/register', {
      body: { email: `person${i}@example.com`, password: `pw-${i}` },
    });
    assert.equal(res.status, 201);
    assigned.push(res.json.member.colorSlug);
  }

  assert.deepEqual(assigned.slice(0, 6), [...COLOR_SLUGS], 'first six members get six distinct colours');
  assert.deepEqual(assigned.slice(6), ['teal', 'rose'], 'the seventh starts the second lap on the least-used');

  for (const slug of assigned) assert.ok(COLOR_SLUGS.includes(slug));
});

test('handles are derived from the email and made unique', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const handleOf = async (email) =>
    (await call('POST', '/v1/auth/register', { body: { email, password: 'pw' } })).json.member.handle;

  assert.equal(await handleOf('ann.smith@example.com'), 'ann-smith');
  assert.equal(await handleOf('ann.smith@other.com'), 'ann-smith-2', 'collisions get a suffix');
  assert.equal(await handleOf('ann.smith@third.com'), 'ann-smith-3');
  assert.equal(await handleOf('ann+work@fourth.com'), 'ann', 'a plus tag is not part of the name');
  assert.equal(await handleOf('__@fifth.com'), '__');
  assert.equal(await handleOf('...@sixth.com'), 'member', 'an unusable local part still yields a handle');
});

test('the database survives a restart with its members intact', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partycod-restart-'));
  tempDirs.push(dir);
  const dbPath = path.join(dir, 'hub.db');

  const first = await startHub({ dbPath, port: 0, rateLimit: { limit: 1000 } });
  const reg = await fetch(`http://127.0.0.1:${first.port}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ann@example.com', password: 'correct horse' }),
  }).then((r) => r.json());
  await first.close();

  const second = await startHub({ dbPath, port: 0, rateLimit: { limit: 1000 } });
  t.after(() => second.close());

  const health = await fetch(`http://127.0.0.1:${second.port}/v1/health`).then((r) => r.json());
  assert.equal(health.members, 1, 'migrations are idempotent and the data is still there');

  const me = await fetch(`http://127.0.0.1:${second.port}/v1/auth/me`, {
    headers: { authorization: `Bearer ${reg.token}` },
  });
  assert.equal(me.status, 200, 'the session outlives the process');

  const versions = second.db.prepare('SELECT version FROM schema_version ORDER BY version').all();
  assert.deepEqual(
    versions.map((r) => Number(r.version)),
    [1, 2, 3],
    'every migration ran exactly once',
  );
});

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/**
 * Register the owner of a fresh hub and return their token.
 * @param {Function} call
 * @returns {Promise<{ token: string, member: any }>}
 */
async function bootOwner(call) {
  const res = await call('POST', '/v1/auth/register', {
    body: { email: 'ann@example.com', password: 'pw-owner', displayName: 'Аня' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.member.role, 'owner');
  return res.json;
}

/**
 * Invite somebody with a given role and have them register through the code.
 * @param {Function} call
 * @param {string} ownerToken
 * @param {string} role
 * @param {string} email
 */
async function joinAs(call, ownerToken, role, email) {
  const invite = await call('POST', '/v1/invites', { token: ownerToken, body: { role, seats: 'one' } });
  assert.equal(invite.status, 201, `invite for ${role}`);
  const reg = await call('POST', '/v1/auth/register', {
    body: { email, password: `pw-${role}`, inviteCode: invite.json.invite.code },
  });
  assert.equal(reg.status, 201, `${role} registered`);
  assert.equal(reg.json.member.role, role, 'the role comes from the invitation');
  return reg.json;
}

test('an invite code is built from the look-alike-free alphabet, without modulo bias', () => {
  assert.equal(INVITE_CODE_ALPHABET.length, 31, 'the whole point of the discard loop below');
  for (const forbidden of ['O', '0', 'I', 'L', '1']) {
    assert.ok(!INVITE_CODE_ALPHABET.includes(forbidden), `${forbidden} is a look-alike and is not in the alphabet`);
  }
  assert.equal(new Set(INVITE_CODE_ALPHABET).size, INVITE_CODE_ALPHABET.length, 'no symbol appears twice');

  const code = generateInviteCode();
  assert.equal(code.length, INVITE_CODE_GROUPS * INVITE_CODE_GROUP_SIZE);
  for (const ch of code) assert.ok(INVITE_CODE_ALPHABET.includes(ch));
  assert.match(formatInviteCode(code), /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  // The bias check, made deterministic by feeding the generator a known byte stream.
  // 248..255 are the eight values a `% 31` on a raw byte would fold onto A..H a ninth time,
  // making those eight symbols ~12.5% more likely than the other 23. They must be discarded.
  const real = crypto.randomBytes;
  try {
    assert.throws(
      () => {
        // Nothing but rejected bytes ever arrives, so the loop must never produce a code.
        // The guard turns "hangs forever" into a failure we can actually see.
        let drawn = 0;
        crypto.randomBytes = (n) => {
          if ((drawn += n) > 4096) throw new Error('all-rejected');
          return Buffer.alloc(n, 250);
        };
        generateInviteCode();
      },
      /all-rejected/,
      'a byte at or above 248 is thrown away, never folded into the alphabet',
    );

    const stream = [248, 255, 0, 1, 2, 249, 3, 30];
    let i = 0;
    crypto.randomBytes = (n) => Buffer.from(Array.from({ length: n }, () => stream[i++ % stream.length]));
    const expected = [0, 1, 2, 3, 30].map((index) => INVITE_CODE_ALPHABET[index]).join('');
    assert.equal(
      generateInviteCode().slice(0, expected.length),
      expected,
      'an accepted byte indexes the alphabet; a rejected one advances nothing',
    );
  } finally {
    crypto.randomBytes = real;
  }
});

test('the code alphabet in the UI model and in the hub are the same string', () => {
  // Two copies exist because apps/hub is dependency-free plain JS and cannot import a
  // TypeScript package. Reading the other file as text is what keeps them from drifting —
  // the same trick COLOR_SLUGS uses against the palette.
  const modelPath = path.join(
    import.meta.dirname,
    '..',
    '..',
    'packages',
    'ui',
    'src',
    'components',
    'AppShell',
    'model.ts',
  );
  const source = fs.readFileSync(modelPath, 'utf8');

  const alphabet = /export const INVITE_CODE_ALPHABET = '([^']*)'/.exec(source);
  const groups = /export const INVITE_CODE_GROUPS = (\d+)/.exec(source);
  const groupSize = /export const INVITE_CODE_GROUP_SIZE = (\d+)/.exec(source);

  assert.ok(alphabet, 'model.ts still declares INVITE_CODE_ALPHABET');
  assert.ok(groups && groupSize, 'model.ts still declares the group constants');
  assert.equal(alphabet[1], INVITE_CODE_ALPHABET, 'the alphabets have drifted apart');
  assert.equal(Number(groups[1]), INVITE_CODE_GROUPS);
  assert.equal(Number(groupSize[1]), INVITE_CODE_GROUP_SIZE);
});

test('typed codes are normalised, and unknown characters are refused rather than guessed', () => {
  // Note the sample: the designer's `HTAL-4K7M-9ZQD` cannot be a real code — `L` is one of
  // the look-alikes the alphabet drops. `HTAK-…` is the same shape with a legal symbol.
  assert.equal(normalizeInviteCode('htak-4k7m-9zqd'), 'HTAK4K7M9ZQD');
  assert.equal(normalizeInviteCode('  HTAK 4K7M 9ZQD '), 'HTAK4K7M9ZQD');
  assert.equal(normalizeInviteCode('HTAK4K7M9ZQD'), 'HTAK4K7M9ZQD');
  assert.equal(formatInviteCode('HTAK4K7M9ZQD'), 'HTAK-4K7M-9ZQD');

  // No "friendly" 0 → O: neither character is in the alphabet, so a substitution would have
  // nothing correct to land on and would silently point at somebody else's live code.
  const refused = [
    'HTAK-4K7M-9ZQ0',
    'HTAK-4K7M-9ZQO',
    'IIII-2222-KKKK',
    'HTAL-4K7M-9ZQD',
    'HTAK-4K7M',
    'HTAK-4K7M-9ZQDX',
    '',
  ];
  for (const bad of refused) {
    assert.throws(() => normalizeInviteCode(bad), (err) => err.code === 'invalid_code', bad);
  }
  assert.throws(() => normalizeInviteCode(undefined), (err) => err.status === 400);
});

test('only the owner and maintainers may hand out invitations', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const maintainer = await joinAs(call, owner.token, 'maintainer', 'timur@example.com');
  const member = await joinAs(call, owner.token, 'member', 'marina@example.com');
  const observer = await joinAs(call, owner.token, 'observer', 'petya@example.com');

  for (const [label, actor] of [['owner', owner], ['maintainer', maintainer]]) {
    const res = await call('POST', '/v1/invites', { token: actor.token, body: { role: 'member' } });
    assert.equal(res.status, 201, label);
    assert.equal(res.json.invite.role, 'member');
  }

  for (const [label, actor] of [['member', member], ['observer', observer]]) {
    const res = await call('POST', '/v1/invites', { token: actor.token, body: { role: 'member' } });
    assert.equal(res.status, 403, label);
    assert.equal(res.json.error.code, 'forbidden');
    // Authorisation is answered before the payload is judged, so a refused caller does not
    // get to use the endpoint as an address validator.
    const malformed = await call('POST', '/v1/invites', {
      token: actor.token,
      body: { role: 'owner', email: 'not-an-address', lifetime: 'decade' },
    });
    assert.equal(malformed.status, 403, `${label} is refused before anything is validated`);
    assert.equal(malformed.json.error.code, 'forbidden');
    const revoke = await call('POST', '/v1/invites/revoke', { token: actor.token, body: { code: 'HTAK-4K7M-9ZQD' } });
    assert.equal(revoke.status, 403, `${label} cannot revoke either`);
  }

  const anonymous = await call('POST', '/v1/invites', { body: { role: 'member' } });
  assert.equal(anonymous.status, 401);
});

test('owner is not a role an invitation can hand out', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const res = await call('POST', '/v1/invites', { token: owner.token, body: { role: 'owner' } });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'invalid_role');
  assert.ok(!/sql|check|constraint/i.test(res.json.error.message), 'no internals leak into the message');

  for (const role of ['admin', '', 42, undefined]) {
    const bad = await call('POST', '/v1/invites', { token: owner.token, body: { role } });
    assert.equal(bad.status, 400, String(role));
    assert.equal(bad.json.error.code, 'invalid_role');
  }

  // And the database refuses it too, not only the handler.
  assert.throws(() =>
    hub.db
      .prepare('INSERT INTO invite(code, role, created_by, created_at, used_count) VALUES(?,?,?,?,0)')
      .run('AAAABBBBCCCC', 'owner', owner.member.id, Date.now()),
  );
});

test('peek answers a guest without a session and tells a guesser nothing', async (t) => {
  const { hub, call } = await bootHub({ projectName: 'Хайтейл' });
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  /** @param {object} body */
  const make = async (body) => (await call('POST', '/v1/invites', { token: owner.token, body })).json.invite.code;

  const live = await make({ role: 'maintainer', lifetime: 'week', seats: 'five' });
  const peek = await call('GET', `/v1/invites/peek?code=${live}`);
  assert.equal(peek.status, 200, 'no session required');
  assert.deepEqual(peek.json, { valid: true, role: 'maintainer', projectName: 'Хайтейл' });
  assert.ok(!peek.text.includes('ann@example.com'), 'nothing about who invited');
  assert.ok(!/createdBy|usedCount|expiresAt/.test(peek.text), 'nothing about the invitation beyond the answer');

  const lowercase = await call('GET', `/v1/invites/peek?code=${live.toLowerCase()}`);
  assert.deepEqual(lowercase.json, peek.json, 'the code is normalised on the way in');

  const expired = await make({ role: 'member' });
  hub.db.prepare('UPDATE invite SET expires_at = ? WHERE code = ?').run(Date.now() - 1, normalizeInviteCode(expired));
  const revoked = await make({ role: 'member' });
  await call('POST', '/v1/invites/revoke', { token: owner.token, body: { code: revoked } });
  const exhausted = await make({ role: 'member', seats: 'one' });
  await joinAsCode(call, exhausted, 'dima@example.com');

  const dead = [
    ['expired', expired],
    ['revoked', revoked],
    ['exhausted', exhausted],
    ['never existed', 'ZZZZ-ZZZZ-ZZZZ'],
    ['malformed', 'nope'],
    ['empty', ''],
  ];
  for (const [label, code] of dead) {
    const res = await call('GET', `/v1/invites/peek?code=${encodeURIComponent(code)}`);
    assert.equal(res.status, 200, label);
    assert.deepEqual(res.json, { valid: false }, `${label} must be indistinguishable from the rest`);
  }
  const missing = await call('GET', '/v1/invites/peek');
  assert.deepEqual(missing.json, { valid: false }, 'a missing parameter is not a different answer either');
});

/**
 * Register a brand new person through a code.
 * @param {Function} call
 * @param {string} code
 * @param {string} email
 */
async function joinAsCode(call, code, email) {
  return call('POST', '/v1/auth/register', { body: { email, password: 'pw', inviteCode: code } });
}

test('peek shares the password-guessing budget with register and login', async (t) => {
  const { hub, call } = await bootHub({ rateLimit: { limit: 3, windowMs: 60_000 } });
  t.after(() => hub.close());

  await call('POST', '/v1/auth/register', { body: { email: 'ann@example.com', password: 'pw' } });
  assert.equal((await call('GET', '/v1/invites/peek?code=ZZZZ-ZZZZ-ZZZZ')).status, 200);
  assert.equal((await call('GET', '/v1/invites/peek?code=YYYY-YYYY-YYYY')).status, 200);

  const blocked = await call('GET', '/v1/invites/peek?code=XXXX-XXXX-XXXX');
  assert.equal(blocked.status, 429, 'guessing codes is guessing, and costs from the same bucket');
  assert.equal(blocked.json.error.code, 'rate_limited');
});

test('registering with a code inherits its role, records the use and refuses a dead code', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const created = await call('POST', '/v1/invites', {
    token: owner.token,
    body: { role: 'maintainer', lifetime: 'week', seats: 'five' },
  });
  const code = created.json.invite.code;

  const joined = await joinAsCode(call, code, 'timur@example.com');
  assert.equal(joined.status, 201);
  assert.equal(joined.json.member.role, 'maintainer', 'the role is the one the invitation promised');

  const stored = normalizeInviteCode(code);
  const use = hub.db.prepare('SELECT * FROM invite_use WHERE code = ?').all(stored);
  assert.equal(use.length, 1, 'the ledger, not only the counter');
  assert.equal(use[0].code, stored);
  assert.equal(use[0].member_id, joined.json.member.id);
  assert.equal(hub.db.prepare('SELECT used_count AS n FROM invite WHERE code = ?').get(stored).n, 1);

  const list = await call('GET', '/v1/invites', { token: owner.token });
  assert.equal(list.json.invites[0].usedCount, 1, '"1 из 5" comes from the ledger');
  assert.equal(list.json.invites[0].maxUses, 5);
  assert.equal(list.json.invites[0].status, 'pending', 'four seats left');

  // A code that is present but no good stops the registration — it does not quietly fall
  // back to an ordinary member.
  for (const bad of ['ZZZZ-ZZZZ-ZZZZ', 'not-a-code']) {
    const res = await joinAsCode(call, bad, 'ghost@example.com');
    assert.equal(res.status, 400, bad);
    assert.match(res.json.error.code, /^(invite_invalid|invalid_code)$/);
  }
  assert.equal((await call('GET', '/v1/health')).json.members, 2, 'no ghost got in');

  // No code at all is still the plain path: the hub is not invite-only.
  const walkIn = await call('POST', '/v1/auth/register', { body: { email: 'x@example.com', password: 'pw' } });
  assert.equal(walkIn.json.member.role, 'member');
});

test('a code stops admitting people once its seats are gone', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const created = await call('POST', '/v1/invites', {
    token: owner.token,
    body: { role: 'member', seats: 'one' },
  });
  const code = created.json.invite.code;
  assert.equal(created.json.invite.maxUses, 1);

  assert.equal((await joinAsCode(call, code, 'first@example.com')).status, 201);

  const second = await joinAsCode(call, code, 'second@example.com');
  assert.equal(second.status, 400, 'the second person finds the seat taken');
  assert.equal(second.json.error.code, 'invite_invalid');
  assert.equal((await call('GET', '/v1/health')).json.members, 2);

  const list = await call('GET', '/v1/invites', { token: owner.token });
  assert.equal(list.json.invites[0].status, 'accepted', 'a used-up invitation reads as accepted');
  assert.equal(list.json.invites[0].usedCount, 1);

  // An unlimited code has no such wall.
  const open = await call('POST', '/v1/invites', { token: owner.token, body: { role: 'observer', seats: 'any' } });
  assert.equal(open.json.invite.maxUses, null);
  for (const email of ['a@example.com', 'b@example.com', 'c@example.com']) {
    assert.equal((await joinAsCode(call, open.json.invite.code, email)).status, 201, email);
  }
  const after = await call('GET', '/v1/invites', { token: owner.token });
  const openRow = after.json.invites.find((i) => i.code === open.json.invite.code);
  assert.equal(openRow.usedCount, 3);
  assert.equal(openRow.status, 'pending');
});

test('eight people racing for five seats produce five members, not six', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const created = await call('POST', '/v1/invites', {
    token: owner.token,
    body: { role: 'member', seats: 'five' },
  });
  const code = created.json.invite.code;

  // A single-threaded server with a synchronous database serialises these anyway; what the
  // test pins down is that the seat is taken inside the same transaction as the member
  // insert, so the count cannot be checked in one breath and spent in another.
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => joinAsCode(call, code, `racer${i}@example.com`)),
  );
  const admitted = results.filter((r) => r.status === 201);
  const refused = results.filter((r) => r.status === 400);

  assert.equal(admitted.length, 5, 'exactly the number of seats');
  assert.equal(refused.length, 3);
  assert.ok(refused.every((r) => r.json.error.code === 'invite_invalid'));
  assert.ok(admitted.every((r) => r.json.member.role === 'member'));

  const stored = normalizeInviteCode(code);
  assert.equal(hub.db.prepare('SELECT used_count AS n FROM invite WHERE code = ?').get(stored).n, 5);
  assert.equal(hub.db.prepare('SELECT count(*) AS n FROM invite_use WHERE code = ?').get(stored).n, 5);
  assert.equal((await call('GET', '/v1/health')).json.members, 6, 'the owner plus five');
});

test('lifetime and expiry are what the invitation says they are', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const t0 = Date.now();

  const day = await call('POST', '/v1/invites', { token: owner.token, body: { role: 'member', lifetime: 'day' } });
  assert.ok(Math.abs(day.json.invite.expiresAt - (t0 + 24 * 3600 * 1000)) < 5000);

  const week = await call('POST', '/v1/invites', { token: owner.token, body: { role: 'member', lifetime: 'week' } });
  assert.ok(Math.abs(week.json.invite.expiresAt - (t0 + 7 * 24 * 3600 * 1000)) < 5000);

  const forever = await call('POST', '/v1/invites', {
    token: owner.token,
    body: { role: 'member', lifetime: 'forever' },
  });
  assert.equal(forever.json.invite.expiresAt, null, 'until it is switched off by hand');

  const bad = await call('POST', '/v1/invites', { token: owner.token, body: { role: 'member', lifetime: 'decade' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'invalid_lifetime');
  const badSeats = await call('POST', '/v1/invites', { token: owner.token, body: { role: 'member', seats: 'nine' } });
  assert.equal(badSeats.json.error.code, 'invalid_seats');

  // An expired code admits nobody and reads as expired.
  hub.db.prepare('UPDATE invite SET expires_at = ? WHERE code = ?').run(t0 - 1, normalizeInviteCode(day.json.invite.code));
  assert.equal((await joinAsCode(call, day.json.invite.code, 'late@example.com')).status, 400);
  const list = await call('GET', '/v1/invites', { token: owner.token });
  assert.equal(list.json.invites.find((i) => i.code === day.json.invite.code).status, 'expired');
});

test('revoking a code is immediate and idempotent', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const created = await call('POST', '/v1/invites', { token: owner.token, body: { role: 'member', seats: 'any' } });
  const code = created.json.invite.code;

  const first = await call('POST', '/v1/invites/revoke', { token: owner.token, body: { code } });
  assert.equal(first.status, 200);
  assert.equal(first.json.invite.status, 'revoked');
  assert.ok(first.json.invite.revokedAt > 0);

  const again = await call('POST', '/v1/invites/revoke', { token: owner.token, body: { code: code.toLowerCase() } });
  assert.equal(again.status, 200, 'revoking twice is not an error');
  assert.equal(again.json.invite.revokedAt, first.json.invite.revokedAt, 'and does not move the timestamp');

  assert.equal((await joinAsCode(call, code, 'late@example.com')).status, 400, 'a revoked code admits nobody');
  assert.deepEqual((await call('GET', `/v1/invites/peek?code=${code}`)).json, { valid: false });

  const unknown = await call('POST', '/v1/invites/revoke', { token: owner.token, body: { code: 'ZZZZ-ZZZZ-ZZZZ' } });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error.code, 'invite_not_found');
});

test('redeeming with an existing account is idempotent and never lowers a role', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const walkIn = (await call('POST', '/v1/auth/register', { body: { email: 'marina@example.com', password: 'pw' } }))
    .json;
  assert.equal(walkIn.member.role, 'member');

  const promotion = await call('POST', '/v1/invites', {
    token: owner.token,
    body: { role: 'maintainer', seats: 'five' },
  });
  const code = promotion.json.invite.code;

  const first = await call('POST', '/v1/invites/redeem', { token: walkIn.token, body: { code } });
  assert.equal(first.status, 200);
  assert.equal(first.json.alreadyRedeemed, false);
  assert.equal(first.json.member.role, 'maintainer', 'the invitation raised the role');
  assert.equal(first.json.invite.usedCount, 1);

  const twice = await call('POST', '/v1/invites/redeem', { token: walkIn.token, body: { code } });
  assert.equal(twice.status, 200);
  assert.equal(twice.json.alreadyRedeemed, true);
  assert.equal(twice.json.invite.usedCount, 1, 'the same person does not spend a second seat');
  assert.equal(
    hub.db.prepare('SELECT count(*) AS n FROM invite_use WHERE code = ?').get(normalizeInviteCode(code)).n,
    1,
  );

  // A code offering less than you already have cannot be used to demote you.
  const demotion = await call('POST', '/v1/invites', { token: owner.token, body: { role: 'observer' } });
  const attempt = await call('POST', '/v1/invites/redeem', { token: walkIn.token, body: { code: demotion.json.invite.code } });
  assert.equal(attempt.status, 200);
  assert.equal(attempt.json.member.role, 'maintainer', 'redeeming a weaker invitation is not a demotion');

  // The owner stays the owner whatever they redeem.
  const ownerRedeem = await call('POST', '/v1/invites/redeem', {
    token: owner.token,
    body: { code: demotion.json.invite.code },
  });
  assert.equal(ownerRedeem.json.member.role, 'owner');

  const dead = await call('POST', '/v1/invites/redeem', { token: walkIn.token, body: { code: 'ZZZZ-ZZZZ-ZZZZ' } });
  assert.equal(dead.status, 400);
  assert.equal(dead.json.error.code, 'invite_invalid');
  assert.equal((await call('POST', '/v1/invites/redeem', { body: { code } })).status, 401, 'a session is required');
});

test('mail is an option of the hub, and the answer never claims a letter went out', async (t) => {
  const withoutSmtp = await bootHub();
  t.after(() => withoutSmtp.hub.close());

  const owner = await bootOwner(withoutSmtp.call);
  const plain = await withoutSmtp.call('POST', '/v1/invites', {
    token: owner.token,
    body: { role: 'member', email: 'Dima@Hightale.dev' },
  });
  assert.equal(plain.status, 201);
  assert.equal(plain.json.invite.channel, 'email');
  assert.equal(plain.json.invite.email, 'dima@hightale.dev', 'the address is folded like every other one');
  assert.equal(plain.json.invite.maxUses, 1, 'an invitation addressed to one person seats one');
  assert.equal(plain.json.mailSent, false);
  assert.equal(plain.json.mailPending, false, 'nothing is pending when no route is configured');
  assert.match(plain.json.joinUrl, /\/join\/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(plain.json.joinUrl, plain.json.invite.joinUrl);

  const bad = await withoutSmtp.call('POST', '/v1/invites', {
    token: owner.token,
    body: { role: 'member', email: 'not-an-address' },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'invalid_email');

  const withSmtp = await bootHub({ smtpUrl: 'smtp://mail.example.com', publicUrl: 'https://hub.hightale.dev/' });
  t.after(() => withSmtp.hub.close());
  const owner2 = await bootOwner(withSmtp.call);
  const mailed = await withSmtp.call('POST', '/v1/invites', {
    token: owner2.token,
    body: { role: 'member', email: 'dima@hightale.dev' },
  });
  assert.equal(mailed.json.mailSent, false, 'the hub has no SMTP client and does not pretend to');
  assert.equal(mailed.json.mailPending, true);
  assert.match(mailed.json.joinUrl, /^https:\/\/hub\.hightale\.dev\/join\//, 'the public URL wins over the socket');

  const codeInvite = await withSmtp.call('POST', '/v1/invites', { token: owner2.token, body: { role: 'member' } });
  assert.equal(codeInvite.json.invite.channel, 'code');
  assert.equal(codeInvite.json.invite.email, null);
  assert.equal(codeInvite.json.mailPending, false, 'no address, no letter to wait for');
});

test('the invitation list is readable by the team, but live codes are not', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const observer = await joinAs(call, owner.token, 'observer', 'petya@example.com');
  await call('POST', '/v1/invites', { token: owner.token, body: { role: 'maintainer', seats: 'any' } });

  const asOwner = await call('GET', '/v1/invites', { token: owner.token });
  assert.equal(asOwner.status, 200);
  assert.equal(asOwner.json.invites.length, 2);
  assert.ok(asOwner.json.invites.every((i) => typeof i.code === 'string' && typeof i.joinUrl === 'string'));
  assert.ok(
    asOwner.json.invites[0].createdAt >= asOwner.json.invites[1].createdAt,
    'newest first',
  );

  const asObserver = await call('GET', '/v1/invites', { token: observer.token });
  assert.equal(asObserver.status, 200, 'the team may see that invitations exist');
  assert.ok(
    asObserver.json.invites.every((i) => i.code === null && i.joinUrl === null),
    'a live code is a seat in the team; an observer must not be able to hand one out',
  );
  assert.ok(asObserver.json.invites.every((i) => typeof i.status === 'string'));

  assert.equal((await call('GET', '/v1/invites')).status, 401);
});

test('the member list hides other people addresses from a plain member', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const maintainer = await joinAs(call, owner.token, 'maintainer', 'timur@example.com');
  const member = await joinAs(call, owner.token, 'member', 'marina@example.com');
  const observer = await joinAs(call, owner.token, 'observer', 'petya@example.com');

  for (const [label, actor] of [['owner', owner], ['maintainer', maintainer]]) {
    const res = await call('GET', '/v1/members', { token: actor.token });
    assert.equal(res.status, 200, label);
    assert.equal(res.json.members.length, 4);
    assert.ok(res.json.members.every((m) => typeof m.email === 'string'), `${label} sees every address`);
  }

  for (const [label, actor] of [['member', member], ['observer', observer]]) {
    const res = await call('GET', '/v1/members', { token: actor.token });
    assert.equal(res.status, 200, label);
    const mine = res.json.members.find((m) => m.id === actor.member.id);
    assert.equal(mine.email, actor.member.email, `${label} still sees their own address`);
    assert.ok(
      res.json.members.filter((m) => m.id !== actor.member.id).every((m) => m.email === null),
      `${label} must not be able to export the team's addresses`,
    );
    assert.ok(!res.text.includes('ann@example.com'), 'and the redaction survives serialisation');
    // Everything else the team panel needs is still there.
    assert.deepEqual(Object.keys(res.json.members[0]).sort(), [
      'colorSlug',
      'createdAt',
      'displayName',
      'email',
      'handle',
      'id',
      'role',
    ]);
  }

  assert.ok(!(await call('GET', '/v1/members', { token: owner.token })).text.includes('password'));
  assert.equal((await call('GET', '/v1/members')).status, 401);
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * @param {Function} call
 * @param {string} token
 * @param {string} name
 */
async function makeProject(call, token, name) {
  const res = await call('POST', '/v1/projects', { token, body: { name } });
  assert.equal(res.status, 201, `project ${name}: ${res.text}`);
  return res.json.project;
}

/**
 * @param {Function} call
 * @param {string} token
 * @param {string} projectId
 */
function rosterOf(call, token, projectId) {
  return call('GET', `/v1/projects/members?projectId=${encodeURIComponent(projectId)}`, { token });
}

test('a project is created only when somebody asks, and its creator owns it', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);

  // Registering did not quietly create anything. A hub with one member and no projects is
  // the truthful state, and the empty list is what the UI must be able to say.
  const before = await call('GET', '/v1/projects', { token: owner.token });
  assert.equal(before.status, 200);
  assert.deepEqual(before.json.projects, [], 'the first member does not get a project handed to them');
  assert.equal(hub.db.prepare('SELECT count(*) AS n FROM project').get().n, 0);

  const created = await call('POST', '/v1/projects', { token: owner.token, body: { name: '  Atlas  ' } });
  assert.equal(created.status, 201);
  const project = created.json.project;
  assert.deepEqual(Object.keys(project).sort(), [
    'archivedAt',
    'createdAt',
    'createdBy',
    'id',
    'joinedAt',
    'memberCount',
    'name',
    'role',
    'slug',
  ]);
  assert.equal(project.name, 'Atlas', 'the name is trimmed, not otherwise touched');
  assert.equal(project.slug, 'atlas');
  assert.equal(project.createdBy, owner.member.id);
  assert.equal(project.role, 'owner', 'the creator owns the project they created');
  assert.equal(project.memberCount, 1);
  assert.equal(project.archivedAt, null, 'nothing archives a project yet, and the API says null');
  assert.ok(project.createdAt > 0 && project.joinedAt > 0);

  // The owner row is real, in the same transaction as the project.
  const rows = hub.db.prepare('SELECT * FROM project_member WHERE project_id = ?').all(project.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].member_id, owner.member.id);
  assert.equal(rows[0].role, 'owner');

  const after = await call('GET', '/v1/projects', { token: owner.token });
  assert.equal(after.json.projects.length, 1);
  assert.deepEqual(after.json.projects[0], project);

  const roster = await rosterOf(call, owner.token, project.id);
  assert.equal(roster.status, 200);
  assert.equal(roster.json.members.length, 1);
  assert.equal(roster.json.members[0].id, owner.member.id);
  assert.equal(roster.json.members[0].projectRole, 'owner');
  assert.equal(roster.json.members[0].role, 'owner', 'the hub role is still reported, separately');

  assert.equal((await call('GET', '/v1/projects')).status, 401, 'a session is required');
  assert.equal((await call('POST', '/v1/projects', { body: { name: 'Ghost' } })).status, 401);
  assert.equal(hub.db.prepare('SELECT count(*) AS n FROM project').get().n, 1);
});

test('a project name is validated and the slug derived from it, collisions included', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);

  assert.equal((await makeProject(call, owner.token, 'Atlas')).slug, 'atlas');
  assert.equal((await makeProject(call, owner.token, 'Atlas')).slug, 'atlas-2', 'collisions get a suffix');
  assert.equal((await makeProject(call, owner.token, 'ATLAS!!!')).slug, 'atlas-3');
  assert.equal((await makeProject(call, owner.token, 'Web   App')).slug, 'web-app');
  assert.equal((await makeProject(call, owner.token, '-- v2 --')).slug, 'v2');

  // An entirely non-latin name has nothing left after the filter. The fallback is the same
  // one handles use, and the display name keeps the original — inventing a romanisation
  // would be guessing at somebody's name.
  const cyrillic = await makeProject(call, owner.token, 'Хайтейл');
  assert.equal(cyrillic.name, 'Хайтейл');
  assert.equal(cyrillic.slug, 'project');
  assert.equal((await makeProject(call, owner.token, 'Атлас')).slug, 'project-2');

  const slugs = hub.db.prepare('SELECT slug FROM project').all().map((r) => r.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'slugs are unique across the hub');

  /** @type {Array<[string, unknown]>} */
  const bad = [
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['not a string', 42],
    ['too long', 'x'.repeat(65)],
  ];
  for (const [label, name] of bad) {
    const res = await call('POST', '/v1/projects', { token: owner.token, body: { name } });
    assert.equal(res.status, 400, label);
    assert.equal(res.json.error.code, 'invalid_name', label);
    assert.ok(!/sql|constraint|slug/i.test(res.json.error.message), 'no internals leak into the message');
  }
  assert.equal((await makeProject(call, owner.token, 'x'.repeat(64))).name.length, 64, '64 is still fine');
});

test('the project list is your projects, and somebody else’s project is a 404', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  // A hub maintainer: high standing on the hub, none at all in a project he is not in.
  const outsider = await joinAs(call, owner.token, 'maintainer', 'timur@example.com');

  const atlas = await makeProject(call, owner.token, 'Atlas');
  const bench = await makeProject(call, outsider.token, 'Bench');

  const mine = await call('GET', '/v1/projects', { token: owner.token });
  assert.deepEqual(mine.json.projects.map((p) => p.name), ['Atlas'], 'not every project on the hub');
  const theirs = await call('GET', '/v1/projects', { token: outsider.token });
  assert.deepEqual(theirs.json.projects.map((p) => p.name), ['Bench']);
  assert.ok(!mine.text.includes('Bench'), 'a project you are not in is not even named to you');

  // 404, not 403: whether that id is a project is not a fact an outsider gets to learn.
  const foreign = await rosterOf(call, outsider.token, atlas.id);
  assert.equal(foreign.status, 404);
  assert.equal(foreign.json.error.code, 'project_not_found');
  const invented = await rosterOf(call, outsider.token, crypto.randomUUID());
  assert.deepEqual(invented.json, foreign.json, 'a real project and an imaginary one answer identically');
  assert.equal(invented.status, 404);

  const write = await call('POST', '/v1/projects/members', {
    token: outsider.token,
    body: { projectId: atlas.id, memberId: outsider.member.id, role: 'owner' },
  });
  assert.equal(write.status, 404, 'and writing to it is the same non-answer, not a 403');
  assert.equal(write.json.error.code, 'project_not_found');
  assert.equal(hub.db.prepare('SELECT count(*) AS n FROM project_member WHERE project_id = ?').get(atlas.id).n, 1);

  for (const missing of [undefined, '', '   ']) {
    const res = await call('GET', `/v1/projects/members?projectId=${encodeURIComponent(missing ?? '')}`, {
      token: owner.token,
    });
    assert.equal(res.status, 400, String(missing));
    assert.equal(res.json.error.code, 'invalid_project');
  }
  assert.equal((await rosterOf(call, null, bench.id)).status, 401);
});

test('only an owner or a maintainer of that project may add people to it', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const timur = await joinAs(call, owner.token, 'maintainer', 'timur@example.com');
  const marina = await joinAs(call, owner.token, 'member', 'marina@example.com');
  const petya = await joinAs(call, owner.token, 'observer', 'petya@example.com');
  const dima = await joinAs(call, owner.token, 'member', 'dima@example.com');

  const atlas = await makeProject(call, owner.token, 'Atlas');

  /**
   * @param {string} token
   * @param {string} memberId
   * @param {string} role
   */
  const add = (token, memberId, role) =>
    call('POST', '/v1/projects/members', { token, body: { projectId: atlas.id, memberId, role } });

  const asMaintainer = await add(owner.token, timur.member.id, 'maintainer');
  assert.equal(asMaintainer.status, 201);
  assert.equal(asMaintainer.json.alreadyMember, false);
  assert.equal(asMaintainer.json.member.projectRole, 'maintainer');
  assert.equal(asMaintainer.json.project.memberCount, 2);

  assert.equal((await add(owner.token, marina.member.id, 'member')).status, 201);
  assert.equal((await add(owner.token, petya.member.id, 'observer')).status, 201);

  // A project maintainer may bring somebody in; a project member and an observer may not.
  const byMaintainer = await add(timur.token, dima.member.id, 'member');
  assert.equal(byMaintainer.status, 201, 'a maintainer of the project may add people');

  for (const [label, actor] of [['member', marina], ['observer', petya]]) {
    const res = await add(actor.token, dima.member.id, 'maintainer');
    assert.equal(res.status, 403, label);
    assert.equal(res.json.error.code, 'forbidden');
  }

  // Standing on the hub is not standing in a project: this hub maintainer was never added.
  const stranger = await joinAs(call, owner.token, 'maintainer', 'sveta@example.com');
  const outside = await add(stranger.token, dima.member.id, 'member');
  assert.equal(outside.status, 404, 'a hub maintainer outside the project sees no project at all');
  assert.equal(outside.json.error.code, 'project_not_found');

  const unknownPerson = await add(owner.token, crypto.randomUUID(), 'member');
  assert.equal(unknownPerson.status, 404);
  assert.equal(unknownPerson.json.error.code, 'member_not_found');

  for (const role of ['boss', '', 42, undefined]) {
    const res = await call('POST', '/v1/projects/members', {
      token: owner.token,
      body: { projectId: atlas.id, memberId: dima.member.id, role },
    });
    assert.equal(res.status, 400, String(role));
    assert.equal(res.json.error.code, 'invalid_role');
  }
  const noBody = await call('POST', '/v1/projects/members', { token: owner.token, body: { projectId: atlas.id } });
  assert.equal(noBody.status, 400);
  assert.equal(noBody.json.error.code, 'invalid_role', 'the role is judged before the person');

  assert.equal((await rosterOf(call, owner.token, atlas.id)).json.members.length, 5);
});

test('only a project owner hands out the owner role', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const timur = await joinAs(call, owner.token, 'maintainer', 'timur@example.com');
  const dima = await joinAs(call, owner.token, 'member', 'dima@example.com');

  const atlas = await makeProject(call, owner.token, 'Atlas');
  await call('POST', '/v1/projects/members', {
    token: owner.token,
    body: { projectId: atlas.id, memberId: timur.member.id, role: 'maintainer' },
  });

  // A maintainer cannot promote themselves — their own row is in the way — and must not be
  // able to route around that by minting an owner who is not them.
  const byMaintainer = await call('POST', '/v1/projects/members', {
    token: timur.token,
    body: { projectId: atlas.id, memberId: dima.member.id, role: 'owner' },
  });
  assert.equal(byMaintainer.status, 403);
  assert.equal(byMaintainer.json.error.code, 'forbidden');

  const selfPromotion = await call('POST', '/v1/projects/members', {
    token: timur.token,
    body: { projectId: atlas.id, memberId: timur.member.id, role: 'owner' },
  });
  assert.equal(selfPromotion.status, 403);

  const byOwner = await call('POST', '/v1/projects/members', {
    token: owner.token,
    body: { projectId: atlas.id, memberId: dima.member.id, role: 'owner' },
  });
  assert.equal(byOwner.status, 201, 'the project owner may share ownership');
  assert.equal(byOwner.json.member.projectRole, 'owner');

  const roles = hub.db
    .prepare('SELECT role FROM project_member WHERE project_id = ? ORDER BY joined_at')
    .all(atlas.id)
    .map((r) => r.role);
  assert.deepEqual(roles, ['owner', 'maintainer', 'owner']);
});

test('adding the same person again changes nothing; a different role is refused outright', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const marina = await joinAs(call, owner.token, 'member', 'marina@example.com');
  const atlas = await makeProject(call, owner.token, 'Atlas');

  /** @param {string} role */
  const add = (role) =>
    call('POST', '/v1/projects/members', {
      token: owner.token,
      body: { projectId: atlas.id, memberId: marina.member.id, role },
    });

  const first = await add('member');
  assert.equal(first.status, 201);
  assert.equal(first.json.alreadyMember, false);

  // The identical call again: a client that lost the response can simply repeat itself.
  const again = await add('member');
  assert.equal(again.status, 200);
  assert.equal(again.json.alreadyMember, true);
  assert.equal(again.json.member.joinedAt, first.json.member.joinedAt, 'and the timestamp does not move');
  assert.equal(again.json.project.memberCount, 2, 'nor does the roster grow');

  // A different role is a different request. Answering it with a cheerful 200 would tell
  // the caller their change went through when nothing happened.
  const conflict = await add('maintainer');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error.code, 'role_conflict');
  assert.ok(!/sql|constraint|project_member/i.test(conflict.json.error.message));

  const roster = await rosterOf(call, owner.token, atlas.id);
  assert.equal(roster.json.members.length, 2);
  assert.equal(roster.json.members.find((m) => m.id === marina.member.id).projectRole, 'member');
  assert.equal(
    hub.db.prepare('SELECT count(*) AS n FROM project_member WHERE project_id = ?').get(atlas.id).n,
    2,
  );

  // And the pair is unique in the database, not merely in the handler.
  assert.throws(() =>
    hub.db
      .prepare('INSERT INTO project_member(project_id, member_id, role, joined_at) VALUES(?,?,?,?)')
      .run(atlas.id, marina.member.id, 'observer', Date.now()),
  );
  assert.throws(
    () =>
      hub.db
        .prepare('INSERT INTO project_member(project_id, member_id, role, joined_at) VALUES(?,?,?,?)')
        .run(atlas.id, owner.member.id, 'boss', Date.now()),
    'the role CHECK is in the schema too',
  );
});

test('the project roster hides other people addresses from a plain member', async (t) => {
  const { hub, call } = await bootHub();
  t.after(() => hub.close());

  const owner = await bootOwner(call);
  const timur = await joinAs(call, owner.token, 'maintainer', 'timur@example.com');
  const marina = await joinAs(call, owner.token, 'member', 'marina@example.com');
  const petya = await joinAs(call, owner.token, 'observer', 'petya@example.com');

  const atlas = await makeProject(call, owner.token, 'Atlas');
  for (const [person, role] of [[timur, 'maintainer'], [marina, 'member'], [petya, 'observer']]) {
    const res = await call('POST', '/v1/projects/members', {
      token: owner.token,
      body: { projectId: atlas.id, memberId: person.member.id, role },
    });
    assert.equal(res.status, 201);
  }

  for (const [label, actor] of [['owner', owner], ['maintainer', timur]]) {
    const res = await rosterOf(call, actor.token, atlas.id);
    assert.equal(res.status, 200, label);
    assert.ok(res.json.members.every((m) => typeof m.email === 'string'), `${label} sees every address`);
  }

  // The rule is the hub role, not the project role: otherwise anyone could create a project,
  // add the team to it and read the addresses `GET /v1/members` refuses to show them.
  for (const [label, actor] of [['member', marina], ['observer', petya]]) {
    const res = await rosterOf(call, actor.token, atlas.id);
    assert.equal(res.status, 200, label);
    assert.equal(res.json.members.find((m) => m.id === actor.member.id).email, actor.member.email);
    assert.ok(
      res.json.members.filter((m) => m.id !== actor.member.id).every((m) => m.email === null),
      `${label} must not be able to export the team's addresses through a project`,
    );
    assert.ok(!res.text.includes('ann@example.com'), 'and the redaction survives serialisation');
    assert.ok(!/password|scrypt/i.test(res.text));
    assert.deepEqual(Object.keys(res.json.members[0]).sort(), [
      'colorSlug',
      'createdAt',
      'displayName',
      'email',
      'handle',
      'id',
      'joinedAt',
      'projectRole',
      'role',
    ]);
  }

  // Their own project, made by themselves, is no different — the roster is not a loophole.
  const own = await makeProject(call, marina.token, 'Bench');
  const bench = await call('POST', '/v1/projects/members', {
    token: marina.token,
    body: { projectId: own.id, memberId: owner.member.id, role: 'member' },
  });
  assert.equal(bench.status, 201, 'anyone may run their own project');
  assert.equal(bench.json.member.email, null, 'and still does not get to read an address');
});
