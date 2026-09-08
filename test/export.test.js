import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createTestDb } from './helpers/d1.js';
import { exportRecords } from '../src/export/xlsx.js';

async function dbWithRecord() {
  const db = createTestDb();
  const values = {
    floor_above: { kind: 'spaces', value: 232 },
    floor_below: { kind: 'full' },
    p1: { kind: 'tenths', value: 3 },
    spin_b: { kind: 'carts', value: 2 },
    spin_c: { kind: 'guiding' },
    asphalt: { kind: 'none' },
  };
  await db
    .prepare(
      `INSERT INTO reports (id, site_id, status, client_request_id, values_json, business_date, submitted_at)
       VALUES (1, 1, 'confirmed', 'req-00000001', ?, '2026-09-09', '2026-09-09T04:37:00.000Z')`
    )
    .bind(JSON.stringify(values))
    .run();
  await db
    .prepare(
      `INSERT INTO records (report_id, site_id, business_date, values_json, guard_report, console_report,
                            excel_values, tower_usage_pct, remarks_json, prepared_by, report_time, confirmed_at)
       VALUES (1, 1, '2026-09-09', ?, 'g', 'c', '', 86, ?, '測試員', '12:37', '2026-09-09T04:40:00.000Z')`
    )
    .bind(JSON.stringify(values), JSON.stringify({ p1: '施工' }))
    .run();
  return db;
}

test('export writes the template layout with the new value wordings', async () => {
  const db = await dbWithRecord();
  const result = await exportRecords({ DB: db }, new URL('https://example.test/api/records/export?from=2026-09-09&to=2026-09-09'));
  assert.ok(!result.error);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(result.body);
  const sheet = wb.getWorksheet('9月');
  assert.ok(sheet, 'a sheet per month');

  const headerRow = sheet.getRow(2);
  assert.equal(headerRow.getCell(3).value, '1F↑');
  assert.equal(headerRow.getCell(7).value, '紡織-A');

  const dataRow = sheet.getRow(3);
  assert.equal(dataRow.getCell(2).value, '剩餘車位數');
  assert.equal(dataRow.getCell(3).value, 232);
  assert.equal(dataRow.getCell(4).value, '滿');
  assert.equal(dataRow.getCell(5).value, 3);
  assert.equal(dataRow.getCell(5).numFmt, '0"成"');
  assert.equal(dataRow.getCell(8).value, '停2台');
  assert.equal(dataRow.getCell(9).value, '引導中');
  assert.equal(dataRow.getCell(12).value, '未停車');

  const remarkRow = sheet.getRow(4);
  assert.equal(remarkRow.getCell(2).value, '備註');
  assert.equal(remarkRow.getCell(5).value, '施工');
  assert.equal(remarkRow.getCell(3).value, null, 'remarks stay empty where none were entered');
  db.close();
});

test('export rejects a malformed date range', async () => {
  const db = await dbWithRecord();
  const result = await exportRecords({ DB: db }, new URL('https://example.test/api/records/export?from=2026-9-9&to=2026-09-09'));
  assert.equal(result.status, 400);
  db.close();
});
