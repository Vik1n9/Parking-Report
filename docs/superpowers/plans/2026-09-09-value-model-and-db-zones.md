# 值模型重構、區域 DB 驅動、主管頁公開 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把停車回報的值從字串 DSL（`x` / `0` / `N` / `0.N`）換成六種 `kind` 的結構化模型，區域定義全部收斂到 D1，主管頁改成免認證唯讀。

**Architecture:** `public/js/parking-core.js` 成為唯一的值語意與措辭來源，不再持有任何區域知識 — 所有函式吃呼叫端傳入的 `zones` 陣列。D1 的 `zones.unit` 決定裸數字語意（`spaces` = 剩餘車位、`tenths` = 成數）。Worker 與三個前端頁面共用同一份 core 與同一份 `/api/zones`。保全頁以「API → localStorage 快取 → 頁內預設」三層 fallback 維持離線可用。

**Tech Stack:** Cloudflare Workers（ESM）、D1（SQLite）、ExcelJS、原生 ESM 前端（無 build step）、`node --test` + `node:sqlite`。

## Global Constraints

- 規格文件：`docs/superpowers/specs/2026-09-09-value-model-and-db-zones-design.md`，衝突時以規格為準。
- 六種 kind，字串 enum，順序固定：`spaces` / `tenths` / `carts` / `full` / `guiding` / `none`。
- 值域：`spaces` 0–9999、`tenths` 1–9、`carts` 1–99。`full` / `guiding` / `none` 不得帶 `value`。
- 值措辭只有一份定義：`232車位` / `3成空` / `停2台` / `滿` / `引導中` / `未停車`。
- Excel 儲存格：`232`（數值）/ `3成`（數值 + numFmt `0"成"`）/ `停2台` / `滿` / `引導中` / `未停車`。
- 時間一律經 `formatTime` / `businessDate`，預設時區 `Asia/Taipei`，禁止 `getHours()`。
- 測試必須在 `TZ=Asia/Taipei` 與 `TZ=UTC` 兩種環境下皆通過。
- **測試資料的填表人、裝置代號一律使用假名**（例如 `A1`、`測試員`、`console@example.test`）。不得寫入真實姓名。
- `public/guard.html` 的強光/單手/首屏版型原則不得退化；本計畫只允許新增一顆「引導中」按鈕，數字鍵盤 3×4 格線不動。
- 每個 Task 結尾都 commit，訊息用 Conventional Commits。

---

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `public/js/parking-core.js` | 值語意、正規化、措辭、報表組裝、車塔計算 | 重寫 |
| `test/parking-core.test.js` | core 的行為測試 | 重寫 |
| `test/helpers/d1.js` | 以 `node:sqlite` 模擬 D1 介面供路由測試使用 | 新增 |
| `test/routes.test.js` | 後端路由測試 | 新增 |
| `migrations/0003_value_model.sql` | schema 遷移與舊資料轉換 | 新增 |
| `src/routes/zones.js` | zones 查詢與 API 形狀 | 修改 |
| `src/routes/reports.js` | 送出/佇列/確認/退回 | 修改 |
| `src/routes/records.js` | 紀錄查詢 | 修改 |
| `src/routes/public.js` | 公開唯讀端點 | 新增 |
| `src/export/xlsx.js` | Excel 匯出 | 修改 |
| `src/index.js` | 路由分派、`X-Robots-Tag` | 修改 |
| `public/guard.html` | 保全頁 | 修改 |
| `public/CenterConsole.html` | 中控頁 | 修改 |
| `public/ManagerDashboard.html` | 主管頁 | 修改 |
| `public/secretary.html` | 秘書頁 | 修改 |
| `test/guard-ui.test.js` | 保全頁版型約束 | 修改 |
| `.github/workflows/ci.yml` | CI | 修改 |
| `wrangler.jsonc` | 移除 Access vars | 修改 |
| `README.md` / `TODO.md` / `CLAUDE.md` | 文件 | 修改 |

---

### Task 1: parking-core — 值正規化與措辭

**Files:**
- Modify: `public/js/parking-core.js`（整檔重寫的第一部分）
- Test: `test/parking-core.test.js`（整檔重寫的第一部分）

**Interfaces:**
- Consumes: 無
- Produces:
  - `KINDS: string[]`
  - `normalizeInput(raw, zone) -> {kind, value?}`（無法解析時 throw `Error`）
  - `validateValue(value, zone) -> {ok: true} | {ok: false, error: string}`
  - `formatValue(value, zone) -> string`
  - `TIME_ZONE`、`formatTime(input, timeZone?)`、`businessDate(input, timeZone?)` 沿用現有實作，不動

`zone` 物件的形狀（本計畫全程一致）：`{ code, label, excelLabel, position, unit, inTower }`，`unit` 為 `'spaces' | 'tenths'`。

- [ ] **Step 1: 寫失敗的測試**

把 `test/parking-core.test.js` 整個換成以下內容（後續 Task 會往這個檔案追加）：

```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/parking-core.test.js`
Expected: FAIL — `SyntaxError: The requested module '../public/js/parking-core.js' does not provide an export named 'KINDS'`

- [ ] **Step 3: 實作**

把 `public/js/parking-core.js` 從第 1 行到 `normalizeValue` 為止的內容（常數 `LABELS` / `ALIAS_MAP` / `IS_CAR` / `DEFAULT_TOWER_TOTAL`、`normalizeKey`、`parseText`、`normalizeValue`）換成以下。時間相關的 `TIME_ZONE`、`timeFormatter`、`dateFormatter`、`toDate`、`formatTime`、`businessDate` 原樣保留。

```js
export const KINDS = ['spaces', 'tenths', 'carts', 'full', 'guiding', 'none'];

const RANGES = { spaces: [0, 9999], tenths: [1, 9], carts: [1, 99] };
const VALUELESS = new Set(['full', 'guiding', 'none']);

const WORDS = [
  [/^(滿|全滿)$/, () => ({ kind: 'full' })],
  [/^(未停車|沒停車|無停車)$/, () => ({ kind: 'none' })],
  [/^(引導中|車導中)$/, () => ({ kind: 'guiding' })],
  [/^(\d{1,2})成空?$/, (m) => ({ kind: 'tenths', value: Number(m[1]) })],
  [/^停(\d{1,2})台$/, (m) => ({ kind: 'carts', value: Number(m[1]) })],
  [/^(\d{1,2})台車?$/, (m) => ({ kind: 'carts', value: Number(m[1]) })],
];

export function normalizeInput(raw, zone) {
  if (raw && typeof raw === 'object' && typeof raw.kind === 'string') {
    return raw.value === undefined ? { kind: raw.kind } : { kind: raw.kind, value: raw.value };
  }
  const text = String(raw ?? '').trim();
  if (!text) return { kind: 'none' };

  for (const [re, build] of WORDS) {
    const match = text.match(re);
    if (match) return build(match);
  }
  if (/^\d{1,4}$/.test(text)) {
    const n = Number(text);
    if (n === 0) return { kind: 'full' };
    return zone.unit === 'spaces' ? { kind: 'spaces', value: n } : { kind: 'tenths', value: n };
  }
  throw new Error(`無法解析的值：${text}`);
}

export function validateValue(value, zone) {
  if (!value || typeof value !== 'object') return { ok: false, error: '值必須是物件' };
  const { kind } = value;
  if (!KINDS.includes(kind)) return { ok: false, error: `未知的 kind：${kind}` };

  if (VALUELESS.has(kind)) {
    if (value.value !== undefined) return { ok: false, error: `${kind} 不得帶 value` };
    return { ok: true };
  }
  if (kind === 'spaces' && zone.unit !== 'spaces') return { ok: false, error: `${zone.code} 不是車位數區` };
  if (kind === 'tenths' && zone.unit !== 'tenths') return { ok: false, error: `${zone.code} 不是成數區` };

  const [min, max] = RANGES[kind];
  if (!Number.isInteger(value.value) || value.value < min || value.value > max) {
    return { ok: false, error: `${kind} 的值必須是 ${min}-${max} 的整數` };
  }
  return { ok: true };
}

export function formatValue(value) {
  switch (value?.kind) {
    case 'spaces': return `${value.value}車位`;
    case 'tenths': return `${value.value}成空`;
    case 'carts': return `停${value.value}台`;
    case 'full': return '滿';
    case 'guiding': return '引導中';
    default: return '未停車';
  }
}
```

`formatValue` 宣告成單參數即可 — 措辭不因區而異，第二個 `zone` 參數傳進來會被忽略，測試照樣通過。

- [ ] **Step 4: 跑測試確認通過**

Run: `TZ=Asia/Taipei node --test test/parking-core.test.js && TZ=UTC node --test test/parking-core.test.js`
Expected: 兩次都 PASS。此時 `zoneInfo` / `toExcel` / `buildExcelValues` / `buildControlReport` / `buildLineReport` / `buildTowerUsage` 仍是舊實作、仍留在檔案裡（Task 2、3 會換掉），但因為舊測試已刪除，不會有人呼叫它們。

