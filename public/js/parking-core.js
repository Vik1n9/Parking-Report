export const TIME_ZONE = 'Asia/Taipei';
export const KINDS = ['spaces', 'tenths', 'carts', 'full', 'guiding', 'none'];

const timeFormatters = new Map();
const dateFormatters = new Map();

function timeFormatter(timeZone) {
  let f = timeFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    timeFormatters.set(timeZone, f);
  }
  return f;
}

function dateFormatter(timeZone) {
  let f = dateFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(timeZone, f);
  }
  return f;
}

function toDate(input) {
  if (input instanceof Date) return input;
  if (input === undefined || input === null) return new Date();
  return new Date(input);
}

export function formatTime(input, timeZone = TIME_ZONE) {
  const parts = timeFormatter(timeZone).formatToParts(toDate(input));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}

export function businessDate(input, timeZone = TIME_ZONE) {
  return dateFormatter(timeZone).format(toDate(input));
}

const RANGES = { spaces: [0, 9999], tenths: [1, 9], carts: [1, 99] };
const VALUELESS = new Set(['full', 'guiding', 'none']);

const WORDS = [
  [/^(滿|全滿)$/, () => ({ kind: 'full' })],
  [/^(未停車|沒停車|無停車)$/, () => ({ kind: 'none' })],
  [/^(引導中|車導中)$/, () => ({ kind: 'guiding' })],
  [/^(\d{1,2})成空?$/, (m) => ({ kind: 'tenths', value: Number(m[1]) })],
  [/^停(\d{1,2})台$/, (m) => ({ kind: 'carts', value: Number(m[1]) })],
  [/^(\d{1,2})台車?$/, (m) => ({ kind: 'carts', value: Number(m[1]) })],
];

export function normalizeInput(raw, zone) {
  if (raw && typeof raw === 'object' && typeof raw.kind === 'string') {
    return raw.value === undefined ? { kind: raw.kind } : { kind: raw.kind, value: raw.value };
  }
  const text = String(raw ?? '').trim();
  if (!text) return { kind: 'none' };

  for (const [re, build] of WORDS) {
    const match = text.match(re);
    if (match) return build(match);
  }
  if (/^\d{1,4}$/.test(text)) {
    const n = Number(text);
    if (n === 0) return { kind: 'full' };
    return zone.unit === 'spaces' ? { kind: 'spaces', value: n } : { kind: 'tenths', value: n };
  }
  throw new Error(`無法解析的值：${text}`);
}

export function validateValue(value, zone) {
  if (!value || typeof value !== 'object') return { ok: false, error: '值必須是物件' };
  const { kind } = value;
  if (!KINDS.includes(kind)) return { ok: false, error: `未知的 kind：${kind}` };

  if (VALUELESS.has(kind)) {
    if (value.value !== undefined) return { ok: false, error: `${kind} 不得帶 value` };
    return { ok: true };
  }
  if (kind === 'spaces' && zone.unit !== 'spaces') return { ok: false, error: `${zone.code} 不是車位數區` };
  if (kind === 'tenths' && zone.unit !== 'tenths') return { ok: false, error: `${zone.code} 不是成數區` };

  const [min, max] = RANGES[kind];
  if (!Number.isInteger(value.value) || value.value < min || value.value > max) {
    return { ok: false, error: `${kind} 的值必須是 ${min}-${max} 的整數` };
  }
  return { ok: true };
}

export function formatValue(value) {
  switch (value?.kind) {
    case 'spaces': return `${value.value}車位`;
    case 'tenths': return `${value.value}成空`;
    case 'carts': return `停${value.value}台`;
    case 'full': return '滿';
    case 'guiding': return '引導中';
    default: return '未停車';
  }
}

function joinLabels(labels) {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join('、')}及${labels.at(-1)}`;
}

export function buildReport(values, zones, opts = {}) {
  const { style = 'guard', time, deviceLabel, timeZone } = opts;
  const clock = formatTime(time, timeZone ?? TIME_ZONE);
  const read = (zone) => normalizeInput(values?.[zone.code], zone);

  if (style === 'guard') {
    const lines = ['停車場回報', `${clock} 保全回報停車情況：`];
    for (const zone of zones) lines.push(`${zone.label}：${formatValue(read(zone))}`);
    return lines.join('\n');
  }

  const lines = [`中控回報：${clock} ${deviceLabel || '保全'}回報`];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    if (run.length === 1) lines.push(`${run[0]} 未停車`);
    else lines.push(`${joinLabels(run)}未停車。`);
    run = [];
  };
  for (const zone of zones) {
    const value = read(zone);
    if (value.kind === 'none') {
      run.push(zone.label);
      continue;
    }
    flush();
    lines.push(`${zone.label} ${formatValue(value)}`);
  }
  flush();
  return lines.join('\n');
}

export function excelCell(value) {
  switch (value?.kind) {
    case 'spaces': return { value: value.value };
    case 'tenths': return { value: value.value, numFmt: '0"成"' };
    case 'carts': return { value: `停${value.value}台` };
    case 'full': return { value: '滿' };
    case 'guiding': return { value: '引導中' };
    default: return { value: '未停車' };
  }
}

export function buildExcelValues(values, zones) {
  return zones.map((zone) => excelCell(normalizeInput(values?.[zone.code], zone)));
}

export function buildTowerUsage(values, zones, opts = {}) {
  const towerTotal = opts.towerTotal ?? 0;
  const towerZones = zones.filter((zone) => zone.inTower);
  const invalid = { valid: false, percent: null, remaining: null, occupied: null };
  if (towerTotal <= 0 || !towerZones.length) return invalid;

  let remaining = 0;
  for (const zone of towerZones) {
    const value = normalizeInput(values?.[zone.code], zone);
    if (value.kind === 'full') continue;
    if (value.kind !== 'spaces') return invalid;
    remaining += value.value;
  }
  const occupied = Math.min(towerTotal, Math.max(0, towerTotal - remaining));
  return { valid: true, percent: Math.round((occupied / towerTotal) * 100), remaining, occupied };
}
