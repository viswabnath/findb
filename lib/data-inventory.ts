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
        holds: 'Name, username, email, what you track; password and security answer as one-way hashes; the two-step login key, encrypted',
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
