#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  businessDate,
  buildReport,
  buildExcelValues,
  buildTowerUsage,
  formatTime,
} from '../public/js/parking-core.js';

const HOST = 'http://127.0.0.1:8787';
const TOKEN = 'preview-A1-not-a-secret';
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');
const seedOnly = process.argv.includes('--seed-only');
const noOpen = process.argv.includes('--no-open');

const ZONES = [
  { code: 'floor_above', label: '車塔1上', unit: 'spaces', inTower: true },
  { code: 'floor_below', label: '車塔1下', unit: 'spaces', inTower: true },
  { code: 'p1', label: 'P1', unit: 'tenths', inTower: false },
  { code: 'p3', label: 'P3', unit: 'tenths', inTower: false },
  { code: 'spin_a', label: 'A區', unit: 'tenths', inTower: false },
  { code: 'spin_b', label: 'B區', unit: 'tenths', inTower: false },
  { code: 'spin_c', label: 'C區', unit: 'tenths', inTower: false },
  { code: 'spin_d', label: 'D區', unit: 'tenths', inTower: false },
  { code: 'spin_e', label: 'E區', unit: 'tenths', inTower: false },
  { code: 'asphalt', label: '柏油路', unit: 'tenths', inTower: false },
];

function sqlStr(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return sqlStr(JSON.stringify(value));
}

function fill(partial) {
  const values = {};
  for (const zone of ZONES) {
    values[zone.code] = partial[zone.code] ?? { kind: 'none' };
  }
  return values;
}

