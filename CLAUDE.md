# CLAUDE.md

## Project
Parking report system (full-stack). Guard reports spaces on site → control center confirms → record to D1 → secretary exports manager report → manager reads read-only dashboard. Cloudflare Workers + D1.
Old static version: branch `legacy-static` (serves GitHub Pages site). `main` = full-stack.

## Structure
- `public/js/parking-core.js`: sole source of value semantics and wording (normalize, validate, two report frames, Excel values, tower utilization). No zone knowledge; all functions take caller-supplied `zones`. ESM shared by Worker and browser; never reimplement elsewhere.
- `src/index.js`: Worker entry. Non-`/api/*` → static assets; `/api/*` → routes.
- `src/auth.js`: guard device token (Bearer, SHA-256 in D1) + Cloudflare Access JWT.
- `src/routes/`: zones (public), reports (submit/queue/confirm/reject), records (query), public (manager read-only).
- `src/export/xlsx.js`: ExcelJS manager template (ROC year, side-by-side date tables, alternating remaining-spaces/remarks rows).
- `public/guard.html`: guard page. Layout/interaction MUST NOT change (glare, one-hand, first-screen principles in PRODUCT.md); behavior locked by string assertions in `test/guard-ui.test.js`.
- `public/CenterConsole.html` control console; `public/ManagerDashboard.html` manager read-only; `public/secretary.html` secretary export.
- `migrations/`: D1 schema. `0002_seed.sql` seeds 10 zones; `0003_value_model.sql` value-model migration (`unit` replaces `is_car`, `tokens_json`→`values_json`, old values auto-converted); `0005_console_review.sql` adds record corrections, tower remaining, display-board number.
- `scripts/provision-device.mjs`: generate guard device token.

## Constraints
1. Explicit timezone always: format via `formatTime`/`businessDate` (default `Asia/Taipei`); never `getHours()`. DB timestamps = UTC ISO. Report time = guard submit time (`client_submitted_at`, kept for offline resend).
2. `values` storage: `{zone_code: {kind, value}}` object (not positional array). Kinds: `spaces`/`tenths`/`carts`/`full`/`guiding`/`none`. Ranges: spaces 0–9999, tenths 1–9, carts 1–99; last three carry no value. Number always = how many can still park. Zone definitions only in D1 `zones` table (`unit` column sets bare-number semantics); no zone constants in `parking-core.js`.
3. Server recomputes all snapshots on confirm from guard original values plus console corrections; `reports.values_json` is always the guard's original, `records.values_json` the final values; `raw_input` audit only.
4. Guard page offline-first: LINE share/copy 100% local; API submit goes to localStorage queue with retry, never blocks.
5. Tests must pass in both `TZ=Asia/Taipei` and `TZ=UTC`. Test data uses pseudonyms for filler name and device code.
6. Manager page public: `/ManagerDashboard` and `/api/public/current` unauthenticated; endpoint must not return `prepared_by`, `remarks`, `report_id`, device code.
7. Access config via secrets: `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` with `wrangler secret put`; never in `wrangler.jsonc` vars (deploy wipes them).

## Active plan
`docs/superpowers/plans/2026-11-09-pilot-first-full-stack.md`: pilot-first order (go-live slice → pilot → ops alerts/events → reports). Office pages stay plain HTML + `office.css`, no build step; Astryx deferred (§6 criteria). Read it first; it holds field facts and user decisions. Stop and ask the user at each permission checkpoint (§2).

## Deployment
Live since 2026-11-09 at `https://parking.voriens.dev` (custom domain; workers.dev off). Details and open items in `TODO.md`.
- Access: single app 「停車回報後台」 (team `voriens.cloudflareaccess.com`, One-time PIN), destinations `/CenterConsole*`, `/secretary*`, `/api/records*`, `/api/reports/*`. NEVER bind the bare domain or `/api/reports` itself (guard `POST /api/reports` shares the path; console `GET /api/reports` authenticates via `CF_Authorization` cookie). New Access-only APIs → add to the same app's destinations.
- Guard devices: `npm run device:provision -- <code>`; code appears in control-report title, so use on-site post code. Token shown once, SHA-256 only, never in VCS or chat.
Out of scope this round: reject feedback to guard, shifts/holiday classes, audit log, LINE Messaging API push, zones admin UI.

## Commands
```bash
npm test                      # dual-TZ run: .github/workflows/ci.yml
npm run dev                   # wrangler dev (loads DEV_MODE=1 from .dev.vars)
npm run db:migrate:local      # local D1 migrations
npm run db:migrate            # live D1 migrations
npm run deploy                # wrangler deploy
npm run device:provision -- <name>   # guard token + setup link
```

## Local auth
`.dev.vars` `DEV_MODE=1` (gitignored; template `.dev.vars.example`): Access check disabled; simulate login with header `x-dev-user: <email>`. Never enable DEV_MODE in deploy config.
Prod auth fail-closed: if `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` unset, all Access endpoints return 401.
Access JWT = RS256, verify against `/cdn-cgi/access/certs` `keys`; token from `Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie; `ACCESS_AUD` may be comma-separated.
