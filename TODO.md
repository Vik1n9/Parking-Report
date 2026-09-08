# TODO（上線前待辦）

## 1. Cloudflare Access 設定（中控 / 秘書 / 主管登入）

> 狀態：待辦。目前 `/CenterConsole`、`/ManagerDashboard`、`/secretary` 與其 API 在 Access 設定前一律 401（fail-closed）。

- [ ] Zero Trust Dashboard → Access → Applications → Add → Self-hosted
- [ ] Application domain：`parking-report.twstock-gacha.workers.dev`（涵蓋 `/CenterConsole`、`/ManagerDashboard`、`/secretary`；`/guard` 與 `/api/reports` 走裝置 token，不經 Access）
- [ ] Policy：允許中控/秘書/主管的 email（One-time PIN 即可）
- [ ] 取得 Team domain（`<團隊名>.cloudflareaccess.com`）與 Application AUD
- [ ] 部署變數：
  ```bash
  npx wrangler deploy --var ACCESS_TEAM_DOMAIN:<團隊名>.cloudflareaccess.com --var ACCESS_AUD:<app aud>
  ```
- [ ] 驗證：瀏覽器開 `/CenterConsole` 應導向 Access 登入頁；登入後佇列可見

## 2. 保全裝置 token 綁定

> 狀態：待辦。保全頁目前可離線使用，但送出需裝置 token 才會進佇列。

- [ ] 產生 token：
  ```bash
  node scripts/provision-device.mjs 東門哨
  ```
- [ ] 依腳本輸出，把 `INSERT INTO guard_devices ...` 寫入線上資料庫：
  ```bash
  npx wrangler d1 execute parking-report --remote --command "<腳本輸出的 INSERT 指令>"
  ```
- [ ] 把設定連結 `https://parking-report.twstock-gacha.workers.dev/guard#key=<token>` 用 LINE 傳給保全
- [ ] 保全手機點一次連結 → 顯示「裝置綁定完成」→ 送一筆測試回報
- [ ] 中控於 `/CenterConsole` 確認收到該筆，全流程驗收完成

## 之後（已規劃、本次不做）

- LINE Messaging API 推播（P2）：維持現行 `line.me/R/share` 分享文字為主
- 秘書匯出假日/平日自動分類（需 `holidays` 表，P1）
- zones 設定後台、多廠區（P2）
