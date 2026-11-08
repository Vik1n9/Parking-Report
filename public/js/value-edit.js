// 中控與隊長複核共用的單格修正：解析輸入、比對值、疊上基準值。
import { normalizeInput, validateValue } from './parking-core.js';

export function sameValue(a, b) {
  return a?.kind === b?.kind && a?.value === b?.value;
}

export function parseCorrection(text, zone) {
  try {
    const value = normalizeInput(text, zone);
    const check = validateValue(value, zone);
    if (!check.ok) return { ok: false, error: check.error || '值不正確' };
    return { ok: true, value };
  } catch {
    return { ok: false, error: '無法解析' };
  }
}

/** 回傳最終值與「相對基準」的修正，只記真的變動的區域。 */
export function mergeCorrections(baseValues, parsedValues) {
  const merged = { ...baseValues };
  const corrections = {};
  for (const [code, value] of Object.entries(parsedValues)) {
    if (!sameValue(value, baseValues[code])) {
      merged[code] = value;
      corrections[code] = value;
    }
  }
  return { merged, corrections };
}
