# 「停車回報系統全端規格書 v0.1」可行性審查

| 項目 | 內容 |
|---|---|
| 審查對象 | 停車回報系統（Parking Report）全端規格書 v0.1（2026-09-08 草案） |
| 審查基準 | 本倉庫 `main`（commit `1587c9e`）實際程式碼 |
| 審查日期 | 2026-09-08 |
| 結論 | 技術可行、成本近乎為零；但規格書有 6 處必須先補正才能開工，且對現有程式碼的現況描述有一處與事實不符 |

---

## 1. 結論（先講重點）

1. **技術可行性：高。** Workers + D1 完全能承載此系統。以「每班次數筆回報、10 個欄位」的量級，讀寫量比 D1 免費額度低數個數量級，不存在容量或效能風險。
2. **主要風險不在後端，在遷移。** 三個具體風險：`index.html` 的邏輯是**重複實作**而非共用 `parking-core.js`；`guard-ui.test.js` 是綁死 HTML 字串的快照測試；`parking-core` 的時間格式化依賴 host 時區，任何 build 流程都會讓它整份作廢；`parking-core.js` 目前是 UMD/CJS，Workers 需要 ESM。
3. **規格書有 6 處設計缺口必須先補**（狀態機、冪等鍵、時區、班次跨日、塔樓計算與 zones 可設定化的矛盾、tokens 與 zones 的版本漂移），其中「時區」和「tokens 版本漂移」如果 P0 沒做對，之後修正成本很高。
4. **P0 範圍偏大，建議再切一刀。**
5. **LINE 策略需修正事實基礎**：LINE Notify 已於 2025-03-31 終止服務，P2 只剩 Messaging API 一條路，且推播到「工作群組」有前置條件（見 §5.7）。

---

## 2. 現況查核：規格書與程式碼不符之處

> 這一節是**事實查核**，不是意見。

### 2.1 `parking-core.js` 目前**不是**唯一格式化來源（規格書 §5「關鍵約束」已被違反）

| 檔案 | 是否載入 `parking-core.js` | 實際狀況 |
|---|---|---|
| `guard.html` | 是（`<script src="parking-core.js">`，L612） | 正確共用 |
| `index.html` | **否** | L648–L905 內嵌了一份完整重複的 `LABELS`、`ALIAS_MAP`、`IS_CAR`、`TOWER_TOTAL`、`parseText`、`zoneInfo`、`toExcel`、`buildReport`、`buildTowerPctCard` |

`CLAUDE.md` 描述「共用報表格式化邏輯位於 `parking-core.js`」對 `index.html` 而言不成立。目前兩份實作語意等價（已比對），但這是靠人工同步維持的，沒有任何測試在守。

**影響**：規格書 §12 把 `parking-core.js` 列為「抽成共用模組」的既有資產，實際上**還沒抽完**。這件事應該在**現有倉庫**先做完（純重構、可被現有 `parking-core.test.js` 保護），再搬到新倉庫，否則會把重複實作一起搬過去。

### 2.2 `guard-ui.test.js` 是脆弱的 HTML 字串快照測試

86 行中約 60 行是對 `guard.html` 原始碼的正則比對，內容包含 CSS 變數字面值（`--bg:#f3f7fb`）、字型堆疊字串、`@media` 查詢字串、DOM 元素相對順序。

**影響**：這是遷移最大的隱形成本，規格書完全沒提到。只要 `/guard` 進入任何有編譯步驟的形式（框架、CSS 前處理、bundler、甚至只是把 `<style>` 抽成外部檔），這份測試會整份失效，而它守護的正是 PRODUCT.md 的強光/單手設計約束 —— 也就是這個專案**最不能退化**的部分。

**建議**：見 §5.8。

### 2.3 現有測試隱含依賴執行環境時區

`parking-core.test.js` 在 `TZ=Asia/Taipei` 下通過，在 `TZ=UTC` 下失敗（實測結果見 §4.3）。這代表現行測試無法在 Workers 的 UTC runtime 下作為回歸保護。

### 2.4 `parking-core.js` 的模組格式

