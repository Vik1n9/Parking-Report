import { json } from '../lib/http.js';
import { getActiveZones, getSite } from './zones.js';
import { buildLineReport, buildControlReport, buildExcelValues, buildTowerUsage, formatTime, businessDate } from '../../public/js/parking-core.js';

const VALUE_RE = /^(x|[0-9]{1,4}(\.[0-9])?)$/i;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function tokensToArray(tokensObj, zones) {
  return zones.map((z) => {
    const value = tokensObj?.[z.code];
    const str = typeof value === 'string' ? value.trim() : '';
    return str || 'x';
  });
}

export function shapeReport(row, zones) {
  const tokensObj = JSON.parse(row.tokens_json || '{}');
  return {
    id: row.id,
    status: row.status,
    businessDate: row.business_date,
    submittedAt: row.submitted_at,
    deviceLabel: row.device_label ?? null,
    clientRequestId: row.client_request_id,
    supersedesReportId: row.supersedes_report_id ?? null,
    rejectReason: row.reject_reason ?? null,
    tokens: tokensObj,
    values: zones ? tokensToArray(tokensObj, zones) : undefined,
  };
}

function mapRecord(row) {
  return {
    id: row.id,
    reportId: row.report_id,
    businessDate: row.business_date,
    lineReport: row.line_report,
    controlReport: row.control_report,
    excelValues: row.excel_values,
    towerPct: row.tower_usage_pct,
    remarks: JSON.parse(row.remarks_json || '{}'),
    preparedBy: row.prepared_by,
    reportTime: row.report_time,
    confirmedAt: row.confirmed_at,
    tokens: JSON.parse(row.tokens_json || '{}'),
  };
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

  const input = body?.tokens;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'tokens 必須是 { 區域code: 值 } 的物件' }, 400);
  }

  const zones = await getActiveZones(env.DB);
  const validCodes = new Set(zones.map((z) => z.code));
  const tokens = {};
  for (const [code, value] of Object.entries(input)) {
    if (!validCodes.has(code)) {
      return json({ error: `未知區域: ${code}` }, 400);
    }
    const v = String(value ?? '').trim().toLowerCase() || 'x';
    if (!VALUE_RE.test(v)) {
      return json({ error: `區域 ${code} 的值格式無效: ${v}` }, 400);
    }
    tokens[code] = v;
  }

  const rawInput = typeof body.raw_input === 'string' ? body.raw_input.slice(0, 2000) : null;
  const supersedes = Number.isInteger(body.supersedes_report_id) ? body.supersedes_report_id : null;
  const now = new Date();
  const submittedAt = now.toISOString();
  const bDate = businessDate(now);

  const dup = await env.DB
    .prepare('SELECT * FROM reports WHERE site_id = 1 AND client_request_id = ?')
    .bind(clientRequestId)
    .first();
  if (dup) {
    return json({ report: shapeReport(dup, zones), duplicate: true }, 200);
  }

  const insert = await env.DB
    .prepare(
      `INSERT INTO reports (site_id, device_id, status, client_request_id, tokens_json, raw_input, business_date, submitted_at, supersedes_report_id)
       VALUES (1, ?, 'pending', ?, ?, ?, ?, ?, ?)`
    )
    .bind(device.deviceId, clientRequestId, JSON.stringify(tokens), rawInput, bDate, submittedAt, supersedes)
    .run();

  const row = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(insert.meta.last_row_id).first();
  return json({ report: shapeReport(row, zones), duplicate: false }, 201);
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
  const zones = await getActiveZones(env.DB);
  return json({ status, reports: results.map((row) => shapeReport(row, zones)) });
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
  const remarks = body && typeof body.remarks === 'object' && !Array.isArray(body.remarks) ? body.remarks : null;

  const zones = await getActiveZones(env.DB);
  const site = (await getSite(env.DB)) || { tower_total: 1600 };
  const tokensObj = JSON.parse(report.tokens_json || '{}');
  const tokens = tokensToArray(tokensObj, zones);
  const reportTime = new Date(report.submitted_at);

  const towerIndexes = zones.filter((z) => z.inTower).map((z) => z.position);
  const tower = buildTowerUsage(tokens, { towerTotal: site.tower_total, towerIndexes });
  const confirmedAt = new Date().toISOString();

  const insertRecord = env.DB
    .prepare(
      `INSERT INTO records
        (report_id, site_id, business_date, tokens_json, line_report, control_report, excel_values,
         tower_usage_pct, remarks_json, prepared_by, report_time, confirmed_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      report.id,
      report.business_date,
      report.tokens_json,
      buildLineReport(tokens, reportTime),
      buildControlReport(tokens, reportTime),
      buildExcelValues(tokens).join('\t'),
      tower.valid ? tower.percent : null,
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
