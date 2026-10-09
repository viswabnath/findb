# The ledger

v2 Phase 1 moves FinDB's money onto a double-entry ledger ([v2-plan.md](v2-plan.md)). This page explains how it is built, how it runs beside the former tables during the move, and how to check it.

## Shape

Every money event is one **journal entry** made of **lines**. Each line moves an amount into an account (positive, a debit) or out of it (negative, a credit), and the lines of an entry always add up to zero.

| Table | Holds |
|---|---|
| `ledger_accounts` | Banks, cards and cash, and the accounts money comes from or goes to: Income, Uncategorised (expenses), Opening balances, Balance adjustments. Each has a kind (asset, liability, income, expense, equity), a subtype and a currency (INR). |
| `journal_entries` | One row per event: date, description, type (opening_balance, income, expense, adjustment), the former row it records (`source_table`, `source_id`), and `voided_at`. |
| `journal_lines` | The lines: entry, account and `amount_paise`. |

Rules the database enforces:

- **Exact money.** Amounts are whole paise in `bigint` (₹12.50 is `1250`), never floating point. `toPaise` in `lib/ledger.ts` converts rupees on the decimal text, rounding half away from zero exactly as `DECIMAL(20,2)` does.
- **Every entry balances.** A deferred constraint trigger checks at commit that each entry has at least two lines adding up to zero, so a transaction that would leave a lopsided entry fails as a whole.
- **Only your own accounts.** Lines reference `(user_id, account_id)` and `(user_id, entry_id)`, so a line cannot point at another user's account or entry.
- **History is kept.** An edit or delete voids the entry (`voided_at`) rather than removing it; voided entries no longer count towards any balance. A deleted bank or card has its account archived.
- **Row level security** is on, with no policies, like every other table. Deleting a user deletes their ledger.

Views: `ledger_account_balances` (each account's balance from entries that still count) and `ledger_entry_check` (below).

A card is a liability, so money spent on it is a negative balance: a card with ₹1,234.56 used has a ledger balance of `-123456`.

## The move (expand, then contract)

1. **Expand (done).** The ledger is created and filled from today's data (`db/migrations/0002_ledger_backfill.sql`). From then on, every change to banks, cards, cash, income and expenses also writes the ledger in the same transaction (`lib/ledger.ts`, called from `lib/services/accounts.ts` and `transactions.ts`).
2. **Switch reads (done).** Every balance shown comes from the ledger: a bank's `current_balance`, a card's `used_limit` and cash in the account lists, the overspend check on a new expense, and the monthly summary (`lib/services/reports.ts`). The API's response shapes are unchanged. The former balance columns were still written then, and compared with the ledger by `ledger_balance_check`.
3. **Contract (in progress).** Migration 0009: the former balance columns are no longer written, so the ledger can hold movements the former tables cannot (transfers, wallets). `ledger_balance_check` is replaced by `ledger_entry_check`. The columns are dropped in the last step, once nothing deployed uses them.

### The monthly summary

- Income and spending are the entries dated within the month (`flows` in `lib/ledger.ts`).
- Balances are as at the month's last day: every entry dated on or before it (`balances(..., asOf)`).
- Dates matter, so each entry carries the right one. A bank's opening entry is dated the day the bank was added, also after its starting balance is edited. The opening cash is dated the day the user registered (migration 0004), since the summary has always counted starting cash in every month. Setting cash by hand later is an adjustment dated the day it was made.
- One change from before: the summary used to rebuild balances from the starting balance plus income minus spending, so cash set by hand never showed in it. It now does, from the day it was set; so do the adjustment entries from the move to the ledger.

How each change is recorded:

| Change | Ledger |
|---|---|
| Add a bank | An account, and an opening entry: into the bank, from Opening balances |
| Edit a bank's starting balance | The opening entry is voided and a new one recorded |
| Add or edit a card | An account with its limit |
| Delete a bank or card | Its entries are voided and its account archived |
| Set cash | The difference from the ledger's cash balance: from Opening balances the first time, Balance adjustments after that |
| Income | Into the bank or cash, from Income |
| Expense | Into Uncategorised, out of the bank, card or cash |
| Edit or delete income or an expense | Its entry is voided; an edit records a new one |

The backfill adds, for each user, the built-in accounts, an account per bank and card, opening entries for banks and cash, and an entry per income and expense. Wherever a stored balance still differs (cash set by hand, or older bugs), one adjustment entry closes the gap, so the move changes no balance and every difference is on record. It only adds what is missing, so it is safe to run again.

## Checking it

`ledger_entry_check` lists every income and expense row whose ledger record is missing, doubled, or has a different amount or account. It must be empty. (Until migration 0009, `ledger_balance_check` compared the balances stored in the former tables with the ledger's; it agreed in production from the move on 2026-10-04 until the columns were retired.)

```bash
npm run ledger:check:test   # the test database
npm run ledger:check        # production (.env); reads only
```

It prints any mismatch or unbalanced entry and exits with 1 if there is one. `tests/ledger.test.js` makes every kind of change through the API and checks after each that nothing differs, that the API's balances and summary come from the ledger, and that the database refuses an unbalanced entry or another user's account.

Test fixtures that write the former tables directly (`createTestBank`, `createTestCreditCard`, `createTestCashBalance` in `test-helpers.js`) then run the backfill migrations, so the ledger knows about them as it does about moved data.

## Migrations

SQL files in `db/migrations/`, numbered, applied in order by `scripts/migrate.js`, each in its own transaction and recorded in `schema_migrations`.

```bash
npm run migrate:test                        # test schema; also runs before every test server
npm run migrate:status                      # what has run, changes nothing
node scripts/migrate.js --production        # production: take a backup first (docs/backups.md)
```

Never edit a migration that has run anywhere; add a new one.

Production rollout for a migration: run the backup workflow and confirm it succeeded, run `node scripts/migrate.js --production`, run `npm run ledger:check`, then merge (the app code expects the tables to exist).

Through Supabase's transaction pooler, never change session settings with a plain `SET`: the setting stays on a shared server connection and reaches other clients. Use `SET LOCAL` or a transaction option such as `BEGIN TRANSACTION READ ONLY`.
