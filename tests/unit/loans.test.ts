/**
 * Unit tests for src/core/loans.ts: EMIs, schedules with rate changes and prepayments, flat rates,
 * the effective rate, financial years and foreclosure
 */
import {
    addMonths, byFinancialYear, effectiveYearlyRate, emiFor, financialYearOf, foreclosureAmount, interestSaved, monthsFor, schedule, type LoanTerms,
} from '../../src/core/loans';

const HOME: LoanTerms = { principal: 100_000_000, yearlyRate: 9, months: 240, firstDue: '2026-11-05', type: 'reducing' };

describe('EMI', () => {
    test('₹10 lakh at 9% for 20 years: ₹8,997.26, rounded up to ₹8,998', () => {
        expect(emiFor(100_000_000, 9, 240)).toBe(899_800);
        expect(emiFor(120_000, 0, 12)).toBe(10_000);
    });

    test('the months an EMI takes; never, when it does not cover the interest', () => {
        expect(monthsFor(100_000_000, 9, 899_800)).toBe(240);
        expect(monthsFor(100_000_000, 9, 700_000)).toBe(Infinity);
    });

    test('dates fall on the same day, or the last day of a shorter month', () => {
        expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
        expect(addMonths('2026-11-05', 2)).toBe('2027-01-05');
    });
});

describe('schedule', () => {
    const rows = schedule(HOME);
    const sum = (key: 'interest' | 'principal') => rows.reduce((total, row) => total + row[key], 0);

    test('pays back exactly the principal, and ends at zero', () => {
        expect(sum('principal')).toBe(HOME.principal);
        expect(rows.at(-1)!.closing).toBe(0);
        expect(rows.length).toBeLessThanOrEqual(240);
        expect(rows[0]).toMatchObject({ number: 1, date: '2026-11-05', opening: 100_000_000, emi: 899_800, interest: 750_000, principal: 149_800 });
    });

    test('a rate rise keeping the tenure raises the EMI; keeping the EMI lengthens the loan', () => {
        const higherEmi = schedule(HOME, [{ from: '2027-11-01', yearlyRate: 10, keep: 'tenure' }]);
        expect(higherEmi[12]!.emi).toBeGreaterThan(899_800);
        expect(higherEmi.length).toBeLessThanOrEqual(240);
        const longer = schedule(HOME, [{ from: '2027-11-01', yearlyRate: 10, keep: 'emi' }]);
        expect(longer[12]!.emi).toBe(899_800);
        expect(longer.length).toBeGreaterThan(240);
        expect(longer.at(-1)!.closing).toBe(0);
    });

    test('a prepayment keeping the EMI shortens the loan and saves interest; keeping the end date lowers the EMI', () => {
        const prepay = { date: '2028-01-01', paise: 20_000_000, keep: 'emi' as const };
        const shorter = schedule(HOME, [], [prepay]);
        expect(shorter.length).toBeLessThan(rows.length);
        expect(shorter.find(row => row.prepaid > 0)).toMatchObject({ date: '2028-01-05', prepaid: 20_000_000 });
        expect(interestSaved(HOME, [], [], prepay)).toBeGreaterThan(0);
        const lowerEmi = schedule(HOME, [], [{ ...prepay, keep: 'tenure' }]);
        expect(lowerEmi.find(row => row.date === '2028-01-05')!.emi).toBeLessThan(899_800);
    });

    test('a flat rate: interest on the whole principal; its true cost is far above the quoted rate', () => {
        const flat = schedule({ principal: 10_000_000, yearlyRate: 10, months: 12, firstDue: '2026-11-01', type: 'flat' });
        expect(flat.reduce((total, row) => total + row.interest, 0)).toBe(1_000_000);
        expect(flat.reduce((total, row) => total + row.principal, 0)).toBe(10_000_000);
        const effective = effectiveYearlyRate(10_000_000, 0, flat);
        expect(effective).toBeGreaterThan(19);
        expect(effective).toBeLessThan(20);
    });

    test('fees raise the effective rate', () => {
        const plain = effectiveYearlyRate(HOME.principal, 0, rows);
        const withFees = effectiveYearlyRate(HOME.principal, 1_000_000, rows);
        expect(plain).toBeCloseTo(9.38, 1);
        expect(withFees).toBeGreaterThan(plain);
    });
});

describe('financial years and closing', () => {
    test('India\'s year runs April to March', () => {
        expect(financialYearOf('2027-03-31')).toBe('2026-27');
        expect(financialYearOf('2027-04-01')).toBe('2027-28');
        expect(byFinancialYear([
            { date: '2027-03-05', principal: 100, interest: 50 }, { date: '2027-04-05', principal: 110, interest: 40, fees: 5 }, { date: '2026-12-05', principal: 90, interest: 60 },
        ])).toEqual([{ year: '2026-27', principal: 190, interest: 110, fees: 0 }, { year: '2027-28', principal: 110, interest: 40, fees: 5 }]);
    });

    test('foreclosure: the balance, interest since the last EMI, and the charge', () => {
        expect(foreclosureAmount(10_000_000, 9, 10, 2)).toEqual({ interest: 24_658, charge: 200_000, total: 10_224_658 });
    });
});
