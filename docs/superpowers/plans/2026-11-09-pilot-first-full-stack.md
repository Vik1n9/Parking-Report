# 全端計畫（試點優先）：上線 → 試點 → 營運提醒 → 報告 → 再評估 UI

| 項目 | 內容 |
|---|---|
| 日期 | 2026-11-09（同日改寫：由「先做完再上線」改為「試點優先」） |
| 分支 | `feat/console-review-and-reports`（從 `feat/manager-site-events` 分出，尚未合併 main） |
| 狀態 | 段 1–3 完成（2026-11-09，80 測試雙時區過；本機 workerd 端到端驗證過）；段 4 卡在 §2-B 起的權限檢查點（§2-A 已通過） |
| 執行方式 | 新工作階段依本檔逐段實作，每段一筆 commit |

## 指導原則（改寫理由）

內部營運工具成敗看三件事：現場真的在用、資料可信、維護得下去。所以：

1. **先上線、再加功能。** 現有系統已能取代「隊長轉述 → 無線電 → 中控聽寫」三次轉錄，這是核心價值。卡住上線的是 Cloudflare 權限，不是畫面。
2. **技術保持無聊。** 後台維持現有純 HTML + `public/css/office.css`，不加建置步驟。Astryx 暫緩（理由見 §6）。
3. **報告不做萬用報表工具。** 固定幾張報表 + 原始資料匯出，其餘交給 Excel / BI / AI。
4. **營運提醒比畫面美化更有價值。** 漏報、異常值要主動提示。

## 0. 開工前

1. 讀 `CLAUDE.md`、`PRODUCT.md`、本檔、`TODO.md`。
2. `node_modules` 已用 pkglink 連到 `~/Packages/deps/parking-report/node_modules`。新增套件一律 `pkglink npm "$PWD" install <pkg>`，不要直接 `npm install`。
3. 基準：`npm test` 67 項全過。每段完成都要在 `TZ=Asia/Taipei` 與 `TZ=UTC` 各跑一次。
4. 畫圖表前先載入 `dataviz` skill。
5. `docs/停車回報系統-全端規格書.md` 是使用者未追蹤的舊規格書，不要 commit、不要刪。

## 1. 現場事實與已定決策（研究結論，不要再問使用者）

### 現場

- 假日每小時回報一次。一名保全騎車巡完車塔與戶外（一圈 10–20 分鐘），回哨所（休息、等交班）口頭交給隊長 → 無線電 → 中控聽寫 → LINE → Excel。
- 保全輪班，每人路線不同。保全頁可直接點任一區輸入（`public/guard.html` 的 `moveTo(index)`），不必改格序。
- 車塔 10 層、內部相通：`車塔1下` = B2、GB、GA；`車塔1上` = 1F、2B、2A、3F、4B、4A、頂層。
- 入口顯示牌只顯示**一個數字**＝車塔總剩餘（`車塔1上` + `車塔1下`），由中控遠端手動調整，依據就是保全回報。
- 閘門計數系統只在南（往 B2）、北（往 1F）兩入口，會當機、漏算、漂移，不可信；匯出紀錄要經廠商，不在使用者權限內。**不做閘門系統介接。**
- 中控監視器看不到車塔內部；戶外可大致估成數。
- 沒有稽核員人力與預算；目前沒有哨所公務機（使用者另行處理）。

### 使用者已選

| 題目 | 決定 |
|---|---|
| LINE | 分享連結（`https://line.me/R/share?text=`）＋複製。不做官方帳號機器人（推播按群組人數計費，台灣免費方案每月 200 則不夠） |
| Excel | 網站一鍵下載原格式 `.xlsx`（沿用 `src/export/xlsx.js`）。要向使用者要一份原始 Excel 比對 |
| 中控覆驗 | 中控可直接修正數字；保留保全原值、修正值、修正人 |
| 開會報告 | 各時段車塔使用率、各區滿位統計、現場事件紀錄、原始資料 CSV |
| UI 框架 | 暫不導入 Astryx，維持現有純 HTML（見 §6 重新評估條件） |
| 部署 | Cloudflare；需要權限時停下來通知使用者（§2） |

## 2. 權限檢查點：遇到就停，通知使用者，不要自己繞過

| # | 何時 | 需要使用者做什麼 | 驗證方式 |
|---|---|---|---|
| A | 第一次碰線上 D1 或部署前 | 用對 D1 `parking-report`（id `eda5e567-…`）有權限的 Cloudflare 帳號登入：`! npx wrangler login`。目前憑證回 `code: 7403` | `npx wrangler d1 execute parking-report --remote --command "SELECT 1"` 成功 |
| B | 套用 migrations | 同意對線上 DB 執行 `npm run db:migrate`（0003、0004、新的 0005…） | `SELECT code,label,unit FROM zones ORDER BY position` |
| C | Access 設定 | 在 Zero Trust 建 path-scoped application：`/CenterConsole*`、`/secretary*`、`/api/records*`，以及之後新增的 `/api/events*`、`/api/stats*`。**不要綁裸網域**（會擋到 `/guard` 與 `POST /api/reports`）。提供允許登入的 email | 使用者回傳 Team domain 與 AUD |
| D | 寫 secrets | 同意執行 `npx wrangler secret put ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`（值由使用者提供，不可寫進 `wrangler.jsonc`） | 開 `/CenterConsole` 會導到 Access 登入 |
| E | 保全裝置 | 提供哨點代號；`npm run device:provision -- <代號>` 產生的 token 只顯示一次，INSERT 到線上 DB 前要使用者同意 | 保全頁顯示「裝置綁定完成」 |
| F | 正式部署 | 同意執行 `npm run deploy` | 各階段驗收清單 |

