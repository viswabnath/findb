/**
 * Unit tests for src/core/debts.ts: ranking, the payoff simulator, the EMI-to-income ratio
 */
import { TYPICAL_CARD_RATE, emiRatio, minimumOnly, rankDebts, simulatePayoff, type Debt } from '../../src/core/debts';

// The website's example: a card at 42%, a personal loan at 14%, a home loan at 8.5%
const DEBTS: Debt[] = [
    { key: 'home', name: 'Home loan', kind: 'home', balance: 300_000_000, yearlyRate: 8.5, monthly: 3_000_000 },
    { key: 'card', name: 'Card', kind: 'credit_card', balance: 8_000_000, yearlyRate: 42, monthly: 400_000 },
    { key: 'personal', name: 'Personal loan', kind: 'personal', balance: 40_000_000, yearlyRate: 14, monthly: 1_200_000 },
    { key: 'settled', name: 'Paid off', kind: 'other', balance: 0, yearlyRate: 50, monthly: 0 },
];

test('ranked by the true yearly cost; cleared debts left out', () => {
    expect(rankDebts(DEBTS).map(debt => debt.key)).toEqual(['card', 'personal', 'home']);
});

test('an extra Rs 10,000 a month: highest rate first saves the most interest; both finish', () => {
    const avalanche = simulatePayoff(DEBTS, 1_000_000, 'highest_rate');
    const snowball = simulatePayoff(DEBTS, 1_000_000, 'smallest_balance');
    const none = simulatePayoff(DEBTS, 0, 'highest_rate');
    expect(avalanche.clears && snowball.clears && none.clears).toBe(true);
    expect(avalanche.order[0]).toBe('card');
    expect(snowball.order[0]).toBe('card');
    expect(avalanche.totalInterest).toBeLessThanOrEqual(snowball.totalInterest);
    expect(avalanche.totalInterest).toBeLessThan(none.totalInterest);
    expect(avalanche.months).toBeLessThan(none.months);
    expect(avalanche.closedIn.card).toBeLessThan(avalanche.closedIn.home!);
});

test('payments below the interest never clear', () => {
    expect(simulatePayoff([{ key: 'x', name: 'x', kind: 'credit_card', balance: 10_000_000, yearlyRate: 42, monthly: 100_000 }], 0, 'highest_rate').clears).toBe(false);
});

test('EMIs as a share of income', () => {
    expect(emiRatio(4_600_000, 10_000_000)).toBe(46);
    expect(emiRatio(1, 0)).toBeNull();
});

test('paying only the minimum on a Rs 50,000 card balance at 42% takes years', () => {
    const plan = minimumOnly(5_000_000, 42);
    expect(plan.firstMinimum).toBe(250_000);
    expect(plan.months).toBeGreaterThan(60);
    expect(plan.totalInterest).toBeGreaterThan(3_000_000);
    expect(minimumOnly(15_000, 42)).toMatchObject({ months: 1, totalInterest: 0, firstMinimum: 15_000 });
});

test('a typical card: Rs 3.50 per Rs 100 a month is about 51% a year', () => {
    expect(TYPICAL_CARD_RATE).toBe(51.11);
});
