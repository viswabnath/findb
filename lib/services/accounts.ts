import type { Pool, QueryResultRow } from 'pg';
import { logActivity } from '../activity-log';
import { RequestError, withTransaction } from '../transaction';
import {
    archiveMirroredAccount, cardAccount, recordBankOpening, recordCashSetTo, updateMirroredAccount, voidEntries,
} from '../ledger';

/**
 * Banks, credit cards and cash: the account routes moved from the former Express app (N3).
 * Same queries, messages and activity log entries as the Express routes, so the API contract
 * suites pass against either app. Every change also writes the ledger (lib/ledger.ts) in the same
 * transaction. Known gaps kept for now (see docs/v2-audit.md): add accepts negative balances and
 * zero limits, and edits and deletes write no activity log entry.
 */

type Body = Record<string, unknown>;

/** Postgres unique-violation code: the account name already exists for this user */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/** Legacy validation: isNaN coerces like JavaScript's global isNaN */
const notANumber = (value: unknown) => Number.isNaN(Number(value));

function requireName(name: unknown, message: string): string {
    if (typeof name !== 'string' || !name.trim()) throw new RequestError(400, message);
    return name;
}

// ----- Banks -----

export async function listBanks(pool: Pool, userId: number): Promise<QueryResultRow[]> {
    const result = await pool.query('SELECT * FROM banks WHERE user_id = $1 ORDER BY name', [userId]);
    return result.rows;
}

export async function addBank(pool: Pool, userId: number, body: Body): Promise<QueryResultRow> {
    const name = requireName(body.name, 'Bank name is required').toUpperCase();
    const initialBalance = body.initialBalance || 0;
    try {
        return await withTransaction(pool, async (client) => {
            const result = await client.query(
                'INSERT INTO banks (user_id, name, initial_balance, current_balance) VALUES ($1, $2, $3, $3) RETURNING *',
                [userId, name, initialBalance],
            );
            const bank = result.rows[0];
            await recordBankOpening(client, userId, bank.id, name, initialBalance);
            await logActivity(client, userId, 'create', 'bank', bank.id, `Added bank account: ${name}`, initialBalance, null,
                { name, initialBalance, currentBalance: initialBalance });
            return bank;
        });
    } catch (error) {
        if (isUniqueViolation(error)) throw new RequestError(400, 'Bank already exists');
        throw error;
    }
}

export async function updateBank(pool: Pool, userId: number, id: string, body: Body): Promise<QueryResultRow> {
    const name = requireName(body.name, 'Bank name is required');
    const { initialBalance } = body;
    if (initialBalance === undefined || notANumber(initialBalance) || parseFloat(String(initialBalance)) < 0) {
        throw new RequestError(400, 'Valid initial balance is required');
    }
    return withTransaction(pool, async (client) => {
        const current = await client.query('SELECT * FROM banks WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
        if (current.rows.length === 0) throw new RequestError(404, 'Bank not found');

        const newBalance = parseFloat(String(initialBalance));
        const difference = newBalance - parseFloat(current.rows[0].initial_balance);
        const result = await client.query(
            'UPDATE banks SET name = $1, initial_balance = $2, current_balance = current_balance + $3 WHERE id = $4 AND user_id = $5 RETURNING *',
            [name.trim(), newBalance, difference, id, userId],
        );
        // The ledger's opening entry is replaced, which moves the balance by the same difference
        await updateMirroredAccount(client, userId, 'banks', id, name.trim());
        await voidEntries(client, userId, 'banks', id, ['opening_balance']);
        await recordBankOpening(client, userId, id, name.trim(), newBalance);
        return result.rows[0];
    });
}

export async function deleteBank(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const incomeCount = await client.query(
            'SELECT COUNT(*) FROM income_entries WHERE user_id = $1 AND credited_to_type = $2 AND credited_to_id = $3',
            [userId, 'bank', id],
        );
        const expenseCount = await client.query(
            'SELECT COUNT(*) FROM expenses WHERE user_id = $1 AND payment_method = $2 AND payment_source_id = $3',
            [userId, 'bank', id],
        );
        if (parseInt(incomeCount.rows[0].count, 10) + parseInt(expenseCount.rows[0].count, 10) > 0) {
            throw new RequestError(400, 'Cannot delete bank with existing transactions. Please delete all related transactions first.');
        }
        const result = await client.query('DELETE FROM banks WHERE id = $1 AND user_id = $2 RETURNING *', [id, userId]);
        if (result.rows.length === 0) throw new RequestError(404, 'Bank not found');
        await archiveMirroredAccount(client, userId, 'banks', id);
    });
}

// ----- Credit cards -----

export async function listCards(pool: Pool, userId: number): Promise<QueryResultRow[]> {
    const result = await pool.query('SELECT * FROM credit_cards WHERE user_id = $1 ORDER BY name', [userId]);
    return result.rows;
}