- [ ] **Step 5: Commit**

```bash
git add public/js/parking-core.js test/parking-core.test.js
git commit -m "feat: structured value model with six kinds in parking-core"
```

---

### Task 2: parking-core — buildReport 兩種外框

**Files:**
- Modify: `public/js/parking-core.js`
- Test: `test/parking-core.test.js`（追加）

**Interfaces:**
- Consumes: Task 1 的 `formatValue`、既有的 `formatTime`
- Produces: `buildReport(values, zones, opts) -> string`
  - `values`: `{[zoneCode]: {kind, value?}}`，缺漏的 code 視為 `{kind:'none'}`
  - `zones`: 已依 `position` 排序的 zone 陣列
  - `opts`: `{ style: 'guard' | 'console', time: Date|string, deviceLabel?: string, timeZone?: string }`

- [ ] **Step 1: 寫失敗的測試**

追加到 `test/parking-core.test.js`。同時把檔案最上方的 import 加上 `buildReport`。

```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/parking-core.test.js`
Expected: FAIL — 沒有匯出 `buildReport`

- [ ] **Step 3: 實作**

刪掉 `public/js/parking-core.js` 裡的 `zoneInfo`、`buildControlReport`、`buildLineReport`，換成：

```js
function joinLabels(labels) {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join('、')}及${labels.at(-1)}`;
}

export function buildReport(values, zones, opts = {}) {
  const { style = 'guard', time, deviceLabel, timeZone } = opts;
  const clock = formatTime(time, timeZone ?? TIME_ZONE);
  const read = (zone) => normalizeInput(values?.[zone.code], zone);

  if (style === 'guard') {
    const lines = ['停車場回報', `${clock} 保全回報停車情況：`];
    for (const zone of zones) lines.push(`${zone.label}：${formatValue(read(zone))}`);
    return lines.join('\n');
  }

  const lines = [`中控回報：${clock} ${deviceLabel || '保全'}回報`];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    if (run.length === 1) lines.push(`${run[0]} 未停車`);
    else lines.push(`${joinLabels(run)}未停車。`);
    run = [];
  };
  for (const zone of zones) {
    const value = read(zone);
    if (value.kind === 'none') {
      run.push(zone.label);
      continue;
    }
    flush();
    lines.push(`${zone.label} ${formatValue(value)}`);
  }
  flush();
  return lines.join('\n');
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `TZ=Asia/Taipei node --test test/parking-core.test.js && TZ=UTC node --test test/parking-core.test.js`
Expected: 兩次都 PASS

- [ ] **Step 5: Commit**

```bash
git add public/js/parking-core.js test/parking-core.test.js
git commit -m "feat: single buildReport with guard and console framings"
```

---

### Task 3: parking-core — Excel 值與車塔使用率改吃 zones

**Files:**
- Modify: `public/js/parking-core.js`
- Test: `test/parking-core.test.js`（追加）

**Interfaces:**
- Consumes: Task 1 的 `normalizeInput`
- Produces:
  - `excelCell(value) -> { value: number|string, numFmt?: string }`
  - `buildExcelValues(values, zones) -> Array<{ value, numFmt? }>`（順序同 `zones`）
  - `buildTowerUsage(values, zones, opts) -> { valid, percent, remaining, occupied }`，`opts = { towerTotal }`

- [ ] **Step 1: 寫失敗的測試**

追加到 `test/parking-core.test.js`，import 加上 `excelCell`、`buildExcelValues`、`buildTowerUsage`。

```js
test('excelCell writes numbers as numbers and tenths with a number format', () => {
  assert.deepEqual(excelCell({ kind: 'spaces', value: 232 }), { value: 232 });
  assert.deepEqual(excelCell({ kind: 'tenths', value: 3 }), { value: 3, numFmt: '0"成"' });
  assert.deepEqual(excelCell({ kind: 'carts', value: 2 }), { value: '停2台' });
  assert.deepEqual(excelCell({ kind: 'full' }), { value: '滿' });
  assert.deepEqual(excelCell({ kind: 'guiding' }), { value: '引導中' });
  assert.deepEqual(excelCell({ kind: 'none' }), { value: '未停車' });
});

test('buildExcelValues follows zone order and fills gaps with not parked', () => {
  const cells = buildExcelValues({ p1: { kind: 'tenths', value: 3 } }, ZONES);
  assert.equal(cells.length, 10);
  assert.deepEqual(cells[0], { value: '未停車' });
  assert.deepEqual(cells[2], { value: 3, numFmt: '0"成"' });
});

test('tower usage sums the in-tower zones and treats full as zero remaining', () => {
  const usage = buildTowerUsage(
    { floor_above: { kind: 'spaces', value: 400 }, floor_below: { kind: 'full' } },
    ZONES,
    { towerTotal: 1600 }
  );
  assert.deepEqual(usage, { valid: true, percent: 75, remaining: 400, occupied: 1200 });
});

test('tower usage is invalid when an in-tower zone has no number', () => {
  for (const kind of ['none', 'guiding']) {
    const usage = buildTowerUsage(
      { floor_above: { kind: 'spaces', value: 100 }, floor_below: { kind } },
      ZONES,
      { towerTotal: 1600 }
    );
    assert.equal(usage.valid, false, `${kind} should invalidate tower usage`);
    assert.equal(usage.percent, null);
  }
});

test('tower usage ignores zones that are not in the tower', () => {
  const usage = buildTowerUsage(
    { floor_above: { kind: 'full' }, floor_below: { kind: 'full' }, p1: { kind: 'tenths', value: 9 } },
    ZONES,
    { towerTotal: 1600 }
  );
  assert.deepEqual(usage, { valid: true, percent: 100, remaining: 0, occupied: 1600 });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/parking-core.test.js`
Expected: FAIL — 沒有匯出 `excelCell`

- [ ] **Step 3: 實作**

刪掉 `public/js/parking-core.js` 裡的 `toExcel` 與舊的 `buildExcelValues`、`buildTowerUsage`，換成：

```js
export function excelCell(value) {
  switch (value?.kind) {
    case 'spaces': return { value: value.value };
    case 'tenths': return { value: value.value, numFmt: '0"成"' };
    case 'carts': return { value: `停${value.value}台` };
    case 'full': return { value: '滿' };
    case 'guiding': return { value: '引導中' };
    default: return { value: '未停車' };
  }
}

export function buildExcelValues(values, zones) {
  return zones.map((zone) => excelCell(normalizeInput(values?.[zone.code], zone)));
}

export function buildTowerUsage(values, zones, opts = {}) {
  const towerTotal = opts.towerTotal ?? 0;
  const towerZones = zones.filter((zone) => zone.inTower);
  const invalid = { valid: false, percent: null, remaining: null, occupied: null };
  if (towerTotal <= 0 || !towerZones.length) return invalid;

  let remaining = 0;
  for (const zone of towerZones) {
    const value = normalizeInput(values?.[zone.code], zone);
    if (value.kind === 'full') continue;
    if (value.kind !== 'spaces') return invalid;
    remaining += value.value;
  }
  const occupied = Math.min(towerTotal, Math.max(0, towerTotal - remaining));
  return { valid: true, percent: Math.round((occupied / towerTotal) * 100), remaining, occupied };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `TZ=Asia/Taipei node --test test/parking-core.test.js && TZ=UTC node --test test/parking-core.test.js`
Expected: 兩次都 PASS。`public/js/parking-core.js` 現在應該只匯出：`TIME_ZONE`、`KINDS`、`formatTime`、`businessDate`、`normalizeInput`、`validateValue`、`formatValue`、`buildReport`、`excelCell`、`buildExcelValues`、`buildTowerUsage`。確認檔案裡已無 `LABELS`、`IS_CAR`、`ALIAS_MAP`、`parseText`、`zoneInfo`、`toExcel`、`DEFAULT_TOWER_TOTAL`：

Run: `grep -nE 'LABELS|IS_CAR|ALIAS_MAP|parseText|zoneInfo|toExcel|DEFAULT_TOWER_TOTAL' public/js/parking-core.js`
Expected: 無輸出

- [ ] **Step 5: Commit**

```bash
git add public/js/parking-core.js test/parking-core.test.js
git commit -m "feat: excel cells and tower usage read zones instead of constants"
```

---

### Task 4: D1 遷移與測試用 D1 替身

**Files:**
- Create: `migrations/0003_value_model.sql`
- Create: `test/helpers/d1.js`
- Test: `test/migrations.test.js`

**Interfaces:**
- Consumes: 無
- Produces: `createTestDb(options) -> D1Like`
  - `D1Like.prepare(sql).bind(...args)` 回傳同物件；`.first()` → `Promise<row|null>`；`.all()` → `Promise<{results}>`；`.run()` → `Promise<{meta:{last_row_id, changes}}>`
  - `D1Like.batch(stmts)` → `Promise<Array<{meta}>>`
  - `options`: `{ seed = true, migrations = ['0001_init.sql','0002_seed.sql','0003_value_model.sql'] }`
  - `D1Like.close()` 釋放記憶體資料庫

- [ ] **Step 1: 寫失敗的測試**

建立 `test/migrations.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.js';

