# Account security

v2 Phase 1, security and privacy, part one ([v2-plan.md](v2-plan.md)). Database-enforced isolation and the privacy notice follow in their own pull requests.

## Two-factor login (required)

Every login needs a code from an authenticator app (TOTP, RFC 6238: HMAC-SHA1, 6 digits, 30 seconds), such as Google Authenticator or Microsoft Authenticator. It is free and offline: no SMS and no outside service. `lib/totp.ts` implements it, checked against the RFC's test values.

**Login in two steps.**
1. `POST /api/login` checks the password. A right one starts a **pending login**: a row in the `session` table with no `userId`, behind its own cookie (`findb_login`, HttpOnly, ten minutes). It opens nothing, because `sessionUserId` accepts only rows with a numeric `userId`. The response says what comes next: `verify` (enter a code) or `setup` (set up the app first).
2. `POST /api/login/two-factor` with `{ code }` or `{ recoveryCode }` finishes it: the pending login is deleted and a real session starts.

**Setup.** A new account is at `setup` right after registering; an account from before two-factor login is at `setup` at its next login. `GET /api/two-factor/setup` returns a secret (160 random bits, base32) and the `otpauth://` link its QR code shows. The same secret is returned until it is confirmed. `POST /api/two-factor/setup` with the first code turns two-factor login on, finishes the login, and returns ten recovery codes, shown only then.

**Rules.**
- A code is accepted one 30-second step either side of now, for a phone clock that is slightly off.
- A code from a step at or before the last one accepted is refused (`users.totp_last_step`), so a code someone else saw cannot be used again.
- After five wrong codes in fifteen minutes, the account refuses codes, even right ones, until the window passes. Wrong codes are recorded outside the failing transaction so they always count. The per-IP auth limit (5 failed attempts in 15 minutes) applies as well.
- Recovery codes are 50 random bits each (`xxxxx-xxxxx`), stored as SHA-256 hashes, each usable once. New ones (Settings, after a current code) replace all the old ones.
- Resetting a forgotten password through the security question does not skip two-factor login: the next login still needs a code.

## Encryption of sensitive values

`lib/field-encryption.ts`: AES-256-GCM in the application, with a 96-bit random IV per value and the value bound to a context (the column and the user's id) as additional data, so a value copied to another row does not decrypt. A stored value is `v<key version>.<iv>.<tag>.<ciphertext>`.

Keys come from `FIELD_ENCRYPTION_KEYS`, `version:base64key` entries, comma-separated, newest first. Today it protects the two-factor secrets (`users.totp_secret_enc`, `users.totp_pending_secret_enc`); PAN, account numbers and similar details will use it when the features that hold them arrive.

- Make a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- Every environment has its own key: production (Vercel Production and `.env`) and tests (`.env.test`, and Vercel Preview).
- Without the key, two-factor setup and login fail, so nobody can log in: set it before deploying.
- **Rotation:** put a new key in front (`2:new,1:old`); new values use it and old values still read. `needsReencryption` tells which values to rewrite; once all are rewritten, remove the old key.
- **Losing the key** makes every two-factor secret unreadable; users would need their recovery codes and a reset. Keep a copy in a password manager.

## Sessions and login history

- The `session` table records the user, when the session started, when it was last used (updated at most every five minutes) and the browser's user agent. Settings lists each device as, for example, "Chrome on Android"; a session's id there is a hash, never the real one.
- `DELETE /api/sessions/:id` signs one device out; `DELETE /api/sessions` signs out everywhere, this browser included.
- `login_events` keeps logins, wrong passwords and codes, recovery code use and security changes, with the user agent and no IP address. A user sees their last 30 in Settings. Entries older than a year are deleted at each login.

## Passwords

`passwordProblem` in `lib/auth-validation.ts`, shared by the forms and the server:
- 8 to 64 characters, any characters including spaces, and at most 72 bytes (bcrypt reads no further).
- Shorter than 16: an uppercase and a lowercase letter, a number and a symbol. From 16 on, a passphrase of plain words is fine.
- Not a common password (`lib/common-passwords.ts`, also with symbol and digit swaps undone, so "P@ssw0rd!" is "password"), and not containing the username.
- Not known from a data breach, on the server (`lib/breached-password.ts`): the free Pwned Passwords range API, sent only the first five characters of the password's SHA-1, with padding. If the service is slow or down the check is skipped (fail open). Test servers set `BREACHED_PASSWORD_CHECK=false`.

## Tests

- `tests/security.test.js`: setup, codes, replay, lockout, recovery codes, sessions, history, encryption at rest, password rules.
- `tests/unit/totp.test.ts` (RFC 6238 values), `tests/unit/security.test.ts` (encryption, rotation, breach check, device names).
- `tests/e2e/security.spec.js`: recovery code login, Settings, sign out everywhere, and that a password alone opens nothing.
- Test users have two-factor login on with `TEST_TOTP_SECRET`; `logIn` in `test-helpers.js` does both steps, and the end-to-end helpers read each new user's secret from the setup screen.
