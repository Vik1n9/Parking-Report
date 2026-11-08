import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.js';

test('zones carry a unit and the LINE-facing labels after migration', async () => {
  const db = createTestDb();
  const { results } = await db.prepare('SELECT code, label, excel_label, unit, in_tower FROM zones ORDER BY position').all();
  assert.equal(results.length, 10);
  assert.deepEqual(results[0], { code: 'floor_above', label: '車塔1上', excel_label: '1F↑', unit: 'spaces', in_tower: 1 });
  assert.deepEqual(results[4], { code: 'spin_a', label: 'A區', excel_label: '紡織-A', unit: 'tenths', in_tower: 0 });
  db.close();
});

test('zones no longer has is_car', async () => {
  const db = createTestDb();
  const { results } = await db.prepare("SELECT name FROM pragma_table_info('zones')").all();
  const names = results.map((r) => r.name);
  assert.ok(names.includes('unit'));
  assert.ok(!names.includes('is_car'));
  db.close();
});

test('reports and records expose values_json and the renamed report columns', async () => {
  const db = createTestDb();
  const reportCols = (await db.prepare("SELECT name FROM pragma_table_info('reports')").all()).results.map((r) => r.name);
  const recordCols = (await db.prepare("SELECT name FROM pragma_table_info('records')").all()).results.map((r) => r.name);
  assert.ok(reportCols.includes('values_json'));
  assert.ok(!reportCols.includes('tokens_json'));
  assert.ok(recordCols.includes('values_json'));
  assert.ok(recordCols.includes('guard_report'));
  assert.ok(recordCols.includes('console_report'));
  assert.ok(!recordCols.includes('line_report'));
  assert.ok(!recordCols.includes('control_report'));
  db.close();
});

test('site_events stores console-issued field status', async () => {
  const db = createTestDb();
  const cols = (await db.prepare("SELECT name FROM pragma_table_info('site_events')").all()).results.map((r) => r.name);
  assert.ok(cols.includes('kind'));
  assert.ok(cols.includes('occurred_at'));
  assert.ok(cols.includes('cleared_at'));
  assert.ok(cols.includes('zone_code'));
  assert.ok(cols.includes('created_by'));
  db.close();
});

test('the migration converts legacy token strings into structured values', async () => {
  const db = createTestDb({ migrations: ['0001_init.sql', '0002_seed.sql'] });
  await db
    .prepare(
      `INSERT INTO reports (site_id, device_id, status, client_request_id, tokens_json, business_date, submitted_at)
       VALUES (1, NULL, 'pending', 'legacy-0001', ?, '2026-09-01', '2026-09-01T04:00:00.000Z')`
    )
    .bind(JSON.stringify({ floor_above: '423', floor_below: '0', p1: '7', spin_a: '0.4', asphalt: 'x' }))
    .run();
  await db.applyMigration('0003_value_model.sql');

  const row = await db.prepare('SELECT values_json FROM reports WHERE client_request_id = ?').bind('legacy-0001').first();
  const values = JSON.parse(row.values_json);
  assert.deepEqual(values.floor_above, { kind: 'spaces', value: 423 });
  assert.deepEqual(values.floor_below, { kind: 'full' });
  assert.deepEqual(values.p1, { kind: 'tenths', value: 7 });
  assert.deepEqual(values.spin_a, { kind: 'carts', value: 4 });
  assert.deepEqual(values.asphalt, { kind: 'none' });
  db.close();
});

test('0005 adds the console-review columns', async () => {
  const db = createTestDb();
  const cols = (await db.prepare("SELECT name FROM pragma_table_info('records')").all()).results.map((r) => r.name);
  assert.ok(cols.includes('corrections_json'));
  assert.ok(cols.includes('tower_remaining'));
  assert.ok(cols.includes('display_before'));
  db.close();
});

