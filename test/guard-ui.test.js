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
  assert.match(html, /@media\(max-height:880px\) and \(max-width:440px\)/);
  assert.match(html, /\.fn-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(html, /\.share\{grid-column:auto/);
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

test('guard page omits tower usage, LINE preview, and history cards', () => {
  assert.equal(html.includes('id="towerUsage"'), false);
  assert.equal(html.includes('id="linePreview"'), false);
  assert.equal(html.includes('id="historyList"'), false);
  assert.equal(html.includes('車塔停放使用率'), false);
  assert.equal(html.includes('LINE 回報預覽'), false);
  assert.equal(html.includes('保全回報歷史'), false);
  assert.equal(html.includes('secondary-card'), false);
  assert.equal(html.includes('renderHistory'), false);
  assert.equal(html.includes('buildTowerUsage'), false);
  assert.equal(html.includes('TOWER_TOTAL_CACHE_KEY'), false);
  assert.equal(html.includes('class="preview"'), false);
  assert.equal(html.includes('history-load'), false);
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

test('guard page v2 uses ESM core and session-cookie outbox', () => {
  assert.match(html, /<script type="module">/);
  assert.match(html, /import \{[\s\S]*\} from '\.\/js\/parking-core\.js'/);
  assert.equal(html.includes('window.ParkingCore'), false);
  assert.equal(html.includes('parking-core.js"></script'), false);

  assert.equal(html.includes('DEVICE_KEY_STORAGE'), false);
  assert.equal(html.includes('Bearer'), false);
  assert.equal(html.includes('#key='), false);
  assert.equal(html.includes("setItem('parking_guard_device_key_v1'"), false);
  assert.match(html, /localStorage\.removeItem\('parking_guard_device_key_v1'\)/);
  assert.equal(html.includes('未綁定裝置'), false);

  assert.match(html, /OUTBOX_STORAGE_KEY = 'parking_guard_outbox_v1'/);
  assert.match(html, /client_request_id: item\.clientRequestId/);
  assert.match(html, /client_submitted_at: item\.submittedAt/);
  assert.match(html, /credentials: 'same-origin'/);
  assert.match(html, /登入已過期，點此重新登入/);
  assert.match(html, /此帳號不能送出回報/);
  assert.match(html, /\/login\?next=\/guard/);
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

test('guard page keeps unsent input in a draft that survives reloads', () => {
  assert.match(html, /DRAFT_STORAGE_KEY = 'parking_guard_draft_v1'/);
  assert.match(html, /DRAFT_MAX_AGE_MS = 3 \* 60 \* 60 \* 1000/);
  assert.match(html, /function saveDraft\(\)/);
  assert.match(html, /function loadDraft\(\)/);
  assert.match(html, /function clearDraft\(\)/);
  assert.match(html, /已還原未送出的輸入/);

  const saveDraftBody = html.match(/function saveDraft\(\) \{[\s\S]*?\n\}/)[0];
  const loadDraftBody = html.match(/function loadDraft\(\) \{[\s\S]*?\n\}/)[0];
  const clearDraftBody = html.match(/function clearDraft\(\) \{[\s\S]*?\n\}/)[0];
  const renderBody = html.match(/function render\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(saveDraftBody, /valuesObject\(\)/);
  assert.match(saveDraftBody, /time: currentTime\.toISOString\(\)/);
  assert.match(saveDraftBody, /savedAt: Date\.now\(\)/);
  assert.match(renderBody, /saveDraft\(\);/);

  const bodies = { saveDraft: saveDraftBody, loadDraft: loadDraftBody, clearDraft: clearDraftBody };
  for (const [name, body] of Object.entries(bodies)) {
    const tryIndex = body.indexOf('try {');
    const storageIndex = body.indexOf('localStorage');
    const catchIndex = body.indexOf('catch', tryIndex);
    assert.ok(tryIndex !== -1, `${name} wraps localStorage access in try`);
    assert.ok(storageIndex > tryIndex, `${name} touches localStorage only inside try`);
    assert.ok(catchIndex > storageIndex, `${name} catches storage failures`);
  }

  const addHistoryBody = html.match(/function addHistory\(\) \{[\s\S]*?\n\}/)[0];
  const resetAllBody = html.match(/function resetAll\(\) \{[\s\S]*?\n\}/)[0];
  const refreshZonesBody = html.match(/async function refreshZones\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(addHistoryBody, /enqueueSubmit\([^)]*\);\s*\n\s*clearDraft\(\);/);
  assert.match(resetAllBody, /clearDraft\(\);/);
  assert.match(refreshZonesBody, /clearDraft\(\);/);

  assert.match(html, /loadHistory\(\);\s*\n\s*loadDraft\(\);\s*\n\s*render\(\);/);
});

test('guard page has a submit button that queues the report without LINE', () => {
  assert.match(html, /<button class="bottom-btn submit" id="submitBtn">送出<\/button>/);
  const submitBody = html.match(/function submitReport\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(submitBody, /addHistory\(\);/);
  assert.equal(submitBody.includes('line.me'), false);
  assert.equal(submitBody.includes('clipboard'), false);
  assert.match(html, /submitBtn\.addEventListener\('click', submitReport\)/);
  const baseBottomInner = html.match(/\.bottom-inner\{[\s\S]*?\}/)[0];
  assert.match(baseBottomInner, /max-width:440px/);
  assert.match(baseBottomInner, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

test('guard page bottom bar stays one row and clears the keypad at every size', () => {
  assert.equal(html.includes('grid-template-columns:1fr 1fr'), false);
  assert.match(html, /--bar-h:75px/);
  assert.match(
    html,
    /\.app\{[\s\S]*?padding:12px 12px calc\(var\(--bar-h\) \+ 8px \+ env\(safe-area-inset-bottom\)\)/
  );
  assert.match(
    html,
    /\.toast\{[\s\S]*?bottom:calc\(var\(--bar-h\) \+ env\(safe-area-inset-bottom\)\)/
  );
  assert.equal(html.includes('bottom:124px'), false);
  assert.equal(html.includes('padding:12px 12px 130px'), false);

  const compactCss = html.slice(html.indexOf('@media(max-height:880px) and (max-width:440px)'));
  assert.match(compactCss, /:root\{--bar-h:59px\}/);
  assert.match(compactCss, /\.bottom-btn\{[\s\S]*?min-height:44px/);
  assert.equal(compactCss.includes('.toast{bottom:58px}'), false);

  const baseBottomBtn = html.match(/\.bottom-btn\{[\s\S]*?\}/)[0];
  assert.match(baseBottomBtn, /min-height:52px/);
  assert.match(baseBottomBtn, /text-wrap:balance/);
  const baseKey = html.match(/\.key\{[\s\S]*?\}/)[0];
  assert.match(baseKey, /min-height:48px/);
  const modeBtn = html.match(/\.mode-btn\{[\s\S]*?\}/)[0];
  assert.match(modeBtn, /white-space:nowrap/);
  const disabledModeBtn = html.match(/\.mode-btn:disabled\{[\s\S]*?\}/)[0];
  assert.match(disabledModeBtn, /font-size:\.8rem/);
});

test('guard page stamps the report time at send time and clears after submit', () => {
  const submitBody = html.match(/function submitReport\(\) \{[\s\S]*?\n\}/)[0];
  const submitTime = submitBody.indexOf('currentTime = new Date()');
  const submitHistory = submitBody.indexOf('addHistory()');
  assert.ok(submitTime !== -1, 'submitReport sets the send time');
  assert.ok(submitTime < submitHistory, 'submitReport stamps the time before queueing');
  assert.match(submitBody, /cells\.every\(\(cell\) => cell\.kind === 'none'\)/);
  assert.match(submitBody, /尚未填寫/);
  assert.match(submitBody, /if \(!queued\) return;/);
  assert.match(submitBody, /cells = zones\.map\(\(\) => \(\{ kind: 'none' \}\)\)/);
  assert.match(submitBody, /clearDraft\(\);/);
  assert.match(submitBody, /moveTo\(0\);/);
  assert.equal(submitBody.includes('confirm('), false);

  const copyBody = html.match(/async function copyReport\(message\) \{[\s\S]*?\n\}/)[0];
  const copyTime = copyBody.indexOf('currentTime = new Date()');
  const copyBuild = copyBody.indexOf('buildReport');
  assert.ok(copyTime !== -1, 'copyReport sets the send time');
  assert.ok(copyTime < copyBuild, 'copyReport stamps the time before building text');
  assert.match(copyBody, /render\(\)/);

  const shareBody = html.match(/async function shareToLine\(\) \{[\s\S]*?\n\}/)[0];
  const shareTime = shareBody.indexOf('currentTime = new Date()');
  const shareBuild = shareBody.indexOf('buildReport');
  assert.ok(shareTime !== -1, 'shareToLine sets the send time');
  assert.ok(shareTime < shareBuild, 'shareToLine stamps the time before building text');
  assert.match(shareBody, /render\(\)/);
  assert.match(shareBody, /copyReport\(text\)/);

  const addHistoryBody = html.match(/function addHistory\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(addHistoryBody, /return false;/);
  assert.match(addHistoryBody, /return true;/);
});
