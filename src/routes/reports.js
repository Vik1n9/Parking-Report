import { json } from '../lib/http.js';
import { getActiveZones, getSite } from './zones.js';
import { buildReport, buildExcelValues, buildTowerUsage, validateValue, normalizeInput, formatTime, businessDate } from '../../public/js/parking-core.js';
import { mapRecord } from './records.js';

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function fillValues(raw, zones) {
  const out = {};
  for (const zone of zones) {
    const value = raw?.[zone.code];
    out[zone.code] = value && typeof value === 'object' ? value : { kind: 'none' };
  }
  return out;
}

function sameValue(a, b) {
  return a.kind === b.kind && a.value === b.value;
}

function normalizeValue(raw, zone) {
  if (!raw || typeof raw !== 'object' || typeof raw.kind !== 'string') return { kind: 'none' };
  return normalizeInput(raw, zone);
}

function parseDisplayBefore(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!Number.isInteger(raw) || raw < 0 || raw > 9999) {
    return { ok: false, error: 'display_before 必須是 0-9999 的整數' };
  }
  return { ok: true, value: raw };
}

export function shapeReport(row) {
  return {
    id: row.id,
    status: row.status,
    businessDate: row.business_date,
    submittedAt: row.submitted_at,
    deviceLabel: row.device_label ?? null,
    clientRequestId: row.client_request_id,
    supersedesReportId: row.supersedes_report_id ?? null,
    rejectReason: row.reject_reason ?? null,
    values: JSON.parse(row.values_json || '{}'),
  };
}

function resolveSubmittedAt(raw, now) {
  if (typeof raw !== 'string') return now.toISOString();
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return now.toISOString();
  const min = now.getTime() - 24 * 60 * 60 * 1000;
  const max = now.getTime() + 2 * 60 * 1000;
  return new Date(Math.min(Math.max(parsed, min), max)).toISOString();
}

export async function createReport(env, request, device) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '請求主體必須是 JSON' }, 400);
  }

  const clientRequestId = String(body?.client_request_id ?? '');
  if (!CLIENT_ID_RE.test(clientRequestId)) {
    return json({ error: 'client_request_id 必須為 8-64 碼英數字或 -_ ' }, 400);
  }

  const input = body?.values;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'values 必須是 { 區域code: {kind, value} } 的物件' }, 400);
  }

  const zones = await getActiveZones(env.DB);
  const byCode = new Map(zones.map((z) => [z.code, z]));
  for (const [code, value] of Object.entries(input)) {
    const zone = byCode.get(code);
    if (!zone) return json({ error: `未知區域: ${code}` }, 400);
    const check = validateValue(value, zone);
    if (!check.ok) return json({ error: `區域 ${code}: ${check.error}` }, 400);
  }
  const values = fillValues(input, zones);

  const rawInput = typeof body.raw_input === 'string' ? body.raw_input.slice(0, 2000) : null;
  const supersedes = Number.isInteger(body.supersedes_report_id) ? body.supersedes_report_id : null;
  const now = new Date();
  const submittedAt = resolveSubmittedAt(body?.client_submitted_at, now);
  const bDate = businessDate(new Date(submittedAt));

  const dup = await env.DB
    .prepare('SELECT * FROM reports WHERE site_id = 1 AND client_request_id = ?')
    .bind(clientRequestId)
    .first();
  if (dup) {
    return json({ report: shapeReport(dup), duplicate: true }, 200);
  }

  const insert = await env.DB
    .prepare(
      `INSERT INTO reports (site_id, device_id, status, client_request_id, values_json, raw_input, business_date, submitted_at, supersedes_report_id)
       VALUES (1, ?, 'pending', ?, ?, ?, ?, ?, ?)`
    )
    .bind(device.deviceId, clientRequestId, JSON.stringify(values), rawInput, bDate, submittedAt, supersedes)
    .run();

  const row = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(insert.meta.last_row_id).first();
  return json({ report: shapeReport(row), duplicate: false }, 201);
}

export async function listReports(env, url) {
  const status = url.searchParams.get('status') || 'pending';
  if (!['pending', 'confirmed', 'rejected'].includes(status)) {
    return json({ error: 'status 僅接受 pending/confirmed/rejected' }, 400);
  }
  const { results } = await env.DB
    .prepare(
      `SELECT r.*, d.label AS device_label
       FROM reports r LEFT JOIN guard_devices d ON d.id = r.device_id
       WHERE r.site_id = 1 AND r.status = ?
       ORDER BY r.submitted_at ASC
       LIMIT 100`
    )
    .bind(status)
    .all();
  return json({ status, reports: results.map((row) => shapeReport(row)) });
}

