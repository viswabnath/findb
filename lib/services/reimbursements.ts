import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, postEntry, systemAccount, toPaise, voidEntry } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { lockedCategory } from './categories';
import { checkCanSpend, lockedMoneyAccount } from './entries';
import { lockedEvent } from './events';
import { entryDate } from './transactions';

/**
 * Reimbursements (docs/ledger.md): an expense paid personally that someone will pay back (an
 * employer, an insurer). While pending it is money owed to the user, not spending: the payment
 * moves money into the built-in "Reimbursements due" account. Repayments move it back to the
 * account that receives them. Closing it turns whatever was not repaid into the user's own expense,
 * in the chosen category; spending reports show only what the user actually bore.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;

export interface Reimbursement {
    id: number;
    description: string;
    fromWhom: string | null;
    amount: string;
    received: string;
    /** Still owed: the amount less what came back, or zero once closed */
    outstanding: string;
    /** The part never repaid, spent by the user (once closed) */
    keptAsSpending: string;
    category: { id: number; name: string } | null;
    event: { id: number; name: string } | null;
    paidFrom: { id: number; name: string } | null;
    paidOn: string | null;
    status: 'pending' | 'partly repaid' | 'repaid' | 'closed';
    repayments: { date: string; amount: string; account: string }[];
}

const SELECT = `
    SELECT r.id, r.description, r.from_whom, r.amount_paise, r.settled_at, r.category_id, c.name AS category_name, r.event_id, ev.name AS event_name,
           (SELECT json_agg(json_build_object('type', e.entry_type, 'date', e.entry_date::text,
                    'paise', (SELECT abs(l.amount_paise) FROM journal_lines l JOIN ledger_accounts a ON a.id = l.account_id
                              WHERE l.entry_id = e.id AND l.user_id = e.user_id AND a.subtype <> 'receivable' LIMIT 1),
                    'account', (SELECT a.name FROM journal_lines l JOIN ledger_accounts a ON a.id = l.account_id
                                WHERE l.entry_id = e.id AND l.user_id = e.user_id AND a.subtype <> 'receivable' LIMIT 1),
                    'accountId', (SELECT a.id FROM journal_lines l JOIN ledger_accounts a ON a.id = l.account_id
                                  WHERE l.entry_id = e.id AND l.user_id = e.user_id AND a.subtype <> 'receivable' LIMIT 1))
                    ORDER BY e.entry_date, e.id)
            FROM journal_entries e WHERE e.user_id = r.user_id AND e.reimbursement_id = r.id AND e.voided_at IS NULL) AS entries
    FROM reimbursements r
    LEFT JOIN ledger_accounts c ON c.user_id = r.user_id AND c.id = r.category_id
    LEFT JOIN events ev ON ev.user_id = r.user_id AND ev.id = r.event_id
    WHERE r.user_id = $1`;

interface EntryRow { type: string; date: string; paise: number; account: string; accountId: number }

function toReimbursement(row: Record<string, unknown>): Reimbursement {
    const entries = (row.entries as EntryRow[] | null) ?? [];
    const payment = entries.find(entry => entry.type === 'reimbursable');
    const repayments = entries.filter(entry => entry.type === 'reimbursement');
    const kept = entries.filter(entry => entry.type === 'expense').reduce((sum, entry) => sum + Number(entry.paise), 0);
    const amount = Number(row.amount_paise);
    const received = repayments.reduce((sum, entry) => sum + Number(entry.paise), 0);
    const closed = row.settled_at !== null;
    return {
        id: Number(row.id),
        description: String(row.description),
        fromWhom: (row.from_whom as string | null) ?? null,
        amount: fromPaise(amount),
        received: fromPaise(received),
        outstanding: fromPaise(closed ? 0 : amount - received),
        keptAsSpending: fromPaise(kept),
        category: row.category_id === null ? null : { id: Number(row.category_id), name: String(row.category_name) },
        event: row.event_id === null ? null : { id: Number(row.event_id), name: String(row.event_name) },
        paidFrom: payment ? { id: Number(payment.accountId), name: payment.account } : null,
        paidOn: payment?.date ?? null,
        status: closed ? (received >= amount ? 'repaid' : 'closed') : received > 0 ? 'partly repaid' : 'pending',
        repayments: repayments.map(entry => ({ date: entry.date, amount: fromPaise(Number(entry.paise)), account: entry.account })),
    };
}

/** Every reimbursement, the open ones first */
export async function listReimbursements(pool: Pool, userId: number): Promise<Reimbursement[]> {
    const result = await pool.query(`${SELECT} ORDER BY r.settled_at IS NOT NULL, r.created_at DESC, r.id DESC`, [userId]);
    return result.rows.map(toReimbursement);
}

async function locked(client: Client, userId: number, id: unknown): Promise<Reimbursement> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, 'Reimbursement not found');
    await client.query('SELECT id FROM reimbursements WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
    const result = await client.query(`${SELECT} AND r.id = $2`, [userId, id]);
    if (!result.rows[0]) throw new RequestError(404, 'Reimbursement not found');
    return toReimbursement(result.rows[0]);
}

function paise(value: unknown, label = 'amount'): number {
    let amount: number;
    try {
        amount = toPaise(value);
    } catch {
        throw new RequestError(400, `Enter a valid ${label}`);
    }
    if (amount <= 0) throw new RequestError(400, `Enter ${label === 'amount' ? 'an amount' : `a ${label}`} greater than zero`);
    return amount;
}

function requiredDate(value: unknown): string {
    if (!value) throw new RequestError(400, 'Date is required');
    const date = entryDate(value);
    if (!date) throw new RequestError(400, 'Invalid date format');
    return date.date;
}

