const assert = require('node:assert/strict');
const {
  LABELS,
  IS_CAR,
  parseText,
  zoneInfo,
  buildLineReport,
  buildControlReport,
  buildExcelValues,
  buildTowerUsage,
} = require('./parking-core.js');

const sampleTime = new Date('2026-06-18T14:35:00+08:00');

assert.deepEqual(LABELS, ['一樓以上', '一樓以下', 'P1', 'P3', '紡A', '紡B', '紡C', '紡D', '紡E', '柏油路']);
assert.deepEqual(IS_CAR, [true, true, false, false, false, false, false, false, false, false]);

const parsed = parseText('423 256 7 7 E=0.4');
assert.deepEqual(parsed, ['423', '256', '7', '7', 'x', 'x', 'x', 'x', '0.4', 'x']);

assert.deepEqual(zoneInfo(0, '423'), { cls: 'ok', s: '423 車位' });
assert.deepEqual(zoneInfo(2, '8'), { cls: 'ok', s: '8 成' });
assert.deepEqual(zoneInfo(4, '0'), { cls: 'full', s: '全滿' });
assert.deepEqual(zoneInfo(8, '0.4'), { cls: 'few', s: '尚有 4 台' });

assert.deepEqual(buildExcelValues(parsed), ['423', '256', '7成', '7成', '未停車', '未停車', '未停車', '未停車', '4台車', '未停車']);

assert.equal(buildTowerUsage(parsed).percent, 58);

const lineReport = buildLineReport(parsed, sampleTime);
assert.equal(
  lineReport,
  [
    '停車場回報',
    '14:35 保全回報停車情況：',
    '一樓以上：423 車位',
    '一樓以下：256 車位',
    'P1：7 成',
    'P3：7 成',
    '紡A：未停車',
    '紡B：未停車',
    '紡C：未停車',
    '紡D：未停車',
    '紡E：尚有 4 台',
    '柏油路：未停車',
  ].join('\n')
);

assert.equal(
  buildControlReport(parsed, sampleTime),
  [
    '中控回報:',
    '14:35 保全回報停車情況：',
    '一樓以上423車位',
    '一樓以下256車位',
    'P1 尚有7成車位',
    'P3 尚有7成車位',
    '紡A 沒停車',
    '紡B 沒停車',
    '紡C 沒停車',
    '紡D 沒停車',
    '紡E 尚有4台車',
    '柏油路 沒停車',
  ].join('\n')
);

console.log('parking-core tests passed');
