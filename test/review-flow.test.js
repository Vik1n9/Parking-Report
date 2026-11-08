import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.js';
import { createReport, confirmReport, rejectReport, reviewReport, reviewReject } from '../src/routes/reports.js';
import { listRecords } from '../src/routes/records.js';
import { dashboardCurrent } from '../src/routes/dashboard.js';

const CAPTAIN = { username: 'captain', role: 'captain', postCode: 'T1' };
const PATROL = { username: 'patrol', role: 'patrol', postCode: '車巡' };
const CONSOLE = { username: 'console', role: 'console', postCode: null };

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function envWith(db) {
  return { DB: db };
}

function postRequest(body) {
  return new Request('https://example.test/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  const users = [
    ['captain', 'Test Captain', 'captain', 'T1'],
    ['patrol', 'Test Patrol', 'patrol', '車巡'],
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

async function submitPatrol(db, overrides = {}) {
  return (await (await createReport(envWith(db), postRequest(validBody(overrides)), PATROL)).json()).report;
}

async function submitCaptain(db, overrides = {}) {
  return (await (await createReport(envWith(db), postRequest(validBody(overrides)), CAPTAIN)).json()).report;
}

async function review(db, id, body = {}, user = CAPTAIN) {
  return reviewReport(envWith(db), id, postRequest(body), user);
}

async function reviewRejectReport(db, id, body = {}, user = CAPTAIN) {
  return reviewReject(envWith(db), id, postRequest(body), user);
}

async function confirm(db, id, body) {
  return confirmReport(envWith(db), id, postRequest(body), CONSOLE);
}

async function reject(db, id, body) {
  return rejectReport(envWith(db), id, postRequest(body));
}

test('captain review keeps the patrol original and records only the changed zone', async () => {
  const db = await seededDb();
  const created = await submitPatrol(db);

  const res = await review(db, created.id, {
    values: {
      floor_above: { kind: 'spaces', value: 200 }, // changed
      p1: { kind: 'tenths', value: 3 }, // identical
    },
  });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.report.status, 'pending');
  assert.deepEqual(body.report.values.floor_above, { kind: 'spaces', value: 200 });
  assert.deepEqual(body.report.values.p1, { kind: 'tenths', value: 3 });
  assert.deepEqual(body.report.submittedValues.floor_above, { kind: 'spaces', value: 232 });
  assert.deepEqual(body.report.submittedValues.p1, { kind: 'tenths', value: 3 });
  assert.deepEqual(body.report.reviewCorrections, { floor_above: { kind: 'spaces', value: 232 } });
  assert.equal(body.report.submittedBy, 'patrol');
  assert.equal(body.report.reviewedBy, 'captain');
  assert.match(body.report.reviewedAt, ISO_UTC_RE);

  const row = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(created.id).first();
  assert.equal(row.status, 'pending');
  // 上傳者原值永不改寫。
  assert.equal(JSON.parse(row.values_json).floor_above.value, 232);
  assert.equal(JSON.parse(row.reviewed_values_json).floor_above.value, 200);
  assert.deepEqual(JSON.parse(row.review_corrections_json), {
    floor_above: { kind: 'spaces', value: 232 },
  });
  db.close();
});

test('review without values still stores the merged values and a NULL corrections column', async () => {
  const db = await seededDb();
  const created = await submitPatrol(db);

  const res = await review(db, created.id);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.report.status, 'pending');
  assert.deepEqual(body.report.reviewCorrections, {});
  assert.deepEqual(body.report.values, body.report.submittedValues);
  assert.equal(body.report.reviewedBy, 'captain');
  assert.match(body.report.reviewedAt, ISO_UTC_RE);

  const row = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(created.id).first();
  assert.equal(row.review_corrections_json, null);
  assert.ok(row.reviewed_values_json);
  assert.deepEqual(JSON.parse(row.reviewed_values_json), JSON.parse(row.values_json));
  db.close();
});

test('review is idempotent and ignores a second body', async () => {
  const db = await seededDb();
  const created = await submitPatrol(db);
  const first = await (await review(db, created.id, { values: { p1: { kind: 'tenths', value: 5 } } })).json();

  const again = await review(db, created.id, { values: { p1: { kind: 'tenths', value: 8 } } });
  assert.equal(again.status, 200);
  const body = await again.json();
  assert.equal(body.alreadyReviewed, true);
  assert.deepEqual(body.report, first.report);
  assert.deepEqual(body.report.values.p1, { kind: 'tenths', value: 5 });
  db.close();
});

test('review is rejected with 409 once the report left awaiting_captain', async () => {
  const db = await seededDb();

  const confirmed = await submitCaptain(db, { client_request_id: 'req-00000010' });
  await confirm(db, confirmed.id, {});
  const confirmedRes = await review(db, confirmed.id);
  assert.equal(confirmedRes.status, 409);
  assert.equal((await confirmedRes.json()).error, '這筆回報不在待複核狀態');

  const rejected = await submitPatrol(db, { client_request_id: 'req-00000011' });
  assert.equal((await reviewRejectReport(db, rejected.id, { reason: '數字不對' })).status, 200);
  const rejectedRes = await review(db, rejected.id);
  assert.equal(rejectedRes.status, 409);
  db.close();
});

