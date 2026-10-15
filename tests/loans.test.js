/**
 * Loans from banks and lenders (real database, balancetrack_test schema; lib/services/loans.ts)
 *
 * A home loan already running, added from what is owed today; a new car loan with a fee; EMIs
 * split into principal and interest; a part payment, a floating-rate change, per-year figures,
 * a missed EMI on the next step, a flat-rate loan's true cost, and closing early.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'loans_user';
const OTHER = 'loans_other';
const PASSWORD = 'Loans_Pass9';

const india = new Date(Date.now() + 330 * 60_000);
const TODAY = india.toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), india.getUTCDate() - n)).toISOString().slice(0, 10);
const fy = date => (Number(date.slice(5, 7)) >= 4 ? `${date.slice(0, 4)}-${String((Number(date.slice(0, 4)) + 1) % 100).padStart(2, '0')}`
    : `${Number(date.slice(0, 4)) - 1}-${date.slice(2, 4)}`);

let agent;
let otherAgent;
let user;
let bank;
let home;
let car;

const balanceOf = async id => (await agent.get('/api/accounts')).body.find(account => account.id === id).balance;
const loanSpending = async () => Number((await query(
    `SELECT coalesce(sum(l.amount_paise), 0)::bigint AS paise FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.id = l.account_id
     WHERE e.user_id = $1 AND e.voided_at IS NULL AND a.category_key = 'loan_interest'`, [user.id])).rows[0].paise);

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'loans_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'loans_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Loans Bank', initialBalance: 500000 })).status).toBe(200);
    bank = (await agent.get('/api/accounts')).body.find(account => account.type === 'bank');
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

describe('a home loan already running', () => {
    test('is added from what is owed today; earlier EMIs are not "missed"', async () => {
        const response = await agent.post('/api/loans').send({
            name: 'Home loan', lender: 'SBI', kind: 'home', rateType: 'reducing', rateKind: 'floating', principal: '1000000', interestRate: '9',
            months: 240, disbursedOn: daysAgo(730), outstanding: '940000', foreclosureCharge: '0',
        });
        expect(response.status).toBe(200);
        home = response.body;
        expect(home).toMatchObject({ outstanding: '940000.00', yearlyRate: '9', perHundredMonthly: '0.75', emi: '8998.00', missed: 0, closed: false });
        expect(home.effectiveRate).toBeCloseTo(9.38, 1);
        expect(await balanceOf(bank.id)).toBe('500000.00');
    });

    test('an EMI splits into interest (spending) and principal (less owed)', async () => {
        const before = await loanSpending();
        home = (await agent.post(`/api/loans/${home.id}/emi`).send({ amount: '8998', accountId: bank.id, date: TODAY })).body;
        // A month's interest on 9,40,000 at 9% is 7,050
        expect(await loanSpending() - before).toBe(705_000);
        expect(home.outstanding).toBe('938052.00');
        expect(home.payments.at(-1)).toMatchObject({ kind: 'emi', interest: '7050.00', principal: '1948.00' });
        expect(await balanceOf(bank.id)).toBe('491002.00');
    });

    test('a part payment keeping the EMI ends the loan sooner and saves interest', async () => {
        const monthsBefore = home.monthsLeft;
        const response = (await agent.post(`/api/loans/${home.id}/prepay`).send({ amount: '100000', accountId: bank.id, date: TODAY, keep: 'emi' })).body;
        expect(Number(response.interestSaved)).toBeGreaterThan(100000);
        home = response;
        expect(home.outstanding).toBe('838052.00');
        expect(home.monthsLeft).toBeLessThan(monthsBefore);
    });

    test('a floating rate change: shown in both forms', async () => {
        home = (await agent.post(`/api/loans/${home.id}/rate`).send({ from: TODAY, interestRate: '9.5', keep: 'tenure' })).body;
        expect(home).toMatchObject({ yearlyRate: '9.5', perHundredMonthly: '0.792' });
    });

    test('this financial year\'s principal and interest, for the interest certificate', async () => {
        expect(home.byYear).toEqual([{ year: fy(TODAY), principal: '101948.00', interest: '7050.00', fees: '0.00' }]);
    });
});

describe('a new car loan', () => {
    test('the money comes in, the fee is spending, and its true cost is above the rate', async () => {
        const before = await loanSpending();
        car = (await agent.post('/api/loans').send({
            name: 'Car loan', kind: 'vehicle', rateType: 'reducing', rateKind: 'fixed', principal: '500000', interestRate: '10', months: 60,
            disbursedOn: daysAgo(40), firstDue: daysAgo(10), processingFee: '5000', accountId: bank.id, foreclosureCharge: '4',
        })).body;
        expect(car).toMatchObject({ outstanding: '500000.00', missed: 1 });
        expect(car.effectiveRate).toBeGreaterThan(10.4);
        expect(await loanSpending() - before).toBe(500_000);
        expect((await agent.get('/api/next-step')).body).toMatchObject({ kind: 'emi', text: expect.stringContaining('Car loan: 1 EMI of') });
    });

    test('closing early pays what is owed, interest since the last EMI and the charge', async () => {
        const quote = car.foreclosure;
        expect(Number(quote.charge)).toBe(20000);
        car = (await agent.post(`/api/loans/${car.id}/close`).send({ accountId: bank.id, date: TODAY })).body;
        expect(car).toMatchObject({ closed: true, outstanding: '0.00', nextDue: null, missed: 0 });
        expect((await agent.post(`/api/loans/${car.id}/emi`).send({ amount: '1', accountId: bank.id, date: TODAY })).body.error).toBe('This loan is closed');
        // Undoing the closure reopens it
        const closure = car.payments.find(payment => payment.kind === 'closure');
        car = (await agent.delete(`/api/loans/${car.id}/payments/${closure.id}`)).body;
        expect(car).toMatchObject({ closed: false, outstanding: '500000.00' });
    });
});

describe('the rest', () => {
    test('a flat rate costs far more than it says', async () => {
        const flat = (await agent.post('/api/loans').send({
            name: 'Phone EMI', kind: 'consumer', rateType: 'flat', rateKind: 'fixed', principal: '60000', interestRate: '1', rateUnit: 'per100month', months: 12,
            disbursedOn: daysAgo(5), accountId: bank.id,
        })).body;
        expect(flat.yearlyRate).toBe('12');
        expect(flat.effectiveRate).toBeGreaterThan(22);
    });

    test('mistakes are refused, and others see nothing', async () => {
        const bad = body => agent.post('/api/loans').send({ name: 'x', kind: 'home', principal: '100', interestRate: '9', months: 12, disbursedOn: daysAgo(5), accountId: bank.id, ...body });
        expect((await bad({ months: 0 })).body.error).toBe('Enter the tenure in months, from 1 to 480');
        expect((await bad({ interestRate: '200' })).body.error).toMatch(/^Enter the interest as a rate/);
        expect((await bad({ kind: 'yacht' })).body.error).toBe('Choose what the loan is for');
        expect((await bad({ outstanding: '1000' })).body.error).toBe('What is owed now cannot be more than the loan amount');
        expect((await agent.post(`/api/loans/${home.id}/emi`).send({ amount: '99999999', accountId: bank.id, date: TODAY })).body.error).toMatch(/^That is more than is owed/);
        expect((await otherAgent.get('/api/loans')).body).toEqual([]);
        expect((await otherAgent.post(`/api/loans/${home.id}/emi`).send({ amount: '1', accountId: bank.id, date: TODAY })).status).toBe(404);
    });

    test('the ledger balances, and a removed loan leaves nothing owed', async () => {
        expect((await agent.delete(`/api/loans/${car.id}`)).status).toBe(200);
        expect((await agent.get('/api/loans')).body.map(loan => loan.name)).not.toContain('Car loan');
        const unbalanced = await query(
            `SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE e.user_id = $1 GROUP BY e.id HAVING sum(l.amount_paise) <> 0`, [user.id]);
        expect(unbalanced.rows).toEqual([]);
    });
});
