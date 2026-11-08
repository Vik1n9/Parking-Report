const JWT_ALG = 'RS256';
const CERT_CACHE_TTL_MS = 5 * 60 * 1000;
const FORCED_REFETCH_INTERVAL_MS = 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

const certsCache = new Map();
const forcedRefetchAt = new Map();

export function _resetAccessCertsCache() {
  certsCache.clear();
  forcedRefetchAt.clear();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

function normalizeTeamDomain(value) {
  return String(value || '')
    .trim()
    .replace(/^https:\/\//i, '')
    .replace(/\/+$/, '');
}

function parseCookies(header) {
  const cookies = new Map();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    cookies.set(name, value);
  }
  return cookies;
}

function accessToken(request) {
  const header = (request.headers.get('Cf-Access-Jwt-Assertion') || '').trim();
  if (header) return header;
  return parseCookies(request.headers.get('Cookie')).get('CF_Authorization') || null;
}

async function loadCerts(teamDomain, fetchImpl, { force = false } = {}) {
  const now = Date.now();
  const cached = certsCache.get(teamDomain);
  if (!force && cached && cached.expires > now) return cached.data;

  try {
    const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
    const data = await res.json();
    if (!data || !Array.isArray(data.keys)) return null;
    certsCache.set(teamDomain, { data, expires: now + CERT_CACHE_TTL_MS });
    return data;
  } catch {
    return null;
  }
}

function findKey(keys, kid) {
  if (!kid) return null;
  return keys.find((k) => k && k.kid === kid) || null;
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyDeviceToken(request, db) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const hash = await hashToken(token);
  const row = await db
    .prepare('SELECT id, label, revoked_at FROM guard_devices WHERE token_hash = ?')
    .bind(hash)
    .first();
  if (!row || row.revoked_at) return null;
  return { deviceId: row.id, deviceLabel: row.label };
}

export async function verifyAccess(request, env, opts = {}) {
  if (env.DEV_MODE === '1') {
    return { email: request.headers.get('x-dev-user') || 'dev@localhost', dev: true };
  }

  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audTags = String(env.ACCESS_AUD || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (!teamDomain || audTags.length === 0) return null;

  const token = accessToken(request);
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header;
  let payload;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    return null;
  }
  if (!isPlainObject(header) || !isPlainObject(payload)) return null;
  if (header.alg !== JWT_ALG) return null;

  const fetchImpl = opts.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;

  try {
    let certs = await loadCerts(teamDomain, fetchImpl);
    if (!certs) return null;
    let jwk = findKey(certs.keys, header.kid);
    if (!jwk) {
      // Access rotates signing keys; refetch once on an unknown kid, but rate-limit
      // forced refetches so random kids cannot bypass the cache on every request.
      const now = Date.now();
      const lastForced = forcedRefetchAt.get(teamDomain) || 0;
      if (now - lastForced < FORCED_REFETCH_INTERVAL_MS) return null;
      forcedRefetchAt.set(teamDomain, now);
      certs = await loadCerts(teamDomain, fetchImpl, { force: true });
      if (!certs) return null;
      jwk = findKey(certs.keys, header.kid);
    }
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const ok = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!ok) return null;
  } catch {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (payload.iss !== `https://${teamDomain}`) return null;

  const tokenAud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!tokenAud.some((tag) => typeof tag === 'string' && audTags.includes(tag))) return null;

  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) return null;
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number' || payload.nbf - CLOCK_SKEW_SECONDS > nowSeconds) return null;
  }

  return { email: payload.email || payload.identity_name || 'unknown', identityId: payload.identity || null };
}
