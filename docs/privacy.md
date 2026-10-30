# Privacy

How FinDB meets India's Digital Personal Data Protection Act, 2023 (DPDP), as far as the app goes today. v2 Phase 1, security and privacy; self-service export and erasure since Phase 5. This is the engineering record, not legal advice: the legal pages are to be reviewed by a lawyer before the public launch.

## Notice and consent

- **The notice** is in `lib/privacy-notice.ts`: who is responsible, what is kept, why, where, and the user's rights, in plain words. The sign-up form and the consent screen show it (`components/privacy/PrivacyNotice.tsx`), and `/privacy` gives the full version.
- **Consent at sign-up:** `POST /api/register` needs `acceptPrivacyNotice: true`. The account and its consent are written in one transaction.
- **The record:** `consents` keeps each agreement with the notice version (`PRIVACY_NOTICE_VERSION`), the purpose (`provide_service`), the time and the browser. It is proof that consent was given, and when it ended.
- **Accounts from before the notice**, and any account after the notice changes: `GET /api/user` says `consentNeeded`, and the app shows the consent screen in place of every screen until the user agrees (`POST /api/privacy/consent` with the version they saw) or logs out.
- **A new version:** change `PRIVACY_NOTICE_VERSION` when the notice changes in a way that matters. Everyone is then asked again at their next visit, as the privacy page promises.
- **Withdrawal**, as easy as giving consent (Settings, "Your data"): `POST /api/privacy/withdraw` records it, signs out every session, and the app stays locked until the user agrees again. It does not delete data; deleting is a separate step (below).
- The consent check is in the app's frame, not in every API route: the screens are the only way the app is used, and an extra query on every request was not worth it. Revisit when there is a public API.

## Data inventory

`lib/data-inventory.ts` lists every table: its category, what it holds in plain words, the purpose, how long it is kept, and whether the export will include it. Settings shows it to the user with how many records each holds for them (`GET /api/privacy`, counted under row level security). `tests/privacy.test.js` checks that it names exactly the tables in the database, so a new table cannot ship without deciding what it holds and for how long.

**Export** (`lib/services/account.ts`, `GET /api/privacy/export`, Settings): every table marked `exported`, the user's rows only, as one JSON file or a ZIP of one CSV a table. Password and answer hashes, encrypted values and two-step login state are left out; PAN and demat numbers come masked, as Settings shows them. Vault files are downloaded one by one from Documents.

**Erasure** (`POST /api/account/delete`, Settings): the password, a current code from the authenticator app, and typing DELETE. The user's vault files are removed from the bucket first (if the bucket cannot be reached, nothing is deleted); then, in one transaction, the former app's tables that do not cascade and the user row, which takes every other table with it. Backups age out on their own schedule (`docs/backups.md`).

Documents in the vault are encrypted by FinDB and kept in a private Supabase Storage bucket in India (`docs/security.md`); deleting one deletes its file. Deleting an account removes the user's files from the bucket before their rows.

Receipt photos and UPI screenshots are read on the device (quick add); the picture is uploaded only if the user keeps it in Documents.

Statement files are read in the browser and never uploaded, and a protected PDF's password is used there only to open it: only the rows the user keeps are sent and saved, as entries, with the layout's column names (`import_profiles`) and a summary of each import (`import_batches`).

## Rights today

| Right | How |
|---|---|
| See | The app; Settings, "Your data" |
| Correct | Edit records in the app |
| Export | Everything, as JSON or CSV, from Settings (and the activity log as CSV) |
| Erase | Delete my account in Settings: password, a current code and DELETE |
| Withdraw consent | Settings, "Your data" |
| Grievance | support@onemark.co.in, then the Data Protection Board of India |
| Nominate | By email: someone to act for the user if they die or cannot act |

## Before the public launch

- A lawyer's review of `/privacy`, `/terms` and the notice.
- A named grievance officer and response times.
- The notice in the other languages of the Eighth Schedule, on request at least (DPDP section 5(3)).
- A written plan for handling a breach (self-service export and erasure are done).

## Profile

`lib/services/profile.ts`: date of birth, city, tax residency and dependants are kept as given; PAN and demat or broker account IDs are encrypted with `lib/field-encryption.ts`, bound to the user, and only returned masked, so the full values never reach a browser after they are saved. Aadhaar is at most its last four digits: a full number is refused, as the Aadhaar Act restricts keeping it. The activity log names the fields that changed, never their values.
