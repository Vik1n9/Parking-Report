# 室內三頁視覺重做 — 設計

| | |
|---|---|
| 日期 | 2026-09-13 |
| 基準 | `main` @ `e8ea7cc` |
| 範圍 | `/CenterConsole`、`/secretary`、`/ManagerDashboard` 的視覺與資訊架構 |
| 不改 | `/guard`、`parking-core.js` 值語意、API 契約、Excel 格式、認證模型 |

## 1. 動機

室內三頁目前是保全頁的複製品：2px 粗框、字重 900、戶外高對比。保全頁必須維持現場工具；中控、秘書、主管是室內、多半 iPhone Safari。兩種情境共用一套皮，室內頁看起來不像能打開給主管看的東西，也難與保全頁分開維護。

## 2. 兩條規則

**外觀跟 Apple。** 參考 apple.com 的灰底、大字、留白、膠囊按鈕，以及 iOS 26 Human Interface Guidelines 的 Liquid Glass：**玻璃只做浮在內容上的控制層**，不是整頁磨砂。三頁共用一份視覺系統，不開第二套「操作台皮」。

**資訊量和操作邏輯不跟 Apple。** 不搬 iOS 底部分頁列、不做成 Weather/Mail 的導覽，不為了「像 App」改動線。佇列怎麼確認、LINE 怎麼複製、假日怎麼下載、看板 3 秒看什麼——全部用本產品已定的工作，只換成同一套控制件來排。

保全頁是戶外特例，本規格碰不到它。

## 3. 領域前提

- 車塔巡視**只在假日**發生，紀錄也只在假日存在。平日沒有資料是正常狀態，不是錯誤。
- 秘書在**假日後第一個上班日**下載整個休息週期（常見 2 天，長假 3–4 天）。
- 主管以 **iPhone** 打開公開看板。中控、秘書同一視覺，桌機只是加寬。
- 區間裡的平日不會弄髒 Excel：匯出只為有紀錄的營運日畫表。

## 4. 表面與路徑

路徑不改（Access 已 path-scoped）：

```
/guard              保全 · 不動
/CenterConsole      操作台 · 中控（Access）
/secretary          操作台 · 匯出（Access）
/ManagerDashboard   看板 · 公開唯讀
```

中控與匯出是同一個室內應用的兩頁：同一頂欄、兩個目的地（中控 / 匯出）。看板獨立，沒有這組導覽（點了會撞 Access）。

## 5. 檔案

| 檔案 | 動作 |
|---|---|
| `public/css/office.css` | 新。token、玻璃控制層、頂欄、按鈕、sheet、toast、列表 |
| `public/js/office-chrome.js` | 新。操作台頂欄（產品名、中控/匯出、當前頁）。看板不呼叫導覽 |
| `public/js/office-dates.js` | 新。快捷區間「最近 N 天」；顯式台北時區 |
| `public/CenterConsole.html` | 重寫 markup 與動線呈現；仍打現有 reports/records API |
| `public/secretary.html` | 重寫 markup；快捷區間 + 下載為主 |
| `public/ManagerDashboard.html` | 重寫 markup；大數字 + 異常；仍打 `/api/public/current` |
| `test/office-dates.test.js` | 新。雙時區測快捷區間 |
| `test/office-ui.test.js` | 新。結構約束（導覽有無、空狀態文案、確認面板有預覽）。**不鎖 CSS 色碼** |
| `guard.html`、`guard-ui.test.js`、`parking-core.js`、`src/*` | 不改 |

無 build、無框架、無新後端欄位。

## 6. 視覺系統（Apple）

三頁只准這一組。實作細節可以微調數值，不能另開主題。

### 6.1 Token

