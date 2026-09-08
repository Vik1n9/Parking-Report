const JWT_ALG = 'ES256';

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
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

export async function verifyAccess(request, env) {
  if (env.DEV_MODE === '1') {
    return { email: request.headers.get('x-dev-user') || 'dev@localhost', dev: true };
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

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
  if (header.alg !== JWT_ALG) return null;

  let certs;
  try {
    const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    certs = await res.json();
  } catch {
    return null;
  }
  const jwk = Array.isArray(certs) ? certs.find((k) => k.kid === header.kid) || certs[0] : null;
  if (!jwk) return null;

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: jwk.crv }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!ok) return null;
  if (payload.aud !== env.ACCESS_AUD) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  return { email: payload.email || payload.identity_name || 'unknown', identityId: payload.identity || null };
}
