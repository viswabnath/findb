/**
 * Reimbursements (real database, balancetrack_test schema; docs/ledger.md)
 *
 * Money paid now and owed back is not spending while it is pending; repayments bring it back into
 * an account; closing one turns what was not repaid into the user's own spending, in its category.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'reimburse_user';
const OTHER = 'reimburse_other';
const PASSWORD = 'Ledger_Pass9';

const today = new Date();
const MONTH = today.getMonth() + 1;
const YEAR = today.getFullYear();
const DAY = `${YEAR}-${String(MONTH).padStart(2, '0')}-01`;

let agent;
let user;
let bank;
let card;
let categories;
const category = name => categories.find(item => item.name === name).id;
const summary = async () => (await agent.get(`/api/monthly-summary?month=${MONTH}&year=${YEAR}`)).body;
const balanceOf = async id => (await agent.get('/api/accounts')).body.find(account => account.id === id);

beforeAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(OTHER);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'reimburse_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'reimburse_other@example.com' });
    await query('UPDATE users SET created_at = created_at - interval \'40 days\' WHERE id = $1', [user.id]);
    agent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    await agent.post('/api/banks').send({ name: 'Reimburse Bank', initialBalance: 50000 });
    await agent.post('/api/credit-cards').send({ name: 'Reimburse Card', creditLimit: 20000 });
    const accounts = (await agent.get('/api/accounts')).body;
    bank = accounts.find(account => account.type === 'bank');
    card = accounts.find(account => account.type === 'credit_card');
    categories = (await agent.get('/api/categories')).body;
});

afterAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(OTHER);
    await closeTarget();
});

describe('reimbursements', () => {
    let hotel;

    test('a payment owed back leaves the account but is not spending', async () => {
        const before = await summary();
        const created = await agent.post('/api/reimbursements').send({
            description: 'Hotel, Pune work trip', amount: 8000, accountId: card.id, date: DAY, fromWhom: 'Employer', categoryId: category('Travel'),
        });
        expect(created.status).toBe(200);
        hotel = created.body;
        expect(hotel).toMatchObject({ status: 'pending', amount: '8000.00', outstanding: '8000.00', received: '0.00', fromWhom: 'Employer',
            paidFrom: { id: card.id }, paidOn: DAY, category: { name: 'Travel' } });
        expect((await balanceOf(card.id)).used).toBe('8000.00');

        const after = await summary();
        expect(after.totalExpenses).toBeCloseTo(before.totalExpenses, 2);
        expect(after.owedToYou).toBeCloseTo(8000, 2);
        // It is not an expense in the Transactions lists either
        const entries = (await agent.get(`/api/entries?month=${MONTH}&year=${YEAR}`)).body;
        expect(entries.map(entry => entry.description)).not.toContain('Hotel, Pune work trip');
    });

    test('a partial repayment, then closing it: the rest becomes spending in its category', async () => {
        const part = await agent.post(`/api/reimbursements/${hotel.id}/repay`).send({ amount: 6000, accountId: bank.id, date: DAY });
        expect(part.body).toMatchObject({ status: 'partly repaid', received: '6000.00', outstanding: '2000.00' });
        expect((await balanceOf(bank.id)).balance).toBe('56000.00');

        expect((await agent.post(`/api/reimbursements/${hotel.id}/repay`).send({ amount: 2500, accountId: bank.id, date: DAY })).body.error)
            .toBe('Only ₹2000.00 is still owed');
        const before = await summary();
        const closed = await agent.post(`/api/reimbursements/${hotel.id}/repay`).send({ amount: 500, accountId: bank.id, date: DAY, close: true });
        expect(closed.body).toMatchObject({ status: 'closed', received: '6500.00', outstanding: '0.00', keptAsSpending: '1500.00' });
        const after = await summary();
        expect(after.totalExpenses).toBeCloseTo(before.totalExpenses + 1500, 2);
        expect(after.owedToYou).toBeCloseTo(0, 2);
        expect(after.spendingByCategory.find(item => item.name === 'Travel').amount).toBe('1500.00');
        expect((await agent.post(`/api/reimbursements/${hotel.id}/repay`).send({ amount: 1, accountId: bank.id, date: DAY })).body.error)
            .toBe('This reimbursement is already closed');
    });

    test('the part kept as spending is listed, from Reimbursements due, and changed only from the reimbursement', async () => {
        const entries = (await agent.get(`/api/entries?month=${MONTH}&year=${YEAR}`)).body;
        const kept = entries.find(entry => entry.reimbursement && entry.type === 'expense');
        expect(kept).toMatchObject({ amount: '1500.00', account: { name: 'Reimbursements due' }, category: { name: 'Travel' } });
        const refused = await agent.put(`/api/entries/${kept.id}`).send({ type: 'expense', description: 'Changed', amount: 1, accountId: bank.id, date: DAY });
        expect(refused.status).toBe(400);
        expect(refused.body.error).toMatch(/belongs to a reimbursement/);
        expect((await agent.delete(`/api/entries/${kept.id}`)).status).toBe(400);
    });

    test('repaid in full closes it, with nothing counted as spending', async () => {
        const medical = (await agent.post('/api/reimbursements').send({ description: 'Hospital bill', amount: 3000, accountId: bank.id, date: DAY, fromWhom: 'Insurer' })).body;
        const repaid = await agent.post(`/api/reimbursements/${medical.id}/repay`).send({ amount: 3000, accountId: bank.id, date: DAY });
        expect(repaid.body).toMatchObject({ status: 'repaid', keptAsSpending: '0.00', outstanding: '0.00' });
        expect(repaid.body.repayments).toEqual([expect.objectContaining({ amount: '3000.00', account: 'REIMBURSE BANK' })]);
    });

    test('a pending one with nothing repaid can be deleted, undoing the payment', async () => {
        const before = (await balanceOf(bank.id)).balance;
        const mistake = (await agent.post('/api/reimbursements').send({ description: 'Typo', amount: 100, accountId: bank.id, date: DAY })).body;
        expect((await balanceOf(bank.id)).balance).not.toBe(before);
        expect((await agent.delete(`/api/reimbursements/${mistake.id}`)).status).toBe(200);
        expect((await balanceOf(bank.id)).balance).toBe(before);
        expect((await agent.delete(`/api/reimbursements/${hotel.id}`)).status).toBe(400);
    });

    test('mistakes and spending limits are refused', async () => {
        const post = body => agent.post('/api/reimbursements').send({ description: 'Probe', amount: 10, accountId: bank.id, date: DAY, ...body });
        expect((await post({ amount: 0 })).body.error).toBe('Enter an amount greater than zero');
        expect((await post({ description: '' })).body.error).toBe('Description is required');
        expect((await post({ categoryId: category('Salary') })).body.error).toBe('Choose a spending category for an expense');
        expect((await post({ amount: 9999999 })).body.error).toBe('Insufficient bank balance');
        expect((await post({ date: '' })).body.error).toBe('Date is required');
    });

    test('the list puts open ones first; another user sees none of them', async () => {
        await agent.post('/api/reimbursements').send({ description: 'Still open', amount: 50, accountId: bank.id, date: DAY });
        const list = (await agent.get('/api/reimbursements')).body;
        expect(list[0]).toMatchObject({ description: 'Still open', status: 'pending' });
        const otherAgent = request.agent(target());
        await logIn(otherAgent, OTHER, PASSWORD);
        expect((await otherAgent.get('/api/reimbursements')).body).toEqual([]);
        expect((await otherAgent.post(`/api/reimbursements/${hotel.id}/repay`).send({ amount: 1, accountId: bank.id, date: DAY })).status).toBe(404);
    });
});
