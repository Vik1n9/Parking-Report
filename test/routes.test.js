import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.js';
import { getActiveZones, toApiZones } from '../src/routes/zones.js';
import { createReport, listReports, confirmReport, rejectReport } from '../src/routes/reports.js';
import { listRecords } from '../src/routes/records.js';
import { publicCurrent } from '../src/routes/public.js';

const DEVICE = { deviceId: 1, deviceLabel: 'A1' };
const IDENTITY = { email: 'console@example.test' };

function envWith(db) {
  return { DB: db };
}

function post(body) {
  return new Request('https://example.test/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides = {}) {
  return {
    client_request_id: 'req-00000001',
    client_submitted_at: new Date().toISOString(),
    values: {
      floor_above: { kind: 'spaces', value: 232 },
      floor_below: { kind: 'full' },
      p1: { kind: 'tenths', value: 3 },
      spin_b: { kind: 'carts', value: 2 },
      spin_c: { kind: 'guiding' },
    },
    ...overrides,
  };
}

async function seededDb() {
  const db = createTestDb();
  await db.prepare("INSERT INTO guard_devices (id, label, token_hash) VALUES (1, 'A1', 'hash')").run();
  return db;
}

test('zones expose unit and no longer expose isCar', async () => {
  const db = createTestDb();
  const zones = toApiZones(await getActiveZones(db));
  assert.equal(zones[0].unit, 'spaces');
  assert.equal(zones[0].label, '車塔1上');
  assert.equal(zones[4].unit, 'tenths');
  assert.ok(!('isCar' in zones[0]));
  db.close();
});

test('createReport stores structured values and defaults missing zones to none', async () => {
  const db = await seededDb();
  const res = await createReport(envWith(db), post(validBody()), DEVICE);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(body.report.values.floor_above, { kind: 'spaces', value: 232 });
  assert.deepEqual(body.report.values.asphalt, { kind: 'none' });
  db.close();
});

test('createReport rejects an unknown zone code', async () => {
  const db = await seededDb();
  const res = await createReport(envWith(db), post(validBody({ values: { nope: { kind: 'full' } } })), DEVICE);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /未知區域/);
  db.close();
});

test('createReport rejects an unknown kind', async () => {
  const db = await seededDb();
  const res = await createReport(envWith(db), post(validBody({ values: { p1: { kind: 'sideways' } } })), DEVICE);
  assert.equal(res.status, 400);
  db.close();
});

test('createReport rejects out-of-range and mismatched-unit values', async () => {
  const db = await seededDb();
  const cases = [
    { p1: { kind: 'tenths', value: 10 } },
    { p1: { kind: 'tenths', value: 0 } },
    { p1: { kind: 'spaces', value: 5 } },
    { floor_above: { kind: 'tenths', value: 5 } },
    { p1: { kind: 'carts', value: 0 } },
    { p1: { kind: 'full', value: 1 } },
  ];
  for (const values of cases) {
    const res = await createReport(envWith(db), post(validBody({ values })), DEVICE);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(values)}`);
  }
  db.close();
});

test('createReport is idempotent on the same client_request_id', async () => {
  const db = await seededDb();
  await createReport(envWith(db), post(validBody()), DEVICE);
  const again = await createReport(envWith(db), post(validBody()), DEVICE);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true);
  db.close();
});

test('confirmReport recomputes both report texts and the tower percentage', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), DEVICE)).json();
  const req = new Request('https://example.test/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ remarks: { p1: '施工' } }),
  });
  const res = await confirmReport(envWith(db), created.report.id, req, IDENTITY);
  assert.equal(res.status, 201);
  const { record } = await res.json();
  assert.match(record.guardReport, /^停車場回報\n/);
  assert.match(record.consoleReport, /^中控回報：\d\d:\d\d A1回報\n/);
  assert.equal(record.towerPct, 86); // 1600 總數，剩 232 → 已停 1368 → 86%
  assert.deepEqual(record.remarks, { p1: '施工' });
  db.close();
});

test('listReports returns pending reports with their values', async () => {
  const db = await seededDb();
  await createReport(envWith(db), post(validBody()), DEVICE);
  const res = await listReports(envWith(db), new URL('https://example.test/api/reports?status=pending'));
  const body = await res.json();
  assert.equal(body.reports.length, 1);
  assert.equal(body.reports[0].deviceLabel, 'A1');
  assert.deepEqual(body.reports[0].values.floor_below, { kind: 'full' });
  db.close();
});

test('rejectReport keeps the report out of the confirmed path', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), DEVICE)).json();
  const req = new Request('https://example.test/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '數字看起來不對' }),
  });
  await rejectReport(envWith(db), created.report.id, req);
  const confirmRes = await confirmReport(envWith(db), created.report.id, new Request('https://example.test/confirm', { method: 'POST' }), IDENTITY);
  assert.equal(confirmRes.status, 409);
  db.close();
});

test('listRecords returns values and both report texts', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), DEVICE)).json();
  await confirmReport(envWith(db), created.report.id, new Request('https://example.test/confirm', { method: 'POST' }), IDENTITY);
  const today = created.report.businessDate;
  const res = await listRecords(envWith(db), new URL(`https://example.test/api/records?from=${today}&to=${today}`));
  const body = await res.json();
  assert.equal(body.records.length, 1);
  assert.deepEqual(body.records[0].values.p1, { kind: 'tenths', value: 3 });
  assert.ok(body.records[0].guardReport);
  assert.ok(body.records[0].consoleReport);
  db.close();
});

test('the public endpoint returns today entries without any operator data', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), DEVICE)).json();
  await confirmReport(envWith(db), created.report.id, new Request('https://example.test/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ remarks: { p1: '施工' } }),
  }), IDENTITY);

  const res = await publicCurrent(envWith(db), new URL(`https://example.test/api/public/current?date=${created.report.businessDate}`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  const body = await res.json();

  assert.equal(body.entries.length, 1);
  assert.deepEqual(body.entries[0].values.p1, { kind: 'tenths', value: 3 });
  assert.equal(body.entries[0].towerPct, 86);
  assert.equal(body.towerTotal, 1600);
  assert.equal(body.zones[0].label, '車塔1上');

  const serialized = JSON.stringify(body);
  for (const leak of ['prepared_by', 'preparedBy', 'remarks', '施工', 'reportId', 'deviceLabel', 'A1', 'example.test']) {
    assert.ok(!serialized.includes(leak), `public payload must not leak ${leak}`);
  }
  db.close();
});

test('the public endpoint rejects a malformed date', async () => {
  const db = await seededDb();
  const res = await publicCurrent(envWith(db), new URL('https://example.test/api/public/current?date=2026-9-9'));
  assert.equal(res.status, 400);
  db.close();
});