| 角色 | 值 | 來源 |
|---|---|---|
| 頁面底 | `#f5f5f7` | apple.com |
| 內容字 | `#1d1d1f` | apple.com |
| 次要字 | `#6e6e73` | apple.com |
| 主 tint | `#007AFF` | iOS systemBlue（iPhone Safari 舒適；不用另做官網 `#0071e3` 第二套） |
| 注意 | `#ff3b30` 語意紅 + 文字「注意／滿」 | 不單靠顏色 |
| 偏高 | `#ff9500` 語意橙 + 文字 |
| 正常 | `#34c759` 語意綠 + 文字 |
| 字型 | `-apple-system, BlinkMacSystemFont, "PingFang TC", "Helvetica Neue", sans-serif` | iPhone 本機 SF + 蘋方；**不載網頁字型** |
| 數字 | `font-variant-numeric: tabular-nums` | |

Safari `theme-color` = 頁面底。`viewport-fit=cover`。尊重 `env(safe-area-inset-*)`。

**允許縮放。** 不要 `user-scalable=no`（那是保全頁特例）。

### 6.2 Liquid Glass（控制層 only）

玻璃用 **Regular** 一種變體，不混 Clear（沒有豐富壁紙／媒體底）。

用在：浮動頂欄、主按鈕、確認／退回 sheet、toast。

不用在：佇列列、各區狀態、使用率大數字、中控回報正文、趨勢圖、匯出預覽句。

近似（網頁做不到真實透鏡）：

```css
background: rgba(255, 255, 255, 0.72);
backdrop-filter: blur(24px) saturate(180%);
-webkit-backdrop-filter: blur(24px) saturate(180%);
border: 1px solid rgba(255, 255, 255, 0.55);
box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 8px 24px rgba(0,0,0,0.08);
```

圓角大、連續。靠近螢幕邊緣的控制用膠囊並留邊距。列表內次要鈕用較小圓角矩形，主 CTA（確認並複製、下載 Excel）用膠囊。

頂欄浮在內容上方；內容捲動時可從底下透出（scroll edge），不要一條實心色帶把頁面切成「網站 header」。

### 6.3 系統偏好

| 偏好 | 行為 |
|---|---|
| `prefers-reduced-transparency` | 玻璃改實心白，結構不變 |
| `prefers-contrast: more` | 提高不透明度與框線 |
| `prefers-reduced-motion` | 不做 morph／彈性位移 |

### 6.4 明確禁止

- 整頁卡片上霧面（glassmorphism，不是 Liquid Glass）
- 彩虹、色差、裝飾變形動畫
- 玻璃上排細字、細線圖
- 保全頁的 2px 粗框、字重 900、戶外 token 進這三頁
- 第二套「桌機後台」視覺

## 7. 中控（操作邏輯：本產品）

完成態：**要貼的中控回報文字已在手上。** 確認、預覽、複製同一條動線，不能確認完還到紀錄裡翻。

**頂欄（office-chrome）**  
`停車回報` · 分段 **中控** / **匯出** · 右側營運日。佇列筆數不放進共用殼，屬於內容。

**主畫面：待確認清單**

- 沒單：安靜，「目前沒有待確認回報」
- 有單：時間、哨點代號、各區值格子、確認／退回
- 8 秒輪詢維持；sheet 開著時不重繪、不搶焦點

**確認 sheet（本產品動線，Apple 只提供 sheet 外觀）**

1. 時間 · 哨點 · 單號
2. 中控回報全文預覽（客戶端 `buildReport(values, zones, {style:'console', time, deviceLabel})`）
3. `kind !== none` 的區才出現備註欄（可留空）
4. 取消 ｜ **確認並複製**

成功後 sheet 不關，切完成態：伺服器重算後的正文、已嘗試寫入剪貼簿、**再複製** ｜ 關閉。Toast：「已確認，中控回報已複製」。剪貼簿失敗則提示用「再複製」，不把人趕到日誌。

**退回**  
小 sheet，原因選填。禁止 `prompt()`。退回不產生 LINE 文字。

**今日已確認**  
清單下方日誌，預設不展開全文。每列：時間、車塔%、哨點、複製。稽核用，不是完成態。

## 8. 匯出（操作邏輯：本產品）

