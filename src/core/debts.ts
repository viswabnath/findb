/**
 * Which debt is most dangerous (v2 plan, Phase 3): every debt ranked by its true yearly cost, a
 * payoff simulator comparing highest-rate-first with smallest-balance-first, and the warnings.
 * Rule-based calculations on the user's own figures, never advice; the thresholds are named here
 * and shown on the screen. Amounts are whole paise; rates are % a year.
 */

export type DebtKind = 'credit_card' | 'personal' | 'consumer' | 'gold' | 'vehicle' | 'home' | 'education' | 'business' | 'secured' | 'person' | 'chit' | 'other';

export interface Debt {
    key: string;
    name: string;
    kind: DebtKind;
    balance: number;
    /** The true yearly cost, % */
    yearlyRate: number;
    /** What is paid on it each month now */
    monthly: number;
    /** The rate is a typical one, not the user's (a card's, until Phase 4 records it) */
    assumedRate?: boolean;
}

/** EMIs above this share of income are a warning... */
export const EMI_RATIO_HIGH = 40;
/** ...and above this, a danger */
export const EMI_RATIO_DANGER = 50;
/** The yearly rate counted as dangerous debt */
export const DANGEROUS_RATE = 24;
/** A card's interest on a balance carried over, when its own is not known: ₹3.50 per ₹100 a month... */
export const TYPICAL_CARD_MONTHLY = 3.5;
/** ...which, charged on the interest too, is about 51% a year */
export const TYPICAL_CARD_RATE = Math.round(((1 + TYPICAL_CARD_MONTHLY / 100) ** 12 - 1) * 10000) / 100;

/** The monthly rate that compounds to a true yearly rate */
const monthlyRate = (yearlyRate: number) => (1 + yearlyRate / 100) ** (1 / 12) - 1;

/** Most expensive first; at the same rate, the bigger balance first */
export function rankDebts(debts: Debt[]): Debt[] {
    return [...debts].filter(debt => debt.balance > 0).sort((a, b) => b.yearlyRate - a.yearlyRate || b.balance - a.balance);
}

export type PayoffOrder = 'highest_rate' | 'smallest_balance';

export interface PayoffPlan {
    order: string[];
    months: number;
    totalInterest: number;
    closedIn: Record<string, number>;
    /** False when the payments never clear the debt (they do not cover the interest) */
    clears: boolean;
}

const MAX_MONTHS = 600;

/**
 * Pay every debt's monthly amount, and put `extra` (and the payments of debts already cleared) on
 * one debt at a time: the highest rate first (the "avalanche", least interest) or the smallest
 * balance first (the "snowball", quickest wins). Interest is charged monthly on what is left, at
 * the monthly rate that compounds to the debt's true yearly rate.
 */
export function simulatePayoff(debts: Debt[], extra: number, order: PayoffOrder): PayoffPlan {
    const list = rankDebts(debts);
    if (order === 'smallest_balance') list.sort((a, b) => a.balance - b.balance || b.yearlyRate - a.yearlyRate);
    const balances = new Map(list.map(debt => [debt.key, debt.balance]));
    const closedIn: Record<string, number> = {};
    let totalInterest = 0;
    let month = 0;
    while ([...balances.values()].some(balance => balance > 0) && month < MAX_MONTHS) {
        month++;
        let pool = extra;
        for (const debt of list) {
            const balance = balances.get(debt.key)!;
            if (balance <= 0) {
                pool += debt.monthly;
                continue;
            }
            const interest = Math.round(balance * monthlyRate(debt.yearlyRate));
            totalInterest += interest;
            const after = balance + interest - debt.monthly;
            if (after < 0) pool += -after;
            balances.set(debt.key, Math.max(after, 0));
        }
        for (const debt of list) {
            const balance = balances.get(debt.key)!;
            if (balance <= 0 || pool <= 0) continue;
            const paid = Math.min(balance, pool);
            balances.set(debt.key, balance - paid);
            pool -= paid;
        }
        for (const debt of list) if (balances.get(debt.key)! <= 0 && closedIn[debt.key] === undefined) closedIn[debt.key] = month;
    }
    return { order: list.map(debt => debt.key), months: month, totalInterest, closedIn, clears: [...balances.values()].every(balance => balance <= 0) };
}

/** EMIs as a share of monthly income, %; null without income */
export function emiRatio(monthlyEmis: number, monthlyIncome: number): number | null {
    if (monthlyIncome <= 0) return null;
    return Math.round((monthlyEmis * 1000) / monthlyIncome) / 10;
}

/** A card's minimum due: this share of the balance, %... */
export const MINIMUM_DUE_PERCENT = 5;
/** ...and at least this, in paise (₹200), or the whole balance when it is less */
export const MINIMUM_DUE_FLOOR = 20_000;

/**
 * Paying only the minimum due each month on a card balance, with no new spending: how long it
 * takes and the interest paid. The minimum falls as the balance falls, which is why it takes so long.
 */
export function minimumOnly(balance: number, yearlyRate: number): { months: number; totalInterest: number; firstMinimum: number } {
    const minimumOf = (owed: number) => Math.min(owed, Math.max(Math.round((owed * MINIMUM_DUE_PERCENT) / 100), MINIMUM_DUE_FLOOR));
    let owed = balance;
    let months = 0;
    let totalInterest = 0;
    while (owed > 0 && months < MAX_MONTHS) {
        months++;
        const payment = minimumOf(owed);
        owed -= payment;
        const interest = Math.round(owed * monthlyRate(yearlyRate));
        totalInterest += interest;
        owed += interest;
    }
    return { months, totalInterest, firstMinimum: balance > 0 ? minimumOf(balance) : 0 };
}
