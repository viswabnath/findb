/**
 * Credit card statements (real database, balancetrack_test schema; lib/services/cards.ts)
 *
 * A card with billing and due days: its statement worked out from the entries, payments matched
 * after the statement date, the minimum paid and the rest carried at the card's rate. A second
 * card's bank statement recorded with interest and fees; a third left unpaid past its due date.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');
const { dueDateFor, statementDates } = require('../src/core/cards');

const USER = 'cards_user';
const OTHER = 'cards_other';
const PASSWORD = 'Cards_Pass9';

const india = new Date(Date.now() + 330 * 60_000);
const TODAY = india.toISOString().slice(0, 10);
const daysAgo = n => new Date(india.getTime() - n * 86_400_000).toISOString().slice(0, 10);
// A billing day that falls before today, so payments today come after the statement
const BILLING = india.getUTCDate() > 1 ? 1 : 15;
const STATEMENT = statementDates(BILLING, TODAY).current;
const DUE = dueDateFor(STATEMENT, 20);

let agent;
let otherAgent;
let user;
let bank;

const cardNamed = async name => (await agent.get('/api/cards')).body.find(card => card.name === name);
const newCard = async name => {
    expect((await agent.post('/api/credit-cards').send({ name, creditLimit: 100000 })).status).toBe(200);
    return (await agent.get('/api/accounts')).body.find(account => account.type === 'credit_card' && account.name === name.toUpperCase());
};
const spend = (card, amount, date) => agent.post('/api/entries').send({ type: 'expense', description: 'Shopping', amount, accountId: card.id, date });
const pay = (card, amount, date) => agent.post('/api/entries').send({ type: 'transfer', description: 'Card bill', amount, accountId: bank.id, toAccountId: card.id, date });
const loanInterest = async () => Number((await query(
    `SELECT coalesce(sum(l.amount_paise), 0)::bigint AS paise FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.id = l.account_id
     WHERE e.user_id = $1 AND e.voided_at IS NULL AND a.category_key = 'loan_interest'`, [user.id])).rows[0].paise);

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'cards_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'cards_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Card Bank', initialBalance: 200000 })).status).toBe(200);
    bank = (await agent.get('/api/accounts')).body.find(account => account.type === 'bank');
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

describe('a card with billing and due days', () => {
    let card;

    test('without them there is no statement; the days and rate are checked', async () => {
        card = await newCard('Rewards Card');
        expect(await cardNamed('REWARDS CARD')).toMatchObject({ id: card.id, owed: '0.00', statement: null, interestRate: null, billingDay: null });
        expect((await agent.put(`/api/cards/${card.id}`).send({ billingDay: 5 })).body.error).toBe('Enter both the billing day and the due day, or neither');
        expect((await agent.put(`/api/cards/${card.id}`).send({ billingDay: 5, dueDay: 32 })).body.error).toBe('Billing and due days are days of the month, 1 to 31');
        const saved = await agent.put(`/api/cards/${card.id}`).send({ billingDay: BILLING, dueDay: 20, interestRate: '3.5', rateUnit: 'per100month' });
        expect(saved.status).toBe(200);
        expect(saved.body).toMatchObject({ billingDay: BILLING, dueDay: 20, interestRate: '42', perHundredMonthly: '3.5', trueRate: 51.11 });
    });

    test('the statement is what was owed on its date; spending after it is not due yet', async () => {
        expect((await spend(card, 30000, STATEMENT)).status).toBe(200);
        expect((await spend(card, 4000, TODAY)).status).toBe(200);
        const found = await cardNamed('REWARDS CARD');
        expect(found).toMatchObject({ owed: '34000.00', sinceStatement: '4000.00' });
        expect(found.statement).toMatchObject({
            id: null, date: STATEMENT, dueOn: DUE, amountDue: '30000.00', minimumDue: '1500.00', ledgerAmount: '30000.00', paid: '0.00', status: 'unpaid',
            overdue: TODAY > DUE,
        });
    });

    test('paying the minimum: the rest is carried, and costs interest at the card\'s rate', async () => {
        expect((await pay(card, 1500, TODAY)).status).toBe(200);
        const { statement } = await cardNamed('REWARDS CARD');
        expect(statement).toMatchObject({ paid: '1500.00', left: '28500.00', status: 'minimum_paid' });
        if (TODAY <= DUE) {
            // Not yet carried; this is what carrying the rest would cost: 28,500 at 3.5% a month
            expect(statement).toMatchObject({ overdue: false, carried: '0.00', interestIfCarried: '997.50' });
        } else {
            // Paid after the due date: it was overdue, and the whole bill was carried
            expect(statement).toMatchObject({ overdue: true, carried: '30000.00', interestIfCarried: '1050.00' });
        }
    });

    test('the debt review uses the card\'s own rate', async () => {
        const debt = (await agent.get('/api/debts')).body.debts.find(item => item.key === `card-${card.id}`);
        expect(debt).toMatchObject({ balance: '32500.00', yearlyRate: 51.11, assumedRate: false, href: '/cards' });
    });
});

describe('the bank\'s statement recorded', () => {
    let card;

    test('interest and fees go on the card as spending; the minimum paid leaves the rest carried', async () => {
        card = await newCard('Travel Card');
        expect((await spend(card, 19600, daysAgo(25))).status).toBe(200);
        expect((await agent.post(`/api/cards/${card.id}/statements`).send({ statementDate: daysAgo(20), amountDue: '20000' })).body.error)
            .toBe('The due date is required');
        expect((await agent.post(`/api/cards/${card.id}/statements`).send({ statementDate: daysAgo(20), dueOn: daysAgo(2), amountDue: '20000', minimumDue: '25000' })).body.error)
            .toBe('The minimum due cannot be more than the amount due');
        const before = await loanInterest();
        const recorded = await agent.post(`/api/cards/${card.id}/statements`).send({
            statementDate: daysAgo(20), dueOn: daysAgo(2), amountDue: '20000', minimumDue: '1000', interest: '300', fees: '100',
        });
        expect(recorded.status).toBe(200);
        expect(await loanInterest() - before).toBe(40_000);
        expect(recorded.body).toMatchObject({ owed: '20000.00', history: [{ date: daysAgo(20), amountDue: '20000.00', minimumDue: '1000.00', interest: '300.00', fees: '100.00' }] });
        expect(recorded.body.statement).toMatchObject({ date: daysAgo(20), amountDue: '20000.00', ledgerAmount: '20000.00', status: 'unpaid', overdue: true, carried: '20000.00' });
        expect((await agent.post(`/api/cards/${card.id}/statements`).send({ statementDate: daysAgo(20), dueOn: daysAgo(2), amountDue: '1' })).body.error)
            .toBe(`The ${daysAgo(20)} statement is already recorded`);

        expect((await pay(card, 1000, daysAgo(10))).status).toBe(200);
        const { statement } = await cardNamed('TRAVEL CARD');
        expect(statement).toMatchObject({ status: 'minimum_paid', overdue: false, carried: '19000.00', interestIfCarried: null });
    });

    test('a statement recorded by mistake is removed, with its charges', async () => {
        const found = await cardNamed('TRAVEL CARD');
        const removed = await agent.delete(`/api/cards/${card.id}/statements/${found.history[0].id}`);
        expect(removed.status).toBe(200);
        expect(removed.body).toMatchObject({ owed: '18600.00', statement: null, history: [] });
    });
});

test('a bill unpaid past its due date is the next step; others see none of it', async () => {
    const card = await newCard('Fuel Card');
    expect((await spend(card, 5000, daysAgo(16))).status).toBe(200);
    expect((await agent.post(`/api/cards/${card.id}/statements`).send({ statementDate: daysAgo(15), dueOn: daysAgo(1), amountDue: '5000', minimumDue: '500' })).status).toBe(200);
    expect((await agent.get('/api/next-step')).body).toMatchObject({ kind: 'card', href: '/cards', text: expect.stringContaining('FUEL CARD: the bill of ₹5,000.00') });

    expect((await otherAgent.get('/api/cards')).body).toEqual([]);
    expect((await otherAgent.put(`/api/cards/${card.id}`).send({ billingDay: 1, dueDay: 20 })).status).toBe(404);
    expect((await otherAgent.post(`/api/cards/${card.id}/statements`).send({ statementDate: daysAgo(1), dueOn: TODAY, amountDue: '1' })).status).toBe(404);
    const unbalanced = await query(
        'SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE e.user_id = $1 GROUP BY e.id HAVING sum(l.amount_paise) <> 0', [user.id]);
    expect(unbalanced.rows).toEqual([]);
});
