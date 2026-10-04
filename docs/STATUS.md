# FinDB - Project Status

_Last reviewed: 2026-10-02_

## Summary

The app is one Next.js project on Vercel with Supabase Postgres; the move from Express (N0 to N4) is complete. The core features work: auth, accounts, transactions, the activity log and monthly summaries. Test results for the current code are in the latest pull request. The remaining [known issues](#known-issues) are medium or low severity. Next: v2, planned in [v2-plan.md](v2-plan.md) (awaiting approval).

## Features

### Authentication
- [x] Registration with server-side validation (username format, 8–16 char password with upper/lower/digit/special)
- [x] Login/logout with PostgreSQL-backed sessions (2-hour, HTTP-only, `SameSite=strict`)
- [x] Username recovery by email; password reset by security question
- [x] bcrypt hashing for passwords and security answers
- [x] Auth-endpoint rate limiting (5 failed attempts / 15 min; off in development and test)

### Accounts
- [x] Banks: CRUD; deletion blocked while transactions exist
- [x] Credit cards: CRUD with limit and used-limit tracking
- [x] Cash balance with separate initial and running balance
- [x] `DECIMAL(20,2)` for all money columns
- [x] Double-entry ledger written beside the former tables on every change, checked by `ledger_balance_check` ([ledger.md](ledger.md)); the screens still read the former tables

### Transactions
- [x] Income (credited to a bank or cash) and expenses (paid by cash, bank or credit card)
- [x] Create/edit/delete keeps account balances in sync
- [x] Month/year filtering

### Activity log
- [x] Every mutating operation is logged with old/new values (JSONB)
- [x] Filtering by entity type, month/year or date range; pagination; CSV export

### Reporting
- [x] Monthly summary: income, expenses, net savings, current wealth, per-account balances
- [x] Tracking modes: income only, expenses only, or both

### Frontend
- [x] Next.js App Router pages in React; names and messages rendered as text, never HTML
- [x] Per-request nonce Content-Security-Policy, no inline scripts
- [x] Responsive layout with sidebar navigation
- [x] The website (`app/(site)`): home, features with a page each, eight free calculators, roadmap, get the app (install button and QR code), questions, security, privacy, terms and about; light and dark; phone, tablet and desktop
- [x] Sign-in screens restyled to match the website
- [x] Installable from the browser (web app manifest and icons)
- [x] The website is static and served from the CDN.
- [x] Search engines and AI assistants are covered:
  - canonical addresses and link preview images;
  - structured data (organisation, app, FAQ, calculators, breadcrumbs);
  - `llms.txt` and `llms-full.txt`;
  - robots rules that welcome search and AI crawlers to the website only.
- [x] Costs: a database size alert, monthly grouped dependency updates, and `docs/costs.md`.

## Testing

| Project | What | Notes |
|---|---|---|
| unit | `lib/` in isolation (TypeScript) | No server or database |
| api | API suites over HTTP | `npm test` builds and starts Next.js on the test schema |
| scripts | `setup-db.js`, no-emoji rule | Mocked `pg` |
| Playwright | User flows end to end | `npm run test:e2e`, production build |

- `npm run test:clean` resets the test schema and runs every Jest project.
- Tests share the production Supabase database but run in the `balancetrack_test` schema. `tests/env.js` sets `DB_SCHEMA`; test servers get `REQUIRE_TEST_SCHEMA=true`, which refuses any other schema; and `clearTestData`, `deleteTestUser` and `reset-test-db.js` refuse to delete outside a `*_test` schema.
- `testTimeout` is 30 s because each request makes a round trip to the remote database, and suites run one at a time because they share one database.

## Deployment

- **Vercel**: project `findb` (renamed from `balancetrack` on 2026-10-03, framework set to Next.js), a standard Next.js project with functions in `syd1` next to Supabase `ap-southeast-2`. Production addresses: `findb-app.vercel.app` (new) and `balancetrack-one.vercel.app` (kept for now). `findb.vercel.app` belongs to another project. Security headers are in `next.config.ts`; pages get a nonce CSP from `proxy.ts`.
- **Supabase**: one project. Production data is in `public`, and tests use `balancetrack_test`. It is reached through the transaction pooler (port 6543) with SSL, and every table has RLS enabled to block the public Data API.
- Setup steps are in the README under "Deployment".

## Known issues

| Severity | Issue | Where |
|---|---|---|
| Medium | Account recovery still rests on a security question, which a person who knows the user can often answer. Guessing is now limited to 5 tries per 15 minutes per account. The real fix is recovery by an emailed link, which needs an email provider (planned for Phase 5) | `lib/services/auth.ts` |
| Low | Registration still says when a username or email is already taken, so it can be used to check whether an email has an account. Closing it also needs email verification | `POST /api/register` |
| Low | `edge-cases` occasionally fails in the full Jest run: a 401 after its re-login (seen before the transaction fix) or its `beforeAll` exceeding 30s (seen once after it). It passes on its own and in most full runs, and a lock probe during a passing run found no stuck transactions. Likely remote-database latency, not confirmed | `tests/edge-cases.test.js` |
| Low | Transaction dates are sent to the browser as timestamps at the server's midnight, and the add forms default to the UTC date. In a browser far from the server's time zone, or just after midnight IST, a date can show or default to the neighbouring day. To fix with the v2 data model | `lib/services/transactions.ts`, `lib/dates.ts` |
| Low | The monthly summary leaves out banks and cards created on the last day of the month, because its cut-off is the start of that day. Kept as is in the Next.js port; the summary is rebuilt in v2 Phase 1 ([v2-plan.md](v2-plan.md)) | `lib/services/reports.ts` |
| Low | Rate-limit counters are in memory, so on Vercel each function instance counts separately | `lib/rate-limit.ts` (a shared store can replace it behind `RateLimitStore`) |

### Fixed on 2026-10-03

- **Test runs stalling on the shared database.**
  - Tests now run against a separate free Supabase project, `findb-test`, through `.env.test`.
  - The full browser test run went from about 12.5 minutes, with timeouts, to 2.5 minutes.
- **Production moved to Mumbai.**
  - The database is now `findb-production-mumbai`, and Vercel runs in `bom1`, so requests from India no longer go to Sydney.
  - Every row was copied with the same ids, and the counts and totals were checked.
- **No backups on the free plan.** There is now a nightly encrypted backup (see [backups.md](backups.md)).

### Fixed on 2026-10-02
- **N4: Express removed.** The legacy Express app, its frontend and their tests are gone; the app is one Next.js project. With them went the legacy toast that inserted messages as HTML, `tests/setup.js` that never ran, and the obsolete test files behind the ESLint warnings (lint is clean). Expired sessions are now deleted on each login (connect-pg-simple used to prune them).
- Logout cleared a cookie named `connect.sid` instead of `sessionId` (the session row was deleted, so it was already logged out, but the stale cookie stayed). Logout on Next.js clears `sessionId`.
- Income and expense entries accepted any account id the client sent, including another user's bank or card (balances were never touched, but the entry pointed at that account). Adding or editing an entry now refuses an account that is not the user's own (`Bank not found`, `Credit card not found`) and an unknown account type (`Invalid account type`), in both apps (`tests/account-ownership.test.js`).
- **Cross-user disclosure:** the activity feed looked up account names without limiting them to the user's own accounts. A user who edited an income entry onto another user's bank id saw that bank's name in their feed. All lookups are now limited to the user's own accounts, in both apps (`tests/activity-api.test.js`, which fails on the old code).
- The monthly summary's error response included the raw database error (`details`); it now stays in the server log.
- The overspend check compared the stored balance text with the amount, so an amount sent as a string (`"700"`) was compared as text and a valid expense could be refused. Both apps now compare numbers.
- The database pools had no time limits, so a stalled Supabase connection held requests open indefinitely (a test-database reset once hung for 7 hours, and several end-to-end runs stalled). The app's pool now gives up on a connection after 10 s and on a query after 20 s; the test and setup scripts after 10 s and 60 s. `withTransaction` closes a connection whose rollback failed instead of returning it to the pool.
- The activity CSV export did not escape quotes, and a value starting with `=`, `+`, `-` or `@` (for example a bank name) would run as a formula in a spreadsheet. Every field is now quoted with quotes doubled, and formula-like values are prefixed with an apostrophe.
- The activity feed showed only the 20 most recent entries; the API's total ignored the filters; and a non-numeric `limit` caused a 500.
- Adding income or an expense converted the chosen date through the server's local time. On a server east of UTC (any local run in India), an entry added between midnight and 05:30 was stored on the previous day, but under the new month. It then vanished from its month after an edit. Edits had the matching problem on servers west of UTC. Production runs in UTC and was not affected. Dates are now read straight from `YYYY-MM-DD`, and impossible dates such as 2026-02-30 are refused (`tests/entry-dates.test.js`).

### Fixed on 2026-10-01
- Account recovery revealed the username and name for any email and confirmed whether an account existed. Password reset accepted a bare user id, so answers could be guessed account by account without knowing anyone's details. Now:
  - unknown accounts get a stable made-up question;
  - every failure gets the same message;
  - the username comes back only after the security answer;
  - reset needs the username or email;
  - 5 wrong answers in 15 minutes pause recovery for that account;
  - a reset signs out all of that account's sessions and is recorded in its activity log.
- Bank edit/delete and card delete returned early inside an open transaction and released the connection mid-transaction, so later requests on that pooled connection ran inside it. Users were intermittently treated as logged out right after login or registration (the Setup end-to-end tests failed this way whenever they ran after a refused delete). Card delete also ran its DELETE outside the transaction. All three now use `withTransaction`.
- Auth forms and the welcome step could ignore a click made before React hydrated. Their controls now stay disabled until the page is interactive (`components/HydrationGate.tsx`).

### Fixed on 2026-09-30
- Income and expense edit/delete ran `pool.query('BEGIN')`, so their writes were not atomic and the open transaction leaked to other requests. All writes that change balances now run in one transaction via `legacy/lib/transaction.js`, with the activity log entry inside it (`tests/atomic-writes.test.js`).
- The server refuses to start in production without `SESSION_SECRET`.
- Expenses-only users: adding an expense now changes balances like editing and deleting already did (decision: balances always change). They still skip the overspend check, so their balances can go negative.
- SQL injection in `GET /api/activity?type=` (the value was concatenated into the query, which let one user read other users' activity). Now parameterized, with a regression test in `tests/integration.test.js`.
- Footer links used inline `onclick`, which a CSP blocks. They now use `data-action`.
- Edge-case, bank-deletion and cash-balance tests were fixed; the latter two now clean up their test users.
- Auth rate limiter re-enabled (it had been a pass-through in every environment, including production). Only failed attempts count.
- Helmet Content-Security-Policy enabled. `upgrade-insecure-requests` is production-only (it broke Safari on http://localhost).
- The HTTPS redirect was registered after all routes, so it never ran. It is now the first middleware and only redirects when the proxy reports `http`.
- `npm audit fix`: 18 vulnerabilities → 0 (lockfile only, no major upgrades).
- Lucide pinned to 1.49.0 with an SRI hash instead of `@latest`.
- ESLint warnings 73 → 9.
- New `tests/security-middleware.test.js` covers the CSP, redirect and rate limiter.
