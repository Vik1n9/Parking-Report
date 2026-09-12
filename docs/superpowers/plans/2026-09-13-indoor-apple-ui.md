# 室內三頁 Apple 視覺 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把中控、匯出、主管三頁換成同一套 Apple 控制層外觀與本產品動線，保全頁與後端不動。

**Architecture:** 共用 `office.css`（token + Regular 玻璃只在控制層）與 `office-chrome.js`（中控／匯出頂欄）。日期快捷鍵與看板異常列是兩個小 ESM 模組，用 `parking-core` 的 `businessDate` / `formatValue` / `buildReport` / `buildTowerUsage`，不改 core。三個 HTML 重寫 markup 與 JS，仍打現有 API。

**Tech Stack:** 原生 ESM、無 build、`node --test`、既有 Cloudflare Workers 靜態資產。

## Global Constraints

- 規格：`docs/superpowers/specs/2026-09-13-indoor-apple-ui-design.md`，衝突時以規格為準。
- 不改 `public/guard.html`、`test/guard-ui.test.js`、`public/js/parking-core.js`、`src/*`、Excel、API。
- 外觀跟 Apple：`#f5f5f7` / `#1d1d1f` / `#6e6e73` / `#007AFF`；玻璃只在頂欄、主按鈕、sheet、toast。
- 資訊量與操作邏輯不跟 Apple；不搬底部分頁列。
- 畫面文案只服務當下操作或數據。禁止產品名、唯讀、區塊標題、圖例、教學句。實作不預放說明。意圖寫進 commit。
- `<title>` 只給分頁。`viewport-fit=cover`，允許縮放，不要 `user-scalable=no`。
- 時間用 `businessDate` / `formatTime`，禁止 `getHours()` / `getDate()`。
- 測試 `TZ=Asia/Taipei` 與 `TZ=UTC` 都過。測試資料用假名（`A1`、`console@example.test`）。
- 每個 Task 結尾 commit，Conventional Commits，body 寫意圖。程式與 CSS 不寫說明註解。

---

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `public/js/office-dates.js` | 最近 N 天（迄日昨天） | 新增 |
| `test/office-dates.test.js` | 雙時區日期 | 新增 |
| `public/js/office-exceptions.js` | 看板異常列、使用率狀態字 | 新增 |
| `test/office-exceptions.test.js` | 異常規則 | 新增 |
| `public/css/office.css` | token、玻璃、layout | 新增 |
| `public/js/office-chrome.js` | 中控／匯出頂欄 | 新增 |
| `test/office-ui.test.js` | 三頁結構與禁句 | 新增 |
| `public/ManagerDashboard.html` | 看板 | 重寫 |
| `public/secretary.html` | 匯出 | 重寫 |
| `public/CenterConsole.html` | 中控 | 重寫 |

---

### Task 1: office-dates — 最近 N 天

**Files:**
- Create: `public/js/office-dates.js`
- Test: `test/office-dates.test.js`

**Interfaces:**
- Consumes: `businessDate(input, timeZone)`, `TIME_ZONE` from `public/js/parking-core.js`
- Produces: `rangeEndingYesterday(n, now?, timeZone?) -> { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }`
  - `to` = `businessDate(now)` 的前一個日曆日
  - `from` = `to` 再往前 `n - 1` 個日曆日
  - 日曆加減用 `Date.UTC` 的年月日，不用 `getHours()` / `getDate()`
  - `n` 必須是 ≥1 的整數，否則 throw `Error`

- [ ] **Step 1: 寫失敗的測試**

Create `test/office-dates.test.js`:

```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run:

```bash
TZ=Asia/Taipei node --test test/office-dates.test.js
```

Expected: FAIL（模組不存在）

- [ ] **Step 3: 實作**

Create `public/js/office-dates.js`:

```js
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
```

- [ ] **Step 4: 雙時區通過**

```bash
TZ=Asia/Taipei node --test test/office-dates.test.js
TZ=UTC node --test test/office-dates.test.js
```

Expected: PASS both

- [ ] **Step 5: Commit**

```bash
git add public/js/office-dates.js test/office-dates.test.js
git commit -m "$(cat <<'EOF'
feat: holiday-range dates end yesterday in Taipei

