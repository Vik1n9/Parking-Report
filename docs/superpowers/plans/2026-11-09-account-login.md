# 計畫：預設帳號登入、三段審核（取代 Cloudflare Access 與裝置 token）

| 項目 | 內容 |
|---|---|
| 日期 | 2026-11-09 |
| 分支 | `feat/console-review-and-reports` |
| 參考 | `/Volumes/NAS/Projects/products/web/japan-wall`（`worker/lib/auth.ts`、`worker/routes/auth.ts`、`scripts/admin-create.mjs`、`docs/decisions.md` 帳號段） |
| 狀態 | 段 A、B 完成，接段 C → D 實作 |

## 使用者已定（2026-11-09）

1. 全站只能用預先建立的帳號登入與瀏覽，不開放註冊。主管頁也要登入（原本公開）。
2. **每個角色一個共用帳號**（輪班共用）：後台管理者、中控、秘書、保全隊長、車巡保全、主管。
3. 實際在用的保全代號只有保全隊長（`A1`）與車巡（`車巡`）。其他哨點（10、12、紡外、P1、P3）不設帳號。
4. 審核順序：**車巡上傳 → 保全隊長複核 → 中控最終確認**。適應期保留**保全隊長直接上傳 → 中控確認**。
5. 隊長複核**可改數字，保留車巡原值**（同中控修正）。
6. 帳號管理用網頁 `/admin`（新增、重設密碼、停用／啟用）。
7. 新登入上線後**刪除** Cloudflare Access 應用「停車回報後台」與「Email 驗證碼」登入方式；Zero Trust 組織保留。
8. 試點護貝卡、操作卡由使用者另行設計（`docs/pilot/` 留作內容參考）。

## 角色與預設帳號

| role | 帳號 | 顯示名稱 | post_code（回報標題代號） |
|---|---|---|---|
| `admin` | `admin` | 後台管理者 | — |
| `console` | `console` | 中控 | — |
| `secretary` | `secretary` | 秘書 | — |
| `captain` | `captain` | 保全隊長 | `A1` |
| `patrol` | `patrol` | 車巡保全 | `車巡` |
| `manager` | `manager` | 主管 | — |

中控回報標題沿用 `中控回報：12:37 A1回報`，代號取上傳者帳號的 `post_code`。

## 權限表

頁面（未登入一律 302 到 `/login?next=…`；必須先改密碼時 302 到 `/login` 的改密碼畫面）：

| 頁面 | 角色 |
|---|---|
| `/login`、`/css/*`、`/js/*` | 公開 |
| `/guard` | captain、patrol、admin |
| `/review`（隊長複核，新頁） | captain、admin |
| `/CenterConsole` | console、admin |
| `/secretary` | secretary、admin |
| `/ManagerDashboard` | manager、console、secretary、admin |
| `/admin`（新頁） | admin |
| `/` | 依角色導到首頁（captain/patrol→`/guard`、console→`/CenterConsole`、secretary→`/secretary`、manager→`/ManagerDashboard`、admin→`/admin`） |

API（未登入 401；角色不符 403；`must_change_pw` 時除 me／logout／change-password 外 403）：

| API | 角色 |
|---|---|
| `POST /api/login`、`POST /api/logout` | 公開 |
| `GET /api/me`、`POST /api/change-password` | 已登入 |
| `GET /api/zones` | 已登入 |
| `POST /api/reports` | captain、patrol |
| `GET /api/reports?status=awaiting_captain`、`POST /api/reports/:id/review`、`POST /api/reports/:id/review-reject` | captain、admin |
| `GET /api/reports?status=pending\|confirmed\|rejected`、`POST /api/reports/:id/confirm\|reject` | console、admin |
| `GET /api/records`、`GET /api/records/export` | console、secretary、admin |
| `GET /api/dashboard/current`（原 `/api/public/current`） | manager、console、secretary、admin |
| `/api/admin/users*` | admin |

## 安全（照 japan-wall）

- 密碼 PBKDF2-SHA256 100,000 次（Cloudflare 正式環境上限），格式 `pbkdf2$100000$<salt>$<hash>`；帳號不存在也跑一次雜湊。
- Session：256-bit 隨機 token，cookie `parking_session`（HttpOnly、SameSite=Lax、Path=/、正式環境 Secure），D1 只存 SHA-256；固定 30 天。
- 新帳號、被重設密碼的帳號必須先改密碼（API 層也擋）。密碼最少 8 字。
- 限速：同帳號＋IP 失敗 5 次鎖 15 分鐘；同 IP 累計 20 次鎖 15 分鐘（IPv6 以 /64 計）。
- 所有變更請求（POST/PUT/DELETE）檢查 `Origin` 必須等於請求的 origin，否則 403。
- 停用帳號、重設密碼 → 刪除該帳號全部 session。
- 時間戳一律 UTC ISO（本專案 Constraint 1，不照 japan-wall 的 +08:00）。

## 資料（migration `0006_accounts_review.sql`）

- `users`（username PK、display_name、role CHECK 6 種、post_code、password_hash、status `active|disabled`、must_change_pw、created_at、last_login_at）
- `sessions`（token_hash PK、username、expires_at、created_at）
- `login_attempts`（key PK、fails、locked_until、updated_at）
- `reports`：status 加 `awaiting_captain`（SQLite CHECK 需重建表）；加 `submitted_by`、`reviewed_values_json`、`review_corrections_json`、`reviewed_by`、`reviewed_at`
- `records`：加 `captain_corrections_json`
- `guard_devices`：保留表（舊 reports 外鍵），清空所有列（裝置 token 作廢）

## 審核資料流

- patrol 上傳 → `awaiting_captain`；captain 上傳 → `pending`（適應期直送中控）。
- 隊長複核：通過（可帶修正）→ `pending`，`reviewed_values_json`＝最終值、`review_corrections_json`＝`{zone: 車巡原值}`；退回 → `rejected`＋原因。
- 中控確認的基準值＝`reviewed_values_json ?? values_json`；`records.corrections_json` 只記中控相對基準的修正；`records.captain_corrections_json` 複製隊長修正（量測各段傳遞錯誤）。
- `reports.values_json` 永遠是上傳者原值。

## 分段

| 段 | 內容 | 派工 |
|---|---|---|
| A | 後端帳號：migration 0006、`src/auth.js` 改寫（密碼、session、限速、Origin、角色）、login/logout/me/change-password、`/api/admin/users*`、所有路由改角色檢查、頁面閘門（`run_worker_first`）、移除 Access 與裝置 token、`scripts/account-create.mjs`＋`accounts:seed`、測試 | opencode |
| B | 審核流程後端：`awaiting_captain`、review／review-reject、中控基準值、records 帶隊長修正、測試 | opencode |
| C | 前端：`/login`（含改密碼）、`/admin`、`/review`（手機）、office chrome 依角色導覽＋登出、保全頁改 cookie 送出（版面不變）、中控頁顯示隊長複核、主管頁改 API 路徑、`preview-local` 改種帳號、UI 測試 | opencode |
| D | 部署：線上 migration、建立預設帳號（密碼寫本機私檔）、deploy、驗收後刪 Access 應用與 OTP、刪 secrets、更新 `CLAUDE.md`／`TODO.md` | Claude（需使用者同意者照 §2 規則先問） |
