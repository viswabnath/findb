/**
 * Spending insights (real database, balancetrack_test schema; lib/services/insights.ts)
 *
 * Fuel jumps to more than twice its average this month; a one-off wedding is shown beside regular
 * spending and kept out of the averages; Netflix repeats monthly with a price rise.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn } = require('../test-helpers');

const USER = 'insights_user';
const OTHER = 'insights_other';
const PASSWORD = 'Insight_Pass9';

const pad = n => String(n).padStart(2, '0');
const india = new Date(Date.now() + 330 * 60_000);
// Netflix is charged a few days before today's date each month, so the last charge is about a month ago (still active)
const NETFLIX_DAY = Math.min(Math.max(india.getUTCDate() - 3, 1), 28);
/** The first or fifth of the month n months before this one, YYYY-MM-DD */
const monthDay = (back, day) => {
    const date = new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth() - back, day));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
const MONTH = india.getUTCMonth() + 1;
const YEAR = india.getUTCFullYear();

let agent;

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await createTestUser({ username: USER, password: PASSWORD, email: 'insights_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'insights_other@example.com' });
    agent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Insights Bank', initialBalance: 500000 })).status).toBe(200);
    const bank = (await agent.get('/api/accounts')).body.find(account => account.type === 'bank');
    const categories = (await agent.get('/api/categories')).body;
    const id = name => categories.find(category => category.name === name).id;
    const wedding = (await agent.post('/api/events').send({ name: 'Cousin wedding', oneOff: true })).body;
    const expense = (date, description, amount, category, extra = {}) => ({ type: 'expense', date, description, amount, accountId: bank.id, categoryId: id(category), ...extra });
    const saved = await agent.post('/api/entries/bulk').send({ entries: [
        expense(monthDay(3, 1), 'Petrol', '2000', 'Fuel'),
        expense(monthDay(2, 1), 'Petrol', '2000', 'Fuel'),
        expense(monthDay(1, 1), 'Petrol', '2000', 'Fuel'),
        expense(monthDay(0, 1), 'Petrol', '5000', 'Fuel'),
        expense(monthDay(0, 1), 'Wedding gift', '10000', 'Gifts', { eventId: wedding.id }),
        expense(monthDay(4, NETFLIX_DAY), 'Netflix', '499', 'Subscriptions'),
        expense(monthDay(3, NETFLIX_DAY), 'Netflix', '499', 'Subscriptions'),
        expense(monthDay(2, NETFLIX_DAY), 'Netflix', '499', 'Subscriptions'),
        expense(monthDay(1, NETFLIX_DAY), 'Netflix', '649', 'Subscriptions'),
    ] });
    expect(saved.status).toBe(200);
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

test('the month: regular spending, the one-off event beside it, and the thresholds used', async () => {
    const response = await agent.get(`/api/insights?month=${MONTH}&year=${YEAR}`);
    expect(response.status).toBe(200);
    const data = response.body;
    expect(data.month).toBe(`${YEAR}-${pad(MONTH)}`);
    expect(data.thresholds).toEqual({ unusualRatio: 2, unusualMinimum: '1000.00', historyMonths: 2 });
    expect(data.spending).toEqual({ regular: '5000.00', oneOff: '10000.00', events: [{ id: expect.any(Number), name: 'Cousin wedding', amount: '10000.00' }] });
    expect(data.trend).toHaveLength(12);
    expect(data.trend[11]).toEqual({ month: data.month, regular: '5000.00', oneOff: '10000.00' });
});

test('fuel at more than twice its average is unusual; the wedding stays out of the averages', async () => {
    const data = (await agent.get(`/api/insights?month=${MONTH}&year=${YEAR}`)).body;
    const fuel = data.categories.find(item => item.name === 'Fuel');
    expect(fuel).toMatchObject({ thisMonth: '5000.00', lastMonth: '2000.00', average3: '2000.00', unusual: true });
    expect(data.categories.find(item => item.name === 'Gifts')).toBeUndefined();
    expect(data.categories.filter(item => item.unusual).map(item => item.name)).toEqual(['Fuel']);
});

test('Netflix is a monthly subscription with a price rise', async () => {
    const data = (await agent.get('/api/insights')).body;
    expect(data.subscriptions.items).toEqual([expect.objectContaining({
        description: 'Netflix', cadence: 'monthly', charges: 4, lastAmount: '649.00', monthly: '649.00', yearly: '7788.00',
        category: 'Subscriptions', account: 'INSIGHTS BANK', status: 'active', priceRiseFrom: '499.00',
    })]);
    expect(data.subscriptions).toMatchObject({ monthly: '649.00', yearly: '7788.00' });
});

test('another user sees none of it, and a bad month is refused', async () => {
    const other = request.agent(target());
    expect((await logIn(other, OTHER, PASSWORD)).status).toBe(200);
    const data = (await other.get('/api/insights')).body;
    expect(data.categories).toEqual([]);
    expect(data.subscriptions.items).toEqual([]);
    expect((await agent.get('/api/insights?month=13&year=2026')).status).toBe(400);
});