- 方向：秘書快捷鍵用營運日，不含今天
- 改動：rangeEndingYesterday(n)
- 狀態：完成
EOF
)"
```

---

### Task 2: office-exceptions — 看板異常與狀態字

**Files:**
- Create: `public/js/office-exceptions.js`
- Test: `test/office-exceptions.test.js`

**Interfaces:**
- Consumes: `formatValue(value)` from `parking-core.js`
- Produces:
  - `towerStatusWord(pct) -> '' | '正常' | '偏高' | '注意'`（`pct == null` → `''`；`>=90` 注意；`>=70` 偏高；否則正常）
  - `isException(zone, value) -> boolean`：`full` / `guiding` / `none` 為真；`zone.unit === 'tenths'` 且 `kind === 'tenths'` 且 `value >= 8` 為真；車塔 `spaces` 剩餘不是異常
  - `exceptionItems(values, zones) -> [{ code, label, display }]`，順序跟 `zones` 陣列

Zone 形狀：`{ code, label, unit, inTower }`。value 為 `{ kind, value? }`。

- [ ] **Step 1: 寫失敗的測試**

Create `test/office-exceptions.test.js`:

```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
node --test test/office-exceptions.test.js
```

Expected: FAIL

- [ ] **Step 3: 實作**

Create `public/js/office-exceptions.js`:

```js
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
```

- [ ] **Step 4: 通過**

```bash
TZ=Asia/Taipei node --test test/office-exceptions.test.js
TZ=UTC node --test test/office-exceptions.test.js
```

Expected: PASS both

- [ ] **Step 5: Commit**

```bash
git add public/js/office-exceptions.js test/office-exceptions.test.js
git commit -m "$(cat <<'EOF'
feat: board exceptions are full, guiding, empty, high tenths

- 方向：第一眼只看到該注意的區
- 改動：isException / exceptionItems / towerStatusWord
- 狀態：完成
EOF
)"
```

---

### Task 3: office.css + office-chrome

**Files:**
- Create: `public/css/office.css`
- Create: `public/js/office-chrome.js`
- Test: `test/office-ui.test.js`（本 task 只測 chrome 函式輸出與 css 檔存在；頁面斷言留給後面 task）

**Interfaces:**
- Consumes: 無
- Produces: `mountChrome(el, { current, date })`
  - `current`: `'console' | 'export'`
  - `date`: `'YYYY-MM-DD'`
  - 寫入：分段連結 `/CenterConsole`（中控）、`/secretary`（匯出）；當前頁 `aria-current="page"` 與 class `is-current`
  - 不寫產品名、唯讀、儀表板、中控台

- [ ] **Step 1: 寫失敗的測試**

Create `test/office-ui.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(here, '..', 'public', 'css', 'office.css');

