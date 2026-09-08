import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KINDS,
  normalizeInput,
  validateValue,
  formatValue,
  buildReport,
  formatTime,
  businessDate,
  TIME_ZONE,
} from '../public/js/parking-core.js';

const towerZone = { code: 'floor_above', label: '車塔1上', excelLabel: '1F↑', position: 0, unit: 'spaces', inTower: true };
const tenthZone = { code: 'spin_a', label: 'A區', excelLabel: '紡織-A', position: 4, unit: 'tenths', inTower: false };

test('kinds are the six documented values', () => {
  assert.deepEqual(KINDS, ['spaces', 'tenths', 'carts', 'full', 'guiding', 'none']);
});

test('normalizeInput reads bare numbers by the zone unit', () => {
  assert.deepEqual(normalizeInput('232', towerZone), { kind: 'spaces', value: 232 });
  assert.deepEqual(normalizeInput('9', tenthZone), { kind: 'tenths', value: 9 });
  assert.deepEqual(normalizeInput(9, tenthZone), { kind: 'tenths', value: 9 });
});

test('normalizeInput folds zero remaining spaces into full', () => {
  assert.deepEqual(normalizeInput('0', towerZone), { kind: 'full' });
  assert.deepEqual(normalizeInput('0', tenthZone), { kind: 'full' });
});

test('normalizeInput accepts the hand-written wordings found in the real sheet', () => {
  assert.deepEqual(normalizeInput('滿', tenthZone), { kind: 'full' });
  assert.deepEqual(normalizeInput('全滿', tenthZone), { kind: 'full' });
  assert.deepEqual(normalizeInput('未停車', tenthZone), { kind: 'none' });
  assert.deepEqual(normalizeInput('引導中', tenthZone), { kind: 'guiding' });
  assert.deepEqual(normalizeInput('3成', tenthZone), { kind: 'tenths', value: 3 });
  assert.deepEqual(normalizeInput('3成空', tenthZone), { kind: 'tenths', value: 3 });
  assert.deepEqual(normalizeInput('停2台', tenthZone), { kind: 'carts', value: 2 });
  assert.deepEqual(normalizeInput('2台車', tenthZone), { kind: 'carts', value: 2 });
  assert.deepEqual(normalizeInput('2台', tenthZone), { kind: 'carts', value: 2 });
});

test('normalizeInput passes through already-structured values', () => {
  assert.deepEqual(normalizeInput({ kind: 'carts', value: 2 }, tenthZone), { kind: 'carts', value: 2 });
  assert.deepEqual(normalizeInput({ kind: 'full' }, tenthZone), { kind: 'full' });
});

test('normalizeInput treats empty input as none', () => {
  assert.deepEqual(normalizeInput('', tenthZone), { kind: 'none' });
  assert.deepEqual(normalizeInput(null, tenthZone), { kind: 'none' });
  assert.deepEqual(normalizeInput(undefined, tenthZone), { kind: 'none' });
});

test('normalizeInput rejects junk instead of guessing', () => {
  assert.throws(() => normalizeInput('9誠', tenthZone), /無法解析/);
  assert.throws(() => normalizeInput('馬來食品', tenthZone), /無法解析/);
});

test('validateValue enforces the documented ranges', () => {
  assert.deepEqual(validateValue({ kind: 'spaces', value: 232 }, towerZone), { ok: true });
  assert.equal(validateValue({ kind: 'spaces', value: 10000 }, towerZone).ok, false);
  assert.equal(validateValue({ kind: 'tenths', value: 10 }, tenthZone).ok, false);
  assert.equal(validateValue({ kind: 'tenths', value: 0 }, tenthZone).ok, false);
  assert.equal(validateValue({ kind: 'carts', value: 0 }, tenthZone).ok, false);
  assert.equal(validateValue({ kind: 'carts', value: 100 }, tenthZone).ok, false);
  assert.equal(validateValue({ kind: 'nope' }, tenthZone).ok, false);
});

test('validateValue rejects a value on the valueless kinds', () => {
  assert.equal(validateValue({ kind: 'full', value: 1 }, tenthZone).ok, false);
  assert.equal(validateValue({ kind: 'guiding', value: 1 }, tenthZone).ok, false);
  assert.equal(validateValue({ kind: 'none', value: 1 }, tenthZone).ok, false);
});

test('validateValue rejects spaces on a tenths zone and vice versa', () => {
  assert.equal(validateValue({ kind: 'spaces', value: 5 }, tenthZone).ok, false);
  assert.equal(validateValue({ kind: 'tenths', value: 5 }, towerZone).ok, false);
});

test('formatValue is the single source of wording', () => {
  assert.equal(formatValue({ kind: 'spaces', value: 232 }, towerZone), '232車位');
  assert.equal(formatValue({ kind: 'tenths', value: 3 }, tenthZone), '3成空');
  assert.equal(formatValue({ kind: 'carts', value: 2 }, tenthZone), '停2台');
  assert.equal(formatValue({ kind: 'full' }, tenthZone), '滿');
  assert.equal(formatValue({ kind: 'guiding' }, tenthZone), '引導中');
  assert.equal(formatValue({ kind: 'none' }, tenthZone), '未停車');
});

