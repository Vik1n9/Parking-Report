import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KINDS,
  normalizeInput,
  validateValue,
  formatValue,
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
