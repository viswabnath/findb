/**
 * Unit tests for src/core/chit.ts: dividends, amounts due, the prize, and the true return or cost
 */
import { amountDue, chitOutcome, commissionOf, dividendFor, prize, type ChitTerms } from '../../src/core/chit';

// A Rs 5 lakh chit: 20 members, 20 months, Rs 25,000 a month, 5% commission
const CHIT: ChitTerms = { value: 50_000_000, members: 20, months: 20, contribution: 2_500_000, commissionPercent: 5 };

describe('a month in the chit', () => {
    test('commission is 5% of the chit value', () => {
        expect(commissionOf(CHIT)).toBe(2_500_000);
    });

    test('a Rs 1 lakh winning bid: Rs 75,000 left after commission, Rs 3,750 to each member', () => {
        expect(dividendFor(CHIT, 10_000_000)).toBe(375_000);
        expect(amountDue(CHIT, 10_000_000)).toBe(2_125_000);
        expect(prize(CHIT, 10_000_000)).toBe(40_000_000);
        expect(prize(CHIT, 10_000_000, 50_000)).toBe(39_950_000);
    });

    test('a bid below the commission leaves no dividend', () => {
        expect(dividendFor(CHIT, 1_000_000)).toBe(0);
        expect(amountDue(CHIT, 1_000_000)).toBe(2_500_000);
    });
});

describe('the true return or cost', () => {
    // Bids fall over the months: early winners give up more
    const auctions = Array.from({ length: 20 }, (_, index) => ({ month: index + 1, discount: Math.max(12_000_000 - index * 550_000, 2_500_000) }));

    test('winning early is borrowing: a cost', () => {
        const early = chitOutcome(CHIT, auctions, 2);
        expect(early.role).toBe('borrower');
        expect(early.received).toBe(prize(CHIT, auctions[1]!.discount));
        expect(early.yearlyRate).toBeGreaterThan(5);
    });

    test('winning late is saving: a return', () => {
        const late = chitOutcome(CHIT, auctions, 20);
        expect(late.role).toBe('saver');
        expect(late.gain).toBeGreaterThan(0);
        expect(late.yearlyRate).toBeGreaterThan(0);
    });
});