目前是 UMD wrapper（`module.exports` + 掛 `globalThis.ParkingCore`）。Cloudflare Workers 用 ES Module worker 格式，需要 `export`。這是小改動，但會牽動 `parking-core.test.js`（`require`）與兩個 HTML 的 `<script>` 載入方式。

---

## 3. 可行性評估

### 3.1 技術與容量

| 面向 | 評估 | 依據 |
|---|---|---|
| Workers 運算 | 無風險 | 每次請求只做解析與字串組裝，無重運算 |
| D1 容量 | 無風險 | 免費方案每帳號 10 個資料庫、單一資料庫上限 500 MB、帳號總儲存 5 GB。本系統每筆紀錄約數百 bytes，即使每天 100 筆、存 10 年也不到 400 MB |
| D1 每次 Worker 呼叫查詢數 | 需注意 | 免費方案上限 50 queries／invocation。秘書匯出區間資料時**務必用單一 SQL 加 JOIN**，不要在迴圈裡逐筆查 |
| 即時性 | 短輪詢即可 | 中控「有新回報」用 5–10 秒輪詢就夠，不需要 Durable Object（規格書 §5 已標為可選，同意） |

（來源：Cloudflare D1 limits 官方文件）

### 3.2 成本

Workers Free + D1 Free 可覆蓋。唯一可能付費的是認證方案 —— 見 §5.6。

### 3.3 營運面（這是我認為最該注意的）

現行系統的最大優點是**沒有後端就不會壞**。加上後端後新增了三個現場故障模式，規格書只涵蓋了第一個：

1. 弱網 → §11 已規劃本機佇列（好）
2. **後端掛掉 / D1 不可用** → 規格書無 fallback 設計。保全在現場不能因為 Cloudflare 出問題就無法回報。
3. **認證過期 / 換裝置 / 換人代班** → 保全在強光下、單手、可能戴手套，任何需要重新登入的流程都會直接破壞 PRODUCT.md 的四條原則。

**建議（重要）**：`/guard` 必須維持「**離線可用、送出是加分項**」的架構——本機先完成完整報表與 LINE 分享（現行行為 100% 保留），送 API 失敗就進本機佇列並明確標示「未同步」，絕不阻擋保全完成工作。規格書 §3 的流程圖把「建立回報單」畫成必經節點，讀起來像是阻塞式的，需要明確寫成非阻塞。

---

## 4. 規格書必須修改的部分

### 4.1 狀態機與 `reports.status` 不一致（必改）

- §3 定義：`draft → pending → confirmed`（可 `rejected`）
- §7.5 定義：`reports.status ∈ pending | rejected`

`confirmed` 不在 `reports.status` 的值域裡，導致「這張回報單是否已被確認」只能靠 `records.report_id` 反查，佇列查詢 `?status=pending` 會在確認後仍撈到舊單，除非額外 JOIN。

另外 **`rejected` 之後的流程未定義**：保全是修改原單重送，還是新建一單？

**建議**：
- `reports.status ∈ draft | pending | confirmed | rejected`
- rejected 後由保全**新建**一單，帶 `supersedes_report_id`，保留退回歷程（符合 §11 的稽核要求）

### 4.2 冪等鍵沒有進資料模型（必改）

§11 要求「冪等 client_request_id」，但 §7.5 `reports` 欄位清單裡沒有這個欄位。

**建議**：`reports` 加 `client_request_id TEXT NOT NULL`，加 `UNIQUE(site_id, client_request_id)`。重送時回 200 + 既有資源，不回 409（前端在弱網重試下更好處理）。

### 4.3 時區（必改，且是最容易踩的地雷）

`buildControlReport` / `buildLineReport` 內的 `reportTime()` 使用 `date.getHours()` —— **依賴 host 時區**。瀏覽器在台灣是 UTC+8，Workers runtime 是 **UTC**。

§8 寫「確認時由伺服器用 `parking-core` 重算快照後再存」，照現行程式碼直接執行，**伺服器產出的快照時間會比實際少 8 小時**。

**這不是推論，已實測驗證**：現有測試在非台灣時區的機器上直接失敗。

