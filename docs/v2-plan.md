# FinDB v2 plan

_Drafted 2026-10-03. Status: **proposed, awaiting approval.** Nothing in this plan is built yet. Each phase starts only after it is approved, and each phase ends with a full test run and a reviewed pull request._

v2 turns FinDB from an income-and-expense tracker into a full personal finance dashboard for India. The user records their own money, imports bank and card statements to save typing, and sees everything in one place:
- accounts and spending;
- loans, including gold loans and money lent to or borrowed from people;
- credit cards with cashback and rewards;
- investments with live prices;
- property and rents;
- vehicles, gadgets, jewellery and other valuables, whether bought, received as gifts or inherited;
- deposits, post office schemes, retirement savings and pensions;
- insurance, taxes and goals;
- net worth;
- a review of whether their finances are heading the right way compared with inflation and the market.

FinDB never moves money and never connects to a bank on its own. Outside connections are optional and chosen by the user: price feeds, a broker account, and later a consent-based bank data connection.

This plan combines the original v2 brief (see `docs/v2-audit.md`) with everything agreed on 2026-10-03.

## What makes FinDB different

There are hundreds of expense trackers. Most do one of two things: they record spending, or they show investments while selling the user loans, cards and funds. FinDB's position:

> **The complete, private record of your family's money, made for India.**

1. **Everything an Indian family actually owns, in one place:** gold by weight and purity, chits, EPF and NPS, PPF and post office schemes, meal cards, rent, property and house construction, money lent to friends, gifts at weddings. Most apps stop at expenses, or at what they sell.
2. **Numbers you can trust.** The ledger never double-counts or loses a rupee, transfers are not spending, an EMI shows how much was interest, and every balance can be checked against its statement.
3. **Free for everyone, and private by design** (decided 2026-10-03). No paid plans, no ads, no selling or sharing data, no loan or product offers. FinDB is run at the lowest possible cost so it can stay free (see "Free for everyone: keeping costs near zero").
4. **Built around family and life events:** weddings, housewarmings, trips with friends, parents' money, joint property, nominees.
5. **It answers "Am I doing okay?"** in plain language: returns against inflation, debt health, insurance cover, and how many months the emergency fund lasts, not just a chart of last month's spending.
6. **Little effort:** statement import, one payslip entry a month, repeating entries, sharing from the phone, and sample data to try first.

**The biggest risk is complexity, not missing features.** Fourteen phases of features could make FinDB feel overwhelming, so:
- **Simple first.** A new user sees only the modules they chose; everything else stays hidden until they turn it on.
- **Useful within five minutes.** Import the last three months of a statement and immediately see where the money went.
- **One clear next step on the home screen,** for example "Your HDFC card bill of ₹18,400 is due in 3 days."

**Deliberately left out**
- **Reading SMS automatically.** Google Play strictly limits which apps may read SMS, and many users distrust it. Sharing a message into FinDB (Phase 5) gives most of the benefit with the user in control.
- **Advertising, selling data, and earning commissions** on loans, cards, insurance or funds.

## Rules for every phase

**Money and data**
- **A double-entry ledger.** Every money event is one journal entry made of lines. Each line moves an amount into or out of an account, and the lines of an entry always add up to zero. Banks, cash, cards, wallets, loans, money owed by or to people, investments, deposits, property and vehicles are all accounts, and so are income and expense categories. Balances come from the ledger, so they cannot drift apart from the entries. The database enforces that every entry balances, and tests check it for every kind of event.
- **Exact money.** Amounts are stored as `bigint` paise (₹12.50 is `1250`), never in floating point. Every amount carries a currency; it is INR until multi-currency arrives in Phase 12.
- **Corrections keep history.** Editing or deleting an entry records what changed, and statements already reconciled stay explainable.
- **Atomic writes.** Each event, with every line, balance change and activity log entry it causes, is saved in one transaction (`withTransaction`). Rows that are checked or changed are locked.
- **Per-user isolation enforced by the database.** Each request runs in a transaction that sets `app.user_id`. Row level security policies on every user table allow only rows where `user_id = current_setting('app.user_id')::int` (the decision recorded on 2026-09-30). Queries also keep their own `user_id` filters.
- **Only the user's own accounts.** Every entry checks that the accounts it uses belong to the user.
- **Every change is logged** in the activity log, in the same transaction.
- **Evidence and reconciliation everywhere.** Any entry can link to the documents that support it: a receipt, a certificate, a statement. Each kind of account can be checked against its source:
  - bank and wallet balances against statements;
  - card transactions against the card statement;
  - investment units against the broker or fund statement;
  - FD interest against the bank's interest certificate;
  - loan balances against the lender's statement;
  - taxes against Form 16, Form 26AS and the AIS.
  A difference is shown with the entries that explain it.

**Security and privacy**
- **Sensitive values are encrypted** before they reach the database: PAN, bank account numbers, demat and broker account IDs, policy numbers, folio numbers, and uploaded documents. They are shown masked by default.
- **Store only what is needed.** For Aadhaar, at most the last four digits and whether it is linked to PAN; never the full number, which the Aadhaar Act restricts. No passwords or PINs for banks, cards or brokers, ever.
- **India's Digital Personal Data Protection Act, 2023:**
  - a clear notice and consent at sign-up;
  - the user can see, correct, export and erase their data;
  - data is kept only as long as needed;
  - there is a written plan for handling a breach.
- **Backups:** daily database backups, and a restore that has actually been tested.
- **Information, not advice.** Insights, rankings, simulations and reviews are rule-based calculations and general explanations, never personal investment advice; in India that advice is regulated by SEBI. Every such screen says so and shows the thresholds it used.

**Product**
- **Simple first:** each screen shows what the user's modules need and nothing more; advanced options sit behind "More".
- **Phone first:** every screen is designed for a phone at 360 px wide first, then widened for larger screens.
- **Plain language** on every screen, with financial terms explained where they appear.
- **Interest in both forms:** every interest rate or return the user enters or sees (loans, money with people, chits, cards, deposits, investments) can be entered and is shown as **% a year** and as **₹ per ₹100 a month**, the way many Indians quote it (₹1 per ₹100 a month is 12% a year). Totals also show the interest or growth on every ₹100.
- **Ready for Indian languages:** all text lives in message files from Phase 1, never written into components, so translations can be added without code changes. Amounts and dates follow Indian formats in every language.
- **Accessible:** WCAG 2.2 AA (contrast, keyboard use, screen reader labels, text that can be enlarged), checked in the Playwright flows.

**Process**
- **Migrations:** each phase ships its database changes as numbered SQL files for the owner to apply (the decision recorded on 2026-09-30). Tests run them on the `balancetrack_test` schema first.
- **No emoji anywhere**; names and messages are rendered as text.
- **Tests per phase:**
  - unit tests for every calculation;
  - API tests over HTTP for every route, including isolation between users;
  - ledger balance checks;
  - Playwright flows for the main screens;
  - one full run at the end of the phase.

## Overview

