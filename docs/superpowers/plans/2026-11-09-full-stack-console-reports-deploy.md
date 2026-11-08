# 全端完成計畫：中控覆驗、開會報告、Astryx 後台、Cloudflare 部署

| 項目 | 內容 |
|---|---|
| 日期 | 2026-11-09 |
| 分支 | `feat/console-review-and-reports`（從 `feat/manager-site-events` 分出，尚未合併 main） |
| 狀態 | 只寫計畫，尚未動程式碼 |
| 執行方式 | 新工作階段依本檔逐段實作，每段一筆 commit |

## 0. 開工前

1. 讀 `CLAUDE.md`、`PRODUCT.md`、本檔、`TODO.md`。
2. `node_modules` 已用 pkglink 連到 `~/Packages/deps/parking-report/node_modules`。新增套件一律 `pkglink npm "$PWD" install <pkg>`，不要直接 `npm install`。
3. 基準：`npm test` 67 項全過。每段完成都要在 `TZ=Asia/Taipei` 與 `TZ=UTC` 各跑一次。
4. 做 UI 前先載入 `astryx` skill；畫圖表前先載入 `dataviz` skill。
5. `docs/停車回報系統-全端規格書.md` 是使用者未追蹤的舊規格書，不要 commit、不要刪。

## 1. 現場事實與已定決策（研究結論，不要再問使用者）

### 現場

- 假日每小時回報一次。一名保全騎車巡完車塔與戶外（一圈 10–20 分鐘），回哨所（休息、等交班）口頭交給隊長 → 無線電 → 中控聽寫 → LINE → Excel。
- 保全輪班，每人路線不同。保全頁可直接點任一區輸入（`public/guard.html` 的 `moveTo(index)`），不必改格序。
- 車塔 10 層、內部相通：`車塔1下` = B2、GB、GA；`車塔1上` = 1F、2B、2A、3F、4B、4A、頂層。
- 入口顯示牌只顯示**一個數字**＝車塔總剩餘（`車塔1上` + `車塔1下`），由中控遠端手動調整，依據就是保全回報。
- 閘門計數系統只在南（往 B2）、北（往 1F）兩入口，會當機、漏算、漂移，不可信；匯出紀錄要經廠商，不在使用者權限內。**不做閘門系統介接。**
- 中控監視器看不到車塔內部；戶外可大致估成數。
- 沒有稽核員人力與預算；目前沒有哨所公務機（使用者會另行處理）。

### 使用者已選

| 題目 | 決定 |
|---|---|
| LINE | 維持分享連結（`https://line.me/R/share?text=`）＋複製。不做官方帳號機器人（推播按群組人數計費，台灣免費方案每月 200 則不夠） |
| Excel | 網站一鍵下載原格式 `.xlsx`（沿用 `src/export/xlsx.js` 範本）。**要向使用者要一份原始 Excel 比對格式**（見 §6） |
| 中控覆驗 | 中控可直接修正數字；保留保全原值、修正值、修正人 |
| 開會報告 | 各時段車塔使用率、各區滿位統計、現場事件紀錄、原始資料 CSV，全部要 |
| 版面 | 後台頁面用 Astryx（https://github.com/meta/astryx，本機有 `astryx` CLI 與 skill） |
| 部署 | 前後台都部署在 Cloudflare；**需要權限時停下來通知使用者開放**（見 §2） |

## 2. 權限檢查點：遇到就停，通知使用者，不要自己繞過

| # | 何時 | 需要使用者做什麼 | 驗證方式 |
|---|---|---|---|
| A | 第一次碰線上 D1 或部署前 | 用對 D1 `parking-report`（id `eda5e567-…`）有權限的 Cloudflare 帳號登入：`! npx wrangler login`。目前憑證回 `code: 7403` | `npx wrangler d1 execute parking-report --remote --command "SELECT 1"` 成功 |
| B | 套用 migrations | 同意對線上 DB 執行 `npm run db:migrate`（會套 0003、0004、新的 0005） | `SELECT code,label,unit FROM zones ORDER BY position` |
| C | Access 設定 | 在 Zero Trust 建 3 個 path-scoped application（`/CenterConsole*`、報告頁路徑、`/api/records*`，以及新的 `/api/events*`、`/api/stats*`）；**不要綁裸網域**（會擋到 `/guard` 與 `POST /api/reports`）。提供允許登入的 email | 使用者回傳 Team domain 與 AUD |
| D | 寫 secrets | 同意執行 `npx wrangler secret put ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`（值由使用者提供，不可寫進 `wrangler.jsonc`） | 開 `/CenterConsole` 會導到 Access 登入 |
| E | 保全裝置 | 提供哨點代號；`npm run device:provision -- <代號>` 產生的 token 只顯示一次，INSERT 到線上 DB 前要使用者同意 | 保全頁顯示「裝置綁定完成」 |
| F | 正式部署 | 同意執行 `npm run deploy` | §5 驗收清單 |

