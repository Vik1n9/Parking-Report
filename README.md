# Parking Report 停車回報系統

保全現場回報 → 中控確認 → 紀錄進雲端資料庫 → 秘書匯出主管報表，一次完成。部署於 Cloudflare Workers + D1。

> 舊版（純靜態、GitHub Pages）保存在 [`legacy-static`](../../tree/legacy-static) 分支。

## 頁面

| 路徑 | 使用者 | 功能 |
|---|---|---|
| `/guard` | 保全隊長、車巡 | 手機版數字鍵盤回報（強光/單手設計）。LINE 分享與複製完全本機可用；送出後台自動同步，離線也不影響完成工作 |
| `/CenterConsole` | 中控 | 待確認佇列、確認/退回、LINE 回報文字一鍵複製、當日紀錄 |
| `/ManagerDashboard` | 主管、中控、秘書 | 唯讀儀表板：車塔使用率（大圖百分比）、各區狀態、當日趨勢。讀 `/api/dashboard/current`，不含填表人與備註，並帶 `noindex` |
| `/secretary` | 秘書 | 日期區間查詢、下載主管報表 Excel（與人工模板同格式） |

全站以預先建立的共用角色帳號登入（沒有註冊）；未登入一律導到 `/login`。

線上網址：`https://parking.voriens.dev`

## 上線設定（一次性）

1. **建立角色帳號**（需要先套用 migration `0006_accounts_review.sql`）：
   ```bash
   npm run accounts:seed -- --out ~/parking-accounts.txt
   # 六個帳號的密碼只寫進該檔（0600），終端不顯示
   ```
   單一帳號建立或重設密碼：
   ```bash
   npm run account:create -- <username> <role> [display_name] [--post <code>] [--local]
   ```
   角色：`admin`／`console`／`secretary`／`captain`／`patrol`／`manager`。新帳號與重設後都必須先改密碼。
2. **Cloudflare Access**：帳號上線並驗收後再刪除「停車回報後台」應用與 Email OTP；程式已不再驗證 Access JWT。

## 本機開發

```bash
npm install
cp .dev.vars.example .dev.vars   # DEV_MODE=1 只影響 cookie 的 Secure 旗標
npm run db:migrate:local
npm run dev
npm test
```

本機帳號可用 `npm run account:create -- <username> <role> --local` 建立；`npm run preview:local` 會種好六個本機測試帳號。

## 部署

```bash
npm run db:migrate   # 有新 migration 時
npm run deploy
```

CI（GitHub Actions）在每次 push 跑雙時區（`Asia/Taipei`/`UTC`）測試；部署走 `workflow_dispatch` 手動觸發（需 repo secret `CLOUDFLARE_API_TOKEN`）。

## 資料語意

- 每筆回報 = 每個區一個值物件 `{kind, value}`，六種 kind：`spaces`（剩餘車位）、`tenths`（成數空）、`carts`（台車）、`full`（滿）、`guiding`（引導中）、`none`（未停車）
- 數字一律代表「還能停多少」；`zones.unit` 決定裸數字在該區是車位數還是成數
- 區域定義只在 D1 的 `zones` 表；新增／改名／停用一個區只需改一列，四個頁面自動跟上
- LINE 文字兩種外框、一組措辭：保全分享用「停車場回報」、中控轉貼用「中控回報：HH:MM <代號>回報」（後者會把連續未停車的區合併成一句）
- 「營運日」以台北時區計算；回報時間以保全送出時間為準（離線補送保留原時間）
- Excel 匯出重現主管模板：ROC 年標題、並排日期表、`剩餘車位數`/`備註` 交錯列
