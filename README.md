# FinDB

FinDB (Finance Dashboard) is a personal finance tracker for people in India. You record your money yourself: bank accounts, credit cards, cash, income and expenses. FinDB keeps every balance up to date and shows where your money went each month. It never connects to your bank. Amounts are in rupees with Indian digit grouping (5,00,000.00).

## Features

**Website.** The official FinDB website is part of the same app: the home page, a page for every feature (marked available now, in development or planned), free calculators (EMI, which loan to close first, FD, RD, SIP, gold value, chit fund return, inflation), the roadmap, how to install the app, questions, security, privacy, terms and about.

**App.**
- **Accounts:** bank accounts with a starting balance, credit cards with a limit and the amount used, and cash.
- **Transactions:** income into a bank or cash, and expenses paid by cash, bank or card. Adding, editing or deleting an entry updates the account behind it. Users who also track income cannot overspend an account.
- **Monthly summary:** income, expenses, net savings, total wealth, and each account's balance at the end of the month.
- **Activity log:** every change with its old and new values, filters by month and year, paging, and CSV export.
- **Tracking modes:** income only, expenses only, or both, chosen at sign-up.
- **Installable:** add FinDB to the home screen of a phone, tablet or computer, where it opens like an app.
- **Accounts and security:**
  - username and password login with 2-hour sessions;
  - account recovery by security question that does not reveal whether an account exists, and pauses after repeated wrong answers;
  - bcrypt password hashing and rate-limited login;
  - a Content-Security-Policy and standard security headers on every response;
  - every query limited to the signed-in user, and row level security on every table.

## Tech stack

| Layer | Technology |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript |
| API | Next.js route handlers in `app/api`, with the logic in `lib/services` |
| Database | PostgreSQL (Supabase) through `pg`, plain SQL |
| Hosting | Vercel |
| Tests | Jest and Playwright |

## Project structure

```
app/(site)      The website: home, features, roadmap, get the app, questions, security, privacy, terms, about
app/(product)   The app: sign-in screens and the logged-in screens
app/api         API route handlers
components/     React components (components/site: the website's components and copy)
lib/            Server and shared code: database, sessions, rate limits, services
proxy.ts        Per-request Content-Security-Policy; sends signed-out visitors to /login
next.config.ts  Security headers
public/icons    App icons for installing FinDB (scripts/generate-icons.js draws them)
setup-db.js     Creates and updates the database schema (safe to rerun)
tests/          API tests, unit tests (tests/unit) and end-to-end tests (tests/e2e)
docs/           API reference and project status
```

## Getting started

Requirements: Node.js 20.9 or later, and a PostgreSQL database (for example a Supabase project).

```bash
npm install
```

Create a `.env` file:

```env
DB_HOST=<database host>
DB_PORT=6543
DB_NAME=postgres
DB_USER=<database user>
DB_PASSWORD=<password>
DB_SSL=true
SESSION_SECRET=<64-byte hex string>
# Optional: the Postgres schema to use (default: public)
DB_SCHEMA=findb_dev
```

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Create the tables and start the app:

```bash
npm run setup-db    # creates the tables in DB_SCHEMA (public if unset)
npm run dev         # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run setup-db` | Create or update the tables |
| `npm test` | Build the app, start it against the `balancetrack_test` schema, and run all Jest tests |
| `npm run test:unit` | Unit tests only (no database needed) |
| `npm run migrate:test` / `npm run migrate:status` | Apply or list the SQL migrations in `db/migrations/` |
| `npm run ledger:check` | Read-only check that stored balances equal the ledger's ([docs/ledger.md](docs/ledger.md)) |
| `npm run test:e2e` | End-to-end browser tests (Playwright) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint checks |

Tests always use the `balancetrack_test` schema and refuse to run against any other, so they never touch real data. Put a separate test database's connection settings in `.env.test` (same keys as `.env`, git-ignored) and every test command uses it instead of the database in `.env`. Create the tables once with `npm run setup-test-db`.

## Deployment

FinDB runs on Vercel as a standard Next.js project (`vercel.json` sets the region, `bom1` in Mumbai, next to the database).

1. Import the repository in Vercel.
2. Add the environment variables from `.env` for Production (Settings > Environment Variables). Use a different `SESSION_SECRET` per environment.
3. Run `npm run setup-db` once against the production database, then `node scripts/migrate.js --production` (after a backup, for later migrations).

Only production is built: merging into `master` deploys production. Preview builds for other branches are skipped (`ignoreCommand` in `vercel.json`), which saves build time on the free plan. The Preview environment still points at the test database (`balancetrack_test` schema, with `REQUIRE_TEST_SCHEMA=true`), in case a preview is ever deployed by hand with `vercel deploy`.

## Documentation

- [docs/API.md](docs/API.md): API reference
- [docs/STATUS.md](docs/STATUS.md): current status and known issues
- [docs/v2-plan.md](docs/v2-plan.md): planned features
- [docs/ledger.md](docs/ledger.md): the double-entry ledger, migrations and the balance check
- [docs/backups.md](docs/backups.md): nightly encrypted backups and how to restore them
- [docs/costs.md](docs/costs.md): running costs, free limits, alerts and upkeep

## License

ISC (declared in `package.json`).
