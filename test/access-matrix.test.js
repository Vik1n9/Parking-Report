import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestDb } from './helpers/d1.js';
import { ROLE_HOME, ROLES, SESSION_COOKIE, createSession, hashPassword } from '../src/auth.js';

const ORIGIN = 'https://example.test';
const ROLE_LIST = [...ROLES];
let seq = 0;

function envWith(db) {
  return {
    DB: db,
    ASSETS: {
      fetch: async () =>
        new Response('<html>page</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    },
  };
}

function request(method, path, { body, cookie } = {}) {
  const headers = new Headers({ Origin: ORIGIN });
  if (cookie) headers.set('Cookie', cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function addUser(db, username, role, options = {}) {
  const hash = await hashPassword(options.password ?? 'password-123');
  await db
    .prepare(
      `INSERT INTO users (username, display_name, role, post_code, password_hash, status, must_change_pw, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '2026-11-09T00:00:00.000Z')`
    )
    .bind(username, `User ${username}`, role, options.postCode ?? null, hash, options.status ?? 'active', options.mustChangePw ?? 0)
    .run();
}

async function seedTargetUser(db) {
  seq += 1;
  const username = `target${seq}`;
  await db
    .prepare(
      `INSERT INTO users (username, display_name, role, post_code, password_hash, status, must_change_pw, created_at)
       VALUES (?, 'Target', 'patrol', NULL, 'not-used', 'active', 0, '2026-11-09T00:00:00.000Z')`
    )
    .bind(username)
    .run();
  return username;
}

async function seedPendingReport(db) {
  seq += 1;
  const result = await db
    .prepare(
      `INSERT INTO reports (site_id, submitted_by, status, client_request_id, values_json, business_date, submitted_at)
       VALUES (1, 'captain', 'pending', ?, '{}', '2026-11-09', '2026-11-09T00:00:00.000Z')`
    )
    .bind(`req-seed-${seq}`)
    .run();
  return result.meta.last_row_id;
}

async function seedAwaitingReport(db) {
  seq += 1;
  const result = await db
    .prepare(
      `INSERT INTO reports (site_id, submitted_by, status, client_request_id, values_json, business_date, submitted_at)
       VALUES (1, 'patrol', 'awaiting_captain', ?, '{}', '2026-11-09', '2026-11-09T00:00:00.000Z')`
    )
    .bind(`req-awaiting-${seq}`)
    .run();
  return result.meta.last_row_id;
}

function newReportBody(role) {
  seq += 1;
  return {
    client_request_id: `req-${role}-${seq}`,
    values: { floor_above: { kind: 'spaces', value: 100 } },
  };
}

const CASES = [
  { name: 'me', method: 'GET', path: '/api/me', allowed: ROLE_LIST, status: 200 },
  { name: 'zones', method: 'GET', path: '/api/zones', allowed: ROLE_LIST, status: 200 },
  {
    name: 'change-password',
    method: 'POST',
    path: '/api/change-password',
    allowed: ROLE_LIST,
    status: 200,
    body: (role) => ({ currentPassword: 'password-123', newPassword: `new-password-${role}` }),
  },
  {
    name: 'submit report',
    method: 'POST',
    path: '/api/reports',
    allowed: ['captain', 'patrol'],
    status: 201,
    body: newReportBody,
  },
  {
    name: 'list pending reports',
    method: 'GET',
    path: '/api/reports?status=pending',
    allowed: ['console', 'admin'],
    status: 200,
  },
  {
    name: 'list confirmed reports',
    method: 'GET',
    path: '/api/reports?status=confirmed',
    allowed: ['console', 'admin'],
    status: 200,
  },
  {
    name: 'list rejected reports',
    method: 'GET',
    path: '/api/reports?status=rejected',
    allowed: ['console', 'admin'],
    status: 200,
  },
  {
    name: 'list awaiting_captain reports',
    method: 'GET',
    path: '/api/reports?status=awaiting_captain',
    allowed: ['captain', 'admin'],
    status: 200,
  },
  {
    name: 'review report',
    method: 'POST',
    allowed: ['captain', 'admin'],
    status: 200,
    body: () => ({}),
    path: async (db) => `/api/reports/${await seedAwaitingReport(db)}/review`,
  },
  {
    name: 'review-reject report',
    method: 'POST',
    allowed: ['captain', 'admin'],
    status: 200,
    body: () => ({ reason: '退回' }),
    path: async (db) => `/api/reports/${await seedAwaitingReport(db)}/review-reject`,
  },
  {
    name: 'confirm report',
    method: 'POST',
    allowed: ['console', 'admin'],
    status: 201,
    path: async (db) => `/api/reports/${await seedPendingReport(db)}/confirm`,
  },
  {
    name: 'reject report',
    method: 'POST',
    allowed: ['console', 'admin'],
    status: 200,
    path: async (db) => `/api/reports/${await seedPendingReport(db)}/reject`,
  },
  {
    name: 'records',
    method: 'GET',
    path: '/api/records',
    allowed: ['console', 'secretary', 'admin'],
    status: 200,
  },
  {
    name: 'records export',
    method: 'GET',
    path: '/api/records/export',
    allowed: ['console', 'secretary', 'admin'],
    status: 200,
  },
  {
    name: 'dashboard',
    method: 'GET',
    path: '/api/dashboard/current',
    allowed: ['manager', 'console', 'secretary', 'admin'],
    status: 200,
  },
  {
    name: 'admin list users',
    method: 'GET',
    path: '/api/admin/users',
    allowed: ['admin'],
    status: 200,
  },
  {
    name: 'admin create user',
    method: 'POST',
    path: '/api/admin/users',
    allowed: ['admin'],
    status: 201,
    body: () => {
      seq += 1;
      return { username: `made${seq}`, displayName: 'Made', role: 'patrol' };
    },
  },
  {
    name: 'admin reset password',
    method: 'POST',
    allowed: ['admin'],
    status: 200,
    path: async (db) => `/api/admin/users/${await seedTargetUser(db)}/reset-password`,
  },
  {
    name: 'admin disable user',
    method: 'POST',
    allowed: ['admin'],
    status: 200,
    body: () => ({ status: 'disabled' }),
    path: async (db) => `/api/admin/users/${await seedTargetUser(db)}/status`,
  },
  {
    name: 'admin patch user',
    method: 'PATCH',
    allowed: ['admin'],
    status: 200,
    body: () => ({ displayName: 'Renamed' }),
    path: async (db) => `/api/admin/users/${await seedTargetUser(db)}`,
  },
];

async function setupMatrix() {
  const db = createTestDb();
  const cookies = {};
  const hash = await hashPassword('password-123');
  for (const role of ROLE_LIST) {
    await db
      .prepare(
        `INSERT INTO users (username, display_name, role, post_code, password_hash, status, must_change_pw, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', 0, '2026-11-09T00:00:00.000Z')`
      )
      .bind(role, `User ${role}`, role, role === 'captain' ? 'T1' : role === 'patrol' ? 'P9' : null, hash)
      .run();
    cookies[role] = `${SESSION_COOKIE}=${await createSession(db, role)}`;
  }
  return { db, env: envWith(db), cookies };
}

test('API permission matrix matches the plan for every role', async () => {
  const { db, env, cookies } = await setupMatrix();

  for (const entry of CASES) {
    for (const role of ROLE_LIST) {
      const path = typeof entry.path === 'function' ? await entry.path(db) : entry.path;
      const body = typeof entry.body === 'function' ? entry.body(role) : entry.body;
      const res = await worker.fetch(request(entry.method, path, { cookie: cookies[role], body }), env);
      if (entry.allowed.includes(role)) {
        assert.equal(res.status, entry.status, `${entry.name} / ${role} should pass`);
      } else {
        assert.equal(res.status, 403, `${entry.name} / ${role} should be 403`);
        assert.equal((await res.json()).error, '沒有權限');
      }
    }
  }
  db.close();
});

test('the review endpoints reject a missing Origin', async () => {
  const { db, env, cookies } = await setupMatrix();
  for (const suffix of ['review', 'review-reject']) {
    const id = await seedAwaitingReport(db);
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/reports/${id}/${suffix}`, {
        method: 'POST',
        headers: { Cookie: cookies.captain, 'content-type': 'application/json' },
        body: '{}',
      }),
      env
    );
    assert.equal(res.status, 403, `${suffix} without Origin`);
  }
  db.close();
});

test('protected endpoints return 401 without a session', async () => {
  const { db, env } = await setupMatrix();
  for (const entry of CASES) {
    const path = typeof entry.path === 'function' ? await entry.path(db) : entry.path;
    const body = typeof entry.body === 'function' ? entry.body('admin') : entry.body;
    const res = await worker.fetch(request(entry.method, path, { body }), env);
    assert.equal(res.status, 401, `${entry.name} without a session`);
    assert.equal((await res.json()).error, '需要登入');
  }
  db.close();
});

test('must_change_pw blocks everything except me, logout and change-password', async () => {
  const db = createTestDb();
  await addUser(db, 'changer', 'console', { mustChangePw: 1 });
  const cookie = `${SESSION_COOKIE}=${await createSession(db, 'changer')}`;
  const env = envWith(db);

  const me = await worker.fetch(request('GET', '/api/me', { cookie }), env);
  assert.equal(me.status, 200);
  assert.equal((await me.json()).me.mustChangePw, true);

  const blocked = await worker.fetch(request('GET', '/api/zones', { cookie }), env);
  assert.equal(blocked.status, 403);
  const body = await blocked.json();
  assert.equal(body.error, '請先變更密碼');
  assert.equal(body.mustChangePassword, true);

  const logout = await worker.fetch(request('POST', '/api/logout', { cookie }), env);
  assert.equal(logout.status, 200);
  db.close();

  const db2 = createTestDb();
  await addUser(db2, 'changer', 'console', { mustChangePw: 1 });
  const cookie2 = `${SESSION_COOKIE}=${await createSession(db2, 'changer')}`;
  const changed = await worker.fetch(
    request('POST', '/api/change-password', {
      cookie: cookie2,
      body: { currentPassword: 'password-123', newPassword: 'new-password-1' },
    }),
    envWith(db2)
  );
  assert.equal(changed.status, 200);
  assert.equal(
    (await worker.fetch(request('GET', '/api/zones', { cookie: cookie2 }), envWith(db2))).status,
    200
  );
  db2.close();
});

const PAGES = [
  { path: '/guard', allowed: ['captain', 'patrol', 'admin'] },
  { path: '/guard.html', allowed: ['captain', 'patrol', 'admin'] },
  { path: '/review', allowed: ['captain', 'admin'] },
  { path: '/review.html', allowed: ['captain', 'admin'] },
  { path: '/CenterConsole', allowed: ['console', 'admin'] },
  { path: '/CenterConsole.html', allowed: ['console', 'admin'] },
  { path: '/secretary', allowed: ['secretary', 'admin'] },
  { path: '/secretary.html', allowed: ['secretary', 'admin'] },
  { path: '/ManagerDashboard', allowed: ['manager', 'console', 'secretary', 'admin'] },
  { path: '/ManagerDashboard.html', allowed: ['manager', 'console', 'secretary', 'admin'] },
  { path: '/admin', allowed: ['admin'] },
  { path: '/admin.html', allowed: ['admin'] },
];

test('page gating redirects by login, password change and role', async () => {
  const { db, env, cookies } = await setupMatrix();

  for (const page of PAGES) {
    for (const role of ROLE_LIST) {
      const res = await worker.fetch(request('GET', page.path, { cookie: cookies[role] }), env);
      if (page.allowed.includes(role)) {
        assert.equal(res.status, 200, `${page.path} / ${role}`);
        assert.equal(res.headers.get('x-robots-tag'), 'noindex');
        assert.equal(res.headers.get('cache-control'), 'no-store');
      } else {
        assert.equal(res.status, 302, `${page.path} / ${role}`);
        assert.equal(res.headers.get('location'), ROLE_HOME[role]);
      }
    }

    const anonymous = await worker.fetch(request('GET', page.path), env);
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get('location'), `/login?next=${encodeURIComponent(page.path)}`);
  }

  await addUser(db, 'changer', 'console', { mustChangePw: 1 });
  const changing = `${SESSION_COOKIE}=${await createSession(db, 'changer')}`;
  const forced = await worker.fetch(request('GET', '/CenterConsole', { cookie: changing }), env);
  assert.equal(forced.status, 302);
  assert.equal(forced.headers.get('location'), '/login?change=1');
  db.close();
});

test('root redirects to the role home and public assets stay open', async () => {
  const { db, env, cookies } = await setupMatrix();
  for (const role of ROLE_LIST) {
    const res = await worker.fetch(request('GET', '/', { cookie: cookies[role] }), env);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), ROLE_HOME[role]);
  }
  const anonymous = await worker.fetch(request('GET', '/'), env);
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get('location'), '/login');

  for (const path of ['/login', '/login.html', '/css/office.css', '/js/parking-core.js', '/favicon.ico']) {
    const res = await worker.fetch(request('GET', path), env);
    assert.equal(res.status, 200, `${path} should stay public`);
  }
  db.close();
});

test('the old public dashboard path is gone and invalid report status is rejected', async () => {
  const { db, env, cookies } = await setupMatrix();
  const old = await worker.fetch(request('GET', '/api/public/current', { cookie: cookies.admin }), env);
  assert.equal(old.status, 404);

  const bad = await worker.fetch(request('GET', '/api/reports?status=junk', { cookie: cookies.admin }), env);
  assert.equal(bad.status, 400);
  db.close();
});

test('logout is public and clears the cookie', async () => {
  const { db, env } = await setupMatrix();
  const res = await worker.fetch(request('POST', '/api/logout'), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /parking_session=;/);
  db.close();
});