test('0005 backfills tower_remaining only when every tower zone is spaces or full', async () => {
  const db = createTestDb({
    migrations: ['0001_init.sql', '0002_seed.sql', '0003_value_model.sql', '0004_site_events.sql'],
  });

  async function insertLegacy(id, values) {
    const json = JSON.stringify(values);
    await db
      .prepare(
        `INSERT INTO reports (id, site_id, device_id, status, client_request_id, values_json, business_date, submitted_at)
         VALUES (?, 1, NULL, 'confirmed', ?, ?, '2026-09-01', '2026-09-01T04:00:00.000Z')`
      )
      .bind(id, `legacy-000${id}`, json)
      .run();
    await db
      .prepare(
        `INSERT INTO records (report_id, site_id, business_date, values_json, guard_report, prepared_by, report_time, confirmed_at)
         VALUES (?, 1, '2026-09-01', ?, 'legacy', 'console@example.test', '12:00', '2026-09-01T04:10:00.000Z')`
      )
      .bind(id, json)
      .run();
  }

  await insertLegacy(1, { floor_above: { kind: 'spaces', value: 100 }, floor_below: { kind: 'spaces', value: 50 } });
  await insertLegacy(2, { floor_above: { kind: 'spaces', value: 200 }, floor_below: { kind: 'full' } });
  await insertLegacy(3, { floor_above: { kind: 'spaces', value: 100 }, floor_below: { kind: 'guiding' } });

  db.applyMigration('0005_console_review.sql');

  const { results } = await db
    .prepare('SELECT report_id, tower_remaining FROM records ORDER BY report_id')
    .all();
  assert.deepEqual(results, [
    { report_id: 1, tower_remaining: 150 },
    { report_id: 2, tower_remaining: 200 },
    { report_id: 3, tower_remaining: null },
  ]);
  db.close();
});

test('0006 creates users, sessions and login_attempts with the expected columns', async () => {
  const db = createTestDb();
  const userCols = (await db.prepare("SELECT name FROM pragma_table_info('users')").all()).results.map((r) => r.name);
  for (const name of [
    'username',
    'display_name',
    'role',
    'post_code',
    'password_hash',
    'status',
    'must_change_pw',
    'created_at',
    'last_login_at',
  ]) {
    assert.ok(userCols.includes(name), `users.${name}`);
  }
  const sessionCols = (await db.prepare("SELECT name FROM pragma_table_info('sessions')").all()).results.map((r) => r.name);
  assert.deepEqual(sessionCols.sort(), ['created_at', 'expires_at', 'token_hash', 'username']);
  const attemptCols = (await db.prepare("SELECT name FROM pragma_table_info('login_attempts')").all()).results.map((r) => r.name);
  assert.deepEqual(attemptCols.sort(), ['fails', 'key', 'locked_until', 'updated_at']);
  db.close();
});

test('0006 constrains user roles, statuses and report statuses', async () => {
  const db = createTestDb();
  const insertUser = (username, role, status = 'active') =>
    db
      .prepare(
        `INSERT INTO users (username, display_name, role, password_hash, status, created_at)
         VALUES (?, 'name', ?, 'hash', ?, '2026-11-09T00:00:00.000Z')`
      )
      .bind(username, role, status)
      .run();

  for (const role of ['admin', 'console', 'secretary', 'captain', 'patrol', 'manager']) {
    await insertUser(`u_${role}`, role);
  }
  await assert.rejects(insertUser('bad_role', 'owner'), /CHECK/);
  await assert.rejects(insertUser('bad_status', 'admin', 'pending'), /CHECK/);

  const insertReport = (status) =>
    db
      .prepare(
        `INSERT INTO reports (site_id, status, client_request_id, values_json, business_date, submitted_at)
         VALUES (1, ?, ?, '{}', '2026-11-09', '2026-11-09T00:00:00.000Z')`
      )
      .bind(status, `req-${status}-${Math.random()}`)
      .run();

  for (const status of ['awaiting_captain', 'pending', 'confirmed', 'rejected']) {
    await insertReport(status);
  }
  await assert.rejects(insertReport('junk'), /CHECK/);
  db.close();
});

