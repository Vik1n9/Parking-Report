import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LABELS,
  IS_CAR,
  ALIAS_MAP,
  TIME_ZONE,
  parseText,
  zoneInfo,
  buildLineReport,
  buildControlReport,
  buildExcelValues,
  buildTowerUsage,
  formatTime,
  businessDate,
} from '../public/js/parking-core.js';

const sampleTime = new Date('2026-06-18T14:35:00+08:00');

test('labels and car flags preserved from v1', () => {
  assert.deepEqual(LABELS, ['一樓以上', '一樓以下', 'P1', 'P3', '紡A', '紡B', '紡C', '紡D', '紡E', '柏油路']);
  assert.deepEqual(IS_CAR, [true, true, false, false, false, false, false, false, false, false]);
});

test('parseText positional and pair syntax', () => {
  const parsed = parseText('423 256 7 7 E=0.4');
  assert.deepEqual(parsed, ['423', '256', '7', '7', 'x', 'x', 'x', 'x', '0.4', 'x']);
  assert.deepEqual(parseText('一樓以上=10 P1=5'), ['10', 'x', '5', 'x', 'x', 'x', 'x', 'x', 'x', 'x']);
});

test('zoneInfo display strings preserved from v1', () => {
  assert.deepEqual(zoneInfo(0, '423'), { cls: 'ok', s: '423 車位' });
  assert.deepEqual(zoneInfo(2, '8'), { cls: 'ok', s: '8 成' });
  assert.deepEqual(zoneInfo(4, '0'), { cls: 'full', s: '全滿' });
  assert.deepEqual(zoneInfo(8, '0.4'), { cls: 'few', s: '尚有 4 台' });
  assert.deepEqual(zoneInfo(3, 'x'), { cls: 'empty', s: '未停車' });
});

test('excel values preserved from v1', () => {
  const parsed = parseText('423 256 7 7 E=0.4');
  assert.deepEqual(
    buildExcelValues(parsed),
    ['423', '256', '7成', '7成', '未停車', '未停車', '未停車', '未停車', '4台車', '未停車']
  );
});

test('tower usage default indexes preserved from v1', () => {
  const parsed = parseText('423 256 7 7 E=0.4');
  assert.equal(buildTowerUsage(parsed).percent, 58);
});

test('tower usage honors custom zones and tower total', () => {
  const tokens = ['100', '100', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x'];
  const result = buildTowerUsage(tokens, { towerTotal: 400, towerIndexes: [0, 1] });
  assert.equal(result.percent, 50);
  assert.equal(result.remaining, 200);
  assert.equal(result.occupied, 200);

  const invalid = buildTowerUsage(['x', '100', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x'], {
    towerTotal: 400,
    towerIndexes: [0, 1],
  });
  assert.equal(invalid.valid, false);
});

test('line report preserved from v1', () => {
  const parsed = parseText('423 256 7 7 E=0.4');
  assert.equal(
    buildLineReport(parsed, sampleTime),
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
});

test('control report preserved from v1', () => {
  const parsed = parseText('423 256 7 7 E=0.4');
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
});

test('time formatting is explicit Asia/Taipei, independent of host timezone', () => {
  // 06:35 UTC == 14:35 Taipei regardless of the machine's local timezone
  const utcInstant = '2026-06-18T06:35:00Z';
  const parsed = parseText('423 256 7 7 E=0.4');
  assert.equal(formatTime(utcInstant), '14:35');
  assert.equal(buildLineReport(parsed, utcInstant).split('\n')[1], '14:35 保全回報停車情況：');
  assert.equal(buildControlReport(parsed, utcInstant).split('\n')[1], '14:35 保全回報停車情況：');
});

test('businessDate uses the reporting timezone, not the host', () => {
  // 2026-01-01 17:00 Taipei is still Jan 1; 2026-01-01 17:00 UTC is Jan 2 in Taipei
  assert.equal(businessDate('2026-01-01T17:00:00+08:00'), '2026-01-01');
  assert.equal(businessDate('2026-01-01T17:00:00Z'), '2026-01-02');
  assert.equal(businessDate('2026-01-01T17:00:00Z', 'UTC'), '2026-01-01');
});

test('time zone constant', () => {
  assert.equal(TIME_ZONE, 'Asia/Taipei');
  assert.equal(ALIAS_MAP.R, '柏油路');
});
