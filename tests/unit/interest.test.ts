/**
 * Unit tests for src/core/interest.ts: both forms of a rate, simple interest, money with people
 */
import { perHundredMonthly, personLoanState, simpleInterest, splitRepayment, yearlyRate } from '../../src/core/interest';

describe('rates in both forms', () => {
    test('₹ per ₹100 a month to % a year, and back', () => {
        expect(yearlyRate('2', 'per100month')).toBe('24');
        expect(yearlyRate('1.5', 'per100month')).toBe('18');
        expect(yearlyRate('18', 'year')).toBe('18');
        expect(yearlyRate('10.5', 'year')).toBe('10.5');
        expect(perHundredMonthly('24')).toBe('2');
        expect(perHundredMonthly('18')).toBe('1.5');
        expect(perHundredMonthly('13')).toBe('1.083');
        expect(perHundredMonthly('0')).toBe('0');
    });

    test('refuses what is not a rate, or above 100% a year', () => {
        expect(yearlyRate('abc', 'year')).toBeNull();
        expect(yearlyRate('-1', 'year')).toBeNull();
        expect(yearlyRate('101', 'year')).toBeNull();
        expect(yearlyRate('9', 'per100month')).toBeNull();
        expect(yearlyRate('8.333', 'per100month')).toBe('99.996');
    });
});

describe('simple interest', () => {
    test('a year at 12% on ₹10,000 is ₹1,200; nothing without a rate or time', () => {
        expect(simpleInterest(1_000_000, '12', 365)).toBe(120_000);
        expect(simpleInterest(1_000_000, '12', 30)).toBe(9863);
        expect(simpleInterest(1_000_000, '0', 365)).toBe(0);
        expect(simpleInterest(1_000_000, '12', 0)).toBe(0);
    });
});

describe('money with people', () => {
    test('interest-free: open, then settled when paid back in parts', () => {
        expect(personLoanState(500_000, null, '2026-01-01', null, [], '2026-03-01')).toEqual({ outstanding: 500_000, principalRepaid: 0, interestPaid: 0, interestDue: 0, status: 'open' });
        const paid = [{ date: '2026-02-01', principalPaise: 200_000, interestPaise: 0 }, { date: '2026-03-01', principalPaise: 300_000, interestPaise: 0 }];
        expect(personLoanState(500_000, null, '2026-01-01', null, paid, '2026-03-02')).toMatchObject({ outstanding: 0, principalRepaid: 500_000, status: 'settled' });
    });

    test('overdue once the due date passes with something owed', () => {
        expect(personLoanState(100_000, null, '2026-01-01', '2026-02-01', [], '2026-02-02').status).toBe('overdue');
        expect(personLoanState(100_000, null, '2026-01-01', '2026-02-01', [], '2026-02-01').status).toBe('open');
    });

    test('interest builds on what is still owed, day by day', () => {
        // ₹10,000 at 24% a year (₹2 per ₹100 a month): ₹5,000 back after 73 days, then 73 more days on ₹5,000
        const state = personLoanState(1_000_000, '24', '2026-01-01', null, [{ date: '2026-03-15', principalPaise: 500_000, interestPaise: 0 }], '2026-05-27');
        expect(state.interestDue).toBe(48_000 + 24_000);
        expect(state.outstanding).toBe(500_000);
        const paidInterest = personLoanState(1_000_000, '24', '2026-01-01', null, [{ date: '2026-03-15', principalPaise: 500_000, interestPaise: 48_000 }], '2026-05-27');
        expect(paidInterest.interestDue).toBe(24_000);
        expect(paidInterest.interestPaid).toBe(48_000);
    });

    test('a closed loan is settled whatever is left', () => {
        expect(personLoanState(100_000, '12', '2026-01-01', '2026-02-01', [], '2026-06-01', true)).toMatchObject({ status: 'settled', interestDue: 0 });
    });

    test('a repayment goes to interest due first, then what is owed; anything more is extra', () => {
        expect(splitRepayment(100_000, { outstanding: 500_000, interestDue: 20_000 })).toEqual({ principalPaise: 80_000, interestPaise: 20_000, extra: 0 });
        expect(splitRepayment(600_000, { outstanding: 500_000, interestDue: 20_000 })).toEqual({ principalPaise: 500_000, interestPaise: 20_000, extra: 80_000 });
        expect(splitRepayment(10_000, { outstanding: 500_000, interestDue: 20_000 })).toEqual({ principalPaise: 0, interestPaise: 10_000, extra: 0 });
    });
});
