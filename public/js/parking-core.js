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

export function zoneInfo(index, raw) {
  const value = normalizeValue(raw);
  if (value === 'x') return { cls: 'empty', s: '未停車' };
  if (value === '0') return { cls: 'full', s: '全滿' };
  if (IS_CAR[index]) return { cls: 'ok', s: `${value} 車位` };
  if (value.startsWith('0.')) {
    const count = parseInt(value.slice(2), 10) || 0;
    if (!count) return { cls: 'full', s: '全滿' };
    return { cls: 'few', s: `尚有 ${count} 台` };
  }
  const count = parseInt(value, 10);
  if (!Number.isNaN(count)) {
    return { cls: count >= 7 ? 'ok' : count >= 4 ? 'few' : 'full', s: `${count} 成` };
  }
  return { cls: 'empty', s: value };
}

export function toExcel(index, raw) {
  const value = normalizeValue(raw);
  if (value === 'x') return '未停車';
  if (value === '0') return '滿';
  if (IS_CAR[index]) return value;
  if (value.startsWith('0.')) {
    const count = parseInt(value.slice(2), 10) || 0;
    return count ? `${count}台車` : '滿';
  }
  const count = parseInt(value, 10);
  return Number.isNaN(count) ? value : `${count}成`;
}

export function buildExcelValues(tokens) {
  return LABELS.map((_, index) => toExcel(index, tokens[index]));
}

export function buildControlReport(tokens, time) {
  const date = toDate(time);
  let output = `中控回報:\n${formatTime(date)} 保全回報停車情況：\n`;
  LABELS.forEach((label, index) => {
    const value = normalizeValue(tokens[index]);
    if (IS_CAR[index]) {
      if (value === 'x') output += `${label} 沒停車\n`;
      else if (value === '0') output += `${label} 全滿\n`;
      else output += `${label}${value}車位\n`;
    } else if (value === 'x') {
      output += `${label} 沒停車\n`;
    } else if (value === '0') {
      output += `${label} 全滿\n`;
    } else if (value.startsWith('0.')) {
      output += `${label} 尚有${value.slice(2)}台車\n`;
    } else {
      output += `${label} 尚有${value}成車位\n`;
    }
  });
  return output.trim();
}

export function buildLineReport(tokens, time) {
  const date = toDate(time);
  const lines = ['停車場回報', `${formatTime(date)} 保全回報停車情況：`];
  LABELS.forEach((label, index) => {
    lines.push(`${label}：${zoneInfo(index, tokens[index]).s}`);
  });
  return lines.join('\n');
}

export function buildTowerUsage(tokens, options = {}) {
  const towerTotal = options.towerTotal ?? DEFAULT_TOWER_TOTAL;
  const indexes = options.towerIndexes ?? [0, 1];
  let remaining = 0;
  let valid = towerTotal > 0;
  for (const index of indexes) {
    const raw = normalizeValue(tokens[index]);
    const count = parseInt(raw, 10);
    if (Number.isNaN(count) || raw === 'x') {
      valid = false;
      break;
    }
    remaining += count;
  }
  if (!valid) return { valid: false, percent: null, remaining: null, occupied: null };

  remaining = Math.max(0, remaining);
  const occupied = Math.min(towerTotal, Math.max(0, towerTotal - remaining));
  const percent = Math.round((occupied / towerTotal) * 100);
  return { valid: true, percent, remaining, occupied };
}
