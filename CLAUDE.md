# CLAUDE.md

## 專案

停車回報系統（全端）。保全在現場回報車位 → 中控確認 → 紀錄進 D1 → 秘書匯出主管報表 → 主管看唯讀儀表板。部署在 Cloudflare Workers + D1。

舊的純靜態版完整保存在 `legacy-static` 分支（GitHub Pages 線上站由該分支提供），main 是全端版。

## 結構

- `public/js/parking-core.js` — **唯一**值語意與措辭來源（正規化、驗證、兩種外框的報表、Excel 值、車塔使用率）。不含任何區域知識，所有函式吃呼叫端傳入的 `zones`。ESM，Worker 與瀏覽器共用同一份，禁止在別處重複實作
- `src/index.js` — Worker 進入點：非 `/api/*` 走靜態資產，`/api/*` 走路由
- `src/auth.js` — 保全裝置 token（Bearer，SHA-256 存 D1）+ Cloudflare Access JWT 驗證
- `src/routes/` — zones（公開）、reports（送出/佇列/確認/退回）、records（查詢）、public（主管頁公開唯讀）
- `src/export/xlsx.js` — ExcelJS 生成主管模板格式（ROC 年、並排日期表、剩餘車位數/備註交錯列）
- `public/guard.html` — 保全頁。**版型/互動不得改動**（強光、單手、首屏原則見 PRODUCT.md），行為由 `test/guard-ui.test.js` 字串斷言鎖定
- `public/CenterConsole.html` — 中控台；`public/ManagerDashboard.html` — 主管唯讀儀表板；`public/secretary.html` — 秘書匯出
- `migrations/` — D1 schema；`migrations/0002_seed.sql` — 10 區 seed（含 excel_label 模板欄位名）
- `scripts/provision-device.mjs` — 產生保全裝置 token

## 關鍵約束

1. **時間一律顯式時區**：所有格式化經 `formatTime`/`businessDate`（預設 `Asia/Taipei`），禁止 `getHours()`。資料庫時間戳一律 UTC ISO。回報時間 = 保全送出時間（`client_submitted_at`，離線補送也保留原時間）
2. **values 儲存格式**：`{zone_code: {kind, value}}` 物件（非位置陣列）。六種 kind：`spaces`/`tenths`/`carts`/`full`/`guiding`/`none`，值域 spaces 0–9999、tenths 1–9、carts 1–99，後三種不得帶 value。數字一律代表「還能停多少」。區域定義只在 D1 的 `zones` 表（`unit` 欄決定裸數字語意），`parking-core.js` 不得再出現任何區域常數
3. **伺服器重算**：確認時由 `reports.values_json` 重算所有快照，`raw_input` 僅稽核
4. **保全頁離線優先**：LINE 分享/複製 100% 本機可用；API 送出進 localStorage 佇列重試，永不阻塞
5. 測試必須雙時區通過：`TZ=Asia/Taipei` 與 `TZ=UTC`。測試資料的填表人與裝置代號一律用假名
6. **主管頁公開**：`/ManagerDashboard` 與 `/api/public/current` 免認證，該端點不得回傳 `prepared_by`、`remarks`、`report_id`、裝置代號
7. **Access 設定走 secret**：`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` 用 `wrangler secret put`，不要寫進 `wrangler.jsonc` 的 vars（會被部署洗掉）

## 指令

```bash
npm test                      # 雙時區跑法見 .github/workflows/ci.yml
npm run dev                   # wrangler dev（載入 .dev.vars 的 DEV_MODE=1）
npm run db:migrate:local      # 本地 D1 migrations
npm run db:migrate            # 線上 D1 migrations
npm run deploy                # wrangler deploy
npm run device:provision -- <名稱>   # 產生保全裝置 token + 設定連結
```

## 本機開發認證

`.dev.vars` 設 `DEV_MODE=1`（已 gitignore，範本見 `.dev.vars.example`）：Access 驗證停用，改用 header `x-dev-user: <email>` 模擬登入。**部署設定絕不開 DEV_MODE**。

線上認證 fail-closed：`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` 未設定時，所有 Access 端點一律 401。
