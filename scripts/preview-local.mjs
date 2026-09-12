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

function towerSpaces(n) {
  return n <= 0 ? { kind: 'full' } : { kind: 'spaces', value: n };
}

function sceneAt(above, below, extra = {}) {
  const { floor_above: _a, floor_below: _b, ...rest } = extra;
  return {
    floor_above: towerSpaces(above),
    floor_below: towerSpaces(below),
    ...rest,
  };
}

const SCENES = {
  open: sceneAt(420, 180, {
    p1: { kind: 'tenths', value: 8 },
    p3: { kind: 'tenths', value: 7 },
    spin_a: { kind: 'tenths', value: 6 },
    asphalt: { kind: 'none' },
  }),
  busy: sceneAt(232, 0, {
    p1: { kind: 'tenths', value: 3 },
    p3: { kind: 'tenths', value: 2 },
    spin_a: { kind: 'tenths', value: 1 },
    spin_b: { kind: 'carts', value: 2 },
    spin_c: { kind: 'guiding' },
    asphalt: { kind: 'none' },
  }),
  tight: sceneAt(40, 0, {
    p1: { kind: 'full' },
    p3: { kind: 'tenths', value: 1 },
    spin_a: { kind: 'full' },
    spin_b: { kind: 'carts', value: 4 },
    spin_c: { kind: 'guiding' },
    asphalt: { kind: 'none' },
  }),
};

const TODAY_EVENTS = [
  { kind: 'jam', zone: 'p1', start: '09:12', end: '09:28' },
  { kind: 'special', zone: 'asphalt', start: '10:05', end: '10:42', detail: '施工' },
  { kind: 'jam', zone: 'p3', start: '11:18', end: '11:36' },
  { kind: 'jam', zone: 'spin_a', start: '11:50', end: '12:14' },
  { kind: 'guiding', start: '12:37' },
  { kind: 'jam', zone: 'p1', start: '12:52', end: '13:10' },
  { kind: 'special', zone: 'p3', start: '13:18', end: '13:55', detail: '車禍' },
  { kind: 'jam', zone: 'spin_b', start: '14:08', end: '14:31' },
  { kind: 'special', start: '14:22', end: '14:48', detail: '閘門' },
  { kind: 'jam', zone: 'p1', start: '14:50', end: '15:12' },
  { kind: 'special', zone: 'spin_c', start: '15:20', end: '15:44', detail: '車禍' },
  { kind: 'jam', zone: 'p3', start: '15:38' },
  { kind: 'special', zone: 'asphalt', start: '16:06', detail: '路樹' },
];

const TODAY_CURVE = [
  ['08:40', 720, 380],
  ['09:05', 610, 310],
  ['09:25', 520, 240],
  ['09:50', 450, 180],
  ['10:15', 390, 130],
  ['10:40', 340, 90],
  ['11:05', 300, 50],
  ['11:30', 270, 20],
  ['11:55', 250, 0],
  ['12:20', 220, 0],
  ['12:45', 180, 0],
  ['13:10', 140, 0],
  ['13:35', 95, 0],
  ['14:00', 60, 0],
  ['14:25', 35, 0],
  ['14:50', 20, 0],
  ['15:15', 45, 0],
  ['15:40', 80, 0],
  ['16:05', 130, 15],
  ['16:30', 190, 40],
];

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
    { id: 1, date: d3, clock: '09:20', scene: SCENES.open, status: 'confirmed' },
    { id: 2, date: d3, clock: '11:10', scene: SCENES.busy, status: 'confirmed' },
    { id: 3, date: d3, clock: '14:05', scene: SCENES.tight, status: 'confirmed' },
    { id: 4, date: d3, clock: '16:20', scene: SCENES.busy, status: 'confirmed' },
    { id: 5, date: d2, clock: '09:40', scene: SCENES.open, status: 'confirmed' },
    { id: 6, date: d2, clock: '12:15', scene: SCENES.busy, status: 'confirmed' },
    { id: 7, date: d2, clock: '15:18', scene: SCENES.tight, status: 'confirmed' },
    { id: 8, date: d2, clock: '17:05', scene: SCENES.busy, status: 'confirmed' },
    { id: 9, date: d1, clock: '10:02', scene: SCENES.open, status: 'confirmed' },
    { id: 10, date: d1, clock: '12:40', scene: SCENES.busy, status: 'confirmed' },
    { id: 11, date: d1, clock: '14:55', scene: SCENES.tight, status: 'confirmed' },
    { id: 12, date: d1, clock: '16:44', scene: SCENES.busy, status: 'confirmed' },
  ];
  TODAY_CURVE.forEach(([clock, above, below], index) => {
    rows.push({
      id: 20 + index,
      date: today,
      clock,
      scene: sceneAt(above, below, index >= 11 ? SCENES.tight : index >= 7 ? SCENES.busy : SCENES.open),
      status: 'confirmed',
    });
  });
  rows.push(
    { id: 50, date: today, clock: '16:50', scene: SCENES.tight, status: 'pending' },
    { id: 51, date: today, clock: '17:05', scene: SCENES.busy, status: 'pending' },
  );

  const statements = [
    'DELETE FROM records;',
    'DELETE FROM reports;',
    'DELETE FROM guard_devices;',
    'DELETE FROM site_events;',
    `INSERT INTO guard_devices (id, label, token_hash) VALUES (1, 'A1', ${sqlStr(TOKEN_HASH)});`,
    ...TODAY_EVENTS.map((event) => {
      const zone = event.zone == null ? 'NULL' : sqlStr(event.zone);
      const occurred = sqlStr(taipeiInstant(today, event.start).toISOString());
      const cleared = event.end ? sqlStr(taipeiInstant(today, event.end).toISOString()) : 'NULL';
      const detail = event.detail == null ? 'NULL' : sqlStr(event.detail);
      return `INSERT INTO site_events (site_id, business_date, kind, zone_code, occurred_at, cleared_at, detail, created_by)
     VALUES (1, ${sqlStr(today)}, ${sqlStr(event.kind)}, ${zone}, ${occurred}, ${cleared}, ${detail}, 'console@example.test');`;
    }),
  ];

  for (const row of rows) {
    const at = taipeiInstant(row.date, row.clock);
    const snap = snapshot(row.scene, at, 'A1');
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
console.log(`confirmed ${d3}..${today} · pending 2 · events ${TODAY_EVENTS.length} · device A1`);
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
