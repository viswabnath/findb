/**
 * Account ownership tests (real database, balancetrack_test schema)
 *
 * Income and expenses can only be booked to the user's own bank, card or cash. Entries used to
 * accept any account id the client sent, pointing at another user's account.
 * @jest-environment node
 */

const request = require('supertest');


const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, ledgerBalances, logIn, query } = require('../test-helpers');

const OWNER = 'ownership_owner';
const OTHER = 'ownership_other';
const PASSWORD = 'TestPass123&';
const DATE = '2026-03-10';

let owner;
let other;
let ownerBank;
let ownerCard;
let otherBank;

async function loggedIn(username, email, trackingOption) {
    await createTestUser({ username, password: PASSWORD, email, trackingOption });
    const agent = request.agent(target());
    expect((await logIn(agent, username, PASSWORD)).status).toBe(200);
    return agent;
}

beforeAll(async () => {
    await deleteTestUser(OWNER);
    await deleteTestUser(OTHER);
    owner = await loggedIn(OWNER, 'ownership_owner@example.com', 'both');
    // Expenses-only, so no balance check runs: only the ownership check can refuse
    other = await loggedIn(OTHER, 'ownership_other@example.com', 'expenses');
    ownerBank = (await owner.post('/api/banks').send({ name: 'Owner Bank', initialBalance: 1000 })).body;
    ownerCard = (await owner.post('/api/credit-cards').send({ name: 'Owner Card', creditLimit: 5000 })).body;
    otherBank = (await other.post('/api/banks').send({ name: 'Other Bank', initialBalance: 1000 })).body;
});

afterAll(async () => {
    await deleteTestUser(OWNER);
    await deleteTestUser(OTHER);
    await closeTarget();
});

const ownerBalances = async () => {
    const ledger = await ledgerBalances(ownerBank.user_id);
    return { bank: ledger.banks[ownerBank.id], card: ledger.cards[ownerCard.id] };
};

test('income cannot be credited to another user\'s bank', async () => {
    const response = await other.post('/api/income')
        .send({ source: 'Probe', amount: 10, creditedToType: 'bank', creditedToId: ownerBank.id, date: DATE });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Bank not found');
});

test('expenses cannot be paid from another user\'s bank or card', async () => {
    const before = await ownerBalances();
    const bank = await other.post('/api/expenses')
        .send({ title: 'Probe', amount: 10, paymentMethod: 'bank', paymentSourceId: ownerBank.id, date: DATE });
    expect(bank.status).toBe(400);
    expect(bank.body.error).toBe('Bank not found');
    const card = await other.post('/api/expenses')
        .send({ title: 'Probe', amount: 10, paymentMethod: 'credit_card', paymentSourceId: ownerCard.id, date: DATE });
    expect(card.status).toBe(400);
    expect(card.body.error).toBe('Credit card not found');
    expect(await ownerBalances()).toEqual(before);
});

test('an edit cannot move an entry onto another user\'s account, and leaves it unchanged', async () => {
    const income = (await other.post('/api/income')
        .send({ source: 'Mine', amount: 10, creditedToType: 'bank', creditedToId: otherBank.id, date: DATE })).body;
    const moved = await other.put(`/api/income/${income.id}`)
        .send({ source: 'Mine', amount: 10, creditedToType: 'bank', creditedToId: ownerBank.id, date: DATE });
    expect(moved.status).toBe(400);
    expect(moved.body.error).toBe('Bank not found');
    const stored = await query('SELECT credited_to_id, amount FROM income_entries WHERE id = $1', [income.id]);
    expect(stored.rows[0].credited_to_id).toBe(otherBank.id);

    const expense = (await other.post('/api/expenses')
        .send({ title: 'Mine', amount: 5, paymentMethod: 'cash', paymentSourceId: null, date: DATE })).body;
    const movedExpense = await other.put(`/api/expenses/${expense.id}`)
        .send({ title: 'Mine', amount: 5, paymentMethod: 'credit_card', paymentSourceId: ownerCard.id, date: DATE });
    expect(movedExpense.status).toBe(400);
    expect(movedExpense.body.error).toBe('Credit card not found');
});

test('unknown account types and ids are refused', async () => {
    const type = await other.post('/api/income')
        .send({ source: 'Probe', amount: 1, creditedToType: 'credit_card', creditedToId: otherBank.id, date: DATE });
    expect(type.status).toBe(400);
    expect(type.body.error).toBe('Invalid account type');
    const missingType = await other.post('/api/expenses').send({ title: 'Probe', amount: 1, date: DATE });
    expect(missingType.status).toBe(400);
    expect(missingType.body.error).toBe('Invalid account type');
    const badId = await other.post('/api/expenses')
        .send({ title: 'Probe', amount: 1, paymentMethod: 'bank', paymentSourceId: 'abc', date: DATE });
    expect(badId.status).toBe(400);
    expect(badId.body.error).toBe('Bank not found');
    const missingBank = await other.post('/api/income')
        .send({ source: 'Probe', amount: 1, creditedToType: 'bank', creditedToId: 999999999, date: DATE });
    expect(missingBank.body.error).toBe('Bank not found');
});

test('own accounts and cash still work', async () => {
    const income = await owner.post('/api/income')
        .send({ source: 'Pay', amount: 50, creditedToType: 'bank', creditedToId: ownerBank.id, date: DATE });
    expect(income.status).toBe(200);
    const cardExpense = await owner.post('/api/expenses')
        .send({ title: 'Fuel', amount: 20, paymentMethod: 'credit_card', paymentSourceId: ownerCard.id, date: DATE });
    expect(cardExpense.status).toBe(200);
    const cashIncome = await other.post('/api/income')
        .send({ source: 'Cash gift', amount: 5, creditedToType: 'cash', creditedToId: null, date: DATE });
    expect(cashIncome.status).toBe(200);
});
