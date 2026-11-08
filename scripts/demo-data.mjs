// 示範資料產生器：純函式、無 I/O，供 scripts/demo-seed.mjs 與測試共用。
// 產生的列一律帶 `demo-` 開頭的 client_request_id，清除時只動這些列。
import {
  businessDate,
  formatTime,
  buildReport,
  buildExcelValues,
  buildTowerUsage,
} from '../public/js/parking-core.js';

const POST_CODES = { patrol: '車巡', captain: 'A1' };
const REMARK_TEXTS = ['施工', '設備維修', '車道封閉', '遺失票卡'];
const HOUR_LOAD = [
  0.06, 0.05, 0.05, 0.05, 0.05, 0.08, 0.16, 0.34, 0.55, 0.72, 0.86, 0.93,
  0.88, 0.9, 0.94, 0.9, 0.8, 0.64, 0.5, 0.4, 0.3, 0.22, 0.14, 0.09,
];

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shiftCivil(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + delta));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function taipeiInstant(dateStr, hour, minute = 0) {
  return new Date(
    `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`
  );
}

function taipeiHour(instant) {
  return Number(formatTime(instant).slice(0, 2));
}

function weekdayOf(dateStr) {
  return new Date(`${dateStr}T12:00:00+08:00`).getUTCDay();
}

function sameValue(a, b) {
  return a?.kind === b?.kind && a?.value === b?.value;
}

