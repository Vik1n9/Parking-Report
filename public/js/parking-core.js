export const TIME_ZONE = 'Asia/Taipei';
export const LABELS = ['一樓以上', '一樓以下', 'P1', 'P3', '紡A', '紡B', '紡C', '紡D', '紡E', '柏油路'];
export const ALIAS_MAP = { A: '紡A', B: '紡B', C: '紡C', D: '紡D', E: '紡E', R: '柏油路' };
export const IS_CAR = [true, true, false, false, false, false, false, false, false, false];
export const DEFAULT_TOWER_TOTAL = 1600;

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

function normalizeKey(key) {
  if (LABELS.includes(key)) return key;
  return ALIAS_MAP[key] || null;
}

export function parseText(str) {
  const result = new Array(LABELS.length).fill('x');
  const tokens = String(str || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return result;

  const plains = [];
  const pairs = [];
  tokens.forEach((token) => (token.includes('=') ? pairs : plains).push(token));
  plains.forEach((value, index) => {
    if (index < LABELS.length) result[index] = value;
  });

  const labelIdx = Object.fromEntries(LABELS.map((label, index) => [label, index]));
  pairs.forEach((pair) => {
    const eq = pair.indexOf('=');
    if (eq === -1) return;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const full = normalizeKey(key);
    if (full != null && labelIdx[full] !== undefined) result[labelIdx[full]] = value;
  });
  return result;
}

export function normalizeValue(raw) {
  return (raw ?? 'x').toString().toLowerCase().trim() || 'x';
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
