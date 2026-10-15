/**
 * Unit tests for src/core/split.ts: splitting a cost, group balances, simplifying debts
 */
import { groupBalances, simplifyDebts, splitAmount } from '../../src/core/split';

const asObject = (shares: ReturnType<typeof splitAmount>) => (typeof shares === 'string' ? shares : Object.fromEntries(shares));

describe('splitAmount', () => {
    test('equally, with no paisa lost: the first members take the odd paise', () => {
        expect(asObject(splitAmount(1000, 'equal', [{ member: 'you' }, { member: 'p1' }, { member: 'p2' }]))).toEqual({ you: 334, p1: 333, p2: 333 });
    });

    test('by exact amounts, which must add up to the total', () => {
        expect(asObject(splitAmount(1000, 'exact', [{ member: 'you', value: 700 }, { member: 'p1', value: 300 }]))).toEqual({ you: 700, p1: 300 });
        expect(splitAmount(1000, 'exact', [{ member: 'you', value: 700 }, { member: 'p1', value: 200 }])).toBe('exactTotal');
    });

    test('by percentages adding to 100, rounding to the largest remainders', () => {
        expect(asObject(splitAmount(1001, 'percent', [{ member: 'you', value: 5000 }, { member: 'p1', value: 2500 }, { member: 'p2', value: 2500 }])))
            .toEqual({ you: 501, p1: 250, p2: 250 });
        expect(splitAmount(1000, 'percent', [{ member: 'you', value: 5000 }])).toBe('percentTotal');
    });

    test('by shares: a couple counts as 2', () => {
        expect(asObject(splitAmount(900_000, 'shares', [{ member: 'you', value: 2 }, { member: 'p1', value: 1 }]))).toEqual({ you: 600_000, p1: 300_000 });
        expect(splitAmount(100, 'shares', [{ member: 'you', value: 0 }])).toBe('badShares');
    });

    test('refuses no members, repeats, and negative or fractional values', () => {
        expect(splitAmount(100, 'equal', [])).toBe('noMembers');
        expect(splitAmount(100, 'equal', [{ member: 'p1' }, { member: 'p1' }])).toBe('noMembers');
        expect(splitAmount(100, 'exact', [{ member: 'p1', value: -1 }])).toBe('badValue');
        expect(splitAmount(100, 'shares', [{ member: 'p1', value: 1.5 }])).toBe('badValue');
    });
});

describe('group balances and settling up', () => {
    // The plan's Goa trip: you book trains for four (12,000); friends pay the hotel (24,000) and food (8,000)
    const four = (total: number) => splitAmount(total, 'equal', [{ member: 'you' }, { member: 'p1' }, { member: 'p2' }, { member: 'p3' }]) as Map<string, number>;
    const costs = [
        { paidBy: 'you', total: 1_200_000, shares: four(1_200_000) },
        { paidBy: 'p1', total: 2_400_000, shares: four(2_400_000) },
        { paidBy: 'p2', total: 800_000, shares: four(800_000) },
    ];

    test('each member\'s position: your share is 11,000, so you are owed 1,000', () => {
        expect(Object.fromEntries(groupBalances(costs, []))).toEqual({ you: 100_000, p1: 1_300_000, p2: -300_000, p3: -1_100_000 });
    });

    test('the fewest payments settle everyone, and a settlement moves the balances', () => {
        const plan = simplifyDebts(groupBalances(costs, []));
        expect(plan).toEqual([
            { from: 'p3', to: 'p1', paise: 1_100_000 },
            { from: 'p2', to: 'p1', paise: 200_000 },
            { from: 'p2', to: 'you', paise: 100_000 },
        ]);
        const after = groupBalances(costs, plan);
        expect([...after.values()].every(paise => paise === 0)).toBe(true);
        expect(simplifyDebts(after)).toEqual([]);
    });

    test('a treat: only the payer shares it, so nobody owes anything', () => {
        expect(Object.fromEntries(groupBalances([{ paidBy: 'you', total: 500, shares: { you: 500 } }], []))).toEqual({ you: 0 });
    });
});
