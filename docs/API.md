# FinDB API Documentation

All endpoints are Next.js route handlers under `/api` (`app/api`), with the logic in `lib/services/`. Request and response bodies are JSON (the activity export is CSV).

## Base URL
```
http://localhost:3000/api
```

## Health

**GET** `/api/health` → `200 { "ok": true }` when the app and its database answer, or `503 { "ok": false }` when the database does not.
- No login needed, and never cached.
- It is meant for an uptime monitor, which also keeps the free database from pausing (see [costs.md](costs.md)).
- It reveals nothing beyond up or down.

## Authentication

Session-cookie based (`sessionId` cookie, HTTP-only, `SameSite=strict`, 2-hour lifetime, `Secure` when the request is HTTPS). Two-factor login is required ([security.md](security.md)): the password starts a **pending login** (`findb_login` cookie, HTTP-only, 10 minutes), which opens nothing until the code from the authenticator app finishes it, or, for an account without two-factor login yet, until setup is confirmed. Finishing a login always starts a new session and also sets `findb_signed_in=1`: a readable cookie with the same lifetime that holds no secret and grants nothing. The static website pages read it to show "Open FinDB" instead of "Log in". Every endpoint except register, login, the two-factor login and setup steps, logout, forgot-username, forgot-password and reset-password requires a valid session; otherwise it returns `401 { "error": "Authentication required" }`.

### Register
**POST** `/api/register`

```json
{
  "username": "letters, numbers, underscores; max 50",
  "password": "8-64 chars; under 16 needs upper + lower + digit + symbol; not common, breached or containing the username",
  "name": "max 100",
  "email": "valid email, max 255",
  "securityQuestion": "string",
  "securityAnswer": "max 200",
  "acceptPrivacyNotice": true
}
```
All fields are required; `acceptPrivacyNotice` must be `true` (the consent is recorded with the notice version, [privacy.md](privacy.md)), otherwise `400 { "error": "Please read and accept the privacy notice to create an account" }`. Response: `{ "success": true, "userId": 1, "twoFactor": "setup" }`, with a pending login at two-factor setup (no session yet). Duplicate username or email returns `400`.

### Login
**POST** `/api/login`

```json
{ "username": "string", "password": "string" }
```
Response: `{ "success": true, "twoFactor": "verify" | "setup" }`, with a pending login (no session yet). `verify`: send the code to `/api/login/two-factor`. `setup`: the account has no two-factor login yet; set it up with `/api/two-factor/setup`. A wrong password returns `400 { "error": "Invalid credentials" }`.

### Login, step two
**POST** `/api/login/two-factor` (needs the pending login at `verify`)

```json
{ "code": "123456" }
```
or `{ "recoveryCode": "abcde-fghij" }`. Response: `{ "success": true, "userId": 1, "name": "string", "trackingOption": "income|expenses|both" }`, with a new session. A wrong or reused code returns `400`; after five wrong codes in 15 minutes, `429` for any code. Without a pending login at this step, `401 { "error": "Your login has expired. Log in again." }`.

### Two-factor setup
Needs the pending login at `setup`.
- **GET** `/api/two-factor/setup` → `{ "secret": "BASE32", "otpauthUri": "otpauth://totp/FinDB:username?..." }`. The same secret until it is confirmed. Not cached.
- **POST** `/api/two-factor/setup` with `{ "code": "123456" }` → `{ "success": true, "recoveryCodes": ["abcde-fghij", ...10] }`, shown only now, with a new session. A wrong code returns `400`.

### Two-factor status and recovery codes
- **GET** `/api/two-factor` → `{ "enabledAt": "timestamp" | null, "recoveryCodesLeft": 10 }`
- **POST** `/api/two-factor/recovery-codes` with `{ "code": "123456" }` → `{ "success": true, "recoveryCodes": [...10] }`, replacing all earlier codes. A wrong code returns `400`; too many, `429`.

### Sessions
- **GET** `/api/sessions` → `[{ "id": "hash", "device": "Chrome on Windows", "createdAt", "lastSeenAt", "current": true }]`, newest use first. `id` is a hash, never the session's real id.
- **DELETE** `/api/sessions/:id` → `{ "success": true }`: signs that device out. Unknown id: `404`.
- **DELETE** `/api/sessions` → `{ "success": true }`: signs out everywhere, this browser included, and clears its cookies.

### Login history
**GET** `/api/login-history` → the last 30 events, newest first: `[{ "event": "signed_in", "device": "Safari on iPhone", "at": "timestamp" }]`. Events: `signed_in`, `wrong_password`, `wrong_code`, `recovery_code_used`, `two_factor_enabled`, `recovery_codes_created`, `signed_out_session`, `signed_out_everywhere`, `password_changed`.

### Logout
**POST** `/api/logout` → `{ "success": true }`. Deletes the session and clears the `sessionId` and `findb_signed_in` cookies.

### Current user
**GET** `/api/user` → `{ "name", "tracking_option", "consentNeeded": false, "noticeVersion": "2026-10-04" }`. `consentNeeded` is true until the user agrees to the current privacy notice (accounts from before it, or after withdrawing); the app then shows the consent screen.

### Privacy
- **GET** `/api/privacy` → `{ "consent": { "noticeVersion", "givenAt", "withdrawnAt", "needed" }, "tables": [{ "table", "category", "holds", "purpose", "retention", "rows" }] }`: what FinDB holds about the user (`lib/data-inventory.ts`), with their record counts.
- **POST** `/api/privacy/consent` with `{ "noticeVersion": "2026-10-04" }` → `{ "success": true }`. Any other version: `400` (the notice changed; reload).
- **POST** `/api/privacy/withdraw` → `{ "success": true }`: consent withdrawn, every session signed out, cookies cleared. Data is not deleted.

### Set tracking option (former)
**POST** `/api/set-tracking-option`

```json
{ "trackingOption": "income | expenses | both" }
```
Response: `{ "success": true }`. Kept for older clients: it also sets the modules the choice means (income: `["income"]`; expenses: `["spending", "credit_cards"]`; both: all three). New screens use `/api/modules`.

### Modules (what the user tracks)
The modules are listed in `lib/modules.ts`: `income`, `spending`, `credit_cards`, `debts`, `investments`, `property`, `savings`, `insurance`, `goals`, `tax`, `household`. Accounts, transactions and net worth are always on. Turning a module off keeps its data. Every change also sets the former `tracking_option` (income only: `income`; spending only: `expenses`; otherwise `both`). A user who never chose has the modules their former choice means. `GET /api/user` includes `modules`.

**GET** `/api/modules`: `{ "modules": ["income", "spending"], "declined": ["debts"] }`

**PUT** `/api/modules` with `{ "modules": [...] }`: unknown keys are refused, and income or spending must be on (`400`). Stored in the listed order; one activity log entry. Returns the same shape as GET.

