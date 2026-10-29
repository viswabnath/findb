/**
 * Every table FinDB keeps, what personal data it holds, why, and for how long (docs/privacy.md).
 * Export and erasure (v2 Phase 5) are built on this list, and Settings shows it to the user.
 * tests/isolation.test.js checks that it names exactly the tables in the database, so a new
 * table cannot be added without deciding what it holds.
 */

export type DataCategory = 'account' | 'security' | 'money' | 'history' | 'consent' | 'system';

export interface TableRecord {
    table: string;
    category: DataCategory;
    /** What it holds, in plain words */
    holds: string;
    purpose: string;
    retention: string;
    /** Included in the user's data export (Phase 5) */
    exported: boolean;
}

export const DATA_INVENTORY: readonly TableRecord[] = [
    {
        table: 'users', category: 'account', exported: true,
        holds: 'Name, username, email, what you track (and module suggestions you declined); password and security answer as one-way hashes; the two-step login key, encrypted',
        purpose: 'Your account and logging in', retention: 'Until you delete your account',
    },
    {
        table: 'profiles', category: 'account', exported: true,
        holds: 'Date of birth, city, tax residency; PAN and demat account IDs, encrypted; the last four digits of Aadhaar at most',
        purpose: 'Age-based rules, tax and the financial review', retention: 'Until you delete it or your account',
    },
    {
        table: 'dependants', category: 'account', exported: true,
        holds: 'Your spouse, children and parents: name, relationship and date of birth',
        purpose: 'Insurance, goals and the household view', retention: 'Until you delete them or your account',
    },
    {
        table: 'banks', category: 'money', exported: true,
        holds: 'Bank account names and balances you enter', purpose: 'Showing your money', retention: 'Until you delete it or your account',
    },
    {
        table: 'credit_cards', category: 'money', exported: true,
        holds: 'Card names, limits and amounts used', purpose: 'Showing your money', retention: 'Until you delete it or your account',
    },
    {
        table: 'cash_balance', category: 'money', exported: true,
        holds: 'Your cash in hand', purpose: 'Showing your money', retention: 'Until you delete your account',
    },
    {
        table: 'income_entries', category: 'money', exported: true,
        holds: 'Income you record: source, amount, date, account', purpose: 'Showing your money', retention: 'Until you delete it or your account',
    },
    {
        table: 'expenses', category: 'money', exported: true,
        holds: 'Spending you record: title, amount, date, how paid', purpose: 'Showing your money', retention: 'Until you delete it or your account',
    },
    {
        table: 'ledger_accounts', category: 'money', exported: true,
        holds: 'The ledger\'s accounts, mirroring your banks, cards and cash', purpose: 'Exact balances (docs/ledger.md)',
        retention: 'Until you delete your account; removed accounts are kept archived as history',
    },
    {
        table: 'journal_entries', category: 'money', exported: true,
        holds: 'One record per money event, with its date and description', purpose: 'Exact balances and history',
        retention: 'Until you delete your account; edited and deleted entries are kept voided as history',
    },
    {
        table: 'journal_lines', category: 'money', exported: true,
        holds: 'The amounts each ledger record moves', purpose: 'Exact balances', retention: 'With their entry',
    },
    {
        table: 'events', category: 'money', exported: true,
        holds: 'Your events and projects: name, dates, budget and notes', purpose: 'Showing what each purpose cost you',
        retention: 'Until you delete it or your account',
    },
    {
        table: 'recurring_entries', category: 'money', exported: true,
        holds: 'Entries that repeat (salary, rent, EMIs, subscriptions): amount, account, category and when they fall due',
        purpose: 'Adding or reminding you of regular entries', retention: 'Until you delete it or your account',
    },
    {
        table: 'reimbursements', category: 'money', exported: true,
        holds: 'Expenses someone will pay you back for: what, how much, from whom, and what has come back',
        purpose: 'Keeping money owed to you out of your spending', retention: 'Until you delete your account',
    },
    {
        table: 'reconciliations', category: 'money', exported: true,
        holds: 'Statement balances you checked an account against, and when', purpose: 'Making sure FinDB matches your bank',
        retention: 'Until you delete your account',
    },
    {
        table: 'tags', category: 'money', exported: true,
        holds: 'The tags you put on entries', purpose: 'Grouping your entries your way', retention: 'Until you delete your account',
    },
    {
        table: 'entry_tags', category: 'money', exported: true,
        holds: 'Which tags are on which entry', purpose: 'Grouping your entries your way', retention: 'With the entry or the tag',
    },
    {
        table: 'people', category: 'money', exported: true,
        holds: 'Names of people you lend to, borrow from or share costs with, and your notes on them',
        purpose: 'Keeping track of money with people', retention: 'Until you remove them or delete your account',
    },
    {
        table: 'person_loans', category: 'money', exported: true,
        holds: 'Money you lent to or borrowed from a person: amount, dates, interest rate and notes',
        purpose: 'Knowing who owes what, and when', retention: 'Until you delete your account; removed ones are kept as history',
    },
    {
        table: 'loans', category: 'money', exported: true,
        holds: 'Your loans: lender, amount, rate, tenure, EMI, fees and charges', purpose: 'Knowing what you owe and what it costs',
        retention: 'Until you delete your account; removed ones are kept as history',
    },
    {
        table: 'loan_rate_changes', category: 'money', exported: true,
        holds: 'Changes to a floating loan rate and when they started', purpose: 'Keeping the repayment schedule right', retention: 'With the loan',
    },
    {
        table: 'loan_payments', category: 'money', exported: true,
        holds: 'EMIs, part payments, top-ups and fees on your loans, split into principal, interest and charges',
        purpose: 'What you repaid and the interest you paid each year', retention: 'Until you delete your account; removed ones are kept as history',
    },
    {
        table: 'chit_funds', category: 'money', exported: true,
        holds: 'Your chits: name, organiser and registration, value, members, months, contribution and commission',
        purpose: 'Tracking what to pay and what a chit earns or costs', retention: 'Until you delete your account; removed ones are kept as history',
    },
    {
        table: 'chit_instalments', category: 'money', exported: true,
        holds: 'Each month\'s payment into a chit and its dividend', purpose: 'Tracking a chit', retention: 'With the chit',
    },
    {
        table: 'chit_auctions', category: 'money', exported: true,
        holds: 'Each month\'s auction: the winning bid, and whether you won with what deductions', purpose: 'Working out dividends and the prize', retention: 'With the chit',
    },
    {
        table: 'card_statements', category: 'money', exported: true,
        holds: 'Your card statements: the statement and due dates, the amount and minimum due, and interest and fees charged',
        purpose: 'Reminding you before a card bill is due and showing what carrying a balance costs', retention: 'Until you delete your account; removed ones are kept as history',
    },
    {
        table: 'credit_lines', category: 'money', exported: true,
        holds: 'Limits shared by several of your cards: a name and the limit', purpose: 'Showing what is left to spend across cards that share a limit',
        retention: 'Until you delete your account; removed ones are kept as history',
    },
    {
        table: 'card_rewards', category: 'money', exported: true,
        holds: 'Reward points earned, redeemed and expired on your cards, with expiry dates, and cashback',
        purpose: 'Showing points left and expiring, cashback per card and year, and which card gives back most',
        retention: 'Until you delete your account; removed ones are kept as history',
    },
    {
        table: 'pledges', category: 'money', exported: true,
        holds: 'What you pledged for a loan (gold, a deposit, a policy, shares or property): its description and value; for gold, its weight, purity and the rate used',
        purpose: 'Showing what is pledged, and warning before a gold loan\'s margin call', retention: 'With the loan',
    },
    {
        table: 'groups', category: 'money', exported: true,
        holds: 'Your groups (trips, flats) and the event they count towards', purpose: 'Sharing costs', retention: 'Until you remove them or delete your account',
    },
    {
        table: 'group_members', category: 'money', exported: true,
        holds: 'Which people are in which group', purpose: 'Sharing costs', retention: 'With the group',
    },
    {
        table: 'shared_expenses', category: 'money', exported: true,
        holds: 'Costs shared in a group: what, when, how much, who paid and how it was split', purpose: 'Working out who owes whom',
        retention: 'Until you delete your account; removed ones are kept as history',
    },
    {
        table: 'shared_expense_shares', category: 'money', exported: true,
        holds: 'Each person\'s share of a shared cost', purpose: 'Working out who owes whom', retention: 'With the cost',
    },
    {
        table: 'settlements', category: 'money', exported: true,
        holds: 'Payments that settle up a group: who paid whom, how much and when', purpose: 'Working out who owes whom',
        retention: 'Until you delete your account; removed ones are kept as history',
    },
    {
        table: 'documents', category: 'money', exported: true,
        holds: 'Documents you upload (receipts, statements, policies, papers): their name, type, dates and size; the files themselves are encrypted and kept in private storage',
        purpose: 'Keeping the evidence for your money in one place', retention: 'Until you delete them or your account',
    },
    {
        table: 'document_links', category: 'money', exported: true,
        holds: 'Which document belongs to which entry, account or event', purpose: 'Finding the evidence for an entry', retention: 'With the document',
    },
    {
        table: 'budgets', category: 'money', exported: true,
        holds: 'Monthly limits you set for spending categories', purpose: 'Warning you at 80% and 100% of a limit',
        retention: 'Until you delete them or your account',
    },
    {
        table: 'saved_searches', category: 'money', exported: true,
        holds: 'Searches you saved: their names and filters (words, dates, amounts, accounts, categories, tags, events)',
        purpose: 'Running your usual searches in one tap', retention: 'Until you delete them or your account',
    },
    {
        table: 'import_profiles', category: 'money', exported: true,
        holds: 'The column names of statement layouts you imported, and which column holds what (never the statements themselves)',
        purpose: 'Importing the same bank\'s next statement without choosing columns again', retention: 'Until you delete your account',
    },
    {
        table: 'import_batches', category: 'money', exported: true,
        holds: 'Each statement import: the account, the dates it covered, how many entries it added and the closing balance',
        purpose: 'Showing and undoing your imports', retention: 'Until you delete your account',
    },
    {
        table: 'activity_log', category: 'history', exported: true,
        holds: 'Each change you make, with old and new values; failed recovery attempts', purpose: 'Your own history, and spotting misuse',
        retention: 'Until you delete your account',
    },
    {
        table: 'login_events', category: 'security', exported: true,
        holds: 'Logins, wrong passwords and codes, and security changes, with the browser and device type (no IP address)',
        purpose: 'Spotting misuse of your account', retention: 'One year',
    },
    {
        table: 'session', category: 'security', exported: false,
        holds: 'Signed-in devices: browser and device type, when signed in and last used', purpose: 'Keeping you logged in',
        retention: 'Two hours after the last login on that device, or until you sign it out',
    },
    {
        table: 'recovery_codes', category: 'security', exported: false,
        holds: 'One-time recovery codes, as one-way hashes', purpose: 'Logging in without your phone',
        retention: 'Until used or replaced',
    },
    {
        table: 'consents', category: 'consent', exported: true,
        holds: 'When you agreed to which version of the privacy notice, and any withdrawal', purpose: 'Proof of consent, as the law requires',
        retention: 'Until you delete your account',
    },
    {
        table: 'schema_migrations', category: 'system', exported: false,
        holds: 'No personal data: which database changes have run', purpose: 'Running FinDB', retention: 'Always',
    },
];