test('time formatting is explicit Asia/Taipei, independent of host timezone', () => {
  assert.equal(formatTime(new Date('2026-01-02T06:35:00Z')), '14:35');
  assert.equal(businessDate(new Date('2026-01-02T16:30:00Z')), '2026-01-03');
  assert.equal(TIME_ZONE, 'Asia/Taipei');
});

const ZONES = [
  { code: 'floor_above', label: '車塔1上', excelLabel: '1F↑', position: 0, unit: 'spaces', inTower: true },
  { code: 'floor_below', label: '車塔1下', excelLabel: '1F↓', position: 1, unit: 'spaces', inTower: true },
  { code: 'p1', label: 'P1', excelLabel: 'P1', position: 2, unit: 'tenths', inTower: false },
  { code: 'p3', label: 'P3', excelLabel: 'P3', position: 3, unit: 'tenths', inTower: false },
  { code: 'spin_a', label: 'A區', excelLabel: '紡織-A', position: 4, unit: 'tenths', inTower: false },
  { code: 'spin_b', label: 'B區', excelLabel: '紡織-B', position: 5, unit: 'tenths', inTower: false },
  { code: 'spin_c', label: 'C區', excelLabel: '紡織-C', position: 6, unit: 'tenths', inTower: false },
  { code: 'spin_d', label: 'D區', excelLabel: '紡織-D', position: 7, unit: 'tenths', inTower: false },
  { code: 'spin_e', label: 'E區', excelLabel: '紡織-E', position: 8, unit: 'tenths', inTower: false },
  { code: 'asphalt', label: '柏油路', excelLabel: '柏油路', position: 9, unit: 'tenths', inTower: false },
];

const SAMPLE = {
  floor_above: { kind: 'full' },
  floor_below: { kind: 'spaces', value: 232 },
  p1: { kind: 'tenths', value: 3 },
  p3: { kind: 'tenths', value: 4 },
  spin_a: { kind: 'full' },
  spin_b: { kind: 'carts', value: 2 },
  spin_c: { kind: 'guiding' },
  spin_d: { kind: 'none' },
  spin_e: { kind: 'none' },
  asphalt: { kind: 'none' },
};

const AT_1237 = new Date('2026-09-09T04:37:00Z'); // 台北 12:37

test('guard style keeps one line per zone with a full-width colon', () => {
  assert.equal(
    buildReport(SAMPLE, ZONES, { style: 'guard', time: AT_1237 }),
    [
      '停車場回報',
      '12:37 保全回報停車情況：',
      '車塔1上：滿',
      '車塔1下：232車位',
      'P1：3成空',
      'P3：4成空',
      'A區：滿',
      'B區：停2台',
      'C區：引導中',
      'D區：未停車',
      'E區：未停車',
      '柏油路：未停車',
    ].join('\n')
  );
});

test('console style carries the device code and merges the trailing none run', () => {
  assert.equal(
    buildReport(SAMPLE, ZONES, { style: 'console', time: AT_1237, deviceLabel: 'A1' }),
    [
      '中控回報：12:37 A1回報',
      '車塔1上 滿',
      '車塔1下 232車位',
      'P1 3成空',
      'P3 4成空',
      'A區 滿',
      'B區 停2台',
      'C區 引導中',
      'D區、E區及柏油路未停車。',
    ].join('\n')
  );
});

test('console style joins exactly two merged zones with 及', () => {
  const values = { ...SAMPLE, asphalt: { kind: 'full' } };
  const lines = buildReport(values, ZONES, { style: 'console', time: AT_1237, deviceLabel: 'A1' }).split('\n');
  assert.equal(lines.at(-2), 'D區及E區未停車。');
  assert.equal(lines.at(-1), '柏油路 滿');
});

test('console style leaves a lone none zone as a normal line', () => {
  const values = { ...SAMPLE, spin_e: { kind: 'full' }, asphalt: { kind: 'full' } };
  const lines = buildReport(values, ZONES, { style: 'console', time: AT_1237, deviceLabel: 'A1' });
  assert.match(lines, /\nD區 未停車\n/);
  assert.doesNotMatch(lines, /。/);
});

test('console style merges a non-trailing none run too', () => {
  const values = { ...SAMPLE, spin_a: { kind: 'none' }, spin_b: { kind: 'none' }, spin_c: { kind: 'full' } };
  const text = buildReport(values, ZONES, { style: 'console', time: AT_1237, deviceLabel: 'A1' });
  assert.match(text, /\nA區及B區未停車。\n/);
  assert.match(text, /\nC區 滿\n/);
});

test('console style omits the device code when there is none', () => {
  const text = buildReport(SAMPLE, ZONES, { style: 'console', time: AT_1237 });
  assert.equal(text.split('\n')[0], '中控回報：12:37 保全回報');
});

test('buildReport treats a missing zone code as not parked', () => {
  const text = buildReport({}, ZONES, { style: 'guard', time: AT_1237 });
  assert.match(text, /車塔1上：未停車/);
});
