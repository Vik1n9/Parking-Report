import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.js';
import { getActiveZones, toApiZones, zonesResponse } from '../src/routes/zones.js';
import { createReport, listReports, confirmReport, rejectReport } from '../src/routes/reports.js';
import { listRecords } from '../src/routes/records.js';
import { dashboardCurrent } from '../src/routes/dashboard.js';

const CAPTAIN = { username: 'captain', role: 'captain', postCode: 'T1' };
const PATROL = { username: 'patrol', role: 'patrol', postCode: 'P9' };
const CONSOLE = { username: 'console', role: 'console', postCode: null };

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

function confirmRequest(body) {
  return new Request('https://example.test/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function confirm(db, id, body) {
  return confirmReport(envWith(db), id, confirmRequest(body), CONSOLE);
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
  const users = [
    ['captain', 'Test Captain', 'captain', 'T1'],
    ['patrol', 'Test Patrol', 'patrol', 'P9'],
    ['console', 'Test Console', 'console', null],
  ];
  for (const [username, displayName, role, postCode] of users) {
    await db
      .prepare(
        `INSERT INTO users (username, display_name, role, post_code, password_hash, status, must_change_pw, created_at)
         VALUES (?, ?, ?, ?, 'not-used', 'active', 0, '2026-11-09T00:00:00.000Z')`
      )
      .bind(username, displayName, role, postCode)
      .run();
  }
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
  const res = await createReport(envWith(db), post(validBody()), PATROL);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(body.report.values.floor_above, { kind: 'spaces', value: 232 });
  assert.deepEqual(body.report.values.asphalt, { kind: 'none' });
  db.close();
});

test('patrol reports are awaiting_captain and captain reports go straight to pending', async () => {
  const db = await seededDb();
  const patrol = await (await createReport(envWith(db), post(validBody()), PATROL)).json();
  assert.equal(patrol.report.status, 'awaiting_captain');

  const captain = await (
    await createReport(envWith(db), post(validBody({ client_request_id: 'req-00000002' })), CAPTAIN)
  ).json();
  assert.equal(captain.report.status, 'pending');

  const row = await db.prepare('SELECT submitted_by, device_id FROM reports WHERE id = ?').bind(captain.report.id).first();
  assert.equal(row.submitted_by, 'captain');
  assert.equal(row.device_id, null);
  db.close();
});

test('createReport rejects an unknown zone code', async () => {
  const db = await seededDb();
  const res = await createReport(envWith(db), post(validBody({ values: { nope: { kind: 'full' } } })), PATROL);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /未知區域/);
  db.close();
});