test('zones carry a unit and the LINE-facing labels after migration', async () => {
  const db = createTestDb();
  const { results } = await db.prepare('SELECT code, label, excel_label, unit, in_tower FROM zones ORDER BY position').all();
  assert.equal(results.length, 10);
  assert.deepEqual(results[0], { code: 'floor_above', label: '車塔1上', excel_label: '1F↑', unit: 'spaces', in_tower: 1 });
  assert.deepEqual(results[4], { code: 'spin_a', label: 'A區', excel_label: '紡織-A', unit: 'tenths', in_tower: 0 });
  db.close();
});

test('zones no longer has is_car', async () => {
  const db = createTestDb();
  const { results } = await db.prepare("SELECT name FROM pragma_table_info('zones')").all();
  const names = results.map((r) => r.name);
  assert.ok(names.includes('unit'));
  assert.ok(!names.includes('is_car'));
  db.close();
});

test('reports and records expose values_json and the renamed report columns', async () => {
  const db = createTestDb();
  const reportCols = (await db.prepare("SELECT name FROM pragma_table_info('reports')").all()).results.map((r) => r.name);
  const recordCols = (await db.prepare("SELECT name FROM pragma_table_info('records')").all()).results.map((r) => r.name);
  assert.ok(reportCols.includes('values_json'));
  assert.ok(!reportCols.includes('tokens_json'));
  assert.ok(recordCols.includes('values_json'));
  assert.ok(recordCols.includes('guard_report'));
  assert.ok(recordCols.includes('console_report'));
  assert.ok(!recordCols.includes('line_report'));
  assert.ok(!recordCols.includes('control_report'));
  db.close();
});

test('the migration converts legacy token strings into structured values', async () => {
  const db = createTestDb({ migrations: ['0001_init.sql', '0002_seed.sql'] });
  await db
    .prepare(
      `INSERT INTO reports (site_id, device_id, status, client_request_id, tokens_json, business_date, submitted_at)
       VALUES (1, NULL, 'pending', 'legacy-0001', ?, '2026-09-01', '2026-09-01T04:00:00.000Z')`
    )
    .bind(JSON.stringify({ floor_above: '423', floor_below: '0', p1: '7', spin_a: '0.4', asphalt: 'x' }))
    .run();
  await db.applyMigration('0003_value_model.sql');

  const row = await db.prepare('SELECT values_json FROM reports WHERE client_request_id = ?').bind('legacy-0001').first();
  const values = JSON.parse(row.values_json);
  assert.deepEqual(values.floor_above, { kind: 'spaces', value: 423 });
  assert.deepEqual(values.floor_below, { kind: 'full' });
  assert.deepEqual(values.p1, { kind: 'tenths', value: 7 });
  assert.deepEqual(values.spin_a, { kind: 'carts', value: 4 });
  assert.deepEqual(values.asphalt, { kind: 'none' });
  db.close();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/migrations.test.js`
Expected: FAIL — `Cannot find module './helpers/d1.js'`

- [ ] **Step 3a: 寫 D1 替身**

建立 `test/helpers/d1.js`：

```js
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

class Stmt {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    this.args = args.map((a) => (a === undefined ? null : a));
    return this;
  }
  async first() {
    const row = this.db.prepare(this.sql).get(...this.args);
    return row ? { ...row } : null;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args).map((row) => ({ ...row })) };
  }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return { meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } };
  }
}

export function createTestDb(options = {}) {
  const { migrations = ['0001_init.sql', '0002_seed.sql', '0003_value_model.sql'] } = options;
  const db = new DatabaseSync(':memory:');
  const api = {
    prepare: (sql) => new Stmt(db, sql),
    batch: async (stmts) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const stmt of stmts) out.push(await stmt.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    applyMigration: (name) => db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8')),
    close: () => db.close(),
  };
  for (const name of migrations) api.applyMigration(name);
  return api;
}
```

- [ ] **Step 3b: 寫 migration**

建立 `migrations/0003_value_model.sql`：

```sql
-- zones：unit 取代 is_car，label 改用現場口語（LINE 與畫面共用）
CREATE TABLE zones_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL DEFAULT 1 REFERENCES sites (id),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  excel_label TEXT NOT NULL,
  position INTEGER NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('spaces', 'tenths')),
  in_tower INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

INSERT INTO zones_new (id, site_id, code, label, excel_label, position, unit, in_tower, active)
SELECT id, site_id, code, label, excel_label, position,
       CASE WHEN is_car = 1 THEN 'spaces' ELSE 'tenths' END,
       in_tower, active
FROM zones;

DROP TABLE zones;
ALTER TABLE zones_new RENAME TO zones;

UPDATE zones SET label = '車塔1上' WHERE code = 'floor_above';
UPDATE zones SET label = '車塔1下' WHERE code = 'floor_below';
UPDATE zones SET label = 'A區'     WHERE code = 'spin_a';
UPDATE zones SET label = 'B區'     WHERE code = 'spin_b';
UPDATE zones SET label = 'C區'     WHERE code = 'spin_c';
UPDATE zones SET label = 'D區'     WHERE code = 'spin_d';
UPDATE zones SET label = 'E區'     WHERE code = 'spin_e';

-- reports / records：欄位更名
ALTER TABLE reports RENAME COLUMN tokens_json TO values_json;
ALTER TABLE records RENAME COLUMN tokens_json TO values_json;
ALTER TABLE records RENAME COLUMN line_report TO guard_report;
ALTER TABLE records RENAME COLUMN control_report TO console_report;

-- 舊值轉換：x→none、0→full、0.N→carts、其餘整數依 zones.unit 判斷
UPDATE reports SET values_json = (
  SELECT json_group_object(z.code, CASE
    WHEN v.value IS NULL OR lower(v.value) = 'x' THEN json_object('kind', 'none')
    WHEN v.value = '0' THEN json_object('kind', 'full')
    WHEN v.value LIKE '0.%' THEN json_object('kind', 'carts', 'value', CAST(substr(v.value, 3) AS INTEGER))
    WHEN z.unit = 'spaces' THEN json_object('kind', 'spaces', 'value', CAST(v.value AS INTEGER))
    ELSE json_object('kind', 'tenths', 'value', CAST(v.value AS INTEGER))
  END)
  FROM zones z LEFT JOIN json_each(reports.values_json) v ON v.key = z.code
);

UPDATE records SET values_json = (
  SELECT json_group_object(z.code, CASE
    WHEN v.value IS NULL OR lower(v.value) = 'x' THEN json_object('kind', 'none')
    WHEN v.value = '0' THEN json_object('kind', 'full')
    WHEN v.value LIKE '0.%' THEN json_object('kind', 'carts', 'value', CAST(substr(v.value, 3) AS INTEGER))
    WHEN z.unit = 'spaces' THEN json_object('kind', 'spaces', 'value', CAST(v.value AS INTEGER))
    ELSE json_object('kind', 'tenths', 'value', CAST(v.value AS INTEGER))
  END)
  FROM zones z LEFT JOIN json_each(records.values_json) v ON v.key = z.code
);
```

- [ ] **Step 4: 跑測試確認通過**

Run: `TZ=Asia/Taipei node --test test/migrations.test.js && TZ=UTC node --test test/migrations.test.js`
Expected: 兩次都 PASS

再套到本機 D1 確認 migration 在真的 D1 上跑得動：

Run: `npm run db:migrate:local`
Expected: 顯示套用 `0003_value_model.sql` 成功

- [ ] **Step 5: Commit**

```bash
git add migrations/0003_value_model.sql test/helpers/d1.js test/migrations.test.js
git commit -m "feat: migrate zones to unit column and reports to structured values"
```

---

### Task 5: 後端路由改用值模型

**Files:**
- Modify: `src/routes/zones.js`
- Modify: `src/routes/reports.js`
- Modify: `src/routes/records.js`
- Test: `test/routes.test.js`

**Interfaces:**
- Consumes: Task 1–3 的 core、Task 4 的 `createTestDb`
- Produces:
  - `getActiveZones(db) -> Promise<Array<{code,label,excelLabel,position,unit,inTower}>>`
  - `toApiZones(zones)` 形狀同上（`isCar` 移除、新增 `unit`）
  - `createReport(env, request, device)`：body 由 `tokens` 改 `values`
  - `shapeReport(row, zones)` 回傳 `{..., values}`（`tokens` / `values` 陣列欄位移除）
  - `records` 的 API 欄位：`values`、`guardReport`、`consoleReport`

- [ ] **Step 1: 寫失敗的測試**

建立 `test/routes.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.js';
import { getActiveZones, toApiZones } from '../src/routes/zones.js';
import { createReport, listReports, confirmReport, rejectReport } from '../src/routes/reports.js';
import { listRecords } from '../src/routes/records.js';

