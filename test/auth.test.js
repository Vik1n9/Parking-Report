import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccess, _resetAccessCertsCache } from '../src/auth.js';

const TEAM = 'demo.cloudflareaccess.com';
const ISSUER = `https://${TEAM}`;
const AUD = 'aud-tag-1';

const keyPair = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify']
);

async function jwkFor(pair, kid) {
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { ...jwk, kid, alg: 'RS256', use: 'sig' };
}

const publicJwk = await jwkFor(keyPair, 'key-1');

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function segment(obj) {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

function claims(overrides = {}) {
  return {
    iss: ISSUER,
    aud: [AUD],
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: 'guard@example.com',
    identity: 'identity-123',
    ...overrides,
  };
}

async function signJwt(payload, { header = {}, privateKey = keyPair.privateKey } = {}) {
  const h = segment({ alg: 'RS256', typ: 'JWT', kid: 'key-1', ...header });
  const p = segment(payload);
  const data = `${h}.${p}`;
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    new TextEncoder().encode(data)
  );
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

function certsFetch(keys, counter = { calls: 0 }) {
  const fetch = async () => {
    counter.calls += 1;
    const current = typeof keys === 'function' ? keys(counter.calls) : keys;
    return { json: async () => ({ keys: current, public_cert: {}, public_certs: [] }) };
  };
  return { fetch, counter };
}

function env(overrides = {}) {
  return { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...overrides };
}

function request({ header, cookie } = {}) {
  const headers = new Headers();
  if (header) headers.set('Cf-Access-Jwt-Assertion', header);
  if (cookie) headers.set('Cookie', cookie);
  return new Request('https://example.com/api/reports', { headers });
}

beforeEach(() => {
  _resetAccessCertsCache();
});

test('valid header token with aud array', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims());
  const identity = await verifyAccess(request({ header: token }), env(), { fetch });
  assert.deepEqual(identity, { email: 'guard@example.com', identityId: 'identity-123' });
});

test('valid token with aud as a string', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims({ aud: AUD }));
  const identity = await verifyAccess(request({ header: token }), env(), { fetch });
  assert.equal(identity.email, 'guard@example.com');
});

test('valid token only in CF_Authorization cookie among other cookies', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims());
  const cookie = `theme=dark;  CF_Authorization=${token} ; note=a=b`;
  const identity = await verifyAccess(request({ cookie }), env(), { fetch });
  assert.equal(identity.email, 'guard@example.com');
});

test('comma-separated ACCESS_AUD matches token tag second', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims({ aud: [AUD] }));
  const identity = await verifyAccess(
    request({ header: token }),
    env({ ACCESS_AUD: 'other-tag, aud-tag-1 ,third-tag' }),
    { fetch }
  );
  assert.equal(identity.email, 'guard@example.com');
});

test('wrong aud returns null', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims({ aud: ['someone-else'] }));
  assert.equal(await verifyAccess(request({ header: token }), env(), { fetch }), null);
});

test('wrong iss returns null', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims({ iss: 'https://evil.cloudflareaccess.com' }));
  assert.equal(await verifyAccess(request({ header: token }), env(), { fetch }), null);
});

test('expired token returns null', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims({ exp: Math.floor(Date.now() / 1000) - 120 }));
  assert.equal(await verifyAccess(request({ header: token }), env(), { fetch }), null);
});

test('exp within clock skew still passes', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims({ exp: Math.floor(Date.now() / 1000) - 30 }));
  const identity = await verifyAccess(request({ header: token }), env(), { fetch });
  assert.equal(identity.email, 'guard@example.com');
});

test('nbf in the future returns null', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims({ nbf: Math.floor(Date.now() / 1000) + 120 }));
  assert.equal(await verifyAccess(request({ header: token }), env(), { fetch }), null);
});

test('nbf within clock skew passes', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims({ nbf: Math.floor(Date.now() / 1000) + 30 }));
  const identity = await verifyAccess(request({ header: token }), env(), { fetch });
  assert.equal(identity.email, 'guard@example.com');
});

test('wrong alg header returns null', async () => {
  const { fetch, counter } = certsFetch([publicJwk]);
  const token = await signJwt(claims(), { header: { alg: 'ES256' } });
  assert.equal(await verifyAccess(request({ header: token }), env(), { fetch }), null);
  assert.equal(counter.calls, 0);
});