test('office.css exists with glass control tokens', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /--bg:\s*#f5f5f7/);
  assert.match(css, /--ink:\s*#1d1d1f/);
  assert.match(css, /--tint:\s*#007AFF/i);
  assert.match(css, /\.glass\s*\{/);
  assert.match(css, /backdrop-filter:\s*blur\(24px\)\s+saturate\(180%\)/);
  assert.match(css, /prefers-reduced-transparency/);
  assert.equal(css.includes('--bg:#f3f7fb'), false);
});
```

Do **not** add `jsdom` as a dependency. Chrome 測試改成不需 DOM：先不測 `mountChrome` 的 DOM，改測模組 export 與字串。刪除上面 JSDOM 那行。完整 `test/office-ui.test.js` 本 step 用：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountChrome } from '../public/js/office-chrome.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('office.css exists with glass control tokens', () => {
  const css = fs.readFileSync(path.join(here, '..', 'public', 'css', 'office.css'), 'utf8');
  assert.match(css, /--bg:\s*#f5f5f7/);
  assert.match(css, /--ink:\s*#1d1d1f/);
  assert.match(css, /--tint:\s*#007AFF/i);
  assert.match(css, /\.glass\s*\{/);
  assert.match(css, /backdrop-filter:\s*blur\(24px\)\s+saturate\(180%\)/);
  assert.match(css, /prefers-reduced-transparency/);
});

test('mountChrome renders console/export without product copy', () => {
  const el = { innerHTML: '' };
  mountChrome(el, { current: 'console', date: '2026-09-13' });
  assert.match(el.innerHTML, /href="\/CenterConsole"/);
  assert.match(el.innerHTML, /href="\/secretary"/);
  assert.match(el.innerHTML, />中控</);
  assert.match(el.innerHTML, />匯出</);
  assert.match(el.innerHTML, /2026-09-13/);
  assert.match(el.innerHTML, /aria-current="page"/);
  assert.equal(el.innerHTML.includes('停車回報'), false);
  assert.equal(el.innerHTML.includes('唯讀'), false);
  assert.equal(el.innerHTML.includes('儀表板'), false);
  assert.equal(el.innerHTML.includes('中控台'), false);
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
node --test test/office-ui.test.js
```

Expected: FAIL

- [ ] **Step 3: 寫 office.css**

Create `public/css/office.css` with this exact content:

```css
:root {
  --bg: #f5f5f7;
  --ink: #1d1d1f;
  --muted: #6e6e73;
  --tint: #007AFF;
  --hot: #ff3b30;
  --warm: #ff9500;
  --cool: #34c759;
  --glass: rgba(255, 255, 255, 0.72);
  --radius: 20px;
  --radius-pill: 999px;
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --sans: -apple-system, BlinkMacSystemFont, "PingFang TC", "Helvetica Neue", sans-serif;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  -webkit-text-size-adjust: 100%;
}
body { padding-bottom: var(--safe-bottom); }
button, a, input { font: inherit; }
button { cursor: pointer; }
.app {
  width: min(100%, 720px);
  margin: 0 auto;
  padding: calc(72px + var(--safe-top)) 20px 40px;
}
.glass {
  background: var(--glass);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 8px 24px rgba(0,0,0,0.08);
}
.chrome-bar {
  position: fixed;
  top: calc(10px + var(--safe-top));
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(calc(100% - 24px), 680px);
  padding: 6px 8px 6px 6px;
  border-radius: var(--radius-pill);
}
.seg { display: flex; gap: 2px; flex: 1; }
.seg-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border-radius: var(--radius-pill);
  color: var(--ink);
  text-decoration: none;
  font-weight: 600;
}
.seg-item.is-current { background: rgba(0,0,0,0.08); }
.chrome-date {
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  font-size: 0.9rem;
  padding-right: 10px;
}
.hero-pct {
  font-size: clamp(4.5rem, 22vw, 7rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 0.95;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.hero-pct.hot { color: var(--hot); }
.hero-pct.warm { color: var(--warm); }
.hero-pct.cool { color: var(--cool); }
.status-word { display: block; text-align: center; font-weight: 600; margin-top: 8px; }
.meta-row {
  display: flex;
  justify-content: center;
  gap: 24px;
  margin: 20px 0 28px;
  font-variant-numeric: tabular-nums;
}
.meta-row span { color: var(--muted); }
.meta-row b { color: var(--ink); font-weight: 600; }
.ex-list, .zone-list, .queue, .log, .range-result { display: flex; flex-direction: column; gap: 8px; }
.ex-item, .zone-item, .queue-item, .log-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 4px;
  background: transparent;
  border: 0;
}
.pill-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 20px; }
.pill {
  min-height: 44px;
  padding: 0 16px;
  border-radius: var(--radius-pill);
  border: 0;
  background: rgba(0,0,0,0.06);
  color: var(--ink);
  font-weight: 600;
}
.pill.is-current { background: var(--ink); color: #fff; }
.btn {
  min-height: 44px;
  padding: 0 18px;
  border-radius: 12px;
  border: 0;
  background: rgba(0,0,0,0.06);
  color: var(--ink);
  font-weight: 600;
}
.btn-primary {
  min-height: 48px;
  padding: 0 22px;
  border-radius: var(--radius-pill);
  border: 0;
  background: var(--tint);
  color: #fff;
  font-weight: 600;
}
.btn-danger { color: var(--hot); background: rgba(255,59,48,0.12); }
.action-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.28);
  display: none;
  align-items: flex-end;
  justify-content: center;
  z-index: 40;
  padding: 16px 16px calc(16px + var(--safe-bottom));
}
.sheet-backdrop.show { display: flex; }
.sheet {
  width: min(100%, 520px);
  max-height: 88vh;
  overflow: auto;
  border-radius: 28px;
  padding: 20px;
}
.report {
  white-space: pre-wrap;
  font-size: 0.95rem;
  line-height: 1.55;
  margin: 0 0 16px;
}
.remark {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.remark span { min-width: 4.5rem; font-weight: 600; }
.remark input, .sheet input[type="text"] {
  flex: 1;
  min-height: 44px;
  border: 0;
  border-radius: 12px;
  padding: 0 12px;
  background: rgba(0,0,0,0.06);
  color: var(--ink);
  width: 100%;
}
.custom-dates { display: none; gap: 10px; margin-bottom: 16px; }
.custom-dates.show { display: flex; flex-wrap: wrap; }
.custom-dates input {
  min-height: 44px;
  border: 0;
  border-radius: 12px;
  padding: 0 12px;
  background: rgba(0,0,0,0.06);
}
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(28px + var(--safe-bottom));
  transform: translateX(-50%) translateY(12px);
  opacity: 0;
  pointer-events: none;
  padding: 10px 16px;
  border-radius: var(--radius-pill);
  color: var(--ink);
  font-weight: 600;
  transition: opacity .16s ease, transform .16s ease;
  z-index: 60;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.banner {
  display: none;
  text-align: center;
  padding: 10px;
  color: var(--hot);
  font-weight: 600;
}
.banner.show { display: block; }
.chart-box svg { width: 100%; height: auto; display: block; }
.board-when {
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  margin-bottom: 8px;
}
@media (prefers-reduced-transparency: reduce) {
  .glass { background: #fff; backdrop-filter: none; -webkit-backdrop-filter: none; }
}
@media (prefers-contrast: more) {
  .glass { background: #fff; border: 2px solid var(--ink); }
}
@media (prefers-reduced-motion: reduce) {
  .toast { transition: none; }
}
```

- [ ] **Step 4: 寫 office-chrome.js**

Create `public/js/office-chrome.js`:

```js
export function mountChrome(el, { current, date }) {
  const consoleCurrent = current === 'console' ? ' is-current' : '';
  const exportCurrent = current === 'export' ? ' is-current' : '';
  const consoleAria = current === 'console' ? ' aria-current="page"' : '';
  const exportAria = current === 'export' ? ' aria-current="page"' : '';
  el.innerHTML = `<nav class="glass chrome-bar"><div class="seg"><a class="seg-item${consoleCurrent}" href="/CenterConsole"${consoleAria}>中控</a><a class="seg-item${exportCurrent}" href="/secretary"${exportAria}>匯出</a></div><time class="chrome-date">${date}</time></nav>`;
}
```

- [ ] **Step 5: 跑測試通過**

```bash
node --test test/office-ui.test.js
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add public/css/office.css public/js/office-chrome.js test/office-ui.test.js
git commit -m "$(cat <<'EOF'
feat: shared office glass chrome for console and export

- 方向：室內三頁同一控制層，頂欄只有中控／匯出
- 改動：office.css Regular 玻璃；mountChrome
- 狀態：完成
EOF
)"
```

---

### Task 4: ManagerDashboard

**Files:**
- Modify: `public/ManagerDashboard.html`（整檔重寫）
- Modify: `test/office-ui.test.js`（追加看板斷言）

**Interfaces:**
- Consumes: `formatValue`, `buildTowerUsage` from parking-core; `exceptionItems`, `towerStatusWord` from office-exceptions; `GET /api/public/current`
- Produces: 無新 API

- [ ] **Step 1: 追加失敗測試**

Append to `test/office-ui.test.js`:

```js
function pageBody(file) {
  const html = fs.readFileSync(path.join(here, '..', 'public', file), 'utf8');
  const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  return { html, body };
}

const FORBIDDEN = ['廠區停車', '唯讀', '儀表板', '今日無巡視', '車塔使用率', '各區狀態', '今日趨勢'];

test('manager board has hero and no annotative copy', () => {
  const { html, body } = pageBody('ManagerDashboard.html');
  assert.match(html, /href="\.\/css\/office\.css"/);
  assert.match(html, /viewport-fit=cover/);
  assert.equal(html.includes('user-scalable=no'), false);
  assert.match(html, /id="gaugePct"/);
  assert.match(html, /id="exList"/);
  assert.match(html, /office-exceptions\.js/);
  assert.equal(body.includes('href="/CenterConsole"'), false);
  for (const word of FORBIDDEN) assert.equal(body.includes(word), false);
});
```

- [ ] **Step 2: 跑測試確認新 case 失敗**

```bash
node --test test/office-ui.test.js
```

Expected: `manager board` FAIL

- [ ] **Step 3: 重寫 ManagerDashboard.html**

Replace `public/ManagerDashboard.html` entirely:

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f5f5f7">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="data:,">
<link rel="stylesheet" href="./css/office.css">
<title>看板</title>
</head>
<body>
<main class="app">
  <div class="board-when" id="when"></div>
  <div class="hero-pct" id="gaugePct">—</div>
  <span class="status-word" id="statusWord"></span>
  <div class="meta-row">
    <div><b id="remainingNum">—</b> <span>剩餘</span></div>
    <div><b id="occupiedNum">—</b> <span>已停</span></div>
    <div><b id="capacityNum">—</b> <span>總格</span></div>
  </div>
  <div class="ex-list" id="exList"></div>
  <div class="zone-list" id="zoneList"></div>
  <div class="chart-box" id="chartBox"></div>
  <div class="banner" id="failBanner">無法更新</div>
</main>
<script type="module">
import { formatValue, buildTowerUsage } from './js/parking-core.js';
import { exceptionItems, towerStatusWord } from './js/office-exceptions.js';

const POLL_MS = 30000;
const $ = (id) => document.getElementById(id);
let zones = [];
let towerTotal = 1600;
let lastOk = null;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pctClass(pct) {
  if (pct == null) return '';
  return pct >= 90 ? 'hot' : pct >= 70 ? 'warm' : 'cool';
}

function renderEmpty() {
  $('gaugePct').textContent = '—';
  $('gaugePct').className = 'hero-pct';
  $('statusWord').textContent = '';
  $('remainingNum').textContent = '—';
  $('occupiedNum').textContent = '—';
  $('capacityNum').textContent = String(towerTotal);
  $('exList').innerHTML = '';
  $('zoneList').innerHTML = '';
  $('chartBox').innerHTML = '';
}

function render(data) {
  zones = data.zones || zones;
  towerTotal = data.towerTotal || towerTotal;
  const entries = data.entries || [];
  const latest = entries[entries.length - 1];
  const bits = [data.businessDate];
  if (latest?.reportTime) bits.push(latest.reportTime);
  $('when').textContent = bits.filter(Boolean).join('  ');
  if (!latest) {
    renderEmpty();
    return;
  }
  const values = latest.values || {};
  const tower = buildTowerUsage(values, zones, { towerTotal });
  const pct = latest.towerPct ?? (tower.valid ? tower.percent : null);
  $('gaugePct').textContent = pct == null ? '—' : `${pct}%`;
  $('gaugePct').className = `hero-pct ${pctClass(pct)}`;
  $('statusWord').textContent = towerStatusWord(pct);
  $('remainingNum').textContent = tower.valid ? String(tower.remaining) : '—';
  $('occupiedNum').textContent = tower.valid ? String(tower.occupied) : '—';
  $('capacityNum').textContent = String(towerTotal);
  $('exList').innerHTML = exceptionItems(values, zones).map((item) =>
    `<div class="ex-item"><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.display)}</b></div>`
  ).join('');
  $('zoneList').innerHTML = zones.map((zone) => {
    const value = values[zone.code] ?? { kind: 'none' };
    return `<div class="zone-item"><span>${escapeHtml(zone.label)}</span><b>${escapeHtml(formatValue(value))}</b></div>`;
  }).join('');
  renderChart(entries);
}

function renderChart(records) {
  const points = records.filter((r) => r.towerPct != null);
  if (points.length < 1) {
    $('chartBox').innerHTML = '';
    return;
  }
  const W = 900, H = 220, PAD_L = 36, PAD_R = 12, PAD_T = 12, PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const x = (i) => PAD_L + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (pct) => PAD_T + innerH - (pct / 100) * innerH;
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.towerPct).toFixed(1)}`).join(' ');
  $('chartBox').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"><polyline points="${line}" fill="none" stroke="#007AFF" stroke-width="3" stroke-linejoin="round"/></svg>`;
}