test('0006 adds review columns and the captain corrections column', async () => {
  const db = createTestDb();
  const reportCols = (await db.prepare("SELECT name FROM pragma_table_info('reports')").all()).results.map((r) => r.name);
  for (const name of [
    'submitted_by',
    'reviewed_values_json',
    'review_corrections_json',
    'reviewed_by',
    'reviewed_at',
  ]) {
    assert.ok(reportCols.includes(name), `reports.${name}`);
  }
  const recordCols = (await db.prepare("SELECT name FROM pragma_table_info('records')").all()).results.map((r) => r.name);
  assert.ok(recordCols.includes('captain_corrections_json'));
  db.close();
});

test('0006 rebuild keeps existing reports and records, clears guard devices and keeps indexes', async () => {
  const db = createTestDb({
    migrations: ['0001_init.sql', '0002_seed.sql', '0003_value_model.sql', '0004_site_events.sql', '0005_console_review.sql'],
  });
  const values = { floor_above: { kind: 'spaces', value: 120 }, floor_below: { kind: 'full' } };
  await db
    .prepare("INSERT INTO guard_devices (id, label, token_hash) VALUES (7, 'A1', 'hash-7')")
    .run();
  await db
    .prepare(
      `INSERT INTO reports (id, site_id, device_id, status, client_request_id, values_json, raw_input,
                            business_date, submitted_at, confirmed_at, reject_reason)
       VALUES (42, 1, 7, 'confirmed', 'legacy-42', ?, 'raw', '2026-09-01', '2026-09-01T04:00:00.000Z',
               '2026-09-01T04:10:00.000Z', NULL)`
    )
    .bind(JSON.stringify(values))
    .run();
  await db
    .prepare(
      `INSERT INTO records (report_id, site_id, business_date, values_json, guard_report, console_report,
                            excel_values, tower_usage_pct, remarks_json, prepared_by, report_time, confirmed_at)
       VALUES (42, 1, '2026-09-01', ?, 'g', 'c', '', 86, '{}', 'console@example.test', '12:00', '2026-09-01T04:10:00.000Z')`
    )
    .bind(JSON.stringify(values))
    .run();

  db.applyMigration('0006_accounts_review.sql');

  const report = await db.prepare('SELECT * FROM reports WHERE id = 42').first();
  assert.equal(report.status, 'confirmed');
  assert.equal(report.client_request_id, 'legacy-42');
  assert.equal(report.device_id, 7);
  assert.deepEqual(JSON.parse(report.values_json), values);
  assert.equal(report.submitted_by, null);
  assert.equal(report.reviewed_values_json, null);

  const record = await db.prepare('SELECT * FROM records WHERE report_id = 42').first();
  assert.equal(record.values_json, JSON.stringify(values));
  assert.equal(record.captain_corrections_json, null);

  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM guard_devices').first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM reports').first()).n, 1);

  const indexes = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()).results.map((r) => r.name);
  assert.ok(indexes.includes('idx_reports_status'));
  assert.ok(indexes.includes('idx_records_date'));

  // UNIQUE(site_id, client_request_id) survived the rebuild.
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO reports (site_id, status, client_request_id, values_json, business_date, submitted_at)
         VALUES (1, 'pending', 'legacy-42', '{}', '2026-09-01', '2026-09-01T04:00:00.000Z')`
      )
      .run(),
    /UNIQUE/
  );

  // New reports keep auto-incrementing ids after the rebuild.
  const inserted = await db
    .prepare(
      `INSERT INTO reports (site_id, submitted_by, status, client_request_id, values_json, business_date, submitted_at)
       VALUES (1, 'patrol', 'awaiting_captain', 'new-1', '{}', '2026-11-09', '2026-11-09T00:00:00.000Z')`
    )
    .run();
  assert.equal(inserted.meta.last_row_id, 43);
  db.close();
});