function intBetween(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

/** 把值改成另一個合法值，保證與 base（與 avoid）不同。 */
function mutateValue(zone, base, rng, avoid = null) {
  for (let attempt = 0; attempt < 12; attempt++) {
    let next;
    if (base.kind === 'spaces') {
      const delta = (rng() < 0.5 ? -1 : 1) * intBetween(rng, 1, 15);
      const n = clamp(base.value + delta, 0, 9999);
      next = n === 0 ? { kind: 'full' } : { kind: 'spaces', value: n };
    } else if (base.kind === 'tenths') {
      const n = clamp(base.value + (rng() < 0.5 ? -1 : 1), 1, 9);
      next = { kind: 'tenths', value: n };
    } else if (zone.inTower) {
      next = { kind: 'spaces', value: intBetween(rng, 1, 40) };
    } else {
      next = { kind: 'tenths', value: intBetween(rng, 2, 7) };
    }
    if (!sameValue(next, base) && (!avoid || !sameValue(next, avoid))) return next;
  }
  const fallback = zone.inTower
    ? { kind: 'spaces', value: base.value === 7 || avoid?.value === 7 ? 8 : 7 }
    : { kind: 'tenths', value: base.value === 4 || avoid?.value === 4 ? 5 : 4 };
  return fallback;
}

function outdoorValue(load, rng) {
  if (load < 0.12 && rng() < 0.5) return { kind: 'none' };
  if (load > 0.85) {
    const roll = rng();
    if (roll < 0.18) return { kind: 'full' };
    if (roll < 0.28) return { kind: 'carts', value: intBetween(rng, 1, 5) };
    if (roll < 0.36) return { kind: 'guiding' };
  } else if (load > 0.7 && rng() < 0.06) {
    return { kind: 'carts', value: intBetween(rng, 1, 3) };
  }
  const base = 9 - load * 7.6;
  return { kind: 'tenths', value: clamp(Math.round(base + (rng() - 0.5) * 2), 1, 9) };
}

function buildValues(zones, towerTotal, load, rng) {
  const values = {};
  const towerZones = zones.filter((zone) => zone.inTower);
  if (towerZones.length && towerTotal > 0) {
    let target = Math.round(towerTotal * (1 - load) * (0.9 + rng() * 0.2));
    if (load > 0.85 && rng() < 0.22) target = rng() < 0.5 ? 0 : intBetween(rng, 0, 15);
    target = clamp(target, 0, towerTotal);
    let remaining = target;
    towerZones.forEach((zone, index) => {
      let free;
      if (index === towerZones.length - 1) {
        free = remaining;
      } else {
        const share = index === 0 ? 0.58 + rng() * 0.12 : 1 / (towerZones.length - index);
        free = Math.round(remaining * share);
      }
      remaining -= free;
      values[zone.code] = free > 0 ? { kind: 'spaces', value: free } : { kind: 'full' };
    });
  }
  for (const zone of zones) {
    if (zone.inTower) continue;
    values[zone.code] = outdoorValue(load, rng);
  }
  return values;
}

function reportRow({ date, status, submittedBy, submittedAt, values, reviewedAt = null, reviewedValues = null, reviewCorrections = null, confirmedAt = null, seed }) {
  const hour = formatTime(submittedAt).slice(0, 2);
  return {
    site_id: 1,
    device_id: null,
    status,
    client_request_id: `demo-s${seed}-${date}-${hour}-${submittedBy}`,
    values_json: JSON.stringify(values),
    raw_input: null,
    business_date: date,
    submitted_at: submittedAt.toISOString(),
    confirmed_at: confirmedAt ? confirmedAt.toISOString() : null,
    submitted_by: submittedBy,
    reviewed_values_json: reviewedValues ? JSON.stringify(reviewedValues) : null,
    review_corrections_json: reviewCorrections ? JSON.stringify(reviewCorrections) : null,
    reviewed_by: reviewedAt ? 'captain' : null,
    reviewed_at: reviewedAt ? reviewedAt.toISOString() : null,
  };
}

function recordRow({ report, values, consoleCorrections, captainCorrections, displayBefore, remarks, confirmedAt }) {
  const submittedAt = new Date(report.submitted_at);
  const tower = buildTowerUsage(values, report.zones, { towerTotal: report.towerTotal });
  return {
    report_client_request_id: report.client_request_id,
    site_id: 1,
    business_date: report.business_date,
    values_json: JSON.stringify(values),
    guard_report: buildReport(values, report.zones, { style: 'guard', time: submittedAt }),
    console_report: buildReport(values, report.zones, {
      style: 'console',
      time: submittedAt,
      deviceLabel: POST_CODES[report.submitted_by],
    }),
    excel_values: buildExcelValues(values, report.zones).map((cell) => cell.value).join('\t'),
    tower_usage_pct: tower.valid ? tower.percent : null,
    tower_remaining: tower.valid ? tower.remaining : null,
    corrections_json: consoleCorrections ? JSON.stringify(consoleCorrections) : null,
    captain_corrections_json: captainCorrections ? JSON.stringify(captainCorrections) : null,
    display_before: displayBefore,
    remarks_json: remarks ? JSON.stringify(remarks) : null,
    prepared_by: 'console',
    report_time: formatTime(submittedAt),
    confirmed_at: confirmedAt.toISOString(),
  };
}

function eventRows({ date, isToday, currentHour, currentMinute, now, zones, rng, special }) {
  const towerZones = zones.filter((zone) => zone.inTower);
  const outdoorZones = zones.filter((zone) => !zone.inTower);
  const maxHour = isToday ? Math.max(0, currentHour) : 23;
  const nowMs = now.getTime();
  const atHour = (min, max) => clamp(intBetween(rng, min, max), 0, maxHour);
  const count = intBetween(rng, 2, 4);
  const rows = [];
  const push = (kind, zoneCode, hour, detail) => {
    const lastMinute = isToday && hour === maxHour ? currentMinute : 59;
    const occurred = taipeiInstant(date, hour, intBetween(rng, 0, Math.max(0, lastMinute)));
    const cleared = new Date(occurred.getTime() + intBetween(rng, 10, 40) * 60000);
    rows.push({
      site_id: 1,
      business_date: date,
      kind,
      zone_code: zoneCode,
      occurred_at: occurred.toISOString(),
      cleared_at: isToday && cleared.getTime() > nowMs ? null : cleared.toISOString(),
      detail,
      created_by: 'demo',
    });
  };
  push(
    'guiding',
    towerZones.length ? pick(rng, towerZones).code : null,
    atHour(10, 15),
    '尖峰車塔引導'
  );
  push('jam', null, atHour(8, 17), '車道回堵');
  if (special) {
    push('special', outdoorZones.length ? pick(rng, outdoorZones).code : null, atHour(9, 17), '車輛擦撞');
  }
  while (rows.length < count) {
    if (towerZones.length && rng() < 0.5) {
      push('guiding', pick(rng, towerZones).code, atHour(9, 17), '出入口引導');
    } else {
      push('jam', null, atHour(7, 18), '出口壅塞');
    }
  }
  rows.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  if (isToday && rows.length > 1 && rng() < 0.5) rows.at(-1).cleared_at = null;
  return rows;
}

export function generateDemo({ now = new Date(), zones, towerTotal = 0, days = 7, seed = 1 } = {}) {
  if (!Array.isArray(zones) || zones.length === 0) throw new Error('zones 必須是啟用中的區域陣列');
  const rng = mulberry32(seed);
  const reports = [];
  const records = [];
  const events = [];
  const today = businessDate(now);
  const currentHour = taipeiHour(now);
  const currentMinute = Number(formatTime(now).slice(3, 5));
  const dates = [];
  for (let i = days - 1; i >= 0; i--) dates.push(shiftCivil(today, -i));
  const specialDate = dates[intBetween(rng, 0, dates.length - 1)];

  for (const date of dates) {
    const weekend = weekdayOf(date) === 0 || weekdayOf(date) === 6;
    const isToday = date === today;
    const lastHour = isToday ? currentHour : 23;
    const outdoorZones = zones.filter((zone) => !zone.inTower);

    for (let hour = 0; hour <= lastHour; hour++) {
      const load = clamp(HOUR_LOAD[hour] + (weekend ? 0.1 : 0) + (rng() - 0.5) * 0.04, 0.02, 0.99);
      const minute =
        isToday && hour === currentHour
          ? Math.min(intBetween(rng, 3, 12), currentMinute)
          : intBetween(rng, 3, 12);
      const submittedAt = taipeiInstant(date, hour, minute);

      if (isToday && hour === currentHour) {
        // 最新一小時留給審核頁與中控佇列，不產生紀錄。
        const awaitingValues = buildValues(zones, towerTotal, load, rng);
        reports.push(
          reportRow({
            date,
            status: 'awaiting_captain',
            submittedBy: 'patrol',
            submittedAt,
            values: awaitingValues,
            seed,
          })
        );
        const pendingValues = buildValues(zones, towerTotal, load, rng);
        reports.push(
          reportRow({
            date,
            status: 'pending',
            submittedBy: 'captain',
            submittedAt,
            values: pendingValues,
            seed,
          })
        );
        continue;
      }

      const submittedBy = rng() < 0.7 ? 'patrol' : 'captain';
      const submittedValues = buildValues(zones, towerTotal, load, rng);
      let reviewedAt = null;
      let reviewedValues = null;
      let reviewCorrections = null;

      if (submittedBy === 'patrol') {
        reviewedAt = new Date(submittedAt.getTime() + intBetween(rng, 1, 6) * 60000);
        reviewedValues = submittedValues;
        if (rng() < 0.15) {
          const zone = pick(rng, zones);
          const original = submittedValues[zone.code];
          reviewedValues = { ...submittedValues, [zone.code]: mutateValue(zone, original, rng) };
          reviewCorrections = { [zone.code]: original };
        }
      }

      const confirmedAt = new Date((reviewedAt ?? submittedAt).getTime() + intBetween(rng, 2, 8) * 60000);
      if (isToday) {
        if (reviewedAt && reviewedAt.getTime() > now.getTime()) reviewedAt = new Date(now);
        if (confirmedAt.getTime() > now.getTime()) confirmedAt.setTime(now.getTime());
      }
      const finalValues = reviewedValues ?? submittedValues;
      const report = reportRow({
        date,
        status: 'confirmed',
        submittedBy,
        submittedAt,
        values: submittedValues,
        reviewedAt,
        reviewedValues,
        reviewCorrections,
        confirmedAt,
        seed,
      });
      reports.push(report);

      let recordValues = finalValues;
      let consoleCorrections = null;
      if (rng() < 0.1) {
        const zone = pick(rng, zones);
        const base = finalValues[zone.code];
        const avoid = reviewCorrections?.[zone.code] ?? null;
        consoleCorrections = { [zone.code]: base };
        recordValues = { ...finalValues, [zone.code]: mutateValue(zone, base, rng, avoid) };
      }

      const tower = buildTowerUsage(recordValues, zones, { towerTotal });
      let displayBefore = null;
      if (tower.valid && rng() < 0.8) {
        displayBefore = clamp(tower.remaining + intBetween(rng, -40, 40), 0, 9999);
      }

      let remarks = null;
      if (rng() < 0.05) {
        const pool = outdoorZones.length ? outdoorZones : zones;
        remarks = { [pick(rng, pool).code]: pick(rng, REMARK_TEXTS) };
      }

      records.push(
        recordRow({
          report: { ...report, zones, towerTotal },
          values: recordValues,
          consoleCorrections,
          captainCorrections: reviewCorrections,
          displayBefore,
          remarks,
          confirmedAt,
        })
      );
    }

    const dayEvents = eventRows({
      date,
      isToday,
      currentHour,
      currentMinute,
      now,
      zones,
      rng,
      special: date === specialDate,
    });
    events.push(...dayEvents);
  }

  return { reports, records, events };
}
