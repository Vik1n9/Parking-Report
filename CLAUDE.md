# CLAUDE.md

## Project
Parking report system (full-stack). Guard reports spaces on site → control center confirms → record to D1 → secretary exports manager report → manager reads read-only dashboard. Cloudflare Workers + D1.
Old static version: branch `legacy-static` (serves GitHub Pages site). `main` = full-stack.

## Structure
- `public/js/parking-core.js`: sole source of value semantics and wording (normalize, validate, two report frames, Excel values, tower utilization). No zone knowledge; all functions take caller-supplied `zones`. ESM shared by Worker and browser; never reimplement elsewhere.
- `src/index.js`: Worker entry. Non-`/api/*` → page gate then static assets; `/api/*` → Origin check, session and role matrix. `wrangler.jsonc` uses `run_worker_first: true` so pages cannot bypass the gate.
- `src/auth.js`: single auth core — six roles, PBKDF2-SHA256 passwords, D1 sessions, login rate limits, Origin check, cookie helpers. No Access JWT, no device tokens.
- `src/routes/`: `auth` (login/logout/me/change-password), `users` (admin list/create/reset/status/patch), zones, reports (submit/queue/confirm/reject), records (query), dashboard (manager read-only).
- `src/export/xlsx.js`: ExcelJS manager template (ROC year, side-by-side date tables, alternating remaining-spaces/remarks rows).
- `public/guard.html`: guard page. Layout/interaction MUST NOT change (glare, one-hand, first-screen principles in PRODUCT.md); behavior locked by string assertions in `test/guard-ui.test.js`; sends queued reports with the session cookie.
- `public/CenterConsole.html` control console; `public/ManagerDashboard.html` manager read-only; `public/secretary.html` secretary export.
- `public/login.html`: login and forced password change. `public/review.html`: phone-first captain review. `public/admin.html`: account management.
- `public/js/session.js`: browser session bootstrap (`loadMe`, `logout`, `apiFetch` redirects). `public/js/value-edit.js`: shared per-zone correction parsing for console and captain review.
- `migrations/`: D1 schema. `0002_seed.sql` seeds 10 zones; `0003_value_model.sql` value-model migration (`unit` replaces `is_car`, `tokens_json`→`values_json`, old values auto-converted); `0005_console_review.sql` adds record corrections, tower remaining, display-board number; `0006_accounts_review.sql` adds users/sessions/login_attempts, report review columns, `submitted_by`, and `awaiting_captain`.
- `scripts/account-create.mjs`: create or reset one role account. `scripts/accounts-seed.mjs`: create the six preset accounts, passwords only to a local 0600 file.

## Constraints
1. Explicit timezone always: format via `formatTime`/`businessDate` (default `Asia/Taipei`); never `getHours()`. DB timestamps = UTC ISO. Report time = guard submit time (`client_submitted_at`, kept for offline resend).
2. `values` storage: `{zone_code: {kind, value}}` object (not positional array). Kinds: `spaces`/`tenths`/`carts`/`full`/`guiding`/`none`. Ranges: spaces 0–9999, tenths 1–9, carts 1–99; last three carry no value. Number always = how many can still park. Zone definitions only in D1 `zones` table (`unit` column sets bare-number semantics); no zone constants in `parking-core.js`.
3. Server recomputes all snapshots on confirm from the captain-reviewed values (`reviewed_values_json`) when present, else the uploader original; `reports.values_json` is always the uploader's original, `reviewed_values_json` the captain's result, `records.values_json` the final values; `records.corrections_json` holds console changes relative to that base and `records.captain_corrections_json` the captain's changes separately; `raw_input` audit only. Patrol submissions start at `awaiting_captain`; captain submissions go straight to `pending`.
4. Guard page offline-first: LINE share/copy 100% local; API submit goes to localStorage queue with retry, never blocks.
5. Tests must pass in both `TZ=Asia/Taipei` and `TZ=UTC`. Test data uses pseudonyms for display names and post codes.
6. All pages except `/login` and static assets require a session; access follows the role matrix (guard: captain/patrol/admin; console: console/admin; secretary: secretary/admin; manager dashboard: manager/console/secretary/admin; admin users: admin). Unauthenticated → 302 `/login?next=…`; must-change-password → `/login?change=1`; wrong role → the role's home. `/api/*` returns 401/403 instead of redirecting. Manager dashboard is no longer public and must not return `prepared_by`, `remarks`, `report_id`, or device/post codes.
7. No Cloudflare Access secrets (`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`) and no device tokens; `DEV_MODE=1` only drops the session cookie's `Secure` flag, never bypasses login. Passwords: PBKDF2-SHA256 100,000 iterations, `pbkdf2$100000$<salt>$<hash>`; minimum 8 chars; new and reset accounts must change on first login. Sessions: 256-bit random token in `parking_session` cookie (HttpOnly, SameSite=Lax, Path=/, Secure except local `DEV_MODE=1`), only SHA-256 stored in D1, 30-day fixed expiry. Login: 5 failures per account+IP or 20 per IP → 15-minute lock (IPv6 keyed by /64). Every mutating API request must carry an `Origin` equal to the request origin. Disable or reset password → delete all sessions for that user. Never commit passwords or put them in `wrangler.jsonc`.

## Active plan
`docs/superpowers/plans/2026-11-09-account-login.md`: preset shared role accounts replace Cloudflare Access and device tokens. Segments A (backend auth), B (captain review flow), C (login/admin/review UI) are implemented; segment D (deployment and Access removal) remains. Work in order and stop for user approval at permission checkpoints. Field facts and pilot order remain in `docs/superpowers/plans/2026-11-09-pilot-first-full-stack.md`. Out of scope this round: reject feedback to guard, shifts/holiday classes, audit log, LINE Messaging API push, zones admin UI.

## Deployment
Live since 2026-11-09 at `https://parking.voriens.dev` (custom domain; workers.dev off). Details and open items in `TODO.md`.
- Accounts: `npm run accounts:seed -- --out <local-file>` creates the six preset accounts; `npm run account:create -- <username> <role> [display_name] [--post <code>] [--local]` creates one or resets a password. Generated passwords are shown once; never put them in VCS or chat.
- Cloudflare Access: the 「停車回報後台」 app and One-time PIN are still configured on the live zone; remove them only in segment D after the account rollout is accepted. Code no longer verifies Access JWTs.
- Test data uses pseudonyms for display names and post codes; production post codes are `A1` (captain) and `車巡` (patrol).

## Commands
```bash
npm test                      # dual-TZ run: .github/workflows/ci.yml
npm run dev                   # wrangler dev (loads DEV_MODE=1 from .dev.vars)
npm run db:migrate:local      # local D1 migrations
npm run db:migrate            # live D1 migrations
npm run deploy                # wrangler deploy
npm run account:create -- <username> <role> [display_name] [--post <code>] [--local]
npm run accounts:seed -- --out <file> [--local]   # six preset accounts; 0600 file
```

## Local auth
`.dev.vars` `DEV_MODE=1` (gitignored; template `.dev.vars.example`) only drops the `Secure` flag so `http://localhost` receives the cookie. Log in with an account from the local D1; there is no Access check and no `x-dev-user` header. `npm run preview:local` seeds six accounts with the local-only password `local-dev-pass` (all `must_change_pw=0`) for browser previews. Never enable `DEV_MODE` in deploy config.
