import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, postEntry, systemAccount, toPaise } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { lockedMoneyAccount } from './entries';
import { entryDate } from './transactions';

/**
 * Reconciliation (docs/ledger.md): checking an account against a statement. The user enters the
 * balance the statement shows on a date and ticks the entries that appear on it; the difference is
 * the statement balance less every cleared line. At zero the reconciliation is finished, and its
 * lines are protected: changing one warns first (entries.ts). A difference that cannot be found can
 * be closed with an adjustment entry, so it is recorded rather than hidden.
 *
 * Amounts follow the statement: money in the account, or for a credit card, the amount owed.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;

export interface ReconciliationLine {
    lineId: number;
    entryId: number;
    date: string;
    description: string;
    /** Money in (positive) or out (negative), as the statement shows it */
    amount: string;
    ticked: boolean;
}

export interface Reconciliation {
    id: number;
    account: { id: number; name: string; type: string };
    statementDate: string;
    statementBalance: string;
    status: 'open' | 'done';
    /** Cleared by earlier finished reconciliations */
    previouslyCleared: string;
    /** Previously cleared plus what is ticked now */
    clearedBalance: string;
    /** Statement balance less the cleared balance: zero when everything is accounted for */
    difference: string;
    lines: ReconciliationLine[];
    completedAt: string | null;
}

/** A card's statement shows what is owed; the ledger holds it as a negative balance */
const statementSign = (type: string) => (type === 'credit_card' ? -1 : 1);

async function load(client: Client, userId: number, id: unknown, lock = false): Promise<Reconciliation> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, 'Reconciliation not found');
    const head = await client.query(
        `SELECT r.id, r.account_id, r.statement_date::text AS statement_date, r.statement_balance_paise, r.status, r.completed_at,
                a.name AS account_name, a.subtype
         FROM reconciliations r JOIN ledger_accounts a ON a.user_id = r.user_id AND a.id = r.account_id
         WHERE r.id = $1 AND r.user_id = $2${lock ? ' FOR UPDATE OF r' : ''}`,
        [id, userId]);
    const row = head.rows[0];
    if (!row) throw new RequestError(404, 'Reconciliation not found');
    const sign = statementSign(row.subtype);
    const done = await client.query(
        `SELECT COALESCE(SUM(l.amount_paise), 0)::bigint AS paise
         FROM journal_lines l JOIN reconciliations r ON r.user_id = l.user_id AND r.id = l.reconciliation_id
         JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
         WHERE l.user_id = $1 AND l.account_id = $2 AND r.status = 'done' AND r.id <> $3 AND e.voided_at IS NULL`,
        [userId, row.account_id, row.id]);
    // The lines to choose from: not cleared by another reconciliation, dated by the statement date
    const lines = await client.query(
        `SELECT l.id, l.entry_id, l.amount_paise, l.reconciliation_id, e.entry_date::text AS date, e.description
         FROM journal_lines l JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
         WHERE l.user_id = $1 AND l.account_id = $2 AND e.voided_at IS NULL AND e.entry_date <= $3::date
           AND (l.reconciliation_id IS NULL OR l.reconciliation_id = $4)
         ORDER BY e.entry_date, l.id`,
        [userId, row.account_id, row.statement_date, row.id]);
    const previouslyCleared = Number(done.rows[0].paise);
    const ticked = lines.rows.filter(line => line.reconciliation_id !== null).reduce((sum, line) => sum + Number(line.amount_paise), 0);
    const statement = Number(row.statement_balance_paise);
    return {
        id: Number(row.id),
        account: { id: Number(row.account_id), name: row.account_name, type: row.subtype },
        statementDate: row.statement_date,
        statementBalance: fromPaise(statement),
        status: row.status,
        previouslyCleared: fromPaise(sign * previouslyCleared),
        clearedBalance: fromPaise(sign * (previouslyCleared + ticked)),
        difference: fromPaise(statement - sign * (previouslyCleared + ticked)),
        lines: (row.status === 'done' ? lines.rows.filter(line => line.reconciliation_id !== null) : lines.rows).map(line => ({
            lineId: Number(line.id), entryId: Number(line.entry_id), date: line.date, description: line.description,
            amount: fromPaise(sign * Number(line.amount_paise)), ticked: line.reconciliation_id !== null,
        })),
        completedAt: row.completed_at,
    };
}

/** An account's reconciliations, the latest first (without their lines) */
export async function listReconciliations(pool: Pool, userId: number, accountId: string | null): Promise<Omit<Reconciliation, 'lines'>[]> {
    const result = await pool.query(
        `SELECT id FROM reconciliations WHERE user_id = $1 AND ($2::bigint IS NULL OR account_id = $2::bigint)
         ORDER BY statement_date DESC, id DESC LIMIT 50`,
        [userId, accountId && /^\d+$/.test(accountId) ? accountId : null]);
    const items = [];
    for (const row of result.rows) {
        const { lines: _lines, ...item } = await load(pool, userId, row.id);
        void _lines;
        items.push(item);
    }
    return items;
}

export async function getReconciliation(pool: Pool, userId: number, id: string): Promise<Reconciliation> {
    return load(pool, userId, id);
}

/**
 * { accountId, statementDate, statementBalance }: start checking an account against a statement.
 * An account has one open reconciliation at a time; starting again replaces the open one's
 * statement and keeps its ticks.
 */
