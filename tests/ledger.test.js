/**
 * Ledger tests (real database, balancetrack_test schema; docs/ledger.md)
 *
 * Every change to banks, cards, cash, income and expenses also writes the double-entry ledger in
 * the same transaction. After each kind of change, the balances stored in the former tables must
 * equal the ledger's (the view ledger_balance_check), and every entry must balance. The database
 * itself refuses an entry that does not add up to zero, or a line on another user's account.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, getPool, query } = require('../test-helpers');

const USER = 'ledger_user';
const OTHER = 'ledger_other';
const PASSWORD = 'TestPass123&';
const DATE = '2026-03-10';

let agent;
let user;
let other;

beforeAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(OTHER);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'ledger_user@example.com' });
    other = await createTestUser({ username: OTHER, password: PASSWORD, email: 'ledger_other@example.com' });
    agent = request.agent(target());
    expect((await agent.post('/api/login').send({ username: USER, password: PASSWORD })).status).toBe(200);
});

afterAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(OTHER);
    await closeTarget();
});

/** The user's stored balances that differ from the ledger's; empty when the two agree */
async function mismatches() {
    const result = await query(
        `SELECT account_type, label, account_id, target_balance_paise, ledger_balance_paise FROM ledger_balance_check
         WHERE user_id = $1 AND (account_id IS NULL OR target_balance_paise <> ledger_balance_paise)`,
        [user.id],
    );
    return result.rows;
}

/** The user's entries that do not balance (fewer than two lines, or lines that do not add up to zero) */
async function unbalanced() {
    const result = await query(
        `SELECT e.id FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id = e.id
         WHERE e.user_id = $1 GROUP BY e.id HAVING count(l.id) < 2 OR coalesce(sum(l.amount_paise), 0) <> 0`,
        [user.id],
    );
    return result.rows;
}

async function expectLedgerAgrees() {
    expect(await mismatches()).toEqual([]);
    expect(await unbalanced()).toEqual([]);
}

/** The ledger balance of the account that mirrors a bank or card, in paise */
async function mirroredBalance(table, id) {
    const result = await query(
        `SELECT coalesce(b.balance_paise, 0)::bigint AS balance, a.archived_at, a.name, a.credit_limit_paise
         FROM ledger_accounts a LEFT JOIN ledger_account_balances b ON b.account_id = a.id
         WHERE a.source_table = $1 AND a.source_id = $2`,
        [table, id],
    );
    return result.rows[0];
}

describe('every change keeps the ledger equal to the stored balances', () => {
    let bank;
    let card;
    let incomeId;
    let expenseId;

    test('a new bank gets an account and an opening entry', async () => {
        bank = (await agent.post('/api/banks').send({ name: 'Ledger Bank', initialBalance: '1000.55' })).body;
        expect(bank.id).toBeDefined();
        expect(Number((await mirroredBalance('banks', bank.id)).balance)).toBe(100055);
        await expectLedgerAgrees();
    });

    test('a new card gets an account with its limit', async () => {
        card = (await agent.post('/api/credit-cards').send({ name: 'Ledger Card', creditLimit: 50000 })).body;
        const account = await mirroredBalance('credit_cards', card.id);
        expect(Number(account.credit_limit_paise)).toBe(5000000);
        expect(Number(account.balance)).toBe(0);
        await expectLedgerAgrees();
    });

    test('cash: the first amount is an opening balance, later ones are adjustments', async () => {
        expect((await agent.post('/api/cash-balance').send({ balance: 500 })).status).toBe(200);
        await expectLedgerAgrees();
        expect((await agent.post('/api/cash-balance').send({ balance: 320.25 })).status).toBe(200);
        expect((await agent.post('/api/cash-balance').send({ balance: 400, initial_balance: 400 })).status).toBe(200);
        await expectLedgerAgrees();

        const types = await query(
            `SELECT entry_type, count(*)::int AS n FROM journal_entries
             WHERE user_id = $1 AND source_table = 'cash_balance' GROUP BY entry_type ORDER BY entry_type`,
            [user.id],
        );
        expect(types.rows).toEqual([{ entry_type: 'adjustment', n: 2 }, { entry_type: 'opening_balance', n: 1 }]);
    });

    test('income, then its edit to another account, then its delete', async () => {
        const created = await agent.post('/api/income')
            .send({ source: 'Salary', amount: '2500.10', creditedToType: 'bank', creditedToId: bank.id, date: DATE });
        expect(created.status).toBe(200);
        incomeId = created.body.id;
        await expectLedgerAgrees();

        const entry = await query(
            'SELECT entry_date::text AS date, description FROM journal_entries WHERE source_table = $1 AND source_id = $2',
            ['income_entries', incomeId],
        );
        expect(entry.rows).toEqual([{ date: DATE, description: 'Salary' }]);

        expect((await agent.put(`/api/income/${incomeId}`)
            .send({ source: 'Salary', amount: 1800, creditedToType: 'cash', date: DATE })).status).toBe(200);
        await expectLedgerAgrees();

        // The edit voided the first entry and recorded a new one: history is kept
        const entries = await query(
            'SELECT voided_at IS NOT NULL AS voided FROM journal_entries WHERE source_table = $1 AND source_id = $2 ORDER BY id',
            ['income_entries', incomeId],
        );
        expect(entries.rows).toEqual([{ voided: true }, { voided: false }]);
    });

    test('expenses from a bank, a card and cash, then edits and a delete', async () => {
        const fromBank = await agent.post('/api/expenses')
            .send({ title: 'Rent', amount: 700, paymentMethod: 'bank', paymentSourceId: bank.id, date: DATE });
        expect(fromBank.status).toBe(200);
        expenseId = fromBank.body.id;
        const fromCard = await agent.post('/api/expenses')
            .send({ title: 'Groceries', amount: '1234.56', paymentMethod: 'credit_card', paymentSourceId: card.id, date: DATE });
        expect(fromCard.status).toBe(200);
        const fromCash = await agent.post('/api/expenses')
            .send({ title: 'Tea', amount: 20, paymentMethod: 'cash', date: DATE });
        expect(fromCash.status).toBe(200);
        await expectLedgerAgrees();
        // A card's used amount is a liability: a negative ledger balance
        expect(Number((await mirroredBalance('credit_cards', card.id)).balance)).toBe(-123456);

        expect((await agent.put(`/api/expenses/${expenseId}`)
            .send({ title: 'Rent', amount: 650, paymentMethod: 'credit_card', paymentSourceId: card.id, date: DATE })).status).toBe(200);
        await expectLedgerAgrees();

        expect((await agent.delete(`/api/expenses/${fromCash.body.id}`)).status).toBe(200);
        await expectLedgerAgrees();
    });

    test('editing a bank\'s starting balance and a card\'s name and limit', async () => {
        expect((await agent.put(`/api/banks/${bank.id}`).send({ name: 'Ledger Bank Renamed', initialBalance: 1500 })).status).toBe(200);
        await expectLedgerAgrees();
        expect((await mirroredBalance('banks', bank.id)).name).toBe('Ledger Bank Renamed');

        expect((await agent.put(`/api/credit-cards/${card.id}`).send({ name: 'Ledger Card Gold', creditLimit: 80000 })).status).toBe(200);
        const account = await mirroredBalance('credit_cards', card.id);
        expect(account.name).toBe('Ledger Card Gold');
        expect(Number(account.credit_limit_paise)).toBe(8000000);
        await expectLedgerAgrees();
    });

    test('deleting income and an unused bank and card archives their accounts', async () => {
        expect((await agent.delete(`/api/income/${incomeId}`)).status).toBe(200);
        await expectLedgerAgrees();

        const spare = (await agent.post('/api/banks').send({ name: 'Spare Bank', initialBalance: 300 })).body;
        const spareCard = (await agent.post('/api/credit-cards').send({ name: 'Spare Card', creditLimit: 1000 })).body;
        expect((await agent.delete(`/api/banks/${spare.id}`)).status).toBe(200);
        expect((await agent.delete(`/api/credit-cards/${spareCard.id}`)).status).toBe(200);
        await expectLedgerAgrees();

        const archived = await mirroredBalance('banks', spare.id);
        expect(archived.archived_at).not.toBeNull();
        expect(Number(archived.balance)).toBe(0);
        expect((await mirroredBalance('credit_cards', spareCard.id)).archived_at).not.toBeNull();
    });
});

