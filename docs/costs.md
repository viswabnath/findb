# Running costs and upkeep

FinDB is free for everyone, so it is built to cost nothing to run for as long as possible, and to
need little of anyone's time. Today the running cost is **₹0 a month**.

## What FinDB uses, and the free limits

| Service | Plan | Free limits that matter | Our use today |
|---|---|---|---|
| Vercel (hosting) | Hobby | About 1,000,000 function calls, 4 hours of active CPU, 100 GB of fast data transfer a month. Non-commercial use only: no payments, ads or affiliate links (donations are fine). | Production builds only. Website pages cost no function calls. |
| Supabase `findb-production-mumbai` | Free | 500 MB database, 1 GB file storage, 5 GB data transfer a month. No automatic backups. A project pauses after 7 days without activity. | A few hundred kB |
| Supabase `findb-test` | Free | Same limits. The free plan allows 2 active projects, and these are the two. | Test runs only |
| GitHub | Free, public repository | Actions minutes on standard runners are free for public repositories | One nightly backup job of about a minute |
| Domain | None | `findb-app.vercel.app` | Free |

## How FinDB stays inside them

- **The website is static.** Every website page, the calculators and `llms.txt` are built once at deploy time and served from Vercel's CDN.
  - A visit costs no function call.
  - It also loads faster, which helps search rankings.
  - Only the app's pages and the API run on the server.
- **The proxy runs only where it is needed:** on the app's pages, and on old `/?section=` links.
- **The calculators run in the browser.** A calculation never reaches the server.
- **Only production deploys.** `vercel.json` skips every preview build.
- **No paid services.**
  - Rate limits are counted in memory.
  - Price data, email and analytics are planned on free tiers (see `docs/v2-plan.md`).
- **One small scheduled job.** The nightly backup also measures the database.

## Alerts

| What | Where | Warning | Action needed |
|---|---|---|---|
| Database size | Nightly backup job (`.github/workflows/backup.yml`) | Above 70% of 500 MB: a warning in the run summary | Above 85%: the run fails and GitHub emails the owner |
| Backup failure | The same job | Any failed step: GitHub emails the owner | Check the run log |
| Site or database down | Uptime monitor on `/api/health` (once set up) | Email within minutes | Check Vercel and Supabase status pages and logs |
| Vercel usage | Vercel dashboard > Usage | Vercel emails as Hobby limits approach | See below |
| Dependency security fixes | Dependabot | A pull request and an email | Merge after running the tests |

## Uptime monitor (to set up once)

`/api/health` answers `{ "ok": true }` when the app and the database are up, and `503` when the database is not. Point a free uptime monitor at it, for example UptimeRobot or Better Stack (both have free plans):
- URL: `https://findb-app.vercel.app/api/health`
- Check: every 5 minutes, expecting status 200
- Alerts: by email to the owner

That is about 8,600 function calls a month, under 1% of Vercel's free allowance. It also keeps the production database active every day, which closes the pausing risk below.

## The monthly check (about 10 minutes)

1. **Vercel > Usage:** function calls, active CPU and data transfer for the month.
2. **Supabase > each project > Usage:** database size, storage and data transfer.
3. **GitHub > Actions > Nightly database backup:** the latest run is green, and its summary shows the database size.
4. **Dependabot's pull request:** run `npm run typecheck`, `npm run lint` and `npm test` locally, then merge it.
5. **Paused projects:** if `findb-test` paused after a quiet week, restore it from the Supabase dashboard before the next test run.

## When a limit gets close

The database is likely to run out first. In order of preference:

1. **Make it smaller.**
   - Prune old sessions and old activity log detail, as planned in `docs/v2-plan.md`.
   - Remove accounts inactive for 24 months, after warning their owners.
2. **Supabase Pro**, about $25 (roughly ₹2,100) a month: an 8 GB database, daily backups, no pausing.
3. **Postgres on Oracle Cloud's Always Free servers:** free, but FinDB would then patch, back up and monitor the database itself.

If a Vercel limit is near:

1. **Find what costs the most,** using the usage breakdown by function.
2. **Make it cheaper,** with fewer API calls per screen and more caching.
3. **Move the app,** either to Cloudflare Workers' free plan, which allows commercial use, or to Vercel Pro at about $20 a month.

Any recurring cost is agreed with the owner first. Nothing here is ever turned on silently.

## Keeping upkeep low

- **No servers to patch.** Vercel and Supabase run the infrastructure.
- **Few, grouped pull requests.** Dependabot sends one pull request a month for minor and patch updates, plus security fixes as they appear.
- **Documented restores.** Backups restore with the steps in `docs/backups.md`, and that restore has been tested.
- **Tests run locally** on the separate test database, in about ten minutes, with no CI minutes needed.

## One open risk

A free Supabase project pauses after 7 days without activity. Once real users arrive, production is active every day. Until then, the nightly backup connects to it every night. Once the uptime monitor above is set up, it queries the database every 5 minutes as well. Supabase does not document exactly what counts as activity, but these should keep it active.

If production ever pauses, the app's pages show errors until it is restored from the Supabase dashboard; no data is lost. The website itself keeps working, because it is static.
