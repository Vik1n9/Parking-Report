import { TIME_ZONE, businessDate } from './parking-core.js';

function shiftCivilDate(iso, deltaDays) {
  const [year, month, day] = iso.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day + deltaDays);
  const shifted = new Date(utc);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function rangeEndingYesterday(n, now = new Date(), timeZone = TIME_ZONE) {
  if (!Number.isInteger(n) || n < 1) throw new Error('n must be an integer >= 1');
  const today = businessDate(now, timeZone);
  const to = shiftCivilDate(today, -1);
  const from = shiftCivilDate(to, -(n - 1));
  return { from, to };
}