export async function addCard(pool: Pool, userId: number, body: Body): Promise<QueryResultRow> {
    const name = requireName(body.name, 'Card name is required').toUpperCase();
    const { creditLimit } = body;
    try {
        return await withTransaction(pool, async (client) => {
            const result = await client.query(
                'INSERT INTO credit_cards (user_id, name, credit_limit) VALUES ($1, $2, $3) RETURNING *',
                [userId, name, creditLimit],
            );
            const card = result.rows[0];
            await cardAccount(client, userId, card.id);
            await logActivity(client, userId, 'create', 'credit_card', card.id, `Added credit card: ${name}`, creditLimit, null,
                { name, creditLimit, usedLimit: 0, availableLimit: creditLimit });
            return card;
        });
    } catch (error) {
        if (isUniqueViolation(error)) throw new RequestError(400, 'Credit card already exists');
        throw error;
    }
}

export async function updateCard(pool: Pool, userId: number, id: string, body: Body): Promise<QueryResultRow> {
    const name = requireName(body.name, 'Card name is required');
    const { creditLimit } = body;
    if (creditLimit === undefined || notANumber(creditLimit) || parseFloat(String(creditLimit)) <= 0) {
        throw new RequestError(400, 'Valid credit limit greater than 0 is required');
    }
    // Locked, so an expense cannot raise the used limit between the check and the update
    // (the Express route checked and updated outside a transaction)
    return withTransaction(pool, async (client) => {
        const current = await client.query('SELECT * FROM credit_cards WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
        if (current.rows.length === 0) throw new RequestError(404, 'Credit card not found');

        const usedLimit = parseFloat(current.rows[0].used_limit);
        const newLimit = parseFloat(String(creditLimit));
        if (newLimit < usedLimit) {
            throw new RequestError(400,
                `Credit limit cannot be less than used limit (₹${usedLimit.toLocaleString('en-IN', { minimumFractionDigits: 2 })})`);
        }
        const result = await client.query(
            'UPDATE credit_cards SET name = $1, credit_limit = $2 WHERE id = $3 AND user_id = $4 RETURNING *',
            [name.trim(), newLimit, id, userId],
        );
        await updateMirroredAccount(client, userId, 'credit_cards', id, name.trim(), newLimit);
        return result.rows[0];
    });
}

export async function deleteCard(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const transactions = await client.query(
            'SELECT COUNT(*) FROM expenses WHERE user_id = $1 AND payment_method = $2 AND payment_source_id = $3',
            [userId, 'credit_card', id],
        );
        if (parseInt(transactions.rows[0].count, 10) > 0) {
            throw new RequestError(400, 'Cannot delete credit card with existing transactions. Please delete all related transactions first.');
        }
        const result = await client.query('DELETE FROM credit_cards WHERE id = $1 AND user_id = $2 RETURNING *', [id, userId]);
        if (result.rows.length === 0) throw new RequestError(404, 'Credit card not found');
        await archiveMirroredAccount(client, userId, 'credit_cards', id);
    });
}

// ----- Cash -----

export async function getCash(pool: Pool, userId: number): Promise<QueryResultRow> {
    const result = await pool.query('SELECT * FROM cash_balance WHERE user_id = $1', [userId]);
    return result.rows[0] || { balance: 0 };
}

/**
 * { balance, initial_balance } replaces both (the Setup screen's edit); { balance } alone
 * changes the balance and keeps the initial amount; the first save sets both.
 */
export async function setCash(pool: Pool, userId: number, body: Body): Promise<QueryResultRow> {
    const { balance, initial_balance: initialBalance } = body;
    const amount = (value: unknown) => parseFloat(String(value)).toFixed(2);

    return withTransaction(pool, async (client) => {
        // Locked so concurrent saves cannot both read the old values
        const existing = await client.query('SELECT * FROM cash_balance WHERE user_id = $1 FOR UPDATE', [userId]);

        if (existing.rows.length > 0) {
            const oldValues = { balance: existing.rows[0].balance, initial_balance: existing.rows[0].initial_balance };
            if (initialBalance !== undefined && balance !== undefined) {
                const result = await client.query(
                    'UPDATE cash_balance SET balance = $1, initial_balance = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3 RETURNING *',
                    [balance || 0, initialBalance || 0, userId],
                );
                await recordCashSetTo(client, userId, result.rows[0].id, result.rows[0].balance, false);
                await logActivity(client, userId, 'updated', 'cash_balance', result.rows[0].id,
                    `Updated cash balance from ₹${amount(oldValues.initial_balance)} to ₹${amount(initialBalance)}`,
                    initialBalance, oldValues, { balance, initial_balance: initialBalance });
                return result.rows[0];
            }
            const result = await client.query(
                'UPDATE cash_balance SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 RETURNING *',
                [balance || 0, userId],
            );
            await recordCashSetTo(client, userId, result.rows[0].id, result.rows[0].balance, false);
            await logActivity(client, userId, 'updated', 'cash_balance', result.rows[0].id,
                `Cash balance updated to ₹${amount(balance)}`,
                balance, oldValues, { balance, initial_balance: oldValues.initial_balance });
            return result.rows[0];
        }

        const initialValue = initialBalance !== undefined ? initialBalance : balance;
        const result = await client.query(
            'INSERT INTO cash_balance (user_id, balance, initial_balance) VALUES ($1, $2, $3) RETURNING *',
            [userId, balance || 0, initialValue || 0],
        );
        await recordCashSetTo(client, userId, result.rows[0].id, result.rows[0].balance, true);
        await logActivity(client, userId, 'created', 'cash_balance', result.rows[0].id,
            `Set initial cash balance: ₹${amount(initialValue)}`, initialValue);
        return result.rows[0];
    });
}
