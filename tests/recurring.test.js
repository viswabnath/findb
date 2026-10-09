/**
 * Repeating entries (real database, balancetrack_test schema; docs/ledger.md)
 *
 * Automatic ones are recorded when FinDB is opened (POST /api/recurring/run), catching up on every
 * date missed, never twice even when two pages open at once; confirm ones wait to be confirmed,
 * with their amount or another, or skipped. Reminders list what is due soon.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'recurring_user';
const OTHER = 'recurring_other';
const PASSWORD = 'Ledger_Pass9';

/** Today in India, as the server counts it, and days from it */
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function shift(days) {
    const [y, m, d] = TODAY.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

let agent;
let user;
let bank;
let cash;
let categories;
const category = name => categories.find(item => item.name === name).id;
const run = () => agent.post('/api/recurring/run').send({});
const entriesOf = async recurringId => (await query(
    'SELECT recurring_on::text AS on, entry_type FROM journal_entries WHERE recurring_id = $1 AND voided_at IS NULL ORDER BY recurring_on', [recurringId])).rows;

beforeAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(OTHER);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'recurring_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'recurring_other@example.com' });
    agent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    await agent.post('/api/banks').send({ name: 'Recurring Bank', initialBalance: 100000 });
    const accounts = (await agent.get('/api/accounts')).body;
    bank = accounts.find(account => account.type === 'bank');
    cash = accounts.find(account => account.type === 'cash');
    categories = (await agent.get('/api/categories')).body;
});

afterAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(OTHER);
    await closeTarget();
});

describe('automatic', () => {
    let daily;

    test('every missed date is recorded once when FinDB opens, never again', async () => {
        const created = await agent.post('/api/recurring').send({
            type: 'expense', description: 'Daily gold SIP', amount: 100, accountId: bank.id, categoryId: category('Other'),
            tags: ['gold'], frequency: 'daily', startsOn: shift(-4), mode: 'auto',
        });
        expect(created.status).toBe(200);
        daily = created.body;
        expect(daily).toMatchObject({ frequency: 'daily', nextDue: shift(-4), mode: 'auto', category: { name: 'Other' }, tags: ['gold'] });

        const first = await run();
        expect(first.status).toBe(200);
        expect(first.body.posted).toBe(5);
        expect((await entriesOf(daily.id)).map(row => row.on)).toEqual([shift(-4), shift(-3), shift(-2), shift(-1), TODAY]);
        expect((await run()).body.posted).toBe(0);
        const list = (await agent.get('/api/recurring')).body;
        expect(list.find(item => item.id === daily.id).nextDue).toBe(shift(1));

        // The entries look like any other, with the category and tags
        const month = Number(TODAY.slice(5, 7));
        const entries = (await agent.get(`/api/entries?month=${month}&year=${TODAY.slice(0, 4)}`)).body.filter(item => item.description === 'Daily gold SIP');
        expect(entries.length).toBeGreaterThan(0);
        expect(entries[0]).toMatchObject({ category: { name: 'Other' }, tags: ['gold'], amount: '100.00' });
    });

    test('two pages opening at once never record a date twice', async () => {
        const weekly = (await agent.post('/api/recurring').send({
            type: 'income', description: 'Pocket money', amount: 50, accountId: cash.id, frequency: 'daily', startsOn: shift(-2), mode: 'auto',
        })).body;
        const results = await Promise.all([run(), run(), run()]);
        for (const result of results) expect([200, 503]).toContain(result.status);
        expect(await entriesOf(weekly.id)).toHaveLength(3);
    });

    test('a paused one is not recorded until it is resumed; an ended one stops', async () => {
        const paused = (await agent.post('/api/recurring').send({
            type: 'expense', description: 'Newspaper', amount: 10, accountId: cash.id, frequency: 'daily', startsOn: shift(-1), mode: 'auto',
        })).body;
        expect((await agent.put(`/api/recurring/${paused.id}`).send({ paused: true })).body.paused).toBe(true);
        await run();
        expect(await entriesOf(paused.id)).toHaveLength(0);
        await agent.put(`/api/recurring/${paused.id}`).send({ paused: false });
        await run();
        expect(await entriesOf(paused.id)).toHaveLength(2);

        const ended = (await agent.post('/api/recurring').send({
            type: 'expense', description: 'Short course', amount: 20, accountId: cash.id, frequency: 'daily', startsOn: shift(-3), endsOn: shift(-2), mode: 'auto',
        })).body;
        await run();
        expect(await entriesOf(ended.id)).toHaveLength(2);
        expect((await agent.get('/api/recurring')).body.find(item => item.id === ended.id).nextDue).toBeNull();
    });

    test('one that cannot be recorded is reported, and the others still are', async () => {
        const wallet = (await agent.post('/api/accounts').send({ type: 'wallet', name: 'Old wallet' })).body;
        const broken = (await agent.post('/api/recurring').send({
            type: 'expense', description: 'From the old wallet', amount: 5, accountId: wallet.id, frequency: 'daily', startsOn: TODAY, mode: 'auto',
        })).body;
        const fine = (await agent.post('/api/recurring').send({
            type: 'expense', description: 'Still fine', amount: 5, accountId: cash.id, frequency: 'daily', startsOn: TODAY, mode: 'auto',
        })).body;
        expect((await agent.delete(`/api/accounts/${wallet.id}`)).status).toBe(200);
        const result = (await run()).body;
        expect(result.problems).toEqual([expect.objectContaining({ recurringId: broken.id, description: 'From the old wallet', error: 'Account not found' })]);
        expect(await entriesOf(fine.id)).toHaveLength(1);
        expect(await entriesOf(broken.id)).toHaveLength(0);
    });
});

