/**
 * Unit tests for src/core/schedule.ts: when repeating entries fall due
 */
import { addDays, dayOfWeek, nextAfter, nextOnOrAfter, occurrences, ruleProblem } from '../../src/core/schedule';

describe('dates', () => {
    test('addDays crosses months and years, and knows leap years', () => {
        expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    test('dayOfWeek', () => {
        expect(dayOfWeek('2026-10-09')).toBe(5); // a Friday
        expect(dayOfWeek('2026-10-11')).toBe(0);
    });
});

describe('nextOnOrAfter', () => {
    test('daily is the same day', () => {
        expect(nextOnOrAfter({ frequency: 'daily' }, '2026-10-09')).toBe('2026-10-09');
    });

    test('weekly finds the next chosen weekday, today included', () => {
        expect(nextOnOrAfter({ frequency: 'weekly', dayOfWeek: 1 }, '2026-10-09')).toBe('2026-10-12');
        expect(nextOnOrAfter({ frequency: 'weekly', dayOfWeek: 5 }, '2026-10-09')).toBe('2026-10-09');
    });

    test('monthly uses the last day in a shorter month', () => {
        expect(nextOnOrAfter({ frequency: 'monthly', dayOfMonth: 31 }, '2026-02-01')).toBe('2026-02-28');
        expect(nextOnOrAfter({ frequency: 'monthly', dayOfMonth: 31 }, '2028-02-01')).toBe('2028-02-29');
        expect(nextOnOrAfter({ frequency: 'monthly', dayOfMonth: 5 }, '2026-10-09')).toBe('2026-11-05');
        expect(nextOnOrAfter({ frequency: 'monthly', dayOfMonth: 5 }, '2026-12-09')).toBe('2027-01-05');
    });

    test('yearly; 29 February is the 28th in other years', () => {
        expect(nextOnOrAfter({ frequency: 'yearly', month: 4, dayOfMonth: 1 }, '2026-10-09')).toBe('2027-04-01');
        expect(nextOnOrAfter({ frequency: 'yearly', month: 2, dayOfMonth: 29 }, '2026-01-01')).toBe('2026-02-28');
        expect(nextOnOrAfter({ frequency: 'yearly', month: 2, dayOfMonth: 29 }, '2027-03-01')).toBe('2028-02-29');
    });
});

describe('occurrences', () => {
    test('every due date up to today, then the next one', () => {
        const rule = { frequency: 'monthly' as const, dayOfMonth: 31 };
        expect(occurrences(rule, '2026-01-31', '2026-05-15', null)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
        // After a short month it goes back to the 31st
        expect(nextAfter(rule, '2026-02-28')).toBe('2026-03-31');
    });

    test('stops at the end date and at the limit', () => {
        const daily = { frequency: 'daily' as const };
        expect(occurrences(daily, '2026-10-01', '2026-10-31', '2026-10-03')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
        expect(occurrences(daily, '2026-01-01', '2026-12-31', null)).toHaveLength(62);
        expect(occurrences(daily, '2026-10-10', '2026-10-09', null)).toEqual([]);
    });
});

test('ruleProblem checks each frequency\'s fields', () => {
    expect(ruleProblem({ frequency: 'daily' })).toBeNull();
    expect(ruleProblem({ frequency: 'weekly', dayOfWeek: 7 })).toBe('Choose the day of the week');
    expect(ruleProblem({ frequency: 'monthly', dayOfMonth: 0 })).toBe('Choose the day of the month (1 to 31)');
    expect(ruleProblem({ frequency: 'yearly', month: 2, dayOfMonth: 30 })).toBe('That month does not have that many days');
    expect(ruleProblem({ frequency: 'yearly', month: 2, dayOfMonth: 29 })).toBeNull();
    expect(ruleProblem({ frequency: 'hourly' as never })).toBe('Repeat daily, weekly, monthly or yearly');
});
