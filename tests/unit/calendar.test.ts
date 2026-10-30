/**
 * Unit tests for src/core/calendar.ts: the two-month window, sorting, and the totals
 */
import { calendarWindow, summarise, type DueItem } from '../../src/core/calendar';

const item = (overrides: Partial<DueItem>): DueItem => ({
    date: '2026-10-30', kind: 'repeating', title: 'x', amount: 100_000, direction: 'pay', account: 'HDFC', overdue: false, estimated: false, href: '/transactions', ...overrides,
});

test('this month and next', () => {
    expect(calendarWindow('2026-10-30')).toEqual({ from: '2026-10-01', to: '2026-11-30', months: ['2026-10', '2026-11'] });
    expect(calendarWindow('2026-12-05')).toEqual({ from: '2026-12-01', to: '2027-01-31', months: ['2026-12', '2027-01'] });
});

test('overdue first, then by date; totals by month, direction and account', () => {
    const summary = summarise([
        item({ date: '2026-11-05', kind: 'emi', title: 'Home loan EMI', amount: 3_000_000 }),
        item({ date: '2026-10-25', kind: 'card_bill', title: 'Card bill', amount: 2_000_000, overdue: true, account: null }),
        item({ date: '2026-11-01', kind: 'repeating', title: 'Salary', amount: 10_000_000, direction: 'receive' }),
        item({ date: '2026-10-31', kind: 'repeating', title: 'Rent', amount: 2_500_000 }),
        item({ date: '2026-11-10', kind: 'auction', title: 'Chit auction', amount: null, direction: 'none', account: null }),
        item({ date: '2026-11-02', kind: 'repeating', title: 'To savings', amount: 500_000, direction: 'move' }),
    ], '2026-10-30');
    expect(summary.items.map(entry => entry.title)).toEqual(['Card bill', 'Rent', 'Salary', 'To savings', 'Home loan EMI', 'Chit auction']);
    expect(summary.months).toEqual([
        { month: '2026-10', toPay: 4_500_000, toReceive: 0 },
        { month: '2026-11', toPay: 3_000_000, toReceive: 10_000_000 },
    ]);
    expect(summary.overdue).toBe(2_000_000);
    expect(summary.byAccount).toEqual([{ account: 'HDFC', amount: 5_500_000 }, { account: null, amount: 2_000_000 }]);
});
