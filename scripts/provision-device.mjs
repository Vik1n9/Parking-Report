#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';

const label = process.argv[2];
if (!label) {
  console.error('用法：node scripts/provision-device.mjs <裝置名稱>');
  console.error('範例：node scripts/provision-device.mjs 東門哨');
  process.exit(1);
}

const token = randomBytes(24).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');

console.log(`裝置名稱：${label}`);
console.log('');
console.log('裝置 token（只顯示這一次，請立即透過安全管道傳給保全）：');
console.log(token);
console.log('');
console.log('寫入本機開發資料庫：');
console.log(`  npx wrangler d1 execute parking-report --local --command "INSERT INTO guard_devices (label, token_hash) VALUES ('${label}', '${hash}')"`);
console.log('');
console.log('寫入線上資料庫：');
console.log(`  npx wrangler d1 execute parking-report --remote --command "INSERT INTO guard_devices (label, token_hash) VALUES ('${label}', '${hash}')"`);
console.log('');
console.log('保全設定連結（部署後把 host 換成你的 Worker 網域，透過 LINE 傳給保全點一次即可）：');
console.log(`  https://<worker-host>/guard#key=${token}`);