所有對外、不可逆動作（線上 DB 寫入、deploy、secret）都要先問。

---

## 階段一：上線可試點的最小版本

目標：下一個假日就能試點。全部在現有純 HTML 頁面上做，不加建置步驟。

### 段 1　後端：中控修正、顯示牌數字

- 新 migration `migrations/0005_console_review.sql`，並加進 `test/helpers/d1.js` 預設 migrations：
  - `records.corrections_json TEXT`：被中控改過的區 `{zone_code: 保全原值}`，沒改為 NULL
  - `records.tower_remaining INTEGER`：車塔總剩餘＝顯示牌應設數字（`buildTowerUsage(...).remaining`），無效時 NULL
  - `records.display_before INTEGER`：中控調整前顯示牌原本的數字（選填；用來量閘門系統每小時漂移）
  - 回填既有 records 的 `tower_remaining`（in_tower 各區都是 spaces 或 full 才算，否則 NULL）
- `confirmReport`（`src/routes/reports.js`）：
  - body 可帶 `values`（部分或全部區），逐區 `validateValue`，合併到保全原值上
  - `reports.values_json` 保持保全原值不動；`records.values_json` 存最終值
  - 所有快照（guard/console report、excel_values、tower pct）由**最終值**重算
  - `display_before`：0–9999 整數或省略，否則 400
- `mapRecord` 加 `corrections`、`towerRemaining`、`displayBefore`。
- `/api/zones` 回應加 `towerTotal`。
- 更新 `CLAUDE.md` Constraints 第 3 條：伺服器以「保全原值＋中控修正」重算；`reports.values_json` 永遠是保全原值。
- 測試：修正後快照用新值、corrections 只記改過的區、原 report 值不變、非法修正值 400、display_before 範圍、回填正確、重複 confirm 冪等不受影響。

### 段 2　保全頁：未送出輸入暫存

- 版面**不得改變**（`test/guard-ui.test.js` 鎖定）。只加行為：每次 `commitDraft`／清除時把各格存 localStorage；開頁還原；送出成功或清除全部後清掉。存讀都包 try/catch。
- 在 `test/guard-ui.test.js` 補字串斷言鎖住此行為。

### 段 3　中控頁：覆驗面板（純 HTML，沿用 `office.css`）

- 確認面板各區可編輯，輸入規則同 `normalizeInput`（`232`、`滿`、`3成`、`停2台`、`引導中`、`未停車`）；改過的區顯示保全原值。
- 即時顯示「顯示牌應設為：N」（`buildTowerUsage`，`towerTotal` 取自 `/api/zones`）。
- 選填「調整前顯示牌數字」。
- 確認後自動複製中控回報；按鈕：「LINE 分享」（`line.me/R/share?text=`）、「再複製」、「關閉」。
- 今日紀錄列表：時間、剩餘 N、使用率、已修正標記。
- 更新 `test/office-ui.test.js` 斷言（保留既有禁止字詞等規則）。

### 段 4　部署與試點準備

1. 依 §2：A → B → C → D → F → E。
2. 試點文件（放 `docs/pilot/`）：
   - **紙本備援 SOP**：系統或手機故障時的回報流程；附 10 區固定格式護貝卡（順序同系統）
   - **保全操作卡**（A6）：開頁、輸入、送出、離線時怎麼辦
   - **中控操作卡**：確認、修正、調顯示牌、LINE 分享
   - **試點紀錄表**：每輪回報時間、是否改用紙本、問題描述
3. 驗收：
   - [ ] 保全手機輸入一半鎖屏再開，數字還在；送出後中控 8 秒內看到
   - [ ] 中控改一區數字確認，LINE 文、Excel、主管頁都用修正值
   - [ ] 顯示牌數字＝車塔1上＋車塔1下剩餘
   - [ ] LINE 分享按鈕在手機能開 LINE 選群組；電腦端至少能複製
   - [ ] 未登入開 `/CenterConsole`、`/secretary`、`/api/records` 被 Access 擋；`/guard`、`/ManagerDashboard`、`/api/public/current` 不被擋
   - [ ] `npm test` 兩個時區都通過

**階段一完成後：** 試點一個假日（紙本並行），收集基準數據，再進階段二。

---

## 階段二：營運提醒與現場事件

### 段 5　漏報與異常值提醒（中控頁）

