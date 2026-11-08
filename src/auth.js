// 帳號密碼驗證核心：PBKDF2 雜湊、opaque session token、cookie、登入限速、角色。
// 不使用 SESSION_SECRET：token 本身是 256-bit 隨機值，D1 只存 SHA-256 雜湊，可隨時撤銷。
// 時間戳一律 UTC ISO（本專案 Constraint 1）。

const PBKDF2_ITERATIONS = 100_000;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const SESSION_DAYS = 30;

export const SESSION_COOKIE = 'parking_session';
export const IP_MAX_FAILS = 20;
export const ROLES = ['admin', 'console', 'secretary', 'captain', 'patrol', 'manager'];
export const ROLE_HOME = {
  admin: '/admin',
  console: '/CenterConsole',
  secretary: '/secretary',
  captain: '/guard',
  patrol: '/guard',
  manager: '/ManagerDashboard',
};

export function canAccess(role, allowed) {
  return Array.isArray(allowed) && allowed.includes(role);
}

function nowIso() {
  return new Date().toISOString();
}

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomTokenBase64url(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

const PASSWORD_ALPHABET = '23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomPassword(len = 14) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('');
}

export async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

/* ---------- 密碼 ---------- */

export async function hashPassword(password, saltHex) {
  const salt = saltHex
    ? new Uint8Array(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const hex = saltHex ?? toHex(salt);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex}$${toHex(bits)}`;
}

const DUMMY_SALT = '00'.repeat(16);

/** 帳號不存在時照樣跑一次 PBKDF2，回應時間才不會洩漏帳號是否存在。 */
export async function verifyPassword(password, stored) {
  if (!stored) {
    await hashPassword(password, DUMMY_SALT);
    return false;
  }
  const parts = String(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const expected = await hashPassword(password, parts[2]);
  return safeEqual(expected, stored);
}

/* ---------- Cookie ---------- */

export function parseCookies(header) {
  const out = new Map();
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    const decoded = safeDecode(value);
    if (decoded !== null) out.set(name, decoded);
  }
  return out;
}

/** Secure 只在正式環境加；wrangler dev 的 Host 會被改寫，改用本機 .dev.vars 的 DEV_MODE=1。 */
export function sessionCookie(token, secure) {
  const secureFlag = secure ? '; Secure' : '';
  if (token === null) {
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`;
  }
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secureFlag}`;
}

/* ---------- Session ---------- */

export async function createSession(db, username) {
  const token = randomTokenBase64url(32);
  const tokenHash = await sha256Hex(token);
  const now = nowIso();
  // 登入頻率低，順手清掉過期 session 與早已解鎖的失敗紀錄即可，不必排程。
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM login_attempts WHERE locked_until IS NOT NULL AND locked_until <= ?').bind(now),
  ]);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await db
    .prepare('INSERT INTO sessions (token_hash, username, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, username, expires, now)
    .run();
  return token;
}

export async function getSessionUser(db, request) {
  const token = parseCookies(request.headers.get('Cookie')).get(SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT u.username, u.display_name, u.role, u.post_code, u.status, u.must_change_pw, s.expires_at
       FROM sessions s JOIN users u ON u.username = s.username
       WHERE s.token_hash = ?`
    )
    .bind(tokenHash)
    .first();
  if (!row || row.status !== 'active' || row.expires_at <= nowIso()) return null;
  return {
    user: {
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      postCode: row.post_code ?? null,
      mustChangePw: row.must_change_pw === 1,
    },
    tokenHash,
  };
}