describe('confirm', () => {
    let rent;

    test('due dates wait to be confirmed, with their amount or another, or skipped', async () => {
        rent = (await agent.post('/api/recurring').send({
            type: 'expense', description: 'Electricity bill', amount: 1500, accountId: bank.id, categoryId: category('Bills and utilities'),
            frequency: 'daily', startsOn: shift(-1),
        })).body;
        expect(rent.mode).toBe('confirm');
        const due = (await run()).body;
        expect(due.pending.filter(item => item.recurringId === rent.id).map(item => item.date)).toEqual([shift(-1), TODAY]);
        expect(await entriesOf(rent.id)).toHaveLength(0);

        expect((await agent.post(`/api/recurring/${rent.id}/confirm`).send({ date: TODAY })).body.error).toBe(`The next date due is ${shift(-1)}`);
        const confirmed = await agent.post(`/api/recurring/${rent.id}/confirm`).send({ amount: '1723.40' });
        expect(confirmed.status).toBe(200);
        expect(confirmed.body.entry).toMatchObject({ amount: '1723.40', date: shift(-1), category: { name: 'Bills and utilities' } });
        expect(confirmed.body.repeating.nextDue).toBe(TODAY);

        const skipped = await agent.post(`/api/recurring/${rent.id}/skip`).send({ date: TODAY });
        expect(skipped.body.nextDue).toBe(shift(1));
        expect((await entriesOf(rent.id)).map(row => row.on)).toEqual([shift(-1)]);
    });

    test('a confirmed entry is checked against the balance, like any new one', async () => {
        const big = (await agent.post('/api/recurring').send({
            type: 'expense', description: 'Huge', amount: 9999999, accountId: bank.id, frequency: 'daily', startsOn: TODAY,
        })).body;
        const refused = await agent.post(`/api/recurring/${big.id}/confirm`).send({});
        expect(refused.status).toBe(400);
        expect(refused.body.error).toBe('Insufficient bank balance');
    });

    test('reminders list what is due within the reminder days', async () => {
        const soon = (await agent.post('/api/recurring').send({
            type: 'expense', description: 'Insurance premium', amount: 2000, accountId: bank.id,
            frequency: 'yearly', month: Number(shift(2).slice(5, 7)), dayOfMonth: Number(shift(2).slice(8, 10)), startsOn: TODAY, remindDays: 3,
        })).body;
        const later = (await agent.post('/api/recurring').send({
            type: 'expense', description: 'Far away', amount: 2000, accountId: bank.id,
            frequency: 'yearly', month: Number(shift(20).slice(5, 7)), dayOfMonth: Number(shift(20).slice(8, 10)), startsOn: TODAY, remindDays: 3,
        })).body;
        const upcoming = (await run()).body.upcoming;
        expect(upcoming).toContainEqual(expect.objectContaining({ recurringId: soon.id, date: shift(2) }));
        expect(upcoming.map(item => item.recurringId)).not.toContain(later.id);
    });
});

