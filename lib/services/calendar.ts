import type { Pool } from 'pg';
import { t } from '../i18n';
import { toPaise } from '../ledger';
import { calendarWindow, summarise, type CalendarSummary, type Direction, type DueItem } from '../../src/core/calendar';
import { dueDateFor } from '../../src/core/cards';
import { amountDue } from '../../src/core/chit';
import { addMonths } from '../../src/core/loans';
import { occurrences } from '../../src/core/schedule';
import { listCards } from './cards';
import { listChits } from './chits';
import { listLoans } from './loans';
import { listPeople } from './people';
import { listRepeating, ruleOf, todayInIndia } from './recurring';

/**
 * The calendar of what's due (v2 Phase 4): card bills, EMIs, chit payments and auctions, repeating
 * entries (rent, bills, salary) and money due from or to people, from the first of this month to
 * the end of next month. It reads what the other screens keep; nothing is stored for it. Overdue
 * items are ones whose date has passed without being recorded as paid.
 */

const onDay = (month: string, day: number) => {
    const [year, m] = month.split('-').map(Number) as [number, number];
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
};

export async function dueCalendar(pool: Pool, userId: number, today = todayInIndia()): Promise<CalendarSummary> {
    const { from, to, months } = calendarWindow(today);
    const inWindow = (date: string) => date <= to;
    const items: DueItem[] = [];

    // Card bills: the latest statement still to pay, then the next one (an estimate: spent since the statement)
    const cards = await listCards(pool, userId);
    for (const card of cards) {
        const statement = card.statement;
        if (statement && toPaise(statement.left) > 0 && inWindow(statement.dueOn)) {
            items.push({
                date: statement.dueOn, kind: 'card_bill', title: t('calendar.cardBill', { name: card.name }), amount: toPaise(statement.left), direction: 'pay',
                account: null, overdue: statement.dueOn < today, estimated: statement.id === null, href: '/cards',
            });
        }
        if (statement && card.billingDay !== null && card.dueDay !== null && toPaise(card.sinceStatement) > 0) {
            const nextStatement = addMonths(statement.date, 1);
            const due = dueDateFor(nextStatement, card.dueDay);
            if (inWindow(due)) {
                items.push({
                    date: due, kind: 'card_bill', title: t('calendar.cardNext', { name: card.name }), amount: toPaise(card.sinceStatement), direction: 'pay',
                    account: null, overdue: false, estimated: true, href: '/cards',
                });
            }
        }
    }

    // EMIs: the first unpaid one (overdue if its date has passed) and the schedule after it
    for (const loan of (await listLoans(pool, userId)).filter(item => !item.closed && item.nextDue)) {
        // A card loan's EMI is charged to its card
        const cardName = loan.cardId ? cards.find(card => card.id === loan.cardId)?.name ?? null : null;
        const dates = loan.schedule.filter(row => row.date >= loan.nextDue!.date && inWindow(row.date) && toPaise(row.emi) > 0);
        for (const row of dates) {
            items.push({
                date: row.date, kind: 'emi', title: t('calendar.emi', { name: loan.name }), amount: row.date === loan.nextDue!.date ? toPaise(loan.nextDue!.amount) : toPaise(row.emi),
                direction: 'pay', account: cardName, overdue: row.date < today, estimated: false, href: '/loans',
            });
        }
    }

    // Chits: the next payment and the months after it (less the dividend once the auction is known), and auction days
    for (const chit of (await listChits(pool, userId)).filter(item => !item.finished)) {
        const paid = new Set(chit.instalments.map(item => item.month));
        const auctioned = new Map(chit.auctions.map(item => [item.month, item]));
        const terms = { value: toPaise(chit.value), members: chit.members, months: chit.months, contribution: toPaise(chit.contribution), commissionPercent: Number(chit.commissionPercent) };
        for (let month = 1; month <= chit.months; month++) {
            const date = addMonths(chit.startedOn, month - 1);
            if (!inWindow(date)) break;
            if (!paid.has(month)) {
                const auction = auctioned.get(month);
                items.push({
                    date, kind: 'chit', title: t('calendar.chit', { name: chit.name, month }),
                    amount: auction ? amountDue(terms, toPaise(auction.discount)) : terms.contribution, direction: 'pay', account: null,
                    overdue: date < today, estimated: !auction, href: '/chits',
                });
            }
        }
        if (chit.auctionDay !== null) {
            for (const month of months) {
                const date = onDay(month, chit.auctionDay);
                const number = chit.auctions.length + 1;
                if (date >= today && number <= chit.months && !chit.won) {
                    items.push({ date, kind: 'auction', title: t('calendar.auction', { name: chit.name }), amount: null, direction: 'none', account: null, overdue: false, estimated: false, href: '/chits' });
                }
            }
        }
    }

    // Repeating entries: each date in the window; one waiting to be confirmed is overdue. Daily ones are one line a month.
    for (const item of (await listRepeating(pool, userId)).filter(entry => entry.nextDue && !entry.paused)) {
        const dates = occurrences(ruleOf(item), item.nextDue!, to, item.endsOn, 400);
        const direction: Direction = item.type === 'expense' ? 'pay' : item.type === 'income' ? 'receive' : 'move';
        const amount = toPaise(item.amount);
        const base = { kind: 'repeating' as const, direction, account: item.account.name, estimated: false, href: '/transactions#repeating-section' };
        if (item.frequency === 'daily') {
            for (const month of months) {
                const inMonth = dates.filter(date => date.slice(0, 7) === month || (month === months[0] && date < from));
                if (inMonth.length === 0) continue;
                items.push({
                    ...base, date: inMonth[0]!, title: t('calendar.daily', { name: item.description, count: inMonth.length }), amount: amount * inMonth.length,
                    overdue: inMonth[0]! < today,
                });
            }
        } else {
            for (const date of dates) items.push({ ...base, date, title: item.description, amount, overdue: date < today });
        }
    }

    // Money due from or to people by a date
    const { people } = await listPeople(pool, userId);
    for (const person of people) {
        for (const loan of person.loans.filter(item => !item.closed && item.dueOn && inWindow(item.dueOn))) {
            items.push({
                date: loan.dueOn!, kind: 'person', title: t(loan.direction === 'lent' ? 'calendar.personOwes' : 'calendar.youOwe', { name: person.name }),
                amount: toPaise(loan.outstanding) + toPaise(loan.interestDue), direction: loan.direction === 'lent' ? 'receive' : 'pay', account: null,
                overdue: loan.dueOn! < today, estimated: false, href: '/people',
            });
        }
    }

    return summarise(items.filter(item => item.overdue || item.date >= today || item.kind === 'auction'), today);
}
