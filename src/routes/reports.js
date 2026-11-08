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

/** 中控與隊長共用：values 必須是 { 區域code: {kind, value} }，逐一驗證後才寫入。 */
function parseCorrections(input, byCode) {
  if (input !== undefined && input !== null && (typeof input !== 'object' || Array.isArray(input))) {
    return { error: 'values 必須是 { 區域code: {kind, value} } 的物件' };
  }
  const correctionsInput = input == null ? {} : input;
  for (const [code, value] of Object.entries(correctionsInput)) {
    const zone = byCode.get(code);
    if (!zone) return { error: `未知區域: ${code}` };
    const check = validateValue(value, zone);
    if (!check.ok) return { error: `區域 ${code}: ${check.error}` };
  }
  return { correctionsInput };
}

/** 把修正疊上基準值，回傳最終值與「相對基準」的修正（只記真的變動的區域）。 */
function applyCorrections(baseValues, correctionsInput, byCode) {
  const finalValues = { ...baseValues };
  const corrections = {};
  for (const [code, value] of Object.entries(correctionsInput)) {
    const zone = byCode.get(code);
    const original = normalizeValue(baseValues[code], zone);
    finalValues[code] = normalizeValue(value, zone);
    if (!sameValue(finalValues[code], original)) corrections[code] = original;
  }
  return { finalValues, corrections };
}

function parseDisplayBefore(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!Number.isInteger(raw) || raw < 0 || raw > 9999) {
    return { ok: false, error: 'display_before 必須是 0-9999 的整數' };
  }
  return { ok: true, value: raw };
}

