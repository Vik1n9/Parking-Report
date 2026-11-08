#!/usr/bin/env node
// 建立六個預設角色帳號，密碼只寫入指定的本機檔案。
// 用法：npm run accounts:seed -- --out <file> [--local] [--reset]
//   --out    必填；username / role / password 每行一組，檔案權限 0600，已存在則拒絕
//   --local  寫入 wrangler dev 的本機 D1（預設寫 remote）
//   --reset  已存在的帳號也重設密碼（預設跳過）
// 永不把密碼印到 stdout。
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { hashPassword, randomPassword } from '../src/auth.js';

const ACCOUNTS = [
  { username: 'admin', role: 'admin', displayName: '後台管理者', postCode: null },
  { username: 'console', role: 'console', displayName: '中控', postCode: null },
  { username: 'secretary', role: 'secretary', displayName: '秘書', postCode: null },
  { username: 'captain', role: 'captain', displayName: '保全隊長', postCode: 'A1' },
  { username: 'patrol', role: 'patrol', displayName: '車巡保全', postCode: '車巡' },
  { username: 'manager', role: 'manager', displayName: '主管', postCode: null },
];

function sqlStr(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`${name} 後面要接值`);
    process.exit(1);
  }
  args.splice(index, 2);
  return value;
}

function parseRows(text) {
  const data = JSON.parse(text);
  const blocks = Array.isArray(data) ? data : [data];
  const rows = [];
  for (const block of blocks) {
    if (block && Array.isArray(block.results)) rows.push(...block.results);
  }
  return rows;
}

function existingUsernames(local) {
  const output = execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'parking-report',
      local ? '--local' : '--remote',
      '--json',
      '--command',
      'SELECT username FROM users',
    ],
    { encoding: 'utf8' }
  );
  return new Set(parseRows(output).map((row) => String(row.username).toLowerCase()));
}

const args = process.argv.slice(2);
const local = args.includes('--local');
const reset = args.includes('--reset');
const out = takeOption(args, '--out');

if (!out) {
  console.error('用法：npm run accounts:seed -- --out <file> [--local] [--reset]');
  process.exit(1);
}
if (existsSync(out)) {
  console.error(`✗ ${out} 已存在，為避免覆蓋既有密碼，請先移走或改用其他檔名`);
  process.exit(1);
}

let existing;
try {
  existing = existingUsernames(local);
} catch {
  console.error('\n✗ 讀取帳號失敗。本機請先跑 npm run db:migrate:local；remote 請先跑 db:migrate。');
  process.exit(1);
}

const targets = ACCOUNTS.filter((account) => reset || !existing.has(account.username));
if (targets.length === 0) {
  console.log('所有預設帳號都已存在；如需重設密碼請加 --reset');
  process.exit(0);
}

const prepared = await Promise.all(
  targets.map(async (account) => {
    const password = randomPassword();
    return { ...account, password, hash: await hashPassword(password) };
  })
);

const now = new Date().toISOString();
const statements = [];
for (const account of prepared) {
  statements.push(
    `INSERT INTO users (username, display_name, role, post_code, password_hash, status, must_change_pw, created_at) ` +
      `VALUES (${sqlStr(account.username)}, ${sqlStr(account.displayName)}, ${sqlStr(account.role)}, ` +
      `${account.postCode === null ? 'NULL' : sqlStr(account.postCode)}, ${sqlStr(account.hash)}, 'active', 1, ${sqlStr(now)}) ` +
      `ON CONFLICT(username) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, ` +
      `post_code = excluded.post_code, password_hash = excluded.password_hash, status = 'active', must_change_pw = 1;`
  );
  statements.push(`DELETE FROM sessions WHERE username = ${sqlStr(account.username)};`);
}

try {
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'parking-report',
      local ? '--local' : '--remote',
      '--command',
      statements.join('\n'),
    ],
    { stdio: 'inherit' }
  );
} catch {
  console.error('\n✗ 寫入失敗。本機請先跑 npm run db:migrate:local；remote 請先跑 db:migrate。');
  process.exit(1);
}

const content = prepared.map((account) => `${account.username} / ${account.role} / ${account.password}`).join('\n') + '\n';
try {
  writeFileSync(out, content, { mode: 0o600, flag: 'wx' });
} catch (err) {
  console.error(`\n✗ 帳號已寫入，但檔案 ${out} 建立失敗：${err.message}`);
  process.exit(1);
}
chmodSync(out, 0o600);

console.log(`\n✓ 已${reset ? '建立或重設' : '建立'}帳號：${prepared.map((account) => account.username).join(', ')}`);
console.log(`  密碼已寫入 ${out}（權限 0600），請妥善保管，勿貼到聊天或版本控制。`);