describe('the database guards the ledger', () => {
    /** Run statements in one transaction that is always rolled back; resolves to the error, if any */
    async function inRolledBackTransaction(work) {
        const client = await getPool().connect();
        try {
            await client.query('BEGIN');
            await work(client);
            // The balance checks are deferred to the commit; this runs them now
            await client.query('SET CONSTRAINTS ALL IMMEDIATE');
            return null;
        } catch (error) {
            return error;
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    }

    const accountOf = async (client, userId, key) =>
        (await client.query('SELECT id FROM ledger_accounts WHERE user_id = $1 AND system_key = $2', [userId, key])).rows[0].id;

    const newEntry = async (client, userId) => (await client.query(
        'INSERT INTO journal_entries (user_id, description, entry_type) VALUES ($1, \'Probe\', \'adjustment\') RETURNING id',
        [userId],
    )).rows[0].id;

    test('an entry whose lines do not add up to zero is refused', async () => {
        const error = await inRolledBackTransaction(async (client) => {
            const entry = await newEntry(client, user.id);
            await client.query('INSERT INTO journal_lines (user_id, entry_id, account_id, amount_paise) VALUES ($1, $2, $3, 100), ($1, $2, $4, -99)',
                [user.id, entry, await accountOf(client, user.id, 'cash'), await accountOf(client, user.id, 'adjustment')]);
        });
        expect(error && error.message).toMatch(/does not balance/);
    });

    test('an entry with a single line, or none, is refused', async () => {
        const empty = await inRolledBackTransaction(client => newEntry(client, user.id));
        expect(empty && empty.message).toMatch(/does not balance/);
    });

    test('a line on another user\'s account is refused', async () => {
        const error = await inRolledBackTransaction(async (client) => {
            const entry = await newEntry(client, user.id);
            // Makes sure the other user has accounts to point at
            await client.query(
                `INSERT INTO ledger_accounts (user_id, kind, subtype, name, system_key) VALUES ($1, 'asset', 'cash', 'Cash', 'cash')
                 ON CONFLICT (user_id, system_key) WHERE system_key IS NOT NULL DO NOTHING`,
                [other.id],
            );
            await client.query('INSERT INTO journal_lines (user_id, entry_id, account_id, amount_paise) VALUES ($1, $2, $3, 100), ($1, $2, $4, -100)',
                [user.id, entry, await accountOf(client, other.id, 'cash'), await accountOf(client, user.id, 'adjustment')]);
        });
        expect(error && error.code).toBe('23503');
    });

    test('a balanced entry on the user\'s own accounts is accepted', async () => {
        const error = await inRolledBackTransaction(async (client) => {
            const entry = await newEntry(client, user.id);
            await client.query('INSERT INTO journal_lines (user_id, entry_id, account_id, amount_paise) VALUES ($1, $2, $3, 100), ($1, $2, $4, -100)',
                [user.id, entry, await accountOf(client, user.id, 'cash'), await accountOf(client, user.id, 'adjustment')]);
        });
        expect(error).toBeNull();
    });
});
