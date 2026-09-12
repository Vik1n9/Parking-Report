import { formatValue } from './parking-core.js';

export function towerStatusWord(pct) {
  if (pct == null) return '';
  if (pct >= 90) return '注意';
  if (pct >= 70) return '偏高';
  return '正常';
}

export function isException(zone, value) {
  const kind = value?.kind ?? 'none';
  if (kind === 'full' || kind === 'guiding' || kind === 'none') return true;
  if (zone.unit === 'tenths' && kind === 'tenths' && Number(value.value) >= 8) return true;
  return false;
}

export function exceptionItems(values, zones) {
  return zones.flatMap((zone) => {
    const value = values?.[zone.code] ?? { kind: 'none' };
    if (!isException(zone, value)) return [];
    return [{ code: zone.code, label: zone.label, display: formatValue(value) }];
  });
}