async function refresh() {
  try {
    const response = await fetch('/api/public/current');
    const data = await response.json();
    if (!response.ok) throw new Error('bad');
    lastOk = data;
    $('failBanner').classList.remove('show');
    render(data);
  } catch {
    $('failBanner').classList.add('show');
    if (lastOk) render(lastOk);
  }
}

refresh();
setInterval(refresh, POLL_MS);
</script>
</body>
</html>
```

- [ ] **Step 4: 跑 office-ui + 既有測試**

```bash
TZ=Asia/Taipei node --test test/office-ui.test.js test/parking-core.test.js test/guard-ui.test.js
```

Expected: PASS。`guard-ui.test.js` 不得被改到。

- [ ] **Step 5: Commit**

```bash
git add public/ManagerDashboard.html test/office-ui.test.js
git commit -m "$(cat <<'EOF'
feat: manager board shows percent and exceptions only

- 方向：iPhone 打開 3 秒內看滿不滿
- 改動：重寫 ManagerDashboard，平日為 —
- 狀態：完成
EOF
)"
```

---

### Task 5: secretary

**Files:**
- Modify: `public/secretary.html`
- Modify: `test/office-ui.test.js`

**Interfaces:**
- Consumes: `mountChrome`, `rangeEndingYesterday`, `GET /api/records`, `GET /api/records/export`
- Produces: 無

- [ ] **Step 1: 追加失敗測試**

Append:

```js
test('secretary is download with 2/3/4 day chips', () => {
  const { html, body } = pageBody('secretary.html');
  assert.match(html, /href="\.\/css\/office\.css"/);
  assert.match(html, /office-chrome\.js/);
  assert.match(html, /office-dates\.js/);
  assert.match(html, /mountChrome\(/);
  assert.match(body, />最近 2 天</);
  assert.match(body, />最近 3 天</);
  assert.match(body, />最近 4 天</);
  assert.match(body, />自訂</);
  assert.match(body, />下載</);
  assert.equal(body.includes('下載主管報表'), false);
  assert.equal(body.includes('秘書彙整'), false);
  assert.equal(body.includes('此區間沒有紀錄'), false);
  assert.match(body, /href="\/CenterConsole"/);
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
node --test test/office-ui.test.js
```

Expected: secretary case FAIL

- [ ] **Step 3: 重寫 secretary.html**

Replace `public/secretary.html` entirely:

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f5f5f7">
<link rel="icon" href="data:,">
<link rel="stylesheet" href="./css/office.css">
<title>匯出</title>
</head>
<body>
<div id="chrome"></div>
<main class="app">
  <div class="banner" id="authBanner">請重新整理</div>
  <div class="pill-row">
    <button class="pill" data-n="2" type="button">最近 2 天</button>
    <button class="pill is-current" data-n="3" type="button">最近 3 天</button>
    <button class="pill" data-n="4" type="button">最近 4 天</button>
    <button class="pill" data-n="custom" type="button">自訂</button>
  </div>
  <div class="custom-dates" id="customDates">
    <input type="date" id="fromDate">
    <input type="date" id="toDate">
  </div>
  <button class="btn-primary" id="exportBtn" type="button">下載</button>
  <p class="range-result" id="rangeResult"></p>
</main>
<div class="toast glass" id="toast"></div>
<script type="module">
import { businessDate } from './js/parking-core.js';
import { mountChrome } from './js/office-chrome.js';
import { rangeEndingYesterday } from './js/office-dates.js';

const $ = (id) => document.getElementById(id);
mountChrome($('chrome'), { current: 'export', date: businessDate(new Date()) });

let mode = 3;
const fromDate = $('fromDate');
const toDate = $('toDate');
let lastCount = 0;

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function currentRange() {
  if (mode === 'custom') {
    return { from: fromDate.value, to: toDate.value || fromDate.value };
  }
  return rangeEndingYesterday(mode);
}

async function loadRange() {
  const { from, to } = currentRange();
  if (!from) return;
  try {
    const response = await fetch(`/api/records?from=${from}&to=${to}`);
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      $('authBanner').classList.add('show');
      return;
    }
    if (!response.ok) return;
    $('authBanner').classList.remove('show');
    const records = data.records || [];
    lastCount = records.length;
    $('rangeResult').textContent = `${from}–${to} · ${lastCount}`;
  } catch {
    showToast('無法更新');
  }
}

function setMode(next) {
  mode = next;
  document.querySelectorAll('.pill').forEach((btn) => {
    const n = btn.dataset.n === 'custom' ? 'custom' : Number(btn.dataset.n);
    btn.classList.toggle('is-current', n === next);
  });
  $('customDates').classList.toggle('show', next === 'custom');
  loadRange();
}

document.querySelector('.pill-row').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-n]');
  if (!btn) return;
  setMode(btn.dataset.n === 'custom' ? 'custom' : Number(btn.dataset.n));
});
fromDate.addEventListener('change', loadRange);
toDate.addEventListener('change', loadRange);
$('exportBtn').addEventListener('click', () => {
  const { from, to } = currentRange();
  if (!from) return;
  if (lastCount === 0) {
    showToast('沒有可下載的資料');
    return;
  }
  window.location.href = `/api/records/export?from=${from}&to=${to}`;
});

const today = businessDate(new Date());
fromDate.value = today;
toDate.value = today;
loadRange();
</script>
</body>
</html>
```

- [ ] **Step 4: 測試通過**

```bash
TZ=UTC node --test test/office-ui.test.js test/office-dates.test.js test/guard-ui.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/secretary.html test/office-ui.test.js
git commit -m "$(cat <<'EOF'
feat: export page downloads a 2-4 day holiday range

- 方向：假日後第一個上班日一次下載
- 改動：重寫 secretary，預設最近 3 天，按鈕文案為下載
- 狀態：完成
EOF
)"
```

---

### Task 6: CenterConsole

**Files:**
- Modify: `public/CenterConsole.html`
- Modify: `test/office-ui.test.js`

**Interfaces:**
- Consumes: `mountChrome`, `buildReport`, `formatValue`, `formatTime`, `businessDate`, `GET/POST /api/reports`, `GET /api/records`, `GET /api/zones`
- Produces: 無

- [ ] **Step 1: 追加失敗測試**

Append:

```js
test('console confirm sheet previews report and copies', () => {
  const { html, body } = pageBody('CenterConsole.html');
  assert.match(html, /href="\.\/css\/office\.css"/);
  assert.match(html, /office-chrome\.js/);
  assert.match(html, /mountChrome\(/);
  assert.match(html, /id="previewText"/);
  assert.match(html, /確認並複製/);
  assert.match(html, /再複製/);
  assert.equal(body.includes('prompt('), false);
  assert.equal(body.includes('待確認回報'), false);
  assert.equal(body.includes('今日已確認'), false);
  assert.equal(body.includes('中控台'), false);
  assert.equal(/[^/]CenterConsole/.test(body), false);
  assert.match(html, /id="rejectSheet"/);
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
node --test test/office-ui.test.js
```

Expected: console case FAIL

- [ ] **Step 3: 重寫 CenterConsole.html**

Replace `public/CenterConsole.html` entirely:

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f5f5f7">
<link rel="icon" href="data:,">
<link rel="stylesheet" href="./css/office.css">
<title>中控</title>
</head>
<body>
<div id="chrome"></div>
<main class="app">
  <div class="banner" id="authBanner">請重新整理</div>
  <div class="queue" id="queueList"></div>
  <div class="log" id="recordList"></div>
</main>
<div class="sheet-backdrop" id="confirmSheet">
  <div class="sheet glass">
    <pre class="report" id="previewText"></pre>
    <div id="remarkRows"></div>
    <div class="action-row" id="confirmActions">
      <button class="btn" id="cancelConfirmBtn" type="button">取消</button>
      <button class="btn-primary" id="doConfirmBtn" type="button">確認並複製</button>
    </div>
    <div class="action-row" id="doneActions" hidden>
      <button class="btn-primary" id="copyAgainBtn" type="button">再複製</button>
      <button class="btn" id="closeConfirmBtn" type="button">關閉</button>
    </div>
  </div>
</div>
<div class="sheet-backdrop" id="rejectSheet">
  <div class="sheet glass">
    <input type="text" id="rejectReason" maxlength="200">
    <div class="action-row">
      <button class="btn" id="cancelRejectBtn" type="button">取消</button>
      <button class="btn btn-danger" id="doRejectBtn" type="button">退回</button>
    </div>
  </div>
</div>
<div class="toast glass" id="toast"></div>
<script type="module">
import { formatValue, businessDate, buildReport, formatTime } from './js/parking-core.js';
import { mountChrome } from './js/office-chrome.js';

const POLL_MS = 8000;
const $ = (id) => document.getElementById(id);
mountChrome($('chrome'), { current: 'console', date: businessDate(new Date()) });

let zones = [];
let pendingReportsCache = [];
let pendingConfirm = null;
let pendingRejectId = null;
let lastConsoleText = '';
let sheetOpen = false;

function isLocalDev() {
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}
function devHeaders() {
  return isLocalDev() ? { 'x-dev-user': 'console@example.test' } : {};
}
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已複製');
    return true;
  } catch {
    return false;
  }
}
async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    $('authBanner').classList.add('show');
    throw new Error('unauthorized');
  }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  $('authBanner').classList.remove('show');
  return data;
}
function renderZones(values) {
  return zones.map((zone) => {
    const value = values?.[zone.code] ?? { kind: 'none' };
    return `<div class="zone-item"><span>${escapeHtml(zone.label)}</span><b>${escapeHtml(formatValue(value))}</b></div>`;
  }).join('');
}

