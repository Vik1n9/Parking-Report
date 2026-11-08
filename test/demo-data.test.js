import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.js';
import { getActiveZones } from '../src/routes/zones.js';
import { generateDemo } from '../scripts/demo-data.mjs';
import {
  businessDate,
  formatTime,
  buildReport,
  buildExcelValues,
  buildTowerUsage,
} from '../public/js/parking-core.js';

const NOW = new Date('2026-11-09T06:30:00Z'); // 2026-11-09 14:30 Asia/Taipei
const TODAY = '2026-11-09';
const CURRENT_HOUR = 14;
const TOWER_TOTAL = 1600;

const db = createTestDb();
const zones = await getActiveZones(db);
db.close();
const demo = generateDemo({ now: NOW, zones, towerTotal: TOWER_TOTAL, seed: 1 });
const reportsByClientId = new Map(demo.reports.map((report) => [report.client_request_id, report]));
const dates = [...new Set(demo.reports.map((report) => report.business_date))].sort();
const hourOf = (report) => Number(formatTime(report.submitted_at).slice(0, 2));

test('seven business dates end today and every submitted_at belongs to its date', () => {
  assert.deepEqual(dates, ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']);
  for (const report of demo.reports) {
    assert.equal(businessDate(report.submitted_at), report.business_date);
  }
});

test('one report per hour, today only up to the current Taipei hour', () => {
  const slots = new Map();
  for (const report of demo.reports) {
    const key = `${report.business_date}#${hourOf(report)}`;
    slots.set(key, (slots.get(key) ?? 0) + 1);
  }
  for (const date of dates.slice(0, -1)) {
    for (let hour = 0; hour < 24; hour++) assert.equal(slots.get(`${date}#${hour}`), 1, `${date} ${hour}`);
  }
  for (let hour = 0; hour < CURRENT_HOUR; hour++) {
    assert.equal(slots.get(`${TODAY}#${hour}`), 1, `${TODAY} ${hour}`);
  }
  assert.equal(slots.get(`${TODAY}#${CURRENT_HOUR}`), 2);
  assert.equal(demo.reports.filter((report) => report.business_date === TODAY).length, CURRENT_HOUR + 2);
});

test('every client_request_id is a unique demo id and device_id is null', () => {
  const ids = demo.reports.map((report) => report.client_request_id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.ok(id.startsWith('demo-'), id);
    assert.ok(id.length >= 8 && id.length <= 64, id);
  }
  assert.ok(demo.reports.every((report) => report.device_id === null));
});

test('the latest hour holds one awaiting_captain patrol report and one pending captain report', () => {
  const latest = demo.reports.filter(
    (report) => report.business_date === TODAY && hourOf(report) === CURRENT_HOUR
  );
  assert.deepEqual(latest.map((report) => report.status).sort(), ['awaiting_captain', 'pending']);
  assert.equal(latest.find((report) => report.status === 'awaiting_captain').submitted_by, 'patrol');
  assert.equal(latest.find((report) => report.status === 'pending').submitted_by, 'captain');
  assert.ok(latest.every((report) => report.confirmed_at === null && report.reviewed_at === null));

  assert.equal(demo.reports.filter((report) => report.status === 'awaiting_captain').length, 1);
  assert.equal(demo.reports.filter((report) => report.status === 'pending').length, 1);
  const others = demo.reports.filter((report) => !latest.includes(report));
  assert.ok(others.every((report) => report.status === 'confirmed'));
});

test('every confirmed report has exactly one record, and the latest hour none', () => {
  const confirmed = demo.reports.filter((report) => report.status === 'confirmed');
  const recordReportIds = demo.records.map((record) => record.report_client_request_id);
  assert.equal(demo.records.length, confirmed.length);
  assert.equal(new Set(recordReportIds).size, recordReportIds.length);
  for (const record of demo.records) assert.ok(reportsByClientId.has(record.report_client_request_id));
  const latestIds = demo.reports
    .filter((report) => report.business_date === TODAY && hourOf(report) === CURRENT_HOUR)
    .map((report) => report.client_request_id);
  for (const id of latestIds) assert.ok(!recordReportIds.includes(id));
});

test('patrol reports are reviewed by the captain; captain reports go straight to console', () => {
  for (const report of demo.reports.filter((item) => item.status === 'confirmed')) {
    if (report.submitted_by === 'patrol') {
      assert.equal(report.reviewed_by, 'captain');
      assert.ok(report.reviewed_at);
      assert.ok(report.reviewed_values_json);
      assert.ok(Date.parse(report.reviewed_at) > Date.parse(report.submitted_at));
    } else {
      assert.equal(report.submitted_by, 'captain');
      assert.equal(report.reviewed_by, null);
      assert.equal(report.reviewed_at, null);
      assert.equal(report.reviewed_values_json, null);
    }
  }
});

test('record snapshots match parking-core recomputation from the final values', () => {
  for (const record of demo.records) {
    const report = reportsByClientId.get(record.report_client_request_id);
    const values = JSON.parse(record.values_json);
    const at = new Date(report.submitted_at);
    const label = report.submitted_by === 'patrol' ? '車巡' : 'A1';

    assert.equal(record.guard_report, buildReport(values, zones, { style: 'guard', time: at }));
    assert.equal(
      record.console_report,
      buildReport(values, zones, { style: 'console', time: at, deviceLabel: label })
    );
    assert.equal(record.excel_values, buildExcelValues(values, zones).map((cell) => cell.value).join('\t'));

    const tower = buildTowerUsage(values, zones, { towerTotal: TOWER_TOTAL });
    assert.equal(record.tower_usage_pct, tower.valid ? tower.percent : null);
    assert.equal(record.tower_remaining, tower.valid ? tower.remaining : null);
    assert.equal(record.report_time, formatTime(at));
    assert.equal(record.business_date, report.business_date);
    assert.equal(record.prepared_by, 'console');
    assert.ok(Date.parse(record.confirmed_at) > Date.parse(report.submitted_at));
  }
});

test('tower remaining stays within the tower total', () => {
  assert.equal(demo.records.length, 158);
  for (const record of demo.records) {
    assert.ok(Number.isInteger(record.tower_remaining));
    assert.ok(record.tower_remaining >= 0 && record.tower_remaining <= TOWER_TOTAL);
    assert.ok(record.tower_usage_pct >= 0 && record.tower_usage_pct <= 100);
  }
});

test('corrections use zone codes and their original values differ from the final value', () => {
  const zoneCodes = new Set(zones.map((zone) => zone.code));
  let consoleCorrections = 0;
  let captainCorrections = 0;

  for (const record of demo.records) {
    const final = JSON.parse(record.values_json);
    const report = reportsByClientId.get(record.report_client_request_id);
    assert.equal(record.captain_corrections_json, report.review_corrections_json);

    for (const [code, original] of Object.entries(JSON.parse(record.corrections_json || '{}'))) {
      consoleCorrections++;
      assert.ok(zoneCodes.has(code), code);
      assert.notDeepEqual(original, final[code], code);
    }
    for (const [code, original] of Object.entries(JSON.parse(record.captain_corrections_json || '{}'))) {
      captainCorrections++;
      assert.ok(zoneCodes.has(code), code);
      assert.notDeepEqual(original, final[code], code);
    }
  }

  assert.ok(consoleCorrections >= 5, `console corrections: ${consoleCorrections}`);
  assert.ok(captainCorrections >= 5, `captain corrections: ${captainCorrections}`);
});

test('the same seed is deterministic and another seed differs', () => {
  const again = generateDemo({ now: NOW, zones, towerTotal: TOWER_TOTAL, seed: 1 });
  assert.deepEqual(again, demo);
  const other = generateDemo({ now: NOW, zones, towerTotal: TOWER_TOTAL, seed: 2 });
  assert.notDeepEqual(other, demo);
});

test('site events are demo-marked, 2-4 per day, with one special and tower guiding', () => {
  assert.ok(demo.events.every((event) => event.created_by === 'demo'));
  const byDate = new Map();
  for (const event of demo.events) {
    byDate.set(event.business_date, (byDate.get(event.business_date) ?? 0) + 1);
    assert.equal(businessDate(event.occurred_at), event.business_date);
    if (event.cleared_at) assert.ok(Date.parse(event.cleared_at) > Date.parse(event.occurred_at));
  }
  for (const date of dates) {
    const count = byDate.get(date) ?? 0;
    assert.ok(count >= 2 && count <= 4, `${date}: ${count}`);
  }
  assert.equal(demo.events.filter((event) => event.kind === 'special').length, 1);
  const towerCodes = new Set(zones.filter((zone) => zone.inTower).map((zone) => zone.code));
  assert.ok(
    demo.events.some((event) => event.kind === 'guiding' && towerCodes.has(event.zone_code))
  );
  assert.ok(demo.events.filter((event) => event.kind === 'jam').every((event) => event.zone_code === null));
});

test('timestamps never run past now, including a report submitted in the current hour', () => {
  const lateNow = new Date('2026-11-09T23:01:00Z'); // 2026-11-10 07:01 Asia/Taipei
  const nowMs = lateNow.getTime();

  for (const seed of [1, 2, 3, 7]) {
    const sample = generateDemo({ now: lateNow, zones, towerTotal: TOWER_TOTAL, seed });
    for (const report of sample.reports) {
      assert.ok(Date.parse(report.submitted_at) <= nowMs, `${seed} ${report.client_request_id} submitted_at`);
      if (report.reviewed_at) {
        assert.ok(Date.parse(report.reviewed_at) <= nowMs, `${seed} ${report.client_request_id} reviewed_at`);
      }
      if (report.confirmed_at) {
        assert.ok(Date.parse(report.confirmed_at) <= nowMs, `${seed} ${report.client_request_id} confirmed_at`);
      }
    }
    for (const record of sample.records) {
      assert.ok(Date.parse(record.confirmed_at) <= nowMs, `${seed} ${record.report_client_request_id} record`);
    }
    for (const event of sample.events) {
      assert.ok(Date.parse(event.occurred_at) <= nowMs, `${seed} ${event.business_date} ${event.kind}`);
      if (event.cleared_at) assert.ok(Date.parse(event.cleared_at) <= nowMs, `${seed} ${event.business_date} cleared`);
    }

    const todayReports = sample.reports.filter((report) => report.business_date === '2026-11-10');
    assert.equal(todayReports.length, 9); // 00:00-06:00 confirmed + 2 queue reports
    const queue = todayReports.filter((report) => report.status !== 'confirmed');
    assert.equal(queue.length, 2);
    assert.deepEqual(
      queue.map((report) => report.submitted_at),
      ['2026-11-09T23:01:00.000Z', '2026-11-09T23:01:00.000Z']
    );
  }
});

test('the generated rows insert into the migrated schema and feed the dashboard query', async () => {
  const mem = createTestDb();
  for (const row of demo.reports) {
    const columns = Object.keys(row);
    await mem
      .prepare(`INSERT INTO reports (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
      .bind(...columns.map((column) => row[column]))
      .run();
  }
  for (const row of demo.records) {
    const columns = Object.keys(row).filter((column) => column !== 'report_client_request_id');
    await mem
      .prepare(
        `INSERT INTO records (report_id, ${columns.join(', ')}) VALUES ((SELECT id FROM reports WHERE client_request_id = ?), ${columns.map(() => '?').join(', ')})`
      )
      .bind(row.report_client_request_id, ...columns.map((column) => row[column]))
      .run();
  }
  for (const row of demo.events) {
    const columns = Object.keys(row);
    await mem
      .prepare(`INSERT INTO site_events (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
      .bind(...columns.map((column) => row[column]))
      .run();
  }

  const counts = await mem
    .prepare(
      `SELECT (SELECT COUNT(*) FROM reports) AS reports,
              (SELECT COUNT(*) FROM records) AS records,
              (SELECT COUNT(*) FROM site_events) AS events`
    )
    .first();
  assert.deepEqual(counts, { reports: demo.reports.length, records: demo.records.length, events: demo.events.length });

  const rows = await mem
    .prepare(
      'SELECT report_time, values_json, tower_usage_pct FROM records WHERE business_date = ? ORDER BY report_time, id'
    )
    .bind(TODAY)
    .all();
  assert.equal(rows.results.length, CURRENT_HOUR);
  for (const row of rows.results) {
    assert.match(row.report_time, /^\d{2}:\d{2}$/);
    assert.doesNotThrow(() => JSON.parse(row.values_json));
    assert.ok(Number.isInteger(row.tower_usage_pct));
  }
  mem.close();
});
