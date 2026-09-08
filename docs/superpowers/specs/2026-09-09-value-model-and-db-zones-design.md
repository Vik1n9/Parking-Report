# 值模型重構、區域 DB 驅動、主管頁公開 — 設計

| | |
|---|---|
| 日期 | 2026-09-09 |
| 基準 | `main` @ `3f11e35` |
| 依據 | 真實手工表（12 個月、1,514 筆回報列）與三則真實 LINE 回報紀錄 |

## 1. 動機

現行資料格式是從純靜態版沿用的字串 DSL，同一個字串有三種語意：`7` 在車區是 7 個車位、在紡A 是 7 成；`0.4` 是 4 台車。區域定義散在三處（D1 seed、`parking-core.js` 的 `LABELS`/`IS_CAR`、`guard.html` 的 `ZONES`），靠位置索引對齊、靠人工同步，改一個區要動全端。

真實資料證實現行模型表達力不足：

| 現象 | 筆數 | 現行模型 |
|---|---|---|
| `引導中` / `車導中` | 44 | 無法表達 |
| 台車三種寫法（`停N台` / `N台車` / `N台`） | 323 | 只產 `N台車` |
| 成數區裸數字（`9` 而非 `9成`） | 499 | 會被當成剩餘車位數 |
| `全滿` vs `滿` | 25 / 1622 | — |

LINE 回報同樣三套並行：保全用程式產的、中控甲手寫一套、中控乙貼程式產的另一套。

## 2. 範圍

**做**：值的資料模型、區域 DB 驅動、輸出格式統一、主管頁公開唯讀，以及被這些牽動的既有缺陷。

**不做**：退回流程回饋給保全、班次／shifts、稽核 log。與本次改動無依賴，留待下一輪。

## 3. 值的資料模型

每個區的值是一個物件。數字一律代表「還能停多少」。

```js
{ kind: 'spaces',  value: 232 }   // 還能停 232 個車位
{ kind: 'tenths',  value: 3 }     // 3 成空
{ kind: 'carts',   value: 2 }     // 停 2 台
{ kind: 'full'    }               // 滿
{ kind: 'guiding' }               // 引導中
{ kind: 'none'    }               // 未停車
```

`kind` 是字串 enum，新增第七種不必改 schema。`zones.unit`（`spaces` | `tenths`）決定裸數字在該區的語意，取代 `is_car`。

### 3.1 正規化

全部收斂在 `parking-core.js` 的 `normalizeInput(raw, zone)` 一處：

| 輸入 | 結果 | 理由 |
|---|---|---|
| `unit=spaces` 的區輸入 `0` | `{kind:'full'}` | 剩 0 個車位就是滿，不留兩種表示法 |
| `unit=tenths` 的區輸入裸數字 `9` | `{kind:'tenths', value:9}` | 現場語意，已確認 |
| `全滿` / `滿` | `{kind:'full'}` | |
| 成數 `10` 以上 | 拒絕 | 12 個月無一筆 `10成`，`滿` 即上限 |

值域：`spaces` 0–9999、`tenths` 1–9、`carts` 1–99。`full` / `guiding` / `none` 不得帶 `value`。

### 3.2 儲存

`reports.tokens_json` 與 `records.tokens_json` 更名 `values_json`，內容 `{zone_code: {kind, value}}`（物件而非位置陣列，區域增刪不影響歷史紀錄語意）。

## 4. 輸出格式

一組值措辭，兩種外框。措辭只有一份定義。

| kind | 值措辭 | Excel 儲存格 |
|---|---|---|
| spaces | `232車位` | `232`（數值） |
| tenths | `3成空` | `3成`（數值 + `0"成"` 格式） |
| carts | `停2台` | `停2台` |
| full | `滿` | `滿` |
| guiding | `引導中` | `引導中` |
| none | `未停車` | `未停車` |

三種台車寫法統一成 `停N台`。

### 4.1 保全分享（`style: 'guard'`）

```
停車場回報
12:37 保全回報停車情況：
車塔1上：滿
車塔1下：232車位
P1：3成空
A區：停2台
C區：引導中
D區：未停車
E區：未停車
柏油路：未停車
```

一區一行，區名與值以 `：` 分隔，不合併。

### 4.2 中控轉貼（`style: 'console'`）

```
中控回報：12:37 A1回報
車塔1上 滿
車塔1下 232車位
P1 3成空
A區 停2台
C區 引導中
D區、E區及柏油路未停車。
```

標題 `中控回報：<HH:MM> <代號>回報`，代號取 `guard_devices.label`（`A1` 是保全的回報代號，等同保全本人）。區名與值以半形空格分隔。

**合併規則**：只有 `kind=none` 的**連續**區段合併成一句，句尾加句號。兩個用「及」；三個以上用「、」串接、最後一個用「及」。單一個 `none` 區不合併，照 `D區 未停車` 一行輸出。

## 5. 區域 DB 驅動

### 5.1 zones 表

`code` / `label` / `excel_label` / `position` / `unit` / `in_tower` / `active`。刪除 `is_car`。

| code | label（畫面與 LINE） | excel_label | unit | in_tower |
|---|---|---|---|---|
| floor_above | 車塔1上 | 1F↑ | spaces | 1 |
| floor_below | 車塔1下 | 1F↓ | spaces | 1 |
| p1 | P1 | P1 | tenths | 0 |
| p3 | P3 | P3 | tenths | 0 |
| spin_a | A區 | 紡織-A | tenths | 0 |
| spin_b | B區 | 紡織-B | tenths | 0 |
| spin_c | C區 | 紡織-C | tenths | 0 |
| spin_d | D區 | 紡織-D | tenths | 0 |
| spin_e | E區 | 紡織-E | tenths | 0 |
| asphalt | 柏油路 | 柏油路 | tenths | 0 |

