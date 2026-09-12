import { test } from 'node:test';
import assert from 'node:assert/strict';
import { towerStatusWord, isException, exceptionItems } from '../public/js/office-exceptions.js';

const spaces = { code: 'floor_above', label: '車塔1上', unit: 'spaces', inTower: true };
const tenths = { code: 'spin_c', label: 'C區', unit: 'tenths', inTower: false };
const asphalt = { code: 'asphalt', label: '柏油路', unit: 'tenths', inTower: false };

test('towerStatusWord thresholds', () => {
  assert.equal(towerStatusWord(null), '');
  assert.equal(towerStatusWord(69), '正常');
  assert.equal(towerStatusWord(70), '偏高');
  assert.equal(towerStatusWord(89), '偏高');
  assert.equal(towerStatusWord(90), '注意');
});

test('isException kinds and tenths', () => {
  assert.equal(isException(spaces, { kind: 'full' }), true);
  assert.equal(isException(tenths, { kind: 'guiding' }), true);
  assert.equal(isException(asphalt, { kind: 'none' }), true);
  assert.equal(isException(tenths, { kind: 'tenths', value: 8 }), true);
  assert.equal(isException(tenths, { kind: 'tenths', value: 7 }), false);
  assert.equal(isException(spaces, { kind: 'spaces', value: 400 }), false);
});

test('exceptionItems preserves zone order and display', () => {
  const zones = [spaces, tenths, asphalt];
  const values = {
    floor_above: { kind: 'spaces', value: 200 },
    spin_c: { kind: 'guiding' },
    asphalt: { kind: 'none' },
  };
  assert.deepEqual(exceptionItems(values, zones), [
    { code: 'spin_c', label: 'C區', display: '引導中' },
    { code: 'asphalt', label: '柏油路', display: '未停車' },
  ]);
});
