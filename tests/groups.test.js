/**
 * Shared expenses and groups (real database, balancetrack_test schema; lib/services/groups.ts)
 *
 * The plan's Goa trip: four people; you pay the trains, Rahul the hotel, Sneha the food. Only your
 * share is your spending; what friends owe you, or you owe them, sits on their person accounts.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'groups_user';
const OTHER = 'groups_other';
const PASSWORD = 'Groups_Pass9';

const india = new Date(Date.now() + 330 * 60_000);
const daysAgo = n => new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), india.getUTCDate() - n)).toISOString().slice(0, 10);

let agent;
let otherAgent;
let user;
let bank;
let trip;
let p;
let categories;

const balanceOf = async id => (await agent.get('/api/accounts')).body.find(account => account.id === id).balance;
const personBalance = async name => (await agent.get('/api/people')).body.people.find(item => item.name === name).balance;
const spending = async () => Number((await query(
    `SELECT coalesce(sum(l.amount_paise), 0)::bigint AS paise FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.id = l.account_id
     WHERE e.user_id = $1 AND e.voided_at IS NULL AND a.kind = 'expense'`, [user.id])).rows[0].paise);
const member = name => trip.members.find(item => item.name === name);
const everyone = () => trip.members.map(item => ({ member: item.key }));

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'groups_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'groups_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Groups Bank', initialBalance: 100000 })).status).toBe(200);
    bank = (await agent.get('/api/accounts')).body.find(account => account.type === 'bank');
    p = {};
    for (const name of ['Rahul', 'Sneha', 'Amit']) p[name] = (await agent.post('/api/people').send({ name })).body.id;
    categories = (await agent.get('/api/categories')).body;
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

const category = name => categories.find(item => item.name === name).id;
const addCost = body => agent.post(`/api/groups/${trip.id}/expenses`).send({ date: daysAgo(3), split: 'equal', ...body });

test('a group of people from the list, with you always in it', async () => {
    const event = (await agent.post('/api/events').send({ name: 'Goa trip' })).body;
    const created = await agent.post('/api/groups').send({ name: 'Goa trip', memberIds: [p.Rahul, p.Sneha, p.Amit], eventId: event.id });
    expect(created.status).toBe(200);
    trip = created.body;
    expect(trip.members.map(item => item.name)).toEqual(['You', 'Amit', 'Rahul', 'Sneha']);
    expect(trip.event).toMatchObject({ name: 'Goa trip' });
    expect((await agent.post('/api/groups').send({ name: 'goa trip', memberIds: [p.Rahul] })).body.error).toBe('There is already a group called goa trip');
    expect((await agent.post('/api/groups').send({ name: 'Empty', memberIds: [] })).body.error).toBe('Add at least one person to the group');
});

test('you pay for everyone: the whole amount leaves your account, your share is spending, each friend owes theirs', async () => {
    const before = await spending();
    trip = (await addCost({ description: 'Train tickets', amount: '12000', paidBy: 'you', accountId: bank.id, categoryId: category('Travel'), parts: everyone() })).body;
    expect(await balanceOf(bank.id)).toBe('88000.00');
    expect(await spending() - before).toBe(300_000);
    expect(await personBalance('Rahul')).toBe('3000.00');
    expect(trip.yourBalance).toBe('9000.00');
});

test('a friend pays for everyone: no money moves, your share is still spending, owed to them', async () => {
    trip = (await addCost({ description: 'Hotel', amount: '24000', paidBy: member('Rahul').key, categoryId: category('Travel'), parts: everyone() })).body;
    trip = (await addCost({ description: 'Food', amount: '8000', paidBy: member('Sneha').key, categoryId: category('Restaurants and food delivery'), parts: everyone() })).body;
    expect(await balanceOf(bank.id)).toBe('88000.00');
    expect(await personBalance('Rahul')).toBe('-3000.00');
    expect(await personBalance('Sneha')).toBe('1000.00');
    expect(await personBalance('Amit')).toBe('3000.00');
    // The plan's numbers: the trip cost 44,000, your share 11,000; you paid 12,000, so you are owed 1,000
    expect(trip).toMatchObject({ yourCost: '11000.00', groupCost: '44000.00', yourBalance: '1000.00' });
    expect(Object.fromEntries(trip.members.map(item => [item.name, item.balance]))).toEqual({ You: '1000.00', Amit: '-11000.00', Rahul: '13000.00', Sneha: '-3000.00' });
});

test('a treat is all the payer\'s; a cost between friends touches only the group', async () => {
    const before = await spending();
    trip = (await addCost({ description: 'Ice cream', amount: '400', paidBy: 'you', accountId: bank.id, treat: true })).body;
    expect(await spending() - before).toBe(40_000);
    trip = (await addCost({ description: 'Sneha\'s shopping', amount: '1000', paidBy: member('Rahul').key, split: 'exact', parts: [{ member: member('Sneha').key, value: '1000' }] })).body;
    expect(await spending() - before).toBe(40_000);
    expect(await personBalance('Rahul')).toBe('-3000.00');
    expect(member('Rahul').balance).toBe('14000.00');
    expect(member('Sneha').balance).toBe('-4000.00');
});

test('splits by amounts, percentages and shares; mistakes refused', async () => {
    const percent = (await addCost({ description: 'Boat', amount: '1000', paidBy: 'you', accountId: bank.id, split: 'percent',
        parts: [{ member: 'you', value: '50' }, { member: member('Amit').key, value: '50' }] })).body;
    expect(percent.expenses[0]).toMatchObject({ description: 'Boat', yourShare: '500.00' });
    const shares = (await addCost({ description: 'Taxi', amount: '900', paidBy: 'you', accountId: bank.id, split: 'shares',
        parts: [{ member: 'you', value: '2' }, { member: member('Amit').key, value: '1' }] })).body;
    expect(shares.expenses[0]).toMatchObject({ description: 'Taxi', yourShare: '600.00' });
    trip = shares;
    expect((await addCost({ description: 'x', amount: '100', paidBy: 'you', accountId: bank.id, split: 'exact', parts: [{ member: 'you', value: '50' }] })).body.error)
        .toBe('The amounts must add up to the total');
    expect((await addCost({ description: 'x', amount: '100', paidBy: 'you', accountId: bank.id, split: 'percent', parts: [{ member: 'you', value: '90' }] })).body.error)
        .toBe('The percentages must add up to 100');
    expect((await addCost({ description: 'x', amount: '100', paidBy: 'p999999', parts: everyone() })).body.error).toBe('Who paid must be in the group');
    expect((await addCost({ description: 'x', amount: '100', paidBy: 'you', accountId: bank.id, parts: [] })).body.error).toBe('Choose who shares this cost');
});

test('your shares show in Transactions as spending, changed only in the group', async () => {
    const [year, month] = daysAgo(3).split('-');
    const entries = (await agent.get(`/api/entries?month=${Number(month)}&year=${year}`)).body;
    const train = entries.find(entry => entry.description === 'Train tickets');
    expect(train).toMatchObject({ type: 'expense', amount: '3000.00', shared: true, account: { name: 'GROUPS BANK' }, category: { name: 'Travel' }, event: { name: 'Goa trip' } });
    expect(entries.find(entry => entry.description === 'Hotel')).toMatchObject({ amount: '6000.00', account: { name: 'Rahul' } });
    expect(entries.find(entry => entry.description === 'Sneha\'s shopping')).toBeUndefined();
    const edit = await agent.put(`/api/entries/${train.id}`).send({ type: 'expense', date: train.date, description: 'x', amount: '1', accountId: bank.id });
    expect(edit.body.error).toBe('Train tickets is a shared expense: change it in its group');
});

test('the fewest payments settle everyone; a payment to you moves money, one between friends only the group', async () => {
    const plan = trip.plan;
    expect(plan.length).toBeLessThanOrEqual(trip.members.length - 1);
    // The plan pays exactly what the debtors owe
    const owed = trip.members.filter(item => Number(item.balance) < 0).reduce((sum, item) => sum - Number(item.balance), 0);
    expect(plan.reduce((sum, move) => sum + Number(move.amount), 0)).toBeCloseTo(owed, 2);
    const before = Number(await balanceOf(bank.id));
    trip = (await agent.post(`/api/groups/${trip.id}/settlements`).send({ from: member('Amit').key, to: 'you', amount: '3000', date: daysAgo(1), accountId: bank.id })).body;
    expect(Number(await balanceOf(bank.id))).toBe(before + 3000);
    trip = (await agent.post(`/api/groups/${trip.id}/settlements`).send({ from: member('Sneha').key, to: member('Rahul').key, amount: '4000', date: daysAgo(1) })).body;
    expect(Number(await balanceOf(bank.id))).toBe(before + 3000);
    expect(member('Sneha').balance).toBe('0.00');
    expect((await agent.post(`/api/groups/${trip.id}/settlements`).send({ from: 'you', to: 'you', amount: '1', date: daysAgo(1), accountId: bank.id })).body.error)
        .toBe('Choose two different people in the group');
});

test('removing a cost voids your entry; the group cannot be removed until settled; others see nothing', async () => {
    const boat = trip.expenses.find(expense => expense.description === 'Boat');
    const before = await spending();
    trip = (await agent.delete(`/api/groups/${trip.id}/expenses/${boat.id}`)).body;
    expect(before - await spending()).toBe(50_000);
    expect(trip.expenses.find(expense => expense.description === 'Boat')).toBeUndefined();
    expect((await agent.delete(`/api/groups/${trip.id}`)).body.error).toBe('Settle up first: someone in this group still owes money');
    expect((await otherAgent.get('/api/groups')).body).toEqual([]);
    expect((await otherAgent.post(`/api/groups/${trip.id}/expenses`).send({ description: 'x', amount: '1', date: daysAgo(1), paidBy: 'you', parts: [{ member: 'you' }] })).status).toBe(404);
    const unbalanced = await query(
        `SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE e.user_id = $1 GROUP BY e.id HAVING sum(l.amount_paise) <> 0`, [user.id]);
    expect(unbalanced.rows).toEqual([]);
});
