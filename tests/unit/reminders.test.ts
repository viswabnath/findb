/**
 * Unit tests for src/core/reminders.ts: what a day's reminder holds
 */
import { reminderParts, shortList } from '../../src/core/reminders';

const TODAY = '2026-11-05';
const item = (title: string, date: string, extra: Partial<{ direction: 'pay' | 'receive' | 'move' | 'none'; overdue: boolean }> = {}) =>
    ({ title, date, direction: 'pay' as const, overdue: false, ...extra });

test('overdue, today and tomorrow; money coming in and later dates are left out', () => {
    expect(reminderParts([
        item('HDFC card bill', '2026-11-02', { overdue: true }),
        item('Rent', TODAY),
        item('Chit auction', TODAY, { direction: 'none' }),
        item('Home loan EMI', '2026-11-06'),
        item('Salary', TODAY, { direction: 'receive' }),
        item('Gym', '2026-11-20'),
        item('To savings', TODAY, { direction: 'move' }),
    ], TODAY)).toEqual({ overdue: ['HDFC card bill'], today: ['Rent', 'Chit auction'], tomorrow: ['Home loan EMI'], count: 4 });
});

test('nothing to remind about', () => {
    expect(reminderParts([item('Gym', '2026-11-20'), item('Salary', TODAY, { direction: 'receive' })], TODAY)).toBeNull();
});

test('a short list of names', () => {
    expect(shortList(['A', 'B'])).toEqual({ names: 'A, B', more: 0 });
    expect(shortList(['A', 'B', 'C', 'D', 'E'])).toEqual({ names: 'A, B, C', more: 2 });
});