describe('rules', () => {
    test('mistakes are refused', async () => {
        const post = body => agent.post('/api/recurring').send({ type: 'expense', description: 'Probe', amount: 10, accountId: bank.id, frequency: 'monthly', dayOfMonth: 5, startsOn: TODAY, ...body });
        expect((await post({ frequency: 'weekly' })).body.error).toBe('Choose the day of the week');
        expect((await post({ dayOfMonth: 32 })).body.error).toBe('Choose the day of the month (1 to 31)');
        expect((await post({ frequency: 'hourly' })).body.error).toBe('Repeat daily, weekly, monthly or yearly');
        expect((await post({ endsOn: shift(-1) })).body.error).toBe('The end date is before the start date');
        expect((await post({ type: 'transfer', toAccountId: bank.id })).body.error).toBe('Choose two different accounts for a transfer');
        expect((await post({ type: 'income', categoryId: category('Groceries') })).body.error).toBe('Choose an income category for income');
        expect((await post({ amount: 0 })).body.error).toBe('Enter an amount greater than zero');
        expect((await post({ mode: 'sometimes' })).body.error).toBe('Mode must be auto or confirm');
    });

    test('a monthly one starts on its first day on or after the start date; an edit keeps what it leaves out', async () => {
        const created = (await agent.post('/api/recurring').send({
            type: 'transfer', description: 'SIP to broker', amount: 5000, accountId: bank.id, toAccountId: cash.id, frequency: 'monthly', dayOfMonth: 31, startsOn: '2027-02-01',
        })).body;
        expect(created.nextDue).toBe('2027-02-28');
        const edited = (await agent.put(`/api/recurring/${created.id}`).send({ amount: 6000 })).body;
        expect(edited).toMatchObject({ amount: '6000.00', description: 'SIP to broker', dayOfMonth: 31, toAccount: { id: cash.id } });
        expect((await agent.delete(`/api/recurring/${created.id}`)).status).toBe(200);
    });

    test('deleting a repeating entry keeps the entries it made', async () => {
        const made = (await agent.post('/api/recurring').send({
            type: 'expense', description: 'Gym', amount: 30, accountId: cash.id, frequency: 'daily', startsOn: TODAY, mode: 'auto',
        })).body;
        await run();
        const before = (await query('SELECT count(*)::int AS n FROM journal_entries WHERE user_id = $1 AND description = $2 AND voided_at IS NULL', [user.id, 'Gym'])).rows[0].n;
        expect(before).toBe(1);
        expect((await agent.delete(`/api/recurring/${made.id}`)).status).toBe(200);
        const after = (await query('SELECT count(*)::int AS n FROM journal_entries WHERE user_id = $1 AND description = $2 AND voided_at IS NULL', [user.id, 'Gym'])).rows[0].n;
        expect(after).toBe(1);
    });

    test('another user\'s repeating entries and accounts are not theirs', async () => {
        const otherAgent = request.agent(target());
        await logIn(otherAgent, OTHER, PASSWORD);
        expect((await otherAgent.get('/api/recurring')).body).toEqual([]);
        const mine = (await agent.get('/api/recurring')).body[0];
        expect((await otherAgent.put(`/api/recurring/${mine.id}`).send({ amount: 1 })).status).toBe(404);
        expect((await otherAgent.post(`/api/recurring/${mine.id}/confirm`).send({})).status).toBe(404);
        const theirs = await otherAgent.post('/api/recurring').send({
            type: 'expense', description: 'Probe', amount: 1, accountId: bank.id, frequency: 'daily', startsOn: TODAY,
        });
        expect(theirs.body.error).toBe('Account not found');
    });
});
