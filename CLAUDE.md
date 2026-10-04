# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # next dev on :3000 (without DB_SCHEMA it reads and writes production data)
npm run build        # next build
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint (npm run lint:fix to fix)

# Database
npm run setup-db       # Create/migrate all tables (public schema = production)
npm run setup-test-db  # Same, in the balancetrack_test schema
npm run reset-test-db  # Delete all rows from app tables in the test schema (destructive)
npm run migrate:test   # Apply pending db/migrations to the test schema (setup-test-db and test runs do it too)
npm run ledger:check   # Read-only: stored balances equal the ledger's (ledger:check:test for the test schema)

# Testing
npm test               # Build Next.js, start it on :3200 (test schema), run every Jest project
npm run test:clean     # Set up and reset the test schema, then npm test
npm run test:unit      # TypeScript unit tests only (fast, no server or database)
npm run test:e2e       # Playwright user flows against a production build on :3100 (test schema)

# Some test files only (the API suites still need the server the script starts)
node scripts/run-api-tests.js tests/atomic-writes.test.js
npx jest tests/unit/session.test.ts
```

Run the full suites (Jest and Playwright) once at the end of a change, not repeatedly while working; use typecheck, lint and the unit tests in between.

### Environment setup

Create a `.env` file:
```env
DB_USER=postgres
DB_HOST=localhost
DB_NAME=expense_tracker
DB_PASSWORD=your-password
DB_PORT=5432
SESSION_SECRET=your-secure-secret
# Field encryption, version:base64 32-byte key (docs/security.md); a different key per environment
FIELD_ENCRYPTION_KEYS=1:base64-key
```

The Supabase database in `.env` is production: project `findb-production-mumbai` (Mumbai, ref `iypiauyflbfvbgxotlcr`), data in the `public` schema. The app connects as the login `findb_app` (no superuser; it owns the tables), and Vercel runs in `bom1` (Mumbai). It moved from the Sydney project `findb-production` on 2026-10-03. A read-only login `findb_backup` makes the nightly encrypted backup (`.github/workflows/backup.yml`, see `docs/backups.md`); that is the only GitHub Actions workflow.
Tests use a separate free Supabase project, `findb-test` (Mumbai, project ref `kcxjthhbclcgwdnenqsy`), whose connection settings are in the git-ignored `.env.test`. `scripts/use-test-env.js` loads `.env.test` over `.env` for `npm test`, `npm run test:e2e`, `setup-test-db` and `reset-test-db`, and each run prints which database it uses. It connects as the role `findb_test_app` (no superuser) through the Mumbai pooler, and the tests still use the `balancetrack_test` schema there. Without `.env.test`, tests fall back to the `balancetrack_test` schema of the database in `.env`.
- Vercel builds production only (`ignoreCommand` in `vercel.json` skips every preview build). The Preview environment's variables point at `findb-test` with `REQUIRE_TEST_SCHEMA=true`, for a preview deployed by hand. Keep CI light: no GitHub Actions workflow runs the test suites; run them locally. The only workflow is the nightly backup (about a minute a day).
- `tests/env.js` forces `DB_SCHEMA=balancetrack_test` in Jest; `clearTestData`, `deleteTestUser` and `reset-test-db.js` refuse to delete outside a `*_test` schema.
- Every server a test starts (`scripts/run-api-tests.js`, `playwright.config.js`) gets `DB_SCHEMA=balancetrack_test` and `REQUIRE_TEST_SCHEMA=true`; with that flag `lib/db.ts` refuses any other schema. It also gets `DISABLE_RATE_LIMIT=true` and `BREACHED_PASSWORD_CHECK=false` (no outside calls).
- Never weaken those guards. A server without `DB_SCHEMA` reads and writes production data.
- Never `require()` a database script to "check it loads" (`setup-db.js` runs on load); use `node --check`.
- `testTimeout` is 30 s because of the remote database round trips, and suites run one at a time because they share one database.

## Conventions

- **No emoji anywhere**: not in the UI, docs, README, or console/log messages. Use plain text labels such as `Warning:` instead. `tests/no-emoji.test.js` enforces this.
- When you add or change an API route, update `docs/API.md` to match.

## Architecture

A single Next.js 16 app (App Router, TypeScript strict) on Vercel, with Supabase Postgres. It replaced an Express app and a plain JavaScript frontend in steps N0 to N4 (`docs/nextjs-migration-plan.md`).

### Pages (`app/`, `components/`)
- Two root layouts, so the website and the app never share a stylesheet (moving between them is a full page load):
  - **Website** `app/(site)` (`site.css`: colour direction B "Money green", Poppins headings and Source Sans 3 text, coloured category icons): `/` (home), `/features`, `/features/[slug]`, `/tools` and `/tools/[slug]` (free calculators; their maths is in `src/core/calculators.ts`), `/roadmap`, `/download`, `/faq`, `/about`, `/security`, `/privacy`, `/terms`. Its copy lives in `components/site/content.ts`, and every feature carries an honest status (available, in development, planned); keep it in step with `docs/v2-plan.md` and what is actually shipped.
  - **App** `app/(product)` (`app.css`, the same design as the website): the sign-in screens `/login`, `/register`, `/forgot-username`, `/forgot-password`, `/welcome` in `(public)`, and the logged-in screens `/setup` (Accounts), `/transactions`, `/summary`, `/activity` in `(app)`, inside `components/app/AppShell.tsx` (sidebar on larger screens, top bar and bottom tab bar on phones, logout, a thin loading bar).
- `/` is the website home. Only old `/?section=...` links redirect (in `proxy.ts`): to `/login` without a session cookie, otherwise to the named screen or `/setup`. `/next-health` is a health check.
- `app/global-not-found.tsx` is the 404 page for unmatched addresses (needed with two root layouts). `app/manifest.ts`, `app/icon.svg`, `app/apple-icon.png` and `public/icons/` make the app installable; regenerate the icons with `node scripts/generate-icons.js`. `app/sitemap.ts` and `app/robots.ts` use `SITE_URL` (`lib/site-url.ts`).
- **Two kinds of page, two security policies** (`tests/unit/routing.test.ts` and `security-headers.test.ts` check both):
  - **Website pages are static**: built at deploy time and served from the CDN, so a visit costs no function call (see `docs/costs.md`). Never read `headers()` or `cookies()` in `app/(site)`. A new website page goes in `lib/site-routes.ts`, which gives it the fixed website policy from `next.config.ts` (`buildSiteContentSecurityPolicy`: inline scripts allowed for Next.js's page data, nothing else). The header learns that someone is signed in from the `findb_signed_in` hint cookie set at login (`lib/session.ts`).
  - **App pages** render per request: they read `headers()`, and `proxy.ts` gives each a nonce Content-Security-Policy (`buildContentSecurityPolicy`) and sends visitors without a `sessionId` cookie from the logged-in screens to `/login`. Its matcher lists exactly the app's pages (dynamic segments as `:slug`); a logged-in page also goes in `APP_PATHS`.
  - `experimental.sri` adds an integrity hash to every Next.js script. Never add inline scripts of your own; bundle third-party code from npm instead of loading it from a CDN.
- **Search engines and AI assistants**:
  - every website page uses `pageMetadata` (`components/site/page-metadata.ts`) for its canonical address and preview text;
  - preview images come from `opengraph-image.tsx` files, drawn at build time;
  - structured data comes from `JsonLd` (`components/site/JsonLd.tsx`);
  - `/llms.txt` and `/llms-full.txt` (`lib/llms-text.ts`) and `app/robots.ts` round it out, all built from `components/site/content.ts`.
- **Logged-in screens** fetch their data on the client (`lib/api-client.ts`), handle a 401 with `redirectIfUnauthorized`, and render interactive content only once hydrated (after the data loads, or inside `HydrationGate`): server-rendered buttons do nothing before hydration.
- The screens keep the former app's ids and `data-action` attributes (the end-to-end tests use them); keep them when changing markup. Names are rendered as text, never as HTML.

### API (`app/api`, `lib/`)
- Route handlers are thin: they parse the request and call `lib/services/*.ts` (accounts, transactions, reports, auth). Handlers that need a login use `withUser`, the others `withPublic` (`lib/api-route.ts`): the request limit, the session, and JSON errors (`{ "error": "..." }`, with `RequestError(status, message)` for expected failures). Unknown `/api` paths get a JSON 404 (`app/api/[...path]`).
- **Transactions:** any write touching more than one row or table runs in `withTransaction(pool, async (client) => ...)` from `lib/transaction.ts`, with every query on `client`. Never write `BEGIN`/`COMMIT`/`ROLLBACK` by hand and never `pool.query('BEGIN')`; `tests/atomic-writes.test.js` scans the source for both. Lock rows you check or change with `SELECT ... FOR UPDATE` inside the transaction.
- `logActivity(client, userId, ...)` (`lib/activity-log.ts`) runs on the transaction's client, so the log entry commits or rolls back with the change it describes. Every change writes one entry.
- Entries may only use the user's own accounts (`requireOwnAccount` in `lib/services/transactions.ts`); every query is limited to the session's user.
- **Database-enforced isolation** (`docs/security.md`): a `withUser` request runs in one transaction as the role `findb_user` with `app.user_id` set (`withUserScope`), and row level security policies (`own_rows`) limit every table to that user's rows. `db()` returns that transaction inside the request. Every new table with a `user_id` needs an `own_rows` policy in its migration (`tests/isolation.test.js` checks), and every new table needs an entry in `lib/data-inventory.ts` (`tests/privacy.test.js` checks).
- **Privacy** (`docs/privacy.md`): registration needs `acceptPrivacyNotice: true` and records consent in `consents` with `PRIVACY_NOTICE_VERSION` (`lib/privacy-notice.ts`); change that version when the notice changes in a way that matters, and everyone is asked again. `withPublic` routes run as the owner: keep them to auth flows. Keep explicit `user_id` filters as well.
- Build SQL with `$n` parameters only, never string interpolation.
- `lib/db.ts` is the pool: `DB_SCHEMA` selects the schema, SSL when `DB_SSL=true` or in production, and client-side time limits (10 s to connect, 20 s per query) so a stalled connection fails instead of hanging.
- **Sessions** (`lib/session.ts`) live in the `session` table in the former Express format (signed `sessionId` cookie, `sess` JSON with `userId`), plus `user_id`, `user_agent` and `last_seen_at` for the session list. A finished login always starts a new session; logout deletes it. The cookie is `HttpOnly`, `SameSite=Strict`, 2 hours, and `Secure` over HTTPS. Expired rows are deleted on each login.
- **Two-factor login is required** (`docs/security.md`, `lib/services/security.ts`, `lib/login-flow.ts`): the password (or registration) starts a pending login (`findb_login` cookie, a `session` row without `userId`, so it opens nothing), and a TOTP code or recovery code (or confirming setup) finishes it. TOTP secrets are encrypted with `lib/field-encryption.ts` (AES-256-GCM, `FIELD_ENCRYPTION_KEYS`, a separate key per environment). In tests, users have `TEST_TOTP_SECRET` and `logIn(agent, username, password)` in `test-helpers.js` does both steps; never add a switch that skips two-factor login.
- **Rate limits** (`lib/rate-limit.ts`): 100 requests a minute per IP, and 5 failed auth attempts per 15 minutes per IP. Counted in memory per instance, behind `RateLimitStore`.
- **Security headers** are in `next.config.ts` (`tests/unit/security-headers.test.ts`): the standard set on every response, and a deny-all CSP on API responses (pages get theirs from `proxy.ts`).
- New server code goes in `lib/` with no Next.js imports; financial logic goes in `src/core/`.

### Database (`setup-db.js`, `db/migrations/`)
Tables: `users`, `banks`, `credit_cards`, `income_entries`, `expenses`, `cash_balance`, `activity_log`, `session`, and the ledger: `ledger_accounts`, `journal_entries`, `journal_lines` (`docs/ledger.md`)
- **Ledger (v2 Phase 1):** every change to banks, cards, cash, income and expenses also writes the double-entry ledger through `lib/ledger.ts`, on the same transaction's client, and every balance shown (account lists, the overspend check, the monthly summary) is read from it. The former balance columns are still written until the contract step. Amounts are `bigint` paise; the database refuses an entry whose lines do not add up to zero. Edits and deletes void entries, never remove them. The view `ledger_balance_check` must show no difference after any change (`tests/ledger.test.js`).
- **Migrations:** new schema changes are numbered SQL files in `db/migrations/`, applied by `scripts/migrate.js` (test schema before every test server; production only with `--production`, after a backup). Never edit one that has run; add a new one. Through the Supabase pooler never use a session `SET`; use `SET LOCAL` or a transaction option.
- Every table has row level security enabled with no policies, which blocks Supabase's public Data API. Enable RLS on any new table.
- `DB_SCHEMA` (optional) selects the Postgres schema via `search_path`; unset means `public`.
- All monetary columns use `DECIMAL(20,2)`; amounts go to SQL as given so decimal arithmetic stays exact.
- `activity_log` stores `old_values`/`new_values` as JSONB for change tracking.
- `income_entries` references `credited_to_type` (`bank`|`cash`) and `credited_to_id`; `expenses` references `payment_method` (`cash`|`bank`|`credit_card`) and `payment_source_id`. Dates are stored as given (`YYYY-MM-DD`, see `entryDate`).

### Tests (`tests/`)
Jest projects in `package.json`, each listing its files in `testMatch` (**a new test file does not run until you add it there**):
- **unit**: TypeScript via `@swc/jest` (`tests/unit/`), no server or database.
- **api**: the API suites, over HTTP to the server `npm test` starts (`tests/api-target.js` reads `API_BASE_URL`), and to the test schema through `test-helpers.js`.
- **scripts**: `setup-db.js` (mocked `pg`) and the no-emoji check.

Playwright flows are in `tests/e2e/` (`npm run test:e2e`); they use the screens' ids and `data-action` hooks. `tests/e2e/public-pages.spec.js` covers the website.

`test-helpers.js` provides `clearTestData()`, `createTestUser()`, `deleteTestUser(username)` and `query()` against the test schema. Suites that create users call `deleteTestUser` in `beforeAll`/`afterAll` so reruns don't fail with "username exists". Test passwords must satisfy the password rules (`passwordProblem`: under 16 characters needs upper, lower, digit and symbol; not common; not containing the username). The api Jest project transforms TypeScript, so `test-helpers.js` uses `lib/totp.ts` and `lib/field-encryption.ts` directly.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
