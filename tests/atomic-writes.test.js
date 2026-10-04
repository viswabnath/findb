/**
 * Atomic write tests (real database, balancetrack_test schema)
 *
 * Every write that changes a balance must commit its entry, the balance change and the
 * activity log entry together. A trigger makes the activity log insert fail on demand,
 * which is the last step of each write, so a correct route leaves no partial changes.
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');


const { target, closeTarget } = require('./api-target');
const {
    createTestUser,
    createTestBank,
    createTestCreditCard,
    createTestCashBalance,
    deleteTestUser,
    query,
    logIn
} = require('../test-helpers');

const USERNAME = 'atomic_writes_user';
const PASSWORD = 'TestPass123&';
const FAIL_MARKER = 'FORCE_FAIL';

let agent;
let userId;
let bankA;
let bankB;
let card;

async function balances() {
    const banks = await query('SELECT id, current_balance FROM banks WHERE user_id = $1', [userId]);
    const cash = await query('SELECT balance FROM cash_balance WHERE user_id = $1', [userId]);
    const cards = await query('SELECT used_limit FROM credit_cards WHERE user_id = $1', [userId]);
    const byId = Object.fromEntries(banks.rows.map(row => [row.id, row.current_balance]));
    return {
        bankA: byId[bankA.id],
        bankB: byId[bankB.id],
        cash: cash.rows[0].balance,
        cardUsed: cards.rows[0].used_limit
    };
}

async function activityCount() {
    const result = await query('SELECT COUNT(*)::int AS n FROM activity_log WHERE user_id = $1', [userId]);
    return result.rows[0].n;
}

beforeAll(async () => {
    // Never install the failure trigger outside a test schema
    const { rows } = await query('SELECT current_schema() AS schema');
    if (!/_test$/.test(rows[0].schema)) {
        throw new Error(`Refusing to run: current schema is ${rows[0].schema}`);
    }

    await query(`
        CREATE OR REPLACE FUNCTION fail_marked_activity() RETURNS trigger AS $$
        BEGIN
            IF NEW.description LIKE '%${FAIL_MARKER}%' THEN
                RAISE EXCEPTION 'forced activity log failure';
            END IF;
            RETURN NEW;
        END $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS fail_marked_activity ON activity_log;
        CREATE TRIGGER fail_marked_activity BEFORE INSERT ON activity_log
            FOR EACH ROW EXECUTE FUNCTION fail_marked_activity();
    `);

    await deleteTestUser(USERNAME);
    const user = await createTestUser({ username: USERNAME, password: PASSWORD, email: 'atomic@example.com' });
    userId = user.id;
    bankA = await createTestBank(userId, { name: 'ATOMIC BANK A', balance: 1000 });
    bankB = await createTestBank(userId, { name: 'ATOMIC BANK B', balance: 2000 });
    card = await createTestCreditCard(userId, { name: 'ATOMIC CARD', creditLimit: 5000 });
    await createTestCashBalance(userId, 500);

    agent = request.agent(target());
    const login = await logIn(agent, USERNAME, PASSWORD);
    expect(login.status).toBe(200);
});

afterAll(async () => {
    await query('DROP TRIGGER IF EXISTS fail_marked_activity ON activity_log');
    await query('DROP FUNCTION IF EXISTS fail_marked_activity()');
    await deleteTestUser(USERNAME);
    await closeTarget();
});

describe('failed writes leave no partial changes', () => {
    test('adding income: no entry, no balance change, no log entry', async () => {
        const before = await balances();
        const logBefore = await activityCount();

        const response = await agent.post('/api/income').send({
            source: `${FAIL_MARKER} salary`, amount: 200, creditedToType: 'bank', creditedToId: bankA.id, date: '2026-09-15'
        });

        expect(response.status).toBe(500);
        const rows = await query('SELECT id FROM income_entries WHERE user_id = $1 AND source LIKE $2', [userId, `${FAIL_MARKER}%`]);
        expect(rows.rows).toEqual([]);
        expect(await balances()).toEqual(before);
        expect(await activityCount()).toBe(logBefore);
    });

    test('adding an expense: no entry and cash unchanged', async () => {
        const before = await balances();

        const response = await agent.post('/api/expenses').send({
            title: `${FAIL_MARKER} groceries`, amount: 50, paymentMethod: 'cash', date: '2026-09-15'
        });

        expect(response.status).toBe(500);
        const rows = await query('SELECT id FROM expenses WHERE user_id = $1 AND title LIKE $2', [userId, `${FAIL_MARKER}%`]);
        expect(rows.rows).toEqual([]);
        expect(await balances()).toEqual(before);
    });

    test('editing income: entry and both banks keep their previous values', async () => {
        const created = await agent.post('/api/income').send({
            source: 'Salary', amount: 300, creditedToType: 'bank', creditedToId: bankA.id, date: '2026-09-10'
        });
        expect(created.status).toBe(200);
        const before = await balances();

        const response = await agent.put(`/api/income/${created.body.id}`).send({
            source: `${FAIL_MARKER} salary`, amount: 900, creditedToType: 'bank', creditedToId: bankB.id, date: '2026-09-10'
        });

        expect(response.status).toBe(500);
        const row = await query('SELECT source, amount, credited_to_id FROM income_entries WHERE id = $1', [created.body.id]);
        expect(row.rows[0]).toEqual({ source: 'Salary', amount: '300.00', credited_to_id: bankA.id });
        expect(await balances()).toEqual(before);
    });

    test('deleting an expense: entry stays and the card usage is unchanged', async () => {
        // Inserted directly: creating it through the API would already trip the trigger
        const inserted = await query(
            `INSERT INTO expenses (user_id, title, amount, payment_method, payment_source_id, date, month, year)
             VALUES ($1, $2, 120, 'credit_card', $3, '2026-09-12', 9, 2026) RETURNING id`,
            [userId, `${FAIL_MARKER} flight`, card.id]
        );
        await query('UPDATE credit_cards SET used_limit = used_limit + 120 WHERE id = $1', [card.id]);
        const before = await balances();

        const response = await agent.delete(`/api/expenses/${inserted.rows[0].id}`);

        expect(response.status).toBe(500);
        const row = await query('SELECT id FROM expenses WHERE id = $1', [inserted.rows[0].id]);
        expect(row.rows).toHaveLength(1);
        expect(await balances()).toEqual(before);
    });

    test('an insufficient balance is rejected with 400 and writes nothing', async () => {
        const before = await balances();
        const logBefore = await activityCount();

        const response = await agent.post('/api/expenses').send({
            title: 'Too expensive', amount: 999999, paymentMethod: 'bank', paymentSourceId: bankA.id, date: '2026-09-15'
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Insufficient bank balance');
        expect(await balances()).toEqual(before);
        expect(await activityCount()).toBe(logBefore);
    });

    test('editing a missing entry returns 404', async () => {
        const response = await agent.put('/api/income/999999999').send({
            source: 'Nothing', amount: 1, creditedToType: 'cash', date: '2026-09-15'
        });

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Income transaction not found');
    });
});

describe('edit and delete restore balances exactly', () => {
    test('income moved from a bank to cash, then deleted', async () => {
        const start = await balances();

        const created = await agent.post('/api/income').send({
            source: 'Bonus', amount: 500, creditedToType: 'bank', creditedToId: bankA.id, date: '2026-09-05'
        });
        expect(created.status).toBe(200);
        expect(Number((await balances()).bankA)).toBe(Number(start.bankA) + 500);

        const edited = await agent.put(`/api/income/${created.body.id}`).send({
            source: 'Bonus', amount: 200, creditedToType: 'cash', date: '2026-09-05'
        });
        expect(edited.status).toBe(200);
        const afterEdit = await balances();
        expect(afterEdit.bankA).toBe(start.bankA);
        expect(Number(afterEdit.cash)).toBe(Number(start.cash) + 200);

        const deleted = await agent.delete(`/api/income/${created.body.id}`);
        expect(deleted.status).toBe(200);
        expect(await balances()).toEqual(start);
    });

    test('expense moved from a card to a bank, then deleted', async () => {
        const start = await balances();

        const created = await agent.post('/api/expenses').send({
            title: 'Laptop', amount: 100, paymentMethod: 'credit_card', paymentSourceId: card.id, date: '2026-09-06'
        });
        expect(created.status).toBe(200);
        expect(Number((await balances()).cardUsed)).toBe(Number(start.cardUsed) + 100);

        const edited = await agent.put(`/api/expenses/${created.body.id}`).send({
            title: 'Laptop', amount: 250, paymentMethod: 'bank', paymentSourceId: bankB.id, date: '2026-09-06'
        });
        expect(edited.status).toBe(200);
        const afterEdit = await balances();
        expect(afterEdit.cardUsed).toBe(start.cardUsed);
        expect(Number(afterEdit.bankB)).toBe(Number(start.bankB) - 250);

        const deleted = await agent.delete(`/api/expenses/${created.body.id}`);
        expect(deleted.status).toBe(200);
        expect(await balances()).toEqual(start);
    });

    test('each successful change writes exactly one activity log entry', async () => {
        const logBefore = await activityCount();

        const created = await agent.post('/api/income').send({
            source: 'Refund', amount: 40, creditedToType: 'cash', date: '2026-09-07'
        });
        await agent.put(`/api/income/${created.body.id}`).send({
            source: 'Refund', amount: 45, creditedToType: 'cash', date: '2026-09-07'
        });
        await agent.delete(`/api/income/${created.body.id}`);

        expect(await activityCount()).toBe(logBefore + 3);
    });
});

describe('expenses-only users', () => {
    const EXPENSES_USER = 'atomic_expenses_only';
    let expensesAgent;
    let expensesUserId;
    let expensesBank;

    beforeAll(async () => {
        await deleteTestUser(EXPENSES_USER);
        const user = await createTestUser({
            username: EXPENSES_USER, password: PASSWORD, email: 'expenses-only@example.com', trackingOption: 'expenses'
        });
        expensesUserId = user.id;
        expensesBank = await createTestBank(expensesUserId, { name: 'EXPENSES ONLY BANK', balance: 100 });

        expensesAgent = request.agent(target());
        const login = await logIn(expensesAgent, EXPENSES_USER, PASSWORD);
        expect(login.status).toBe(200);
    });

    afterAll(async () => {
        await deleteTestUser(EXPENSES_USER);
    });

    async function bankBalance() {
        const result = await query('SELECT current_balance FROM banks WHERE id = $1', [expensesBank.id]);
        return Number(result.rows[0].current_balance);
    }

    test('adding, editing and deleting an expense always changes the balance, even past zero', async () => {
        // No overspend check for expenses-only users, but the balance still moves
        const created = await expensesAgent.post('/api/expenses').send({
            title: 'Rent', amount: 150, paymentMethod: 'bank', paymentSourceId: expensesBank.id, date: '2026-09-01'
        });
        expect(created.status).toBe(200);
        expect(await bankBalance()).toBe(-50);

        const edited = await expensesAgent.put(`/api/expenses/${created.body.id}`).send({
            title: 'Rent', amount: 80, paymentMethod: 'bank', paymentSourceId: expensesBank.id, date: '2026-09-01'
        });
        expect(edited.status).toBe(200);
        expect(await bankBalance()).toBe(20);

        const deleted = await expensesAgent.delete(`/api/expenses/${created.body.id}`);
        expect(deleted.status).toBe(200);
        expect(await bankBalance()).toBe(100);
    });
});

describe('guards', () => {
    /** Every TypeScript file in lib/ and app/, except the transaction helper itself */
    function serverSources() {
        const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return walk(full);
            return /\.tsx?$/.test(entry.name) ? [full] : [];
        });
        return [...walk(path.join(__dirname, '../lib')), ...walk(path.join(__dirname, '../app'))]
            .filter(file => !file.endsWith(path.join('lib', 'transaction.ts')));
    }

    test('no code starts a transaction on the pool', () => {
        for (const file of serverSources()) {
            expect({ file, match: /pool(\(\))?\.query\(\s*['"`]BEGIN/.test(fs.readFileSync(file, 'utf8')) }).toEqual({ file, match: false });
        }
    });

    test('no hand-written transactions: all go through withTransaction', () => {
        // A manual BEGIN with an early return used to leave transactions open on pooled connections
        for (const file of serverSources()) {
            expect({ file, match: /\.query\(\s*['"`](BEGIN|COMMIT|ROLLBACK)/.test(fs.readFileSync(file, 'utf8')) }).toEqual({ file, match: false });
        }
    });
});
