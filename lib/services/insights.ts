import type { Pool } from 'pg';
import { fromPaise } from '../ledger';
import { RequestError } from '../transaction';
import { t } from '../i18n';
import {
    MIN_HISTORY_MONTHS, UNUSUAL_MINIMUM_PAISE, UNUSUAL_RATIO, categoryInsights, findSubscriptions, monthsBetween, shiftMonth, type Charge,
} from '../../src/core/insights';
import { todayInIndia } from './recurring';

/**
 * Spending insights for a month (v2 Phase 2, src/core/insights.ts): category averages and changes,
 * unusual spend, regular and event spending side by side, a year's trend, and subscriptions. Regular
 * spending leaves out one-off events (a wedding does not move the averages); event spending is shown
 * beside it. Spending is the expense lines of entries that count, so a refund recorded in an expense
 * category lowers it.
 */

const money = (paise: number | null) => (paise === null ? null : fromPaise(paise));

export async function spendingInsights(pool: Pool, userId: number, monthParam: string | null, yearParam: string | null) {
    const today = todayInIndia();
    const month = monthParam && yearParam ? `${yearParam}-${String(monthParam).padStart(2, '0')}` : today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RequestError(400, t('errors.monthYearRequired'));
    const from = shiftMonth(month, -12);

    // Every expense line by month, category and event, for the 13 months up to this one
    const lines = await pool.query(
        `SELECT to_char(e.entry_date, 'YYYY-MM') AS month, a.id AS category_id, a.name AS category_name,
                e.event_id, ev.name AS event_name, coalesce(ev.one_off, false) AS one_off, sum(l.amount_paise)::bigint AS paise
         FROM journal_lines l
         JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
         JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
         LEFT JOIN events ev ON ev.user_id = e.user_id AND ev.id = e.event_id
         WHERE l.user_id = $1 AND e.voided_at IS NULL AND a.kind = 'expense'
           AND e.entry_date >= $2::date AND e.entry_date < ($3::date + interval '1 month')
         GROUP BY 1, 2, 3, 4, 5, 6`,
        [userId, `${from}-01`, `${month}-01`]);
    const first = await pool.query(
        `SELECT to_char(min(entry_date), 'YYYY-MM') AS month FROM journal_entries
         WHERE user_id = $1 AND voided_at IS NULL AND entry_type IN ('income', 'expense', 'transfer')`, [userId]);
    const firstMonth: string = first.rows[0]?.month ?? month;

    const names = new Map<number, string>();
    const regular = lines.rows.filter(row => !row.one_off);
    for (const row of lines.rows) names.set(Number(row.category_id), row.category_name);
    const insights = categoryInsights(regular.map(row => ({ month: row.month, categoryId: Number(row.category_id), paise: Number(row.paise) })), month, firstMonth)
        .filter(item => item.thisMonth !== 0 || (item.average3 ?? 0) !== 0 || item.lastMonth !== 0);

    const thisMonth = lines.rows.filter(row => row.month === month);
    const events = new Map<number, { id: number; name: string; paise: number }>();
    for (const row of thisMonth.filter(item => item.event_id !== null)) {
        const id = Number(row.event_id);
        const event = events.get(id) ?? { id, name: row.event_name, paise: 0 };
        event.paise += Number(row.paise);
        events.set(id, event);
    }
    const regularTotal = thisMonth.filter(row => !row.one_off).reduce((sum, row) => sum + Number(row.paise), 0);
    const oneOffTotal = thisMonth.filter(row => row.one_off).reduce((sum, row) => sum + Number(row.paise), 0);

    const trend = monthsBetween(shiftMonth(month, -11), month).map(item => ({
        month: item,
        regular: fromPaise(regular.filter(row => row.month === item).reduce((sum, row) => sum + Number(row.paise), 0)),
        oneOff: fromPaise(lines.rows.filter(row => row.month === item && row.one_off).reduce((sum, row) => sum + Number(row.paise), 0)),
    }));

    // Subscriptions: every expense of the last 15 months, with the account it was paid from
    const charges = await pool.query(
        `SELECT e.entry_date::text AS date, e.description, l.amount_paise, l.account_id AS category_id, m.account_id
         FROM journal_entries e
         JOIN journal_lines l ON l.user_id = e.user_id AND l.entry_id = e.id
         JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id AND a.kind = 'expense'
         JOIN LATERAL (SELECT x.account_id FROM journal_lines x WHERE x.user_id = e.user_id AND x.entry_id = e.id AND x.amount_paise < 0 LIMIT 1) m ON true
         WHERE e.user_id = $1 AND e.voided_at IS NULL AND e.entry_type = 'expense' AND l.amount_paise > 0
           AND e.entry_date > ($2::date - interval '15 months')`,
        [userId, today]);
    const accounts = await pool.query('SELECT id, name FROM ledger_accounts WHERE user_id = $1', [userId]);
    const accountNames = new Map(accounts.rows.map(row => [Number(row.id), row.name as string]));
    const subscriptions = findSubscriptions(charges.rows.map((row): Charge => ({
        date: row.date, description: row.description, paise: Number(row.amount_paise), categoryId: Number(row.category_id), accountId: Number(row.account_id),
    })), today);
    const active = subscriptions.filter(item => item.status !== 'stopped');

    return {
        month,
        thresholds: { unusualRatio: UNUSUAL_RATIO, unusualMinimum: fromPaise(UNUSUAL_MINIMUM_PAISE), historyMonths: MIN_HISTORY_MONTHS },
        firstMonth,
        spending: {
            regular: fromPaise(regularTotal), oneOff: fromPaise(oneOffTotal),
            events: [...events.values()].sort((a, b) => b.paise - a.paise).map(event => ({ id: event.id, name: event.name, amount: fromPaise(event.paise) })),
        },
        categories: insights.map(item => ({
            id: item.categoryId, name: names.get(item.categoryId) ?? '', thisMonth: fromPaise(item.thisMonth), lastMonth: fromPaise(item.lastMonth),
            average3: money(item.average3), average6: money(item.average6), average12: money(item.average12), change3: item.change3, unusual: item.unusual,
        })),
        trend,
        subscriptions: {
            monthly: fromPaise(active.reduce((sum, item) => sum + item.monthlyPaise, 0)),
            yearly: fromPaise(active.reduce((sum, item) => sum + item.yearlyPaise, 0)),
            items: subscriptions.map(item => ({
                description: item.description, cadence: item.cadence, charges: item.charges, first: item.first, last: item.last,
                lastAmount: fromPaise(item.lastPaise), monthly: fromPaise(item.monthlyPaise), yearly: fromPaise(item.yearlyPaise),
                category: item.categoryId === null ? null : names.get(item.categoryId) ?? accountNames.get(item.categoryId) ?? null,
                account: accountNames.get(item.accountId) ?? null, status: item.status, priceRiseFrom: item.priceRiseFrom === null ? null : fromPaise(item.priceRiseFrom),
            })),
        },
    };
}
