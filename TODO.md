# TODO（上線狀態與待辦）

## 已上線（2026-11-09）

- 網址：`https://parking.voriens.dev`（Worker custom domain；`workers.dev`、preview URL 已關閉）
- 線上 D1 `parking-report` 已套用 0003–0006
- 登入：預設角色帳號（`admin`、`console`、`secretary`、`captain`＝A1、`patrol`＝車巡、`manager`），全站需登入，權限表見 `docs/superpowers/plans/2026-11-09-account-login.md`
- 初始密碼只在管理者本機 `~/parking-accounts.txt`（0600）；每個帳號第一次登入必須改密碼
- 審核：車巡上傳 → 隊長 `/review` 複核（可改、保留車巡原值）→ 中控確認；適應期隊長可直接上傳給中控
- Cloudflare Access 應用、Email 驗證碼、`ACCESS_*` secrets 已刪除；舊裝置 token 全部作廢

## 待辦

- [ ] 管理者用 `admin` 登入改密碼，再到 `/admin` 確認六個帳號；初始密碼交給各角色後刪掉 `~/parking-accounts.txt`
- [ ] 保全隊長、車巡手機各登入一次並改密碼，把 `/guard`（隊長另加 `/review`）加到主畫面
- [ ] 試點驗收：
  - [ ] 車巡送出 → 隊長複核頁 8 秒內出現 → 通過 → 中控 8 秒內出現
  - [ ] 隊長直接送出 → 直接到中控
  - [ ] 保全手機輸入一半鎖屏再開，數字還在
  - [ ] 隊長、中控各改一區數字，LINE 文、Excel、主管頁都用最終值；中控列表顯示「隊長修正」「已修正」
  - [ ] 顯示牌數字＝車塔1上＋車塔1下剩餘
  - [ ] LINE 分享按鈕在手機能開 LINE 選群組；電腦端至少能複製
  - [x] 未登入任何頁面導到 `/login`、API 回 401；必須改密碼前不能進後台；外站 Origin 的 POST 被擋（2026-11-09 已用 HTTP 驗過）
- [x] 試點文件內容參考在 `docs/pilot/`（護貝卡、操作卡由使用者另行設計）
- [ ] 段 6、段 8 新增頁面／API 時，加進 `src/index.js` 權限表與 `test/access-matrix.test.js`

## 之後（已規劃、本次不做）

- 退回流程回饋給保全（P1）：中控按退回後保全端收不到通知，`supersedes_report_id` 欄位已在 schema 但沒有寫入路徑
- 班次／`shifts` 與 `business_date` 歸班（P1）：秘書「依班次查詢」目前做不到
- 稽核 log（P1）
- 秘書匯出假日/平日自動分類（需 `holidays` 表，P1）
- LINE Messaging API 推播（P2）：維持現行 `line.me/R/share` 分享文字為主
- zones 設定後台、多廠區（P2）