/**
 * { description, amount, accountId, date, fromWhom?, categoryId?, eventId? }: an expense paid now
 * that someone will pay back. The spending check applies to the account it is paid from.
 */
export async function createReimbursement(pool: Pool, userId: number, body: Body): Promise<Reimbursement> {
    if (typeof body.description !== 'string' || !body.description.trim()) throw new RequestError(400, 'Description is required');
    const description = body.description.trim();
    if (description.length > 200) throw new RequestError(400, 'Description is too long (max 200 characters)');
    const fromWhom = typeof body.fromWhom === 'string' && body.fromWhom.trim() ? body.fromWhom.trim().slice(0, 100) : null;
    const amount = paise(body.amount);
    const date = requiredDate(body.date);

    return withTransaction(pool, async (client) => {
        const account = await lockedMoneyAccount(client, userId, body.accountId);
        const categoryId = body.categoryId === undefined || body.categoryId === null || body.categoryId === ''
            ? null : (await lockedCategory(client, userId, body.categoryId, 'expense')).id;
        const eventId = body.eventId === undefined || body.eventId === null || body.eventId === ''
            ? null : (await lockedEvent(client, userId, body.eventId)).id;
        await checkCanSpend(client, userId, account, amount);
        const created = await client.query(
            'INSERT INTO reimbursements (user_id, description, from_whom, amount_paise, category_id, event_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [userId, description, fromWhom, amount, categoryId, eventId]);
        const id = Number(created.rows[0].id);
        await postEntry(client, {
            userId, date, description, type: 'reimbursable', eventId, reimbursementId: id,
            lines: [{ accountId: await systemAccount(client, userId, 'reimbursements'), paise: amount }, { accountId: account.id, paise: -amount }],
        });
        await logActivity(client, userId, 'created', 'reimbursement', id, `Paid, to be repaid${fromWhom ? ` by ${fromWhom}` : ''}: ${description}`,
            fromPaise(amount), null, { accountName: account.name, fromWhom });
        return locked(client, userId, id);
    });
}

/**
 * { amount, accountId, date, close? }: money paid back, into the account it arrived in. Repaying it
 * all closes it; { close: true } closes it now, and what was not repaid becomes the user's own
 * spending in its category (Uncategorised without one), dated the day it is closed.
 */
export async function receiveRepayment(pool: Pool, userId: number, id: string, body: Body): Promise<Reimbursement> {
    const date = requiredDate(body.date);
    return withTransaction(pool, async (client) => {
        const item = await locked(client, userId, id);
        if (item.status === 'repaid' || item.status === 'closed') throw new RequestError(400, 'This reimbursement is already closed');
        const outstanding = toPaise(item.outstanding);
        const amount = body.amount === undefined || body.amount === null || body.amount === '' ? 0 : paise(body.amount);
        if (amount > outstanding) throw new RequestError(400, `Only ₹${item.outstanding} is still owed`);
        if (amount === 0 && body.close !== true) throw new RequestError(400, 'Enter the amount paid back');
        const due = await systemAccount(client, userId, 'reimbursements');
        if (amount > 0) {
            const account = await lockedMoneyAccount(client, userId, body.accountId);
            await postEntry(client, {
                userId, date, description: `Repaid: ${item.description}`, type: 'reimbursement', reimbursementId: item.id,
                lines: [{ accountId: account.id, paise: amount }, { accountId: due, paise: -amount }],
            });
            await logActivity(client, userId, 'updated', 'reimbursement', item.id, `Repaid${item.fromWhom ? ` by ${item.fromWhom}` : ''}: ${item.description}`,
                fromPaise(amount), null, { accountName: account.name });
        }
        const left = outstanding - amount;
        if (left === 0 || body.close === true) {
            if (left > 0) {
                const category = item.category ? item.category.id : await systemAccount(client, userId, 'expense');
                await postEntry(client, {
                    userId, date, description: `Not repaid: ${item.description}`, type: 'expense', reimbursementId: item.id, eventId: item.event?.id ?? null,
                    lines: [{ accountId: category, paise: left }, { accountId: due, paise: -left }],
                });
            }
            await client.query('UPDATE reimbursements SET settled_at = now() WHERE id = $1 AND user_id = $2', [item.id, userId]);
            await logActivity(client, userId, 'updated', 'reimbursement', item.id, `Closed: ${item.description}`, fromPaise(left), null,
                { notRepaid: fromPaise(left) });
        }
        return locked(client, userId, item.id);
    });
}

/** Delete a reimbursement nothing has been repaid on: the payment is undone */
export async function deleteReimbursement(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const item = await locked(client, userId, id);
        if (item.repayments.length > 0 || item.status === 'closed' || item.status === 'repaid') {
            throw new RequestError(400, 'Money has come back on this one already; close it instead');
        }
        const entries = await client.query('SELECT id FROM journal_entries WHERE reimbursement_id = $1 AND user_id = $2 AND voided_at IS NULL', [item.id, userId]);
        for (const row of entries.rows) await voidEntry(client, userId, Number(row.id));
        await client.query('DELETE FROM reimbursements WHERE id = $1 AND user_id = $2', [item.id, userId]);
        await logActivity(client, userId, 'deleted', 'reimbursement', item.id, `Deleted reimbursement: ${item.description}`, item.amount);
    });
}

/** Money owed back to the user, in paise: what is in "Reimbursements due" */
export async function owedBack(client: Client, userId: number): Promise<number> {
    const result = await client.query(
        `SELECT COALESCE(SUM(l.amount_paise), 0)::bigint AS paise
         FROM journal_lines l
         JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
         JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
         WHERE l.user_id = $1 AND e.voided_at IS NULL AND a.system_key = 'reimbursements'`,
        [userId]);
    return Number(result.rows[0].paise);
}
