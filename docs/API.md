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
  "securityAnswer": "max 200"
}
```
All fields are required. Response: `{ "success": true, "userId": 1, "twoFactor": "setup" }`, with a pending login at two-factor setup (no session yet). Duplicate username or email returns `400`.

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
**GET** `/api/user` → the logged-in user's profile row.

### Set tracking option
**POST** `/api/set-tracking-option`

```json
{ "trackingOption": "income | expenses | both" }
```
Response: `{ "success": true }`

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

## Banks

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/banks` | – | array of bank rows |
| POST | `/api/banks` | `{ "name", "initialBalance" }` | created bank row |
| PUT | `/api/banks/:id` | `{ "name", "initialBalance" }` | updated bank row |
| DELETE | `/api/banks/:id` | – | `{ "success": true, "message": "Bank deleted successfully" }` |

Bank row: `id, user_id, name, initial_balance, current_balance, created_at`. Names are stored upper-case and are unique per user. A bank with transactions cannot be deleted.

## Credit cards

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/credit-cards` | – | array of card rows |
| POST | `/api/credit-cards` | `{ "name", "creditLimit" }` | created card row |
| PUT | `/api/credit-cards/:id` | `{ "name", "creditLimit" }` | updated card row |
| DELETE | `/api/credit-cards/:id` | – | `{ "success": true, "message": "Credit card deleted successfully" }` |

Card row: `id, user_id, name, credit_limit, used_limit, created_at`.

## Cash balance

**GET** `/api/cash-balance` → `{ id, user_id, balance, initial_balance, updated_at }`, or `{ "balance": 0 }` if never set.

**POST** `/api/cash-balance`

```json
{ "balance": 5000, "initial_balance": 5000 }
```
Creates the row on first call. On update, sending both fields changes the setup values; sending only `balance` adjusts the running balance and keeps `initial_balance`. Returns the cash balance row.

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
  "totalInitialBalance": 0,
  "banks": [],
  "creditCards": [],
  "cash": { "balance": 0, "initial_balance": 0 },
  "selectedMonth": 7,
  "selectedYear": 2025,
  "trackingOption": "both",
  "isCurrentMonth": false,
  "isMonthCompleted": true,
  "message": null
}
```
When the month has no transactions, `message` is `"No transactions found for this month"` and the totals are 0.

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
