/**
 * The website's money calculators (src/core/calculators.ts), checked against figures
 * worked out independently with the standard formulas.
 */
import {
    annualFromPerHundred, chitFund, emi, fixedDeposit, goldValue, inflation, interestPerHundredBorrowed, irr, payoff,
    perHundredMonthly, recurringDeposit, sip,
} from '../../src/core/calculators';

describe('emi', () => {
    test('₹10,00,000 at 8.5% for 20 years is ₹8,678.23 a month', () => {
        const result = emi(1000000, 8.5, 240);
        expect(result.emi).toBeCloseTo(8678.23, 2);
        expect(result.totalPaid).toBeCloseTo(8678.2316 * 240, 0);
        expect(result.years).toHaveLength(20);
        expect(result.years[19]!.balance).toBeCloseTo(0, 2);
        const principal = result.years.reduce((sum, year) => sum + year.principalPaid, 0);
        expect(principal).toBeCloseTo(1000000, 0);
    });

    test('early years are mostly interest, later years mostly principal', () => {
        const { years } = emi(1000000, 8.5, 240);
        expect(years[0]!.interestPaid).toBeGreaterThan(years[0]!.principalPaid);
        expect(years[19]!.principalPaid).toBeGreaterThan(years[19]!.interestPaid);
    });

    test('a zero-interest loan splits evenly', () => {
        expect(emi(120000, 0, 12)).toMatchObject({ emi: 10000, totalInterest: 0, totalPaid: 120000 });
    });
});

describe('deposits', () => {
    test('FD: ₹1,00,000 at 7% for 1 year, compounded quarterly', () => {
        expect(fixedDeposit(100000, 7, 12)).toEqual({ invested: 100000, interest: 7185.9, maturity: 107185.9 });
    });

    test('RD: ₹5,000 a month at 7% for 12 months', () => {
        const result = recurringDeposit(5000, 7, 12);
        expect(result.invested).toBe(60000);
        // Each instalment earns for the months it stays: 12, 11, ... 1
        const expected = Array.from({ length: 12 }, (_, i) => 5000 * (1 + 0.07 / 4) ** ((i + 1) / 3)).reduce((a, b) => a + b);
        expect(result.maturity).toBeCloseTo(expected, 2);
        expect(result.interest).toBeGreaterThan(2000);
        expect(result.interest).toBeLessThan(2600);
    });
});

describe('sip', () => {
    test('₹10,000 a month at 12% for 10 years grows to about ₹23.2 lakh', () => {
        const result = sip(10000, 12, 10);
        expect(result.invested).toBe(1200000);
        expect(result.value).toBeCloseTo(2323391, -1);
    });
});

describe('gold and inflation', () => {
    test('42 g of 22 karat gold at ₹7,746 a gram for 24 karat', () => {
        expect(goldValue(42, 22, 7746)).toEqual({ purity: 91.67, fineGrams: 38.5, value: 298221 });
    });

    test('₹1,00,000 at 6% inflation over 10 years', () => {
        expect(inflation(100000, 6, 10)).toEqual({ futureCost: 179084.77, todaysValue: 55839.48 });
    });
});

describe('payoff', () => {
    const loans = [
        { name: 'Home loan', balance: 2000000, annualRate: 8.5, emi: 17356 },
        { name: 'Credit card', balance: 60000, annualRate: 42, emi: 3000 },
        { name: 'Personal loan', balance: 300000, annualRate: 14, emi: 10000 },
    ];

    test('extra money goes to the highest interest rate first', () => {
        expect(payoff(loans, 5000).order).toEqual(['Credit card', 'Personal loan', 'Home loan']);
    });

    test('paying extra clears debts sooner and saves interest', () => {
        const base = payoff(loans, 0);
        const extra = payoff(loans, 10000);
        expect(base.clears).toBe(true);
        expect(extra.months).toBeLessThan(base.months);
        expect(extra.totalInterest).toBeLessThan(base.totalInterest);
        expect(extra.closedIn['Credit card']).toBeLessThan(extra.closedIn['Home loan']!);
    });

    test('an EMI below the interest never clears', () => {
        expect(payoff([{ name: 'Card', balance: 100000, annualRate: 42, emi: 1000 }], 0).clears).toBe(false);
    });
});

describe('chit fund', () => {
    const chit = { chitValue: 500000, months: 20, commissionPct: 5, othersBidPct: 20 };

    test('taking the prize late is saving: you get back more than you paid', () => {
        const result = chitFund({ ...chit, yourMonth: 20, yourBidPct: 5 });
        expect(result.contribution).toBe(25000);
        expect(result.role).toBe('saver');
        expect(result.net).toBeGreaterThan(0);
        expect(result.yearlyRate).toBeGreaterThan(0);
    });

    test('the per ₹100 a month figure agrees with the yearly rate', () => {
        const result = chitFund({ ...chit, yourMonth: 1, yourBidPct: 30 });
        const yearlyFromMonthly = ((1 + result.perHundredMonthly / 100) ** 12 - 1) * 100;
        expect(yearlyFromMonthly).toBeCloseTo(result.yearlyRate, 0);
    });

    test('taking the prize early is borrowing: you pay back more than you received', () => {
        const result = chitFund({ ...chit, yourMonth: 1, yourBidPct: 30 });
        expect(result.role).toBe('borrower');
        expect(result.prize).toBe(350000);
        expect(result.net).toBeLessThan(0);
        expect(result.yearlyRate).toBeGreaterThan(0);
    });
});

test('irr finds the rate that makes the cash flows worth nothing today', () => {
    expect(irr([-100, 110])).toBeCloseTo(0.1, 6);
});

describe('interest per ₹100', () => {
    test('₹1 per ₹100 a month is 12% a year, and back', () => {
        expect(annualFromPerHundred(1)).toBe(12);
        expect(perHundredMonthly(12)).toBe(1);
        expect(perHundredMonthly(8.9)).toBeCloseTo(0.7417, 4);
        expect(annualFromPerHundred(perHundredMonthly(8.9))).toBeCloseTo(8.9, 10);
    });

    test('total interest on every ₹100 borrowed', () => {
        // ₹5,00,000 at 8.9% for 1 year: ₹24,431 of interest, so ₹4.89 on every ₹100
        const result = emi(500000, 8.9, 12);
        expect(result.totalInterest).toBeCloseTo(24431, -1);
        expect(interestPerHundredBorrowed(result.totalInterest, 500000)).toBeCloseTo(4.89, 2);
        expect(interestPerHundredBorrowed(100, 0)).toBe(0);
    });
});
