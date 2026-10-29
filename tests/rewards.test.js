/**
 * Card rewards (real database, balancetrack_test schema; lib/services/rewards.ts)
 *
 * Points earned with and without an expiry, some redeemed for money into a bank, cashback on the
 * card, cashback entered on Transactions: the points left and expiring, cashback for the year, the
 * card's reward rate, and the next step before points lapse.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'rewards_user';
const OTHER = 'rewards_other';
const PASSWORD = 'Rewards_Pass9';

const india = new Date(Date.now() + 330 * 60_000);
const TODAY = india.toISOString().slice(0, 10);
const daysFrom = n => new Date(india.getTime() + n * 86_400_000).toISOString().slice(0, 10);

let agent;
let otherAgent;
let user;
let bank;
let card;

const rewardsOf = async () => (await agent.get('/api/cards/rewards')).body.find(item => item.id === card.id);
const record = body => agent.post(`/api/cards/${card.id}/rewards`).send(body);
const balanceOf = async id => (await agent.get('/api/accounts')).body.find(account => account.id === id).balance;

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'rewards_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'rewards_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Reward Bank', initialBalance: 100000 })).status).toBe(200);
    expect((await agent.post('/api/credit-cards').send({ name: 'Gold Card', creditLimit: 100000 })).status).toBe(200);
    const accounts = (await agent.get('/api/accounts')).body;
    bank = accounts.find(account => account.type === 'bank');
    card = accounts.find(account => account.type === 'credit_card');
    expect((await agent.post('/api/entries').send({ type: 'expense', description: 'Flights', amount: 20000, accountId: card.id, date: daysFrom(-10) })).status).toBe(200);
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

test('a card starts with no points; records are checked', async () => {
    expect(await rewardsOf()).toMatchObject({ name: 'GOLD CARD', pointValue: null, points: { balance: 0, value: null, expiring: [], lapsed: 0 }, history: [] });
    expect((await record({ kind: 'bonus', date: TODAY, points: 10 })).body.error).toBe('Choose points earned, redeemed or expired, or cashback');
    expect((await record({ kind: 'earned', date: TODAY, points: 0 })).body.error).toBe('Enter the number of points, more than zero');
    expect((await record({ kind: 'cashback', date: TODAY })).body.error).toBe('Enter an amount greater than zero');
    expect((await record({ kind: 'earned', date: TODAY, points: 10, expiresOn: daysFrom(-1) })).body.error).toBe('Points cannot expire before they were earned');
    expect((await agent.put(`/api/cards/${card.id}/rewards`).send({ pointValue: '500' })).body.error).toBe('The value of a point is in rupees, from 0 to 100');
});

test('points earned and redeemed, used earliest-expiring first, with their value', async () => {
    expect((await agent.put(`/api/cards/${card.id}/rewards`).send({ pointValue: '0.25' })).body.pointValue).toBe('0.25');
    expect((await record({ kind: 'earned', date: daysFrom(-5), points: 2000, expiresOn: daysFrom(20) })).status).toBe(200);
    expect((await record({ kind: 'earned', date: daysFrom(-4), points: 1000 })).status).toBe(200);
    // 500 points redeemed for Rs 125 into the bank: income in Cashback and rewards
    const redeemed = await record({ kind: 'redeemed', date: daysFrom(-1), points: 500, amount: '125', intoAccountId: bank.id });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.points).toEqual({ balance: 2500, value: '625.00', expiring: [{ expiresOn: daysFrom(20), points: 1500, daysLeft: 20 }], lapsed: 0 });
    expect(await balanceOf(bank.id)).toBe('100125.00');
    expect(redeemed.body.history[0]).toMatchObject({ kind: 'redeemed', points: 500, amount: '125.00', into: 'REWARD BANK' });
});

test('cashback on the card, recorded here or on Transactions, counts for the year and the reward rate', async () => {
    expect((await record({ kind: 'cashback', date: TODAY, amount: '100' })).status).toBe(200);
    const cashback = (await agent.get('/api/categories')).body.find(category => category.key === 'cashback');
    expect((await agent.post('/api/entries').send({ type: 'income', description: 'Cashback', amount: 50, accountId: card.id, categoryId: cashback.id, date: TODAY })).status).toBe(200);
    expect(await balanceOf(card.id)).toBe('-19850.00');
    const rewards = await rewardsOf();
    expect(rewards.cashback.thisYear).toBe('150.00');
    // 150 cashback and 3,000 points at Rs 0.25 (750) back on 20,000 spent
    expect(rewards.compare).toEqual({ spent: '20000.00', rewards: '900.00', rate: 4.5, pointsUnvalued: false });
});

test('points expiring within 30 days are the next step', async () => {
    expect((await agent.get('/api/next-step')).body).toMatchObject({ kind: 'points', href: '/cards', text: expect.stringContaining('GOLD CARD: 1500 reward points expire in 20 days') });
});

test('a reward recorded by mistake is removed, with its income; others see nothing', async () => {
    const redeemed = (await rewardsOf()).history.find(item => item.kind === 'redeemed');
    const after = await agent.delete(`/api/cards/${card.id}/rewards/${redeemed.id}`);
    expect(after.status).toBe(200);
    expect(after.body.points.balance).toBe(3000);
    expect(await balanceOf(bank.id)).toBe('100000.00');
    expect((await otherAgent.get('/api/cards/rewards')).body).toEqual([]);
    expect((await otherAgent.post(`/api/cards/${card.id}/rewards`).send({ kind: 'earned', date: TODAY, points: 1 })).status).toBe(404);
    const unbalanced = await query(
        'SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE e.user_id = $1 GROUP BY e.id HAVING sum(l.amount_paise) <> 0', [user.id]);
    expect(unbalanced.rows).toEqual([]);
});
