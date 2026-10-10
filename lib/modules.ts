/**
 * What a user chooses to track (v2 plan, Phase 1: module switches). Accounts, transactions and net
 * worth are always on; each module adds screens and reminders and can be turned off at any time,
 * keeping its data. Presets give a quick start at sign-up. Plain data, shared by the server and
 * the screens.
 *
 * This replaces the former income / expenses / both choice (users.tracking_option), which is kept
 * in step with the modules (trackingFromModules) so everything that still reads it keeps working.
 */

import { t } from './i18n';

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

// Names and lines are in messages/en.ts (modules.*)
const AVAILABLE: Record<ModuleKey, boolean> = {
    income: true, spending: true, credit_cards: true, debts: false, investments: false, property: false,
    savings: false, insurance: false, goals: false, tax: false, household: false,
};

export const MODULES: readonly ModuleInfo[] = (Object.keys(AVAILABLE) as ModuleKey[]).map(key => ({
    key, name: t(`modules.${key}.name`), line: t(`modules.${key}.line`), available: AVAILABLE[key],
}));

export const MODULE_KEYS = MODULES.map(module => module.key);

const preset = (key: 'spending' | 'savings' | 'everything', modules: ModuleKey[]) => ({
    key, name: t(`modules.presets.${key}.name`), line: t(`modules.presets.${key}.line`), modules,
});
export const PRESETS: ReadonlyArray<{ key: string; name: string; line: string; modules: ModuleKey[] }> = [
    preset('spending', ['spending', 'credit_cards']),
    preset('savings', ['income', 'spending', 'credit_cards', 'savings']),
    preset('everything', [...MODULE_KEYS]),
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
    if (!Array.isArray(modules) || modules.some(module => !MODULE_KEYS.includes(module as ModuleKey))) return t('modules.problem.unknown');
    if (!modules.includes('income') && !modules.includes('spending')) return t('modules.problem.needOne');
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
