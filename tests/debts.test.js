/**
 * Debt review (real database, balancetrack_test schema; lib/services/debts.ts)
 *
 * A home loan, a new personal loan, a card balance, money borrowed from a friend and a chit run by a
 * neighbour: the debts ranked by their true yearly cost, the EMI-to-income ratio over the last three
 * months' income, and the warnings.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn } = require('../test-helpers');

const USER = 'debts_user';
const OTHER = 'debts_other';
const PASSWORD = 'Debts_Pass9';

const india = new Date(Date.now() + 330 * 60_000);
const daysAgo = n => new Date(india.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const midMonthAgo = n => new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth() - n, 15)).toISOString().slice(0, 10);

let agent;
let otherAgent;
let bank;

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await createTestUser({ username: USER, password: PASSWORD, email: 'debts_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'debts_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Debt Bank', initialBalance: 500000 })).status).toBe(200);
    bank = (await agent.get('/api/accounts')).body.find(account => account.type === 'bank');
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

test('no debts: nothing ranked, no ratio without income', async () => {
    const review = (await agent.get('/api/debts')).body;
    expect(review).toMatchObject({ debts: [], total: '0.00', emiRatio: null, monthlyIncome: null, warnings: [] });
    expect(review.limits).toMatchObject({ emiHigh: 40, emiDanger: 50, dangerousRate: 24, typicalCardRate: 51.11 });
});

test('debts ranked by true yearly cost, with the EMI-to-income ratio and the warnings', async () => {
    for (const months of [1, 2, 3]) {
        expect((await agent.post('/api/entries').send({ type: 'income', description: 'Salary', amount: '50000', accountId: bank.id, date: midMonthAgo(months) })).status).toBe(200);
    }
    // Income this month is not counted: the average is of full months
    expect((await agent.post('/api/entries').send({ type: 'income', description: 'Bonus', amount: '90000', accountId: bank.id, date: daysAgo(0) })).status).toBe(200);
    expect((await agent.post('/api/loans').send({
        name: 'Home loan', kind: 'home', rateType: 'reducing', principal: '1000000', interestRate: '9', months: 240, disbursedOn: daysAgo(730), outstanding: '940000',
    })).status).toBe(200);
    expect((await agent.post('/api/loans').send({
        name: 'Personal loan', kind: 'personal', rateType: 'reducing', principal: '400000', interestRate: '14', months: 36, disbursedOn: daysAgo(10), accountId: bank.id,
    })).status).toBe(200);
    const card = (await agent.post('/api/credit-cards').send({ name: 'Rewards Card', creditLimit: 100000 })).body;
    expect((await agent.post('/api/expenses').send({ title: 'Phone', amount: 50000, paymentMethod: 'credit_card', paymentSourceId: card.id, date: daysAgo(3) })).status).toBe(200);
    const sneha = (await agent.post('/api/people').send({ name: 'Sneha' })).body;
    expect((await agent.post(`/api/people/${sneha.id}/loans`).send({ direction: 'borrowed', amount: '20000', accountId: bank.id, date: daysAgo(30) })).status).toBe(200);
    const rahul = (await agent.post('/api/people').send({ name: 'Rahul' })).body;
    expect((await agent.post(`/api/people/${rahul.id}/loans`).send({ direction: 'lent', amount: '5000', accountId: bank.id, date: daysAgo(40), dueOn: daysAgo(1) })).status).toBe(200);
    expect((await agent.post('/api/chits').send({ name: 'Street chit', organiserKind: 'informal', value: '50000', members: 10, startedOn: daysAgo(5) })).status).toBe(200);

    const review = (await agent.get('/api/debts')).body;
    expect(review.debts.map(debt => [debt.name, debt.kind])).toEqual([
        ['REWARDS CARD', 'credit_card'], ['Personal loan', 'personal'], ['Home loan', 'home'], ['Sneha', 'person'],
    ]);
    expect(review.debts[0]).toMatchObject({ balance: '50000.00', yearlyRate: 51.11, assumedRate: true, dangerous: true, monthly: '2500.00', href: '/cards' });
    expect(review.debts[1].yearlyRate).toBeCloseTo(14.93, 1);
    expect(review.debts[3]).toMatchObject({ balance: '20000.00', yearlyRate: 0, monthly: '0.00', href: '/people' });
    expect(review).toMatchObject({ total: '1410000.00', dangerousTotal: '50000.00', monthlyIncome: '50000.00' });
    // 8,998 + 13,672 (rounded up to the rupee) of 50,000
    expect(review.monthlyPayments).toBe('22670.00');
    expect(review.emiRatio).toBe(45.3);
    expect(review.warnings.map(warning => warning.kind).sort()).toEqual(['emi_ratio', 'informal_chit', 'minimum_only', 'overdue']);
    expect(review.warnings.find(warning => warning.kind === 'emi_ratio')).toMatchObject({ level: 'warn', text: expect.stringContaining('45.3%') });
    expect(review.warnings.find(warning => warning.kind === 'minimum_only').text).toContain('REWARDS CARD: paying only the minimum (₹2,500.00 now)');
    expect(review.warnings.find(warning => warning.kind === 'overdue').text).toContain('Rahul owes you ₹5,000.00');
});

test('others see none of it; signed out is refused', async () => {
    expect((await otherAgent.get('/api/debts')).body).toMatchObject({ debts: [], warnings: [] });
    expect((await request(target()).get('/api/debts')).status).toBe(401);
});