async function loadQueue() {
  const data = await fetchJson('/api/reports?status=pending');
  pendingReportsCache = data.reports || [];
  const reports = pendingReportsCache;
  $('queueList').innerHTML = reports.map((report) => `
    <div class="queue-item">
      <div><b>${escapeHtml(formatTime(report.submittedAt))}</b> ${escapeHtml(report.deviceLabel || '')}</div>
      ${renderZones(report.values)}
      <div class="action-row">
        <button class="btn-primary" data-confirm="${report.id}" type="button">確認</button>
        <button class="btn btn-danger" data-reject="${report.id}" type="button">退回</button>
      </div>
    </div>
  `).join('');
}

async function loadRecords() {
  const today = businessDate(new Date());
  const data = await fetchJson(`/api/records?from=${today}&to=${today}`);
  const records = data.records || [];
  $('recordList').innerHTML = records.map((record) => `
    <div class="log-item">
      <div><b>${escapeHtml(record.reportTime)}</b> ${record.towerPct == null ? '' : record.towerPct + '%'}</div>
      <button class="btn" data-copy="${record.id}" type="button">複製</button>
      <pre class="report" hidden>${escapeHtml(record.consoleReport)}</pre>
    </div>
  `).join('');
}

function openConfirm(report) {
  pendingConfirm = report;
  sheetOpen = true;
  lastConsoleText = buildReport(report.values, zones, {
    style: 'console',
    time: new Date(report.submittedAt),
    deviceLabel: report.deviceLabel,
  });
  $('previewText').textContent = lastConsoleText;
  const active = zones.filter((zone) => (report.values?.[zone.code]?.kind ?? 'none') !== 'none');
  $('remarkRows').innerHTML = active.map((zone) => `
    <label class="remark"><span>${escapeHtml(zone.label)}</span><input data-code="${zone.code}" maxlength="50"></label>
  `).join('');
  $('confirmActions').hidden = false;
  $('doneActions').hidden = true;
  $('confirmSheet').classList.add('show');
}

