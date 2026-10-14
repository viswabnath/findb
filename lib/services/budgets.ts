import type { Pool } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, toPaise } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { t } from '../i18n';
import { lockedCategory } from './categories';
import { todayInIndia } from './recurring';
import { entryDate } from './transactions';

/**
 * Budgets (v2 Phase 2): a monthly limit for a spending category. What is spent against it is read
 * from the ledger: the category's expense lines dated in the month (events included: the money was
 * spent), less any refund recorded in it. A budget is "near" from 80% and "over" from 100%; the
 * screens warn at both.
 */

type Body = Record<string, unknown>;

/** Alerts: near the limit from this share, over it from the whole */
export const NEAR_PERCENT = 80;

export type BudgetState = 'ok' | 'near' | 'over';

export interface Budget {
    id: number;
    category: { id: number; name: string };
    amount: string;
    spent: string;
    left: string;
    /** Spent as a whole percentage of the limit */
    percent: number;
    state: BudgetState;
}

export function budgetState(spentPaise: number, limitPaise: number): BudgetState {
    if (spentPaise >= limitPaise) return 'over';
    return spentPaise * 100 >= limitPaise * NEAR_PERCENT ? 'near' : 'ok';
}

function monthStart(month: string | null, year: string | null): string {
    if (!month && !year) return `${todayInIndia().slice(0, 7)}-01`;
    const m = Number(month);
    const y = Number(year);
    if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 1900 || y > 9999) {
        throw new RequestError(400, t('errors.monthYearRequired'));
    }
    return `${y}-${String(m).padStart(2, '0')}-01`;
}

const BUDGET_QUERY = `
    SELECT b.id, b.amount_paise, a.id AS category_id, a.name AS category_name,
           COALESCE((SELECT sum(l.amount_paise) FROM journal_lines l JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
                     WHERE l.user_id = b.user_id AND l.account_id = b.category_id AND e.voided_at IS NULL
                       AND e.entry_date >= $2::date AND e.entry_date < ($2::date + interval '1 month')), 0)::bigint AS spent_paise
    FROM budgets b JOIN ledger_accounts a ON a.user_id = b.user_id AND a.id = b.category_id
    WHERE b.user_id = $1 AND a.archived_at IS NULL`;

function toBudget(row: Record<string, unknown>): Budget {
    const limit = Number(row.amount_paise);
    const spent = Math.max(Number(row.spent_paise), 0);
    return {
        id: Number(row.id), category: { id: Number(row.category_id), name: String(row.category_name) },
        amount: fromPaise(limit), spent: fromPaise(spent), left: fromPaise(limit - spent),
        percent: Math.floor((spent * 100) / limit), state: budgetState(spent, limit),
    };
}

/** The user's budgets with what was spent in a month (this month when left out), fullest first */
export async function listBudgets(pool: Pool, userId: number, month: string | null, year: string | null): Promise<Budget[]> {
    const result = await pool.query(`${BUDGET_QUERY} ORDER BY lower(a.name)`, [userId, monthStart(month, year)]);
    return result.rows.map(toBudget).sort((a, b) => b.percent - a.percent || a.category.name.localeCompare(b.category.name));
}

/**
 * The budget of one category in the month of a date: for the warning after an entry is saved.
 * Null when the category has no budget.
 */
export async function budgetFor(pool: Pool, userId: number, categoryId: unknown, date: unknown): Promise<Budget | null> {
    if (!/^\d+$/.test(String(categoryId ?? ''))) throw new RequestError(400, t('errors.categoryNotFound'));
    const day = date ? entryDate(date)?.date : todayInIndia();
    if (!day) throw new RequestError(400, t('errors.invalidDateFormat'));
    const result = await pool.query(`${BUDGET_QUERY} AND b.category_id = $3`, [userId, `${day.slice(0, 7)}-01`, categoryId]);
    return result.rows[0] ? toBudget(result.rows[0]) : null;
}

/** { categoryId, amount }: set a spending category's monthly limit (a second time changes it) */
export async function setBudget(pool: Pool, userId: number, body: Body): Promise<Budget> {
    let paise: number;
    try {
        paise = toPaise(body.amount);
    } catch {
        throw new RequestError(400, t('errors.enterValidAmount'));
    }
    if (paise <= 0) throw new RequestError(400, t('errors.enterAmountGreaterThanZero'));
    return withTransaction(pool, async (client) => {
        const category = await lockedCategory(client, userId, body.categoryId);
        if (category.kind !== 'expense') throw new RequestError(400, t('errors.budgets.spendingOnly'));
        const before = await client.query('SELECT amount_paise FROM budgets WHERE user_id = $1 AND category_id = $2', [userId, category.id]);
        const saved = await client.query(
            `INSERT INTO budgets (user_id, category_id, amount_paise) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, category_id) DO UPDATE SET amount_paise = excluded.amount_paise, updated_at = now()
             RETURNING id`,
            [userId, category.id, paise]);
        const id = Number(saved.rows[0].id);
        const old = before.rows[0] ? fromPaise(before.rows[0].amount_paise) : null;
        await logActivity(client, userId, old ? 'updated' : 'created', 'budget', id, `${old ? 'Changed' : 'Set'} budget: ${category.name}`, fromPaise(paise),
            old ? { categoryName: category.name, amount: old } : null, { categoryName: category.name, amount: fromPaise(paise) });
        const result = await client.query(`${BUDGET_QUERY} AND b.id = $3`, [userId, `${todayInIndia().slice(0, 7)}-01`, id]);
        return toBudget(result.rows[0]);
    });
}

export async function deleteBudget(pool: Pool, userId: number, id: string): Promise<void> {
    if (!/^\d+$/.test(id)) throw new RequestError(404, t('errors.budgets.notFound'));
    await withTransaction(pool, async (client) => {
        const removed = await client.query(
            `DELETE FROM budgets b USING ledger_accounts a
             WHERE b.id = $1 AND b.user_id = $2 AND a.user_id = b.user_id AND a.id = b.category_id
             RETURNING b.amount_paise, a.name`, [id, userId]);
        if (removed.rows.length === 0) throw new RequestError(404, t('errors.budgets.notFound'));
        const row = removed.rows[0];
        await logActivity(client, userId, 'deleted', 'budget', Number(id), `Removed budget: ${row.name}`, null,
            { categoryName: row.name, amount: fromPaise(row.amount_paise) }, null);
    });
}
