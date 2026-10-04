import type { Pool, QueryResultRow } from 'pg';
import { RequestError } from '../transaction';
import { balances, flows, fromPaise } from '../ledger';

/**
 * Monthly summary and activity feed: the report routes moved from the former Express app (N3),
 * with the same response shapes. The summary's totals and balances come from the ledger
 * (docs/ledger.md), and the activity feed's account-name lookups are limited to the user's own
 * accounts (see activityAccountInfo).
 */

// ----- Monthly summary -----

const EMPTY_SUMMARY = {
    monthlyIncome: 0,
    totalCurrentWealth: 0,
    totalExpenses: 0,
    netSavings: 0,
    totalInitialBalance: 0,
    banks: [],
    creditCards: [],
    cash: { balance: 0, initial_balance: 0 },
};

/** The summary for a month: totals, balances at the month's end, and "no data" messages */
export async function monthlySummary(pool: Pool, userId: number, month: string | null, year: string | null): Promise<Record<string, unknown>> {
    if (!month || !year) throw new RequestError(400, 'Month and year are required');

    const selectedMonth = parseInt(month, 10);
    const selectedYear = parseInt(year, 10);
    const now = new Date();
    const selectedDate = new Date(selectedYear, selectedMonth - 1, 1);
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const isCurrentMonth = selectedMonth === currentMonth && selectedYear === currentYear;
    const isMonthCompleted = selectedYear < currentYear || (selectedYear === currentYear && selectedMonth < currentMonth);

    if (selectedDate > now) {
        return {
            ...EMPTY_SUMMARY, trackingOption: 'both', isCurrentMonth: false, isMonthCompleted: false,
            message: 'Future date selected - no data available',
        };
    }

    const userResult = await pool.query(
        'SELECT created_at, COALESCE(tracking_option, \'both\') as tracking_option FROM users WHERE id = $1',
        [userId],
    );
    if (userResult.rows.length === 0) throw new RequestError(404, 'User not found');

    const registrationDate = new Date(userResult.rows[0].created_at);
    const trackingOption: string = userResult.rows[0].tracking_option;
    const registrationMonth = registrationDate.getMonth() + 1;
    const registrationYear = registrationDate.getFullYear();
    if (selectedYear < registrationYear || (selectedYear === registrationYear && selectedMonth < registrationMonth)) {
        return {
            ...EMPTY_SUMMARY, trackingOption, isCurrentMonth: false, isMonthCompleted: true,
            message: 'Date before registration - no data available',
        };
    }

    // The month's first and last day as text, never through the server's time zone
    const pad = (n: number) => String(n).padStart(2, '0');
    const firstDay = `${selectedYear}-${pad(selectedMonth)}-01`;
    const lastDay = `${selectedYear}-${pad(selectedMonth)}-${pad(new Date(Date.UTC(selectedYear, selectedMonth, 0)).getUTCDate())}`;
    const monthFlows = await flows(pool, userId, firstDay, lastDay);
    // Balances at the end of the month: every entry dated on or before its last day
    const ledger = await balances(pool, userId, lastDay);

    // The accounts that existed by the month's end (the last day, at its start: legacy behaviour)
    const endOfMonth = new Date(selectedYear, selectedMonth, 0);
    const banks = await pool.query('SELECT id, name, initial_balance FROM banks WHERE user_id = $1 AND created_at <= $2', [userId, endOfMonth]);
    const bankResult = {
        rows: banks.rows.map(bank => ({ ...bank, balance_at_month_end: fromPaise(ledger.banks.get(Number(bank.id)) ?? 0) })),
    };

    const cashResult = await pool.query('SELECT COALESCE(initial_balance, 0) AS initial_balance FROM cash_balance WHERE user_id = $1', [userId]);
    const cashRow: QueryResultRow = cashResult.rows.length === 0
        ? { initial_balance: 0, cash_balance_at_month_end: 0 }
        : { ...cashResult.rows[0], cash_balance_at_month_end: fromPaise(ledger.system.cash ?? 0) };

    let creditCards: QueryResultRow[] = [];
    if (trackingOption === 'expenses' || trackingOption === 'both') {
        const cards = await pool.query('SELECT * FROM credit_cards WHERE user_id = $1 AND created_at <= $2', [userId, endOfMonth]);
        creditCards = cards.rows.map((card) => {
            // A card's ledger balance is negative by the amount owed
            const used = fromPaise(-(ledger.cards.get(Number(card.id)) ?? 0));
            return { ...card, current_balance: used, used_limit: used };
        });
    }

    const monthIncome = monthFlows.income / 100;
    const monthExpenses = monthFlows.expenses / 100;
    const totalBankBalance = bankResult.rows.reduce((sum, bank) => sum + parseFloat(bank.balance_at_month_end || 0), 0);
    const totalCurrentWealth = totalBankBalance + parseFloat(cashRow.cash_balance_at_month_end || 0);
    const totalInitialBankBalance = bankResult.rows.reduce((sum, bank) => sum + parseFloat(bank.initial_balance || 0), 0);
    const totalInitialBalance = totalInitialBankBalance + parseFloat(cashRow.initial_balance || 0);
    const netSavings = totalInitialBalance + monthIncome - monthExpenses;

    // Registered, but no entries this month and no accounts set up yet
    const hasNoAccountsSetup = bankResult.rows.length === 0 && (cashRow.initial_balance || 0) === 0;
    if (monthIncome === 0 && monthExpenses === 0 && hasNoAccountsSetup) {
        return {
            ...EMPTY_SUMMARY, trackingOption, isCurrentMonth, isMonthCompleted,
            message: 'No transactions found for this month',
        };
    }

    return {
        monthlyIncome: monthIncome,
        totalCurrentWealth,
        totalExpenses: monthExpenses,
        netSavings,
        totalInitialBalance,
        banks: bankResult.rows.map((bank) => ({ ...bank, current_balance: bank.balance_at_month_end })),
        creditCards,
        cash: { balance: cashRow.cash_balance_at_month_end || 0, initial_balance: cashRow.initial_balance || 0 },
        selectedMonth,
        selectedYear,
        trackingOption,
        isCurrentMonth,
        isMonthCompleted,
        message: null,
    };
}