export async function startReconciliation(pool: Pool, userId: number, body: Body): Promise<Reconciliation> {
    const date = entryDate(body.statementDate);
    if (!date) throw new RequestError(400, 'Statement date is required');
    let balance: number;
    try {
        balance = toPaise(body.statementBalance);
    } catch {
        throw new RequestError(400, 'Enter the balance the statement shows');
    }
    return withTransaction(pool, async (client) => {
        const account = await lockedMoneyAccount(client, userId, body.accountId);
        const open = await client.query(
            'SELECT id FROM reconciliations WHERE user_id = $1 AND account_id = $2 AND status = \'open\' FOR UPDATE', [userId, account.id]);
        let id: number;
        if (open.rows[0]) {
            id = Number(open.rows[0].id);
            await client.query('UPDATE reconciliations SET statement_date = $1, statement_balance_paise = $2 WHERE id = $3 AND user_id = $4',
                [date.date, balance, id, userId]);
            // Ticks on lines now after the statement date no longer belong to it
            await client.query(
                `UPDATE journal_lines l SET reconciliation_id = NULL FROM journal_entries e
                 WHERE l.user_id = $1 AND l.reconciliation_id = $2 AND e.user_id = l.user_id AND e.id = l.entry_id AND e.entry_date > $3::date`,
                [userId, id, date.date]);
        } else {
            const created = await client.query(
                'INSERT INTO reconciliations (user_id, account_id, statement_date, statement_balance_paise) VALUES ($1, $2, $3, $4) RETURNING id',
                [userId, account.id, date.date, balance]);
            id = Number(created.rows[0].id);
        }
        return load(client, userId, id);
    });
}

async function lockedOpen(client: Client, userId: number, id: string): Promise<Reconciliation> {
    const item = await load(client, userId, id, true);
    if (item.status !== 'open') throw new RequestError(400, 'This reconciliation is finished');
    return item;
}

/** { lineIds, ticked }: tick lines off against the statement, or untick them */
export async function tickLines(pool: Pool, userId: number, id: string, body: Body): Promise<Reconciliation> {
    const ids = body.lineIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some(line => !/^\d+$/.test(String(line)))) throw new RequestError(400, 'Choose the lines to tick');
    if (typeof body.ticked !== 'boolean') throw new RequestError(400, 'Ticked must be true or false');
    return withTransaction(pool, async (client) => {
        const item = await lockedOpen(client, userId, id);
        const allowed = new Set(item.lines.map(line => line.lineId));
        if (ids.some(line => !allowed.has(Number(line)))) throw new RequestError(400, 'A line is not part of this statement');
        await client.query(
            'UPDATE journal_lines SET reconciliation_id = $1 WHERE user_id = $2 AND id = ANY($3::bigint[])',
            [body.ticked ? item.id : null, userId, ids.map(Number)]);
        return load(client, userId, item.id);
    });
}

/**
 * Finish a reconciliation: only at no difference, unless { adjust: true }, which records the
 * difference as an adjustment entry on the statement date, ticked as part of it.
 */
export async function finishReconciliation(pool: Pool, userId: number, id: string, body: Body): Promise<Reconciliation> {
    return withTransaction(pool, async (client) => {
        const item = await lockedOpen(client, userId, id);
        const difference = toPaise(item.difference);
        if (difference !== 0) {
            if (body.adjust !== true) {
                throw new RequestError(400, `The statement and FinDB differ by ₹${fromPaise(Math.abs(difference))}. Find the entries, or record the difference as an adjustment.`);
            }
            const ledgerAmount = statementSign(item.account.type) * difference;
            const entryId = await postEntry(client, {
                userId, date: item.statementDate, description: `Reconciliation adjustment: ${item.account.name}`, type: 'adjustment',
                lines: [{ accountId: item.account.id, paise: ledgerAmount }, { accountId: await systemAccount(client, userId, 'adjustment'), paise: -ledgerAmount }],
            });
            await client.query('UPDATE journal_lines SET reconciliation_id = $1 WHERE user_id = $2 AND entry_id = $3 AND account_id = $4',
                [item.id, userId, entryId, item.account.id]);
        }
        await client.query('UPDATE reconciliations SET status = \'done\', completed_at = now() WHERE id = $1 AND user_id = $2', [item.id, userId]);
        await logActivity(client, userId, 'updated', 'reconciliation', item.id,
            `Reconciled ${item.account.name} to the statement of ${item.statementDate}`, item.statementBalance, null,
            { accountName: item.account.name, adjustment: fromPaise(difference) });
        return load(client, userId, item.id);
    });
}

/** Give up an open reconciliation: its ticks are removed */
export async function cancelReconciliation(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const item = await lockedOpen(client, userId, id);
        await client.query('UPDATE journal_lines SET reconciliation_id = NULL WHERE user_id = $1 AND reconciliation_id = $2', [userId, item.id]);
        await client.query('DELETE FROM reconciliations WHERE id = $1 AND user_id = $2', [item.id, userId]);
    });
}

/**
 * The finished reconciliation an entry's lines belong to, if any: changing such an entry changes a
 * balance the user already matched to a statement, so it needs their confirmation.
 */
export async function reconciledStatement(client: Client, userId: number, entryId: number): Promise<{ id: number; account: string; date: string } | null> {
    const result = await client.query(
        `SELECT r.id, a.name, r.statement_date::text AS date
         FROM journal_lines l JOIN reconciliations r ON r.user_id = l.user_id AND r.id = l.reconciliation_id
         JOIN ledger_accounts a ON a.user_id = r.user_id AND a.id = r.account_id
         WHERE l.user_id = $1 AND l.entry_id = $2 AND r.status = 'done' LIMIT 1`,
        [userId, entryId]);
    const row = result.rows[0];
    return row ? { id: Number(row.id), account: row.name, date: row.date } : null;
}