**GET** `/api/modules/suggestion?title=...`: `{ "suggestion": { "key", "name", "line", "available" } | null }`, the first switched-off module the title's words point to (such as "Home loan EMI" to `debts`), unless the user declined it before.

**POST** `/api/modules/suggestion` with `{ "module": "debts", "accept": true | false }`: accepting turns it on; declining records it so it is not offered again. Returns the same shape as GET `/api/modules`.

### Sample data and the next step
Sample data (`lib/services/sample-data.ts`) is three months of a sample family's money: two banks and a credit card whose names end in "(SAMPLE)", salary and freelance income, everyday spending in categories with tags, a "Goa trip (sample)" event, and card bills paid as transfers. Nothing is dated after today. While it is loaded, the database refuses every real entry (`400`, "You are looking at sample data. Clear it first..."), so sample and real money never mix in a total. `GET /api/user` includes `sampleData: true | false`.

**POST** `/api/sample-data`: loads it, `{ "entries": 44 }`. Only for a fresh start: `400` when it is already loaded or the user has entries of their own. One activity log entry.

**DELETE** `/api/sample-data`: deletes every sample row (entries with their lines and tags, accounts, banks, the card, the event, and any repeating entry or reconciliation set up on a sample account): `{ "cleared": true }`, or `{ "cleared": false }` when there was none. One activity log entry.

**GET** `/api/next-step`: the one clear next step for the Accounts screen, `{ "kind", "text", "label", "href"? }`. In order of priority, `kind` is:
- `sample`: sample data is loaded (no `href`; the screen offers to clear it);
- `start`: no accounts and no entries yet (`/setup#bank-name`; the screen also offers sample data);
- `confirm`: repeating entries wait to be confirmed;
- `categorise`: expenses this month have no category;
- `reimbursement`: money paid over 30 days ago is still to come back;
- `reconcile`: a bank or card with entries, older than 30 days, not checked against a statement in the last 30 days;
- `everyday`: nothing else; add today's spending.

### Account recovery

None of these endpoints reveal whether an account exists:
- An unknown username or email gets a security question too. It is made up, but stable: the same identifier always gets the same question.
- Every failed answer gets the same `400`, whatever the reason: unknown account, wrong answer, or recovery paused. Its text is `Security answer could not be verified. Check it and try again; after 5 failed attempts, recovery is paused for 15 minutes.`

Each wrong answer for a real account is written to its activity log (`action_type` `recovery_failed`, `entity_type` `account`). After 5 in 15 minutes, every answer is refused until the window passes, including the right one.

Format errors are still reported: `Invalid email format`, `Invalid username format...`, `Email is required`, `Username or email is required`. They reveal nothing about accounts.

#### Forgot username
**POST** `/api/forgot-username`

Step 1, `{ "email": "string" }`: returns `{ "success": true, "securityQuestion": "pet" }`.

Step 2, `{ "email": "string", "securityAnswer": "string" }`: returns `{ "success": true, "username": "string" }`, or the generic `400`.

#### Forgot password (step 1)
**POST** `/api/forgot-password`

Send either `{ "username": "string" }` or `{ "email": "string" }`. Returns `{ "success": true, "securityQuestion": "pet" }`.

#### Reset password (step 2)
**POST** `/api/reset-password`

```json
{ "username": "string", "securityAnswer": "string", "newPassword": "string" }
```
Send `email` instead of `username` if you prefer. A bare `userId` is refused (`400 Username or email is required`).

On success:
- the response is `{ "success": true, "message": "Password reset successfully" }`;
- all of the account's sessions are deleted;
- a `password_reset` entry is written to its activity log.

A weak `newPassword` returns the password rule error. A failed answer returns the generic `400`.

## Profile

All optional. PAN and demat or broker account IDs are encrypted before they are stored and only ever returned masked (the first two and last two characters); Aadhaar is at most its last four digits.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/profile` | – | `{ "dateOfBirth", "city", "taxResidency", "panMasked", "aadhaarLast4", "dematAccounts": [{ "broker", "accountMasked" }] }` |
| PUT | `/api/profile` | `{ "dateOfBirth"?, "city"?, "taxResidency"?: "resident \| nri \| rnor", "pan"?, "aadhaarLast4"?, "dematAccounts"?: [{ "broker", "accountId" }] }` | the profile; left out stays, null or empty clears |
| POST | `/api/profile/demat` | `{ "broker", "accountId" }` | the profile, with the account added |
| DELETE | `/api/profile/demat/:index` | – | the profile, with that account removed |
| GET | `/api/profile/dependants` | – | `[{ "id", "relationship", "name", "dateOfBirth" }]` |
| POST | `/api/profile/dependants` | `{ "relationship": "spouse \| child \| parent \| other", "name", "dateOfBirth"? }` | the dependant |
| PUT, DELETE | `/api/profile/dependants/:id` | the same fields | the dependant; `{ "success": true }` |

A PAN must be five letters, four digits and a letter. A full twelve-digit Aadhaar number is refused. Dates of birth cannot be in the future. The activity log records which profile fields changed, never their values.

## Banks

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/banks` | – | array of bank rows |
| POST | `/api/banks` | `{ "name", "initialBalance" }` | created bank row |
| PUT | `/api/banks/:id` | `{ "name", "initialBalance" }` | updated bank row |
| DELETE | `/api/banks/:id` | – | `{ "success": true, "message": "Bank deleted successfully" }` |

