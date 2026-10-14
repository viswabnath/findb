/**
 * Unit tests for lib/dates.ts
 */
import { filterYears, MONTH_NAMES, toDateInputValue, todayInIndiaClient, todayUtcIso } from '../../lib/dates';

describe('todayUtcIso', () => {
    test('is the UTC date, like the legacy default (still the previous day just after midnight IST)', () => {
        expect(todayUtcIso(new Date('2026-10-01T12:00:00Z'))).toBe('2026-10-01');
        expect(todayUtcIso(new Date('2026-10-01T23:30:00Z'))).toBe('2026-10-01');
    });
});

describe('toDateInputValue', () => {
    test('formats a local date as YYYY-MM-DD', () => {
        expect(toDateInputValue(new Date(2026, 0, 5).toISOString())).toBe('2026-01-05');
        expect(toDateInputValue(new Date(2026, 11, 31, 23, 0).toISOString())).toBe('2026-12-31');
    });

    test('falls back to today for an invalid date', () => {
        const today = new Date();
        const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        expect(toDateInputValue('not a date')).toBe(expected);
    });
});

describe('filterYears', () => {
    test('runs from 2020 to next year', () => {
        expect(filterYears(new Date(2026, 5, 1))).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027]);
    });
});

test('MONTH_NAMES has the twelve months in order', () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[0]).toBe('January');
    expect(MONTH_NAMES[11]).toBe('December');
});

test('todayInIndiaClient is India\'s date, also just after midnight there', () => {
    expect(todayInIndiaClient(new Date('2026-10-14T18:29:00Z'))).toBe('2026-10-14');
    expect(todayInIndiaClient(new Date('2026-10-14T18:31:00Z'))).toBe('2026-10-15');
});
