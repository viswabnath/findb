import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { logActivity } from '../activity-log';
import { RequestError, withTransaction } from '../transaction';
import { accountBalance, moneyAccount, recordExpense, recordIncome, toPaise, voidEntries } from '../ledger';

/**
 * Income and expenses: the transaction routes moved from the former Express app (N3). Every write
 * runs in one transaction with the entry, its ledger entry (lib/ledger.ts), which is where every
 * balance comes from, and the activity entry, and locks the rows it checks (FOR UPDATE). An edit
 * voids the entry's ledger record and records the new one; a delete voids it.
 */

type Body = Record<string, unknown>;
type Client = Pick<PoolClient, 'query'>;

/**
 * An entry's calendar date as stored: YYYY-MM-DD with its month and year, read from the string
 * itself (never through the server's time zone). Null for a date that does not exist.
 */
export function entryDate(value: unknown): { date: string; month: number; year: number } | null {
    if (typeof value !== 'string' || value === '') return null;
    let day = value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return null;
        day = parsed.toISOString().slice(0, 10);
    }
    const [year, month, dayOfMonth] = day.split('-').map(Number) as [number, number, number];
    // Rejects dates that do not exist, such as 2026-02-30
    if (new Date(Date.UTC(year, month - 1, dayOfMonth)).toISOString().slice(0, 10) !== day) return null;
    return { date: day, month, year };
}

function requireEntryDate(value: unknown, requiredMessage?: string) {
    if (requiredMessage && !value) throw new RequestError(400, requiredMessage);
    const entry = entryDate(value);
    if (!entry) throw new RequestError(400, 'Invalid date format');
    return entry;
}

/**
 * Refuse an account the user does not own. Entries used to accept any account id the client
 * sent: the balance update (limited to the user's rows) then changed nothing, and the entry
 * pointed at someone else's account.
 */