export function shapeReport(row) {
  const submittedValues = JSON.parse(row.values_json || '{}');
  return {
    id: row.id,
    status: row.status,
    businessDate: row.business_date,
    submittedAt: row.submitted_at,
    deviceLabel: row.device_label ?? null,
    clientRequestId: row.client_request_id,
    supersedesReportId: row.supersedes_report_id ?? null,
    rejectReason: row.reject_reason ?? null,
    // 對外顯示的 values 是「目前有效值」：隊長複核過就用複核結果，否則用上傳原值。
    values: row.reviewed_values_json ? JSON.parse(row.reviewed_values_json) : submittedValues,
    submittedValues,
    submittedBy: row.submitted_by ?? null,
    reviewCorrections: JSON.parse(row.review_corrections_json || '{}'),
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
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

export async function createReport(env, request, user) {
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

  // 車巡上傳後等隊長複核；隊長（適應期直送中控）與其他可上傳角色直接進 pending。
  const status = user.role === 'patrol' ? 'awaiting_captain' : 'pending';
  const insert = await env.DB
    .prepare(
      `INSERT INTO reports (site_id, device_id, submitted_by, status, client_request_id, values_json, raw_input, business_date, submitted_at, supersedes_report_id)
       VALUES (1, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(user.username, status, clientRequestId, JSON.stringify(values), rawInput, bDate, submittedAt, supersedes)
    .run();

  const row = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(insert.meta.last_row_id).first();
  return json({ report: shapeReport(row), duplicate: false }, 201);
}

export async function listReports(env, url) {
  const status = url.searchParams.get('status') || 'pending';
  if (!['awaiting_captain', 'pending', 'confirmed', 'rejected'].includes(status)) {
    return json({ error: 'status 僅接受 awaiting_captain/pending/confirmed/rejected' }, 400);
  }
  // 回報標題代號沿用上傳者的哨點代號；沒有代號時退回顯示名稱。
  const { results } = await env.DB
    .prepare(
      `SELECT r.*, COALESCE(NULLIF(u.post_code, ''), u.display_name) AS device_label
       FROM reports r LEFT JOIN users u ON u.username = r.submitted_by
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

export async function confirmReport(env, id, request, user) {
  const report = await loadReport(env, id);
  if (!report) return json({ error: '找不到回報單' }, 404);

  if (report.status === 'confirmed') {
    const row = await env.DB.prepare('SELECT * FROM records WHERE report_id = ?').bind(id).first();
    return json({ record: mapRecord(row), alreadyConfirmed: true }, 200);
  }
  if (report.status === 'rejected') {
    return json({ error: '已退回的回報單不能確認' }, 409);
  }
  if (report.status === 'awaiting_captain') {
    return json({ error: '尚待隊長複核' }, 409);
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

  const parsed = parseCorrections(body.values, byCode);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const correctionsInput = parsed.correctionsInput;

  const display = parseDisplayBefore(body.display_before);
  if (!display.ok) return json({ error: display.error }, 400);

  const site = (await getSite(env.DB)) || { tower_total: 1600 };
  // 中控的基準是隊長複核結果（若有），否則上傳者原值；values_json 永不改寫。
  const baseJson = report.reviewed_values_json ?? report.values_json;
  const baseValues = fillValues(JSON.parse(baseJson || '{}'), zones);
  const { finalValues, corrections } = applyCorrections(baseValues, correctionsInput, byCode);
  const correctionsJson = Object.keys(corrections).length ? JSON.stringify(corrections) : null;

  const reportTime = new Date(report.submitted_at);
  const submitter = report.submitted_by
    ? await env.DB
        .prepare('SELECT post_code, display_name FROM users WHERE username = ?')
        .bind(report.submitted_by)
        .first()
    : null;
  const deviceLabel = submitter?.post_code || submitter?.display_name || null;

  const tower = buildTowerUsage(finalValues, zones, { towerTotal: site.tower_total });
  const confirmedAt = new Date().toISOString();

  const insertRecord = env.DB
    .prepare(
      `INSERT INTO records
        (report_id, site_id, business_date, values_json, guard_report, console_report, excel_values,
         tower_usage_pct, tower_remaining, corrections_json, captain_corrections_json, display_before,
         remarks_json, prepared_by, report_time, confirmed_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      report.review_corrections_json ?? null,
      display.value,
      remarks ? JSON.stringify(remarks) : null,
      user.username,
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
  if (report.status === 'awaiting_captain') {
    return json({ error: '尚待隊長複核' }, 409);
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

/** 狀態判定：已複核完成可重放；其餘只有 awaiting_captain 能複核。 */
function reviewState(report) {
  if (report.status === 'pending' && report.reviewed_at) return 'already';
  if (report.status !== 'awaiting_captain') return 'conflict';
  return 'review';
}

export async function reviewReport(env, id, request, user) {
  const report = await loadReport(env, id);
  if (!report) return json({ error: '找不到回報單' }, 404);

  const state = reviewState(report);
  if (state === 'already') {
    return json({ report: shapeReport(report), alreadyReviewed: true }, 200);
  }
  if (state === 'conflict') {
    return json({ error: '這筆回報不在待複核狀態' }, 409);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

  const zones = await getActiveZones(env.DB);
  const byCode = new Map(zones.map((z) => [z.code, z]));

  // 先驗證再寫入；任何 400 都不會動到回報單。
  const parsed = parseCorrections(body.values, byCode);
  if (parsed.error) return json({ error: parsed.error }, 400);

  const submitted = fillValues(JSON.parse(report.values_json || '{}'), zones);
  const { finalValues, corrections } = applyCorrections(submitted, parsed.correctionsInput, byCode);
  const correctionsJson = Object.keys(corrections).length ? JSON.stringify(corrections) : null;
  const reviewedAt = new Date().toISOString();

  const result = await env.DB
    .prepare(
      `UPDATE reports
       SET status = 'pending', reviewed_values_json = ?, review_corrections_json = ?,
           reviewed_by = ?, reviewed_at = ?
       WHERE id = ? AND status = 'awaiting_captain'`
    )
    .bind(JSON.stringify(finalValues), correctionsJson, user.username, reviewedAt, id)
    .run();

  const updated = await loadReport(env, id);
  if (result.meta.changes === 0) {
    // 併發：另一個請求已先完成複核（或狀態已被改掉）。
    if (reviewState(updated) === 'already') {
      return json({ report: shapeReport(updated), alreadyReviewed: true }, 200);
    }
    return json({ error: '這筆回報不在待複核狀態' }, 409);
  }
  return json({ report: shapeReport(updated) }, 200);
}

export async function reviewReject(env, id, request, user) {
  const report = await loadReport(env, id);
  if (!report) return json({ error: '找不到回報單' }, 404);
  if (report.status === 'rejected') return json({ report: shapeReport(report) }, 200);
  if (report.status !== 'awaiting_captain') {
    return json({ error: '這筆回報不在待複核狀態' }, 409);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : null;
  const reviewedAt = new Date().toISOString();

  const result = await env.DB
    .prepare(
      `UPDATE reports
       SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = ?
       WHERE id = ? AND status = 'awaiting_captain'`
    )
    .bind(reason, user.username, reviewedAt, id)
    .run();

  const updated = await loadReport(env, id);
  if (result.meta.changes === 0 && updated.status !== 'rejected') {
    return json({ error: '這筆回報不在待複核狀態' }, 409);
  }
  return json({ report: shapeReport(updated) }, 200);
}
