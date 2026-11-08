import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.js';
import {
  IP_MAX_FAILS,
  ROLES,
  ROLE_HOME,
  SESSION_COOKIE,
  canAccess,
  createSession,
  destroyAllSessions,
  destroyOtherSessions,
  destroySession,
  getSessionUser,
  hashPassword,
  ipLockKey,
  ipRateKey,
  loginLockSeconds,
  parseCookies,
  recordIpLoginFailure,
  recordLoginFailure,
  requireOrigin,
  resetLoginFailures,
  sessionCookie,
  verifyPassword,
} from '../src/auth.js';

async function addUser(db, overrides = {}) {
  const username = overrides.username ?? 'alice';
  const password = overrides.password ?? 'correct-horse';
  const hash = await hashPassword(password);
  await db
    .prepare(
      `INSERT INTO users (username, display_name, role, post_code, password_hash, status, must_change_pw, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      username,
      overrides.displayName ?? 'Alice',
      overrides.role ?? 'patrol',
      overrides.postCode ?? 'P9',
      hash,
      overrides.status ?? 'active',
      overrides.mustChangePw ?? 0,
      '2026-11-09T00:00:00.000Z'
    )
    .run();
  return { username, password };
}

function withCookie(token, url = 'https://example.test/api/me') {
  return new Request(url, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
}

test('password hash roundtrip, wrong password and malformed stored value', async () => {
  const hash = await hashPassword('secret123');
  assert.match(hash, /^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(await verifyPassword('secret123', hash), true);
  assert.equal(await verifyPassword('secret124', hash), false);
  assert.equal(await verifyPassword('secret123', 'junk'), false);
  assert.equal(await verifyPassword('secret123', 'pbkdf2$1000$aa$bb'), false);
});

test('unknown user still runs a hash and never verifies', async () => {
  assert.equal(await verifyPassword('whatever', null), false);
  assert.equal(await verifyPassword('whatever', ''), false);
});

test('session create, read and destroy', async () => {
  const db = createTestDb();
  await addUser(db, { username: 'alice', displayName: 'Alice', role: 'captain', postCode: 'T1' });
  const token = await createSession(db, 'alice');

  const session = await getSessionUser(db, withCookie(token));
  assert.deepEqual(session.user, {
    username: 'alice',
    displayName: 'Alice',
    role: 'captain',
    postCode: 'T1',
    mustChangePw: false,
  });
  assert.equal(session.tokenHash.length, 64);

  await destroySession(db, session.tokenHash);
  assert.equal(await getSessionUser(db, withCookie(token)), null);
  db.close();
});

test('expired sessions are rejected', async () => {
  const db = createTestDb();
  await addUser(db);
  const token = await createSession(db, 'alice');
  await db
    .prepare('UPDATE sessions SET expires_at = ? WHERE username = ?')
    .bind(new Date(Date.now() - 1000).toISOString(), 'alice')
    .run();
  assert.equal(await getSessionUser(db, withCookie(token)), null);
  db.close();
});

test('disabled users are rejected even with a valid session', async () => {
  const db = createTestDb();
  await addUser(db);
  const token = await createSession(db, 'alice');
  await db.prepare("UPDATE users SET status = 'disabled' WHERE username = 'alice'").run();
  assert.equal(await getSessionUser(db, withCookie(token)), null);
  db.close();
});

test('destroy other sessions keeps the current one and destroy all clears them', async () => {
  const db = createTestDb();
  await addUser(db);
  const first = await createSession(db, 'alice');
  const second = await createSession(db, 'alice');
  const current = await getSessionUser(db, withCookie(second));

  await destroyOtherSessions(db, 'alice', current.tokenHash);
  assert.equal(await getSessionUser(db, withCookie(first)), null);
  assert.ok(await getSessionUser(db, withCookie(second)));

  await destroyAllSessions(db, 'alice');
  assert.equal(await getSessionUser(db, withCookie(second)), null);
  db.close();
});

test('cookie parsing handles quoting, junk and encoded values', () => {
  const cookies = parseCookies('theme=dark;  quoted="a b" ; broken ; empty=; encoded=%E4%B8%AD');
  assert.equal(cookies.get('theme'), 'dark');
  assert.equal(cookies.get('quoted'), 'a b');
  assert.equal(cookies.get('broken'), undefined);
  assert.equal(cookies.get('empty'), '');
  assert.equal(cookies.get('encoded'), '中');
  assert.equal(parseCookies(null).size, 0);
});

test('session cookie sets the expected flags and clears with Max-Age=0', () => {
  const secure = sessionCookie('abc', true);
  assert.match(secure, /^parking_session=abc; HttpOnly; SameSite=Lax; Path=\/; Max-Age=\d+; Secure$/);
  const local = sessionCookie('abc', false);
  assert.equal(local.endsWith('; Secure'), false);
  const cleared = sessionCookie(null, false);
  assert.match(cleared, /^parking_session=; HttpOnly; SameSite=Lax; Path=\/; Max-Age=0$/);
});

test('five failures lock the account+IP key for 15 minutes and reset after expiry', async () => {
  const db = createTestDb();
  const key = 'alice|203.0.113.5';
  for (let i = 0; i < 5; i += 1) {
    assert.equal(await loginLockSeconds(db, key), 0);
    await recordLoginFailure(db, key);
  }
  const locked = await loginLockSeconds(db, key);
  assert.ok(locked > 14 * 60 && locked <= 15 * 60);
  const row = await db.prepare('SELECT fails, locked_until FROM login_attempts WHERE key = ?').bind(key).first();
  assert.equal(row.fails, 5);
  assert.ok(row.locked_until);

  await db
    .prepare('UPDATE login_attempts SET locked_until = ? WHERE key = ?')
    .bind(new Date(Date.now() - 1000).toISOString(), key)
    .run();
  assert.equal(await loginLockSeconds(db, key), 0);

  await recordLoginFailure(db, key);
  const after = await db.prepare('SELECT fails, locked_until FROM login_attempts WHERE key = ?').bind(key).first();
  assert.equal(after.fails, 1);
  assert.equal(after.locked_until, null);

  await resetLoginFailures(db, key);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM login_attempts').first().then((r) => r.n), 0);
  db.close();
});

test('the IP layer locks after 20 failures regardless of account', async () => {
  const db = createTestDb();
  const ip = '198.51.100.7';
  for (let i = 0; i < IP_MAX_FAILS - 1; i += 1) await recordIpLoginFailure(db, ip);
  assert.equal(await loginLockSeconds(db, ipLockKey(ip)), 0);
  await recordIpLoginFailure(db, ip);
  assert.ok((await loginLockSeconds(db, ipLockKey(ip))) > 0);

  const row = await db.prepare('SELECT fails FROM login_attempts WHERE key = ?').bind(`#ip|${ip}`).first();
  assert.equal(row.fails, IP_MAX_FAILS);
  db.close();
});

