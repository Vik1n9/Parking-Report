# TODO（上線狀態與待辦）

## 已上線（2026-11-09）

- 網址：`https://parking.voriens.dev`（Worker custom domain；`workers.dev`、preview URL 已關閉）
- 線上 D1 `parking-report` 已套用 0003–0005
- Zero Trust：team `voriens.cloudflareaccess.com`；登入方式「Email 驗證碼」（One-time PIN）
- Access 應用「停車回報後台」（單一應用、單一 AUD，已寫入 secret `ACCESS_AUD`），destinations：
  - `parking.voriens.dev/CenterConsole*`
  - `parking.voriens.dev/secretary*`
  - `parking.voriens.dev/api/records*`
  - `parking.voriens.dev/api/reports/*`（確認／退回）
  - `GET /api/reports`（待確認清單）與保全 `POST /api/reports` 同路徑，**不能**加進 Access；Worker 改讀 `CF_Authorization` cookie 驗證中控身分
  - **不要綁裸網域**：會擋到 `/guard` 與保全送出
- 保全裝置已綁 7 台：A1（保全隊長）、10（南側入口）、12（北側入口）、紡外、P1、P3、車巡。token 只存 SHA-256；設定連結只交給使用者一次

## 待辦

- [ ] 允許登入後台的 email：目前只有管理者本人。加人：Zero Trust → Access → Applications → 停車回報後台 → Policies → 後台人員 → Include Emails
- [ ] 把各裝置設定連結傳給對應保全，各點一次 → 保全頁顯示「裝置綁定完成」
- [ ] 試點驗收（計畫段 4 第 3 點）：
  - [ ] 保全手機輸入一半鎖屏再開，數字還在；送出後中控 8 秒內看到
  - [ ] 中控改一區數字確認，LINE 文、Excel、主管頁都用修正值
  - [ ] 顯示牌數字＝車塔1上＋車塔1下剩餘
  - [ ] LINE 分享按鈕在手機能開 LINE 選群組；電腦端至少能複製
  - [ ] 未登入開 `/CenterConsole`、`/secretary`、`/api/records` 被 Access 擋；`/guard`、`/ManagerDashboard`、`/api/public/current` 不被擋（2026-11-09 已用 HTTP 驗過）
- [ ] 紙本備援 SOP、操作卡、試點紀錄表（計畫段 4 第 2 點，`docs/pilot/`）
- [ ] 段 6、段 8 新增 `/api/events*`、`/api/stats*` 時，加進同一個 Access 應用的 destinations

## 之後（已規劃、本次不做）

- 退回流程回饋給保全（P1）：中控按退回後保全端收不到通知，`supersedes_report_id` 欄位已在 schema 但沒有寫入路徑
- 班次／`shifts` 與 `business_date` 歸班（P1）：秘書「依班次查詢」目前做不到
- 稽核 log（P1）
- 秘書匯出假日/平日自動分類（需 `holidays` 表，P1）
- LINE Messaging API 推播（P2）：維持現行 `line.me/R/share` 分享文字為主
- zones 設定後台、多廠區（P2）