所有「對外、不可逆」動作（線上 DB 寫入、deploy、secret）都要先問。

## 3. 工作項目（依序做，每段一筆 commit）

### 段 1　後端：中控修正、顯示牌數字

- 新 migration `migrations/0005_console_review.sql`，並加進 `test/helpers/d1.js` 的預設 migrations：
  - `records.corrections_json TEXT`：被中控改過的區 `{zone_code: 保全原值}`，沒改為 NULL
  - `records.tower_remaining INTEGER`：車塔總剩餘＝顯示牌應設數字（`buildTowerUsage(...).remaining`），無效時 NULL
  - `records.display_before INTEGER`：中控調整前，顯示牌原本的數字（選填；之後拿來量閘門系統每小時漂移）
  - 回填既有 records 的 `tower_remaining`（in_tower 各區都是 spaces 或 full 才算，否則 NULL）
- `confirmReport`（`src/routes/reports.js`）：
  - body 可帶 `values`（部分或全部區），逐區 `validateValue`，合併到保全原值上
  - `reports.values_json` 保持保全原值不動；`records.values_json` 存最終值
  - 所有快照（guard/console report、excel_values、tower pct）由**最終值**重算
  - `display_before`：0–9999 整數或省略，否則 400
- `mapRecord` 加 `corrections`、`towerRemaining`、`displayBefore`。
- `/api/zones` 回應加 `towerTotal`（給前端即時算顯示牌數字）。
- 更新 `CLAUDE.md` Constraints 第 3 條：伺服器以「保全原值＋中控修正」重算；`reports.values_json` 永遠是保全原值。
- 測試（`test/routes.test.js`、`test/migrations.test.js`）：修正後快照用新值、corrections 只記改過的區、原 report 值不變、非法修正值 400、display_before 範圍、回填正確、重複 confirm 冪等不受影響。

### 段 2　後端：現場事件寫入

- 表 `site_events` 已存在（0004），目前只有讀取。kind：`guiding`＝引導、`jam`＝塞車、`special`＝車禍（對照 `ManagerDashboard.html` 的 `KIND_WORD`）。
- 新 API（Access 保護）：
  - `POST /api/events`：`{kind, zone_code?, occurred_at?, detail?}`，`occurred_at` 預設現在，`business_date` 用 `businessDate()`，`created_by` 取 Access email
  - `POST /api/events/:id/clear`：寫 `cleared_at`
  - `GET /api/events?from&to`
- `/api/public/current` 照舊（不得回傳 `created_by`，同 Constraint 6）。
- 測試：kind 驗證、未知區 400、clear 冪等、public 不洩漏 created_by。

### 段 3　後端：開會報告資料

- `GET /api/stats?from&to`（Access 保護），單一 SQL 或少量查詢（D1 每次呼叫查詢數有上限，不可逐筆迴圈）：
  - 每小時車塔使用率：每天每小時的值，以及區間內每小時平均／最高
  - 各區滿位統計：每區 `full`、`guiding` 的次數與發生時段
  - 現場事件：種類、區、開始、結束、持續分鐘
  - 修正統計：被中控修正的筆數與區（量傳遞錯誤用）
  - 顯示牌漂移：`display_before − tower_remaining` 的每筆值與平均（有填才算）
- `GET /api/records/export.csv?from&to`：原始明細 CSV（UTF-8 BOM，Excel 直接開不亂碼），欄位：日期、回報時間、各區值、車塔剩餘、使用率、是否修正、調整前顯示牌數字、備註。
- 時間一律用 `formatTime`／`businessDate`，不准 `getHours()`（Constraint 1）。
- 測試：雙時區下時段分組正確、空區間、CSV 跳脫逗號與換行。

### 段 4　保全頁：未送出輸入暫存

- 版面**不得改變**（Constraint、`test/guard-ui.test.js`）。只加行為：每次 `commitDraft`／清除時把目前各格存到 localStorage；開頁時還原；送出成功或按清除全部後清掉。存讀都包 try/catch。
- 在 `test/guard-ui.test.js` 補字串斷言鎖住此行為。

### 段 5　後台前端改用 Astryx