test('IP rate keys keep IPv4 whole and collapse IPv6 to /64', () => {
  assert.equal(ipRateKey('203.0.113.9'), '203.0.113.9');
  assert.equal(ipRateKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipRateKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(ipRateKey('2001:0db8:0001:0002:1111:2222:3333:4444'), '2001:db8:1:2::/64');
  assert.equal(ipRateKey('::1'), '::/64');
  assert.equal(ipRateKey('fe80::1%en0'), 'fe80::/64');
  assert.equal(ipLockKey('2001:db8:1:2::1'), '#ip|2001:db8:1:2::/64');
});

test('Origin check only applies to mutating methods', () => {
  const get = new Request('https://example.test/api/zones');
  assert.equal(requireOrigin(get), true);

  const good = new Request('https://example.test/api/login', {
    method: 'POST',
    headers: { Origin: 'https://example.test' },
  });
  assert.equal(requireOrigin(good), true);

  const missing = new Request('https://example.test/api/login', { method: 'POST' });
  assert.equal(requireOrigin(missing), false);

  const wrong = new Request('https://example.test/api/login', {
    method: 'POST',
    headers: { Origin: 'https://evil.test' },
  });
  assert.equal(requireOrigin(wrong), false);

  const patch = new Request('https://example.test/api/admin/users/x', {
    method: 'PATCH',
    headers: { Origin: 'https://example.test' },
  });
  assert.equal(requireOrigin(patch), true);
});

test('role helpers cover all six roles', () => {
  assert.deepEqual(ROLES, ['admin', 'console', 'secretary', 'captain', 'patrol', 'manager']);
  assert.equal(ROLE_HOME.admin, '/admin');
  assert.equal(ROLE_HOME.console, '/CenterConsole');
  assert.equal(ROLE_HOME.secretary, '/secretary');
  assert.equal(ROLE_HOME.captain, '/guard');
  assert.equal(ROLE_HOME.patrol, '/guard');
  assert.equal(ROLE_HOME.manager, '/ManagerDashboard');
  assert.equal(canAccess('captain', ['captain', 'admin']), true);
  assert.equal(canAccess('patrol', ['captain', 'admin']), false);
  assert.equal(canAccess(undefined, ['admin']), false);
});