function closeConfirm() {
  $('confirmSheet').classList.remove('show');
  pendingConfirm = null;
  sheetOpen = false;
}

async function doConfirm() {
  if (!pendingConfirm) return;
  const remarks = {};
  $('remarkRows').querySelectorAll('input[data-code]').forEach((input) => {
    const value = input.value.trim();
    if (value) remarks[input.dataset.code] = value;
  });
  $('doConfirmBtn').disabled = true;
  try {
    const data = await fetchJson(`/api/reports/${pendingConfirm.id}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...devHeaders() },
      body: JSON.stringify({ remarks }),
    });
    lastConsoleText = data.record?.consoleReport || lastConsoleText;
    $('previewText').textContent = lastConsoleText;
    $('confirmActions').hidden = true;
    $('doneActions').hidden = false;
    await copyText(lastConsoleText);
    await refresh();
  } catch (err) {
    if (err.message !== 'unauthorized') showToast(err.message);
  } finally {
    $('doConfirmBtn').disabled = false;
  }
}

function openReject(id) {
  pendingRejectId = id;
  sheetOpen = true;
  $('rejectReason').value = '';
  $('rejectSheet').classList.add('show');
}
function closeReject() {
  $('rejectSheet').classList.remove('show');
  pendingRejectId = null;
  sheetOpen = false;
}
async function doReject() {
  if (!pendingRejectId) return;
  await fetchJson(`/api/reports/${pendingRejectId}/reject`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...devHeaders() },
    body: JSON.stringify({ reason: $('rejectReason').value.slice(0, 200) }),
  });
  closeReject();
  await refresh();
}

async function refresh() {
  try {
    await Promise.all([loadQueue(), loadRecords()]);
  } catch (err) {
    if (err.message !== 'unauthorized') { /* leave banner */ }
  }
}

$('queueList').addEventListener('click', (event) => {
  const confirmId = event.target.closest('[data-confirm]')?.dataset.confirm;
  const rejectId = event.target.closest('[data-reject]')?.dataset.reject;
  if (confirmId) {
    const report = pendingReportsCache.find((r) => r.id === Number(confirmId));
    if (report) openConfirm(report);
  } else if (rejectId) {
    openReject(Number(rejectId));
  }
});
$('recordList').addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-copy]');
  if (!btn) return;
  const text = btn.parentElement.querySelector('.report')?.textContent || '';
  await copyText(text);
});
$('cancelConfirmBtn').addEventListener('click', closeConfirm);
$('closeConfirmBtn').addEventListener('click', closeConfirm);
$('doConfirmBtn').addEventListener('click', doConfirm);
$('copyAgainBtn').addEventListener('click', () => copyText(lastConsoleText));
$('cancelRejectBtn').addEventListener('click', closeReject);
$('doRejectBtn').addEventListener('click', doReject);
$('confirmSheet').addEventListener('click', (event) => {
  if (event.target === $('confirmSheet')) closeConfirm();
});
$('rejectSheet').addEventListener('click', (event) => {
  if (event.target === $('rejectSheet')) closeReject();
});

(async () => {
  try {
    const data = await fetchJson('/api/zones');
    zones = data.zones || [];
  } catch {
    zones = [];
  }
  await refresh();
})();
setInterval(() => {
  if (!sheetOpen) refresh();
}, POLL_MS);
</script>
</body>
</html>
```

- [ ] **Step 4: 全測試雙時區**

```bash
TZ=Asia/Taipei npm test
TZ=UTC npm test
```

Expected: all PASS，含 `guard-ui.test.js`。

- [ ] **Step 5: Commit**

```bash
git add public/CenterConsole.html test/office-ui.test.js
git commit -m "$(cat <<'EOF'
feat: console confirm sheet holds the LINE text

- 方向：確認完要貼的字在同一塊面板
- 改動：重寫 CenterConsole，退回改 sheet，輪詢不打斷開著的面板
- 狀態：完成
EOF
)"
```

---

### Task 7: 全套回歸

**Files:** 無新檔。確認 `public/guard.html` 無 diff。

- [ ] **Step 1: guard 未被改到**

```bash
git diff main -- public/guard.html test/guard-ui.test.js public/js/parking-core.js src
```

Expected: empty（相對本功能分支，這些路徑應無改動；若已在 `feat/indoor-apple-ui` 上，對 `main` 只應看到 indoor 檔案與 spec/plan）

- [ ] **Step 2: 雙時區全測**

```bash
TZ=Asia/Taipei npm test
TZ=UTC npm test
```

Expected: PASS

- [ ] **Step 3: 若全綠且無 extra diff，本 task 不必再 commit。** 若 Step 1 發現誤改 guard/core/src，還原那些檔再測，必要時 commit `fix: keep guard and core untouched`。