test('createReport rejects an unknown kind', async () => {
  const db = await seededDb();
  const res = await createReport(envWith(db), post(validBody({ values: { p1: { kind: 'sideways' } } })), PATROL);
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
    const res = await createReport(envWith(db), post(validBody({ values })), PATROL);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(values)}`);
  }
  db.close();
});

test('createReport is idempotent on the same client_request_id', async () => {
  const db = await seededDb();
  await createReport(envWith(db), post(validBody()), PATROL);
  const again = await createReport(envWith(db), post(validBody()), PATROL);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true);
  db.close();
});

test('confirmReport recomputes both report texts and the tower percentage', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), CAPTAIN)).json();
  const req = new Request('https://example.test/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ remarks: { p1: '施工' } }),
  });
  const res = await confirmReport(envWith(db), created.report.id, req, CONSOLE);
  assert.equal(res.status, 201);
  const { record } = await res.json();
  assert.match(record.guardReport, /^停車場回報\n/);
  assert.match(record.consoleReport, /^中控回報：\d\d:\d\d T1回報\n/);
  assert.equal(record.preparedBy, 'console');
  assert.equal(record.towerPct, 86); // 1600 總數，剩 232 → 已停 1368 → 86%
  assert.deepEqual(record.remarks, { p1: '施工' });
  db.close();
});

test('listReports returns pending reports with their values and submitter label', async () => {
  const db = await seededDb();
  await createReport(envWith(db), post(validBody()), CAPTAIN);
  const res = await listReports(envWith(db), new URL('https://example.test/api/reports?status=pending'));
  const body = await res.json();
  assert.equal(body.reports.length, 1);
  assert.equal(body.reports[0].deviceLabel, 'T1');
  assert.deepEqual(body.reports[0].values.floor_below, { kind: 'full' });

  const awaiting = await (await createReport(envWith(db), post(validBody({ client_request_id: 'req-00000003' })), PATROL)).json();
  const list = await (await listReports(envWith(db), new URL('https://example.test/api/reports?status=awaiting_captain'))).json();
  assert.equal(list.reports.length, 1);
  assert.equal(list.reports[0].id, awaiting.report.id);
  assert.equal(list.reports[0].deviceLabel, 'P9');
  db.close();
});

test('rejectReport keeps the report out of the confirmed path', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), CAPTAIN)).json();
  const req = new Request('https://example.test/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '數字看起來不對' }),
  });
  await rejectReport(envWith(db), created.report.id, req);
  const confirmRes = await confirmReport(envWith(db), created.report.id, new Request('https://example.test/confirm', { method: 'POST' }), CONSOLE);
  assert.equal(confirmRes.status, 409);
  db.close();
});

test('awaiting_captain reports cannot be confirmed or rejected by the console yet', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), PATROL)).json();
  const confirmed = await confirmReport(
    envWith(db),
    created.report.id,
    new Request('https://example.test/confirm', { method: 'POST' }),
    CONSOLE
  );
  assert.equal(confirmed.status, 409);
  const rejected = await rejectReport(
    envWith(db),
    created.report.id,
    new Request('https://example.test/reject', { method: 'POST' })
  );
  assert.equal(rejected.status, 409);
  db.close();
});

test('listRecords returns values and both report texts', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), CAPTAIN)).json();
  await confirmReport(envWith(db), created.report.id, new Request('https://example.test/confirm', { method: 'POST' }), CONSOLE);
  const today = created.report.businessDate;
  const res = await listRecords(envWith(db), new URL(`https://example.test/api/records?from=${today}&to=${today}`));
  const body = await res.json();
  assert.equal(body.records.length, 1);
  assert.deepEqual(body.records[0].values.p1, { kind: 'tenths', value: 3 });
  assert.ok(body.records[0].guardReport);
  assert.ok(body.records[0].consoleReport);
  db.close();
});

test('the dashboard endpoint returns today entries without any operator data', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), CAPTAIN)).json();
  await confirmReport(envWith(db), created.report.id, new Request('https://example.test/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ remarks: { p1: '施工' } }),
  }), CONSOLE);

  const res = await dashboardCurrent(envWith(db), new URL(`https://example.test/api/dashboard/current?date=${created.report.businessDate}`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.match(res.headers.get('cache-control'), /^private/);
  const body = await res.json();

  assert.equal(body.entries.length, 1);
  assert.deepEqual(body.entries[0].values.p1, { kind: 'tenths', value: 3 });
  assert.equal(body.entries[0].towerPct, 86);
  assert.equal(body.towerTotal, 1600);
  assert.equal(body.zones[0].label, '車塔1上');

  assert.ok(Array.isArray(body.events));
  assert.equal(body.events.length, 0);

  const serialized = JSON.stringify(body);
  for (const leak of [
    'prepared_by',
    'preparedBy',
    'remarks',
    '施工',
    'reportId',
    'submitted_by',
    'submittedBy',
    'deviceLabel',
    'T1',
    'Test Captain',
    'example.test',
  ]) {
    assert.ok(!serialized.includes(leak), `dashboard payload must not leak ${leak}`);
  }
  db.close();
});