```
$ TZ=Asia/Taipei node parking-core.test.js
parking-core tests passed

$ TZ=UTC node parking-core.test.js
AssertionError: Expected values to be strictly equal:
+   '06:35 保全回報停車情況：'
-   '14:35 保全回報停車情況：'
```

也就是說，`parking-core.test.js` 本身目前隱含依賴執行環境時區。Workers runtime 是 UTC，所以這個 bug 會在後端第一天就出現。

**建議**：`parking-core` 的時間格式化改為顯式時區，不依賴 host。最小改動是讓 `reportTime` 接受一個 `timeZone` 參數（預設 `'Asia/Taipei'`），用 `Intl.DateTimeFormat` 格式化；並在 API 明確規範「回報時間以保全送出時的時間戳為準」，而非以中控確認時間為準。

### 4.4 班次跨午夜與「營運日」（必改）

§7.3 `shifts` 只有 `start_time` / `end_time`。夜班（例：20:00–08:00）跨日，單靠 `confirmed_at` 時間戳無法正確歸班，秘書「依日期／班次查詢」（§2.3）會在跨日邊界出錯。

**建議**：`records` 明確存 `business_date`（營運日）與 `shift_id`，由送出端決定、伺服器驗證，不要在查詢時即時推算。

### 4.5 「zones 可設定化」與「塔樓計算寫死索引」互相矛盾（建議 P0 就處理）

§6 說 P0 把常數 seed 進 D1，§13 說 P2 再做設定後台。但 `buildTowerUsage` 寫死 `tokens[0] + tokens[1]`、`TOWER_TOTAL = 1600` 為模組常數。

若只是把 `LABELS` 搬進 D1、其他照舊，那**規格書 §1 自己列的「區域名稱與欄位順序寫死、擴充困難」這個問題並沒有被解決**，只是換了個地方寫死。

**建議（低成本、高報酬）**：P0 就在 `zones` 加 `in_tower INTEGER`，`sites` 加 `tower_total INTEGER`，`buildTowerUsage(tokens, zones, towerTotal)` 改為依 flag 加總。這在 P0 做只多花幾行；等 P2 再做，屆時已有正式紀錄依賴舊語意，改動風險大得多。

### 4.6 `tokens_json` 與 `zones` 的版本漂移（必改，且最難事後補救）

`tokens_json` 若存位置陣列（`["423","256","7",...]`），一旦日後 zones 順序調整或增刪區域，**所有歷史紀錄的語意會整批錯位**，且無法從資料本身察覺。

**建議（三選一，我推薦 A）**：
- **A**：`tokens_json` 改存 `{ "<zone_id>": "<value>" }` 物件。日後 zones 怎麼改都不影響舊紀錄語意。
- B：維持陣列，但 `records` 額外存 `zones_snapshot_json`（當時的區域定義）。資料膨脹但還原能力最強。
- C：`zones` 加版本號，`records` 存 `zones_version`。最省空間但查詢要 JOIN 版本表。

### 4.7 API 重算的輸入來源要講清楚（必改）

§8 說「確認時由伺服器用 `parking-core` 重算快照」，但沒說是從 `tokens_json` 還是 `raw_input` 重算。

這件事有實際差異：`parseText()` 的位置 token 是**依序填入**的，中間跳過任何一格都會讓後面全部位移（現行 `guard.html` 是逐格填才沒事）。

**建議**：API **只接受結構化 tokens**，伺服器一律從 `tokens_json` 重算；`raw_input` 只作稽核留存，永不作為重算來源。

### 4.8 `/api/records/export` 的 CSV 編碼

秘書要用 Excel 開。UTF-8 CSV 不加 BOM，Excel（尤其 Windows 繁中環境）開起來會是亂碼。

**建議**：CSV 輸出開頭加 UTF-8 BOM（`\uFEFF`），`Content-Type: text/csv; charset=utf-8`。

---

## 5. 對「開放決策」（§14）的建議答案

### 5.1 第一版是否單一廠區？

