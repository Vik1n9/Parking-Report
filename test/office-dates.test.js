import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeEndingYesterday } from '../public/js/office-dates.js';

test('Taipei Monday: last 2 days are Sat-Sun', () => {
  const now = new Date('2026-09-14T04:00:00Z');
  assert.deepEqual(rangeEndingYesterday(2, now, 'Asia/Taipei'), {
    from: '2026-09-12',
    to: '2026-09-13',
  });
});

test('Taipei Monday: last 3 and 4 days', () => {
  const now = new Date('2026-09-14T04:00:00Z');
  assert.deepEqual(rangeEndingYesterday(3, now, 'Asia/Taipei'), {
    from: '2026-09-11',
    to: '2026-09-13',
  });
  assert.deepEqual(rangeEndingYesterday(4, now, 'Asia/Taipei'), {
    from: '2026-09-10',
    to: '2026-09-13',
  });
});

test('same instant is Sunday in UTC: last 2 days are Fri-Sat', () => {
  const now = new Date('2026-09-13T16:00:00Z');
  assert.deepEqual(rangeEndingYesterday(2, now, 'UTC'), {
    from: '2026-09-11',
    to: '2026-09-12',
  });
  assert.deepEqual(rangeEndingYesterday(2, now, 'Asia/Taipei'), {
    from: '2026-09-12',
    to: '2026-09-13',
  });
});

test('rejects non-integer n', () => {
  assert.throws(() => rangeEndingYesterday(0, new Date('2026-09-14T04:00:00Z')));
  assert.throws(() => rangeEndingYesterday(1.5, new Date('2026-09-14T04:00:00Z')));
});