const DEVICE = { deviceId: 1, deviceLabel: 'A1' };
const IDENTITY = { email: 'console@example.test' };

function envWith(db) {
  return { DB: db };
}

function post(body) {
  return new Request('https://example.test/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides = {}) {
  return {
    client_request_id: 'req-00000001',
    client_submitted_at: new Date().toISOString(),
    values: {
      floor_above: { kind: 'spaces', value: 232 },
      floor_below: { kind: 'full' },
      p1: { kind: 'tenths', value: 3 },
      spin_b: { kind: 'carts', value: 2 },
      spin_c: { kind: 'guiding' },
    },
    ...overrides,
  };
}

async function seededDb() {
  const db = createTestDb();
  await db.prepare("INSERT INTO guard_devices (id, label, token_hash) VALUES (1, 'A1', 'hash')").run();
  return db;
}

test('zones expose unit and no longer expose isCar', async () => {
  const db = createTestDb();
  const zones = toApiZones(await getActiveZones(db));
  assert.equal(zones[0].unit, 'spaces');
  assert.equal(zones[0].label, '車塔1上');
  assert.equal(zones[4].unit, 'tenths');
  assert.ok(!('isCar' in zones[0]));
  db.close();
});

test('createReport stores structured values and defaults missing zones to none', async () => {
  const db = await seededDb();
  const res = await createReport(envWith(db), post(validBody()), DEVICE);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(body.report.values.floor_above, { kind: 'spaces', value: 232 });
  assert.deepEqual(body.report.values.asphalt, { kind: 'none' });
  db.close();
});

test('createReport rejects an unknown zone code', async () => {
  const db = await seededDb();
  const res = await createReport(envWith(db), post(validBody({ values: { nope: { kind: 'full' } } })), DEVICE);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /未知區域/);
  db.close();
});

test('createReport rejects an unknown kind', async () => {
  const db = await seededDb();
  const res = await createReport(envWith(db), post(validBody({ values: { p1: { kind: 'sideways' } } })), DEVICE);
  assert.equal(res.status, 400);
  db.close();
});

test('createReport rejects out-of-range and mismatched-unit values', async () => {
  const db = await seededDb();
  const cases = [
    { p1: { kind: 'tenths', value: 10 } },
    { p1: { kind: 'tenths', value: 0 } },
    { p1: { kind: 'spaces', value: 5 } },
    { floor_above: { kind: 'tenths', value: 5 } },
    { p1: { kind: 'carts', value: 0 } },
    { p1: { kind: 'full', value: 1 } },
  ];
  for (const values of cases) {
    const res = await createReport(envWith(db), post(validBody({ values })), DEVICE);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(values)}`);
  }
  db.close();
});

test('createReport is idempotent on the same client_request_id', async () => {
  const db = await seededDb();
  await createReport(envWith(db), post(validBody()), DEVICE);
  const again = await createReport(envWith(db), post(validBody()), DEVICE);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true);
  db.close();
});

test('confirmReport recomputes both report texts and the tower percentage', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), DEVICE)).json();
  const req = new Request('https://example.test/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ remarks: { p1: '施工' } }),
  });
  const res = await confirmReport(envWith(db), created.report.id, req, IDENTITY);
  assert.equal(res.status, 201);
  const { record } = await res.json();
  assert.match(record.guardReport, /^停車場回報\n/);
  assert.match(record.consoleReport, /^中控回報：\d\d:\d\d A1回報\n/);
  assert.equal(record.towerPct, 86); // 1600 總數，剩 232 → 已停 1368 → 86%
  assert.deepEqual(record.remarks, { p1: '施工' });
  db.close();
});

test('listReports returns pending reports with their values', async () => {
  const db = await seededDb();
  await createReport(envWith(db), post(validBody()), DEVICE);
  const res = await listReports(envWith(db), new URL('https://example.test/api/reports?status=pending'));
  const body = await res.json();
  assert.equal(body.reports.length, 1);
  assert.equal(body.reports[0].deviceLabel, 'A1');
  assert.deepEqual(body.reports[0].values.floor_below, { kind: 'full' });
  db.close();
});

test('rejectReport keeps the report out of the confirmed path', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), DEVICE)).json();
  const req = new Request('https://example.test/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '數字看起來不對' }),
  });
  await rejectReport(envWith(db), created.report.id, req);
  const confirmRes = await confirmReport(envWith(db), created.report.id, new Request('https://example.test/confirm', { method: 'POST' }), IDENTITY);
  assert.equal(confirmRes.status, 409);
  db.close();
});

test('listRecords returns values and both report texts', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), DEVICE)).json();
  await confirmReport(envWith(db), created.report.id, new Request('https://example.test/confirm', { method: 'POST' }), IDENTITY);
  const today = created.report.businessDate;
  const res = await listRecords(envWith(db), new URL(`https://example.test/api/records?from=${today}&to=${today}`));
  const body = await res.json();
  assert.equal(body.records.length, 1);
  assert.deepEqual(body.records[0].values.p1, { kind: 'tenths', value: 3 });
  assert.ok(body.records[0].guardReport);
  assert.ok(body.records[0].consoleReport);
  db.close();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/routes.test.js`
Expected: FAIL — `getActiveZones` 仍查 `is_car`，SQLite 報 `no such column: is_car`

- [ ] **Step 3a: 改 `src/routes/zones.js`**

```js
export async function getActiveZones(db) {
  const { results } = await db
    .prepare(
      'SELECT code, label, excel_label, position, unit, in_tower FROM zones WHERE active = 1 AND site_id = 1 ORDER BY position'
    )
    .all();
  return results.map((z) => ({
    code: z.code,
    label: z.label,
    excelLabel: z.excel_label,
    position: z.position,
    unit: z.unit,
    inTower: !!z.in_tower,
  }));
}

export function toApiZones(zones) {
  return zones.map(({ code, label, excelLabel, position, unit, inTower }) => ({
    code,
    label,
    excelLabel,
    position,
    unit,
    inTower,
  }));
}

export async function getSite(db) {
  return db.prepare('SELECT id, name, tower_total FROM sites WHERE id = 1').first();
}
```

- [ ] **Step 3b: 改 `src/routes/reports.js`**

把檔案頂端的 import 改成：

```js
import { json } from '../lib/http.js';
import { getActiveZones, getSite } from './zones.js';
import { buildReport, buildExcelValues, buildTowerUsage, validateValue, formatTime, businessDate } from '../../public/js/parking-core.js';
```

刪除 `VALUE_RE` 與 `tokensToArray`，改成：

```js
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function fillValues(raw, zones) {
  const out = {};
  for (const zone of zones) {
    const value = raw?.[zone.code];
    out[zone.code] = value && typeof value === 'object' ? value : { kind: 'none' };
  }
  return out;
}
```

`shapeReport` 改成：

```js
export function shapeReport(row) {
  return {
    id: row.id,
    status: row.status,
    businessDate: row.business_date,
    submittedAt: row.submitted_at,
    deviceLabel: row.device_label ?? null,
    clientRequestId: row.client_request_id,
    supersedesReportId: row.supersedes_report_id ?? null,
    rejectReason: row.reject_reason ?? null,
    values: JSON.parse(row.values_json || '{}'),
  };
}
```

`mapRecord` 改成：

```js
function mapRecord(row) {
  return {
    id: row.id,
    reportId: row.report_id,
    businessDate: row.business_date,
    guardReport: row.guard_report,
    consoleReport: row.console_report,
    excelValues: row.excel_values,
    towerPct: row.tower_usage_pct,
    remarks: JSON.parse(row.remarks_json || '{}'),
    preparedBy: row.prepared_by,
    reportTime: row.report_time,
    confirmedAt: row.confirmed_at,
    values: JSON.parse(row.values_json || '{}'),
  };
}
```

`createReport` 的驗證段（原本讀 `body?.tokens` 的整段）換成：

```js
  const input = body?.values;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'values 必須是 { 區域code: {kind, value} } 的物件' }, 400);
  }

  const zones = await getActiveZones(env.DB);
  const byCode = new Map(zones.map((z) => [z.code, z]));
  for (const [code, value] of Object.entries(input)) {
    const zone = byCode.get(code);
    if (!zone) return json({ error: `未知區域: ${code}` }, 400);
    const check = validateValue(value, zone);
    if (!check.ok) return json({ error: `區域 ${code}: ${check.error}` }, 400);
  }
  const values = fillValues(input, zones);
