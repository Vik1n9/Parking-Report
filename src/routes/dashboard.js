import { getActiveZones, getSite } from './zones.js';
import { businessDate } from '../../public/js/parking-core.js';

const DASHBOARD_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, max-age=30',
  'x-robots-tag': 'noindex',
};

function mapEvent(row) {
  return {
    kind: row.kind,
    zoneCode: row.zone_code || null,
    zoneLabel: row.zone_label || null,
    occurredAt: row.occurred_at,
    clearedAt: row.cleared_at || null,
    detail: row.detail || null,
  };
}

export async function dashboardCurrent(env, url) {
  const date = url.searchParams.get('date') || businessDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: '日期格式必須為 YYYY-MM-DD' }), {
      status: 400,
      headers: DASHBOARD_HEADERS,
    });
  }

  const recordsQuery = env.DB
    .prepare(
      'SELECT report_time, values_json, tower_usage_pct FROM records WHERE site_id = 1 AND business_date = ? ORDER BY report_time, id'
    )
    .bind(date)
    .all();
  const eventsQuery = env.DB
    .prepare(
      `SELECT e.kind, e.zone_code, e.occurred_at, e.cleared_at, e.detail, z.label AS zone_label
       FROM site_events e
       LEFT JOIN zones z ON z.code = e.zone_code
       WHERE e.site_id = 1 AND e.business_date = ?
       ORDER BY e.occurred_at, e.id`
    )
    .bind(date)
    .all();
  const zonesQuery = getActiveZones(env.DB);
  const siteQuery = getSite(env.DB);

  const [{ results }, eventsResult, zones, site] = await Promise.all([
    recordsQuery,
    eventsQuery,
    zonesQuery,
    siteQuery,
  ]);

  const body = {
    businessDate: date,
    towerTotal: (site || { tower_total: 1600 }).tower_total,
    zones: zones.map(({ code, label, position, unit, inTower }) => ({ code, label, position, unit, inTower })),
    entries: results.map((row) => ({
      reportTime: row.report_time,
      towerPct: row.tower_usage_pct,
      values: JSON.parse(row.values_json || '{}'),
    })),
    events: (eventsResult.results || []).map(mapEvent),
  };
  return new Response(JSON.stringify(body), { headers: DASHBOARD_HEADERS });
}
