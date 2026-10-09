/**
 * Money accounts and entries in the ledger (real database, balancetrack_test schema; docs/ledger.md)
 *
 * Wallets and meal cards live only in the ledger; banks record their details; income, expenses and
 * transfers work on any money account. A transfer moves money between the user's own accounts and
 * counts as neither income nor spending, so net savings (income - expenses) never changes with it.
 * Entries made through the former routes are kept in step when edited or deleted here.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'entries_user';
const OTHER = 'entries_other';
const SPENDER = 'entries_spender';
const PASSWORD = 'Ledger_Pass9';

const today = new Date();
const pad = n => String(n).padStart(2, '0');
const MONTH = today.getMonth() + 1;
const YEAR = today.getFullYear();
const DAY = `${YEAR}-${pad(MONTH)}-01`;

let agent;
let user;
let bank;
let card;
let cash;
let wallet;
let mealCard;

const byType = (accounts, type) => accounts.filter(account => account.type === type);
const accounts = async (as = agent) => (await as.get('/api/accounts')).body;
const balanceOf = async id => (await accounts()).find(account => account.id === id);
const summary = async () => (await agent.get(`/api/monthly-summary?month=${MONTH}&year=${YEAR}`)).body;

beforeAll(async () => {
    for (const name of [USER, OTHER, SPENDER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'entries_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'entries_other@example.com' });
    agent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    // A bank and a card through the former routes, as the Accounts screen makes them (banks get
    // capital letters there)
    expect((await agent.post('/api/banks').send({ name: 'Entries Bank', initialBalance: 10000 })).status).toBe(200);
    expect((await agent.post('/api/credit-cards').send({ name: 'Entries Card', creditLimit: 5000 })).status).toBe(200);
    // Users and created_at well before the month's end, so the summary lists everything
    await query('UPDATE users SET created_at = created_at - interval \'40 days\' WHERE id = $1', [user.id]);
});

afterAll(async () => {
    for (const name of [USER, OTHER, SPENDER]) await deleteTestUser(name);
    await closeTarget();
});

describe('accounts', () => {
    test('the list holds the bank, the card and cash, with ledger balances and their former ids', async () => {
        const list = await accounts();
        [bank] = byType(list, 'bank');
        [card] = byType(list, 'credit_card');
        [cash] = byType(list, 'cash');
        expect(bank).toMatchObject({ name: 'ENTRIES BANK', balance: '10000.00', used: null });
        expect(bank.sourceId).toEqual(expect.any(Number));
        expect(card).toMatchObject({ balance: '0.00', used: '0.00', creditLimit: '5000.00', available: '5000.00' });
        // Cash is always there, even before it was set
        expect(cash).toMatchObject({ name: 'Cash', balance: '0.00' });
    });

    test('a wallet and a meal card are added with their starting balances', async () => {
        const added = await agent.post('/api/accounts').send({ type: 'wallet', name: 'Paytm Wallet', institution: 'Paytm', openingBalance: '250.50' });
        expect(added.status).toBe(200);
        wallet = added.body;
        expect(wallet).toMatchObject({ type: 'wallet', name: 'Paytm Wallet', institution: 'Paytm', balance: '250.50' });
        mealCard = (await agent.post('/api/accounts').send({ type: 'meal_card', name: 'Pluxee', openingBalance: 0 })).body;
        expect(mealCard).toMatchObject({ type: 'meal_card', balance: '0.00' });

        const clash = await agent.post('/api/accounts').send({ type: 'wallet', name: 'paytm wallet' });
        expect(clash.status).toBe(400);
        const wrongType = await agent.post('/api/accounts').send({ type: 'bank', name: 'Sneaky Bank' });
        expect(wrongType.status).toBe(400);
        const negative = await agent.post('/api/accounts').send({ type: 'wallet', name: 'Minus', openingBalance: -5 });
        expect(negative.status).toBe(400);
    });

    test('a bank records its details; banks and cards are not renamed here', async () => {
        const updated = await agent.put(`/api/accounts/${bank.id}`).send({ institution: 'HDFC Bank', accountType: 'savings', interestRate: '3.25' });
        expect(updated.status).toBe(200);
        expect(updated.body).toMatchObject({ institution: 'HDFC Bank', accountType: 'savings', interestRate: '3.250' });

        expect((await agent.put(`/api/accounts/${bank.id}`).send({ accountType: 'fixed' })).status).toBe(400);
        expect((await agent.put(`/api/accounts/${bank.id}`).send({ interestRate: '101' })).status).toBe(400);
        expect((await agent.put(`/api/accounts/${bank.id}`).send({ name: 'Renamed Bank' })).status).toBe(400);
        expect((await agent.put(`/api/accounts/${wallet.id}`).send({ interestRate: '4' })).status).toBe(400);
        const renamed = await agent.put(`/api/accounts/${wallet.id}`).send({ name: 'PhonePe Wallet', notes: 'UPI lite' });
        expect(renamed.body).toMatchObject({ name: 'PhonePe Wallet', notes: 'UPI lite', balance: '250.50' });
    });

    test('another user\'s account cannot be changed or used', async () => {
        const otherAgent = request.agent(target());
        await logIn(otherAgent, OTHER, PASSWORD);
        expect((await otherAgent.put(`/api/accounts/${wallet.id}`).send({ name: 'Mine now' })).status).toBe(400);
        const spend = await otherAgent.post('/api/entries')
            .send({ type: 'expense', description: 'Probe', amount: 1, accountId: wallet.id, date: DAY });
        expect(spend.status).toBe(400);
        expect(spend.body.error).toBe('Account not found');
        expect((await otherAgent.get('/api/accounts')).body.map(account => account.id)).not.toContain(wallet.id);
    });
});

describe('entries', () => {
    test('income into a meal card, an expense from the wallet', async () => {
        const income = await agent.post('/api/entries')
            .send({ type: 'income', description: 'Meal benefit', amount: 2200, accountId: mealCard.id, date: DAY });
        expect(income.status).toBe(200);
        expect(income.body).toMatchObject({ type: 'income', amount: '2200.00', account: { id: mealCard.id, type: 'meal_card' }, legacy: false });
        expect(income.body.category.name).toBe('Other income');

        const expense = await agent.post('/api/entries')
            .send({ type: 'expense', description: 'Swiggy', amount: '150.50', accountId: wallet.id, date: DAY });
        expect(expense.status).toBe(200);
        expect(expense.body.category.name).toBe('Uncategorised');
        expect((await balanceOf(wallet.id)).balance).toBe('100.00');
        expect((await balanceOf(mealCard.id)).balance).toBe('2200.00');
    });

    test('a transfer moves money between accounts and is neither income nor spending', async () => {
        const before = await summary();
        const atm = await agent.post('/api/entries')
            .send({ type: 'transfer', description: 'ATM withdrawal', amount: 2000, accountId: bank.id, toAccountId: cash.id, date: DAY });
        expect(atm.status).toBe(200);
        expect(atm.body).toMatchObject({ type: 'transfer', account: { id: bank.id }, toAccount: { id: cash.id }, category: null });
        const bill = await agent.post('/api/entries')
            .send({ type: 'expense', description: 'Flight', amount: 1200, accountId: card.id, date: DAY });
        expect(bill.status).toBe(200);
        const payment = await agent.post('/api/entries')
            .send({ type: 'transfer', description: 'Card bill', amount: 1200, accountId: bank.id, toAccountId: card.id, date: DAY });
        expect(payment.status).toBe(200);

        expect((await balanceOf(bank.id)).balance).toBe('6800.00');
        expect((await balanceOf(cash.id)).balance).toBe('2000.00');
        expect((await balanceOf(card.id)).used).toBe('0.00');

        const after = await summary();
        expect(after.monthlyIncome).toBe(before.monthlyIncome);
        // Only the flight is new spending; paying the card bill is not spending it twice
        expect(after.totalExpenses).toBeCloseTo(before.totalExpenses + 1200, 2);
        expect(after.netSavings).toBeCloseTo(after.monthlyIncome - after.totalExpenses, 2);
        // Wallets and meal cards count in wealth: bank 6800 + cash 2000 + wallet 100 + meal card 2200
        expect(after.totalCurrentWealth).toBeCloseTo(11100, 2);
        expect(after.otherAccounts.map(account => account.name).sort()).toEqual(['PhonePe Wallet', 'Pluxee']);
    });

    test('the month\'s list shows each kind, with its accounts', async () => {
        const list = await agent.get(`/api/entries?month=${MONTH}&year=${YEAR}`);
        expect(list.status).toBe(200);
        const types = list.body.map(entry => entry.type);
        expect(types.filter(type => type === 'transfer')).toHaveLength(2);
        expect(types).toContain('income');
        expect(types).toContain('expense');
        const atm = list.body.find(entry => entry.description === 'ATM withdrawal');
        expect(atm).toMatchObject({ account: { name: 'ENTRIES BANK' }, toAccount: { name: 'Cash' }, amount: '2000.00', date: DAY });
        expect((await agent.get('/api/entries')).status).toBe(400);
        expect((await agent.get(`/api/entries?month=13&year=${YEAR}`)).status).toBe(400);
    });

    test('mistakes are refused', async () => {
        const post = body => agent.post('/api/entries').send({ date: DAY, description: 'Probe', amount: 10, ...body });
        expect((await post({ type: 'income', accountId: card.id })).body.error).toBe('Income goes into a bank, cash, a wallet or a meal card');
        expect((await post({ type: 'transfer', accountId: bank.id, toAccountId: bank.id })).body.error).toBe('Choose two different accounts for a transfer');
        expect((await post({ type: 'gift', accountId: bank.id })).status).toBe(400);
        expect((await post({ type: 'expense', accountId: bank.id, amount: 0 })).body.error).toBe('Enter an amount greater than zero');
        expect((await post({ type: 'expense', accountId: bank.id, date: '2026-02-30' })).body.error).toBe('Invalid date format');
        expect((await post({ type: 'expense', accountId: bank.id, description: '  ' })).body.error).toBe('Description is required');
    });

    test('spending more than an account holds is refused, unless only expenses are tracked', async () => {
        const post = body => agent.post('/api/entries').send({ date: DAY, description: 'Too much', ...body });
        expect((await post({ type: 'expense', amount: '100.01', accountId: wallet.id })).body.error).toBe('Insufficient balance in PhonePe Wallet');
        expect((await post({ type: 'transfer', amount: 999999, accountId: bank.id, toAccountId: cash.id })).body.error).toBe('Insufficient bank balance');
        expect((await post({ type: 'expense', amount: 5000.01, accountId: card.id })).body.error).toBe('Insufficient credit limit');
        expect((await post({ type: 'expense', amount: '100.00', accountId: wallet.id })).status).toBe(200);

        await createTestUser({ username: SPENDER, password: PASSWORD, email: 'entries_spender@example.com', trackingOption: 'expenses' });
        const spender = request.agent(target());
        await logIn(spender, SPENDER, PASSWORD);
        const spenderCash = byType(await accounts(spender), 'cash')[0];
        const overspend = await spender.post('/api/entries')
            .send({ type: 'expense', description: 'Tea', amount: 20, accountId: spenderCash.id, date: DAY });
        expect(overspend.status).toBe(200);
        expect(byType(await accounts(spender), 'cash')[0].balance).toBe('-20.00');
    });

    test('an edit voids the old entry and records a new one; a delete voids it', async () => {
        const created = (await agent.post('/api/entries')
            .send({ type: 'expense', description: 'Coffee', amount: 120, accountId: bank.id, date: DAY })).body;
        const edited = await agent.put(`/api/entries/${created.id}`)
            .send({ type: 'transfer', description: 'Wallet top-up', amount: 500, accountId: bank.id, toAccountId: wallet.id, date: DAY });
        expect(edited.status).toBe(200);
        expect(edited.body.id).not.toBe(created.id);
        expect(edited.body).toMatchObject({ type: 'transfer', toAccount: { id: wallet.id } });
        const voided = await query('SELECT voided_at IS NOT NULL AS voided FROM journal_entries WHERE id = $1', [created.id]);
        expect(voided.rows[0].voided).toBe(true);
        expect((await balanceOf(wallet.id)).balance).toBe('500.00');

        expect((await agent.delete(`/api/entries/${edited.body.id}`)).status).toBe(200);
        expect((await balanceOf(wallet.id)).balance).toBe('0.00');
        expect((await agent.delete(`/api/entries/${edited.body.id}`)).status).toBe(404);
        expect((await agent.put(`/api/entries/${created.id}`).send({ type: 'expense', description: 'x', amount: 1, accountId: bank.id, date: DAY })).status).toBe(404);
    });

    test('entries made through the former routes are kept in step when edited or deleted here', async () => {
        const expense = await agent.post('/api/expenses')
            .send({ title: 'Old route', amount: 300, paymentMethod: 'bank', paymentSourceId: bank.sourceId, date: DAY });
        expect(expense.status).toBe(200);
        const income = await agent.post('/api/income')
            .send({ source: 'Old income', amount: 75, creditedToType: 'cash', date: DAY });
        expect(income.status).toBe(200);
        const list = (await agent.get(`/api/entries?month=${MONTH}&year=${YEAR}`)).body;
        const oldExpense = list.find(row => row.description === 'Old route');
        const oldIncome = list.find(row => row.description === 'Old income');
        expect(oldExpense.legacy).toBe(true);
        expect(oldIncome).toMatchObject({ legacy: true, account: { type: 'cash' } });

        const edited = await agent.put(`/api/entries/${oldExpense.id}`)
            .send({ type: 'expense', description: 'Old route, edited', amount: 350, accountId: bank.id, date: DAY });
        expect(edited.status).toBe(200);
        expect(edited.body).toMatchObject({ legacy: false, amount: '350.00' });
        expect((await query('SELECT id FROM expenses WHERE id = $1', [expense.body.id])).rows).toEqual([]);

        expect((await agent.delete(`/api/entries/${oldIncome.id}`)).status).toBe(200);
        expect((await query('SELECT id FROM income_entries WHERE id = $1', [income.body.id])).rows).toEqual([]);

        const check = await query('SELECT count(*)::int AS n FROM ledger_entry_check WHERE user_id = $1', [user.id]);
        expect(check.rows[0].n).toBe(0);
    });

    test('the activity feed names the accounts of a transfer', async () => {
        const feed = await agent.get('/api/activity');
        const transfer = feed.body.activities.find(item => item.activity_type === 'transfer' && item.description === 'Added transfer: ATM withdrawal');
        expect(transfer.account_info).toBe('ENTRIES BANK to Cash');
    });
});

describe('archiving', () => {
    test('a wallet with money in it cannot be removed; an empty one can', async () => {
        await agent.post('/api/entries').send({ type: 'transfer', description: 'Top-up', amount: 50, accountId: bank.id, toAccountId: wallet.id, date: DAY });
        const refused = await agent.delete(`/api/accounts/${wallet.id}`);
        expect(refused.status).toBe(400);
        expect(refused.body.error).toContain('still holds');
        await agent.post('/api/entries').send({ type: 'expense', description: 'Snacks', amount: 50, accountId: wallet.id, date: DAY });
        expect((await agent.delete(`/api/accounts/${wallet.id}`)).status).toBe(200);
        expect((await accounts()).map(account => account.id)).not.toContain(wallet.id);
        // Its history stays
        const history = await query('SELECT count(*)::int AS n FROM journal_lines WHERE account_id = $1', [wallet.id]);
        expect(history.rows[0].n).toBeGreaterThan(0);
        expect((await agent.delete(`/api/accounts/${bank.id}`)).status).toBe(400);
    });
});