- Astryx 是 React 元件庫，需要 build 步驟。做法：
  - 新增 Vite + React + Astryx（先 `astryx docs getting-started`、`astryx build` 查官方流程）
  - 後台頁面 build 輸出到 `public/`（或新資料夾並改 `wrangler.jsonc` 的 `assets.directory`；`run_worker_first` 與路徑 `/CenterConsole`、`/ManagerDashboard`、報告頁要維持可用）
  - `public/js/parking-core.js` 仍是唯一格式化來源，React 直接 import，不得複製邏輯
  - **`guard.html` 不改用 Astryx**：保全頁鎖定版面、要離線可用、不能有 build 依賴。除非使用者明確說要改
- 頁面：
  1. **中控 `/CenterConsole`**：待確認佇列（8 秒輪詢）→ 覆驗面板：各區可編輯（輸入規則同 `normalizeInput`，可打 `232`、`滿`、`3成`、`停2台`、`引導中`、`未停車`），改過的區標示保全原值；即時顯示「顯示牌應設為：N」；選填「調整前顯示牌數字」；備註；確認後自動複製中控回報，並有「LINE 分享」「再複製」按鈕；今日紀錄列表顯示時間、剩餘 N、使用率、已修正標記；退回照舊。另有「登記現場事件」（引導／塞車／車禍、區、說明）與「解除」。
  2. **報告 `/reports`**（取代 `/secretary`，舊路徑轉址）：日期區間（最近 2/3/4 天、自訂）；圖表：每小時車塔使用率；表：各區滿位統計、現場事件、修正統計、顯示牌漂移；按鈕：下載原格式 Excel、下載 CSV、列印（列印用版面）。
  3. **主管 `/ManagerDashboard`**：照現有功能移植（目前分支的 KPI、樓層與戶外長條、事件窗、點長條看該小時報告）。公開、唯讀、不得出現 `prepared_by`、備註、report id、裝置代號。
- 測試：`test/office-ui.test.js` 是對 HTML 原始碼的字串斷言，改成 React 後會失效；改寫成對 build 後頁面或元件的行為測試，保住原本鎖定的規則（禁止字詞、主管頁不得連到中控等）。
- Access 路徑：報告頁若改名，同步更新 `TODO.md` 與 §2-C。

### 段 6　Excel 原格式比對

- 拿到使用者的原始 Excel 後，用 `anthropic-skills:xlsx` skill 讀取，逐項比對 `src/export/xlsx.js` 輸出：標題（民國年）、欄序、日期並排、「剩餘車位數／備註」交錯列、數值格式、欄寬。差異寫測試再修。

### 段 7　部署（依 §2 權限檢查點逐步做）

1. A → B：線上 migrations
2. C → D：Access 與 secrets
3. F：`npm run deploy`
4. E：發保全裝置 token
5. 驗收（§5）

## 4. 系統要支援的量測（給之後的改善驗證用）

| 指標 | 來源欄位 |
|---|---|
| 傳遞錯誤（中控修正率） | `records.corrections_json` |
| 數字延遲（回報→確認） | `reports.submitted_at` → `records.confirmed_at` |
| 顯示牌每小時誤差／閘門系統漂移 | `records.display_before` − `records.tower_remaining` |
| 交班前後落差（找出保全點數偏差） | 連續兩筆 `tower_remaining`；需要知道是哪位保全（見 §6 第 2 題） |
| 現場事件持續時間 | `site_events.occurred_at` → `cleared_at` |

## 5. 驗收清單

- [ ] 保全手機開 `/guard`，輸入一半鎖屏再開，數字還在；送出後中控 8 秒內看到
- [ ] 中控改一區數字確認，LINE 文、Excel、主管頁都用修正值；報告頁「修正統計」+1
- [ ] 顯示牌數字＝車塔1上＋車塔1下剩餘
- [ ] LINE 分享按鈕能開 LINE 選群組（手機）；電腦端至少能複製
- [ ] 報告頁下載的 Excel 與原始格式一致；CSV 用 Excel 打開不亂碼
- [ ] 未登入開 `/CenterConsole`、`/reports`、`/api/records`、`/api/events`、`/api/stats` 會被 Access 擋；`/guard`、`/ManagerDashboard`、`/api/public/current` 不被擋
- [ ] `npm test` 在兩個時區都通過

## 6. 待使用者回覆（遇到時再問，不阻擋其他段）

1. 原始 Excel 檔（段 6 需要）。
2. 輪班保全要不要在回報上記姓名？要的話得改保全頁版面（目前鎖定），需使用者明確同意。
3. 哨點代號（段 7 發 token 用）。
4. 允許登入後台的 email 清單（§2-C）。

## 7. 不做

LINE 官方帳號機器人、雲端試算表同步、閘門計數系統介接、稽核員流程、保全頁版面改版、班次表、多廠區、區域設定後台。
