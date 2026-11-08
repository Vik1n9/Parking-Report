import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeNext } from '../public/js/session.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(file) {
  return fs.readFileSync(path.join(here, '..', 'public', file), 'utf8');
}

function pageBody(html) {
  return html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
}

test('login page posts credentials, changes password and sanitizes next', () => {
  const html = read('login.html');
  const body = pageBody(html);
  assert.match(html, /<title>登入<\/title>/);
  assert.match(html, /\/api\/login/);
  assert.match(html, /\/api\/change-password/);
  assert.match(html, /autocomplete="username"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /import \{ safeNext \} from '\.\/js\/session\.js'/);
  assert.match(html, /safeNext\(params\.get\('next'\), location\.origin\)/);
  assert.match(body, />登入</);
  assert.equal(/\balert\(/.test(body), false);
  assert.equal(/[^A-Za-z_]confirm\(/.test(body), false);
  assert.equal(/[^A-Za-z_]prompt\(/.test(body), false);
});

test('safeNext accepts only same-origin paths outside /login', () => {
  const origin = 'https://parking.example';
  assert.equal(safeNext('/guard', origin), '/guard');
  assert.equal(safeNext('/CenterConsole?x=1', origin), '/CenterConsole?x=1');
  const rejected = [
    '//evil.example',
    '/\\evil.example',
    decodeURIComponent('/%5Cevil.example'),
    'https://evil.example/x',
    '\t/evil',
    '\n/evil',
    '\t//evil.example',
    '/login?next=/guard',
    'javascript:alert(1)',
    null,
  ];
  for (const raw of rejected) {
    assert.equal(safeNext(raw, origin), null, `should reject ${JSON.stringify(raw)}`);
  }
});

test('admin page lists six roles and confirms destructive actions twice', () => {
  const html = read('admin.html');
  const body = pageBody(html);
  for (const role of ['後台管理者', '中控', '秘書', '保全隊長', '車巡保全', '主管']) {
    assert.ok(body.includes(role), `missing role label ${role}`);
  }
  assert.match(html, /再按一次確認/);
  assert.match(html, /4000/);
  assert.match(html, /\/api\/admin\/users/);
  assert.match(html, /reset-password/);
  assert.match(html, /\/status/);
  assert.match(html, /method: 'PATCH'/);
  assert.match(html, /formatTime\(/);
  assert.match(html, /businessDate\(/);
  assert.equal(html.includes('localStorage'), false);
  assert.equal(html.includes('getHours('), false);
  assert.equal(/\balert\(/.test(body), false);
  assert.equal(/[^A-Za-z_]confirm\(/.test(body), false);
  assert.equal(/[^A-Za-z_]prompt\(/.test(body), false);
});

test('review page polls awaiting_captain and posts review actions', () => {
  const html = read('review.html');
  const body = pageBody(html);
  assert.match(html, /awaiting_captain/);
  assert.match(html, /\/api\/reports\/\$\{active\.id\}\/review/);
  assert.match(html, /review-reject/);
  assert.match(html, /車巡原值/);
  assert.match(html, /value-edit\.js/);
  assert.match(html, /formatTime\(/);
  assert.match(html, /formatValue\(/);
  assert.match(html, /已送中控/);
  assert.match(html, /沒有待複核/);
  assert.match(html, /current: 'review'/);
  assert.match(html, /setInterval\(/);
  assert.equal(/\balert\(/.test(body), false);
  assert.equal(/[^A-Za-z_]confirm\(/.test(body), false);
  assert.equal(/[^A-Za-z_]prompt\(/.test(body), false);
});

test('console shows captain review state and drops dev headers', () => {
  const html = read('CenterConsole.html');
  assert.match(html, /隊長已複核/);
  assert.match(html, /隊長修正/);
  assert.match(html, /車巡原值/);
  assert.equal(html.includes('x-dev-user'), false);
  assert.equal(html.includes('devHeaders'), false);
  assert.match(html, /value-edit\.js/);
  assert.match(html, /session\.js/);
  assert.match(html, /loadMe\(/);
  assert.match(html, /data-logout/);
});

test('dashboard reads the session-protected API and index links to login', () => {
  const dashboard = read('ManagerDashboard.html');
  assert.match(dashboard, /\/api\/dashboard\/current/);
  assert.equal(dashboard.includes('/api/public/current'), false);
  assert.match(dashboard, /session\.js/);
  assert.match(dashboard, /apiFetch\(/);

  const index = read('index.html');
  assert.match(index, /href="\/login"/);
  assert.equal(index.includes('http-equiv="refresh"'), false);
});

test('office pages avoid blocking dialogs', () => {
  for (const file of ['login.html', 'admin.html', 'review.html', 'CenterConsole.html', 'secretary.html', 'ManagerDashboard.html', 'index.html']) {
    const body = pageBody(read(file));
    assert.equal(/\balert\(/.test(body), false, `${file} must not call alert()`);
    assert.equal(/[^A-Za-z_]confirm\(/.test(body), false, `${file} must not call confirm()`);
    assert.equal(/[^A-Za-z_]prompt\(/.test(body), false, `${file} must not call prompt()`);
  }
});