| Phase | Name | What the user gets |
|---|---|---|
| 1 | Foundation | Double-entry ledger with opening balances and reconciliation; new design; meal cards and wallets; module switches; transfers and other movements; categories and tags; repeating entries; two-factor login, session management, encryption, privacy, backups, database-enforced isolation |
| 2 | Import, documents, insights and budgets | Bank and card statement import, import from other apps, quick and bulk entry, search, the document vault and receipt reading, category averages, subscription finder, event reports, budgets, unusual-spend flags |
| 3 | Debts and people | Loans with EMIs; gold loans and loans against FDs, insurance, securities and property; chit funds; money lent and borrowed with people; split costs; dangerous-debt ranking and payoff plans |
| 4 | Credit cards | Shared credit lines, statements, loans on cards, cashback and reward points, a calendar of everything due |
| 5 | Public launch | Email verification and recovery, reminders by push and in the app, rate limits on every write, data export and account deletion, phone app with offline entry and sharing, weekly summary, simple mode, first Indian languages, support, beta, optional donations, monitoring |
| 6 | Investments | Physical and digital gold, Sovereign Gold Bonds, stocks, mutual funds, ETFs, bonds, REITs and InvITs, crypto, ESOPs and RSUs; SIPs; dividends; profit and loss; live prices |
| 7 | Property, rentals and physical assets | Land and property with values and ownership shares, tenants and rent, vehicles and other assets with depreciation |
| 8 | Savings, retirement and goals | RDs and FDs with interest, post office schemes, EPF, VPF and NPS, the payslip entry, savings pots, goals |
| 9 | Net worth, insurance and tax | Net worth and its trend, health ratios, term and health insurance, tax tracker with capital gains, rent paid and advance tax |
| 10 | Financial status review | Whether each area is heading the right way against inflation and the market, with reasons |
| 11 | Household and estate | Family sharing and joint ownership, nominees, an estate summary |
| 12 | Multi-currency and global investments | Accounts in other currencies, US stocks bought from India, exchange rates |
| 13 | Business and freelance income | A simple business book, invoices, GST collected and paid |
| 14 | Account Aggregator | Consent-based bank and investment data through RBI's Account Aggregator framework (on hold while FinDB is free: it has per-fetch fees) |

**Why this order**
- **Phase 1 lays the ledger.** Every later feature records money through it, so it must exist first.
- **Import arrives in Phase 2.** Manual typing is the main reason people stop using a finance app.
- **Public launch moves up to Phase 5,** so real users get a safe, complete core (accounts, spending, debts, cards) while the wider features arrive phase by phase.
- **Phases 12 to 14 are later work.** Each needs outside dependencies or partners.

---

## Phase 1: Foundation

Phase 1 is several pull requests: the ledger and migration, then security and privacy, then the design system, then the remaining features.

**Double-entry ledger**
- **Tables:**
  - `ledger_accounts`, with a kind (asset, liability, income, expense, equity), a subtype (bank, cash, card, wallet, meal card, and later loan, holding, deposit, property and so on) and a currency;
  - `journal_entries`: date, description, type, and links to the feature that made the entry;
  - `journal_lines`: account, amount in paise, and sign.
- **Database checks:** every entry's lines must sum to zero, and lines may only use the user's own accounts.
- **Balances:** each account's balance is the sum of its lines. Fast balances are kept in a summary table updated in the same transaction, and a check compares it with the lines.
- **Opening balances:** starting with money the user already had is an entry against an "opening balance" equity account, so the starting point is clear and changes nothing else.
- **Reconciliation:** the user enters the balance from a statement on a date, marks entries as cleared, and sees the difference and which entries make it up.
- **Corrections:** an edit or deletion keeps the original in history. Reconciled periods show a warning before they change.
- **Migrating today's data:** existing banks, cards, cash, income and expenses become ledger accounts and entries. Each balance is checked against the old tables before the switch, and the old tables stay read-only until the move is verified.

**More kinds of account**
- Banks, cash and credit cards as today, plus **meal cards** (Pluxee, formerly Sodexo, and similar employer food cards) and **wallets** (prepaid and UPI wallets).
- Every bank account records its bank, account type (savings, current, salary, NRE or NRO) and savings interest rate. The rate gives an estimate of interest due, and lets the Phase 10 review compare idle money with inflation.
- A meal card is topped up by the employer each month. The top-up is "Meal benefit" income, or comes from the payslip entry in Phase 8. Spending from it is an ordinary expense paid from the card. The card can also note where it may be used, and when unspent money expires.

**Money movements that are not income or expenses**
- These are ledger entries between asset and liability accounts, including everyday ones: an ATM withdrawal (bank to cash), a credit card bill payment (bank to card), moving money to an FD or a broker account. Other movements:
  - transfers between own accounts;
  - loan payouts and principal repayments;
  - investment buys and sells;
  - deposits in and out;
  - money lent to or repaid by people.
- They change balances but never count as income or spending.
- **Net savings = income - expenses**, where expenses include loan interest and fees but not principal. The monthly summary is rebuilt on this rule, which also fixes the known issue about accounts created on the last day of a month.

**Expense categories and tags**
- **Default expense categories:** Rent, Groceries, Restaurants and food delivery, Fuel, Transport, Subscriptions, Movies and entertainment, Shopping, Health, Education, Travel, Bills and utilities, Insurance, Loan interest and fees, Taxes, Gifts, Personal care, Other. Users can rename them and add their own.
- **Income categories:** salary, pension, freelance, rental income, interest, dividends, meal benefit, cashback and rewards, gifts received (money), refund, other.
- **Gifts and inheritance received as things, not money** (a gold chain, a watch, a phone, a camera, a property): the item becomes an asset at its value on the day it was received. The other side of the entry is a "Gifts and inheritance" equity account, not income. Net worth goes up, but monthly income and net savings don't, because no money arrived. The giver, their relationship to the user, and the occasion are recorded (see the tax tracker in Phase 9).
- **Gifts given:** money given is an expense in "Gifts". Giving away an asset removes it at its current value, recorded in the same "Gifts and inheritance" account.
- **Who a purchase is for decides how it is recorded.** Buying something of lasting value (gold, a watch, a phone) asks "who is this for?":
  - **for the user, their spouse or children** (or another dependant in their profile): it stays in the family, so it is an **asset**, owned by that person. The owner is recorded, and their share counts in net worth;
  - **for someone else** (a friend's wedding, a relative outside the household): it leaves the family, so it is an **expense** in "Gifts", even if it was gold;
  - something bought for the family and given away later becomes a gift at that point, at its current value.
- Assets owned by a spouse or child can be shown inside or outside the user's own net worth, as the user prefers (the household view in Phase 11 shows the family total). Information only: income from assets given to a spouse can be taxed in the giver's hands under Indian rules, so the tax centre notes this.
- **Suggested category from the title:** a keyword list ("Swiggy" means restaurants, "HP Petrol" means fuel) that learns from the user's own choices.
- **Tags** for free-form labels that cut across categories.

**Events and projects (the purpose of an entry)**
- An **event or project** is a named purpose with optional dates and an optional budget:
  - "Sister's wedding, Feb 2027";
  - "Housewarming";
  - "House construction";
  - "Goa trip";
  - "Diwali 2026";
  - "Car purchase".
- **Any entry can carry a purpose:** an expense, income, a transfer, an asset bought, a loan taken.
  - The user picks the purpose while adding the entry, or creates a new one on the spot, alongside the usual category. So "Catering ₹1,80,000" is in the category Food and the event "Sister's wedding".
  - Statement import (Phase 2) can assign a purpose to many entries at once.
- **Income works the same way:** money gifts received at the housewarming, the cash and gold given at the wedding, a loan taken for construction. Each is recorded with its normal meaning (income, an asset, a loan) and the event.
- **An event's summary shows:**
  - total spent, by category;
  - total received;
  - the net cost to the user;
  - budget against actual;
  - how it was paid for (savings, a loan, gold sold);
  - a timeline.
  Shared events (a wedding where parents and siblings also pay) use groups (Phase 3), so only the user's share counts.
- **A summary across events,** for example: house construction ₹38,40,000, housewarming ₹2,15,000, sister's wedding ₹6,70,000.
- **One-off events don't distort the regular picture.** Monthly averages, budgets, the emergency fund and the status review can leave out spending marked as a one-off event, for example "Regular spending ₹48,000 a month (excluding sister's wedding)". The full total is always available.
- Existing expenses start as "Uncategorised" and can be categorised in bulk.

