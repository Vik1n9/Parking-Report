// 帳號管理（僅 admin）：列表、建立、重設密碼、停用／啟用、改顯示名稱與哨點代號。
import { json, readJsonBody } from '../lib/http.js';
import { ROLES, destroyAllSessions, hashPassword, randomPassword } from '../auth.js';

const USERNAME_RE = /^[a-z0-9_.-]{2,32}$/;
const PREFIX = '/api/admin/users';

function userPayload(row) {
  return {
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    postCode: row.post_code ?? null,
    status: row.status,
    mustChangePw: row.must_change_pw === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}

function decodeUsername(value) {
  try {
    return decodeURIComponent(value).trim().toLowerCase();
  } catch {
    return '';
  }
}

function cleanDisplayName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= 20 ? name : null;
}

function cleanPostCode(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const code = value.trim();
  return code.length <= 20 ? code || null : undefined;
}

async function findUser(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
}

export async function handleUsers(env, request, url, session) {
  if (session.user.role !== 'admin') return json({ error: '沒有權限' }, 403);

  /* GET /api/admin/users */
  if (request.method === 'GET' && url.pathname === PREFIX) {
    const { results } = await env.DB.prepare('SELECT * FROM users ORDER BY created_at ASC, username ASC').all();
    return json({ users: (results || []).map(userPayload) });
  }

  /* POST /api/admin/users */
  if (request.method === 'POST' && url.pathname === PREFIX) {
    const body = await readJsonBody(request);
    if (!body) return json({ error: '無效的 JSON' }, 400);
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const displayName = cleanDisplayName(body.displayName);
    const role = typeof body.role === 'string' ? body.role : '';
    const postCode = body.postCode === undefined ? null : cleanPostCode(body.postCode);

    if (!USERNAME_RE.test(username)) {
      return json({ error: '帳號限 2–32 字的小寫 a-z、0-9、_ . -' }, 400);
    }
    if (!displayName) return json({ error: '顯示名稱須為 1～20 字' }, 400);
    if (!ROLES.includes(role)) return json({ error: '角色不正確' }, 400);
    if (postCode === undefined) return json({ error: '哨點代號最多 20 字' }, 400);

    const exists = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(username).first();
    if (exists) return json({ error: '帳號已存在' }, 409);

    const password = randomPassword();
    const hash = await hashPassword(password);
    await env.DB
      .prepare(
        `INSERT INTO users (username, display_name, role, post_code, password_hash, status, must_change_pw, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', 1, ?)`
      )
      .bind(username, displayName, role, postCode ?? null, hash, new Date().toISOString())
      .run();
    const row = await findUser(env.DB, username);
    return json({ user: userPayload(row), password }, 201);
  }

  /* POST /api/admin/users/:username/reset-password */
  const resetMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
  if (request.method === 'POST' && resetMatch) {
    const username = decodeUsername(resetMatch[1]);
    const row = await findUser(env.DB, username);
    if (!row) return json({ error: '帳號不存在' }, 404);
    const password = randomPassword();
    const hash = await hashPassword(password);
    await env.DB.prepare('UPDATE users SET password_hash = ?, must_change_pw = 1 WHERE username = ?')
      .bind(hash, username)
      .run();
    await destroyAllSessions(env.DB, username);
    return json({ password });
  }

  /* POST /api/admin/users/:username/status */
  const statusMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
  if (request.method === 'POST' && statusMatch) {
    const username = decodeUsername(statusMatch[1]);
    const body = await readJsonBody(request);
    if (!body) return json({ error: '無效的 JSON' }, 400);
    const status = body.status === 'active' || body.status === 'disabled' ? body.status : null;
    if (!status) return json({ error: '狀態僅接受 active/disabled' }, 400);
    const row = await findUser(env.DB, username);
    if (!row) return json({ error: '帳號不存在' }, 404);
    if (status === 'disabled' && username === session.user.username) {
      return json({ error: '不可停用自己的帳號' }, 400);
    }
    await env.DB.prepare('UPDATE users SET status = ? WHERE username = ?').bind(status, username).run();
    if (status === 'disabled') await destroyAllSessions(env.DB, username);
    return json({ ok: true });
  }

  /* PATCH /api/admin/users/:username */
  const patchMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (request.method === 'PATCH' && patchMatch) {
    const username = decodeUsername(patchMatch[1]);
    const body = await readJsonBody(request);
    if (!body) return json({ error: '無效的 JSON' }, 400);
    const row = await findUser(env.DB, username);
    if (!row) return json({ error: '帳號不存在' }, 404);

    const hasDisplayName = Object.hasOwn(body, 'displayName');
    const hasPostCode = Object.hasOwn(body, 'postCode');
    if (!hasDisplayName && !hasPostCode) return json({ error: '沒有要更新的欄位' }, 400);

    const sets = [];
    const values = [];
    if (hasDisplayName) {
      const displayName = cleanDisplayName(body.displayName);
      if (!displayName) return json({ error: '顯示名稱須為 1～20 字' }, 400);
      sets.push('display_name = ?');
      values.push(displayName);
    }
    if (hasPostCode) {
      const postCode = cleanPostCode(body.postCode);
      if (postCode === undefined) return json({ error: '哨點代號最多 20 字' }, 400);
      sets.push('post_code = ?');
      values.push(postCode);
    }

    values.push(username);
    await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE username = ?`)
      .bind(...values)
      .run();
    const updated = await findUser(env.DB, username);
    return json({ user: userPayload(updated) });
  }

  return json({ error: '找不到 API 路徑' }, 404);
}