// ----- Activity feed -----

/**
 * The account an entry was about. Every lookup is limited to the user's own accounts: entries
 * carry account ids the client sent, and an unscoped lookup could show another user's account
 * name (the Express query had this flaw).
 */
const activityAccountInfo = `
    CASE
        WHEN entity_type = 'cash_balance' THEN 'Cash'
        WHEN entity_type = 'bank' THEN
            COALESCE((SELECT name FROM banks WHERE id = entity_id AND user_id = activity_log.user_id), 'Bank')
        WHEN entity_type = 'credit_card' THEN
            COALESCE((SELECT name FROM credit_cards WHERE id = entity_id AND user_id = activity_log.user_id), 'Credit Card')
        WHEN entity_type = 'income' AND new_values->>'creditedToType' = 'bank' THEN
            COALESCE((SELECT name FROM banks WHERE id = (new_values->>'creditedToId')::int AND user_id = activity_log.user_id), 'Bank')
        WHEN entity_type = 'income' AND new_values->>'creditedToType' = 'cash' THEN 'Cash'
        WHEN entity_type = 'expense' AND (new_values->>'paymentMethod' = 'bank' OR old_values->>'payment_method' = 'bank') THEN
            COALESCE(
                (SELECT name FROM banks WHERE id = (new_values->>'paymentSourceId')::int AND user_id = activity_log.user_id),
                (SELECT name FROM banks WHERE id = (old_values->>'payment_source_id')::int AND user_id = activity_log.user_id),
                'Bank'
            )
        WHEN entity_type = 'expense' AND (new_values->>'paymentMethod' = 'credit_card' OR old_values->>'payment_method' = 'credit_card') THEN
            COALESCE(
                (SELECT name FROM credit_cards WHERE id = (new_values->>'paymentSourceId')::int AND user_id = activity_log.user_id),
                (SELECT name FROM credit_cards WHERE id = (old_values->>'payment_source_id')::int AND user_id = activity_log.user_id),
                'Credit Card'
            )
        WHEN entity_type = 'expense' AND (new_values->>'paymentMethod' = 'cash' OR old_values->>'payment_method' = 'cash') THEN 'Cash'
        ELSE 'System'
    END`;

export interface ActivityQuery {
    page: string | null;
    limit: string | null;
    type: string | null;
    month: string | null;
    year: string | null;
    fromDate: string | null;
    toDate: string | null;
}