test('the dashboard endpoint returns site events without operator identity', async () => {
  const db = await seededDb();
  const day = '2026-09-13';
  await db
    .prepare(
      `INSERT INTO site_events (site_id, business_date, kind, zone_code, occurred_at, cleared_at, detail, created_by)
       VALUES (1, ?, 'guiding', NULL, '2026-09-13T04:37:00.000Z', NULL, NULL, 'console@example.test')`
    )
    .bind(day)
    .run();
  await db
    .prepare(
      `INSERT INTO site_events (site_id, business_date, kind, zone_code, occurred_at, cleared_at, detail, created_by)
       VALUES (1, ?, 'jam', 'p1', '2026-09-13T04:52:00.000Z', '2026-09-13T05:10:00.000Z', NULL, 'console@example.test')`
    )
    .bind(day)
    .run();

  const res = await dashboardCurrent(envWith(db), new URL(`https://example.test/api/dashboard/current?date=${day}`));
  const body = await res.json();
  assert.equal(body.events.length, 2);
  assert.deepEqual(body.events[0], {
    kind: 'guiding',
    zoneCode: null,
    zoneLabel: null,
    occurredAt: '2026-09-13T04:37:00.000Z',
    clearedAt: null,
    detail: null,
  });
  assert.equal(body.events[1].kind, 'jam');
  assert.equal(body.events[1].zoneCode, 'p1');
  assert.equal(body.events[1].zoneLabel, 'P1');
  assert.equal(body.events[1].clearedAt, '2026-09-13T05:10:00.000Z');

  const serialized = JSON.stringify(body);
  for (const leak of ['created_by', 'createdBy', 'console@example.test', 'example.test']) {
    assert.ok(!serialized.includes(leak), `dashboard events must not leak ${leak}`);
  }
  db.close();
});

test('the dashboard endpoint rejects a malformed date', async () => {
  const db = await seededDb();
  const res = await dashboardCurrent(envWith(db), new URL('https://example.test/api/dashboard/current?date=2026-9-9'));
  assert.equal(res.status, 400);
  db.close();
});

test('/api/zones response carries the tower total', async () => {
  const db = await seededDb();
  const res = await zonesResponse(envWith(db));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.towerTotal, 1600);
  assert.equal(body.zones.length, 10);
  assert.equal(body.zones[0].code, 'floor_above');
  db.close();
});

test('confirmReport applies console corrections to every snapshot', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), CAPTAIN)).json();
  const res = await confirm(db, created.report.id, { values: { floor_below: { kind: 'spaces', value: 100 } } });
  assert.equal(res.status, 201);
  const { record } = await res.json();

  assert.deepEqual(record.values.floor_below, { kind: 'spaces', value: 100 });
  assert.match(record.guardReport, /車塔1下：100車位/);
  assert.match(record.consoleReport, /車塔1下 100車位/);
  assert.equal(record.excelValues.split('\t')[1], '100');
  assert.equal(record.towerPct, 79); // 232 + 100 = 332 剩餘 → 已停 1268 → 79%
  assert.equal(record.towerRemaining, 332);

  const row = await db.prepare('SELECT values_json FROM records WHERE id = ?').bind(record.id).first();
  assert.deepEqual(JSON.parse(row.values_json).floor_below, { kind: 'spaces', value: 100 });
  db.close();
});

test('corrections record only zones the console actually changed, with the guard original', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), CAPTAIN)).json();
  const res = await confirm(db, created.report.id, {
    values: {
      p1: { kind: 'tenths', value: 3 }, // identical to the guard
      spin_b: { kind: 'carts', value: 4 }, // changed
    },
  });
  const { record } = await res.json();
  assert.deepEqual(record.corrections, { spin_b: { kind: 'carts', value: 2 } });
  db.close();
});

test('confirm without values leaves corrections empty and the column NULL', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), CAPTAIN)).json();
  const { record } = await (await confirm(db, created.report.id, {})).json();

  assert.deepEqual(record.corrections, {});
  assert.equal(record.displayBefore, null);
  const row = await db.prepare('SELECT corrections_json FROM records WHERE id = ?').bind(record.id).first();
  assert.equal(row.corrections_json, null);
  db.close();
});

test('console corrections never rewrite the guard values on the report', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), CAPTAIN)).json();
  const before = await db.prepare('SELECT values_json FROM reports WHERE id = ?').bind(created.report.id).first();

  await confirm(db, created.report.id, { values: { floor_below: { kind: 'spaces', value: 100 } } });

  const after = await db.prepare('SELECT values_json FROM reports WHERE id = ?').bind(created.report.id).first();
  assert.equal(after.values_json, before.values_json);
  assert.deepEqual(JSON.parse(after.values_json).floor_below, { kind: 'full' });
  db.close();
});