使用情境：假日後第一個上班日，一次下載整個休息週期。

**快捷鍵（主操作，不是 iOS 系統控制的語意）**

- **最近 2 天 / 3 天 / 4 天**：迄日 = 昨天（台北營運日），含迄日往前 N 天。預設 3 天。
- **自訂**：才露出起迄日欄。
- 不把「正在過的今天」算進週期。
- 不自動偵測連續假日（沒有 `holidays` 表）。
- 不為區間內 0 筆的平日做警告——平日本來就沒巡視。

例：週一上班 → 最近 2 天 = 六～日。

**下載主管報表 Excel** 是唯一主按鈕，打現有 `/api/records/export?from=&to=`。不必先按「載入預覽」。選快捷鍵後自動拉預覽。

**預覽**  
一句：`9/13–9/15 · 11 筆`。不按日列、不放中控回報全文。0 筆：「此區間沒有紀錄」；下載仍可按，toast 說明沒有可匯出資料。

Excel 格式不動。假日／平日自動分表不在本輪。

`office-dates.js` 必須用 `businessDate` / `Asia/Taipei`，禁止 `getHours()` / `getDate()`。

## 9. 看板（資訊層級：本產品）

打開 3 秒：車塔滿不滿、有沒有該注意的區。平日空白即可。

**第一層**

- 使用率一個大數字。閾值沿用：&lt;70 正常、70–89 偏高、≥90 注意。數字與「注意／偏高／正常」文字並存。
- 底下三個次要量：剩餘 / 已停 / 總格。
- **異常列**：只出現 `full`、`guiding`、明顯空。明顯空 = `none`，或成數區 `tenths >= 8`。車塔 `spaces` 的空已反映在大數字，不重複當異常，除非該區是 `full`。
- 沒有異常時異常列不出現，不要「一切正常」大卡片。

**第二層**（往下捲才需要）

- 十區狀態，正常區不染色強調。
- 今日趨勢圖。

**平日 / 今日無 `entries`**  
同一構圖，大數字位置改成「今日無巡視」。不留過期數字，不回退上一筆假日，不改 API。

**不放**  
填表人、備註、單號、哨點、中控／匯出連結。「ManagerDashboard」不得當標題。本輪標題文案固定「廠區停車 · 唯讀」（不從 API 讀 `sites.name`，避免新欄位）。

30 秒輪詢維持。連線失敗：橫幅 + 最後一次成功資料（若有）。

桌機：同一直欄置中加寬，不改成左右儀表板。

## 10. 錯誤與空狀態

| 情境 | 畫面 |
|---|---|
| 看板今日無紀錄 | 「今日無巡視」 |
| 看板連線失敗 | 橫幅 + 上次成功資料 |
| 中控無待確認 | 「目前沒有待確認回報」 |
| 中控／匯出 401 | 頂欄下橫幅，請重新整理登入 |
| 匯出 0 筆 | 「此區間沒有紀錄」+ toast |
| 確認後剪貼簿失敗 | 完成態 sheet +「再複製」 |

## 11. 測試

雙時區：`TZ=Asia/Taipei` 與 `TZ=UTC`。測試資料用假名。

- `office-dates.test.js`：最近 2/3/4 天；週一 → 最近 2 天為週六～週日（兩種 TZ）。
- `office-ui.test.js`：操作台兩頁有中控／匯出導覽，看板沒有；確認 markup 含預覽容器與「確認並複製」；無 entries 時看板含「今日無巡視」；秘書有最近 2/3/4 天控制。不鎖 hex、不鎖 `backdrop-filter` 字面值。
- 既有 `guard-ui.test.js`、`parking-core.test.js`、路由與 Excel 測試必須仍通過。

## 12. 不做

- 保全頁任何改動
- 新 API、`holidays` 表、班次、退回通知保全、zones 後台
- 中控+秘書合成 SPA、改 URL
- 框架 / bundler
- 把 iOS 底部分頁列、大標題摺疊、Mail 式清單操作套到本產品動線上