Bank row: `id, user_id, name, initial_balance, current_balance, created_at` (`current_balance` is the ledger's). Names are stored upper-case and are unique per user. A bank with transactions cannot be deleted.

## Credit cards

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/credit-cards` | – | array of card rows |
| POST | `/api/credit-cards` | `{ "name", "creditLimit" }` | created card row |
| PUT | `/api/credit-cards/:id` | `{ "name", "creditLimit" }` | updated card row |
| DELETE | `/api/credit-cards/:id` | – | `{ "success": true, "message": "Credit card deleted successfully" }` |

Card row: `id, user_id, name, credit_limit, used_limit, created_at` (`used_limit` is the ledger's).

## Cash balance

**GET** `/api/cash-balance` → `{ id, user_id, balance, initial_balance, updated_at }`, or `{ "balance": 0 }` if never set.

**POST** `/api/cash-balance`

```json
{ "balance": 5000, "initial_balance": 5000 }
```
Creates the row on first call. On update, sending both fields changes the setup values; sending only `balance` adjusts the running balance and keeps `initial_balance`. Returns the cash balance row.

## Money accounts

Every money account, straight from the ledger ([ledger.md](ledger.md)): banks, cash and credit cards (also managed through the routes below), wallets and meal cards (only here).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/accounts` | – | array of accounts, banks first; cash is always included |
| POST | `/api/accounts` | `{ "type": "wallet" \| "meal_card", "name", "institution"?, "notes"?, "openingBalance"? }` | the new account |
| PUT | `/api/accounts/:id` | `{ "name"?, "institution"?, "accountType"?, "interestRate"?, "notes"? }` | the updated account |
| DELETE | `/api/accounts/:id` | – | `{ "success": true }`: archives an empty wallet or meal card |

An account: `{ "id", "type": "bank|cash|credit_card|wallet|meal_card", "name", "balance", "used", "creditLimit", "available", "institution", "accountType", "interestRate", "notes", "sourceId" }`. `balance` is the ledger balance (a card's is minus what is owed); `used`, `creditLimit` and `available` are for cards; `sourceId` is a bank's or card's id in `/api/banks` or `/api/credit-cards`. Only banks take `accountType` (`savings`, `current`, `salary`, `nre`, `nro`) and `interestRate` (percent a year, 0 to 100, up to three decimals); banks and cards are renamed through their own routes. A wallet or meal card name must be unique among them. Removing one with money in it returns `400`.

## Entries

Income, expenses and transfers on any money account, in the ledger. A transfer moves money between the user's own accounts (an ATM withdrawal, a card bill payment) and is neither income nor spending.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/entries` | `?month=1-12&year=YYYY` (required) | array of entries dated in that month, newest first |
| POST | `/api/entries` | see below | the new entry |
| POST | `/api/entries/bulk` | `{ "entries": [ ...as POST, with an optional "row" number ] }` | `{ "created", "entries" }`: at most 200, saved in one transaction in order, or none; a refusal is `"Row <row>: <reason>"` (the grid's own row numbers, else positions from 1) |
| PUT | `/api/entries/:id` | same as POST | the entry as changed, under a new id (the old one is kept, voided) |
| DELETE | `/api/entries/:id` | – | `{ "success": true }` (the entry is voided) |

```json
{
  "type": "income | expense | transfer",
  "date": "YYYY-MM-DD",
  "description": "max 200",
  "amount": "positive, up to 2 decimals",
  "accountId": 1,
  "toAccountId": 2,
  "categoryId": 7,
  "tags": ["goa trip", "work"],
  "eventId": 3
}
```
`categoryId` is for income and expenses and must be a category of the same kind; left out, it is the fallback ("Uncategorised", "Other income"), or on an edit, the entry's own. `tags` is an array or a comma-separated text, at most 10 of up to 30 characters, repeats ignored; left out on an edit, the entry keeps its tags. `eventId` is one of the user's events; `null` for none; left out on an edit, the entry keeps its event.
`accountId` is where income arrives, or where an expense or transfer is paid from; `toAccountId` is a transfer's destination. Income goes onto a credit card only in the Refund or Cashback category (money back on the card). For users who also track income, a new expense or transfer must fit the account's balance (`Insufficient bank balance`, `Insufficient cash balance`, `Insufficient balance in <name>`) or a card's limit (`Insufficient credit limit`); edits are not checked, as with the routes below.

An entry: `{ "id", "type", "date", "description", "amount", "account": { "id", "name", "type" }, "toAccount", "category": { "id", "name" }, "tags", "event": { "id", "name" }, "legacy" }`. `tags` is a sorted array of names. `legacy` marks income and expenses recorded through the routes below; editing or deleting one here also removes its row there.

## Insights

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/insights` | `?month=1-12&year=YYYY` (this month when left out) | see below |

`{ "month": "YYYY-MM", "firstMonth", "thresholds": { "unusualRatio", "unusualMinimum", "historyMonths" }, "spending": { "regular", "oneOff", "events": [{ "id", "name", "amount" }] }, "categories": [{ "id", "name", "thisMonth", "lastMonth", "average3", "average6", "average12", "change3", "unusual" }], "trend": [{ "month", "regular", "oneOff" }], "subscriptions": { "monthly", "yearly", "items": [{ "description", "cadence", "charges", "first", "last", "lastAmount", "monthly", "yearly", "category", "account", "status": "active \| new \| stopped", "priceRiseFrom" }] } }`. Calculations are in `src/core/insights.ts`: averages over complete months before the month (only months since the first entry; 3 months need 2 of them, 6 and 12 their whole span; `null` otherwise); `change3` compares the last 3 months with the 3 before, in percent; `unusual` is at least `unusualRatio` times the 3-month average and `unusualMinimum` above it. Regular spending leaves out one-off events. Subscriptions are expenses of the last 15 months grouped by their description's first words, at a steady weekly, monthly, quarterly or yearly rhythm and within 1.5 times each other's amount; `monthly` and `yearly` total those not stopped.

## People

Money lent to and borrowed from people (`lib/services/people.ts`, `src/core/interest.ts`). Lending, borrowing and repayments move money between a money account and the person's ledger account; only interest is income (Interest) or spending (Loan interest and fees).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/people` | – | `{ "people": [{ "id", "name", "notes", "balance", "loans": [...] }], "owedToYou", "youOwe" }`; `balance` is positive while they owe the user |
| POST | `/api/people` | `{ "name", "notes"? }` | `{ "id", "name" }` |
| PUT | `/api/people/:id` | `{ "name"?, "notes"? }` | `{ "id", "name" }` |
| DELETE | `/api/people/:id` | – | removed once nothing is owed either way |
| POST | `/api/people/:id/loans` | `{ "direction": "lent \| borrowed", "amount", "accountId", "date", "dueOn"?, "interestRate"?, "rateUnit"?: "year \| per100month", "notes"? }` | the loan |
| PUT | `/api/person-loans/:id` | `{ "dueOn"?, "interestRate"?, "rateUnit"?, "notes"? }` | the loan |
| DELETE | `/api/person-loans/:id` | – | every entry of it voided |
| POST | `/api/person-loans/:id/repayments` | `{ "amount", "accountId", "date", "interest"? }` | the loan; interest due on that date is taken first unless `interest` is given |
| DELETE | `/api/person-loans/:id/repayments/:entryId` | – | the loan, with that repayment or settlement voided |
| POST | `/api/person-loans/:id/settle` | `{ "date"? }` | the loan, closed; what is left becomes a gift given (Gifts) or received (Gifts received) |

A loan: `{ "id", "personId", "direction", "principal", "startedOn", "dueOn", "interestRate", "perHundredMonthly", "notes", "outstanding", "principalRepaid", "interestPaid", "interestDue", "status": "open \| overdue \| settled", "closed", "history": [{ "entryId", "date", "type", "amount", "principal", "interest", "account" }] }`. Interest is simple, on what is still owed, day by day (365-day year); rates are stored % a year and also shown as ₹ per ₹100 a month. `GET /api/next-step` returns `{ "kind": "overdue" }` for money past its due date.

## Loans

Loans from banks and lenders (`lib/services/loans.ts`, `src/core/loans.ts`). A loan is a liability account; an EMI's principal reduces it and its interest is spending in Loan interest and fees, as are fees and charges.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/loans` | – | loans (see below), open ones first |
| POST | `/api/loans` | `{ "name", "lender"?, "kind", "rateType": "reducing \| flat \| interest_only \| bullet", "pledge"? (secured kinds), "rateKind": "fixed \| floating", "principal", "interestRate", "rateUnit"?, "months", "disbursedOn", "firstDue"?, "emi"?, "processingFee"?, "otherCharges"?, "foreclosureCharge"?, "notes"?, "accountId" (a new loan; not for `card_emi`) \| "outstanding" (one already running), "cardId" (`card_emi` and `card_loan`: the card's ledger account id) }` | the loan |
| POST | `/api/loans/:id/emi` | `{ "amount", "accountId", "date", "interest"? }` | the loan; interest defaults to a month's on what is owed (a flat loan's from its schedule) |
| POST | `/api/loans/:id/prepay` | `{ "amount", "accountId", "date", "keep": "emi \| tenure", "charges"? }` | the loan, with `interestSaved` |
| POST | `/api/loans/:id/topup` | `{ "amount", "accountId", "date" }` | the loan |
| POST | `/api/loans/:id/rate` | `{ "from", "interestRate", "rateUnit"?, "keep": "tenure \| emi" }` | the loan |
| POST | `/api/loans/:id/close` | `{ "accountId", "date"? }` | the loan, closed for its foreclosure amount |
| PUT | `/api/loans/:id/pledge` | `{ "goldRate"?, "value"?, "ltvLimit"?, "description"? }` | the loan, its pledged asset valued again today |
| DELETE | `/api/loans/:id/payments/:paymentId` | – | the loan, with that payment voided (a closure reopens it) |
| DELETE | `/api/loans/:id` | – | every entry voided, the account archived |

A loan: `{ "id", "name", "lender", "kind", "rateType", "rateKind", "principal", "yearlyRate", "startRate", "perHundredMonthly", "months", "disbursedOn", "firstDue", "emi", "effectiveRate", "outstanding", "principalRepaid", "interestPaid", "feesPaid", "nextDue": { "date", "amount" } \| null, "missed", "monthsLeft", "endsOn", "foreclosure": { "interest", "charge", "total" } \| null, "byYear": [{ "year", "principal", "interest", "fees" }], "schedule": [...], "rateChanges", "payments", "closed", "notes", "cardId" }`. Kinds `card_emi` (a purchase on the card turned into EMIs: the card's balance moves to the loan, so the card must owe at least the amount) and `card_loan` (a loan against the card's limit, paid into `accountId`) are on a card: their fees are charged to it, an EMI's `accountId` defaults to it, and what is still owed blocks its limit (`blocked` in `/api/cards`, and less `available` in `/api/accounts`); an EMI charged to that card needs limit only for its interest. `keep` names what stays the same: `emi` (the loan ends sooner, or later after a top-up) or `tenure` (the EMI changes). `effectiveRate` is the true yearly cost from the schedule and the fees (a flat rate's is far above the rate quoted). `missed` counts EMIs whose date has passed, since the loan was tracked, with no payment. `GET /api/next-step` returns `{ "kind": "emi" }` for a missed EMI, then `{ "kind": "margin" }` for a pledge near or past its lender's limit.

Secured loans (`kind` gold, against_fd, against_policy, against_securities, against_property) take a `pledge`: `{ "description"?, "ltvLimit"? (75), "value" }`, or for gold `{ "weightGrams", "purityKarat": 24 | 22 | 18 | 14, "goldRate" (Rs a gram of 24 karat) }`, its value worked out from them. The loan's `pledge`: `{ "assetKind", "description", "value", "valuedOn", "weightGrams", "purityKarat", "goldRate", "ltvLimit", "ltv", "risk": "ok \| near \| margin", "headroom", "available", "released" }`; `ltv` is what is owed (with interest built up on a bullet loan) as % of the value, `near` within 5 points of the limit; closing the loan releases the pledge. `interest_only` loans pay a month's interest each month and the principal at the end; `bullet` loans pay everything at the end, with simple interest.

## Chit funds

Chits (`lib/services/chits.ts`, `src/core/chit.ts`). Each is a ledger account: payments are savings in it until the user wins; dividends are income (Dividends); winning brings the net prize in and turns what is left to pay into what is owed, the discount and deductions given up being spending (Loan interest and fees).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/chits` | – | chits (see below) |
| POST | `/api/chits` | `{ "name", "organiserKind": "registered \| informal", "organiser"?, "registration"?, "value", "members", "months"? (members), "contribution"? (value / members), "commissionPercent"? (5), "startedOn", "auctionDay"?, "notes"? }` | the chit |
| POST | `/api/chits/:id/instalments` | `{ "month"? (the next unpaid), "accountId", "date", "dividend"? }` | the chit; the dividend defaults to that month's auction's |
| POST | `/api/chits/:id/auctions` | `{ "month", "heldOn", "discount", "wonByUser"?, "deductions"?, "accountId" (when won) }` | the chit |
| DELETE | `/api/chits/:id/instalments/:recordId`, `/api/chits/:id/auctions/:recordId` | – | the chit, that record's entry voided |
| DELETE | `/api/chits/:id` | – | every entry voided, the account archived |

A chit: `{ "id", "name", "organiserKind", "organiser", "registration", "value", "members", "months", "contribution", "commissionPercent", "commission", "startedOn", "auctionDay", "balance" (positive saved, negative owed), "paid", "dividends", "monthsPaid", "next": { "month", "date", "amount", "dividendKnown" } \| null, "missed", "won", "outcome": { "role": "saver \| borrower", "yearlyRate", "gain", "assumedMonth" }, "instalments", "auctions", "finished", "notes" }`. A dividend is the winning discount less the commission (a % of the value), shared by all members; what is due is the contribution less it. `outcome` is the true yearly return or cost from the actual payments and prize (for a chit not yet won, as if won last; months with no auction yet assume no dividend). `GET /api/next-step` returns `{ "kind": "chit" }` for a payment whose date has passed.

## Credit cards

Statements and due dates (`lib/services/cards.ts`, `src/core/cards.ts`). `:id` is the card's ledger account id (as in `/api/accounts`).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/cards` | – | cards (see below) |
| PUT | `/api/cards/:id` | `{ "billingDay"?, "dueDay"? (both or neither, 1 to 31), "interestRate"?, "rateUnit"?: "year \| per100month" }` | the card |
| POST | `/api/cards/:id/statements` | `{ "statementDate", "dueOn"? (from the due day), "amountDue", "minimumDue"? (5%, at least ₹200), "interest"?, "fees"? }` | the card; interest and fees are a `card_charges` entry on it |
| DELETE | `/api/cards/:id/statements/:statementId` | – | the card, the charges entry voided |
| GET | `/api/cards/rewards` | – | each card's rewards (see below) |
| POST | `/api/cards/:id/rewards` | `{ "kind": "earned \| redeemed \| expired \| cashback", "date", "points"? (not cashback), "amount"? (cashback; or money received for redeemed points), "expiresOn"? (earned), "intoAccountId"? (the card by default), "note"? }` | the card's rewards; cashback and money for points are income in Cashback and rewards on `intoAccountId` |
| PUT | `/api/cards/:id/rewards` | `{ "pointValue" }` (₹ a point, empty to clear) | the card's rewards |
| DELETE | `/api/cards/:id/rewards/:rewardId` | – | the card's rewards, its income entry voided |
| GET | `/api/cards/lines` | – | shared limits: `[{ "id", "name", "limit", "owed", "available", "cards": [{ "id", "name", "owed" }] }]` |
| POST | `/api/cards/lines` | `{ "name", "limit", "cardIds" (two or more, each on no other line) }` | the shared limit |
| PUT | `/api/cards/lines/:lineId` | `{ "name"?, "limit"?, "cardIds"? }` | the shared limit |
| DELETE | `/api/cards/lines/:lineId` | – | `{ "success": true }`; its cards keep their own limits |

A card: `{ "id", "sourceId" (the /api/credit-cards id), "name", "owed", "creditLimit", "available", "interestRate" (% a year) \| null, "perHundredMonthly", "trueRate" (compounded monthly), "billingDay", "dueDay", "line": { "id", "name", "limit", "available" } \| null, "statement" \| null, "sinceStatement", "history" }`. `statement` is the latest one: the latest recorded, or the one the billing day gives if later, worked out from what the ledger owed on its date (`id` null). It carries `{ "id", "date", "dueOn", "amountDue", "minimumDue", "interest", "fees", "ledgerAmount", "paid", "paidByDue", "left", "status": "nothing_due \| paid \| minimum_paid \| part_paid \| unpaid", "overdue", "carried", "interestIfCarried", "dueSoon", "daysLeft" }`. Payments are transfers into the card after the statement date; `overdue` is less than the minimum paid by the due date, `carried` what was not paid by it, `interestIfCarried` about a month's interest on that (or on all but the minimum, before the due date), `dueSoon` within 5 days. `GET /api/next-step` returns `{ "kind": "card" }` for an overdue bill, then one due soon. The debt review uses the card's rate once entered. A card on a shared limit (credit line) has as `available`, here and in `/api/accounts`, the smaller of what is left on its own limit and on the line; spending on it is refused beyond either (the line is locked during the check).

A card's rewards: `{ "id", "name", "pointValue", "points": { "balance", "value" (at the value per point, never in net worth) \| null, "expiring": [{ "expiresOn", "points", "daysLeft" }] (within 60 days), "lapsed" }, "cashback": { "thisYear" (the financial year), "byYear" }, "compare": { "spent", "rewards", "rate", "pointsUnvalued" }, "history" }`. Points are used earliest-expiring first; points past their expiry and not used have `lapsed`. Cashback counts both records here and Cashback and rewards income entered on the card. `compare` is the last 12 months: cashback plus points earned at the value per point, as a % of spending on the card. `GET /api/next-step` returns `{ "kind": "points" }` for points expiring within 30 days.

## What's due

Everything due this month and next (`lib/services/calendar.ts`, `src/core/calendar.ts`); it reads cards, loans, chits, repeating entries and people, and stores nothing.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/calendar` | – | `{ "from", "to", "items", "months": [{ "month", "toPay", "toReceive" }], "overdue", "byAccount": [{ "account" \| null, "amount" }] }` (amounts in paise) |

An item: `{ "date", "kind": "card_bill \| emi \| chit \| auction \| repeating \| person", "title", "amount" \| null, "direction": "pay \| receive \| move \| none", "account" \| null, "overdue", "estimated", "href" }`. Card bills are the latest statement still to pay, and the next one estimated from spending since the statement; EMIs are the first unpaid and the schedule after it (a card loan's from its card); chit payments are less the dividend once the month's auction is known (otherwise `estimated`), and auction days show without an amount; repeating entries list each date (a daily one is one line a month); money lent or borrowed shows on its due date. Overdue items come first and count in this month's totals; `byAccount` sums what is to be paid from each account.

## Debt review

Every debt ranked by its true yearly cost (`lib/services/debts.ts`, `src/core/debts.ts`). Information on the user's own figures, not advice.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/debts` | – | `{ "debts", "total", "dangerousTotal", "monthlyPayments", "monthlyIncome" \| null, "emiRatio" \| null, "warnings", "limits" }` |

A debt: `{ "key", "name", "kind": "credit_card \| personal \| consumer \| gold \| vehicle \| home \| education \| business \| secured \| person \| chit \| other", "balance", "yearlyRate", "monthly", "assumedRate", "dangerous", "href" }`, most expensive first. Debts are open loans (the true yearly cost with fees, the EMI), card balances owed (a typical 3.5% a month, about 51% a year, marked `assumedRate` until card statements record the card's own; the monthly amount is the minimum due, 5% or at least ₹200), money borrowed from people (their rate, no fixed payment) and chits already won (the cost by IRR, the contribution). `dangerous` is 24% a year or more. `monthlyPayments` is the EMIs and chit contributions; `monthlyIncome` is the average of the last three full months; `emiRatio` is one as a % of the other. A warning: `{ "kind": "emi_ratio \| missed \| minimum_only \| margin \| overdue \| informal_chit", "level": "warn \| danger", "text", "href" }`: EMIs over 40% of income (danger over 50%), EMIs due and not recorded, what paying only a card's minimum costs, a pledge near or past the lender's limit, money from a person overdue, and an informal chit. The payoff simulator on the screen runs `simulatePayoff` from `src/core/debts.ts` on these figures.

## Groups

Shared expenses in trips and flats (`lib/services/groups.ts`, `src/core/split.ts`). Members are named `you` and `p<person id>`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/groups` | – | groups: `{ "id", "name", "event", "members": [{ "key", "personId", "name", "balance" }], "yourBalance", "plan": [{ "from", "fromName", "to", "toName", "amount" }], "yourCost", "groupCost", "byCategory", "expenses", "settlements" }` |
| POST | `/api/groups` | `{ "name", "memberIds": [person ids], "eventId"? }` | the group |
| PUT | `/api/groups/:id` | `{ "name"?, "memberIds"?, "eventId"? }` | the group; a member with costs or payments stays |
| DELETE | `/api/groups/:id` | – | removed once everyone is settled |
| POST | `/api/groups/:id/expenses` | `{ "date", "description", "amount", "paidBy", "accountId"?, "categoryId"?, "split": "equal \| exact \| percent \| shares", "parts": [{ "member", "value"? }], "treat"? }` | the group |
| DELETE | `/api/groups/:id/expenses/:expenseId` | – | the group; the user's entry voided |
| POST | `/api/groups/:id/settlements` | `{ "from", "to", "amount", "date", "accountId"? }` | the group |
| DELETE | `/api/groups/:id/settlements/:settlementId` | – | the group |

A balance is positive when the group owes that member. `exact` values are rupees, `percent` numbers adding to 100, `shares` whole numbers; `treat` makes the cost the payer's alone. In the user's books: when they pay, the whole amount leaves `accountId`, their share is spending (in `categoryId`), and each friend's share is owed to them on the friend's person account; when a friend pays, the user's share is spending owed to that friend; a cost they neither paid nor share has no entry. A settlement involving the user moves money through `accountId`; one between two friends changes only the group. In `/api/entries` the user's share shows as an expense with `"shared": true`, changed only in the group.

## Documents

The document vault (`lib/services/documents.ts`). Files are encrypted and kept in private storage (`lib/document-store.ts`).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/documents` | `?entryId=\|accountId=\|eventId=` (optional) | `{ "documents": [...], "used", "limit" }`: by the document's date (else its upload date), newest first; bytes used of the 20 MB allowance |
| POST | `/api/documents` | `multipart/form-data`: `file`, `kind`, `title`, `date`, `expiresOn`, `notes`, `links` (JSON `[{ "type": "entry \| account \| event", "id" }]`) | the document |
| PUT | `/api/documents/:id` | `{ "kind"?, "title"?, "date"?, "expiresOn"?, "notes"?, "links"? }` | the document |
| DELETE | `/api/documents/:id` | – | `{ "success": true }`: the document, its links and its file are deleted |
| GET | `/api/documents/:id/file` | `?download=1` (optional) | the file, decrypted; pictures `inline`, PDFs (and `download=1`) as `attachment` |

A document: `{ "id", "kind", "title", "date", "financialYear", "expiresOn", "notes", "fileName", "mimeType", "size", "createdAt", "links": [{ "type", "id", "name" }] }`. `kind` is receipt, statement, invoice, policy, loan, property, warranty, certificate, tax or other; `title` defaults to the file's name; `financialYear` is India's (April to March, `2026-27`) from `date`. Files are PDF, JPEG, PNG or WebP by their first bytes, up to 2 MB, 20 MB per user. Storage unreachable is `503`. An edited entry's links move to its new id. `GET /api/next-step` returns `{ "kind": "expiring" }` for a document expiring within 30 days (or in the last week).

## Budgets

A monthly limit per spending category (`lib/services/budgets.ts`); what is spent against it is the category's expense lines dated in the month, events included.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/budgets` | `?month=1-12&year=YYYY` (this month when left out) | budgets, fullest first: `{ "id", "category": { "id", "name" }, "amount", "spent", "left", "percent", "state": "ok \| near \| over" }` |
| PUT | `/api/budgets` | `{ "categoryId", "amount" }` | the budget, this month; setting a category again changes its limit |
| DELETE | `/api/budgets/:id` | – | `{ "success": true }` |
| GET | `/api/budgets/status` | `?categoryId=&date=YYYY-MM-DD` | `{ "budget": {...} \| null }` for the date's month: the warning after an entry is saved |

`state` is `near` from 80% and `over` from 100%. `GET /api/next-step` returns `{ "kind": "budget" }` for the fullest budget at 80% or more this month, after repeating entries to confirm.

## Search

Entries across every month (`lib/services/search.ts`).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/search` | `?q=&from=&to=&min=&max=&type=&accountId=&categoryId=&tag=&eventId=&offset=` | `{ "filters", "entries", "total", "totals": { "income", "expense", "transfer" }, "offset", "more", "accounts", "categories", "events" }` |
| GET | `/api/searches` | – | saved searches by name: `{ "id", "name", "filters" }` |
| POST | `/api/searches` | `{ "name", "filters" }` | the saved search; the same name (ignoring case) replaces it; at most 20 |
| DELETE | `/api/searches/:id` | – | `{ "success": true }` |

`q` is up to 100 characters; each word (up to 8) must appear in the entry's description, its accounts' or category's names, its tags or its event, or, when it reads as an amount (`450`, `22,000`, `₹99`), equal the entry's amount. `%` and `_` are taken literally. `from` and `to` are dates (inclusive), `min` and `max` rupees, `type` income, expense or transfer, `tag` matched ignoring case. Entries come newest first, 50 at a time (`offset`, `more`); `total` and `totals` cover every match. On the first page, `accounts`, `categories` and `events` are those whose names hold every word.

## Categories

Income and spending categories are income and expense accounts in the ledger. Each user has the defaults (`lib/categories.ts`: 18 spending, 10 income), made the first time they are needed, plus the built-in fallbacks "Uncategorised" and "Other income".

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/categories` | – | array of categories: spending first, in the default order, then the user's own, the fallback last |
| POST | `/api/categories` | `{ "kind": "income" \| "expense", "name", "essential"? }` | the new category |
| PUT | `/api/categories/:id` | `{ "name"?, "essential"? }` | the updated category |
| DELETE | `/api/categories/:id` | – | `{ "success": true }`: removed from the lists; entries keep it |
| GET | `/api/categories/frequent` | `?kind=income\|expense&limit=1-12` (6) | the most used categories of that kind in the last 90 days, then the defaults in order; no fallback (quick add's one-tap choices) |
| GET | `/api/categories/suggest` | `?kind=income\|expense&description=...` | `{ "category": {...} \| null, "reason": "history" \| "keyword" \| null }` |

A category: `{ "id", "kind", "name", "key", "essential", "fallback" }`. `key` is the default it started as (`groceries`), null for the user's own; `essential` is for spending (null for income and the fallback). Names are unique per kind, up to 60 characters. The fallbacks cannot be renamed, marked or removed. A suggestion is the category the user chose last time for the same title, then for a title starting with the same word, then a default by keyword ("Swiggy" means restaurants).

**POST** `/api/entries/categorise` with `{ "entryIds": [...], "categoryId" }` puts up to 200 entries of the category's kind in it at once (each gets a new id, as with an edit) and returns `{ "changed": n }`.

## Events

An event or project is a purpose any income, expense or transfer can carry (`eventId` on `/api/entries`).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/events` | – | events that are not removed, with totals, latest first |
| POST | `/api/events` | `{ "name", "startsOn"?, "endsOn"?, "budget"?, "oneOff"? (default true), "notes"? }` | the new event |
| GET | `/api/events/:id` | – | the event with `spentByCategory`, `receivedByCategory`, `paidFrom` and its `timeline` (entries, newest first) |
| PUT | `/api/events/:id` | any of the POST fields; the rest stay | the updated event |
| DELETE | `/api/events/:id` | – | `{ "success": true }`: removed from the lists; its entries keep it |

An event: `{ "id", "name", "startsOn", "endsOn", "budget", "oneOff", "notes", "spent", "received", "netCost", "budgetLeft", "entries", "firstDate", "lastDate" }`. `netCost` is spent less received; `budgetLeft` is negative when over budget, null without a budget. Names are unique among events that are not removed, up to 80 characters; the end date cannot be before the start. A removed event cannot be chosen for a new entry, but an edit that leaves `eventId` out keeps it.

## Repeating entries

Salary, rent, EMIs, SIPs, subscriptions: an income, expense or transfer that repeats. Each is recorded automatically (`mode: "auto"`) or waits to be confirmed (`"confirm"`, the default).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/recurring` | – | every repeating entry, the next due first |
| POST | `/api/recurring` | see below | the new repeating entry |
| PUT | `/api/recurring/:id` | any field below, and `{ "paused": true \| false }`; the rest stay | the updated repeating entry |
| DELETE | `/api/recurring/:id` | – | `{ "success": true }`; the entries it made stay |
| POST | `/api/recurring/run` | – | `{ "posted", "problems": [...], "pending": [...], "upcoming": [...] }` |
| POST | `/api/recurring/:id/confirm` | `{ "date"?, "amount"? }` | `{ "entry", "repeating" }`: records the next due date |
| POST | `/api/recurring/:id/skip` | `{ "date"? }` | the repeating entry, moved to its next date |

```json
{
  "type": "income | expense | transfer",
  "description": "max 200",
  "amount": "positive",
  "accountId": 1,
  "toAccountId": 2,
  "categoryId": 7,
  "eventId": 3,
  "tags": ["work"],
  "frequency": "daily | weekly | monthly | yearly",
  "dayOfWeek": 1,
  "dayOfMonth": 31,
  "month": 4,
  "startsOn": "YYYY-MM-DD",
  "endsOn": "YYYY-MM-DD",
  "mode": "auto | confirm",
  "remindDays": 3
}
```
Weekly needs `dayOfWeek` (0 Sunday to 6 Saturday); monthly `dayOfMonth` (1 to 31; a shorter month uses its last day); yearly `month` and `dayOfMonth` (29 February is the 28th in other years). The same rules as an entry apply to the accounts, category, event and tags. `nextDue` is the next date it falls due, null once ended.

`run` (the app calls it when it opens) records every automatic one that has fallen due, catching up on missed dates (up to 62 at a time), each date at most once even when several pages call it together. One that cannot be recorded (its account removed, say) is listed in `problems` and left as it is. `pending` lists the confirm-mode dates now due; `upcoming` what falls due within each one's `remindDays`. A confirmed entry gets the spending check like any new entry; automatic ones do not. Dates are counted in India's time zone.

## Reimbursements

An expense paid now that someone will pay back (an employer, an insurer). While pending it is money owed to the user, not spending.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/reimbursements` | – | every reimbursement, the open ones first |
| POST | `/api/reimbursements` | `{ "description", "amount", "accountId", "date", "fromWhom"?, "categoryId"?, "eventId"? }` | the new reimbursement |
| POST | `/api/reimbursements/:id/repay` | `{ "amount", "accountId", "date", "close"? }` | the reimbursement after the repayment |
| DELETE | `/api/reimbursements/:id` | – | `{ "success": true }`: only while nothing has been repaid; the payment is undone |

A reimbursement: `{ "id", "description", "fromWhom", "amount", "received", "outstanding", "keptAsSpending", "category", "event", "paidFrom", "paidOn", "status": "pending | partly repaid | repaid | closed", "repayments": [{ "date", "amount", "account" }] }`. The payment gets the spending check. A repayment cannot be more than what is still owed; repaying it all closes it, and `close: true` closes it early: what was not repaid becomes an expense in its category (Uncategorised without one), dated that day. The summary's `owedToYou` is what is still to come back.

## Reconciliation

Checking an account against a statement. Amounts follow the statement: money in the account, or for a credit card, the amount owed.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/reconciliations` | `?accountId=` (optional) | reconciliations, the latest first, without their lines |
| POST | `/api/reconciliations` | `{ "accountId", "statementDate", "statementBalance" }` | the reconciliation: an account's open one (restarted with this statement) or a new one |
| GET | `/api/reconciliations/:id` | – | the reconciliation with its lines |
| POST | `/api/reconciliations/:id/tick` | `{ "lineIds": [...], "ticked": true \| false }` | the reconciliation |
| POST | `/api/reconciliations/:id/finish` | `{ "adjust"? }` | the finished reconciliation |
| DELETE | `/api/reconciliations/:id` | – | `{ "success": true }`: an open one is given up and its ticks removed |

A reconciliation: `{ "id", "account", "statementDate", "statementBalance", "status": "open | done", "previouslyCleared", "clearedBalance", "difference", "lines": [{ "lineId", "entryId", "date", "description", "amount", "ticked" }], "completedAt" }`. The lines are the account's lines up to the statement date not cleared by another reconciliation. `difference` is the statement balance less the cleared balance; `finish` refuses unless it is zero, or with `adjust: true` records it as an adjustment entry. Editing or deleting an entry cleared by a finished reconciliation returns `409` unless `confirmReconciled: true` is sent (a query parameter for `DELETE /api/entries/:id`), except an edit that keeps the account and amount, whose tick moves with it.

## Statement import

Bank and card statements into the ledger (`lib/services/statement-import.ts`, the `/import` screen). The browser reads the CSV, Excel or PDF file (`src/core/statement.ts`, `src/core/statement-pdf.ts`, `lib/statement-file.ts`) and sends only rows; the file, and a PDF's password, never reach the server. Row amounts are signed rupees text: positive into the account, negative out of it. At most 1000 rows per request; dates may not be in the future.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/imports/preview` | `{ "accountId", "rows": [{ "line", "date", "description", "narration"?, "amount" }] }` | the review; saves nothing |
| POST | `/api/imports` | `{ "accountId", "fileKind": "csv \| excel \| pdf", "rowsInFile"?, "closingBalance"?: { "date", "amount" }, "layout"?: { "signature", "presetKey", "mapping" }, "rows": [{ "line", "date", "description", "amount", "action" }] }` | `{ "batchId", "imported", "transfers", "replaced", "account": { "id", "name", "balance" }, "closing": { "date", "balance", "findb", "difference" } \| null }` |
| GET | `/api/imports` | – | the last 50 imports, newest first: `{ "id", "account", "fileKind", "rowsInFile", "imported", "active", "from", "to", "closingBalance", "createdAt", "undoneAt" }` |
| GET | `/api/imports/profiles` | – | remembered column choices: `{ "signature", "presetKey", "mapping", "accountId" }` |
| DELETE | `/api/imports/:id` | `?confirmReconciled=true` | `{ "undone", "restored" }`: the import's entries are voided and the entries it replaced count again; `409` when some are on a finished reconciliation and `confirmReconciled` is not sent |

A review: `{ "account": { "id", "name", "type", "balance" }, "balanceAfter", "rows": [{ "line", "date", "description", "amount", "duplicate", "repeated", "action", "reason", "match" }] }`.
- `duplicate`: `{ "entryId", "date", "description", "sameDescription" }` when an entry on the account has the same amount within three days, else `null`.
- `repeated`: the same date, amount and description appear earlier in the rows.
- `action`, the suggestion and what `POST` takes per row: `{ "type": "category", "categoryId" }` (`null` for the fallback), `{ "type": "transfer", "accountId" }` (the other own account), or `{ "type": "replace", "entryId" }` (an income or expense entry on another account becomes one transfer with this row).
- `reason`: `history`, `keyword`, `atm`, `card_payment`, `match` or `null`. `match`: an entry on another account that could be the other side, shown even when not suggested.
- A credit card takes income only in the Refund or Cashback category. The overspending check does not apply to imports. Errors name the statement's line: `"Line 4 of the statement: the date is in the future"`.

## Income

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/api/income` | `?month=1-12&year=YYYY` | array of income rows |
| GET | `/api/income/:id` | – | one income row |
| POST | `/api/income` | see below | created income row |
| PUT | `/api/income/:id` | same as POST | `{ "success": true, "message": "Income transaction updated successfully" }` |
| DELETE | `/api/income/:id` | – | `{ "success": true, "message": "Income transaction deleted successfully" }` |

```json
{
  "source": "string",
  "amount": 1000,
  "creditedToType": "bank | cash",
  "creditedToId": 1,
  "date": "YYYY-MM-DD"
}
```
`date` is the calendar date, stored exactly as given; a date that does not exist (such as `2026-02-30`) returns `400 Invalid date format`. `creditedToId` is the bank id when `creditedToType` is `bank`. The bank must be one of the user's own: another id returns `400 Bank not found`, and a type other than `bank` or `cash` returns `400 Invalid account type`. Adding, editing, and deleting income updates the linked bank or cash balance.

## Expenses

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/api/expenses` | `?month=1-12&year=YYYY` | array of expense rows |
| GET | `/api/expenses/:id` | – | one expense row |
| POST | `/api/expenses` | see below | created expense row |
| PUT | `/api/expenses/:id` | same as POST | `{ "success": true, "message": "Expense transaction updated successfully" }` |
| DELETE | `/api/expenses/:id` | – | `{ "success": true, "message": "Expense transaction deleted successfully" }` |

```json
{
  "title": "string",
  "amount": 500,
  "paymentMethod": "cash | bank | credit_card",
  "paymentSourceId": 1,
  "date": "YYYY-MM-DD"
}
```
`paymentSourceId` is the bank or credit card id (omit for cash). It must be one of the user's own: another id returns `400 Bank not found` or `400 Credit card not found`, and an unknown `paymentMethod` returns `400 Invalid account type`. Expenses reduce the bank/cash balance or increase the card's `used_limit`.

## Monthly summary

**GET** `/api/monthly-summary?month=1-12&year=YYYY`

```json
{
  "monthlyIncome": 0,
  "totalExpenses": 0,
  "netSavings": 0,
  "totalCurrentWealth": 0,
  "cardDues": 0,
  "totalInitialBalance": 0,
  "banks": [],
  "creditCards": [],
  "otherAccounts": [{ "id": 9, "type": "wallet", "name": "Paytm Wallet", "current_balance": "250.00" }],
  "spendingByCategory": [{ "id": 12, "name": "Groceries", "amount": "9400.00", "essential": true }],
  "essentialSpending": 9400,
  "discretionarySpending": 0,
  "uncategorisedSpending": 0,
  "oneOffSpending": 0,
  "regularSpending": 9400,
  "cash": { "balance": 0, "initial_balance": 0 },
  "selectedMonth": 7,
  "selectedYear": 2025,
  "trackingOption": "both",
  "isCurrentMonth": false,
  "isMonthCompleted": true,
  "message": null
}
```
Income and expenses are the entries dated in the month; transfers count as neither. `netSavings` is `monthlyIncome - totalExpenses`. Balances are as at the month's last day, from the ledger, and `totalCurrentWealth` is banks, cash, wallets and meal cards less `cardDues` (what is owed on cards), the same figure as "What you have" on Accounts. `regularSpending` leaves out spending on one-off events (`oneOffSpending`). `owedToYou` is money paid and still to be paid back (reimbursements), counted neither as spending nor in wealth. When the month has no transactions, `message` is `"No transactions found for this month"`, `messageKind` is `noTransactions`, and the totals are 0 (`future` and `beforeRegistration` for the other two empty months). Error messages come from the `errors` section of `messages/en.ts`.

## Activity log

**GET** `/api/activity`

Query parameters (all optional):
- `page` (default 1), `limit` (default 20, at most 100); values that are not positive whole numbers fall back to the defaults
- `type`: entity type, one of `income`, `expense`, `bank`, `credit_card`, `cash_balance`, `account` (recovery and password reset entries)
- `month` + `year`, or `year` alone, or `from_date` / `to_date` (YYYY-MM-DD)
- `export=true`: returns a CSV file (`activity-export.csv`) instead of JSON, without pagination. Every field is quoted with quotes doubled, and a value starting with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with `'` so spreadsheets show it as text

`totalItems` and `totalPages` count only the entries that match the filters.

Response:
```json
{
  "activities": [
    {
      "activity_type": "bank",
      "description": "Added bank account: HDFC",
      "amount": "1000.00",
      "account_info": "HDFC",
      "action_type": "created | updated | deleted",
      "old_values": {},
      "new_values": {},
      "created_at": "timestamp"
    }
  ],
  "statistics": { "totalTransactions": 0, "totalIncome": 0, "totalExpenses": 0, "netBalance": 0 },
  "currentPage": 1,
  "totalPages": 1,
  "totalItems": 0,
  "limit": 20
}
```

## Errors

Errors return `{ "error": "message" }` with status `400` (validation), `401` (not logged in), `404` (record not found for this user), `429` (rate limit) or `500`.

An unsupported method on an existing path returns `405`. Unknown API paths return `404 { "error": "Not found" }`.

## Rate limiting

- All requests: 100 per minute per IP, then `429`. Counted in memory per server instance.
- Auth endpoints (register, login, forgot-username, forgot-password, reset-password): 5 **failed** attempts per 15 minutes per IP, then `429`. Successful requests don't count. Skipped in development and when `DISABLE_RATE_LIMIT=true` (test servers).

## Security notes

- Passwords and security answers are hashed with bcrypt.
- Queries use parameterized statements.
- Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security` and `Cross-Origin-Opener-Policy: same-origin` (`next.config.ts`).
- API responses carry `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`. Pages get a per-request nonce policy from `proxy.ts` (`'strict-dynamic'`, no inline scripts).
- Vercel serves HTTPS only.
- Monetary columns are `DECIMAL(20,2)`.
