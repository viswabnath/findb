/**
 * What's due (real database, balancetrack_test schema; lib/services/calendar.ts)
 *
 * A card bill, a new loan's EMIs, a monthly rent to confirm, money borrowed now overdue and money
 * lent due back: one list for this month and next, the totals, and what goes out of each account.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn } = require('../test-helpers');

const USER = 'calendar_user';
const OTHER = 'calendar_other';
const PASSWORD = 'Calendar_Pass9';

const india = new Date(Date.now() + 330 * 60_000);
const TODAY = india.toISOString().slice(0, 10);
const daysFrom = n => new Date(india.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const RENT_DAY = Math.min(Number(daysFrom(3).slice(8)), 28);

let agent;
let otherAgent;
let bank;

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await createTestUser({ username: USER, password: PASSWORD, email: 'calendar_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'calendar_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Cal Bank', initialBalance: 200000 })).status).toBe(200);
    expect((await agent.post('/api/credit-cards').send({ name: 'Cal Card', creditLimit: 100000 })).status).toBe(200);
    const accounts = (await agent.get('/api/accounts')).body;
    bank = accounts.find(account => account.type === 'bank');
    const card = accounts.find(account => account.type === 'credit_card');

    expect((await agent.post('/api/entries').send({ type: 'expense', description: 'Groceries', amount: 5000, accountId: card.id, date: daysFrom(-12) })).status).toBe(200);
    expect((await agent.post(`/api/cards/${card.id}/statements`).send({ statementDate: daysFrom(-10), dueOn: daysFrom(4), amountDue: '5000' })).status).toBe(200);
    expect((await agent.post('/api/loans').send({
        name: 'Bike loan', kind: 'vehicle', rateType: 'reducing', principal: '60000', interestRate: '12', months: 12, disbursedOn: daysFrom(-5), firstDue: daysFrom(7), accountId: bank.id,
    })).status).toBe(200);
    expect((await agent.post('/api/recurring').send({
        type: 'expense', description: 'Rent', amount: 20000, accountId: bank.id, frequency: 'monthly', dayOfMonth: RENT_DAY, startsOn: daysFrom(1), mode: 'confirm',
    })).status).toBe(200);
    const sneha = (await agent.post('/api/people').send({ name: 'Sneha' })).body;
    expect((await agent.post(`/api/people/${sneha.id}/loans`).send({ direction: 'borrowed', amount: '3000', accountId: bank.id, date: daysFrom(-20), dueOn: daysFrom(-2) })).status).toBe(200);
    const rahul = (await agent.post('/api/people').send({ name: 'Rahul' })).body;
    expect((await agent.post(`/api/people/${rahul.id}/loans`).send({ direction: 'lent', amount: '2000', accountId: bank.id, date: daysFrom(-3), dueOn: daysFrom(6) })).status).toBe(200);
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

test('everything due this month and next, overdue first', async () => {
    const calendar = (await agent.get('/api/calendar')).body;
    expect(calendar.from).toBe(`${TODAY.slice(0, 7)}-01`);
    const items = calendar.items;
    expect(items[0]).toMatchObject({ kind: 'person', title: 'Pay Sneha back', amount: 300_000, direction: 'pay', overdue: true, date: daysFrom(-2) });
    expect(items.find(item => item.kind === 'card_bill')).toMatchObject({ title: 'CAL CARD bill', date: daysFrom(4), amount: 500_000, overdue: false, estimated: false, href: '/cards' });
    expect(items.find(item => item.kind === 'emi')).toMatchObject({ title: 'Bike loan EMI', date: daysFrom(7), direction: 'pay', href: '/loans' });
    expect(items.find(item => item.kind === 'person' && item.direction === 'receive')).toMatchObject({ title: 'Rahul to pay you back', amount: 200_000, date: daysFrom(6) });
    const rent = items.filter(item => item.title === 'Rent');
    expect(rent.length).toBeGreaterThanOrEqual(1);
    expect(rent[0]).toMatchObject({ kind: 'repeating', amount: 2_000_000, account: 'CAL BANK', direction: 'pay' });
    // Sorted: overdue, then by date
    const dates = items.filter(item => !item.overdue).map(item => item.date);
    expect(dates).toEqual([...dates].sort());
});

test('totals: to pay and receive each month, overdue, and what goes out of each account', async () => {
    const calendar = (await agent.get('/api/calendar')).body;
    const sum = (filter) => calendar.items.filter(filter).reduce((total, item) => total + (item.amount ?? 0), 0);
    const pay = calendar.items.filter(item => item.direction === 'pay');
    expect(calendar.months[0].toPay + calendar.months[1].toPay).toBe(sum(item => item.direction === 'pay'));
    expect(calendar.months[0].toReceive + calendar.months[1].toReceive).toBe(200_000);
    expect(calendar.overdue).toBe(300_000);
    const rentTotal = pay.filter(item => item.title === 'Rent').reduce((total, item) => total + item.amount, 0);
    expect(calendar.byAccount.find(item => item.account === 'CAL BANK').amount).toBe(rentTotal);
    expect(calendar.byAccount.at(-1).account).toBeNull();
});

test('others see nothing; signed out is refused', async () => {
    expect((await otherAgent.get('/api/calendar')).body).toMatchObject({ items: [], overdue: 0, byAccount: [] });
    expect((await request(target()).get('/api/calendar')).status).toBe(401);
});
