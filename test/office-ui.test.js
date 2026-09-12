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
  assert.match(css, /\.queue-item\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /\.app\.board\s*\{[^}]*padding-top:\s*calc\(20px \+ var\(--safe-top\)\)/);
  assert.match(css, /\.ex-list\s*\{[^}]*margin-bottom/);
  assert.match(css, /\.ex-item b\s*\{/);
  assert.match(css, /\.status-word\.hot/);
  assert.equal(/\.btn-primary[^{]*\{[^}]*backdrop-filter/.test(css), false);
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
  assert.match(el.innerHTML, /class="seg-item is-current" href="\/CenterConsole" aria-current="page">中控</);
  assert.equal(el.innerHTML.includes('停車回報'), false);
  assert.equal(el.innerHTML.includes('唯讀'), false);
  assert.equal(el.innerHTML.includes('儀表板'), false);
  assert.equal(el.innerHTML.includes('中控台'), false);
});

test('mountChrome marks 匯出 current', () => {
  const el = { innerHTML: '' };
  mountChrome(el, { current: 'export', date: '2026-09-13' });
  assert.match(el.innerHTML, />中控</);
  assert.match(el.innerHTML, />匯出</);
  assert.match(el.innerHTML, /href="\/CenterConsole"/);
  assert.match(el.innerHTML, /class="seg-item is-current" href="\/secretary" aria-current="page">匯出</);
  assert.equal(el.innerHTML.includes('aria-current="page">中控'), false);
});

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
  assert.match(html, /class="app board"/);
  assert.match(html, /id="gaugePct"/);
  assert.match(html, /id="remainingNum"/);
  assert.match(html, /id="occupiedNum"/);
  assert.match(body, />車塔</);
  assert.match(body, />車塔停放</);
  assert.match(body, /目前車塔內百分比/);
  assert.match(html, /id="eventList"/);
  assert.match(html, /id="histList"/);
  assert.match(html, /site_events|eventList|KIND_WORD/);
  assert.ok(html.indexOf('id="failBanner"') < html.indexOf('id="gaugePct"'));
  assert.equal(body.includes('href="/CenterConsole"'), false);
  assert.equal(body.includes('異常'), false);
  assert.equal(body.includes('office-exceptions.js'), false);
  for (const word of FORBIDDEN) assert.equal(body.includes(word), false);
});

test('secretary is download with 2/3/4 day chips', () => {
  const { html, body } = pageBody('secretary.html');
  assert.match(html, /href="\.\/css\/office\.css"/);
  assert.match(html, /office-chrome\.js/);
  assert.match(html, /office-dates\.js/);
  assert.match(html, /mountChrome\(/);
  assert.match(html, /current:\s*'export'/);
  assert.match(body, />最近 2 天</);
  assert.match(body, />最近 3 天</);
  assert.match(body, />最近 4 天</);
  assert.match(body, />自訂</);
  assert.match(body, />下載</);
  assert.equal(body.includes('下載主管報表'), false);
  assert.equal(body.includes('秘書彙整'), false);
  assert.equal(body.includes('此區間沒有紀錄'), false);
  assert.equal(body.includes('href="/CenterConsole"'), false);
});

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
  assert.match(html, /sentryFromReport/);
  assert.match(html, /\^中控回報：\\d\\d:\\d\\d \(\.\+\)回報/);
  assert.match(html, /async function doReject\(\) \{[\s\S]*try \{[\s\S]*catch \(err\)/);
  assert.match(html, /\$\('remarkRows'\)\.hidden = true/);
  assert.equal(html.includes('leave banner'), false);
});
