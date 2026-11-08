#!/usr/bin/env node
// 建立或重設一個角色帳號。
// 用法：npm run account:create -- <username> <role> [display_name] [--post <code>] [--password <pw>] [--local]
//   --local    寫入 wrangler dev 的本機 D1（預設寫 remote）
//   --post     哨點代號（回報標題用，例如 A1、車巡）
//   --password 指定密碼（預設隨機產生並印出，只顯示這一次）
// 雜湊格式與 src/auth.js 相同：pbkdf2$100000$<saltHex>$<hashHex>
import { execFileSync } from 'node:child_process';
import { ROLES, hashPassword, randomPassword } from '../src/auth.js';

const USERNAME_RE = /^[a-z0-9_.-]{2,32}$/;

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

const args = process.argv.slice(2);
const local = args.includes('--local');
const postCode = takeOption(args, '--post') ?? null;
let password = takeOption(args, '--password');
const positional = args.filter((arg) => !arg.startsWith('--'));
const username = (positional[0] || '').trim().toLowerCase();
const role = (positional[1] || '').trim();
const displayName = (positional[2] || username).trim();

if (!USERNAME_RE.test(username) || !ROLES.includes(role)) {
  console.error('用法：npm run account:create -- <username> <role> [display_name] [--post <code>] [--password <pw>] [--local]');
  console.error('username 限 2–32 字的小寫 a-z、0-9、_ . -');
  console.error(`role 限 ${ROLES.join('/')}`);
  process.exit(1);
}
if (!displayName || displayName.length > 20) {
  console.error('顯示名稱須為 1～20 字');
  process.exit(1);
}
if (postCode !== null && postCode.length > 20) {
  console.error('哨點代號最多 20 字');
  process.exit(1);
}
if (password !== null && (password.length < 8 || password.length > 128)) {
  console.error('密碼長度須為 8～128 字');
  process.exit(1);
}

const generated = password === null;
const pw = password ?? randomPassword();
const hash = await hashPassword(pw);
const now = new Date().toISOString();
const sql =
  `INSERT INTO users (username, display_name, role, post_code, password_hash, status, must_change_pw, created_at) ` +
  `VALUES (${sqlStr(username)}, ${sqlStr(displayName)}, ${sqlStr(role)}, ${postCode === null ? 'NULL' : sqlStr(postCode)}, ` +
  `${sqlStr(hash)}, 'active', 1, ${sqlStr(now)}) ` +
  `ON CONFLICT(username) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, ` +
  `post_code = excluded.post_code, password_hash = excluded.password_hash, status = 'active', must_change_pw = 1; ` +
  `DELETE FROM sessions WHERE username = ${sqlStr(username)};`;

try {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'parking-report', local ? '--local' : '--remote', '--command', sql],
    { stdio: 'inherit' }
  );
} catch {
  console.error('\n✗ 寫入失敗。本機請先跑 npm run db:migrate:local；remote 請先跑 db:migrate。');
  process.exit(1);
}

console.log(`\n✓ 帳號 ${username}（${role}）已${generated ? '建立' : '更新'}，下次登入須先變更密碼`);
console.log(`  密碼：${pw}`);
console.log('  （只顯示這一次，請轉交使用者並提醒立即變更）');
