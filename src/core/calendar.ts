/**
 * The calendar of what's due (v2 plan, Phase 4): everything coming up this month and next, in one
 * list, with what is to pay and to receive each month and from which account. Gathered by
 * lib/services/calendar.ts from cards, loans, chits, repeating entries and people. Amounts are paise.
 */

export type DueKind = 'card_bill' | 'emi' | 'chit' | 'auction' | 'repeating' | 'person';
/** pay: money goes out; receive: money comes in; move: between the user's own accounts; none: a date, no money */
export type Direction = 'pay' | 'receive' | 'move' | 'none';

export interface DueItem {
    date: string;
    kind: DueKind;
    title: string;
    /** null when not known yet (an auction) */
    amount: number | null;
    direction: Direction;
    /** The account it is paid from or into, when known */
    account: string | null;
    /** Its date has passed and it is not recorded as paid */
    overdue: boolean;
    /** A best guess: a card bill before its statement, a chit payment before its auction */
    estimated: boolean;
    href: string;
}

export interface MonthTotals {
    month: string;
    toPay: number;
    toReceive: number;
}

export interface CalendarSummary {
    /** From the first of this month to the end of next month */
    from: string;
    to: string;
    items: DueItem[];
    months: MonthTotals[];
    overdue: number;
    /** What is to be paid from each account in the two months, largest first; unknown accounts last */
    byAccount: { account: string | null; amount: number }[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The first day of this month and the last day of next month */
export function calendarWindow(today: string): { from: string; to: string; months: [string, string] } {
    const [year, month] = today.split('-').map(Number) as [number, number];
    const next = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 0));
    return {
        from: `${year}-${pad(month)}-01`,
        to: end.toISOString().slice(0, 10),
        months: [`${year}-${pad(month)}`, `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`],
    };
}

const ORDER: DueKind[] = ['card_bill', 'emi', 'chit', 'repeating', 'person', 'auction'];

/**
 * Sort the items (overdue first, then by date) and add them up. Overdue items count in this month's
 * totals as well, since they are still to pay now.
 */
export function summarise(items: DueItem[], today: string): CalendarSummary {
    const { from, to, months } = calendarWindow(today);
    const sorted = [...items].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.date.localeCompare(b.date) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    const monthOf = (item: DueItem) => (item.overdue || item.date < from ? months[0] : item.date.slice(0, 7));
    const totals = months.map((month): MonthTotals => {
        const mine = sorted.filter(item => monthOf(item) === month && item.amount !== null);
        return {
            month,
            toPay: mine.filter(item => item.direction === 'pay').reduce((sum, item) => sum + item.amount!, 0),
            toReceive: mine.filter(item => item.direction === 'receive').reduce((sum, item) => sum + item.amount!, 0),
        };
    });
    const accounts = new Map<string | null, number>();
    for (const item of sorted) {
        if (item.direction !== 'pay' || item.amount === null) continue;
        accounts.set(item.account, (accounts.get(item.account) ?? 0) + item.amount);
    }
    return {
        from, to, items: sorted, months: totals,
        overdue: sorted.filter(item => item.overdue && item.direction === 'pay').reduce((sum, item) => sum + (item.amount ?? 0), 0),
        byAccount: [...accounts].map(([account, amount]) => ({ account, amount }))
            .sort((a, b) => Number(a.account === null) - Number(b.account === null) || b.amount - a.amount),
    };
}