```

INSERT 的欄位由 `tokens_json` 改 `values_json`，綁定值由 `JSON.stringify(tokens)` 改 `JSON.stringify(values)`；`shapeReport(dup, zones)` / `shapeReport(row, zones)` 的第二個參數移除。

`listReports` 裡的 `getActiveZones` 呼叫與 `shapeReport(row, zones)` 的第二參數一併移除。

`confirmReport` 的重算段換成：

```js
  const zones = await getActiveZones(env.DB);
  const site = (await getSite(env.DB)) || { tower_total: 1600 };
  const values = JSON.parse(report.values_json || '{}');
  const reportTime = new Date(report.submitted_at);
  const device = await env.DB
    .prepare('SELECT label FROM guard_devices WHERE id = ?')
    .bind(report.device_id)
    .first();
  const deviceLabel = device?.label ?? null;

  const tower = buildTowerUsage(values, zones, { towerTotal: site.tower_total });
  const confirmedAt = new Date().toISOString();
```

INSERT `records` 的欄位名改成 `values_json, guard_report, console_report`，綁定值改成：

```js
      report.values_json,
      buildReport(values, zones, { style: 'guard', time: reportTime }),
      buildReport(values, zones, { style: 'console', time: reportTime, deviceLabel }),
      buildExcelValues(values, zones).map((cell) => cell.value).join('\t'),
```

`rejectReport` 裡兩處 `shapeReport(report)` / `shapeReport(updated)` 已無第二參數，維持原樣即可。

- [ ] **Step 3c: 改 `src/routes/records.js`**

`mapRecord` 與 `src/routes/reports.js` 的版本相同（複製 Step 3b 的 `mapRecord`），`SELECT` 敘述不變。

- [ ] **Step 4: 跑測試確認通過**

Run: `TZ=Asia/Taipei node --test test/routes.test.js && TZ=UTC node --test test/routes.test.js`
Expected: 兩次都 PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes test/routes.test.js
git commit -m "feat: report and record routes speak the structured value model"
```

---

### Task 6: 公開唯讀端點與 noindex

**Files:**
- Create: `src/routes/public.js`
- Modify: `src/index.js`
- Test: `test/routes.test.js`（追加）

**Interfaces:**
- Consumes: Task 5 的 `getActiveZones`、`getSite`
- Produces: `publicCurrent(env, url) -> Promise<Response>`，body 形狀 `{ businessDate, towerTotal, zones, entries: [{ reportTime, values, towerPct }] }`

- [ ] **Step 1: 寫失敗的測試**

追加到 `test/routes.test.js`，import 加上 `import { publicCurrent } from '../src/routes/public.js';`

```js
test('the public endpoint returns today entries without any operator data', async () => {
  const db = await seededDb();
  const created = await (await createReport(envWith(db), post(validBody()), DEVICE)).json();
  await confirmReport(envWith(db), created.report.id, new Request('https://example.test/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ remarks: { p1: '施工' } }),
  }), IDENTITY);

  const res = await publicCurrent(envWith(db), new URL(`https://example.test/api/public/current?date=${created.report.businessDate}`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  const body = await res.json();

  assert.equal(body.entries.length, 1);
  assert.deepEqual(body.entries[0].values.p1, { kind: 'tenths', value: 3 });
  assert.equal(body.entries[0].towerPct, 86);
  assert.equal(body.towerTotal, 1600);
  assert.equal(body.zones[0].label, '車塔1上');

  const serialized = JSON.stringify(body);
  for (const leak of ['prepared_by', 'preparedBy', 'remarks', '施工', 'reportId', 'deviceLabel', 'A1', 'example.test']) {
    assert.ok(!serialized.includes(leak), `public payload must not leak ${leak}`);
  }
  db.close();
});

test('the public endpoint rejects a malformed date', async () => {
  const db = await seededDb();
  const res = await publicCurrent(envWith(db), new URL('https://example.test/api/public/current?date=2026-9-9'));
  assert.equal(res.status, 400);
  db.close();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/routes.test.js`
Expected: FAIL — `Cannot find module '../src/routes/public.js'`

- [ ] **Step 3a: 建立 `src/routes/public.js`**

```js
import { getActiveZones, getSite } from './zones.js';
import { businessDate } from '../../public/js/parking-core.js';

export async function publicCurrent(env, url) {
  const date = url.searchParams.get('date') || businessDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: '日期格式必須為 YYYY-MM-DD' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-robots-tag': 'noindex' },
    });
  }

  const { results } = await env.DB
    .prepare(
      'SELECT report_time, values_json, tower_usage_pct FROM records WHERE site_id = 1 AND business_date = ? ORDER BY report_time, id'
    )
    .bind(date)
    .all();
  const zones = await getActiveZones(env.DB);
  const site = (await getSite(env.DB)) || { tower_total: 1600 };

  const body = {
    businessDate: date,
    towerTotal: site.tower_total,
    zones: zones.map(({ code, label, position, unit, inTower }) => ({ code, label, position, unit, inTower })),
    entries: results.map((row) => ({
      reportTime: row.report_time,
      towerPct: row.tower_usage_pct,
      values: JSON.parse(row.values_json || '{}'),
    })),
  };
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30',
      'x-robots-tag': 'noindex',
    },
  });
}
```

公開 payload 刻意不含 `excelLabel` — 主管頁不需要，少一個外洩面。

- [ ] **Step 3b: 接上 `src/index.js`**

import 追加 `import { publicCurrent } from './routes/public.js';`

在 `if (!path.startsWith('/api/'))` 這段之前插入靜態資產的 noindex 處理：

```js
    if (!path.startsWith('/api/')) {
      const response = await env.ASSETS.fetch(request);
      if (path === '/ManagerDashboard' || path === '/ManagerDashboard.html') {
        const headers = new Headers(response.headers);
        headers.set('x-robots-tag', 'noindex');
        return new Response(response.body, { status: response.status, headers });
      }
      return response;
    }
```

在 `try {` 之後、`/api/zones` 那段之前插入：

```js
      if (request.method === 'GET' && path === '/api/public/current') {
        return publicCurrent(env, url);
      }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `TZ=Asia/Taipei node --test test/routes.test.js && TZ=UTC node --test test/routes.test.js`
Expected: 兩次都 PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/public.js src/index.js test/routes.test.js
git commit -m "feat: public read-only endpoint for the manager dashboard"
```

---

### Task 7: Excel 匯出改用值模型

**Files:**
- Modify: `src/export/xlsx.js`
- Test: `test/export.test.js`

**Interfaces:**
- Consumes: Task 3 的 `buildExcelValues`、Task 5 的 `getActiveZones`
- Produces: `exportRecords(env, url)` 回傳形狀不變（`{ body, headers }` 或 `{ error, status }`）

- [ ] **Step 1: 寫失敗的測試**

建立 `test/export.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createTestDb } from './helpers/d1.js';
import { exportRecords } from '../src/export/xlsx.js';

async function dbWithRecord() {
  const db = createTestDb();
  const values = {
    floor_above: { kind: 'spaces', value: 232 },
    floor_below: { kind: 'full' },
    p1: { kind: 'tenths', value: 3 },
    spin_b: { kind: 'carts', value: 2 },
    spin_c: { kind: 'guiding' },
    asphalt: { kind: 'none' },
  };
  await db
    .prepare(
      `INSERT INTO reports (id, site_id, status, client_request_id, values_json, business_date, submitted_at)
       VALUES (1, 1, 'confirmed', 'req-00000001', ?, '2026-09-09', '2026-09-09T04:37:00.000Z')`
    )
    .bind(JSON.stringify(values))
    .run();
  await db
    .prepare(
      `INSERT INTO records (report_id, site_id, business_date, values_json, guard_report, console_report,
                            excel_values, tower_usage_pct, remarks_json, prepared_by, report_time, confirmed_at)
       VALUES (1, 1, '2026-09-09', ?, 'g', 'c', '', 86, ?, '測試員', '12:37', '2026-09-09T04:40:00.000Z')`
    )
    .bind(JSON.stringify(values), JSON.stringify({ p1: '施工' }))
    .run();
  return db;
}

test('export writes the template layout with the new value wordings', async () => {
  const db = await dbWithRecord();
  const result = await exportRecords({ DB: db }, new URL('https://example.test/api/records/export?from=2026-09-09&to=2026-09-09'));
  assert.ok(!result.error);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(result.body);
  const sheet = wb.getWorksheet('9月');
  assert.ok(sheet, 'a sheet per month');

  const headerRow = sheet.getRow(2);
  assert.equal(headerRow.getCell(3).value, '1F↑');
  assert.equal(headerRow.getCell(7).value, '紡織-A');

  const dataRow = sheet.getRow(3);
  assert.equal(dataRow.getCell(2).value, '剩餘車位數');
  assert.equal(dataRow.getCell(3).value, 232);
  assert.equal(dataRow.getCell(4).value, '滿');
  assert.equal(dataRow.getCell(5).value, 3);
  assert.equal(dataRow.getCell(5).numFmt, '0"成"');
  assert.equal(dataRow.getCell(8).value, '停2台');
  assert.equal(dataRow.getCell(9).value, '引導中');
  assert.equal(dataRow.getCell(12).value, '未停車');

  const remarkRow = sheet.getRow(4);
  assert.equal(remarkRow.getCell(2).value, '備註');
  assert.equal(remarkRow.getCell(5).value, '施工');
  assert.equal(remarkRow.getCell(3).value, null, 'remarks stay empty where none were entered');
  db.close();
});

