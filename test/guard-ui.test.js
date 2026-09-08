import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'public', 'guard.html'), 'utf8');

test('guard page keeps legacy structural constraints', () => {
  assert.match(html, /<link rel="icon" href="data:,">/);

  assert.equal(html.includes('目前區域'), false);
  assert.equal(html.includes('id="entryModeLabel"'), false);
  assert.equal(html.includes('id="currentZoneName"'), false);
  assert.equal(html.includes('id="currentZoneType"'), false);
  assert.equal(html.includes('id="rawValue"'), false);
  assert.equal(html.includes('id="statusValue"'), false);
  assert.equal(html.includes('class="current-zone"'), false);
  assert.match(html, /id="currentInputValue"/);
  assert.match(html, /class="value-display"/);

  assert.match(html, /class="card order-card"/);
  assert.match(html, /class="card input-card"/);
  assert.match(html, /class="card secondary-card"/);
  assert.match(html, /@media\(max-height:880px\) and \(max-width:440px\)/);
  assert.match(html, /\.fn-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(html, /\.share\{grid-column:auto/);
  assert.match(html, /\.secondary-card\{display:none\}/);
  assert.equal(html.includes('id="emptyBtn"'), false);
  assert.match(html, /id="deleteDigitBtn"/);
  assert.match(
    html,
    /<div class="mode-row">[\s\S]+<div class="fn-grid">[\s\S]+id="deleteDigitBtn"[\s\S]+<div class="value-display"/
  );
  assert.match(
    html,
    /<div class="value-display"[\s\S]+id="currentInputValue"[\s\S]+<div class="keypad" id="keypad">/
  );
});

test('guard page keeps legacy keypad behavior', () => {
  assert.match(html, /function markFull\(\)/);
  assert.match(html, /function deleteDigit\(\)/);
  assert.match(html, /function markGuiding\(\)/);
  assert.match(html, /kind: 'carts', value: Number\(digit\)/);
  assert.match(html, /text:'全滿'/);
  assert.match(html, /text:'未停車'/);
  assert.match(
    html,
    /text:'全滿'[\s\S]+text:'0'[\s\S]+text:'未停車'/
  );
});

test('guard page keeps legacy outdoor high-contrast design tokens', () => {
  assert.match(html, /--bg:#f3f7fb/);
  assert.match(html, /--text:#07111f/);
  assert.match(html, /--sub:#172033/);
  assert.match(html, /--border:#172033/);
  assert.match(html, /--surface:#ffffff/);
  assert.match(html, /--key-bg:#ffffff/);
  assert.match(html, /--key-ink:#07111f/);
  assert.match(html, /--calc:'Avenir Next','Arial Rounded MT Bold','Helvetica Neue','PingFang TC','Microsoft JhengHei',sans-serif/);
  assert.equal(html.includes('--bg:#0d1720'), false);
  assert.equal(html.includes('backdrop-filter:blur'), false);
  assert.match(html, /\.key:focus-visible,\s*\.fn-btn:focus-visible,\s*\.bottom-btn:focus-visible/);
  assert.match(html, /\.zone-chip\.active\{[\s\S]*box-shadow:0 0 0 3px var\(--focus\)/);
  assert.match(html, /@media\(prefers-contrast:more\)/);
  assert.match(html, /\.key\{[\s\S]*background:var\(--key-bg\);[\s\S]*color:var\(--key-ink\);[\s\S]*font-family:var\(--calc\);[\s\S]*font-size:1\.75rem/);
  assert.match(html, /\.key\.action-key\{[\s\S]*font-family:var\(--sans\);[\s\S]*font-size:1rem/);
  assert.match(html, /\.key\.full-key,\s*\.key\.empty-key\{[\s\S]*background:var\(--key-bg\);[\s\S]*color:var\(--key-ink\);[\s\S]*border-color:var\(--border\)/);
  assert.equal(html.includes('.key.full-key{color:#5a0c07'), false);
  assert.equal(html.includes('.key.empty-key{color:var(--text);background:var(--surface3)}'), false);
  assert.match(html, /\.input-card\{[\s\S]*margin-top:18px/);
  assert.match(html, /\.zone-chip\{[\s\S]*min-height:64px/);
  assert.match(html, /\.zone-chip-name\{[\s\S]*font-size:\.72rem/);
  assert.match(html, /\.zone-chip-value\{[\s\S]*font-size:\.82rem/);
  assert.match(html, /@keyframes pressPulse/);
  assert.match(html, /button\.press-flash/);
  assert.match(html, /function flashButton\(button\)/);
  assert.match(html, /document\.addEventListener\('pointerdown'/);
});

test('guard page keeps legacy auto-advance and backspace flow', () => {
  assert.match(html, /const AUTO_ADVANCE_CAR_DIGITS = 3/);
  assert.match(html, /const AUTO_ADVANCE_DELAY_MS = \d+/);
  assert.match(html, /function cancelAutoAdvance\(\)/);
  assert.match(html, /function scheduleAutoAdvance\(index, snapshot\)/);
  assert.match(html, /setTimeout\(\(\) =>/);
  assert.match(html, /draft\.length >= AUTO_ADVANCE_CAR_DIGITS/);
  assert.match(html, /scheduleAutoAdvance\(currentIndex, draft\)/);
  assert.match(html, /if \(!draft && cells\[currentIndex\]\.kind === 'none' && currentIndex > 0\)/);
  assert.match(html, /currentIndex -= 1/);
  assert.match(html, /nextBtn\.addEventListener\('click', moveNext\)/);
  assert.match(html, /deleteDigitBtn\.addEventListener\('click', deleteDigit\)/);
});

test('guard page v2 uses ESM core, device key and offline outbox', () => {
  assert.match(html, /<script type="module">/);
  assert.match(html, /import \{[\s\S]*\} from '\.\/js\/parking-core\.js'/);
  assert.equal(html.includes('window.ParkingCore'), false);
  assert.equal(html.includes('parking-core.js"></script'), false);

  assert.match(html, /DEVICE_KEY_STORAGE = 'parking_guard_device_key_v1'/);
  assert.match(html, /function setupDeviceKeyFromHash\(\)/);
  assert.match(html, /location\.hash\.match\(\/\^#key=/);
  assert.match(html, /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/);

  assert.match(html, /OUTBOX_STORAGE_KEY = 'parking_guard_outbox_v1'/);
  assert.match(html, /client_request_id: item\.clientRequestId/);
  assert.match(html, /client_submitted_at: item\.submittedAt/);
  assert.match(html, /'authorization': `Bearer \$\{getDeviceKey\(\)\}`/);
  assert.match(html, /window\.addEventListener\('online', flushOutbox\)/);
  assert.match(html, /setInterval\(flushOutbox, SYNC_RETRY_MS\)/);
  assert.match(html, /id="syncStatus"/);
  assert.match(html, /https:\/\/line\.me\/R\/share\?text=/);
});

test('guard page v2 keeps LINE share and history as local-first features', () => {
  assert.match(html, /async function shareToLine\(\)/);
  assert.match(html, /async function copyReport\(message\)/);
  assert.match(html, /function fallbackCopyText\(text\)/);
  assert.match(html, /HISTORY_STORAGE_KEY = 'parking_guard_history_v1'/);
  assert.match(html, /navigator\.clipboard\.writeText/);
});

test('guard page loads zones from the API with cache and packaged fallback', () => {
  assert.match(html, /fetch\('\/api\/zones'\)/);
  assert.match(html, /ZONES_CACHE_KEY\s*=\s*'parking_guard_zones_v1'/);
  assert.match(html, /const FALLBACK_ZONES = \[/);
  assert.equal(/const ZONES = \[/.test(html), false, 'zones must not be a hardcoded module constant');
});

test('guard page offers a guiding button without touching the numeric keypad grid', () => {
  assert.match(html, /id="guidingBtn"[^>]*>引導中</);
  assert.match(html, /\.keypad\{[\s\S]*?grid-template-columns:repeat\(3,1fr\)/);
  const keypadItems = html.match(/const keypadItems = \[[\s\S]*?\];/)[0];
  assert.equal((keypadItems.match(/text:'/g) || []).length, 12, 'numeric keypad still has 12 keys');
});

test('guard page posts structured values', () => {
  assert.match(html, /values: item\.values/);
  assert.equal(/tokens: item\.tokens/.test(html), false);
});

test('guard page only de-dupes rapid double taps, not repeated identical readings', () => {
  assert.match(html, /DEDUPE_WINDOW_MS\s*=\s*3000/);
  assert.equal(/last\.preview === preview/.test(html), false);
});
