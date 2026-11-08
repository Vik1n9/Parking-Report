// 登入／登出／me／變更密碼。
import { json, readJsonBody } from '../lib/http.js';
import {
  ROLE_HOME,
  clientIp,
  createSession,
  destroyOtherSessions,
  destroySession,
  hashPassword,
  ipLockKey,
  loginLockSeconds,
  recordIpLoginFailure,
  recordLoginFailure,
  resetLoginFailures,
  sessionCookie,
  verifyPassword,
} from '../auth.js';

const MIN_PASSWORD = 8;

export function mePayload(user) {
  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    postCode: user.postCode ?? null,
    mustChangePw: user.mustChangePw,
    home: ROLE_HOME[user.role] ?? null,
  };
}

/** POST /api/login（不需 session） */
export async function login(env, request) {
  const body = await readJsonBody(request);
  if (!body) return json({ error: '無效的 JSON' }, 400);
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) return json({ error: '請輸入帳號與密碼' }, 400);
  if (username.length > 32 || password.length > 128) {
    return json({ error: '帳號或密碼格式錯誤' }, 400);
  }

  const ip = clientIp(request);
  const lockKey = `${username}|${ip}`;
  const ipKey = ipLockKey(ip);
  const locked = await loginLockSeconds(env.DB, lockKey);
  if (locked > 0) {
    return json({ error: `失敗次數過多，請 ${Math.ceil(locked / 60)} 分鐘後再試` }, 429);
  }
  const ipLocked = await loginLockSeconds(env.DB, ipKey);
  if (ipLocked > 0) {
    return json({ error: `失敗次數過多，請 ${Math.ceil(ipLocked / 60)} 分鐘後再試` }, 429);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();

  // 帳號不存在也走一次雜湊（verifyPassword 收到空值會比對假雜湊），避免用回應時間分辨帳號。
  const passwordOk = await verifyPassword(password, user?.password_hash);
  if (!user || !passwordOk) {
    await recordLoginFailure(env.DB, lockKey);
    await recordIpLoginFailure(env.DB, ip);
    return json({ error: '帳號或密碼錯誤' }, 401);
  }
  if (user.status !== 'active') {
    return json({ error: '帳號已停用' }, 403);
  }

  // 只歸零「帳號＋IP」的計數；IP 計數不歸零，否則可穿插正確帳號重置。
  await resetLoginFailures(env.DB, lockKey);
  const token = await createSession(env.DB, user.username);
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE username = ?')
    .bind(new Date().toISOString(), user.username)
    .run();
  const me = mePayload({
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    postCode: user.post_code ?? null,
    mustChangePw: user.must_change_pw === 1,
  });
  return json({ me }, 200, { 'set-cookie': sessionCookie(token, env.DEV_MODE !== '1') });
}

/** POST /api/logout（沒有 session 也回 ok，順便清 cookie） */
export async function logout(env, session) {
  if (session) await destroySession(env.DB, session.tokenHash);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(null, env.DEV_MODE !== '1') });
}

/** GET /api/me */
export function me(session) {
  return json({ me: mePayload(session.user) });
}

/** POST /api/change-password：改完把其他裝置全部登出。
 *  目前密碼錯誤也計入限速（key 多一段 |pw| 分開計），否則拿到 cookie 的人可以無限次試。 */
export async function changePassword(env, request, session) {
  const lockKey = `${session.user.username}|pw|${clientIp(request)}`;
  const locked = await loginLockSeconds(env.DB, lockKey);
  if (locked > 0) {
    return json({ error: `失敗次數過多，請 ${Math.ceil(locked / 60)} 分鐘後再試` }, 429);
  }

  const body = await readJsonBody(request);
  if (!body) return json({ error: '無效的 JSON' }, 400);
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const next = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!current || !next) return json({ error: '請輸入目前密碼與新密碼' }, 400);
  if (next.length < MIN_PASSWORD || next.length > 128) {
    return json({ error: `新密碼長度須為 ${MIN_PASSWORD}～128 字` }, 400);
  }
  if (current === next) return json({ error: '新密碼不可與目前密碼相同' }, 400);

  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE username = ? AND status = 'active'")
    .bind(session.user.username)
    .first();
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    await recordLoginFailure(env.DB, lockKey);
    return json({ error: '目前密碼不正確' }, 403);
  }
  await resetLoginFailures(env.DB, lockKey);

  const hash = await hashPassword(next);
  await env.DB.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE username = ?')
    .bind(hash, session.user.username)
    .run();
  await destroyOtherSessions(env.DB, session.user.username, session.tokenHash);
  return json({ ok: true });
}