async function loadReport(env, id) {
  return env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
}

export async function confirmReport(env, id, request, identity) {
  const report = await loadReport(env, id);
  if (!report) return json({ error: '找不到回報單' }, 404);

  if (report.status === 'confirmed') {
    const row = await env.DB.prepare('SELECT * FROM records WHERE report_id = ?').bind(id).first();
    return json({ record: mapRecord(row), alreadyConfirmed: true }, 200);
  }
  if (report.status === 'rejected') {
    return json({ error: '已退回的回報單不能確認' }, 409);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  const remarks = typeof body.remarks === 'object' && !Array.isArray(body.remarks) ? body.remarks : null;

  const zones = await getActiveZones(env.DB);
  const byCode = new Map(zones.map((z) => [z.code, z]));

  const input = body.values;
  if (input !== undefined && input !== null && (typeof input !== 'object' || Array.isArray(input))) {
    return json({ error: 'values 必須是 { 區域code: {kind, value} } 的物件' }, 400);
  }
  const correctionsInput = input == null ? {} : input;
  for (const [code, value] of Object.entries(correctionsInput)) {
    const zone = byCode.get(code);
    if (!zone) return json({ error: `未知區域: ${code}` }, 400);
    const check = validateValue(value, zone);
    if (!check.ok) return json({ error: `區域 ${code}: ${check.error}` }, 400);
  }

  const display = parseDisplayBefore(body.display_before);
  if (!display.ok) return json({ error: display.error }, 400);

  const site = (await getSite(env.DB)) || { tower_total: 1600 };
  const guardValues = fillValues(JSON.parse(report.values_json || '{}'), zones);
  const finalValues = { ...guardValues };
  const corrections = {};
  for (const [code, value] of Object.entries(correctionsInput)) {
    const zone = byCode.get(code);
    const original = normalizeValue(guardValues[code], zone);
    finalValues[code] = normalizeValue(value, zone);
    if (!sameValue(finalValues[code], original)) corrections[code] = original;
  }
  const correctionsJson = Object.keys(corrections).length ? JSON.stringify(corrections) : null;

  const reportTime = new Date(report.submitted_at);
  const device = await env.DB
    .prepare('SELECT label FROM guard_devices WHERE id = ?')
    .bind(report.device_id)
    .first();
  const deviceLabel = device?.label ?? null;

  const tower = buildTowerUsage(finalValues, zones, { towerTotal: site.tower_total });
  const confirmedAt = new Date().toISOString();

  const insertRecord = env.DB
    .prepare(
      `INSERT INTO records
        (report_id, site_id, business_date, values_json, guard_report, console_report, excel_values,
         tower_usage_pct, tower_remaining, corrections_json, display_before, remarks_json, prepared_by, report_time, confirmed_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      report.id,
      report.business_date,
      JSON.stringify(finalValues),
      buildReport(finalValues, zones, { style: 'guard', time: reportTime }),
      buildReport(finalValues, zones, { style: 'console', time: reportTime, deviceLabel }),
      buildExcelValues(finalValues, zones).map((cell) => cell.value).join('\t'),
      tower.valid ? tower.percent : null,
      tower.valid ? tower.remaining : null,
      correctionsJson,
      display.value,
      remarks ? JSON.stringify(remarks) : null,
      identity.email,
      formatTime(reportTime),
      confirmedAt
    );
  const updateReport = env.DB
    .prepare("UPDATE reports SET status = 'confirmed', confirmed_at = ? WHERE id = ? AND status = 'pending'")
    .bind(confirmedAt, report.id);

  await env.DB.batch([insertRecord, updateReport]);

  const row = await env.DB.prepare('SELECT * FROM records WHERE report_id = ?').bind(report.id).first();
  return json({ record: mapRecord(row) }, 201);
}

export async function rejectReport(env, id, request) {
  const report = await loadReport(env, id);
  if (!report) return json({ error: '找不到回報單' }, 404);
  if (report.status === 'confirmed') {
    return json({ error: '已確認的回報單不能退回' }, 409);
  }
  if (report.status === 'rejected') {
    return json({ report: shapeReport(report) }, 200);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 200) : null;

  await env.DB
    .prepare("UPDATE reports SET status = 'rejected', reject_reason = ? WHERE id = ? AND status = 'pending'")
    .bind(reason, id)
    .run();

  const updated = await loadReport(env, id);
  return json({ report: shapeReport(updated) }, 200);
}
