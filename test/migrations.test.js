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