**建議：單一廠區，但 schema 保留 `site_id`。** 表都帶 `site_id` 欄位、預設值 1，API 不暴露廠區參數。這樣 P2 擴充不用改 schema，P0 也不用寫廠區切換 UI。成本幾乎為零。

### 5.2 LINE 僅複製是否夠？

**建議：P0 僅複製，且這個決定要基於一項事實** —— LINE Notify 已於 **2025-03-31 終止服務**（官方公告），所以 P2 只有 Messaging API 一條路，而 Messaging API 推播到**既有工作群組**有兩個前置條件：

1. Bot 必須被邀請進該群組
2. 需要取得該群組的 `groupId`（一般是靠 Bot 加入時的 webhook event 取得）

再加上官方帳號方案的每月免費訊息則數上限。這些前置作業不該塞進 P0。

**另外要注意**：現行 `guard.html` 用 `https://line.me/R/share?text=...` 開分享面板，這在保全端運作良好且零維護。加 Bot 推播後，**不要移除**這條路徑，維持成 fallback。

### 5.3 登入：Access 還是邀請碼？

**建議：分角色用不同機制。**

| 角色 | 機制 | 理由 |
|---|---|---|
| 中控、秘書 | Cloudflare Access | 桌面環境、公司信箱、人數少、要稽核身分 |
| 保全 | 長效裝置 token（cookie / URL token）＋ 班別選擇 | 現場情境不允許 email 驗證碼 |

理由：Cloudflare Access 的 One-time PIN 需要收 email。保全在戶外強光下、單手操作、可能沒有公司信箱，要求他收信輸驗證碼會直接違反 PRODUCT.md 的四條原則。這是**產品層面的否決點，不是技術偏好**。

**成本注意**：Cloudflare Zero Trust 免費方案的席次上限，多個第三方來源一致指出是 **50 seats**；我查到的 Cloudflare 官方 FAQ 頁面未載明此數字，**下單前請以 Cloudflare 官方定價頁確認**。若只有中控與秘書用 Access，人數應遠低於此。

### 5.4 秘書報告是否已有主管固定模板？

**這題我無法從程式碼判斷，需要你提供。** 這是唯一會實質改變 §10 設計的未知數。若主管已有固定 Excel 版面，`/api/records/export` 應該直接產那個版面，而不是先做一個通用 CSV 再叫秘書手動整理 —— 否則等於沒解決 §1 說的「流程斷裂」。

**這一題不解決，P1 的秘書匯出不建議動工。**

### 5.5 `0.1`～`0.9` 台車語法 P0 是否維持相容？

**建議：維持，且理由與「直覺與否」無關。**

README §2 把它列為缺陷，這個批評本身沒錯（確實反直覺），但**它已經不是使用者需要面對的介面**了：`guard.html` 有專門的「台車模式」按鈕，保全按 `台車` 再按數字即可，根本不會手打 `0.4`。

真正還會手打這個語法的是**中控的 `index.html` 文字輸入框**。所以：
- 儲存層與 `parking-core` **維持相容**（既有歷史紀錄與現場肌肉記憶都靠它）
- 若要改善，改的是**中控頁的輸入介面**（例如 `4台` / `c4` 等別名），而不是改儲存語意

把儲存語意和輸入語法分開處理，兩件事就都不痛。

### 5.6 補充決策：新倉庫 vs 現倉庫（規格書未列，但你已決定另開倉庫）

我尊重你的決定，但有義務指出取捨：

| 方案 | 優點 | 缺點 |
|---|---|---|
| **另開新倉庫**（你的計畫） | 乾淨、可自由引入 build/框架、不動現場正在用的線上版 | `parking-core.js` 會分岔成兩份並長期並存；兩邊的 bug 修正要手動同步 |
| 現倉庫加 `worker/` 目錄 | core 只有一份，天然滿足 §5 關鍵約束；現有測試全部繼續有效 | 倉庫混合了「已上線的靜態版」與「開發中的全端版」，Pages 部署設定要小心 |