兩套區名：畫面與 LINE 用 `label`（現場口語），匯出用 `excel_label`（沿用主管既有模板欄位標題）。

### 5.2 parking-core 介面

刪除 `LABELS`、`ALIAS_MAP`、`IS_CAR`、`DEFAULT_TOWER_TOTAL` 四個常數，以及 `parseText`（舊中控文字輸入框已不存在，無使用者）。

```js
normalizeInput(raw, zone)                        // 手工雜訊 → {kind, value}
formatValue(value, zone)                         // → '3成空'
buildReport(values, zones, opts)                 // opts: {style, time, deviceLabel, timeZone}
buildExcelValues(values, zones)                  // → [{cell, numFmt}]
buildTowerUsage(values, zones, {towerTotal})     // guiding/none 視同無數值
formatTime(input, timeZone)                      // 不變
businessDate(input, timeZone)                    // 不變
```

模組不再持有任何區域知識，`zones` 一律由呼叫端傳入。

### 5.3 保全頁離線

三層 fallback：開頁抓 `/api/zones` 寫入 `localStorage` → 離線時用上次快取 → 全新裝置首次離線用打包在頁面內的預設清單。畫面永不空白。新增一區只需改 D1 一列，保全下次連上網自動生效。

保全鍵盤新增「引導中」，放在現有「成數/車位 ｜ 台車模式」那排成為第三顆模式鍵，數字鍵盤 3×4 格線不動 — 對強光/單手版型衝擊最小。

## 6. API

| 端點 | 認證 | 變更 |
|---|---|---|
| `GET /api/zones` | 公開 | 回傳新增 `unit`，`isCar` 移除 |
| `POST /api/reports` | 裝置 token | body 由 `tokens` 改 `values`，依 `unit` 驗證 |
| `GET /api/reports?status=` | Access | 回傳 `values` |
| `POST /api/reports/:id/confirm` | Access | 不變 |
| `POST /api/reports/:id/reject` | Access | 不變 |
| `GET /api/records` | Access | 回傳 `values` |
| `GET /api/records/export` | Access | 不變 |
| `GET /api/public/current` | **公開** | 新增 |

`GET /api/public/current` 只回當日各筆的 `businessDate` / `reportTime` / `values` / `towerPct`。**不含** `preparedBy`、`remarks`、`reportId`、`deviceLabel`。

驗證失敗（未知 `zone_code`、未知 `kind`、值域越界、`full`/`guiding`/`none` 帶了 `value`）一律 400。

## 7. 主管頁公開唯讀

`/ManagerDashboard` 與 `/api/public/current` 不經 Cloudflare Access。頁面加 `<meta name="robots" content="noindex,nofollow">`，Worker 對這兩條路徑額外回 `X-Robots-Tag: noindex`。主管頁改讀公開端點，不再呼叫 `/api/records`。

中控（`/CenterConsole`）與秘書（`/secretary`）的頁面與端點維持 Access 保護。

## 8. 一併修的既有缺陷

只修被本次改動牽動的部分。

1. **CI 部署會洗掉 Access 變數**：`wrangler.jsonc` 的 `vars` 把 `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` 設為空字串，CI 跑裸 `wrangler deploy` 會把線上值蓋回空 → `verifyAccess` fail-closed → 中控與秘書全部 401。改用 `wrangler secret`，`wrangler.jsonc` 移除這兩個 vars。
2. **保全連續兩筆相同數值不進資料庫**：`addHistory` 以 `preview` 字串跨筆比對去重，且 `historyEntries` 跨天存在 `localStorage`。兩班次數字相同時第二筆不進 outbox，中控收不到、報表少一列。改成只擋 3 秒內的重複點擊。
3. **TODO 的 Access 設定範圍會擋死保全**：self-hosted app 綁裸 host 涵蓋所有路徑，`/guard` 與 `POST /api/reports` 會被要求 Access 登入，但保全沒有 Access 身分。改寫成 path-scoped，並移除主管頁那條。

## 9. 遷移

線上 D1 目前無法以現有 wrangler 憑證存取（`code: 7403`），是否有正式資料未確認。migration 一律寫成可安全處理兩種情況：

- `0003_value_model.sql`：`zones` 加 `unit`、更新 `label`、刪除 `is_car`；`reports`/`records` 的 `tokens_json` 更名 `values_json`。
- 舊資料轉換：`x` → `{kind:'none'}`、`0` → `{kind:'full'}`、`0.N` → `{kind:'carts', value:N}`、車區整數 → `{kind:'spaces'}`、其他區整數 → `{kind:'tenths'}`。既有筆數少，轉換以 SQL 或一次性腳本處理皆可。

## 10. 測試

- `parking-core.test.js` 依新模型重寫：六種 kind × 兩種外框 × 兩種 unit，含 §3.1 全部正規化案例與 §4.2 合併規則（0 / 1 / 2 / 3 個連續 `none`、以及不連續的 `none`）。
- 新增後端路由測試：值驗證的每一種 400、確認流程重算、`/api/public/current` 不外洩 `preparedBy`/`remarks`/`deviceLabel`。
- `guard-ui.test.js` 同步更新（區名改 LINE 名、新增引導中鍵），並補進 CI。
- 雙時區（`Asia/Taipei` / `UTC`）維持。
- 測試資料中的填表人一律使用假名，不得寫入真實姓名。
