#!/usr/bin/env node
// 示範資料 CLI：npm run demo:seed -- --local|--remote [--days 7] [--seed 1]
//                npm run demo:clear -- --local|--remote
// 只動 client_request_id LIKE 'demo-%' 的回報與 created_by='demo' 的現場事件。
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDemo } from './demo-data.mjs';

const CLEAR_STATEMENTS = [
  "DELETE FROM records WHERE report_id IN (SELECT id FROM reports WHERE client_request_id LIKE 'demo-%');",
  "DELETE FROM reports WHERE client_request_id LIKE 'demo-%';",
  "DELETE FROM site_events WHERE created_by = 'demo';",
];

const COUNT_QUERY = `SELECT
  (SELECT COUNT(*) FROM reports WHERE client_request_id LIKE 'demo-%') AS reports,
  (SELECT COUNT(*) FROM records WHERE report_id IN (SELECT id FROM reports WHERE client_request_id LIKE 'demo-%')) AS records,
  (SELECT COUNT(*) FROM site_events WHERE created_by = 'demo') AS events;`;

const ZONES_QUERY =
  'SELECT code, label, excel_label, position, unit, in_tower FROM zones WHERE active = 1 AND site_id = 1 ORDER BY position;';
const SITE_QUERY = 'SELECT tower_total FROM sites WHERE id = 1;';

const REPORT_COLUMNS = [
  'site_id',
  'device_id',
  'status',
  'client_request_id',
  'values_json',
  'raw_input',
  'business_date',
  'submitted_at',
  'confirmed_at',
  'submitted_by',
  'reviewed_values_json',
  'review_corrections_json',
  'reviewed_by',
  'reviewed_at',
];

const RECORD_COLUMNS = [
  'site_id',
  'business_date',
  'values_json',
  'guard_report',
  'console_report',
  'excel_values',
  'tower_usage_pct',
  'tower_remaining',
  'corrections_json',
  'captain_corrections_json',
  'display_before',
  'remarks_json',
  'prepared_by',
  'report_time',
  'confirmed_at',
];

const EVENT_COLUMNS = [
  'site_id',
  'business_date',
  'kind',
  'zone_code',
  'occurred_at',
  'cleared_at',
  'detail',
  'created_by',
];

function sqlStr(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return sqlStr(value);
}

function wranglerJson(flag, command) {
  const output = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'parking-report', flag, '--json', '--command', command],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, CI: 'true' } }
  );
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('wrangler 沒有回傳 JSON');
  const parsed = JSON.parse(output.slice(start, end + 1));
  const first = Array.isArray(parsed) ? parsed.find((item) => item && Array.isArray(item.results)) : parsed;
  return first?.results ?? [];
}

function wranglerRun(flag, args) {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'parking-report', flag, '--yes', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, CI: 'true' } }
  );
}

function runClear(flag) {
  const counts = wranglerJson(flag, COUNT_QUERY)[0] ?? { reports: 0, records: 0, events: 0 };
  for (const statement of CLEAR_STATEMENTS) wranglerRun(flag, ['--command', statement]);
  return counts;
}

function buildSql({ reports, records, events }) {
  const lines = [];
  for (const row of reports) {
    lines.push(
      `INSERT INTO reports (${REPORT_COLUMNS.join(', ')}) VALUES (${REPORT_COLUMNS.map((column) => sqlValue(row[column])).join(', ')});`
    );
  }
  for (const row of records) {
    const values = RECORD_COLUMNS.map((column) => sqlValue(row[column])).join(', ');
    lines.push(
      `INSERT INTO records (report_id, ${RECORD_COLUMNS.join(', ')}) VALUES ((SELECT id FROM reports WHERE client_request_id = ${sqlStr(row.report_client_request_id)}), ${values});`
    );
  }
  for (const row of events) {
    lines.push(
      `INSERT INTO site_events (${EVENT_COLUMNS.join(', ')}) VALUES (${EVENT_COLUMNS.map((column) => sqlValue(row[column])).join(', ')});`
    );
  }
  return `${lines.join('\n')}\n`;
}

function readInt(argv, name, fallback) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  const index = argv.indexOf(name);
  const raw = inline ? inline.slice(name.length + 1) : index >= 0 ? argv[index + 1] : undefined;
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  return Number(raw);
}

const argv = process.argv.slice(2);
const local = argv.includes('--local');
const remote = argv.includes('--remote');
const clear = argv.includes('--clear');

if (local === remote) {
  console.error('用法: npm run demo:seed -- --local|--remote [--days 7] [--seed 1]');
  console.error('      npm run demo:clear -- --local|--remote');
  process.exit(1);
}

const flag = local ? '--local' : '--remote';
const target = local ? 'local' : 'remote';

if (clear) {
  const counts = runClear(flag);
  console.log(`demo clear (${target}): reports ${counts.reports}, records ${counts.records}, events ${counts.events}`);
  process.exit(0);
}

const days = readInt(argv, '--days', 7);
const seed = readInt(argv, '--seed', 1);

const zoneRows = wranglerJson(flag, ZONES_QUERY);
const zones = zoneRows.map((zone) => ({
  code: zone.code,
  label: zone.label,
  excelLabel: zone.excel_label,
  position: zone.position,
  unit: zone.unit,
  inTower: !!zone.in_tower,
}));
const towerTotal = wranglerJson(flag, SITE_QUERY)[0]?.tower_total ?? 0;

runClear(flag);

const { reports, records, events } = generateDemo({ now: new Date(), zones, towerTotal, days, seed });
const sqlPath = join(tmpdir(), `parking-demo-seed-${process.pid}.sql`);
try {
  writeFileSync(sqlPath, buildSql({ reports, records, events }));
  wranglerRun(flag, ['--file', sqlPath]);
} finally {
  rmSync(sqlPath, { force: true });
}

console.log(`demo seed (${target}): reports ${reports.length}, records ${records.length}, events ${events.length}`);
