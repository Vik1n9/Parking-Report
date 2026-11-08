import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestDb } from './helpers/d1.js';
import { SESSION_COOKIE, createSession, hashPassword } from '../src/auth.js';

const ORIGIN = 'https://example.test';

function envWith(db, overrides = {}) {
  return {
    DB: db,
    ASSETS: {
      fetch: async () =>
        new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    },
    ...overrides,
  };
}

function request(method, path, { body, cookie, origin = ORIGIN } = {}) {
  const headers = new Headers();
  if (origin) headers.set('Origin', origin);
  if (cookie) headers.set('Cookie', cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function addUser(db, options = {}) {
  const username = options.username ?? 'alice';
  const password = options.password ?? 'password-123';
  const hash = await hashPassword(password);
  await db
    .prepare(
      `INSERT INTO users (username, display_name, role, post_code, password_hash, status, must_change_pw, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      username,
      options.displayName ?? username,
      options.role ?? 'patrol',
      options.postCode ?? null,
      hash,
      options.status ?? 'active',
      options.mustChangePw ?? 0,
      '2026-11-09T00:00:00.000Z'
    )
    .run();
  return { username, password };
}

async function login(db, username, password, overrides = {}) {
  const res = await worker.fetch(
    request('POST', '/api/login', { body: { username, password } }),
    envWith(db, overrides)
  );
  const setCookie = res.headers.get('set-cookie');
  return { res, cookie: setCookie ? setCookie.split(';')[0] : null };
}

async function cookieFor(db, username) {
  return `${SESSION_COOKIE}=${await createSession(db, username)}`;
}

test('login returns me, sets a Secure cookie and records last_login_at', async () => {
  const db = createTestDb();
  await addUser(db, { username: 'admin', role: 'admin', displayName: 'Admin', mustChangePw: 1 });

  const { res, cookie } = await login(db, 'admin', 'password-123');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.me, {
    username: 'admin',
    displayName: 'Admin',
    role: 'admin',
    postCode: null,
    mustChangePw: true,
    home: '/admin',
  });
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /; Secure$/);
  assert.ok(cookie);

  const row = await db.prepare('SELECT last_login_at FROM users WHERE username = ?').bind('admin').first();
  assert.ok(row.last_login_at);
  db.close();
});

test('DEV_MODE=1 only drops the Secure cookie flag', async () => {
  const db = createTestDb();
  await addUser(db);
  const { res } = await login(db, 'alice', 'password-123', { DEV_MODE: '1' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('set-cookie').endsWith('; Secure'), false);
  db.close();
});

test('wrong password and unknown user are indistinguishable; disabled is 403', async () => {
  const db = createTestDb();
  await addUser(db, { username: 'alice' });
  await addUser(db, { username: 'bob', status: 'disabled' });

  const wrong = await worker.fetch(
    request('POST', '/api/login', { body: { username: 'alice', password: 'nope' } }),
    envWith(db)
  );
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, '帳號或密碼錯誤');

  const unknown = await worker.fetch(
    request('POST', '/api/login', { body: { username: 'ghost', password: 'nope' } }),
    envWith(db)
  );
  assert.equal(unknown.status, 401);
  assert.equal((await unknown.json()).error, '帳號或密碼錯誤');

  const disabled = await worker.fetch(
    request('POST', '/api/login', { body: { username: 'bob', password: 'password-123' } }),
    envWith(db)
  );
  assert.equal(disabled.status, 403);
  assert.equal((await disabled.json()).error, '帳號已停用');
  db.close();
});

test('login is rate limited after five failures', async () => {
  const db = createTestDb();
  await addUser(db, { username: 'alice' });
  for (let i = 0; i < 5; i += 1) {
    const res = await worker.fetch(
      request('POST', '/api/login', { body: { username: 'alice', password: 'wrong' } }),
      envWith(db)
    );
    assert.equal(res.status, 401);
  }
  const locked = await worker.fetch(
    request('POST', '/api/login', { body: { username: 'alice', password: 'password-123' } }),
    envWith(db)
  );
  assert.equal(locked.status, 429);
  assert.match((await locked.json()).error, /失敗次數過多/);
  db.close();
});

test('login rejects a missing or wrong Origin', async () => {
  const db = createTestDb();
  await addUser(db);
  for (const origin of [null, 'https://evil.test']) {
    const res = await worker.fetch(
      request('POST', '/api/login', { body: { username: 'alice', password: 'password-123' }, origin }),
      envWith(db)
    );
    assert.equal(res.status, 403);
  }
  db.close();
});

test('me requires a session; logout destroys it and clears the cookie', async () => {
  const db = createTestDb();
  await addUser(db, { username: 'alice', displayName: 'Alice', role: 'patrol', postCode: 'P9' });

  const anonymous = await worker.fetch(request('GET', '/api/me'), envWith(db));
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, '需要登入');

  const { cookie } = await login(db, 'alice', 'password-123');
  const me = await worker.fetch(request('GET', '/api/me', { cookie }), envWith(db));
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(body.me.postCode, 'P9');
  assert.equal(body.me.home, '/guard');

  const out = await worker.fetch(request('POST', '/api/logout', { cookie }), envWith(db));
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await worker.fetch(request('GET', '/api/me', { cookie }), envWith(db))).status, 401);
  db.close();
});

test('change-password validates, clears must_change_pw and destroys other sessions', async () => {
  const db = createTestDb();
  await addUser(db, { username: 'alice', mustChangePw: 1 });
  const { cookie } = await login(db, 'alice', 'password-123');
  const other = await cookieFor(db, 'alice');

  const wrong = await worker.fetch(
    request('POST', '/api/change-password', {
      cookie,
      body: { currentPassword: 'nope', newPassword: 'new-password-1' },
    }),
    envWith(db)
  );
  assert.equal(wrong.status, 403);

  const short = await worker.fetch(
    request('POST', '/api/change-password', {
      cookie,
      body: { currentPassword: 'password-123', newPassword: 'short' },
    }),
    envWith(db)
  );
  assert.equal(short.status, 400);

  const same = await worker.fetch(
    request('POST', '/api/change-password', {
      cookie,
      body: { currentPassword: 'password-123', newPassword: 'password-123' },
    }),
    envWith(db)
  );
  assert.equal(same.status, 400);

  const ok = await worker.fetch(
    request('POST', '/api/change-password', {
      cookie,
      body: { currentPassword: 'password-123', newPassword: 'new-password-1' },
    }),
    envWith(db)
  );
  assert.equal(ok.status, 200);

  const row = await db.prepare('SELECT must_change_pw FROM users WHERE username = ?').bind('alice').first();
  assert.equal(row.must_change_pw, 0);
  assert.equal((await worker.fetch(request('GET', '/api/me', { cookie: other }), envWith(db))).status, 401);
  assert.equal((await worker.fetch(request('GET', '/api/me', { cookie }), envWith(db))).status, 200);
  db.close();
});

test('admin can create users with a generated one-time password', async () => {
  const db = createTestDb();
  await addUser(db, { username: 'admin', role: 'admin' });
  const admin = await cookieFor(db, 'admin');

  const res = await worker.fetch(
    request('POST', '/api/admin/users', {
      cookie: admin,
      body: { username: 'newbie', displayName: 'New Bie', role: 'patrol', postCode: 'P1' },
    }),
    envWith(db)
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.user.username, 'newbie');
  assert.equal(body.user.role, 'patrol');
  assert.equal(body.user.postCode, 'P1');
  assert.equal(body.user.status, 'active');
  assert.equal(body.user.mustChangePw, true);
  assert.match(body.password, /^[23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ]{14}$/);

  const dup = await worker.fetch(
    request('POST', '/api/admin/users', {
      cookie: admin,
      body: { username: 'newbie', displayName: 'Again', role: 'patrol' },
    }),
    envWith(db)
  );
  assert.equal(dup.status, 409);
  db.close();
});

test('user creation validates input and is admin-only', async () => {
  const db = createTestDb();
  await addUser(db, { username: 'admin', role: 'admin' });
  await addUser(db, { username: 'console', role: 'console' });
  const admin = await cookieFor(db, 'admin');
  const consoleUser = await cookieFor(db, 'console');

  for (const body of [
    { username: 'x', displayName: 'X', role: 'patrol' },
    { username: 'okname', displayName: '', role: 'patrol' },
    { username: 'okname', displayName: 'OK', role: 'owner' },
  ]) {
    const res = await worker.fetch(
      request('POST', '/api/admin/users', { cookie: admin, body }),
      envWith(db)
    );
    assert.equal(res.status, 400, JSON.stringify(body));
  }

  const forbidden = await worker.fetch(
    request('POST', '/api/admin/users', {
      cookie: consoleUser,
      body: { username: 'okname', displayName: 'OK', role: 'patrol' },
    }),
    envWith(db)
  );
  assert.equal(forbidden.status, 403);
  db.close();
});

test('reset-password returns a new password, forces change and kills sessions', async () => {
  const db = createTestDb();
  await addUser(db, { username: 'admin', role: 'admin' });
  await addUser(db, { username: 'patrol', mustChangePw: 0 });
  const admin = await cookieFor(db, 'admin');
  const target = await cookieFor(db, 'patrol');

  const res = await worker.fetch(
    request('POST', '/api/admin/users/patrol/reset-password', { cookie: admin }),
    envWith(db)
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.password, /^[23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ]{14}$/);

  const row = await db.prepare('SELECT must_change_pw FROM users WHERE username = ?').bind('patrol').first();
  assert.equal(row.must_change_pw, 1);
  assert.equal((await worker.fetch(request('GET', '/api/me', { cookie: target }), envWith(db))).status, 401);

  const missing = await worker.fetch(
    request('POST', '/api/admin/users/nobody/reset-password', { cookie: admin }),
    envWith(db)
  );
  assert.equal(missing.status, 404);
  db.close();
});

test('disabling a user kills sessions, cannot target self and can be reversed', async () => {
  const db = createTestDb();
  await addUser(db, { username: 'admin', role: 'admin' });
  await addUser(db, { username: 'patrol', role: 'patrol' });
  const admin = await cookieFor(db, 'admin');
  const target = await cookieFor(db, 'patrol');

  const self = await worker.fetch(
    request('POST', '/api/admin/users/admin/status', { cookie: admin, body: { status: 'disabled' } }),
    envWith(db)
  );
  assert.equal(self.status, 400);

  const off = await worker.fetch(
    request('POST', '/api/admin/users/patrol/status', { cookie: admin, body: { status: 'disabled' } }),
    envWith(db)
  );
  assert.equal(off.status, 200);
  assert.equal((await worker.fetch(request('GET', '/api/me', { cookie: target }), envWith(db))).status, 401);

  const denied = await worker.fetch(
    request('POST', '/api/login', { body: { username: 'patrol', password: 'password-123' } }),
    envWith(db)
  );
  assert.equal(denied.status, 403);

  await worker.fetch(
    request('POST', '/api/admin/users/patrol/status', { cookie: admin, body: { status: 'active' } }),
    envWith(db)
  );
  const back = await worker.fetch(
    request('POST', '/api/login', { body: { username: 'patrol', password: 'password-123' } }),
    envWith(db)
  );
  assert.equal(back.status, 200);
  db.close();
});

test('PATCH updates displayName and postCode but never the role', async () => {
  const db = createTestDb();
  await addUser(db, { username: 'admin', role: 'admin' });
  await addUser(db, { username: 'captain', role: 'captain', postCode: 'T1', displayName: 'Old' });
  const admin = await cookieFor(db, 'admin');

  const res = await worker.fetch(
    request('PATCH', '/api/admin/users/captain', {
      cookie: admin,
      body: { displayName: 'New Name', postCode: 'T2', role: 'admin' },
    }),
    envWith(db)
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.displayName, 'New Name');
  assert.equal(body.user.postCode, 'T2');
  assert.equal(body.user.role, 'captain');

  const clear = await worker.fetch(
    request('PATCH', '/api/admin/users/captain', { cookie: admin, body: { postCode: null } }),
    envWith(db)
  );
  assert.equal((await clear.json()).user.postCode, null);
  db.close();
});

test('the user list exposes no password hashes', async () => {
  const db = createTestDb();
  await addUser(db, { username: 'admin', role: 'admin' });
  await addUser(db, { username: 'captain', role: 'captain', postCode: 'T1' });
  const admin = await cookieFor(db, 'admin');

  const res = await worker.fetch(request('GET', '/api/admin/users', { cookie: admin }), envWith(db));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.users.length, 2);
  const captain = body.users.find((u) => u.username === 'captain');
  assert.equal(captain.postCode, 'T1');
  assert.equal(captain.role, 'captain');
  assert.equal(captain.mustChangePw, false);
  assert.equal(captain.lastLoginAt, null);
  assert.ok(captain.createdAt);
  assert.equal(JSON.stringify(body).includes('pbkdf2'), false);
  db.close();
});
