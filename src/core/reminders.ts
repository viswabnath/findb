/**
 * What a day's reminder holds (v2 Phase 5): from the calendar of what's due (src/core/calendar.ts),
 * the things to pay or do today and tomorrow, and those already overdue. Money coming in is left
 * out (it needs no action), and so are amounts: a notification shows on a locked screen.
 */

import type { DueItem } from './calendar';

/** At most this many names in one notification; the rest are counted */
export const REMINDER_NAMES = 3;

export interface ReminderParts {
    overdue: string[];
    today: string[];
    tomorrow: string[];
    count: number;
}

const tomorrowOf = (today: string) => new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** null when there is nothing to remind about */
export function reminderParts(items: Pick<DueItem, 'date' | 'title' | 'direction' | 'overdue'>[], today: string): ReminderParts | null {
    const tomorrow = tomorrowOf(today);
    const due = items.filter(item => item.direction === 'pay' || item.direction === 'none');
    const parts = {
        overdue: due.filter(item => item.overdue).map(item => item.title),
        today: due.filter(item => !item.overdue && item.date === today).map(item => item.title),
        tomorrow: due.filter(item => !item.overdue && item.date === tomorrow).map(item => item.title),
    };
    const count = parts.overdue.length + parts.today.length + parts.tomorrow.length;
    return count === 0 ? null : { ...parts, count };
}

/** The first few names, and how many more */
export function shortList(names: string[]): { names: string; more: number } {
    return { names: names.slice(0, REMINDER_NAMES).join(', '), more: Math.max(names.length - REMINDER_NAMES, 0) };
}