test('confirm rejects invalid corrections before writing anything', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), CAPTAIN)).json();
  const cases = [
    { values: { nope: { kind: 'full' } } },
    { values: { p1: { kind: 'sideways' } } },
    { values: { p1: { kind: 'tenths', value: 12 } } },
    { values: [] },
  ];
  for (const body of cases) {
    const res = await confirm(db, created.report.id, body);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
  const report = await db.prepare('SELECT status FROM reports WHERE id = ?').bind(created.report.id).first();
  assert.equal(report.status, 'pending');
  const records = await db.prepare('SELECT COUNT(*) AS n FROM records').first();
  assert.equal(records.n, 0);
  db.close();
});

test('display_before accepts 0-9999 and rejects everything else', async () => {
  const db = await seededDb();
  for (const [i, value] of [0, 9999].entries()) {
    const created = await (await createReport(envWith(db), post(validBody({ client_request_id: `req-display-${i}` })), CAPTAIN)).json();
    const res = await confirm(db, created.report.id, { display_before: value });
    assert.equal(res.status, 201);
    const { record } = await res.json();
    assert.equal(record.displayBefore, value);
    const row = await db.prepare('SELECT display_before FROM records WHERE id = ?').bind(record.id).first();
    assert.equal(row.display_before, value);
  }

  const invalid = [-1, 10000, 1.5, '12'];
  for (const [i, value] of invalid.entries()) {
    const created = await (await createReport(envWith(db), post(validBody({ client_request_id: `req-baddisplay-${i}` })), CAPTAIN)).json();
    const res = await confirm(db, created.report.id, { display_before: value });
    assert.equal(res.status, 400, `expected 400 for display_before ${JSON.stringify(value)}`);
  }
  db.close();
});

test('re-confirming an already confirmed report ignores new corrections', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), CAPTAIN)).json();
  const first = await (await confirm(db, created.report.id, { values: { p1: { kind: 'tenths', value: 4 } } })).json();

  const res = await confirm(db, created.report.id, { values: { p1: { kind: 'tenths', value: 8 } } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.alreadyConfirmed, true);
  assert.deepEqual(body.record, first.record);
  assert.deepEqual(body.record.values.p1, { kind: 'tenths', value: 4 });

  const row = await db.prepare('SELECT values_json FROM records WHERE id = ?').bind(first.record.id).first();
  assert.equal(JSON.parse(row.values_json).p1.value, 4);
  db.close();
});

test('towerRemaining sums tower spaces and is null when a tower zone is unreadable', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), CAPTAIN)).json();
  const { record } = await (await confirm(db, created.report.id, {})).json();
  assert.equal(record.towerRemaining, 232); // floor_above 232 + floor_below full
  assert.equal(record.towerPct, 86);

  const guiding = await (
    await createReport(
      envWith(db),
      post(
        validBody({
          client_request_id: 'req-tower-guiding',
          values: { floor_above: { kind: 'spaces', value: 500 }, floor_below: { kind: 'guiding' } },
        })
      ),
      CAPTAIN
    )
  ).json();
  const guided = await (await confirm(db, guiding.report.id, {})).json();
  assert.equal(guided.record.towerRemaining, null);
  assert.equal(guided.record.towerPct, null);
  db.close();
});

test('the dashboard endpoint never exposes console corrections or the display-board number', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), CAPTAIN)).json();
  await confirm(db, created.report.id, {
    values: { floor_below: { kind: 'spaces', value: 100 } },
    display_before: 250,
  });

  const body = await (
    await dashboardCurrent(envWith(db), new URL(`https://example.test/api/dashboard/current?date=${created.report.businessDate}`))
  ).json();
  const entry = body.entries[0];
  assert.ok(!('corrections' in entry), 'dashboard entries must not expose corrections');
  assert.ok(!('displayBefore' in entry), 'dashboard entries must not expose displayBefore');
  assert.ok(!('towerRemaining' in entry), 'dashboard entries must not expose towerRemaining');
  assert.equal(JSON.stringify(body).includes('display_before'), false);
  db.close();
});
