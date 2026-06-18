(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ParkingCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const LABELS = ['一樓以上', '一樓以下', 'P1', 'P3', '紡A', '紡B', '紡C', '紡D', '紡E', '柏油路'];
  const ALIAS_MAP = { A: '紡A', B: '紡B', C: '紡C', D: '紡D', E: '紡E', R: '柏油路' };
  const IS_CAR = [true, true, false, false, false, false, false, false, false, false];
  const TOWER_TOTAL = 1600;

  function normalizeKey(key) {
    if (LABELS.includes(key)) return key;
    return ALIAS_MAP[key] || null;
  }

  function parseText(str) {
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

  function normalizeValue(raw) {
    return (raw ?? 'x').toString().toLowerCase().trim() || 'x';
  }

  function zoneInfo(index, raw) {
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

  function toExcel(index, raw) {
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

  function buildExcelValues(tokens) {
    return LABELS.map((_, index) => toExcel(index, tokens[index]));
  }

  function reportTime(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function buildControlReport(tokens, time) {
    const date = time || new Date();
    let output = `中控回報:\n${reportTime(date)} 保全回報停車情況：\n`;
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

  function buildLineReport(tokens, time) {
    const date = time || new Date();
    const lines = ['停車場回報', `${reportTime(date)} 保全回報停車情況：`];
    LABELS.forEach((label, index) => {
      lines.push(`${label}：${zoneInfo(index, tokens[index]).s}`);
    });
    return lines.join('\n');
  }

  function buildTowerUsage(tokens) {
    const rawUp = normalizeValue(tokens[0]);
    const rawDown = normalizeValue(tokens[1]);
    const up = parseInt(rawUp, 10);
    const down = parseInt(rawDown, 10);
    const valid = !Number.isNaN(up) && rawUp !== 'x' && !Number.isNaN(down) && rawDown !== 'x';
    if (!valid) return { valid: false, percent: null, remaining: null, occupied: null };

    const remaining = Math.max(0, up + down);
    const occupied = Math.min(TOWER_TOTAL, Math.max(0, TOWER_TOTAL - remaining));
    const percent = Math.round((occupied / TOWER_TOTAL) * 100);
    return { valid: true, percent, remaining, occupied };
  }

  return {
    LABELS,
    IS_CAR,
    TOWER_TOTAL,
    parseText,
    zoneInfo,
    buildLineReport,
    buildControlReport,
    buildExcelValues,
    buildTowerUsage,
  };
});
