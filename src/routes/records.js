import { json } from '../lib/http.js';
import { businessDate } from '../../public/js/parking-core.js';

export function mapRecord(row) {
  return {
    id: row.id,
    reportId: row.report_id,
    businessDate: row.business_date,
    guardReport: row.guard_report,
    consoleReport: row.console_report,
    excelValues: row.excel_values,
    towerPct: row.tower_usage_pct,
    remarks: JSON.parse(row.remarks_json || '{}'),
    preparedBy: row.prepared_by,
    reportTime: row.report_time,
    confirmedAt: row.confirmed_at,
    values: JSON.parse(row.values_json || '{}'),
  };
}

export async function listRecords(env, url) {
  const today = businessDate(new Date());
  const from = url.searchParams.get('from') || today;
  const to = url.searchParams.get('to') || from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return json({ error: '日期格式必須為 YYYY-MM-DD' }, 400);
  }
  const { results } = await env.DB
    .prepare(
      'SELECT * FROM records WHERE site_id = 1 AND business_date BETWEEN ? AND ? ORDER BY business_date, report_time, id'
    )
    .bind(from, to)
    .all();
  return json({ from, to, records: results.map(mapRecord) });
}