/** One CSV field: always quoted, quotes doubled, formula-like text prefixed with an apostrophe */
export function csvField(value: unknown): string {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

/** The filters as SQL conditions and their parameters ($1 is the user id) */
function activityFilters(userId: number, query: ActivityQuery) {
    const conditions: string[] = [];
    const params: unknown[] = [userId];
    const add = (condition: (placeholder: string) => string, value: unknown) => {
        params.push(value);
        conditions.push(condition(`$${params.length}`));
    };

    const { month, year } = query;
    if (month && year) {
        const nextMonth = parseInt(month, 10) === 12 ? 1 : parseInt(month, 10) + 1;
        const nextYear = parseInt(month, 10) === 12 ? parseInt(year, 10) + 1 : parseInt(year, 10);
        add(p => `created_at >= ${p}`, `${year}-${month.padStart(2, '0')}-01`);
        add(p => `created_at < ${p}`, `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`);
    } else if (year) {
        add(p => `created_at >= ${p}`, `${year}-01-01`);
        add(p => `created_at < ${p}`, `${parseInt(year, 10) + 1}-01-01`);
    } else {
        if (query.fromDate) add(p => `created_at >= ${p}`, query.fromDate);
        if (query.toDate) add(p => `created_at <= ${p}`, query.toDate);
    }
    if (query.type) add(p => `entity_type = ${p}`, query.type);

    return { sql: conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '', params };
}

/** A page of the activity feed with its counts and statistics */
export async function activityPage(pool: Pool, userId: number, query: ActivityQuery): Promise<Record<string, unknown>> {
    // Whole numbers only; bad values fall back to the defaults
    const page = Math.max(1, parseInt(query.page ?? '', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '', 10) || 20));
    const filters = activityFilters(userId, query);

    const activities = await pool.query(`
        SELECT entity_type as activity_type, entity_id as id, description, amount,
               ${activityAccountInfo} as account_info,
               created_at as activity_date, action_type, old_values, new_values
        FROM activity_log
        WHERE user_id = $1${filters.sql}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`, filters.params);

    const count = await pool.query(`SELECT COUNT(*) as total FROM activity_log WHERE user_id = $1${filters.sql}`, filters.params);
    const totalItems = parseInt(count.rows[0].total, 10);

    const statistics = await pool.query(`
        SELECT
            (SELECT COUNT(*) FROM income_entries WHERE user_id = $1) +
            (SELECT COUNT(*) FROM expenses WHERE user_id = $1) +
            (SELECT COUNT(*) FROM banks WHERE user_id = $1) +
            (SELECT COUNT(*) FROM credit_cards WHERE user_id = $1) +
            (SELECT COUNT(*) FROM cash_balance WHERE user_id = $1 AND initial_balance > 0) as totalTransactions,
            (SELECT COALESCE(SUM(amount), 0) FROM income_entries WHERE user_id = $1) as totalIncome,
            (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE user_id = $1) as totalExpenses,
            (SELECT COALESCE(SUM(amount), 0) FROM income_entries WHERE user_id = $1) -
            (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE user_id = $1) as netBalance`, [userId]);

    return {
        activities: activities.rows,
        statistics: statistics.rows[0] || { totalTransactions: 0, totalIncome: 0, totalExpenses: 0, netBalance: 0 },
        currentPage: page,
        totalPages: Math.ceil(totalItems / limit),
        totalItems,
        limit,
    };
}

/** Every matching entry as CSV (no paging) */
export async function activityCsv(pool: Pool, userId: number, query: ActivityQuery): Promise<string> {
    const filters = activityFilters(userId, query);
    const result = await pool.query(`
        SELECT entity_type as activity_type, description, amount,
               ${activityAccountInfo} as account_info,
               created_at as activity_date
        FROM activity_log
        WHERE user_id = $1${filters.sql}
        ORDER BY created_at DESC`, filters.params);
    const rows = result.rows.map((activity) => [
        new Date(activity.activity_date).toLocaleDateString(),
        activity.activity_type,
        activity.description,
        parseFloat(activity.amount || 0).toFixed(2),
        activity.account_info || '',
    ].map(csvField).join(','));
    return `Date,Type,Description,Amount,Account\n${rows.join('\n')}`;
}
