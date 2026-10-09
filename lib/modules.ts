/**
 * What a user chooses to track (v2 plan, Phase 1: module switches). Accounts, transactions and net
 * worth are always on; each module adds screens and reminders and can be turned off at any time,
 * keeping its data. Presets give a quick start at sign-up. Plain data, shared by the server and
 * the screens.
 *
 * This replaces the former income / expenses / both choice (users.tracking_option), which is kept
 * in step with the modules (trackingFromModules) so everything that still reads it keeps working.
 */

export type ModuleKey =
    | 'income' | 'spending' | 'credit_cards' | 'debts' | 'investments' | 'property'
    | 'savings' | 'insurance' | 'goals' | 'tax' | 'household';

export interface ModuleInfo {
    key: ModuleKey;
    name: string;
    /** One plain line: what turning it on gives */
    line: string;
    /** Available now; the others are coming in later phases and can be chosen ahead */
    available: boolean;
}

export const MODULES: readonly ModuleInfo[] = [
    { key: 'income', name: 'Income', line: 'What comes in: salary, freelance, rent, interest.', available: true },
    { key: 'spending', name: 'Spending and budgets', line: 'Where the money goes, by category, with events and repeating bills.', available: true },
    { key: 'credit_cards', name: 'Credit cards', line: 'Limits, what is used, and paying the bill without counting it twice.', available: true },
    { key: 'debts', name: 'Debts and people', line: 'Loans and EMIs, and money lent to or borrowed from people.', available: false },
    { key: 'investments', name: 'Investments and gold', line: 'Mutual funds, shares, gold and what they are worth.', available: false },
    { key: 'property', name: 'Property and other assets', line: 'A home, land, a vehicle and other things you own.', available: false },
    { key: 'savings', name: 'Savings and retirement', line: 'Fixed deposits, post office schemes, EPF, PPF and NPS.', available: false },
    { key: 'insurance', name: 'Insurance', line: 'Policies, premiums and whether the cover is enough.', available: false },
    { key: 'goals', name: 'Goals', line: 'Saving for a home, a child\'s education or retirement.', available: false },
    { key: 'tax', name: 'Tax', line: 'What counts for income tax, deductions and reminders.', available: false },
    { key: 'household', name: 'Household', line: 'Sharing with family, and what happens to it all later.', available: false },
];

export const MODULE_KEYS = MODULES.map(module => module.key);

export const PRESETS: ReadonlyArray<{ key: string; name: string; line: string; modules: ModuleKey[] }> = [
    { key: 'spending', name: 'Just my spending', line: 'Where the money goes, with cards and cash.', modules: ['spending', 'credit_cards'] },
    {
        key: 'savings', name: 'My spending and savings', line: 'What comes in, what goes out, and what you save.',
        modules: ['income', 'spending', 'credit_cards', 'savings'],
    },
    { key: 'everything', name: 'Everything', line: 'Every part of your money in one place.', modules: [...MODULE_KEYS] },
];

/** The modules a former income / expenses / both choice means */
export function modulesFromTracking(option: string | null | undefined): ModuleKey[] {
    if (option === 'income') return ['income'];
    if (option === 'expenses') return ['spending', 'credit_cards'];
    return ['income', 'spending', 'credit_cards'];
}

/** The former choice the modules amount to, for code that still reads it */
export function trackingFromModules(modules: readonly string[]): 'income' | 'expenses' | 'both' {
    const income = modules.includes('income');
    const spending = modules.includes('spending');
    if (income && !spending) return 'income';
    if (spending && !income) return 'expenses';
    return 'both';
}

/** Whether a set of modules is acceptable; returns the problem, or null */
export function modulesProblem(modules: unknown): string | null {
    if (!Array.isArray(modules) || modules.some(module => !MODULE_KEYS.includes(module as ModuleKey))) return 'Choose from the listed modules';
    if (!modules.includes('income') && !modules.includes('spending')) return 'Keep income or spending on: FinDB needs at least one to show your month';
    return null;
}

/**
 * Words in an entry's title that suggest a module that is switched off, so FinDB can offer once to
 * turn it on ("Home loan EMI" suggests Debts and people). Whole words only.
 */
const SUGGESTIONS: ReadonlyArray<{ key: ModuleKey; words: string[] }> = [
    { key: 'debts', words: ['emi', 'loan', 'borrowed', 'lent', 'repay', 'repayment'] },
    { key: 'investments', words: ['sip', 'mutual', 'shares', 'stocks', 'zerodha', 'groww', 'demat', 'nifty', 'etf'] },
    { key: 'insurance', words: ['insurance', 'premium', 'lic', 'policy'] },
    { key: 'savings', words: ['ppf', 'nps', 'epf', 'fd', 'rd', 'deposit', 'sukanya'] },
    { key: 'tax', words: ['tax', 'tds', 'itr', 'gst'] },
    { key: 'property', words: ['plot', 'flat', 'registration', 'stamp'] },
    { key: 'credit_cards', words: ['credit', 'card'] },
];

/** The first switched-off module a title suggests, unless the user already declined it */
export function suggestModule(title: string, on: readonly string[], declined: readonly string[]): ModuleInfo | null {
    const words = new Set(title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
    for (const { key, words: keywords } of SUGGESTIONS) {
        if (on.includes(key) || declined.includes(key)) continue;
        if (keywords.some(word => words.has(word))) return MODULES.find(module => module.key === key) ?? null;
    }
    return null;
}
