/**
 * Budgets (real database, balancetrack_test schema; lib/services/budgets.ts)
 *
 * A monthly limit per spending category, read against the ledger: near at 80%, over at 100%;
 * the next step on Accounts points to the fullest; other users see none of it.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'budgets_user';
const OTHER = 'budgets_other';
const PASSWORD = 'Budget_Pass9';

const pad = n => String(n).padStart(2, '0');
const india = new Date(Date.now() + 330 * 60_000);
const TODAY = `${india.getUTCFullYear()}-${pad(india.getUTCMonth() + 1)}-${pad(india.getUTCDate())}`;
const MONTH_START = `${TODAY.slice(0, 8)}01`;

let agent;
let otherAgent;
let user;
let bank;
let id;

const spend = (amount, category, date = MONTH_START) =>
    agent.post('/api/entries').send({ type: 'expense', date, description: `Spent on ${category}`, amount, accountId: bank.id, categoryId: id(category) });

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'budgets_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'budgets_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Budget Bank', initialBalance: 100000 })).status).toBe(200);
    bank = (await agent.get('/api/accounts')).body.find(account => account.type === 'bank');
    const categories = (await agent.get('/api/categories')).body;
    id = name => categories.find(category => category.name === name).id;
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

let groceries;

test('a budget is set, and spending in the month counts against it', async () => {
    const set = await agent.put('/api/budgets').send({ categoryId: id('Groceries'), amount: '5000' });
    expect(set.status).toBe(200);
    groceries = set.body;
    expect(groceries).toMatchObject({ category: { name: 'Groceries' }, amount: '5000.00', spent: '0.00', left: '5000.00', percent: 0, state: 'ok' });

    expect((await spend('3000', 'Groceries')).status).toBe(200);
    // Last month's spending does not count this month
    const lastMonth = new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth() - 1, 10)).toISOString().slice(0, 10);
    expect((await spend('9000', 'Groceries', lastMonth)).status).toBe(200);
    const [budget] = (await agent.get('/api/budgets')).body;
    expect(budget).toMatchObject({ spent: '3000.00', left: '2000.00', percent: 60, state: 'ok' });
});

test('near at 80%, over at 100%; the status call warns after an entry, and the next step points to it', async () => {
    expect((await spend('1000', 'Groceries')).status).toBe(200);
    let status = (await agent.get(`/api/budgets/status?categoryId=${id('Groceries')}&date=${TODAY}`)).body.budget;
    expect(status).toMatchObject({ percent: 80, state: 'near' });
    expect((await agent.get('/api/next-step')).body).toMatchObject({ kind: 'budget', text: 'Groceries has used 80% of its budget: ₹4,000.00 of ₹5,000.00 this month.' });

    expect((await spend('1500', 'Groceries')).status).toBe(200);
    status = (await agent.get(`/api/budgets/status?categoryId=${id('Groceries')}&date=${TODAY}`)).body.budget;
    expect(status).toMatchObject({ spent: '5500.00', left: '-500.00', percent: 110, state: 'over' });
    expect((await agent.get('/api/next-step')).body.text).toBe('Groceries is over its budget: ₹5,500.00 spent of ₹5,000.00 this month.');
    // A category without a budget has no status
    expect((await agent.get(`/api/budgets/status?categoryId=${id('Fuel')}`)).body).toEqual({ budget: null });
});

test('a second limit for the category changes it; the activity log records both', async () => {
    const changed = await agent.put('/api/budgets').send({ categoryId: id('Groceries'), amount: '8000' });
    expect(changed.body).toMatchObject({ id: groceries.id, amount: '8000.00', state: 'ok' });
    const log = await query('SELECT action_type, description FROM activity_log WHERE user_id = $1 AND entity_type = $2 ORDER BY id', [user.id, 'budget']);
    expect(log.rows).toEqual([
        { action_type: 'created', description: 'Set budget: Groceries' },
        { action_type: 'updated', description: 'Changed budget: Groceries' },
    ]);
});

test('refusals: income categories, bad amounts, other users', async () => {
    expect((await agent.put('/api/budgets').send({ categoryId: id('Salary'), amount: '10' })).body.error).toBe('Budgets are for spending categories');
    expect((await agent.put('/api/budgets').send({ categoryId: id('Fuel'), amount: '0' })).status).toBe(400);
    expect((await agent.put('/api/budgets').send({ categoryId: id('Fuel'), amount: 'abc' })).body.error).toBe('Enter a valid amount');
    expect((await otherAgent.put('/api/budgets').send({ categoryId: id('Fuel'), amount: '10' })).body.error).toBe('Category not found');
    expect((await otherAgent.get('/api/budgets')).body).toEqual([]);
    expect((await otherAgent.delete(`/api/budgets/${groceries.id}`)).status).toBe(404);
    expect((await agent.get('/api/budgets?month=13&year=2026')).status).toBe(400);
});

test('removed', async () => {
    expect((await agent.delete(`/api/budgets/${groceries.id}`)).status).toBe(200);
    expect((await agent.get('/api/budgets')).body).toEqual([]);
    expect((await agent.get('/api/next-step')).body.kind).not.toBe('budget');
});