test('export rejects a malformed date range', async () => {
  const db = await dbWithRecord();
  const result = await exportRecords({ DB: db }, new URL('https://example.test/api/records/export?from=2026-9-9&to=2026-09-09'));
  assert.equal(result.status, 400);
  db.close();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/export.test.js`
Expected: FAIL — `exportRecords` 仍查 `tokens_json` / `is_car`，SQLite 報 `no such column`

- [ ] **Step 3: 實作**

`src/export/xlsx.js`：

import 改成：

```js
import ExcelJS from 'exceljs';
import { businessDate, buildExcelValues } from '../../public/js/parking-core.js';
import { getActiveZones } from '../routes/zones.js';
```

刪除 `TENTH_FORMAT`、`cellValue`，`writeZoneRow` 換成兩支各司其職的函式：

```js
function writeValueRow(sheet, rowIndex, colStart, cells) {
  sheet.getCell(rowIndex, colStart + 1).value = '剩餘車位數';
  sheet.getCell(rowIndex, colStart + 1).font = { bold: true };
  cells.forEach((cellSpec, index) => {
    const cell = sheet.getCell(rowIndex, colStart + 2 + index);
    cell.value = cellSpec.value;
    if (cellSpec.numFmt) cell.numFmt = cellSpec.numFmt;
    cell.alignment = { horizontal: 'center' };
  });
}

function writeRemarkRow(sheet, rowIndex, colStart, zones, remarks) {
  sheet.getCell(rowIndex, colStart + 1).value = '備註';
  zones.forEach((zone, index) => {
    const text = remarks?.[zone.code];
    if (typeof text !== 'string' || !text.trim()) return;
    const cell = sheet.getCell(rowIndex, colStart + 2 + index);
    cell.value = text.trim();
    cell.alignment = { horizontal: 'center' };
  });
}
```

備註一律當文字寫入，不再經過值解析（真實表的 `0` 曾被誤判成「滿」）。

`buildWorkbook` 內的欄寬設定改成同時涵蓋右半邊表格：

```js
    sheet.getColumn(1).width = 11;
    sheet.getColumn(2).width = 12;
    sheet.getColumn(15).width = 11;
    sheet.getColumn(16).width = 12;
    for (const col of [...Array(10).keys()]) {
      sheet.getColumn(3 + col).width = 9;
      sheet.getColumn(17 + col).width = 9;
    }
```

`buildWorkbook` 的每日迴圈內，原本呼叫 `writeZoneRow` 的兩行換成：

```js
          writeValueRow(sheet, row, colStart, buildExcelValues(record.values, zones));
          writeRemarkRow(sheet, row + 1, colStart, zones, record.remarks);
```

`exportRecords` 的 zones 查詢改用共用函式，records 的映射改讀新欄位：

```js
  const zones = await getActiveZones(env.DB);

  const records = results.map((row) => ({
    businessDate: row.business_date,
    reportTime: row.report_time,
    preparedBy: row.prepared_by,
    values: JSON.parse(row.values_json || '{}'),
    remarks: JSON.parse(row.remarks_json || '{}'),
  }));
```

- [ ] **Step 4: 跑測試確認通過**

Run: `TZ=Asia/Taipei node --test test/export.test.js && TZ=UTC node --test test/export.test.js`
Expected: 兩次都 PASS

- [ ] **Step 5: Commit**

```bash
git add src/export/xlsx.js test/export.test.js
git commit -m "feat: xlsx export renders structured values and fixes remark handling"
```

---

### Task 8: 保全頁 — DB 驅動區域、引導中、送出修正

**Files:**
- Modify: `public/guard.html`
- Test: `test/guard-ui.test.js`

**Interfaces:**
- Consumes: `GET /api/zones`（Task 5 的形狀）、`POST /api/reports`（body 用 `values`）、core 的 `normalizeInput`/`formatValue`/`buildReport`/`buildTowerUsage`
- Produces: 無（頁面）

- [ ] **Step 1: 寫失敗的測試**

`test/guard-ui.test.js` 追加以下測試（既有針對 CSS 變數、字型、`@media` 的斷言保留不動）：

```js
test('guard page loads zones from the API with cache and packaged fallback', () => {
  assert.match(html, /fetch\('\/api\/zones'\)/);
  assert.match(html, /ZONES_CACHE_KEY\s*=\s*'parking_guard_zones_v1'/);
  assert.match(html, /const FALLBACK_ZONES = \[/);
  assert.ok(!/const ZONES = \[/.test(html), 'zones must not be a hardcoded module constant');
});

test('guard page offers a guiding button without touching the numeric keypad grid', () => {
  assert.match(html, /id="guidingBtn"[^>]*>引導中</);
  assert.match(html, /grid-template-columns:repeat\(3,1fr\)/);
  const keypadItems = html.match(/const keypadItems = \[[\s\S]*?\];/)[0];
  assert.equal((keypadItems.match(/text:'/g) || []).length, 12, 'numeric keypad still has 12 keys');
});

test('guard page posts structured values', () => {
  assert.match(html, /values: item\.values/);
  assert.ok(!/tokens: item\.tokens/.test(html));
});

test('guard page only de-dupes rapid double taps, not repeated identical readings', () => {
  assert.match(html, /DEDUPE_WINDOW_MS\s*=\s*3000/);
  assert.ok(!/last\.preview === preview/.test(html));
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/guard-ui.test.js`
Expected: FAIL — 四個新測試全部失敗

- [ ] **Step 3a: 區域來源改成三層 fallback**

把 `public/guard.html` 的 `const ZONES = [...]` 與 `const ZONE_COUNT = ZONES.length;`（約 649–661 行）換成：

```js
const FALLBACK_ZONES = [
  { code: 'floor_above', label: '車塔1上', position: 0, unit: 'spaces', inTower: true },
  { code: 'floor_below', label: '車塔1下', position: 1, unit: 'spaces', inTower: true },
  { code: 'p1',          label: 'P1',      position: 2, unit: 'tenths', inTower: false },
  { code: 'p3',          label: 'P3',      position: 3, unit: 'tenths', inTower: false },
  { code: 'spin_a',      label: 'A區',     position: 4, unit: 'tenths', inTower: false },
  { code: 'spin_b',      label: 'B區',     position: 5, unit: 'tenths', inTower: false },
  { code: 'spin_c',      label: 'C區',     position: 6, unit: 'tenths', inTower: false },
  { code: 'spin_d',      label: 'D區',     position: 7, unit: 'tenths', inTower: false },
  { code: 'spin_e',      label: 'E區',     position: 8, unit: 'tenths', inTower: false },
  { code: 'asphalt',     label: '柏油路',   position: 9, unit: 'tenths', inTower: false },
];
const ZONES_CACHE_KEY = 'parking_guard_zones_v1';
const TOWER_TOTAL_CACHE_KEY = 'parking_guard_tower_total_v1';

let zones = loadCachedZones();
let towerTotal = Number(localStorage.getItem(TOWER_TOTAL_CACHE_KEY)) || 1600;

function loadCachedZones() {
  try {
    const cached = JSON.parse(localStorage.getItem(ZONES_CACHE_KEY) || 'null');
    if (Array.isArray(cached) && cached.length) return cached;
  } catch {}
  return FALLBACK_ZONES;
}

async function refreshZones() {
  try {
    const response = await fetch('/api/zones');
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.zones) || !data.zones.length) return;
    const changed = JSON.stringify(data.zones) !== JSON.stringify(zones);
    localStorage.setItem(ZONES_CACHE_KEY, JSON.stringify(data.zones));
    zones = data.zones;
    if (changed) {
      cells = zones.map(() => ({ kind: 'none' }));
      moveTo(0);
      showToast('區域設定已更新');
    }
  } catch {}
}
```

`ZONE_COUNT` 的每一處使用改成 `zones.length`。

- [ ] **Step 3b: 狀態由 tokens 陣列改成 cells 陣列**

`let tokens = new Array(ZONE_COUNT).fill('x');` 換成：

```js
let cells = zones.map(() => ({ kind: 'none' }));
let draft = '';
```

`draft` 是目前格子的數字輸入緩衝，只在 `unit === 'spaces'` 的區用得到。

輸入相關的函式改成（取代現有的 `shouldAutoAdvanceCarField`、`inputDigit`、`clearCurrent`、`deleteDigit`、`markFull`、`markEmpty`、`resetAll`、`scheduleAutoAdvance`、`moveTo`）：

```js
function currentZone() {
  return zones[currentIndex];
}

function commitDraft() {
  cells[currentIndex] = draft ? normalizeInput(draft, currentZone()) : { kind: 'none' };
}

function scheduleAutoAdvance(index, snapshot) {
  cancelAutoAdvance();
  autoAdvanceTimer = setTimeout(() => {
    autoAdvanceTimer = null;
    if (currentIndex === index && draft === snapshot) moveNext();
  }, AUTO_ADVANCE_DELAY_MS);
}

function moveTo(index) {
  cancelAutoAdvance();
  currentIndex = Math.max(0, Math.min(zones.length - 1, index));
  entryMode = 'normal';
  draft = '';
  render();
}

function inputDigit(digit) {
  cancelAutoAdvance();
  const zone = currentZone();

  if (entryMode === 'cart') {
    cells[currentIndex] = digit === '0' ? { kind: 'full' } : { kind: 'carts', value: Number(digit) };
    moveNext();
    return;
  }

  if (zone.unit === 'spaces') {
    draft = `${draft}${digit}`.replace(/^0+(?=\d)/, '');
    commitDraft();
    if (draft.length >= AUTO_ADVANCE_CAR_DIGITS) {
      render();
      scheduleAutoAdvance(currentIndex, draft);
      return;
    }
    render();
    return;
  }

  cells[currentIndex] = digit === '0' ? { kind: 'full' } : { kind: 'tenths', value: Number(digit) };
  moveNext();
}

function clearCurrent() {
  cancelAutoAdvance();
  draft = '';
  cells[currentIndex] = { kind: 'none' };
  render();
}

function deleteDigit() {
  cancelAutoAdvance();
  if (!draft && cells[currentIndex].kind === 'none' && currentIndex > 0) {
    currentIndex -= 1;
    entryMode = 'normal';
    draft = '';
  }
  if (draft.length > 1) {
    draft = draft.slice(0, -1);
    commitDraft();
    render();
    return;
  }
  draft = '';
  cells[currentIndex] = { kind: 'none' };
  render();
}

function markFull() {
  draft = '';
  cells[currentIndex] = { kind: 'full' };
  moveNext();
}

function markEmpty() {
  draft = '';
  cells[currentIndex] = { kind: 'none' };
  moveNext();
}

function markGuiding() {
  draft = '';
  cells[currentIndex] = { kind: 'guiding' };
  moveNext();
}

function resetAll() {
  if (!confirm('確定要清除目前回報並重新輸入嗎？')) return;
  cells = zones.map(() => ({ kind: 'none' }));
  currentTime = new Date();
  moveTo(0);
}
```

- [ ] **Step 3c: 加「引導中」按鈕**

`public/guard.html` 的 `.mode-row`（約 597–600 行）換成：

```html
    <div class="mode-row">
      <button class="mode-btn active" id="normalModeBtn">成數/車位</button>
      <button class="mode-btn" id="cartModeBtn">台車模式</button>
      <button class="mode-btn" id="guidingBtn">引導中</button>
    </div>
```

`public/guard.html:214` 的 `.mode-row{ grid-template-columns:1fr 1fr; }` 改成 `grid-template-columns:repeat(3,1fr);`。數字鍵盤的 `.keypad{grid-template-columns:repeat(3,1fr)}`（第 237 行）不得更動 — `test/guard-ui.test.js` 會檢查它還在。

在 DOM 參照區加 `const guidingBtn = $('guidingBtn');`，在事件註冊區加 `guidingBtn.addEventListener('click', markGuiding);`。

- [ ] **Step 3d: 值物件、預覽與送出**

`tokensObject()` 換成：

```js
function valuesObject() {
  const out = {};
  zones.forEach((zone, index) => {
    out[zone.code] = cells[index];
  });
  return out;
}
```

`render()` 內取代原有的 `zoneInfo` / `buildLineReport` / `buildTowerUsage` 呼叫：

```js
  const values = valuesObject();
  const tower = buildTowerUsage(values, zones, { towerTotal });
  const completed = cells.filter((cell) => cell.kind !== 'none').length;
  linePreview.textContent = buildReport(values, zones, { style: 'guard', time: currentTime });
```

`renderZones()` 內每個區塊的顯示文字改成 `formatValue(cells[index])`，`done` 的判斷改成 `cells[index].kind !== 'none'`。

`addHistory()` 換成（同時修掉跨筆去重的漏送問題）：

```js
function addHistory() {
  const now = Date.now();
  if (addHistory.lastAt && now - addHistory.lastAt < DEDUPE_WINDOW_MS) return;
  addHistory.lastAt = now;

  const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  const values = valuesObject();
  const timeLabel = formatHistoryTimeLabel(currentTime);
  const preview = zones.map((zone, index) => `${zone.label}${formatValue(cells[index])}`).join(' ');
  historyEntries.push({ id, timestamp: currentTime.getTime(), timeLabel, values, preview });
  historyEntries = historyEntries.slice(-MAX_HISTORY);
  saveHistory();
  renderHistory();
  enqueueSubmit(historyEntries[historyEntries.length - 1]);
}
```

在常數區加 `const DEDUPE_WINDOW_MS = 3000;`。

`enqueueSubmit` 的 `tokens: tokensObject()` 換成 `values: entry.values`；`flushOutbox` 送出的 body 由 `tokens: item.tokens` 換成 `values: item.values`。

`renderHistory()` 裡點選歷史還原的那段（原本 `tokens = entry.tokens.slice()`）換成：

```js
      cells = zones.map((zone) => entry.values?.[zone.code] ?? { kind: 'none' });
      draft = '';
```

頁面 import 改成：

```js
import { normalizeInput, formatValue, buildReport, buildTowerUsage, formatTime } from './js/parking-core.js';
```

啟動段在 `flushOutbox();` 之後加 `refreshZones();`，並在 `window.addEventListener('online', ...)` 加上一併呼叫 `refreshZones`。

- [ ] **Step 4: 跑測試確認通過**

Run: `TZ=Asia/Taipei node --test test/guard-ui.test.js && TZ=UTC node --test test/guard-ui.test.js`
Expected: 兩次都 PASS

實機驗證：`npm run dev`，開 `http://localhost:8787/guard`，輸入一輪十個區（含一個引導中、一個台車），確認 LINE 預覽文字與 Task 2 的 `guard` 外框一致，且車塔使用率有數字。

- [ ] **Step 5: Commit**

```bash
git add public/guard.html test/guard-ui.test.js
git commit -m "feat: guard page reads zones from D1 and reports structured values"
```

---

### Task 9: 中控頁改用值模型

**Files:**
- Modify: `public/CenterConsole.html`

**Interfaces:**
- Consumes: `GET /api/zones`、`GET /api/reports?status=pending`（回傳 `values`）、`POST /api/reports/:id/confirm`（回傳 `record.consoleReport`）
- Produces: 無

- [ ] **Step 1: 改 import 與區塊渲染**

`import { zoneInfo, businessDate } from './js/parking-core.js';` 換成：

```js
import { formatValue, businessDate } from './js/parking-core.js';
```

`renderZones(tokens)` 換成：

```js
function renderZones(values) {
  return `<div class="zone-grid">${zones.map((zone) => {
    const value = values?.[zone.code] ?? { kind: 'none' };
    return `<div class="zone-cell kind-${value.kind}"><span class="zone-name">${escapeHtml(zone.label)}</span><span class="zone-value">${escapeHtml(formatValue(value))}</span></div>`;
  }).join('')}</div>`;
}
```

呼叫端由 `renderZones(report.tokens)` 改成 `renderZones(report.values)`，紀錄卡片同理由 `record.tokens` 改 `record.values`。

- [ ] **Step 2: 補狀態配色**

`public/CenterConsole.html:177-180` 的四條規則換成六條，色票原樣沿用：

```css
.zone-cell.kind-spaces{background:#e6f7eb;border-color:var(--green)}
.zone-cell.kind-tenths{background:#fff0d4;border-color:var(--amber)}
.zone-cell.kind-carts{background:#fff0d4;border-color:var(--amber)}
.zone-cell.kind-guiding{background:#fff0d4;border-color:var(--amber)}
.zone-cell.kind-full{background:#ffe5e1;border-color:var(--red)}
.zone-cell.kind-none{background:var(--surface2)}
```

- [ ] **Step 3: 確認後複製的文字改成中控外框**

`doConfirm()` 內 `data.record?.lineReport` 換成 `data.record?.consoleReport`；`copyRecord()` 內同樣改讀 `consoleReport`。提示文字由「已確認，LINE 文字已複製」改成「已確認，中控回報已複製」。

- [ ] **Step 4: 驗證**

Run: `npm run dev`，用 `x-dev-user` 模擬中控（`.dev.vars` 需有 `DEV_MODE=1`），從保全頁送一筆進佇列，在 `/CenterConsole` 確認：待確認卡片顯示新措辭、按確認後剪貼簿內容是 `中控回報：HH:MM …` 且尾行為合併後的未停車句。

Run: `TZ=Asia/Taipei npm test && TZ=UTC npm test`
Expected: 兩次都 PASS

- [ ] **Step 5: Commit**

```bash
git add public/CenterConsole.html
git commit -m "feat: center console renders structured values and copies console report"
```

---

### Task 10: 主管頁改公開唯讀

**Files:**
- Modify: `public/ManagerDashboard.html`

**Interfaces:**
- Consumes: `GET /api/public/current`（Task 6）
- Produces: 無

- [ ] **Step 1: 加 noindex 並移除 Access 依賴**

`<head>` 內加：

```html
<meta name="robots" content="noindex,nofollow">
```

- [ ] **Step 2: 改資料來源**

原本並行呼叫 `/api/records` 與 `/api/zones` 的那段，換成單一呼叫：

```js
async function refresh() {
  try {
    const data = await fetchJson('/api/public/current');
    zones = data.zones;
    towerTotal = data.towerTotal;
    render(data.entries);
    authBanner.classList.remove('show');
  } catch (err) {
    showStale(err);
  }
}
```

`fetchJson` 內針對 401 顯示登入橫幅的分支刪除 — 這個端點不會回 401。頁面若原本有「需要登入」的 banner 元素，改成純粹的「連線失敗，顯示的是上次資料」提示。

各區狀態的文字改用 `formatValue`（`import { formatValue } from './js/parking-core.js';`），車塔百分比直接讀 `entries.at(-1).towerPct`，趨勢圖讀 `entries.map((e) => e.towerPct)`，時間軸讀 `entries.map((e) => e.reportTime)`。

- [ ] **Step 3: 驗證**

Run: `npm run dev`，用**無痕視窗**（確保沒有任何 Access cookie）開 `http://localhost:8787/ManagerDashboard`，確認：頁面正常顯示當日資料、畫面上沒有出現任何填表人姓名或備註文字。

Run: `curl -sI http://localhost:8787/api/public/current | grep -i x-robots-tag`
Expected: `x-robots-tag: noindex`

- [ ] **Step 4: Commit**

```bash
git add public/ManagerDashboard.html
git commit -m "feat: manager dashboard reads the public endpoint without auth"
```

---

### Task 11: 秘書頁欄位更名

**Files:**
- Modify: `public/secretary.html`

**Interfaces:**
- Consumes: `GET /api/records`（回傳 `guardReport` / `consoleReport` / `values`）
- Produces: 無

- [ ] **Step 1: 改預覽欄位**

`record.lineReport` 換成 `record.consoleReport` — 秘書核對的是中控實際貼出去的那份。

- [ ] **Step 2: 驗證**

Run: `npm run dev`，開 `/secretary`，選今天的日期按載入，確認預覽是中控格式；按下載，用 Excel 或 Numbers 開啟確認 `停N台`、`引導中`、`N成` 三種儲存格都正確。

- [ ] **Step 3: Commit**

```bash
git add public/secretary.html
git commit -m "refactor: secretary preview shows the console report"
```

---

### Task 12: 部署設定、CI 與文件

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `TODO.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: 前面所有 Task
- Produces: 無

- [ ] **Step 1: 移除會被部署洗掉的 Access vars**

`wrangler.jsonc` 刪掉整個 `vars` 區塊：

```jsonc
  "vars": {
    "ACCESS_TEAM_DOMAIN": "",
    "ACCESS_AUD": ""
  },
```

改用 secret（部署前執行一次即可，之後 `wrangler deploy` 不會覆蓋）：

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
```

`src/auth.js` 不用改 — secret 一樣從 `env` 讀，且未設定時 `verifyAccess` 仍 fail-closed 回 401。

- [ ] **Step 2: CI 跑全部測試**

`.github/workflows/ci.yml` 的 `core-tests` job 裡：

```yaml
      - name: Install dependencies
        run: npm ci
      - name: Run tests (TZ=${{ matrix.tz }})
        run: npm test
```

（原本只跑 `node --test test/parking-core.test.js` 且沒裝依賴；新的 `test/export.test.js` 需要 exceljs，`test/routes.test.js` 需要 `node:sqlite`，`npm test` 會一併跑到 `guard-ui`、`migrations`、`routes`、`export`。）

- [ ] **Step 3: 更新 TODO 的 Access 設定範圍**

`TODO.md` 第 1 節整段換成：

```markdown
## 1. Cloudflare Access 設定（中控 / 秘書登入）

> 狀態：待辦。目前 `/CenterConsole`、`/secretary` 與其 API 在 Access 設定前一律 401（fail-closed）。主管頁 `/ManagerDashboard` 與 `/api/public/current` 為公開唯讀，不經 Access。

- [ ] Zero Trust Dashboard → Access → Applications → Add → Self-hosted
- [ ] **建三個 path-scoped application**，不要綁裸 host（綁裸 host 會連 `/guard` 與 `POST /api/reports` 一起擋掉，保全沒有 Access 身分會完全無法回報）：
  - `parking-report.twstock-gacha.workers.dev/CenterConsole*`
  - `parking-report.twstock-gacha.workers.dev/secretary*`
  - `parking-report.twstock-gacha.workers.dev/api/records*`
- [ ] Policy：允許中控/秘書的 email（One-time PIN 即可）
- [ ] 取得 Team domain（`<團隊名>.cloudflareaccess.com`）與 Application AUD，寫成 secret：
  ```bash
  npx wrangler secret put ACCESS_TEAM_DOMAIN
  npx wrangler secret put ACCESS_AUD
  ```
- [ ] 驗證：瀏覽器開 `/CenterConsole` 應導向 Access 登入頁；開 `/guard` 與 `/ManagerDashboard` 不應被擋
```

- [ ] **Step 4: 更新 README 與 CLAUDE.md**

`README.md`：
- 頁面表格的 `/ManagerDashboard` 一列，使用者欄改成「主管（公開唯讀，免登入）」
- 「上線設定」第 1 點改成 path-scoped 三個 app + `wrangler secret`，與 TODO 一致
- 「資料語意」一節換成：

```markdown
- 每筆回報 = 每個區一個值物件 `{kind, value}`，六種 kind：`spaces`（剩餘車位）、`tenths`（成數空）、`carts`（台車）、`full`（滿）、`guiding`（引導中）、`none`（未停車）
- 數字一律代表「還能停多少」；`zones.unit` 決定裸數字在該區是車位數還是成數
- 「營運日」以台北時區計算；回報時間以保全送出時間為準（離線補送保留原時間）
- Excel 匯出重現主管模板：ROC 年標題、並排日期表、`剩餘車位數`/`備註` 交錯列
```

`CLAUDE.md` 的「關鍵約束」第 2 條換成：

```markdown
2. **values 儲存格式**：`{zone_code: {kind, value}}` 物件（非位置陣列）。六種 kind：`spaces`/`tenths`/`carts`/`full`/`guiding`/`none`，值域 spaces 0–9999、tenths 1–9、carts 1–99，後三種不得帶 value。區域定義只在 D1 的 `zones` 表，`parking-core.js` 不得再出現任何區域常數
```

同節第 5 條之後追加：

```markdown
6. **主管頁公開**：`/ManagerDashboard` 與 `/api/public/current` 免認證，該端點不得回傳 `prepared_by`、`remarks`、`report_id`、裝置代號
```

- [ ] **Step 5: 全套驗證**

Run: `TZ=Asia/Taipei npm test && TZ=UTC npm test`
Expected: 兩次都 PASS

Run: `npx wrangler deploy --dry-run --outdir /tmp/parking-dryrun`
Expected: 建置成功，且 bindings 清單裡**不再**出現 `env.ACCESS_TEAM_DOMAIN ("")` 與 `env.ACCESS_AUD ("")`

- [ ] **Step 6: Commit**

```bash
git add wrangler.jsonc .github/workflows/ci.yml README.md TODO.md CLAUDE.md
git commit -m "chore: move Access config to secrets, run full test suite in CI, update docs"
```

---

## 完成後的狀態

- `public/js/parking-core.js` 是值語意與措辭的唯一來源，且不含任何區域知識。
- 區域定義只在 D1；新增／改名／停用一個區只需改 `zones` 一列，四個前端頁面自動跟上。
- LINE 文字有兩種外框、一組措辭，由程式產生，不再因當班的人而異。
- 主管在假日用手機開網址即可看，無需登入；該端點不外洩填表人與備註。
- CI 跑完整測試套件、雙時區，部署不會再洗掉 Access 設定。
