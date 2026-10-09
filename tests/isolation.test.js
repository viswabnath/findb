/**
 * Database-enforced isolation (real database, balancetrack_test schema; docs/security.md)
 *
 * Logged-in requests run as the role findb_user with app.user_id set (withUserScope). These tests
 * play that role directly and check that the database itself keeps it to one user's rows: reads,
 * updates and deletes of another user's rows find nothing, writing a row for another user is
 * refused, and with no user set nothing is visible. A guard checks that every table with a user_id
 * column has row level security and a policy, so a new table cannot be forgotten.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestBank, createTestCashBalance, createTestUser, deleteTestUser, getPool, ledgerBalances, logIn, query } = require('../test-helpers');

const ALICE = 'isolation_alice';
const BOB = 'isolation_bob';
const PASSWORD = 'Ledger_Pass9';

let alice;
let bob;
let bobBank;

beforeAll(async () => {
    await deleteTestUser(ALICE);
    await deleteTestUser(BOB);
    alice = await createTestUser({ username: ALICE, password: PASSWORD, email: 'isolation_alice@example.com' });
    bob = await createTestUser({ username: BOB, password: PASSWORD, email: 'isolation_bob@example.com' });
    await createTestBank(alice.id, { name: 'ALICE BANK', balance: 100 });
    bobBank = await createTestBank(bob.id, { name: 'BOB BANK', balance: 900 });
    await createTestCashBalance(alice.id, 10);
    await createTestCashBalance(bob.id, 90);
});

afterAll(async () => {
    await deleteTestUser(ALICE);
    await deleteTestUser(BOB);
    await closeTarget();
});

/**
 * Run `work` as findb_user for `userId` (null: none set), then roll everything back. Started the
 * way the app starts a request (withUserScope): one statement, through Supabase's pooler.
 */
async function asUser(userId, work) {
    const client = await getPool().connect();
    try {
        const setUser = userId === null ? '' : `; SELECT set_config('app.user_id', '${Number(userId)}', true)`;
        await client.query(`BEGIN; SET LOCAL ROLE findb_user${setUser}`);
        return await work(client);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
}

const USER_TABLES = [
    'banks', 'credit_cards', 'income_entries', 'expenses', 'cash_balance', 'activity_log',
    'ledger_accounts', 'journal_entries', 'journal_lines', 'recovery_codes', 'login_events',
];

describe('as findb_user, the database shows one user only', () => {
    test('every table shows only the user\'s own rows', async () => {
        await asUser(alice.id, async (client) => {
            for (const table of USER_TABLES) {
                const others = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id <> $1`, [alice.id]);
                expect({ table, others: others.rows[0].n }).toEqual({ table, others: 0 });
            }
            const users = await client.query('SELECT id FROM users');
            expect(users.rows).toEqual([{ id: alice.id }]);
            // Even with no filter at all, Bob's bank is not there
            const banks = await client.query('SELECT name FROM banks');
            expect(banks.rows.map(row => row.name)).toEqual(['ALICE BANK']);
        });
    });

    test('another user\'s rows cannot be changed or deleted', async () => {
        await asUser(alice.id, async (client) => {
            const updated = await client.query('UPDATE banks SET current_balance = 0 WHERE id = $1', [bobBank.id]);
            expect(updated.rowCount).toBe(0);
            const deleted = await client.query('DELETE FROM cash_balance WHERE user_id = $1', [bob.id]);
            expect(deleted.rowCount).toBe(0);
            const password = await client.query('UPDATE users SET name = \'x\' WHERE id = $1', [bob.id]);
            expect(password.rowCount).toBe(0);
        });
        const bank = await query('SELECT current_balance FROM banks WHERE id = $1', [bobBank.id]);
        expect(bank.rows[0].current_balance).toBe('900.00');
    });

    test('a row for another user cannot be written', async () => {
        const error = await asUser(alice.id, client =>
            client.query('INSERT INTO banks (user_id, name, initial_balance, current_balance) VALUES ($1, \'PLANTED\', 1, 1)', [bob.id])
                .then(() => null, caught => caught));
        expect(error && error.code).toBe('42501');
        expect(error.message).toMatch(/row-level security/);
    });

    test('with no user set, nothing is visible', async () => {
        await asUser(null, async (client) => {
            for (const table of [...USER_TABLES, 'users', 'session']) {
                const rows = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
                expect({ table, n: rows.rows[0].n }).toEqual({ table, n: 0 });
            }
        });
    });

    test('the ledger\'s balance check still runs, within the user\'s rows', async () => {
        const error = await asUser(alice.id, async (client) => {
            const account = await client.query('SELECT id FROM ledger_accounts WHERE system_key = \'cash\'');
            const entry = await client.query(
                'INSERT INTO journal_entries (user_id, description, entry_type) VALUES ($1, \'Probe\', \'adjustment\') RETURNING id', [alice.id]);
            await client.query('INSERT INTO journal_lines (user_id, entry_id, account_id, amount_paise) VALUES ($1, $2, $3, 100)',
                [alice.id, entry.rows[0].id, account.rows[0].id]);
            return client.query('SET CONSTRAINTS ALL IMMEDIATE').then(() => null, caught => caught);
        });
        expect(error && error.message).toMatch(/does not balance/);
    });
});

describe('requests run as findb_user', () => {
    test('a logged-in request sees its own data and works as before', async () => {
        const agent = request.agent(target());
        expect((await logIn(agent, ALICE, PASSWORD)).status).toBe(200);
        const banks = await agent.get('/api/banks');
        expect(banks.status).toBe(200);
        expect(banks.body.map(bank => bank.name)).toEqual(['ALICE BANK']);
        const added = await agent.post('/api/expenses').send({ title: 'Tea', amount: 5, paymentMethod: 'cash', date: '2026-10-01' });
        expect(added.status).toBe(200);
        // The write and its ledger entry committed
        const ledger = await query('SELECT count(*)::int AS n FROM journal_entries WHERE source_table = \'expenses\' AND source_id = $1', [added.body.id]);
        expect(ledger.rows[0].n).toBe(1);
    });

    test('a failed write inside a request still rolls back completely', async () => {
        const agent = request.agent(target());
        await logIn(agent, ALICE, PASSWORD);
        const before = (await ledgerBalances(alice.id)).cash;
        const refused = await agent.post('/api/expenses').send({ title: 'Too much', amount: 999999, paymentMethod: 'cash', date: '2026-10-01' });
        expect(refused.status).toBe(400);
        expect((await ledgerBalances(alice.id)).cash).toBe(before);
    });
});

describe('guard', () => {
    test('every table with a user_id has row level security and a findb_user policy', async () => {
        const tables = await query(
            `SELECT c.relname AS table, c.relrowsecurity AS rls,
                    EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = current_schema() AND p.tablename = c.relname
                            AND 'findb_user' = ANY (p.roles)) AS policy
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = current_schema() AND c.relkind = 'r'
               AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped)
                    OR c.relname = 'users')
             ORDER BY c.relname`,
        );
        expect(tables.rows.length).toBeGreaterThanOrEqual(13);
        for (const row of tables.rows) expect(row).toEqual({ table: row.table, rls: true, policy: true });
    });
});
