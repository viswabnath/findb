/**
 * Credit card statements (v2 plan, Phase 4): when each statement is made and due from the card's
 * billing and due days, what a statement's status is from the payments made against it, and the
 * minimum due when the bank's is not entered. Dates are YYYY-MM-DD; amounts are whole paise.
 */

import { MINIMUM_DUE_FLOOR, MINIMUM_DUE_PERCENT } from './debts';

/** A statement due within this many days is a reminder */
export const DUE_SOON_DAYS = 5;

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The date in a month (1-12, may run past 12 or below 1) on a day, kept to the month's length */
function onDay(year: number, month: number, day: number): string {
    const index = year * 12 + (month - 1);
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    return `${y}-${pad(m)}-${pad(Math.min(day, daysIn(y, m)))}`;
}

/** The latest statement date on or before `today`, and the one before it */
export function statementDates(billingDay: number, today: string): { current: string; previous: string } {
    const [year, month] = today.split('-').map(Number) as [number, number];
    const thisMonth = onDay(year, month, billingDay);
    const current = thisMonth <= today ? thisMonth : onDay(year, month - 1, billingDay);
    const [cy, cm] = current.split('-').map(Number) as [number, number];
    return { current, previous: onDay(cy, cm - 1, billingDay) };
}

/** The due date of a statement: the first `dueDay` after the statement date */
export function dueDateFor(statementDate: string, dueDay: number): string {
    const [year, month] = statementDate.split('-').map(Number) as [number, number];
    const thisMonth = onDay(year, month, dueDay);
    return thisMonth > statementDate ? thisMonth : onDay(year, month + 1, dueDay);
}

/** The bank's usual minimum due: 5% of the amount, at least ₹200, never more than the amount */
export function minimumDueOf(amountDue: number): number {
    if (amountDue <= 0) return 0;
    return Math.min(amountDue, Math.max(Math.round((amountDue * MINIMUM_DUE_PERCENT) / 100), MINIMUM_DUE_FLOOR));
}

export type StatementStatus = 'nothing_due' | 'paid' | 'minimum_paid' | 'part_paid' | 'unpaid';

export interface StatementState {
    status: StatementStatus;
    /** Still to pay of the amount due */
    left: number;
    /** Past the due date with less than the minimum paid by it: a late fee and a mark on the credit report */
    overdue: boolean;
    /** Past the due date with less than the full amount paid: interest is charged on what is carried */
    carried: number;
    dueSoon: boolean;
    daysLeft: number;
}

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * A statement's status. `paidByDue` counts payments made after the statement date up to its due
 * date; `paid` counts all of them since the statement.
 */
export function statementState(statement: { amountDue: number; minimumDue: number; dueOn: string }, paidByDue: number, paid: number, today: string): StatementState {
    const { amountDue, minimumDue, dueOn } = statement;
    const left = Math.max(amountDue - paid, 0);
    const status: StatementStatus = amountDue <= 0 ? 'nothing_due'
        : paid >= amountDue ? 'paid'
            : paid >= minimumDue && paid > 0 ? 'minimum_paid'
                : paid > 0 ? 'part_paid' : 'unpaid';
    const past = today > dueOn;
    const daysLeft = day(dueOn) - day(today);
    return {
        status, left,
        overdue: past && amountDue > 0 && paidByDue < minimumDue,
        carried: past ? Math.max(amountDue - paidByDue, 0) : 0,
        dueSoon: !past && left > 0 && daysLeft <= DUE_SOON_DAYS,
        daysLeft,
    };
}

/** About a month's interest on a balance carried over, at a yearly rate (charged on the interest too) */
export function monthsInterest(carried: number, yearlyRate: number): number {
    return Math.round(carried * yearlyRate / 1200);
}

/** A card's % a year as its true yearly cost, the interest being charged monthly on the interest too */
export function trueYearlyRate(yearlyRate: number): number {
    return Math.round(((1 + yearlyRate / 1200) ** 12 - 1) * 10000) / 100;
}