test('unknown kid refetches once then returns null', async () => {
  const { fetch, counter } = certsFetch([publicJwk]);
  const token = await signJwt(claims(), { header: { kid: 'missing-key' } });
  assert.equal(await verifyAccess(request({ header: token }), env(), { fetch }), null);
  assert.equal(counter.calls, 2);
});

test('non-object payloads return null instead of throwing', async () => {
  const { fetch } = certsFetch([publicJwk]);
  for (const payload of [null, 42]) {
    const token = await signJwt(payload);
    assert.equal(await verifyAccess(request({ header: token }), env(), { fetch }), null);
  }
});

test('unknown kid refetch is rate-limited to once per minute', async () => {
  const { fetch, counter } = certsFetch([publicJwk]);
  const first = await signJwt(claims(), { header: { kid: 'missing-a' } });
  const second = await signJwt(claims(), { header: { kid: 'missing-b' } });
  assert.equal(await verifyAccess(request({ header: first }), env(), { fetch }), null);
  assert.equal(await verifyAccess(request({ header: second }), env(), { fetch }), null);
  assert.equal(counter.calls, 2);
});

test('unknown kid refetch picks up a rotated key', async () => {
  const rotatedPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  const rotatedJwk = await jwkFor(rotatedPair, 'key-2');
  const { fetch, counter } = certsFetch((call) => (call === 1 ? [publicJwk] : [rotatedJwk]));
  const token = await signJwt(claims(), {
    header: { kid: 'key-2' },
    privateKey: rotatedPair.privateKey,
  });
  const identity = await verifyAccess(request({ header: token }), env(), { fetch });
  assert.equal(identity.email, 'guard@example.com');
  assert.equal(counter.calls, 2);
});

test('tampered payload returns null', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims());
  const [header, , signature] = token.split('.');
  const tampered = `${header}.${segment(claims({ email: 'attacker@example.com' }))}.${signature}`;
  assert.equal(await verifyAccess(request({ header: tampered }), env(), { fetch }), null);
});

test('bad signature returns null', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims());
  const [header, payload] = token.split('.');
  const bogus = b64url(new Uint8Array(256).fill(7));
  assert.equal(
    await verifyAccess(request({ header: `${header}.${payload}.${bogus}` }), env(), { fetch }),
    null
  );
});

test('malformed tokens return null', async () => {
  const { fetch } = certsFetch([publicJwk]);
  for (const token of ['not-a-token', 'a.b.c', 'a.b.c.d', '']) {
    assert.equal(await verifyAccess(request({ header: token }), env(), { fetch }), null);
  }
});

test('missing env vars fail closed without fetching certs', async () => {
  const { fetch, counter } = certsFetch([publicJwk]);
  const token = await signJwt(claims());
  assert.equal(await verifyAccess(request({ header: token }), env({ ACCESS_TEAM_DOMAIN: '' }), { fetch }), null);
  assert.equal(await verifyAccess(request({ header: token }), env({ ACCESS_AUD: '' }), { fetch }), null);
  assert.equal(await verifyAccess(request({ header: token }), { DEV_MODE: '0' }, { fetch }), null);
  assert.equal(counter.calls, 0);
});

test('team domain accepts https:// prefix and trailing slash', async () => {
  const { fetch } = certsFetch([publicJwk]);
  const token = await signJwt(claims());
  const identity = await verifyAccess(
    request({ header: token }),
    env({ ACCESS_TEAM_DOMAIN: `https://${TEAM}/` }),
    { fetch }
  );
  assert.equal(identity.email, 'guard@example.com');
});

test('certs response is cached across verifications', async () => {
  const { fetch, counter } = certsFetch([publicJwk]);
  const token = await signJwt(claims());
  const first = await verifyAccess(request({ header: token }), env(), { fetch });
  const second = await verifyAccess(request({ header: token }), env(), { fetch });
  assert.equal(first.email, 'guard@example.com');
  assert.equal(second.email, 'guard@example.com');
  assert.equal(counter.calls, 1);
});

test('DEV_MODE behavior unchanged', async () => {
  const devEnv = { DEV_MODE: '1' };
  assert.deepEqual(await verifyAccess(request(), devEnv), { email: 'dev@localhost', dev: true });
  assert.deepEqual(await verifyAccess(request({ header: 'ignored' }), devEnv), {
    email: 'dev@localhost',
    dev: true,
  });
  const headers = new Headers();
  headers.set('x-dev-user', 'tester@example.com');
  const req = new Request('https://example.com/api/records', { headers });
  assert.deepEqual(await verifyAccess(req, devEnv), { email: 'tester@example.com', dev: true });
});