**Repeating entries**
- Daily, weekly, monthly or yearly, on a chosen day, with an optional end date: salary, rent, EMIs, SIPs, a daily gold SIP, insurance premiums, school fees, electricity, internet, phone and subscriptions.
- Each has an amount, account and category, and an optional reminder before it is due.
- Each is either added automatically or shown for one-tap confirmation.

**Reimbursements**
- An expense paid personally but owed back by an employer or someone else (a hotel stay on a work trip, a medical bill the insurer will refund) is marked reimbursable. Its status moves from pending to received.
- While pending, the amount is money owed to the user, not spending. When it arrives, the repayment settles it. Spending reports show only what the user actually bore.
- A partial reimbursement leaves the rest as the user's own expense.

**Essential and discretionary spending**
- Each expense category is marked essential (rent, groceries, utilities, EMIs, insurance, school fees) or discretionary (restaurants, shopping, entertainment), with sensible defaults the user can change.
- The emergency fund check uses average essential spending: "Essential spending averages ₹45,000 a month. Your emergency fund of ₹1,80,000 covers 4 months."

**Profile**
- Date of birth (for age-based rules such as senior citizen interest and the allocation guide), city, tax residency, and dependants: spouse, children and parents, with their dates of birth. Dependants feed insurance adequacy, goals such as children's education, and the review.
- PAN, stored encrypted. Aadhaar, at most the last four digits. Demat and broker account IDs, encrypted.

**Choosing what to track (onboarding and module switches)**
- **Always on:** accounts (banks, cash), transactions, and net worth.
- **Optional modules:**
  - Income;
  - Spending and budgets;
  - Credit cards;
  - Debts and people;
  - Investments and gold;
  - Property and other assets;
  - Savings and retirement (deposits, post office schemes, EPF, NPS, pensions);
  - Insurance;
  - Goals;
  - Tax;
  - Household.
- **At sign-up**, the user picks what they want to track, each module explained in one plain line:
  - presets to start from: "Just my spending", "My spending and savings", "Everything";
  - or any combination of their own.
  This replaces today's income, expenses or both choice (`tracking_option`); existing users are mapped from it.
- **Change it any time in Settings.** After using FinDB for a while, the user can turn any module on or off.
  - **Turning one off** hides its screens and reminders. Its data is kept, and still counts in net worth unless the user archives it, and the confirmation says so.
  - **Turning it back on** shows everything again, exactly as it was.
- **Gentle suggestions:** when the user records something a switched-off module handles (an expense called "Home loan EMI", say), FinDB offers once to turn that module on, and never asks again if they decline.

**The first five minutes**
- **Try it with sample data:** a new user can explore FinDB filled with a realistic sample family's money before entering their own, and clear it with one click. Sample data is marked everywhere and never mixes with real entries.
- **A short setup:** add accounts with opening balances, then either import a statement (Phase 2) or add a few entries. Each step can be skipped.
- **The home screen** shows one clear next step (a bill due, an entry to confirm, an account to reconcile) above the usual summary.