- **漏報**：今天已有至少一筆回報，且距最新一筆 `submitted_at` 超過 75 分鐘、現在時間仍在營運時段內 → 中控頁頂端紅色提示。門檻（75 分鐘、營運時段結束時間）放常數或 `sites` 欄位；時間比較用 `formatTime`／`businessDate`，不准 `getHours()`。
- **異常值**：確認面板上與上一筆紀錄比對，車塔剩餘變化超過門檻（預設 300 格，可設定），或戶外某區成數一輪內變化 ≥5 → 該區標示「請再確認」。只提示，不阻擋確認。
- 判斷邏輯寫成純函式（可放 `public/js/` 新檔，不放進 `parking-core.js` 以免混入營運規則），雙時區測試。

### 段 6　現場事件寫入

- 表 `site_events` 已存在（0004），目前只有讀取。kind：`guiding`＝引導、`jam`＝塞車、`special`＝車禍（對照 `ManagerDashboard.html` 的 `KIND_WORD`）。
- API（Access 保護）：`POST /api/events`（`{kind, zone_code?, occurred_at?, detail?}`，`created_by` 取 Access email）、`POST /api/events/:id/clear`、`GET /api/events?from&to`。
- 中控頁加「登記事件」與「解除」。
- `/api/public/current` 不得回傳 `created_by`（Constraint 6）。
- 測試：kind 驗證、未知區 400、clear 冪等、public 不洩漏。
- 部署前通知使用者在 Access 加 `/api/events*`（§2-C）。

---

## 階段三：報告（資料優先，固定報表其次）

### 段 7　原始資料與原格式 Excel

- `GET /api/records/export.csv?from&to`：UTF-8 BOM，欄位：日期、回報時間、各區值、車塔剩餘、使用率、是否修正、調整前顯示牌數字、備註。測試逗號、換行跳脫。
- 拿到使用者原始 Excel 後，用 `anthropic-skills:xlsx` skill 讀取，逐項比對 `src/export/xlsx.js` 輸出：標題（民國年）、欄序、日期並排、「剩餘車位數／備註」交錯列、數值格式、欄寬。差異先寫測試再修。
- 秘書頁加「下載 CSV」。

### 段 8　固定報表列印頁

- **先向使用者要秘書最近 2–3 次開會實際用過的報告**，照實際需要做，不要猜。
- 預設候選（使用者已選）：各時段車塔使用率（每天每小時、區間平均／最高）、各區滿位統計（`full`、`guiding` 次數與時段）、現場事件（持續分鐘）、修正統計、顯示牌漂移（`display_before − tower_remaining`）。
- `GET /api/stats?from&to`（Access 保護），少量 SQL，不逐筆迴圈（D1 每次呼叫查詢數有上限）。
- 頁面純 HTML + 列印 CSS；圖表用原生 SVG 或小型套件（uPlot／Chart.js），畫前載入 `dataviz` skill。
- 其他臨時報告：用 CSV 在 Excel / Power BI / Looker Studio 做，或交給 Claude 整理。不做萬用報表產生器。
- 部署前通知使用者在 Access 加 `/api/stats*`。

---

## 4. 系統支援的量測（改善驗證用）

| 指標 | 來源 |
|---|---|
| 傳遞錯誤（中控修正率） | `records.corrections_json` |
| 數字延遲（回報→確認） | `reports.submitted_at` → `records.confirmed_at` |
| 顯示牌每小時誤差／閘門系統漂移 | `records.display_before` − `records.tower_remaining` |
| 漏報輪數 | 段 5 的漏報判斷，逐日統計 |
| 交班前後落差 | 連續兩筆 `tower_remaining`；需知道是哪位保全（見 §5 第 2 題） |
| 現場事件持續時間 | `site_events.occurred_at` → `cleared_at` |

## 5. 待使用者決定或提供（遇到時再問，不阻擋其他段）

1. 原始 Excel 檔（段 7）。
2. 秘書過去開會用過的報告（段 8）。
3. 輪班保全要不要在回報上記姓名？要的話得改保全頁版面（目前鎖定），需使用者明確同意。
4. 主管頁維持公開，還是改成 Access email 驗證碼登入？目前公開、不含個資，但網址外流任何人可看即時車位。
5. 哨點代號（§2-E）、允許登入後台的 email（§2-C）。
6. 營運時段（漏報提醒用），例如 08:00–20:00。

## 6. UI 框架重新評估（Astryx 暫緩）

暫緩理由：Astryx 2026-06 才公開、仍是 beta（v0.x，小版本可能破壞性變更）、需要 React 19 與建置步驟、尚無穩定圖表套件；本系統後台頁少且單純，換框架的成本（建置流程、重寫頁面與 UI 測試、追 beta 更新）大於收益。

符合任一條件再評估：

- 後台頁面增加到 6 個以上，或出現複雜表格／多步驟表單
- 有第二位開發者一起維護前端
- Astryx 發佈 1.0

即使導入，也只先用在報告頁。**保全頁永遠不換框架**（離線、強光、單手、鎖定版面）。

## 7. 不做

LINE 官方帳號機器人、雲端試算表同步、閘門計數系統介接、稽核員流程、保全頁版面改版、萬用報表產生器、班次表、多廠區、區域設定後台。