function taipeiInstant(dateStr, hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  return new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`);
}

function shiftCivil(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + delta));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function snapshot(partial, at, deviceLabel) {
  const values = fill(partial);
  const tower = buildTowerUsage(values, ZONES, { towerTotal: 1600 });
  return {
    values,
    guard: buildReport(values, ZONES, { style: 'guard', time: at }),
    console: buildReport(values, ZONES, { style: 'console', time: at, deviceLabel }),
    excel: buildExcelValues(values, ZONES).map((cell) => cell.value).join('\t'),
    towerPct: tower.valid ? tower.percent : null,
    reportTime: formatTime(at),
  };
}

const SCENES = {
  open: {
    floor_above: { kind: 'spaces', value: 420 },
    floor_below: { kind: 'spaces', value: 180 },
    p1: { kind: 'tenths', value: 8 },
    p3: { kind: 'tenths', value: 7 },
    spin_a: { kind: 'tenths', value: 6 },
    asphalt: { kind: 'none' },
  },
  busy: {
    floor_above: { kind: 'spaces', value: 232 },
    floor_below: { kind: 'full' },
    p1: { kind: 'tenths', value: 3 },
    p3: { kind: 'tenths', value: 2 },
    spin_a: { kind: 'tenths', value: 1 },
    spin_b: { kind: 'carts', value: 2 },
    spin_c: { kind: 'guiding' },
    spin_d: { kind: 'none' },
    spin_e: { kind: 'none' },
    asphalt: { kind: 'none' },
  },
  tight: {
    floor_above: { kind: 'spaces', value: 40 },
    floor_below: { kind: 'full' },
    p1: { kind: 'full' },
    p3: { kind: 'tenths', value: 1 },
    spin_a: { kind: 'full' },
    spin_b: { kind: 'carts', value: 4 },
    spin_c: { kind: 'guiding' },
    asphalt: { kind: 'none' },
  },
};

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

async function waitReady() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${HOST}/api/zones`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${HOST}`);
}

function ensureDevVars() {
  if (existsSync('.dev.vars')) return;
  if (existsSync('.dev.vars.example')) copyFileSync('.dev.vars.example', '.dev.vars');
  else writeFileSync('.dev.vars', 'DEV_MODE=1\n');
}

function buildSql() {
  const today = businessDate(new Date());
  const d1 = shiftCivil(today, -1);
  const d2 = shiftCivil(today, -2);
  const d3 = shiftCivil(today, -3);
  const rows = [
    { id: 1, date: d3, clock: '09:20', scene: 'open', status: 'confirmed' },
    { id: 2, date: d3, clock: '14:05', scene: 'busy', status: 'confirmed' },
    { id: 3, date: d2, clock: '10:40', scene: 'busy', status: 'confirmed' },
    { id: 4, date: d2, clock: '15:18', scene: 'tight', status: 'confirmed' },
    { id: 5, date: d1, clock: '11:02', scene: 'busy', status: 'confirmed' },
    { id: 6, date: d1, clock: '16:44', scene: 'tight', status: 'confirmed' },
    { id: 7, date: today, clock: '09:15', scene: 'open', status: 'confirmed' },
    { id: 8, date: today, clock: '12:37', scene: 'busy', status: 'confirmed' },
    { id: 9, date: today, clock: '15:50', scene: 'tight', status: 'pending' },
    { id: 10, date: today, clock: '16:10', scene: 'busy', status: 'pending' },
  ];

  const statements = [
    'DELETE FROM records;',
    'DELETE FROM reports;',
    'DELETE FROM guard_devices;',
    'DELETE FROM site_events;',
    `INSERT INTO guard_devices (id, label, token_hash) VALUES (1, 'A1', ${sqlStr(TOKEN_HASH)});`,
    `INSERT INTO site_events (site_id, business_date, kind, zone_code, occurred_at, cleared_at, detail, created_by)
     VALUES (1, ${sqlStr(today)}, 'guiding', NULL, ${sqlStr(taipeiInstant(today, '12:37').toISOString())}, NULL, NULL, 'console@example.test');`,
    `INSERT INTO site_events (site_id, business_date, kind, zone_code, occurred_at, cleared_at, detail, created_by)
     VALUES (1, ${sqlStr(today)}, 'jam', 'p1', ${sqlStr(taipeiInstant(today, '12:52').toISOString())}, ${sqlStr(taipeiInstant(today, '13:10').toISOString())}, NULL, 'console@example.test');`,
  ];

  for (const row of rows) {
    const at = taipeiInstant(row.date, row.clock);
    const snap = snapshot(SCENES[row.scene], at, 'A1');
    const submitted = at.toISOString();
    statements.push(
      `INSERT INTO reports (id, site_id, device_id, status, client_request_id, values_json, raw_input, business_date, submitted_at, confirmed_at)
       VALUES (${row.id}, 1, 1, ${sqlStr(row.status)}, ${sqlStr(`preview-${row.id}`)}, ${sqlJson(snap.values)}, ${sqlStr('preview')}, ${sqlStr(row.date)}, ${sqlStr(submitted)}, ${row.status === 'confirmed' ? sqlStr(submitted) : 'NULL'});`,
    );
    if (row.status === 'confirmed') {
      statements.push(
        `INSERT INTO records (report_id, site_id, business_date, values_json, guard_report, console_report, excel_values, tower_usage_pct, remarks_json, prepared_by, report_time, confirmed_at)
         VALUES (${row.id}, 1, ${sqlStr(row.date)}, ${sqlJson(snap.values)}, ${sqlStr(snap.guard)}, ${sqlStr(snap.console)}, ${sqlStr(snap.excel)}, ${snap.towerPct ?? 'NULL'}, ${sqlJson(row.scene === 'busy' ? { p1: '施工' } : {})}, 'console@example.test', ${sqlStr(snap.reportTime)}, ${sqlStr(submitted)});`,
      );
    }
  }
  return { sql: statements.join('\n'), today, d1, d3 };
}

ensureDevVars();
await run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'parking-report', '--local'], { CI: 'true' });

const { sql, today, d1, d3 } = buildSql();
const sqlPath = join(tmpdir(), 'parking-preview-seed.sql');
writeFileSync(sqlPath, sql);
await run('npx', ['wrangler', 'd1', 'execute', 'parking-report', '--local', '--yes', '--file', sqlPath]);

console.log('');
console.log(`${HOST}/ManagerDashboard`);
console.log(`${HOST}/CenterConsole`);
console.log(`${HOST}/secretary`);
console.log(`${HOST}/guard#key=${TOKEN}`);
console.log(`confirmed ${d3}..${today} · pending 2 · device A1`);
console.log('');

if (seedOnly) process.exit(0);

const wrangler = spawn('npx', ['wrangler', 'dev', '--port', '8787'], { stdio: 'inherit' });
wrangler.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => wrangler.kill('SIGINT'));
process.on('SIGTERM', () => wrangler.kill('SIGTERM'));

await waitReady();
if (!noOpen) {
  spawn('open', [
    `${HOST}/ManagerDashboard`,
    `${HOST}/CenterConsole`,
    `${HOST}/secretary`,
  ]);
}
