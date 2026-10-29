/**
 * Unit tests for src/core/cards.ts: statement and due dates, statement status, the minimum due
 */
import { dueDateFor, minimumDueOf, monthsInterest, statementDates, statementState, trueYearlyRate } from '../../src/core/cards';

test('the latest statement date on or before today, and the one before', () => {
    expect(statementDates(5, '2026-10-29')).toEqual({ current: '2026-10-05', previous: '2026-09-05' });
    expect(statementDates(5, '2026-10-05')).toEqual({ current: '2026-10-05', previous: '2026-09-05' });
    expect(statementDates(20, '2026-01-10')).toEqual({ current: '2025-12-20', previous: '2025-11-20' });
    // A day past the month's end falls on its last day
    expect(statementDates(31, '2026-03-15')).toEqual({ current: '2026-02-28', previous: '2026-01-31' });
});

test('due on the first due day after the statement', () => {
    expect(dueDateFor('2026-10-05', 25)).toBe('2026-10-25');
    expect(dueDateFor('2026-10-20', 8)).toBe('2026-11-08');
    expect(dueDateFor('2026-12-20', 8)).toBe('2027-01-08');
    expect(dueDateFor('2026-01-31', 30)).toBe('2026-02-28');
});

test('the usual minimum due: 5%, at least Rs 200, never more than the amount', () => {
    expect(minimumDueOf(5_000_000)).toBe(250_000);
    expect(minimumDueOf(100_000)).toBe(20_000);
    expect(minimumDueOf(15_000)).toBe(15_000);
    expect(minimumDueOf(0)).toBe(0);
});

describe('a statement of Rs 20,000 with a minimum of Rs 1,000, due 25 Oct', () => {
    const statement = { amountDue: 2_000_000, minimumDue: 100_000, dueOn: '2026-10-25' };

    test('unpaid three days before: due soon', () => {
        expect(statementState(statement, 0, 0, '2026-10-22')).toMatchObject({ status: 'unpaid', left: 2_000_000, dueSoon: true, daysLeft: 3, overdue: false, carried: 0 });
    });
    test('paid in full by the due date', () => {
        expect(statementState(statement, 2_000_000, 2_000_000, '2026-10-29')).toMatchObject({ status: 'paid', left: 0, overdue: false, carried: 0 });
    });
    test('only the minimum: not overdue, but the rest is carried and charged interest', () => {
        expect(statementState(statement, 100_000, 100_000, '2026-10-29')).toMatchObject({ status: 'minimum_paid', overdue: false, carried: 1_900_000 });
    });
    test('less than the minimum by the due date: overdue', () => {
        expect(statementState(statement, 50_000, 50_000, '2026-10-29')).toMatchObject({ status: 'part_paid', overdue: true, carried: 1_950_000 });
    });
    test('paid in full late: not owed now, but it was overdue and carried', () => {
        expect(statementState(statement, 0, 2_000_000, '2026-10-29')).toMatchObject({ status: 'paid', left: 0, overdue: true, carried: 2_000_000 });
    });
    test('nothing due', () => {
        expect(statementState({ amountDue: 0, minimumDue: 0, dueOn: '2026-10-25' }, 0, 0, '2026-10-29')).toMatchObject({ status: 'nothing_due', overdue: false, dueSoon: false });
    });
});

test('interest on a balance carried: 42% a year is 3.5% a month, about 51% a year in truth', () => {
    expect(monthsInterest(1_900_000, 42)).toBe(66_500);
    expect(trueYearlyRate(42)).toBe(51.11);
});
