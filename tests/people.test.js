/**
 * Money with people (real database, balancetrack_test schema; lib/services/people.ts)
 *
 * Lending and borrowing move money, never income or spending; interest paid back is income;
 * repayments in parts; settling the rest as a gift; overdue on the next step; isolation.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'people_user';
const OTHER = 'people_other';
const PASSWORD = 'People_Pass9';

const india = new Date(Date.now() + 330 * 60_000);
const daysAgo = n => new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), india.getUTCDate() - n)).toISOString().slice(0, 10);

let agent;
let otherAgent;
let user;
let bank;
let rahul;
let sneha;
let loan;

const people = async () => (await agent.get('/api/people')).body;
const person = async name => (await people()).people.find(item => item.name === name);
const balance = async id => (await agent.get('/api/accounts')).body.find(account => account.id === id).balance;

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'people_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'people_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'People Bank', initialBalance: 100000 })).status).toBe(200);
    bank = (await agent.get('/api/accounts')).body.find(account => account.type === 'bank');
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

describe('people', () => {
    test('are added once by name, and only the user sees them', async () => {
        rahul = (await agent.post('/api/people').send({ name: 'Rahul' })).body;
        sneha = (await agent.post('/api/people').send({ name: 'Sneha', notes: 'Flatmate' })).body;
        expect(rahul).toMatchObject({ id: expect.any(Number), name: 'Rahul' });
        expect((await agent.post('/api/people').send({ name: 'rahul' })).body.error).toBe('rahul is already in your people');
        expect((await agent.post('/api/people').send({ name: ' ' })).body.error).toBe('Enter the person\'s name');
        expect(await people()).toMatchObject({ owedToYou: '0.00', youOwe: '0.00' });
        expect((await otherAgent.get('/api/people')).body.people).toEqual([]);
        expect((await otherAgent.post(`/api/people/${rahul.id}/loans`).send({ direction: 'lent', amount: 1, accountId: bank.id, date: daysAgo(1) })).status).toBe(404);
    });
});

describe('lending with interest', () => {
    test('lending moves money to the person: neither income nor spending', async () => {
        const response = await agent.post(`/api/people/${rahul.id}/loans`).send({
            direction: 'lent', amount: '10000', accountId: bank.id, date: daysAgo(146), dueOn: daysAgo(1), interestRate: '2', rateUnit: 'per100month',
        });
        expect(response.status).toBe(200);
        loan = response.body;
        expect(loan).toMatchObject({ direction: 'lent', principal: '10000.00', interestRate: '24', perHundredMonthly: '2', outstanding: '10000.00', status: 'overdue' });
        expect(await balance(bank.id)).toBe('90000.00');
        expect(await person('Rahul')).toMatchObject({ balance: '10000.00' });
        expect(await people()).toMatchObject({ owedToYou: '10000.00', youOwe: '0.00' });
        const flows = await query(
            `SELECT count(*)::int AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.id = l.account_id
             WHERE e.user_id = $1 AND e.person_loan_id = $2 AND a.kind IN ('income', 'expense')`, [user.id, loan.id]);
        expect(flows.rows[0].n).toBe(0);
    });

    test('simple interest builds up; a repayment takes the interest due first, as income', async () => {
        // 73 days at 24% on 10,000 is 480 of interest
        const response = await agent.post(`/api/person-loans/${loan.id}/repayments`).send({ amount: '5480', accountId: bank.id, date: daysAgo(73) });
        expect(response.status).toBe(200);
        loan = response.body;
        expect(loan).toMatchObject({ outstanding: '5000.00', principalRepaid: '5000.00', interestPaid: '480.00', interestDue: '240.00' });
        expect(loan.history.map(event => [event.type, event.amount, event.interest])).toEqual([
            ['person_loan', '10000.00', '0.00'], ['person_repayment', '5480.00', '480.00'],
        ]);
        expect(await balance(bank.id)).toBe('95480.00');
        const interest = await query(
            `SELECT a.name, l.amount_paise::int AS paise FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.id = l.account_id
             WHERE e.user_id = $1 AND e.person_loan_id = $2 AND a.kind = 'income'`, [user.id, loan.id]);
        expect(interest.rows).toEqual([{ name: 'Interest', paise: -48000 }]);
    });

    test('overdue money is the next step', async () => {
        expect((await agent.get('/api/next-step')).body).toMatchObject({ kind: 'overdue', text: `Rahul was to pay back ₹5,000.00 by ${daysAgo(1)}.` });
    });

    test('refuses more than is owed, bad rates and dates', async () => {
        expect((await agent.post(`/api/person-loans/${loan.id}/repayments`).send({ amount: '6000', accountId: bank.id, date: daysAgo(0) })).body.error).toBe('That is more than is owed: at most ₹5240.00');
        expect((await agent.post(`/api/person-loans/${loan.id}/repayments`).send({ amount: '100', interest: '200', accountId: bank.id, date: daysAgo(0) })).body.error)
            .toBe('The interest part must be between zero and the amount');
        const bad = body => agent.post(`/api/people/${rahul.id}/loans`).send({ direction: 'lent', amount: '10', accountId: bank.id, date: daysAgo(5), ...body });
        expect((await bad({ interestRate: '9', rateUnit: 'per100month' })).body.error).toMatch(/^Enter the interest as a rate/);
        expect((await bad({ dueOn: daysAgo(10) })).body.error).toBe('The due date cannot be before the money was given');
        expect((await bad({ direction: 'gave' })).body.error).toBe('Choose whether you lent or borrowed');
        expect((await bad({ date: daysAgo(-5) })).body.error).toBe('The date cannot be in the future');
    });

    test('a repayment recorded by mistake can be removed', async () => {
        const repayment = loan.history.find(event => event.type === 'person_repayment');
        loan = (await agent.delete(`/api/person-loans/${loan.id}/repayments/${repayment.entryId}`)).body;
        expect(loan).toMatchObject({ outstanding: '10000.00', interestPaid: '0.00' });
        expect(await balance(bank.id)).toBe('90000.00');
    });
});

describe('borrowing', () => {
    test('borrowed money comes in, is paid back in parts, and the rest is settled as a gift received', async () => {
        const borrowed = (await agent.post(`/api/people/${sneha.id}/loans`).send({ direction: 'borrowed', amount: '2000', accountId: bank.id, date: daysAgo(20) })).body;
        expect(borrowed).toMatchObject({ direction: 'borrowed', interestRate: null, status: 'open' });
        expect(await person('Sneha')).toMatchObject({ balance: '-2000.00' });
        expect((await people()).youOwe).toBe('2000.00');

        const repaid = (await agent.post(`/api/person-loans/${borrowed.id}/repayments`).send({ amount: '500', accountId: bank.id, date: daysAgo(10) })).body;
        expect(repaid).toMatchObject({ outstanding: '1500.00', status: 'open' });

        const settled = (await agent.post(`/api/person-loans/${borrowed.id}/settle`).send({})).body;
        expect(settled).toMatchObject({ status: 'settled', closed: true, outstanding: '0.00' });
        expect(await person('Sneha')).toMatchObject({ balance: '0.00' });
        const gift = await query(
            `SELECT a.name, l.amount_paise::int AS paise FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.id = l.account_id
             WHERE e.user_id = $1 AND e.person_loan_id = $2 AND e.entry_type = 'person_settlement' AND a.kind = 'income'`, [user.id, borrowed.id]);
        expect(gift.rows).toEqual([{ name: 'Gifts received', paise: -150000 }]);
        expect((await agent.post(`/api/person-loans/${borrowed.id}/repayments`).send({ amount: '1', accountId: bank.id, date: daysAgo(0) })).body.error).toBe('This loan is settled');
    });
});

describe('removing', () => {
    test('a person still owing cannot be removed; a deleted loan gives the money back', async () => {
        expect((await agent.delete(`/api/people/${rahul.id}`)).body.error).toBe('Money is still owed between you and Rahul. Settle it first.');
        expect((await agent.delete(`/api/person-loans/${loan.id}`)).status).toBe(200);
        // Only Sneha's loan is left in the bank: 2,000 borrowed, 500 paid back, the rest settled as a gift
        expect(await balance(bank.id)).toBe('101500.00');
        expect((await agent.delete(`/api/people/${rahul.id}`)).status).toBe(200);
        expect((await people()).people.map(item => item.name)).toEqual(['Sneha']);
    });

    test('the ledger balances, and the activity log has every change', async () => {
        const unbalanced = await query(
            `SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE e.user_id = $1 GROUP BY e.id HAVING sum(l.amount_paise) <> 0`, [user.id]);
        expect(unbalanced.rows).toEqual([]);
        const log = await query('SELECT entity_type, count(*)::int AS n FROM activity_log WHERE user_id = $1 AND entity_type IN ($2, $3) GROUP BY 1 ORDER BY 1', [user.id, 'person', 'person_loan']);
        expect(log.rows).toEqual([{ entity_type: 'person', n: 3 }, { entity_type: 'person_loan', n: 7 }]);
    });
});
