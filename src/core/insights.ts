/**
 * Spending insights (v2 plan, Phase 2): rule-based calculations on the user's own entries, never
 * advice. Every threshold is a named constant here, and the screen shows the ones it used.
 *
 * - categoryInsights: each category's spending this month, last month, and its average over the
 *   last 3, 6 and 12 complete months (only months since the user's first entry count), with the
 *   change from the 3 months before, and an unusual-spend flag;
 * - findSubscriptions: repeating charges of a similar amount at a steady rhythm (weekly, monthly,
 *   quarterly, yearly), with their monthly and yearly cost, new ones, price rises and stopped ones.
 *
 * Months are written YYYY-MM and amounts are whole paise.
 */

/** Unusual spend: this month at least twice the 3-month average... */
export const UNUSUAL_RATIO = 2;
/** ...and at least ₹1,000 above it, so small categories do not raise alarms */
export const UNUSUAL_MINIMUM_PAISE = 100_000;
/** Months of history an average needs before it is shown */
export const MIN_HISTORY_MONTHS = 2;

export interface MonthTotal { month: string; categoryId: number; paise: number }

/** The month n months before (negative) or after a month */
export function shiftMonth(month: string, n: number): string {
    const [y, m] = month.split('-').map(Number);
    const index = y! * 12 + (m! - 1) + n;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The months from `from` to `to`, both included, oldest first */
export function monthsBetween(from: string, to: string): string[] {
    const months: string[] = [];
    for (let month = from; month <= to; month = shiftMonth(month, 1)) months.push(month);
    return months;
}

export interface CategoryInsight {
    categoryId: number;
    thisMonth: number;
    lastMonth: number;
    /** Per month over the last 3, 6 and 12 complete months; null without enough history */
    average3: number | null;
    average6: number | null;
    average12: number | null;
    /** The last 3 months' average against the 3 months before, as a percentage; null when either is missing or zero */
    change3: number | null;
    /** This month at least UNUSUAL_RATIO times the 3-month average and UNUSUAL_MINIMUM_PAISE above it */
    unusual: boolean;
}

/**
 * Per category: `month` is the month being looked at; complete months are the ones before it.
 * `firstMonth` is the month of the user's first entry: averages count only months since then.
 */
export function categoryInsights(totals: MonthTotal[], month: string, firstMonth: string): CategoryInsight[] {
    const byCategory = new Map<number, Map<string, number>>();
    for (const total of totals) {
        const months = byCategory.get(total.categoryId) ?? new Map<string, number>();
        months.set(total.month, (months.get(total.month) ?? 0) + total.paise);
        byCategory.set(total.categoryId, months);
    }
    const average = (months: Map<string, number>, last: string, count: number): number | null => {
        // Only months since the first entry count: the 3-month average needs MIN_HISTORY_MONTHS of
        // them, the 6- and 12-month ones their whole span (or they would repeat the shorter one)
        const window = monthsBetween(shiftMonth(last, -(count - 1)), last).filter(item => item >= firstMonth);
        if (window.length < (count === 3 ? MIN_HISTORY_MONTHS : count)) return null;
        return Math.round(window.reduce((sum, item) => sum + (months.get(item) ?? 0), 0) / window.length);
    };
    const previous = shiftMonth(month, -1);
    return [...byCategory.entries()].map(([categoryId, months]) => {
        const thisMonth = months.get(month) ?? 0;
        const average3 = average(months, previous, 3);
        const before3 = average(months, shiftMonth(previous, -3), 3);
        const unusual = average3 !== null && thisMonth >= UNUSUAL_RATIO * average3 && thisMonth - average3 >= UNUSUAL_MINIMUM_PAISE;
        return {
            categoryId, thisMonth, lastMonth: months.get(previous) ?? 0,
            average3, average6: average(months, previous, 6), average12: average(months, previous, 12),
            change3: average3 !== null && before3 ? Math.round(((average3 - before3) / before3) * 100) : null,
            unusual,
        };
    }).sort((a, b) => b.thisMonth - a.thisMonth || (b.average3 ?? 0) - (a.average3 ?? 0));
}

// ----- Subscriptions -----

export interface Charge { date: string; description: string; paise: number; categoryId: number | null; accountId: number }

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/** Each rhythm: its usual gap in days, the gaps that count as it, and how many charges show it */
const CADENCES: Record<Cadence, { days: number; min: number; max: number; charges: number }> = {
    weekly: { days: 7, min: 5, max: 9, charges: 3 },
    monthly: { days: 30.44, min: 26, max: 35, charges: 3 },
    quarterly: { days: 91.31, min: 84, max: 98, charges: 2 },
    yearly: { days: 365.25, min: 350, max: 380, charges: 2 },
};
/** Charges of one subscription stay within this ratio of each other (prices do change) */
const SIMILAR_AMOUNTS = 1.5;
/** A charge this much above the one before is a price rise */
const PRICE_RISE = 1.02;
/** Not charged for this many of its gaps: stopped */
const STOPPED_AFTER = 1.6;

export interface Subscription {
    key: string;
    /** The latest charge's description */
    description: string;
    cadence: Cadence;
    charges: number;
    first: string;
    last: string;
    lastPaise: number;
    monthlyPaise: number;
    yearlyPaise: number;
    categoryId: number | null;
    accountId: number;
    status: 'active' | 'new' | 'stopped';
    /** The charge before the latest, when the latest is higher */
    priceRiseFrom: number | null;
}

/** What groups charges of one subscription: the first three words, without numbers or punctuation */
export function merchantKey(description: string): string {
    return description.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(word => word.length > 1).slice(0, 3).join(' ');
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Repeating charges in a list of expenses, as of `today` (YYYY-MM-DD); the most expensive first */
export function findSubscriptions(charges: Charge[], today: string): Subscription[] {
    const groups = new Map<string, Charge[]>();
    for (const charge of charges) {
        const key = merchantKey(charge.description);
        if (!key || charge.paise <= 0) continue;
        groups.set(key, [...(groups.get(key) ?? []), charge]);
    }
    const found: Subscription[] = [];
    for (const [key, group] of groups) {
        // One charge a day at most: two on the same day are not a rhythm
        const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date)).filter((charge, index, list) => index === 0 || charge.date !== list[index - 1]!.date);
        if (sorted.length < 2) continue;
        const gaps = sorted.slice(1).map((charge, index) => dayNumber(charge.date) - dayNumber(sorted[index]!.date));
        const gap = median(gaps);
        const cadence = (Object.keys(CADENCES) as Cadence[]).find(name => gap >= CADENCES[name].min && gap <= CADENCES[name].max);
        if (!cadence || sorted.length < CADENCES[cadence].charges) continue;
        // Most gaps must fit the rhythm, not only the middle one
        const fitting = gaps.filter(value => value >= CADENCES[cadence].min * 0.8 && value <= CADENCES[cadence].max * 1.2).length;
        if (fitting < Math.ceil(gaps.length * 0.7)) continue;
        const amounts = sorted.map(charge => charge.paise);
        if (Math.max(...amounts) > Math.min(...amounts) * SIMILAR_AMOUNTS) continue;

        const last = sorted[sorted.length - 1]!;
        const before = sorted[sorted.length - 2]!;
        const { days } = CADENCES[cadence];
        const monthlyPaise = Math.round(last.paise * (30.44 / days));
        const sinceLast = dayNumber(today) - dayNumber(last.date);
        const sinceFirst = dayNumber(today) - dayNumber(sorted[0]!.date);
        const status = sinceLast > days * STOPPED_AFTER ? 'stopped' : sinceFirst <= days * (CADENCES[cadence].charges + 0.5) ? 'new' : 'active';
        found.push({
            key, description: last.description, cadence, charges: sorted.length, first: sorted[0]!.date, last: last.date,
            lastPaise: last.paise, monthlyPaise, yearlyPaise: monthlyPaise * 12, categoryId: last.categoryId, accountId: last.accountId,
            status, priceRiseFrom: last.paise > before.paise * PRICE_RISE ? before.paise : null,
        });
    }
    return found.sort((a, b) => (a.status === 'stopped' ? 1 : 0) - (b.status === 'stopped' ? 1 : 0) || b.monthlyPaise - a.monthlyPaise);
}
