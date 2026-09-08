import { getActiveZones, getSite } from './zones.js';
import { businessDate } from '../../public/js/parking-core.js';

export async function publicCurrent(env, url) {
  const date = url.searchParams.get('date') || businessDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: '日期格式必須為 YYYY-MM-DD' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-robots-tag': 'noindex' },
    });
  }

  const { results } = await env.DB
    .prepare(
      'SELECT report_time, values_json, tower_usage_pct FROM records WHERE site_id = 1 AND business_date = ? ORDER BY report_time, id'
    )
    .bind(date)
    .all();
  const zones = await getActiveZones(env.DB);
  const site = (await getSite(env.DB)) || { tower_total: 1600 };

  const body = {
    businessDate: date,
    towerTotal: site.tower_total,
    zones: zones.map(({ code, label, position, unit, inTower }) => ({ code, label, position, unit, inTower })),
    entries: results.map((row) => ({
      reportTime: row.report_time,
      towerPct: row.tower_usage_pct,
      values: JSON.parse(row.values_json || '{}'),
    })),
  };
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30',
      'x-robots-tag': 'noindex',
    },
  });
}