**若採新倉庫，建議加兩條紀律**：
1. 新倉庫建立時**第一個 commit 就是**「把 `index.html` 的重複邏輯收斂到 core」（§2.1），別把技術債搬過去。
2. 明確設定**舊倉庫的退役條件與日期**（例如「新站上線且現場穩定運行兩週後，舊倉庫 archive、GitHub Pages 改為 302 導轉」）。沒有退役日期，就會變成長期維護兩套。

### 5.7 補充決策：`guard.html` 的測試策略（規格書未列，但擋路）

承 §2.2。三個選項：

| 選項 | 說明 | 適用情境 |
|---|---|---|
| **A. `/guard` 維持單一無 build 的 HTML 檔** | 現有 `guard-ui.test.js` 幾乎可原封不動沿用，只加 API 呼叫 | **我推薦。** 保全頁的需求（強光、單手、首屏）本來就不需要框架，加 build 只增加風險 |
| B. 改寫成 Playwright 行為測試 | 測「按台車再按 4 會顯示尚有 4 台」而非測 CSS 字串 | 測試品質最高，但要新增 CI 與瀏覽器環境，且要重寫 60 行斷言 |
| C. 直接放棄現有 UI 測試 | —— | **不建議。** 這份測試守的正是這個專案最不能退化的部分 |

---

## 6. 建議的里程碑調整

規格書 P0 = Workers + D1 + 認證 + 保全送出 + 中控確認 + 跨裝置歷史 + seed，範圍偏大。建議切成：

**P0a — 消除技術債（在現有倉庫做，不碰後端）**
- `index.html` 改用 `parking-core.js`，刪除重複實作
- `parking-core` 轉 ESM，時間格式化改顯式 `Asia/Taipei`
- 擴充 `parking-core.test.js` 覆蓋時區與 `index.html` 原本獨有的分支
- 驗收：兩頁行為完全不變，`node parking-core.test.js` 與 `node guard-ui.test.js` 全綠

**P0b — 最小可用後端（新倉庫）**
- Workers + D1，`reports` / `records` / `zones` 三張表（含 §4.1–§4.7 的修正）
- `POST /api/reports`、`GET /api/reports?status=pending`、`POST /api/reports/:id/confirm`
- 保全端**非阻塞送出**：本機優先、送出失敗進佇列
- 認證：中控/秘書走 Access；保全走裝置 token
- 不做：shifts、多廠區 UI、秘書匯出、audit_log

**P1 — 稽核與查詢**
- `audit_log`、`reject` 流程、shifts 與 `business_date`
- 中控佇列輪詢
- 秘書查詢（匯出格式**待 §5.4 確認後再做**）

**P2 — 同規格書**（設定後台、LINE Messaging API、多廠區）

---

## 7. 需要你決定的事項（依重要性排序）

1. **主管的會議報告是否有固定模板？** 有的話請提供範例檔。這題不解決，秘書匯出功能無法定義完成標準。
2. **`/guard` 是否維持「無 build 的單一 HTML」？**（§5.7）這決定測試策略與整個新倉庫的工具鏈選型，越早定越好。
3. **保全的認證方式接受「裝置綁定 token」嗎？** 或現場有其他既定的身分規範（例如必須可追溯到個人）？若必須追溯到個人，UX 設計要重做。
4. **`tokens_json` 的儲存格式選 A / B / C？**（§4.6）這是唯一「P0 選錯、日後幾乎無法無痛修正」的決定。
5. **舊倉庫的退役條件與日期？**（§5.6）
6. 保全實際人數約多少？（影響 §5.3 的席次成本評估）

---

## 8. 我不確定 / 未查證的部分

- **Cloudflare Zero Trust 免費方案 50 seats**：第三方來源一致，官方 FAQ 頁未明載，請以官方定價頁為準。
- **LINE Messaging API 官方帳號各方案的每月免費訊息則數**：未查證（僅在 P2 才需要）。
- **現場實際的班次定義、每日回報頻率、保全人數**：程式碼中無此資訊，需由你補充。
- **`TOWER_TOTAL = 1600` 是否只涵蓋「一樓以上 + 一樓以下」兩區**：從程式碼可確認計算方式，但無法確認這個 1600 在現場的定義是否仍然正確。
