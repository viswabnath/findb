/**
 * Unit tests for src/core/insights.ts: category averages, unusual spend and subscriptions
 */
import { categoryInsights, findSubscriptions, merchantKey, monthsBetween, shiftMonth, type Charge, type MonthTotal } from '../../src/core/insights';

describe('months', () => {
    test('shiftMonth crosses years both ways', () => {
        expect(shiftMonth('2026-01', -1)).toBe('2025-12');
        expect(shiftMonth('2025-12', 1)).toBe('2026-01');
        expect(shiftMonth('2026-10', -12)).toBe('2025-10');
    });

    test('monthsBetween', () => {
        expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });
});

describe('categoryInsights', () => {
    // Fuel: ₹2,000 a month for a year, then ₹5,000 in October; Restaurants rising
    const fuel = monthsBetween('2025-10', '2026-09').map(month => ({ month, categoryId: 1, paise: 200_000 }));
    const totals: MonthTotal[] = [
        ...fuel, { month: '2026-10', categoryId: 1, paise: 500_000 },
        { month: '2026-04', categoryId: 2, paise: 500_000 }, { month: '2026-05', categoryId: 2, paise: 500_000 }, { month: '2026-06', categoryId: 2, paise: 500_000 },
        { month: '2026-07', categoryId: 2, paise: 600_000 }, { month: '2026-08', categoryId: 2, paise: 600_000 }, { month: '2026-09', categoryId: 2, paise: 630_000 },
        { month: '2026-10', categoryId: 2, paise: 100_000 },
    ];

    test('averages over 3, 6 and 12 complete months, and the change from the 3 before', () => {
        const [first, second] = categoryInsights(totals, '2026-10', '2025-10');
        expect(first).toMatchObject({ categoryId: 1, thisMonth: 500_000, lastMonth: 200_000, average3: 200_000, average6: 200_000, average12: 200_000, change3: 0 });
        expect(second).toMatchObject({ categoryId: 2, thisMonth: 100_000, average3: 610_000, average6: 555_000, change3: 22 });
        // Months with no spending count as zero
        expect(second!.average12).toBe(277_500);
    });

    test('twice the average and ₹1,000 more is unusual; less is not', () => {
        const [first, second] = categoryInsights(totals, '2026-10', '2025-10');
        expect(first!.unusual).toBe(true);
        expect(second!.unusual).toBe(false);
        // Twice the average but only ₹300 more: not worth a flag
        const small = categoryInsights([
            { month: '2026-07', categoryId: 3, paise: 30_000 }, { month: '2026-08', categoryId: 3, paise: 30_000 }, { month: '2026-09', categoryId: 3, paise: 30_000 },
            { month: '2026-10', categoryId: 3, paise: 60_000 },
        ], '2026-10', '2026-01');
        expect(small[0]!.unusual).toBe(false);
    });

    test('without enough history there is no average, and no flag', () => {
        const [only] = categoryInsights([{ month: '2026-09', categoryId: 1, paise: 100_000 }, { month: '2026-10', categoryId: 1, paise: 900_000 }], '2026-10', '2026-09');
        expect(only).toMatchObject({ average3: null, average6: null, average12: null, change3: null, unusual: false });
        // Two months of history make a 3-month average, but not a 6-month one
        const [two] = categoryInsights([{ month: '2026-08', categoryId: 1, paise: 100_000 }, { month: '2026-09', categoryId: 1, paise: 300_000 }], '2026-10', '2026-08');
        expect(two).toMatchObject({ average3: 200_000, average6: null });
    });
});

describe('subscriptions', () => {
    const monthly = (description: string, amounts: number[], start = 1): Charge[] => amounts.map((paise, index) => ({
        date: `2026-${String(start + index).padStart(2, '0')}-05`, description, paise, categoryId: 9, accountId: 1,
    }));

    test('merchantKey ignores numbers and punctuation', () => {
        expect(merchantKey('NETFLIX.COM 4123 Mumbai')).toBe('netflix com mumbai');
        expect(merchantKey('Netflix.com 9876 mumbai')).toBe('netflix com mumbai');
    });

    test('a monthly charge, its cost a month and a year, and a price rise', () => {
        const [netflix] = findSubscriptions(monthly('Netflix', [49_900, 49_900, 49_900, 64_900], 6), '2026-09-20');
        expect(netflix).toMatchObject({ cadence: 'monthly', charges: 4, lastPaise: 64_900, monthlyPaise: 64_900, yearlyPaise: 778_800, status: 'active', priceRiseFrom: 49_900 });
    });

    test('new and stopped ones', () => {
        const [fresh] = findSubscriptions(monthly('Spotify', [11_900, 11_900, 11_900], 7), '2026-09-20');
        expect(fresh!.status).toBe('new');
        const [gone] = findSubscriptions(monthly('Gym', [150_000, 150_000, 150_000], 1), '2026-09-20');
        expect(gone!.status).toBe('stopped');
    });

    test('weekly and yearly rhythms; the cost a month follows the rhythm', () => {
        const weekly = ['2026-09-01', '2026-09-08', '2026-09-15'].map(date => ({ date, description: 'Milk delivery', paise: 70_000, categoryId: 2, accountId: 1 }));
        expect(findSubscriptions(weekly, '2026-09-18')[0]).toMatchObject({ cadence: 'weekly', monthlyPaise: 304_400 });
        const yearly = ['2024-10-01', '2025-10-02'].map(date => ({ date, description: 'Amazon Prime', paise: 149_900, categoryId: 2, accountId: 1 }));
        expect(findSubscriptions(yearly, '2026-03-01')[0]).toMatchObject({ cadence: 'yearly', monthlyPaise: 12_493 });
    });

    test('irregular charges, very different amounts and one-offs are not subscriptions', () => {
        const irregular = ['2026-01-03', '2026-01-20', '2026-03-11', '2026-03-12'].map(date => ({ date, description: 'Swiggy', paise: 40_000, categoryId: 2, accountId: 1 }));
        expect(findSubscriptions(irregular, '2026-04-01')).toEqual([]);
        expect(findSubscriptions(monthly('Electricity', [80_000, 210_000, 90_000]), '2026-04-01')).toEqual([]);
        expect(findSubscriptions(monthly('Wedding gift', [500_000]), '2026-04-01')).toEqual([]);
    });

    test('stopped ones come last, the rest by cost a month', () => {
        const found = findSubscriptions([
            ...monthly('Spotify', [11_900, 11_900, 11_900, 11_900], 5),
            ...monthly('Netflix', [64_900, 64_900, 64_900, 64_900], 5),
            ...monthly('Gym', [150_000, 150_000, 150_000], 1),
        ], '2026-08-20');
        expect(found.map(item => item.key)).toEqual(['netflix', 'spotify', 'gym']);
    });
});