test('invalid review values return 400 and leave the report awaiting_captain', async () => {
  const db = await seededDb();
  const created = await submitPatrol(db);

  const cases = [
    { values: { nope: { kind: 'full' } } },
    { values: { p1: { kind: 'sideways' } } },
    { values: { p1: { kind: 'tenths', value: 12 } } },
    { values: [] },
  ];
  for (const body of cases) {
    const res = await review(db, created.id, body);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }

  const row = await db.prepare('SELECT status, reviewed_values_json FROM reports WHERE id = ?').bind(created.id).first();
  assert.equal(row.status, 'awaiting_captain');
  assert.equal(row.reviewed_values_json, null);
  db.close();
});

test('review-reject rejects the report, records the reviewer and is idempotent', async () => {
  const db = await seededDb();
  const created = await submitPatrol(db);

  const res = await reviewRejectReport(db, created.id, { reason: '車巡回報與現場不符' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.report.status, 'rejected');
  assert.equal(body.report.rejectReason, '車巡回報與現場不符');
  assert.equal(body.report.reviewedBy, 'captain');
  assert.match(body.report.reviewedAt, ISO_UTC_RE);

  const again = await reviewRejectReport(db, created.id, { reason: '第二次' });
  assert.equal(again.status, 200);
  const againBody = await again.json();
  assert.equal(againBody.report.status, 'rejected');
  assert.equal(againBody.report.rejectReason, '車巡回報與現場不符');
  db.close();
});

test('review-reject from pending is a conflict', async () => {
  const db = await seededDb();
  const created = await submitCaptain(db);

  const res = await reviewRejectReport(db, created.id, { reason: '不該退回' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, '這筆回報不在待複核狀態');
  db.close();
});

test('the console cannot confirm or reject while the captain review is pending', async () => {
  const db = await seededDb();
  const created = await submitPatrol(db);

  const confirmed = await confirm(db, created.id, {});
  assert.equal(confirmed.status, 409);
  assert.equal((await confirmed.json()).error, '尚待隊長複核');

  const rejected = await reject(db, created.id, { reason: '想直接退回' });
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).error, '尚待隊長複核');
  db.close();
});

test('full chain: patrol upload, captain correction, console correction', async () => {
  const db = await seededDb();
  const created = await submitPatrol(db);

  await review(db, created.id, { values: { floor_above: { kind: 'spaces', value: 200 } } });
  const res = await confirm(db, created.id, { values: { p1: { kind: 'tenths', value: 4 } } });
  assert.equal(res.status, 201);
  const { record } = await res.json();

  // 最終值同時含隊長與中控的修正。
  assert.deepEqual(record.values.floor_above, { kind: 'spaces', value: 200 });
  assert.deepEqual(record.values.p1, { kind: 'tenths', value: 4 });
  // 中控修正相對隊長複核後的基準值（p1 當時是 3）。
  assert.deepEqual(record.corrections, { p1: { kind: 'tenths', value: 3 } });
  // 隊長修正保留車巡原值。
  assert.deepEqual(record.captainCorrections, { floor_above: { kind: 'spaces', value: 232 } });
  // 中控標題用上傳者（車巡）的代號。
  assert.match(record.consoleReport, /^中控回報：\d\d:\d\d 車巡回報\n/);
  // 車塔剩餘以最終值計算：司塔上剩 200，車塔下滿。
  assert.equal(record.towerRemaining, 200);
  assert.equal(record.towerPct, 88);

  const today = created.businessDate;
  const records = await (
    await listRecords(envWith(db), new URL(`https://example.test/api/records?from=${today}&to=${today}`))
  ).json();
  assert.equal(records.records.length, 1);
  assert.deepEqual(records.records[0].captainCorrections, record.captainCorrections);

  // 回報單本身仍是車巡原值，複核結果另存。
  const row = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(created.id).first();
  assert.equal(JSON.parse(row.values_json).floor_above.value, 232);
  assert.equal(JSON.parse(row.reviewed_values_json).floor_above.value, 200);
  db.close();
});

test('captain direct upload keeps an empty captainCorrections on the record', async () => {
  const db = await seededDb();
  const created = await submitCaptain(db);
  const { record } = await (await confirm(db, created.id, {})).json();

  assert.deepEqual(record.captainCorrections, {});
  assert.deepEqual(record.corrections, {});
  const row = await db.prepare('SELECT captain_corrections_json FROM records WHERE id = ?').bind(record.id).first();
  assert.equal(row.captain_corrections_json, null);
  db.close();
});

test('the dashboard still hides review and captain data', async () => {
  const db = await seededDb();
  const created = await submitPatrol(db);
  await review(db, created.id, { values: { floor_above: { kind: 'spaces', value: 200 } } });
  await confirm(db, created.id, { values: { p1: { kind: 'tenths', value: 4 } } });

  const body = await (
    await dashboardCurrent(envWith(db), new URL(`https://example.test/api/dashboard/current?date=${created.businessDate}`))
  ).json();
  const entry = body.entries[0];
  assert.deepEqual(entry.values.floor_above, { kind: 'spaces', value: 200 });
  assert.ok(!('reviewedBy' in entry));
  assert.ok(!('submittedBy' in entry));
  assert.ok(!('captainCorrections' in entry));
  const serialized = JSON.stringify(body);
  for (const leak of ['reviewedBy', 'submittedBy', 'captainCorrections', 'reviewCorrections', 'reviewed_values_json']) {
    assert.ok(!serialized.includes(leak), `dashboard payload must not leak ${leak}`);
  }
  db.close();
});
