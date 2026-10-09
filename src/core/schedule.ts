/**
 * When a repeating entry falls due (v2 plan, Phase 1: repeating entries). Pure date arithmetic on
 * calendar dates written YYYY-MM-DD, never through a time zone, so the 1st of the month is the 1st
 * wherever the server runs.
 *
 * - daily: every day;
 * - weekly: on a day of the week (0 Sunday to 6 Saturday);
 * - monthly: on a day of the month (1 to 31); in a shorter month, its last day;
 * - yearly: on a month and day; 29 February is 28 February in other years.
 */

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Rule {
    frequency: Frequency;
    /** weekly: 0 (Sunday) to 6 (Saturday) */
    dayOfWeek?: number | null;
    /** monthly and yearly: 1 to 31 */
    dayOfMonth?: number | null;
    /** yearly: 1 to 12 */
    month?: number | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function parts(date: string): [number, number, number] {
    const [y, m, d] = date.split('-').map(Number);
    return [y!, m!, d!];
}

function iso(y: number, m: number, d: number): string {
    return `${y}-${pad(m)}-${pad(d)}`;
}

/** Days in a month (1 to 12) */
export function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A date plus some days */
export function addDays(date: string, days: number): string {
    const [y, m, d] = parts(date);
    const next = new Date(Date.UTC(y, m - 1, d + days));
    return iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** Day of the week, 0 (Sunday) to 6 (Saturday) */
export function dayOfWeek(date: string): number {
    const [y, m, d] = parts(date);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whether a rule is complete and in range; returns the problem, or null */
export function ruleProblem(rule: Rule): string | null {
    const between = (value: unknown, low: number, high: number) => Number.isInteger(value) && (value as number) >= low && (value as number) <= high;
    switch (rule.frequency) {
    case 'daily':
        return null;
    case 'weekly':
        return between(rule.dayOfWeek, 0, 6) ? null : 'Choose the day of the week';
    case 'monthly':
        return between(rule.dayOfMonth, 1, 31) ? null : 'Choose the day of the month (1 to 31)';
    case 'yearly':
        if (!between(rule.month, 1, 12)) return 'Choose the month';
        if (!between(rule.dayOfMonth, 1, 31)) return 'Choose the day of the month (1 to 31)';
        return rule.dayOfMonth! > daysInMonth(2024, rule.month!) ? 'That month does not have that many days' : null;
    default:
        return 'Repeat daily, weekly, monthly or yearly';
    }
}

/** The day a monthly or yearly rule falls on in a given month: its day, or the month's last day */
function dayIn(year: number, month: number, day: number): string {
    return iso(year, month, Math.min(day, daysInMonth(year, month)));
}

/** The first date on or after `from` that the rule falls on */
export function nextOnOrAfter(rule: Rule, from: string): string {
    const [y, m] = parts(from);
    switch (rule.frequency) {
    case 'daily':
        return from;
    case 'weekly':
        return addDays(from, (rule.dayOfWeek! - dayOfWeek(from) + 7) % 7);
    case 'monthly': {
        const thisMonth = dayIn(y, m, rule.dayOfMonth!);
        if (thisMonth >= from) return thisMonth;
        return m === 12 ? dayIn(y + 1, 1, rule.dayOfMonth!) : dayIn(y, m + 1, rule.dayOfMonth!);
    }
    case 'yearly': {
        const thisYear = dayIn(y, rule.month!, rule.dayOfMonth!);
        return thisYear >= from ? thisYear : dayIn(y + 1, rule.month!, rule.dayOfMonth!);
    }
    default:
        throw new Error(`Unknown frequency: ${String(rule.frequency)}`);
    }
}

/** The occurrence after one that has happened */
export function nextAfter(rule: Rule, date: string): string {
    return nextOnOrAfter(rule, addDays(date, 1));
}

/**
 * Every occurrence from `first` up to and including `until`, at most `limit` of them (a repeating
 * entry left alone for a long time catches up, but not without bound); stops at `endsOn`.
 */
export function occurrences(rule: Rule, first: string, until: string, endsOn: string | null, limit = 62): string[] {
    const dates: string[] = [];
    let date = first;
    while (date <= until && (endsOn === null || date <= endsOn) && dates.length < limit) {
        dates.push(date);
        date = nextAfter(rule, date);
    }
    return dates;
}