async function requireOwnAccount(client: Client, userId: number, type: unknown, id: unknown, allowed: readonly string[]) {
    if (typeof type !== 'string' || !allowed.includes(type)) throw new RequestError(400, 'Invalid account type');
    if (type === 'cash') return;
    const table = type === 'bank' ? 'banks' : 'credit_cards';
    const owned = await client.query(`SELECT id FROM ${table} WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (owned.rows.length === 0) throw new RequestError(400, type === 'bank' ? 'Bank not found' : 'Credit card not found');
}

const INCOME_ACCOUNTS = ['bank', 'cash'] as const;
const EXPENSE_ACCOUNTS = ['bank', 'cash', 'credit_card'] as const;

/** Account ids are whole numbers; anything else cannot be one of the user's accounts */
function accountId(type: unknown, id: unknown): unknown {
    if (type === 'cash') return id ?? null;
    return /^\d+$/.test(String(id)) ? id : -1;
}

// ----- Income -----

export async function listIncome(pool: Pool, userId: number, month: string | null, year: string | null): Promise<QueryResultRow[]> {
    let query = `
        SELECT i.*,
               CASE
                   WHEN i.credited_to_type = 'bank' THEN b.name
                   WHEN i.credited_to_type = 'cash' THEN 'Cash'
                   WHEN i.credited_to_type = 'credit_card' THEN cc.name
                   ELSE 'Unknown'
               END as credited_to_name
        FROM income_entries i
        LEFT JOIN banks b ON i.credited_to_type = 'bank' AND i.credited_to_id = b.id
        LEFT JOIN credit_cards cc ON i.credited_to_type = 'credit_card' AND i.credited_to_id = cc.id
        WHERE i.user_id = $1`;
    const params: unknown[] = [userId];
    if (month && year) {
        query += ' AND i.month = $2 AND i.year = $3';
        params.push(month, year);
    }
    query += ' ORDER BY i.date DESC';
    return (await pool.query(query, params)).rows;
}

export async function getIncome(pool: Pool, userId: number, id: string): Promise<QueryResultRow> {
    const result = await pool.query('SELECT * FROM income_entries WHERE id = $1 AND user_id = $2', [id, userId]);
    if (result.rows.length === 0) throw new RequestError(404, 'Income transaction not found');
    return result.rows[0];
}

export async function addIncome(pool: Pool, userId: number, body: Body): Promise<QueryResultRow> {
    const { source, amount, creditedToType, creditedToId } = body;
    const entry = requireEntryDate(body.date, 'Date is required');
    return withTransaction(pool, async (client) => {
        await requireOwnAccount(client, userId, creditedToType, accountId(creditedToType, creditedToId), INCOME_ACCOUNTS);
        const result = await client.query(
            'INSERT INTO income_entries (user_id, source, amount, credited_to_type, credited_to_id, date, month, year) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
            [userId, source, amount, creditedToType, creditedToId, entry.date, entry.month, entry.year],
        );
        await recordIncome(client, userId, { ...result.rows[0], date: entry.date });
        await logActivity(client, userId, 'created', 'income', result.rows[0].id, `Added income: ${source}`, amount);
        return result.rows[0];
    });
}

export async function updateIncome(pool: Pool, userId: number, id: string, body: Body): Promise<void> {
    const { source, amount, creditedToType, creditedToId } = body;
    const entry = requireEntryDate(body.date);
    await withTransaction(pool, async (client) => {
        // Locked so concurrent edits of the same entry run one after the other
        const current = await client.query('SELECT * FROM income_entries WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
        if (current.rows.length === 0) throw new RequestError(404, 'Income transaction not found');
        const old = current.rows[0];
        await requireOwnAccount(client, userId, creditedToType, accountId(creditedToType, creditedToId), INCOME_ACCOUNTS);
        await client.query(
            'UPDATE income_entries SET source = $1, amount = $2, credited_to_type = $3, credited_to_id = $4, date = $5, month = $6, year = $7 WHERE id = $8 AND user_id = $9',
            [source, amount, creditedToType, creditedToId, entry.date, entry.month, entry.year, id, userId],
        );
        await voidEntries(client, userId, 'income_entries', id);
        await recordIncome(client, userId, { id, source: String(source), amount, credited_to_type: creditedToType, credited_to_id: creditedToId, date: entry.date });
        await logActivity(client, userId, 'updated', 'income', Number(id), `Updated income: ${source}`, amount,
            { source: old.source, amount: old.amount, credited_to_type: old.credited_to_type, credited_to_id: old.credited_to_id },
            { source, amount, creditedToType, creditedToId });
    });
}

export async function deleteIncome(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const current = await client.query('SELECT * FROM income_entries WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
        if (current.rows.length === 0) throw new RequestError(404, 'Income transaction not found');
        const old = current.rows[0];
        await client.query('DELETE FROM income_entries WHERE id = $1 AND user_id = $2', [id, userId]);
        await voidEntries(client, userId, 'income_entries', id);
        await logActivity(client, userId, 'deleted', 'income', Number(id), `Deleted income: ${old.source}`, old.amount);
    });
}

// ----- Expenses -----

export async function listExpenses(pool: Pool, userId: number, month: string | null, year: string | null): Promise<QueryResultRow[]> {
    let query = `
        SELECT e.*,
               CASE
                   WHEN e.payment_method = 'bank' THEN b.name
                   WHEN e.payment_method = 'cash' THEN 'Cash'
                   WHEN e.payment_method = 'credit_card' THEN cc.name
                   ELSE 'Unknown'
               END as payment_source_name
        FROM expenses e
        LEFT JOIN banks b ON e.payment_method = 'bank' AND e.payment_source_id = b.id
        LEFT JOIN credit_cards cc ON e.payment_method = 'credit_card' AND e.payment_source_id = cc.id
        WHERE e.user_id = $1`;
    const params: unknown[] = [userId];
    if (month && year) {
        query += ' AND e.month = $2 AND e.year = $3';
        params.push(month, year);
    }
    query += ' ORDER BY e.date DESC';
    return (await pool.query(query, params)).rows;
}

export async function getExpense(pool: Pool, userId: number, id: string): Promise<QueryResultRow> {
    const result = await pool.query('SELECT * FROM expenses WHERE id = $1 AND user_id = $2', [id, userId]);
    if (result.rows.length === 0) throw new RequestError(404, 'Expense transaction not found');
    return result.rows[0];
}

/**
 * Users who also track income cannot overspend: the bank, cash or card must cover the amount.
 * Expenses-only users skip this check (their balances still change). Rows are locked so two
 * expenses cannot both pass the check. The balance is the ledger's, compared in whole paise.
 */
async function checkCanSpend(client: Client, userId: number, method: unknown, sourceId: unknown, amount: unknown) {
    const user = await client.query('SELECT tracking_option FROM users WHERE id = $1', [userId]);
    if ((user.rows[0]?.tracking_option || 'both') === 'expenses') return;

    const needed = toPaise(amount);
    const locked = method === 'bank' ? await client.query('SELECT id FROM banks WHERE id = $1 AND user_id = $2 FOR UPDATE', [sourceId, userId])
        : method === 'cash' ? await client.query('SELECT id FROM cash_balance WHERE user_id = $1 FOR UPDATE', [userId])
            : await client.query('SELECT credit_limit FROM credit_cards WHERE id = $1 AND user_id = $2 FOR UPDATE', [sourceId, userId]);
    const missing = locked.rows.length === 0;
    const balance = missing ? 0 : await accountBalance(client, await moneyAccount(client, userId, method, sourceId));
    if (method === 'bank' && (missing || balance < needed)) throw new RequestError(400, 'Insufficient bank balance');
    if (method === 'cash' && (missing || balance < needed)) throw new RequestError(400, 'Insufficient cash balance');
    // A card's balance is negative by the amount owed, so the room left is the limit plus the balance
    if (method === 'credit_card' && (missing || toPaise(locked.rows[0].credit_limit) + balance < needed)) {
        throw new RequestError(400, 'Insufficient credit limit');
    }
}

export async function addExpense(pool: Pool, userId: number, body: Body): Promise<QueryResultRow> {
    const { title, amount, paymentMethod, paymentSourceId } = body;
    const entry = requireEntryDate(body.date, 'Date is required');
    return withTransaction(pool, async (client) => {
        await requireOwnAccount(client, userId, paymentMethod, accountId(paymentMethod, paymentSourceId), EXPENSE_ACCOUNTS);
        await checkCanSpend(client, userId, paymentMethod, paymentSourceId, amount);
        const result = await client.query(
            'INSERT INTO expenses (user_id, title, amount, payment_method, payment_source_id, date, month, year) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
            [userId, title, amount, paymentMethod, paymentSourceId, entry.date, entry.month, entry.year],
        );
        await recordExpense(client, userId, { ...result.rows[0], date: entry.date });
        await logActivity(client, userId, 'created', 'expense', result.rows[0].id, `Added expense: ${title}`, amount);
        return result.rows[0];
    });
}

export async function updateExpense(pool: Pool, userId: number, id: string, body: Body): Promise<void> {
    const { title, amount, paymentMethod, paymentSourceId } = body;
    const entry = requireEntryDate(body.date);
    await withTransaction(pool, async (client) => {
        // Locked so concurrent edits of the same entry run one after the other
        const current = await client.query('SELECT * FROM expenses WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
        if (current.rows.length === 0) throw new RequestError(404, 'Expense transaction not found');
        const old = current.rows[0];
        await requireOwnAccount(client, userId, paymentMethod, accountId(paymentMethod, paymentSourceId), EXPENSE_ACCOUNTS);
        await client.query(
            'UPDATE expenses SET title = $1, amount = $2, payment_method = $3, payment_source_id = $4, date = $5, month = $6, year = $7 WHERE id = $8 AND user_id = $9',
            [title, amount, paymentMethod, paymentSourceId, entry.date, entry.month, entry.year, id, userId],
        );
        await voidEntries(client, userId, 'expenses', id);
        await recordExpense(client, userId, { id, title: String(title), amount, payment_method: paymentMethod, payment_source_id: paymentSourceId, date: entry.date });
        await logActivity(client, userId, 'updated', 'expense', Number(id), `Updated expense: ${title}`, amount,
            { title: old.title, amount: old.amount, payment_method: old.payment_method, payment_source_id: old.payment_source_id },
            { title, amount, paymentMethod, paymentSourceId });
    });
}

export async function deleteExpense(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const current = await client.query('SELECT * FROM expenses WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
        if (current.rows.length === 0) throw new RequestError(404, 'Expense transaction not found');
        const old = current.rows[0];
        await client.query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [id, userId]);
        await voidEntries(client, userId, 'expenses', id);
        await logActivity(client, userId, 'deleted', 'expense', Number(id), `Deleted expense: ${old.title}`, old.amount);
    });
}
