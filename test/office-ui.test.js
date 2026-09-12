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
