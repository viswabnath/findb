/**
 * Sample data and the next step (real database, balancetrack_test schema; lib/services/sample-data.ts)
 *
 * A fresh account can be filled with a sample family's money and cleared again; while it is
 * loaded the database refuses every real entry, so sample and real money never mix.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'sample_user';
const BUSY = 'sample_busy';
const PASSWORD = 'Ledger_Pass9';

const today = new Date();
const MONTH = today.getMonth() + 1;
const YEAR = today.getFullYear();
const TODAY = `${YEAR}-${String(MONTH).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

let agent;
let user;

beforeAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(BUSY);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'sample_user@example.com' });
    await createTestUser({ username: BUSY, password: PASSWORD, email: 'sample_busy@example.com' });
    agent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
});

afterAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(BUSY);
    await closeTarget();
});

const nextStep = async () => (await agent.get('/api/next-step')).body;

describe('sample data', () => {
    test('a fresh account is offered a start, with sample data', async () => {
        expect(await nextStep()).toMatchObject({ kind: 'start', href: '/setup#bank-name' });
        expect((await agent.get('/api/user')).body.sampleData).toBe(false);
    });

    test('loading fills three months, marked as sample everywhere', async () => {
        const loaded = await agent.post('/api/sample-data');
        expect(loaded.status).toBe(200);
        expect(loaded.body.entries).toBeGreaterThan(10);
        expect((await agent.get('/api/user')).body.sampleData).toBe(true);
        expect((await nextStep()).kind).toBe('sample');

        const accounts = (await agent.get('/api/accounts')).body.filter(account => account.type !== 'cash');
        expect(accounts.length).toBe(3);
        for (const account of accounts) expect(account.name).toMatch(/\(SAMPLE\)$/);
        const banks = (await agent.get('/api/banks')).body;
        expect(banks.map(bank => bank.name)).toEqual(['HDFC SAVINGS (SAMPLE)', 'SBI SAVINGS (SAMPLE)']);

        // Two months back has a whole month: salary in, and the summary shows it although that is before registration
        const back = new Date(Date.UTC(YEAR, MONTH - 3, 1));
        const old = (await agent.get(`/api/monthly-summary?month=${back.getUTCMonth() + 1}&year=${back.getUTCFullYear()}`)).body;
        expect(old.monthlyIncome).toBe(113000);
        expect(old.totalExpenses).toBeGreaterThan(40000);
        expect((await agent.get('/api/events')).body.map(event => event.name)).toContain('Goa trip (sample)');

        // Nothing is dated after today
        const future = await query('SELECT COUNT(*)::int AS count FROM journal_entries WHERE user_id = $1 AND entry_date > $2', [user.id, TODAY]);
        expect(future.rows[0].count).toBe(0);
        expect((await agent.post('/api/sample-data')).body.error).toBe('Sample data is already loaded');
    });

    test('while it is loaded, no real entry can be recorded', async () => {
        const refused = await agent.post('/api/banks').send({ name: 'Real Bank', initialBalance: 1000 });
        expect(refused.status).toBe(400);
        expect(refused.body.error).toMatch(/^You are looking at sample data/);
        expect((await agent.get('/api/banks')).body).toHaveLength(2);

        const account = (await agent.get('/api/accounts')).body.find(item => item.name === 'HDFC SAVINGS (SAMPLE)');
        const entry = await agent.post('/api/entries').send({ type: 'expense', description: 'Real coffee', amount: 100, accountId: account.id, date: TODAY });
        expect(entry.status).toBe(400);
        expect(entry.body.error).toMatch(/sample/i);
    });

    test('clearing removes every sample row and nothing else', async () => {
        const before = await query('SELECT COUNT(*)::int AS count FROM ledger_accounts WHERE user_id = $1 AND NOT sample', [user.id]);
        const cleared = await agent.delete('/api/sample-data');
        expect(cleared.body).toEqual({ cleared: true });
        for (const table of ['journal_entries', 'ledger_accounts', 'banks', 'credit_cards', 'events', 'tags']) {
            const left = await query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE user_id = $1 AND sample`, [user.id]);
            expect(left.rows[0].count).toBe(0);
        }
        const after = await query('SELECT COUNT(*)::int AS count FROM ledger_accounts WHERE user_id = $1 AND NOT sample', [user.id]);
        expect(after.rows[0].count).toBe(before.rows[0].count);
        const summary = (await agent.get(`/api/monthly-summary?month=${MONTH}&year=${YEAR}`)).body;
        expect(summary.totalExpenses).toBe(0);
        expect((await agent.get('/api/user')).body.sampleData).toBe(false);
        expect((await agent.delete('/api/sample-data')).body).toEqual({ cleared: false });

        // Real money works again
        expect((await agent.post('/api/banks').send({ name: 'Real Bank', initialBalance: 1000 })).status).toBe(200);
    });

    test('with entries of your own, sample data is not loaded', async () => {
        expect((await agent.post('/api/sample-data')).body.error).toBe('Sample data is for a fresh start, and you already have entries of your own');
    });

    test('the next step asks for categories when this month has uncategorised spending', async () => {
        const account = (await agent.get('/api/accounts')).body.find(item => item.name === 'REAL BANK');
        const uncategorised = (await agent.get('/api/categories')).body.find(item => item.name === 'Uncategorised');
        await agent.post('/api/entries').send({ type: 'expense', description: 'Something', amount: 10, accountId: account.id, date: TODAY, categoryId: uncategorised.id });
        expect(await nextStep()).toMatchObject({ kind: 'categorise', href: '/transactions' });
    });

    test('another user is not affected by one user\'s sample data', async () => {
        const other = request.agent(target());
        await logIn(other, BUSY, PASSWORD);
        await agent.delete('/api/sample-data');
        expect((await other.post('/api/sample-data')).status).toBe(200);
        expect((await agent.get('/api/user')).body.sampleData).toBe(false);
        expect((await other.post('/api/banks').send({ name: 'Mine', initialBalance: 1 })).status).toBe(400);
        expect((await agent.post('/api/banks').send({ name: 'Second Real', initialBalance: 1 })).status).toBe(200);
        await other.delete('/api/sample-data');
    });
});