export async function destroySession(db, tokenHash) {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

/** 改密碼後把其他裝置全部登出，保留目前這個 session。 */
export async function destroyOtherSessions(db, username, keepTokenHash) {
  await db
    .prepare('DELETE FROM sessions WHERE username = ? AND token_hash != ?')
    .bind(username, keepTokenHash)
    .run();
}

/** admin 重設密碼／停用帳號時，把該使用者全部登出。 */
export async function destroyAllSessions(db, username) {
  await db.prepare('DELETE FROM sessions WHERE username = ?').bind(username).run();
}

/* ---------- 登入限速 ---------- */

/** 回傳剩餘鎖定秒數；0 表示未鎖定。 */
export async function loginLockSeconds(db, key) {
  const row = await db
    .prepare('SELECT locked_until FROM login_attempts WHERE key = ?')
    .bind(key)
    .first();
  if (!row?.locked_until) return 0;
  const remain = Math.ceil((Date.parse(row.locked_until) - Date.now()) / 1000);
  return remain > 0 ? remain : 0;
}

export async function recordLoginFailure(db, key, opts = {}) {
  const maxFails = opts.maxFails ?? MAX_FAILS;
  const row = await db
    .prepare('SELECT fails, locked_until, updated_at FROM login_attempts WHERE key = ?')
    .bind(key)
    .first();
  // 鎖定期已過就重新起算，避免解鎖後再打錯一次又立刻鎖 15 分鐘。
  const lockExpired = !!row?.locked_until && Date.parse(row.locked_until) <= Date.now();
  const stale =
    opts.staleMinutes !== undefined &&
    !!row?.updated_at &&
    Date.now() - Date.parse(row.updated_at) > opts.staleMinutes * 60_000;
  const fails = row && !lockExpired && !stale ? row.fails + 1 : 1;
  const lockedUntil =
    fails >= maxFails ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
  await db
    .prepare(
      `INSERT INTO login_attempts (key, fails, locked_until, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET fails = excluded.fails,
         locked_until = excluded.locked_until, updated_at = excluded.updated_at`
    )
    .bind(key, fails, lockedUntil, nowIso())
    .run();
}

export async function resetLoginFailures(db, key) {
  await db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();
}

/* ---------- IP 層限速 ----------
 * 帳號＋IP 5 次之外另一層：同 IP 不論試哪個帳號，失敗累計 20 次鎖 15 分鐘，
 * 擋分散帳號的密碼噴灑。成功登入不歸零 IP 計數，否則可穿插正確帳號重置；
 * 鎖定到期或距上次失敗超過 15 分鐘才重新起算。
 * IP key 前綴用 '#'：帳號字元不含 '#'，不會與帳號 key 撞名。 */

function normalizeIpv4(value) {
  const m = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return parts.join('.');
}

function ipv6Groups(value) {
  let addr = value;
  const v4Tail = addr.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Tail) {
    const v4 = normalizeIpv4(v4Tail[1]);
    if (!v4) return null;
    const p = v4.split('.').map(Number);
    addr = `${addr.slice(0, addr.length - v4Tail[1].length - 1)}:${((p[0] << 8) | p[1]).toString(16)}:${(
      (p[2] << 8) |
      p[3]
    ).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  for (const group of left.concat(right)) if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
  if (halves.length === 1) {
    if (left.length !== 8) return null;
  } else {
    if (left.length + right.length > 7) return null;
    left.push(...new Array(8 - left.length - right.length).fill('0'));
  }
  return left.concat(right);
}

/** IPv4 用完整位址；IPv6 用 /64（隱私位址每個連線都換尾碼，完整位址擋不住噴灑）。 */
export function ipRateKey(ip) {
  const value = String(ip || '').split('%')[0].trim().toLowerCase();
  if (!value.includes(':')) return value;
  const mapped = value.match(/^::ffff:(.+)$/);
  if (mapped) {
    const v4 = normalizeIpv4(mapped[1]);
    if (v4) return v4;
  }
  const groups = ipv6Groups(value);
  if (!groups) return value;
  const head = groups.slice(0, 4).map((g) => g.replace(/^0+/, '') || '0');
  while (head.length && head[head.length - 1] === '0') head.pop();
  return (head.length ? head.join(':') : '') + '::/64';
}

export function ipLockKey(ip) {
  return `#ip|${ipRateKey(ip)}`;
}

export async function recordIpLoginFailure(db, ip) {
  await recordLoginFailure(db, ipLockKey(ip), { maxFails: IP_MAX_FAILS, staleMinutes: LOCK_MINUTES });
}

/* ---------- 請求 ---------- */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 所有變更請求的 Origin 必須等於請求本身的 origin，否則視為 CSRF 並拒絕。 */
export function requireOrigin(request) {
  if (!MUTATING_METHODS.has(request.method)) return true;
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}