**Security and privacy**
- **Two-factor login is mandatory** (decided 2026-10-03), using time-based codes (TOTP) from any authenticator app, such as Google Authenticator or Microsoft Authenticator. It is free: no SMS, no paid service. One-time recovery codes are given at setup. New users set it up at sign-up; existing users at their next login.
- **Sign in with Google** (Google's free OAuth) can be added later as an extra way to log in. Two-factor login still applies to password logins.
- **Sessions:** a list of active sessions (device, browser, last seen), with "sign out" for each and "sign out everywhere". Login history.
- **Passwords:** allow long passphrases (well beyond today's 16-character limit), and refuse common and known-breached passwords.
- **Encryption** of sensitive fields, as described in the rules: AES-256-GCM in the application, with the key in an environment secret (decided 2026-10-03: free, and Vercel encrypts environment variables at rest). Each value records its key version, so the key can be rotated without downtime. Values are shown masked.
- **Privacy:** the sign-up notice and consent, and the data inventory that export and erasure (Phase 5) are built on.
- **Backups:** daily backups confirmed, and a restore rehearsed and documented.

**Design system**
- Source Sans 3 with tabular numerals, so amounts line up.
- Light and dark themes built from tokens.
- Borders instead of shadows; no blurred panels and no gradients.
- A chart library, bundled from npm.
- Shared components. Every existing screen moves to the new design.
- Phone-first layouts, and all text in message files (see the product rules).

**Done when**
- every existing balance matches after the move to the ledger, and every entry balances;
- reconciliation finds a planted difference;
- two-factor login and "sign out everywhere" work;
- sensitive fields are encrypted in the database;
- a backup has been restored;
- the new design is on every screen in both themes;
- a transfer does not change income or expenses;
- categories are suggested;
- repeating entries fire;
- sample data can be explored and cleared without touching real entries;
- no screen has text written into components instead of message files;
- a test proves one user cannot read another user's rows even with the query's `user_id` filter removed.

## Phase 2: Import, documents, insights and budgets

**Statement import**
- **Upload a bank or card statement** as CSV or Excel. Columns are mapped once per bank, and the mapping is remembered. Presets cover the major Indian banks and card issuers.
- **PDF statements next,** including password-protected ones; the user types the password, and it is never stored.
- **A review screen before anything is saved:**
  - duplicates are flagged (same date, amount and description, or already entered by hand);
  - categories are suggested;
  - transfers between the user's own accounts are detected and paired.
- Statement files are processed and discarded, not stored, unless the user chooses to keep them in the document vault (below).
- **Importing from other apps and spreadsheets:** exports from popular expense and money-manager apps, Splitwise-style group expense exports, and the user's own spreadsheets, through the same column mapping and review screen. Switching to FinDB should not mean losing years of history.
- Imported balances feed reconciliation.

**Faster entry:** quick-add with just an amount, account and category; a spreadsheet-style grid for many entries at once.

**Search across everything:** entries, people, events, assets and documents, by text, amount, date range, account, category, tag or event, with saved searches.

**Spending insights**
- **Category averages:** "Restaurants: ₹6,800 a month on average over 3, 6 or 12 months, up 22%."
- **Subscription finder:** repeating similar charges are flagged as subscriptions, with the monthly and yearly total, new ones, price increases, and ones that stopped.
- **Events and trips:** each event's total by category, with income received and budget against actual (see Events and projects in Phase 1). A month's report shows regular spending and event spending side by side.
- **Top categories and month-on-month changes,** as charts.
- **Budgets:** a monthly limit per category, with alerts at 80% and 100%.
- **Unusual-spend flags:** "Fuel this month is twice your average."

**Document vault and receipts**
- Upload statements, receipts, invoices, policy documents, loan papers, property papers, warranties, certificates and tax forms.
- Attach them to any entry, account or asset: "FD ₹5,00,000: FD receipt, interest certificate, TDS entry, financial year."
- Files are encrypted, in private storage only, with size and type limits.
- Each document has a type, a date and an optional financial year, so tax documents for a year can be found together.
- Expiry dates (warranties, policies) feed reminders.
- **Reading receipts and screenshots:** a photographed receipt or a UPI payment screenshot fills in the amount, date and merchant for the user to confirm. It ships in Phase 2 if the reading is accurate enough on Indian receipts, otherwise soon after.

Data: `import_profiles`, `import_batches`, `budgets`, `documents`, `document_links`. Events and projects (Phase 1): `events`, with an `event_id` on journal entries.

## Phase 3: Debts and people

**Loans from banks and lenders**
- **What is recorded for each loan:**
  - the lender, the original principal and the disbursement date or dates;
  - home loans for property under construction can be paid out in stages, with interest-only "pre-EMI" until the full amount is out;
  - the tenure, the EMI and how often it is paid;
  - a fixed or floating rate;
  - the processing fee, loan insurance and other charges;
  - the terms for foreclosure or early closure.
- **Floating rates:** each rate change is recorded with its date. The user chooses whether the bank changed the EMI or the tenure, and the schedule is recalculated.
- Reducing-balance and flat-rate loans, with the effective yearly rate shown. Fees and charges count toward that rate.
- A full repayment schedule.
- EMIs recorded as full, partial or late, and missed EMIs flagged.
- Prepayments and top-ups, with the interest saved shown.
- An EMI splits automatically into principal (a movement) and interest (an expense in "Loan interest and fees").
- **Per loan and per financial year:** outstanding principal, principal repaid, interest paid, and fees paid. This answers "how much debt do I really have?" and "how much interest did I pay this year?", and it checks against the lender's interest certificate for tax.
- **Foreclosure:** the amount needed to close the loan today, including any foreclosure charge.
- **A public EMI calculator.**

**Loans backed by an asset**
- **Gold loans:**
  - the gold pledged (weight and purity), the loan-to-value, interest, and bullet or EMI repayment;
  - the gold is marked as pledged until the loan is closed;
  - a warning if the gold price falls enough to risk a margin call.
- **Loans against an FD, an insurance policy, securities or property:** the asset is linked and shown as pledged, and the loan reduces what is available from it.

**Chit funds**
- **Setting up a chit:**
  - the chit value, the number of members and months, the monthly contribution, and the auction or draw schedule;
  - the organiser, either a registered chit company (with its registration details) or an informal chit run by a person;
  - the organiser's commission, usually around 5% of the chit value, taken from the prize.
- A user can hold **several chits at once,** each with its own schedule.
- **Each month:**
  - the **amount actually due** is the contribution minus that month's dividend (the user's share of the auction discount after commission). It changes every month, so it is entered or calculated per month, not fixed like an EMI;
  - the payment is recorded against the chit, and the dividend is recorded as income.
- **Before the user wins the chit:** each payment is savings held in the chit, not spending.
- **Winning the chit:**
  - the user records their bid (or the draw), the prize amount, and the commission and other deductions;
  - the net prize received goes into their account;
  - the remaining contributions become a liability, like a loan, paid off month by month.
- **The true return or cost:**
  - for someone who wins late, the chit works like savings, with an effective yearly return;
  - for someone who wins early, it works like a loan, with an effective yearly cost that includes the commission;
  - either way it can be compared with an RD or a personal loan.
- **Risk note:** an informal or unregistered chit is marked as higher risk, and the debt and status reviews mention it, as information only.
- **Reminders:** the monthly payment date and the auction date.
- **Documents:** the chit agreement, the passbook and the payment receipts, kept in the document vault and linked to the chit.

**Money with people**
- Money lent and borrowed: interest-free or with interest, an optional due date, repayments in parts, and a status of open, overdue or settled.
- Lending and repayments are movements, not income or spending. Money owed to the user counts as an asset; money they owe counts as a liability.
**Shared expenses and groups (trips, flatmates, outings)**
- **A group,** such as "Goa trip, Dec 2026" or "Flat 302", lists the people in it. They are entries in the user's People list and do not need a FinDB account.
- **Each shared expense records who paid and who shares it.**
  - **Who paid:** the user, or a friend.
  - **Who shares it:** everyone, or only some members.
  - **How it splits:** equally, by exact amounts, by percentages, or by shares (for example, a couple counts as 2).
- **How each case is recorded:**
  - **The user pays for everyone** (for example, all the train tickets): the full amount leaves their account. Their own share is spending, and each friend's share becomes money that friend owes the user.
  - **A friend pays for everyone** (for example, the hotel): no money leaves the user's accounts. Their share is still spending, because they used it, and it becomes money they owe that friend.
  - **The user pays and does not want it back** (a treat): they mark it so, and the whole amount is their spending.
  - **The user is not part of an expense** (two friends' shopping): it is recorded for the group's balances only and does not touch the user's spending.
- **Balances per person:** what each friend owes the user, or the user owes them, after netting everything in the group.
  - **"Simplify debts"** shows the fewest payments that settle everyone: "Rahul pays you ₹1,000; you pay Sneha ₹2,300."
- **Settling up:** a payment by UPI, bank or cash, in full or in part, moves real money and clears the balance. It is never income or spending.
- **The trip's cost** shows two numbers: what the user actually spent (their share of everything) and what the whole group spent. These come with a breakdown by category (travel, stays, food).
- **Foreign trips:** expenses in another currency, once Phase 12 adds currencies.
- **Later:** if friends also use FinDB, a shared group they can all see and add to, with their consent.

**Which debt is most dangerous**
- Debts ranked by their true yearly cost, with a plain-language explanation of each type: credit card balance carried over, buy-now-pay-later and instant loan apps, personal and card loans, gold loans, vehicle loans, home loans.
- **Payoff simulator:** highest-rate-first against smallest-balance-first, showing interest saved and the debt-free date.
- **Warnings:** minimum-only payments, a high EMI-to-income ratio, gold loan margin risk, and overdue money from people.

Data: `loans`, `loan_payments`, `pledges`, `chit_funds` (organiser, registration, commission), `chit_instalments` (amount due, dividend, paid), `chit_auctions` (bid, prize, deductions), `people`, `person_loans`, `person_loan_payments`, `groups`, `group_members`, `shared_expenses`, `shared_expense_shares`, `settlements`.

## Phase 4: Credit cards

- **Credit lines:** one shared limit across several cards.
- **Statements:** billing and due days, the amount due, the minimum due, and payments matched to statements.
- **Loans on a card,** using the Phase 3 loan engine.
- **Cashback:** cashback credited to the card or to a bank is income in "Cashback and rewards", reported per card and per year.
- **Reward points:** the balance, points earned and redeemed, an optional value per point (shown but not counted in net worth), and reminders before points expire.
- **Card comparison:** the effective cashback rate per card.
- **Warnings:** due dates, minimum-only payments, and interest charged on a balance carried over.

**Calendar of what's due:** one view of everything coming up this month and next: card bills, EMIs, chit instalments and auctions, rent to pay or collect, repeating entries, money owed by people. Later phases add SIPs, maturities, insurance renewals and tax dates. It answers "what do I need to pay this month?", with the total and which account it comes from.

Data: `credit_lines`, `card_statements`, `card_rewards`.

## Phase 5: Public launch

The core (ledger, accounts, spending, import, debts and cards) is complete, so FinDB opens to the public here. The remaining phases arrive as updates.

- **An email provider**, and with it:
  - **email verification at sign-up,** after which registration stops revealing whether an email is already in use;
  - **account recovery by an emailed link,** replacing the security question;
  - **reminders** in the app and by push notification (free), with email only for the opted-in weekly summary, to stay within the free email quota. Reminder types grow with each phase: EMIs, card due dates, points expiring, maturities, PPF deposits, insurance renewals, rent, and money owed by people.
- **Rate limits on every write,** counted in a Postgres table so the limits hold across server instances at no extra cost.
- **Data export** (everything, as CSV or JSON) and **account deletion**, completing the data protection rights.
- **The phone app (PWA)**, installable from the browser:
  - **entries offline:** adding entries works without signal, and they sync when the phone is back online;
  - **push notifications** for reminders, in addition to email;
  - **share to FinDB:** share a bank SMS, a receipt photo, a UPI screenshot or a statement file from any app into FinDB, which turns it into an entry for review.
- **Reasons to come back:**
  - a **weekly summary** (spent, received, what's due next week, one insight), in the app and by email, which the user can turn off;
  - a **monthly review** screen at the start of each month;
  - **"Your year in money"** each January and at the end of each financial year: where it went, what grew, the events of the year.
- **Simple mode** for parents and older users, or anyone who wants only the basics: larger text, fewer screens, just accounts, spending and reminders. A family member can set it up for them (with Phase 11 sharing).
- **The first Indian languages:** Hindi and Telugu at launch, then Tamil, Kannada, Marathi and Bengali, based on who signs up. Translations are reviewed by native speakers, especially financial terms.
- **Support:**
  - a help centre with short guides for each feature;
  - a feedback and bug report form in the app;
  - a **grievance officer** with a published contact, as the data protection rules expect, and a response time;
  - a public status page.
- **Privacy-respecting usage analytics:** which screens are used and where people give up during setup, counted without tracking any individual, without third-party trackers, and never including amounts or names.
- **A beta before launch:** 20 to 50 real users (friends, family, colleagues) use FinDB for at least a month before the public launch, through a short feedback loop.
- **An optional donation link** ("Support FinDB"), never required and never unlocking features.
- **Error monitoring** and uptime alerts.
- Updated privacy policy and terms, and a final review of the wording on every "information, not advice" screen.

## Phase 6: Investments

**What can be held**
- **Physical gold:** each piece of jewellery, coin or bar, with its weight and purity (24, 22 or 18 carat), valued at the day's rate for that purity. Each piece also records the vendor, the GST paid, its form (jewellery, bar or coin), where it is kept (home, bank locker), and the invoice in the document vault. Making charges, wastage and GST are part of the cost but not the resale value. Sales and exchanges for new jewellery are recorded. Gold received as a gift or inherited enters at the day's value, with the original owner's cost and date if known. Gold bought as a gift for someone outside the family is an expense, not a holding (see "who a purchase is for" in Phase 1). Each piece records its owner: the user, their spouse, or a child.
- **Digital gold**, **gold ETFs**, and **Sovereign Gold Bonds** (units, issue price, interest, maturity).
- **Stocks**, **mutual funds** (including SIPs and the income distribution option, IDCW) and **ETFs**.
- **Bonds:** government securities, corporate and tax-free bonds. Coupon interest is income, and maturity is tracked.
- **REITs and InvITs:** units and distributions.
- **Crypto.**
- **ESOPs and RSUs:** grants, vesting schedules, and exercise or vesting at fair market value.
  - The value at vesting or exercise is income from salary, taxed as a perquisite.
  - Shares sold to cover tax are recorded.
  - From then on the shares are ordinary holdings, and their cost is the value they were taxed at.

**How holdings are tracked**
- Buys and sells are ledger movements. Each purchase is kept as its own lot, so profit and loss and capital gains (Phase 9) use the right purchase date and cost.
- **Dividends, interest and distributions are income.** A dividend reinvested in the same fund is recorded as a buy.
- **SIPs, daily, weekly or monthly,** for any holding. Each SIP shows the total invested, current value, average price, and instalments made or missed.
- **Allocation chart.** Profit and loss, both realised and unrealised.

**Prices**
- Prices can always be entered by hand, and every price shows its date and source.
- **Live prices (optional):** a scheduled server job fetches prices once a day; the browser never calls price services itself. To keep FinDB free, only free sources are used, each price is fetched once a day and shared by every user who holds that asset, and prices are end-of-day, not real-time.

  | Asset | Planned source | Note |
  |---|---|---|
  | Mutual funds | AMFI's daily NAVs | Official and free |
  | Crypto | CoinGecko public API | Free tier, rate limits, attribution |
  | Gold, gold ETFs, Sovereign Gold Bonds | A published daily gold rate or a paid metals feed | Check the terms before automating |
  | Stocks, ETFs, REITs, InvITs, bonds | A paid data provider, or the user's own broker API (for example Upstox or Zerodha Kite Connect) with their permission | Exchange data needs a licence; no scraping |

- The first release covers mutual funds and crypto; gold and exchange-traded prices follow.

Data: `holdings`, `holding_lots`, `investment_transactions`, `grants` and `vesting_events` (ESOPs and RSUs), `prices`, `price_sources`.

## Phase 7: Property, rentals and physical assets

**Land and property**
- Type (land, flat, house, commercial), location, area, purchase price and date, and costs such as stamp duty, registration and brokerage.
- **Improvement costs** (renovation, extensions) are added to the cost with their dates, because they reduce capital gains on a sale.
- **Building a house (a construction project):**
  - A "House construction" project is linked to the property (the plot, and the house being built on it).
  - Payments to the contractor, for materials, labour, architect and approvals **add to the property's cost**: the money became part of an asset the user owns, so it is not spending. Things that are used up, such as a puja or meals for workers, can still be marked as expenses of the project.
  - The project shows its total cost against the budget, by stage (foundation, structure, finishing, interiors) and by category (cement, steel, labour, electrical, plumbing).
  - It also shows how it was funded: savings, home loan disbursements (Phase 3), gold sold.
  - When construction finishes, the house is complete in the property list, with its full cost recorded for capital gains later.
  - A housewarming afterwards is its own event: its spending is spending, and gifts received are income or assets.
- **Ownership share:** for example 50% owned with a spouse. Net worth counts only the user's share.
- **Current value:**
  - the user's own estimates (a valuation, a circle rate, a recent nearby sale), each with its date and marked as an estimate;
  - optional growth at an assumed rate between estimates.
- **Equity:** a linked home loan shows value minus what is still owed.
- Running costs (property tax, maintenance, repairs, society charges) are expenses tagged to the property.

**Rents**
- Tenants per property: residential or commercial, rent, due day, agreement dates, yearly increase.
- **Rent received is "Rental income."** Late and missed rents are flagged.
- **Security deposits** held are liabilities until returned.
- **Rental yield** for each property, and reminders before agreements end or rent increases.
- Tax deducted by a commercial tenant is recorded as tax paid.

**Vehicles, gadgets and other physical assets**
- Cars, bikes, phones, laptops, cameras, watches, electronics, furniture and equipment, each with a value, a date and an ownership share.
- **How it was acquired:** bought (purchase price), received as a gift, or inherited (value on the day received). For gifts and inheritance, the original owner's cost and purchase date can be recorded too, because Indian tax rules use them if the item is later sold.
- **Depreciation:** reducing balance at a yearly rate (about 15% a year for a car by default, changeable), or straight-line down to a residual value. The value falls monthly, and a real resale quote can override it.
- **Vehicles** also record the registration number, the linked insurance policy, and the next renewal and pollution certificate (PUC) due dates.
- **On sale:** the gain or loss. A linked vehicle loan shows what is still owed.
- Running costs (fuel, servicing, vehicle insurance) are expenses tagged to the asset.

**Valuables and collectibles**
- **Silver ornaments, utensils and coins:** weight and purity, valued at the day's silver rate, like physical gold in Phase 6.
- **Diamonds, gemstones, platinum, luxury watches, art and collectibles:** valued from the user's own estimate or an appraisal, each with its date. These usually hold or gain value, so by default they are not depreciated.
- Gold jewellery received as a gift or inheritance is recorded in Phase 6 with the same "how it was acquired" details.
- Every valuable can be linked to its bill, certificate or appraisal in the document vault (Phase 11), and to an insurance policy (Phase 9).

Data: `properties`, `property_valuations`, `ownership_shares`, `tenants`, `tenancies`, `rent_payments`, `physical_assets` (with how each was acquired), `asset_valuations`, `valuables`.

## Phase 8: Savings, retirement and goals

**Deposits**
- **Recurring deposits:** the maturity date and value are calculated, and instalments are tracked.
- **Fixed deposits:** bank, principal, start and maturity dates, rate, compounding, payout type, linked bank account, auto-renewal, and the expected maturity amount. The FD itself is an investment, never an expense.
  - **payout** FDs pay interest to a bank account as "Interest" income;
  - **cumulative** FDs build interest inside the FD, shown as earned each year;
  - interest **accrued** (earned but not yet paid) and interest **received** are shown separately, because tax applies to interest as it accrues;
  - tax deducted at source is recorded, and premature withdrawals record the reduced rate or penalty;
  - **auto-renewal** starts a new FD on maturity with the then-current rate, linked to the old one.
- A reminder before each maturity.

**Post office and government savings schemes**

The scheme rules are built in. The interest rate is recorded per period, because the government revises these rates quarterly.

| Scheme | What is tracked |
|---|---|
| Public Provident Fund (PPF) | Yearly deposits within the limits, the 15-year term and extensions, yearly interest, when withdrawals and loans become allowed |
| Sukanya Samriddhi Yojana (SSY) | Deposits for a daughter's account, deposit years, maturity, yearly interest |
| National Savings Certificate (NSC) | Interest compounded yearly and paid at maturity |
| Kisan Vikas Patra (KVP) | The date the amount doubles |
| Post Office Monthly Income Scheme (MIS) | Monthly interest paid out |
| Senior Citizens' Savings Scheme (SCSS) | Quarterly interest payouts, maturity, extension |
| Post office recurring and time deposits | As RDs and FDs, with post office terms |

**Retirement**
- **EPF and VPF:** employee and employer contributions, yearly interest, withdrawals and advances.
- **NPS:** Tier I and II; the user's own and the employer's contributions kept apart; units and NAV per scheme.
- Both are assets marked as locked until retirement.

**Pensions**
- **Pension sources:**
  - a government or employer pension;
  - the EPS pension from EPF;
  - an NPS annuity or other annuity;
  - a family pension.
- Each source records the monthly amount, who pays it, any dearness relief or yearly increases, and the bank account it is paid into.
- **Each payment is "Pension" income.** Tax deducted is recorded as tax paid.
- **Commuted pension:** a lump sum taken at retirement in place of part of the monthly pension. It is recorded as a one-off receipt, and the reduced monthly amount follows from it.
- **Reminders:** the yearly life certificate that pensioners must submit to keep the pension coming (for example through Jeevan Pramaan), and a missing month's payment.

**Payslip entry**
- One month's salary split into: net pay to a bank; EPF and VPF; the employer's NPS contribution; the meal card top-up; tax deducted at source and professional tax as taxes paid.
- Gross salary is the income, and the parts are lines of one ledger entry, so it always balances.
- It can repeat, so a typical month is one confirmation.

**Savings pots:** money set aside inside an account for a purpose.

**Goals**
- Short-term and long-term goals (an emergency fund, a dream bike, a car, a vacation, marriage, a house down payment, children's education, being debt-free), funded by any mix of deposits, pots, investments and monthly contributions.
- **Retirement goal:** from today's monthly spending, years to retirement, expected inflation and expected returns, the corpus needed at retirement and the monthly saving that reaches it. The calculation and its assumptions are shown, and are information only.
- **Children's education goal:** the target is adjusted for education costs, which usually rise faster than general inflation (the user sets the rate).
- Each goal shows progress, the monthly amount still needed, whether it's on track, behind or ahead, and what-ifs.

Data: `deposits`, `deposit_instalments`, `schemes`, `scheme_rates`, `retirement_accounts`, `retirement_contributions`, `pension_sources`, `pension_payments`, `payslips`, `payslip_lines`, `pots`, `goals`, `goal_sources`.

## Phase 9: Net worth, insurance and tax

**Net worth**
- Everything owned minus everything owed, at each item's latest value: physical gold at the day's rate, property and joint assets at the user's share, vehicles at their depreciated value, pledged assets marked as pledged.
- Also shown **without the user's own home and locked retirement savings.**
- A monthly snapshot builds a trend chart.
- **Health ratios:** EMI-to-income, debt-to-assets, savings rate, emergency fund coverage.

**Insurance**
- **Life insurance:** insurer, policy number, type (term, endowment, money-back, ULIP, whole life), sum assured, premium and premium due date, start and maturity dates, nominee, riders.
  - Endowment and money-back policies record expected survival and maturity benefits, which arrive as receipts.
  - A ULIP's fund value is tracked like an investment.
- **Health:** floater and members, sum insured, top-ups and their deductible, co-payment, waiting periods (pre-existing illness, specific treatments) with their end dates, renewal, no-claim bonus, claims log, employer cover.
- **Other policies:** vehicle, home, endowment.
- Premiums are expenses. Every policy gets renewal reminders and an adequacy check against rules of thumb, such as life cover against income and dependants (information only).

**Tax centre (India), information only**
- Organised by **financial year and assessment year**. For each year it shows income by head: salary, house property, business or profession, capital gains, and other sources (interest, dividends, gifts).
- **Taxes paid:** tax deducted at source (TDS), tax collected at source (TCS, for example on foreign remittances), advance tax, and self-assessment tax. With them, an estimate of tax payable or refund due, and the refund's status once filed.
- **Tax documents for each year:** Form 16, Form 16A, AIS, TIS, Form 26AS, capital gains statements, bank interest certificates, loan interest certificates, broker statements and donation receipts, kept in the vault. The totals the user enters from them are compared with FinDB's records ("your recorded salary TDS differs from Form 16 by ₹2,400"), without presenting this as professional tax advice.
- **Deductions:**
  - 80C: EPF and VPF, PPF, ELSS, NSC, SSY, life premiums, home loan principal, tuition fees;
  - 80CCD(1B): the user's own NPS;
  - 80CCD(2): the employer's NPS;
  - 80D: health premiums;
  - 80G: donations, with the receipt;
  - 80E: education loan interest;
  - 80TTA and 80TTB: savings and deposit interest;
  - section 24(b): home loan interest.
- **Capital gains:** short-term and long-term gains on shares, equity funds, debt funds, gold, property and other assets.
  - Holding periods and rates are applied per financial year from the purchase lots.
  - Each year's realised gains are summarised.
- **Pension:** a pension from an employer is taxed like salary (with the standard deduction where it applies); a family pension is taxed as other income, with its own deduction. A commuted lump sum may be partly or fully exempt depending on the pension type.
- **Gifts received:** gifts from relatives, on marriage, or by inheritance are generally not taxed. Gifts of money or valuables from others become taxable once their total in a year passes the legal limit. FinDB adds up gifts from non-relatives, using the relationship recorded with each gift, and warns as the total nears the limit.
- **Rent paid,** for house rent allowance (with the landlord's PAN, stored encrypted, when the rules need it).
- **Advance tax:** an estimate of tax due on income other than salary (interest, rent, capital gains, freelance), with reminders for the quarterly due dates.
- **Taxes paid:** tax deducted at source from every source, compared with the totals the user enters from their Annual Information Statement (AIS) or Form 26AS.
- It asks which regime the user follows and shows only what applies. Rules, limits and rates are stored per financial year and updated when the budget changes them, never hard-coded.

**Reports**
- Income against expenses, and cash flow (money in, money out, by month and by financial year).
- Net worth over time, and asset allocation.
- Interest earned (deposits, savings, bonds) against interest paid (loans, cards) per year.
- A tax summary per financial year.
- Each report can be downloaded as CSV or PDF.

Data: `net_worth_snapshots`, `insurance_policies`, `insurance_members`, `insurance_claims`, `tax_profile`, `tax_rules`, `capital_gains` (computed per year), `rent_paid`, `gifts_received` (giver, relationship, occasion, value).

## Phase 10: Financial status review

Once some assets and liabilities are entered, FinDB reviews whether each area is **heading the right way or the wrong way** compared with inflation and the market. Each area gets a status (on track, needs attention, or off track), the numbers behind it, and a plain reason.

| Area | What is compared |
|---|---|
| Returns against inflation | Each asset's yearly return against consumer price inflation, giving the real return (for example, an FD at 7% with inflation at 5% is +2% a year in real terms) |
| Returns against the market | Funds and stocks against a benchmark such as the Nifty 50, gold against the gold price, property against the user's assumption |
| Net worth | Growth over 1, 3 and 5 years, before and after inflation |
| Allocation | Spread across cash, deposits, equity, gold, property and retirement, against a target or an age-based guide. It flags concentration and illiquidity. |
| Liquidity | Money available quickly, in months of spending |
| Debt | EMI-to-income, costly debt, loans larger than the asset behind them, gold loan margin risk |
| Protection | Term cover as a multiple of income, and health cover against family size |
| Rental property | Yield after costs, against an FD |
| Depreciating assets | The share of wealth in things that lose value |
| Savings | The savings rate over time, and whether goals are on track |

- **Market and inflation data** (inflation, benchmark indices, gold, FD and small-savings rates) is stored with dates and sources. It is updated by a scheduled job where a source's terms allow, and editable otherwise.
- **A review page,** refreshed monthly, with a history that shows whether things are improving.
- Every result shows its threshold, which can be adjusted, and is marked as rule-based information, not advice.

Data: `market_data`, `status_reviews`, `allocation_targets`.

## Phase 11: Household and estate

**Household**
- Invite a spouse or family member to see a shared household view (read-only or full), while each person keeps their own private accounts.
- Joint accounts and assets carry each member's share, and the household totals count everything exactly once.

**Nominees and estate summary**
- A nominee for each bank account, deposit, policy, investment, retirement account and property, with gaps flagged ("3 accounts have no nominee").
- An **estate summary:** everything held and owed, where it is, account and policy references (masked unless unlocked), nominees, and contacts.
  - It can be exported as a PDF for the family, protected with two-factor confirmation.
- Optional **trusted contact access:** a named person can request access, which is granted only after a waiting period during which the user can refuse. This needs careful design and a security review before it ships.

- The estate summary links each item to its documents in the vault (Phase 2).

Data: `households`, `household_members`, `nominees`, `access_requests`.

## Phase 12: Multi-currency and global investments

- **Accounts and assets in other currencies,** valued in INR at daily exchange rates, with the original currency kept.
- **US stocks bought from India** under the Liberalised Remittance Scheme:
  - remittances, including the tax collected at source on them;
  - holdings, dividends, and tax withheld abroad;
  - gains in INR.
- Information for the foreign assets schedule (Schedule FA) in the tax return.
- Exchange rates fetched daily, with their dates and sources.

Data: `currencies`, `exchange_rates`, plus currency on every account (present since Phase 1).

## Phase 13: Business and freelance income

- **A separate business book** for freelancers and small businesses:
  - income, expenses and simple invoices;
  - clients who owe money.
- **GST:** GST collected on invoices and paid on purchases, the net payable, and filing due dates.
- **Presumptive taxation** (for example section 44ADA for professionals), as information.
- Business profit flows into personal income and the tax tracker.

Data: `business_books`, `invoices`, `invoice_lines`, `gst_entries`.

## Phase 14: Account Aggregator

- **RBI's Account Aggregator framework:** the regulated, consent-based way for users to share data from their banks, mutual funds, insurers and pension accounts.
- FinDB would become a Financial Information User through a licensed partner. That needs business registration and a compliance review before any build.
- With the user's consent (renewable and revocable at any time), FinDB fetches statements and holdings and imports them through the Phase 2 review screen. Nothing is saved without the user confirming.

## Later, after the phases

- **Native Android and iOS apps,** for home-screen widgets, faster entry and smoother phone use. Only once the web app and PWA work well, and sharing the same API.
- **Voice entry** ("Spent 450 on petrol from HDFC"), in English and the supported Indian languages.

---

## Free for everyone: keeping costs near zero

**Decided 2026-10-03: FinDB is free for everyone,** with no paid plans. Features may be scaled down where they would cost money. The aim is to run on free tiers for as long as possible, and to spend only on what cannot be avoided.

**Why this is allowed on the free tiers**
- Vercel's free Hobby plan is for non-commercial use. A site with no payments, no ads and no affiliate links is non-commercial, and Vercel states that **asking for donations is not commercial use**. So FinDB can stay on Hobby as long as it never charges, sells or advertises.
- Supabase's free plan has no commercial restriction.

**Compromises that keep it free**

| Feature | Free approach | What is given up |
|---|---|---|
| Reminders | Push notifications (Web Push, free) and in-app reminders first; email only for verification, recovery and a weekly summary the user opts into | Reminder emails for every due date |
| Email | A free tier (Brevo: about 300 a day; Resend: about 100 a day) | Large email volumes |
| Document vault | Images compressed in the browser before upload, PDFs up to 2 MB, a small allowance per user (about 20 MB); later, the option to keep documents in the user's own Google Drive | Large files and unlimited storage |
| Receipt reading | Runs in the user's browser (an open-source OCR library), no paid service | Some accuracy compared with paid OCR services |
| Live prices | Free sources only (AMFI, CoinGecko, exchanges' end-of-day files), fetched once a day and shared across users | Real-time and intraday prices |
| Rate limits across instances | A table in Postgres instead of a paid store | Nothing noticeable at this scale |
| Usage analytics | Simple anonymous counters in our own database | Detailed product analytics |
| Error monitoring | Sentry's free tier | Long history and high event volumes |
| Backups | A daily `pg_dump` by a free GitHub Actions job, encrypted, kept in private storage, with a tested restore | Point-in-time recovery |
| Account Aggregator (Phase 14) | Not pursued while FinDB is free: it needs a paid licensed partner and per-fetch fees | Automatic bank data; statement import covers most of it |
| Domain | `findb-app.vercel.app` until a custom domain is worth it | A custom domain (the only small unavoidable cost when wanted: about ₹700 to ₹1,000 a year for a `.in` domain) |

**Keeping the database small** (the free database is 500 MB, the main limit)
- Amounts in `bigint` paise, compact rows, and only the indexes queries need.
- The activity log is the largest table: full old and new values for 24 months, then a compact summary.
- Accounts inactive for 24 months get an email warning and an export link, then are deleted, which the data protection rules favour anyway.
- **Rough capacity:** about 1 MB per active user per year, so the free database holds a few hundred active users for their first year. The beta measures the real figure.

**Optional donations:** a "Support FinDB" link (for example GitHub Sponsors or UPI), never required and never unlocking features. Donations do not make the site commercial under Vercel's rules.

**Never:** paid plans, advertising, selling or sharing data, or commissions on loans, cards, insurance or funds. Export always works.

---

## Infrastructure, hosting and costs

_Prices are as known on 2026-10-03; check the current pricing pages before buying._

**Principles**
- **Managed services until they stop being cheap.** Vercel runs the app and Supabase runs Postgres, so there are no servers to patch, back up or scale by hand. FinDB uses plain SQL through `pg` and standard Next.js, so it can move to self-hosting later without a rewrite.
- **No nginx while on Vercel.** Vercel already does what nginx would: HTTPS, CDN caching, load balancing, and automatic scaling of the app per request. nginx becomes useful only if FinDB moves to its own servers (see Stage 4).
- **Free first.** FinDB is free for everyone, so every stage stays on free tiers as long as the limits allow, and pays only for what usage actually forces. Every stage below is triggered by real numbers, not guesses.

**Stage 1: building (now, no real users)**

| Service | Plan | Cost |
|---|---|---|
| Vercel | Hobby | Free |
| Supabase, production | Free | Free |
| Supabase, tests and previews (new, separate project) | Free | Free |

- **A separate free Supabase project for tests and previews** ends the test-run stalls on the production database. It also replaces the `balancetrack_test` schema with a whole database that cannot reach production data.
- Free Supabase projects pause after a week without activity, have no automatic backups, and allow a 500 MB database, 1 GB of file storage and 5 GB of data transfer a month. A free account can have 2 active projects: production and tests. A scheduled `pg_dump` (a GitHub Actions job, free) keeps a daily, encrypted backup of production for 30 days (in place since 2026-10-03; see `docs/backups.md`).

**Stage 2: public launch (Phase 5), still free**

| Service | Plan | Cost |
|---|---|---|
| Vercel | Hobby (allowed: no payments, ads or affiliate links; donations are fine). About 1,000,000 function calls, 4 hours of active CPU and 100 GB of transfer a month | Free |
| Supabase, production | Free, in a new project in the Mumbai region | Free |
| Supabase, tests | Free (the second free project) | Free |
| Email | Brevo or Resend free tier | Free |
| Error monitoring | Sentry free tier | Free |
| Backups | Daily `pg_dump` through GitHub Actions | Free |
| **Total** | | **₹0** (plus a domain, if wanted) |

- **Done 2026-10-03: production moved to Supabase's Mumbai region (`findb-production-mumbai`) and Vercel functions to `bom1` (Mumbai).** Users are in India: requests are faster, and data stays in India.
- **Real users keep the free project from pausing.** A light scheduled check also keeps it awake during quiet weeks.
- **Watch the limits:** a weekly job reports database size, storage, data transfer and Vercel usage against the free limits, and warns at 70%.

**Stage 3: when a free limit is reached (the first real cost)**
- **The database is almost always the first limit** (500 MB, or the shared CPU). The cheapest options, in order:
  1. Supabase Pro, about $25 a month (roughly ₹2,100): an 8 GB database, daily backups, no pausing. Simplest.
  2. Postgres on Oracle Cloud's Always Free servers: free, but FinDB then patches, backs up and monitors the database itself.
- **If Vercel's free limits are reached:** first make requests cheaper (caching, fewer calls per screen). Then move the app to Cloudflare Workers' free plan, which allows commercial use, or to Vercel Pro (about $20 a month).
- **Expected:** free for the first few hundred active users, then about ₹2,000 to ₹4,000 a month for the first few thousand. Donations may cover this.

**Stage 4: large scale, only if managed costs become high**
- Run the app as a standalone Next.js build in containers on cloud servers (for example AWS, DigitalOcean or Hetzner), behind **nginx** or a cloud load balancer for HTTPS, caching and spreading traffic across several app instances. Keep Postgres managed: Supabase, or another provider such as AWS RDS or Neon.
- This is cheaper per unit of computing, but adds operational work: security updates, monitoring, scaling, and on-call.
- Consider it only when the managed bill is consistently above roughly $500 a month, or when a specific need appears. Oracle Cloud's Always Free servers can host this at no cost for a modest load, at the price of running everything yourself.

---

## Decisions needed before or during the phases

| When | Decision |
|---|---|
| Before Phase 1 | **Decided 2026-10-03:** the default categories as listed in Phase 1. Module mapping from `tracking_option`: "income" turns on Income; "expenses" turns on Expenses and Cards; "both" turns on Income, Expenses and Cards. Other modules start off, and users turn them on. |
| Before Phase 1 | **Decided 2026-10-03:** tests and previews move to a separate free Supabase project (see Infrastructure), so test load never touches the production database |
| Phase 1 | **Decided 2026-10-03:** the key lives in an environment secret, with versioning for rotation; two-factor login is mandatory, with any authenticator app |
| Phase 1 | **Decided 2026-10-03:** repeating entries default to confirm-first (one tap); users can switch any of them to automatic |
| Phase 2 | **Decided 2026-10-03:** HDFC, ICICI, SBI, Axis and Kotak first (accounts and cards), then others on request |
| Phase 5 | The email provider |
| Before Phase 5 | **Decided 2026-10-03:** FinDB is free for everyone, with no paid plans; features are scaled down where they would cost money (see "Free for everyone"). Optional donations only. |
| Phase 5 | The first languages (suggested: Hindi and Telugu), and who reviews the translations |
| Phase 5 | **Decided 2026-10-03:** analytics are simple anonymous counters in FinDB's own database (free) |
| Phase 6 | The free price sources, and whether to offer broker connections |
| Phase 7 | Default depreciation rates, and growth between property estimates |
| Phase 8 | Which schemes ship first, and where scheme rates come from |
| Phase 9 | How tax rules per financial year are kept up to date, and whether capital gains are calculated or only summarised |
| Phase 10 | Sources for inflation, benchmark and rate data, and the default thresholds |
| Phase 2 | Where documents are stored (private Vercel Blob or Supabase Storage) |
| Phase 11 | Whether trusted contact access is built |
| Phase 12 | The exchange rate source |
| Phase 14 | Not pursued while FinDB is free (a paid partner and per-fetch fees). Revisit only if FinDB gets funding. |
