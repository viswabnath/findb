/**
 * Statement import (real database, balancetrack_test schema; lib/services/statement-import.ts)
 *
 * The browser reads the file and sends the rows. The review flags duplicates, transfers between
 * the user's own accounts (ATM withdrawals, card bills, and the other side of an entry already on
 * another account) and suggests categories; the kept rows are saved as one import, which balances
 * in the ledger and can be undone.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'import_user';
const OTHER = 'import_other';
const PASSWORD = 'Import_Pass9';

const pad = n => String(n).padStart(2, '0');
const daysAgo = n => {
    const date = new Date(Date.now() + 5.5 * 3600 * 1000 - n * 86_400_000);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
const D = daysAgo(20);
const D1 = daysAgo(19);
const D2 = daysAgo(18);

let agent;
let otherAgent;
let user;
let bank;
let card;
let cash;
let wallet;
let categories;

const accounts = async () => (await agent.get('/api/accounts')).body;
const balance = async id => (await accounts()).find(account => account.id === id).balance;
const category = name => categories.find(item => item.name === name);

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'import_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'import_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Import Bank', initialBalance: 100000 })).status).toBe(200);
    expect((await agent.post('/api/credit-cards').send({ name: 'Regalia Card', creditLimit: 50000 })).status).toBe(200);
    wallet = (await agent.post('/api/accounts').send({ type: 'wallet', name: 'My Wallet', openingBalance: 0 })).body;
    const list = await accounts();
    bank = list.find(account => account.type === 'bank');
    card = list.find(account => account.type === 'credit_card');
    cash = list.find(account => account.type === 'cash');
    categories = (await agent.get('/api/categories')).body;
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

// The bank statement, as the browser reads it
const STATEMENT = [
    { line: 1, date: D, description: 'Swiggy Limited', narration: 'UPI-SWIGGY LIMITED-swiggy@hdfcbank-HDFC0MERUPI-412345678901-Payment', amount: '-450.00' },
    { line: 2, date: D, description: 'Acme Pvt Ltd', narration: 'NEFT CR-ICIC0000001-ACME PVT LTD-SALARY OCT-N123', amount: '85000.00' },
    { line: 3, date: D1, description: 'ATW-512345XXXXXX1234-S1ANMU01', narration: 'ATW-512345XXXXXX1234-S1ANMU01', amount: '-2000.00' },
    { line: 4, date: D1, description: 'Billpay Regalia', narration: 'BILLPAY CREDIT CARD REGALIA 4321', amount: '-5000.00' },
    { line: 5, date: D1, description: 'Bigbasket', narration: 'UPI-BIGBASKET-bb@icici', amount: '-300.00' },
    { line: 6, date: D2, description: 'Coffee', narration: 'Coffee', amount: '-50.00' },
    { line: 7, date: D2, description: 'Coffee', narration: 'Coffee', amount: '-50.00' },
    { line: 8, date: D2, description: 'My Wallet', narration: 'UPI/DR/412345678901/MY WALLET/PYTM/wallet@paytm/Self', amount: '-1000.00' },
    { line: 9, date: D2, description: 'Ravi Kumar', narration: 'IMPS-412345678901-Ravi Kumar-HDFC-xxxx1234', amount: '700.00' },
];

let review;
let batch;

describe('review', () => {
    beforeAll(async () => {
        // Already in FinDB: groceries entered by hand a day earlier, money that reached the wallet,
        // and a shopping charge on the card of the same size as a payment that came in
        const post = body => agent.post('/api/entries').send(body);
        expect((await post({ type: 'expense', date: D, description: 'Groceries', amount: 300, accountId: bank.id })).status).toBe(200);
        expect((await post({ type: 'income', date: D2, description: 'Top-up', amount: 1000, accountId: wallet.id })).status).toBe(200);
        expect((await post({ type: 'expense', date: D2, description: 'Shoes', amount: 700, accountId: card.id, categoryId: category('Shopping').id })).status).toBe(200);
    });

    test('flags duplicates, repeats, transfers and categories, and saves nothing', async () => {
        const before = await balance(bank.id);
        const response = await agent.post('/api/imports/preview').send({ accountId: bank.id, rows: STATEMENT });
        expect(response.status).toBe(200);
        review = response.body;
        const [swiggy, salary, atm, cardBill, groceries, coffee, coffeeAgain, toWallet, ravi] = review.rows;

        expect(swiggy).toMatchObject({ amount: '-450.00', duplicate: null, action: { type: 'category', categoryId: category('Restaurants and food delivery').id }, reason: 'keyword' });
        // "Salary" is only in the narration
        expect(salary).toMatchObject({ action: { type: 'category', categoryId: category('Salary').id }, reason: 'keyword' });
        expect(atm).toMatchObject({ action: { type: 'transfer', accountId: cash.id }, reason: 'atm' });
        expect(cardBill).toMatchObject({ action: { type: 'transfer', accountId: card.id }, reason: 'card_payment' });
        expect(groceries.duplicate).toMatchObject({ description: 'Groceries', date: D, sameDescription: false });
        expect(coffee.repeated).toBe(false);
        expect(coffeeAgain.repeated).toBe(true);
        // The wallet's uncategorised income is the other side: one transfer replaces it
        expect(toWallet).toMatchObject({ action: { type: 'replace' }, reason: 'match', match: { accountId: wallet.id, description: 'Top-up' } });
        // A categorised entry of the same size is only mentioned, not replaced
        expect(ravi).toMatchObject({ action: { type: 'category', categoryId: null }, reason: null, match: { accountId: card.id, description: 'Shoes' } });

        // Everything but the duplicate counts towards the balance after
        expect(review.account).toMatchObject({ id: bank.id, balance: before });
        expect(review.balanceAfter).toBe((Number(before) - 450 + 85000 - 2000 - 5000 - 100 - 1000 + 700).toFixed(2));
        expect(await balance(bank.id)).toBe(before);
    });

    test('a card statement: a payment from the only bank, and money back as a refund', async () => {
        const response = await agent.post('/api/imports/preview').send({
            accountId: card.id, rows: [
                { date: D1, description: 'Payment received', narration: 'PAYMENT RECEIVED - THANK YOU', amount: '5000' },
                { date: D1, description: 'Amazon', narration: 'AMAZON REFUND', amount: '299' },
            ],
        });
        expect(response.status).toBe(200);
        expect(response.body.rows[0]).toMatchObject({ action: { type: 'transfer', accountId: bank.id }, reason: 'card_payment' });
        expect(response.body.rows[1]).toMatchObject({ action: { type: 'category', categoryId: category('Refund').id } });
    });

    test('refuses what it cannot read', async () => {
        const preview = rows => agent.post('/api/imports/preview').send({ accountId: bank.id, rows });
        expect((await preview([])).body.error).toBe('There are no rows to import');
        expect((await preview([{ line: 4, date: '2999-01-01', description: 'x', amount: '1' }])).body.error).toBe('Line 4 of the statement: the date is in the future');
        expect((await preview([{ date: D, description: 'x', amount: 'abc' }])).body.error).toBe('Line 1 of the statement: the amount is not valid');
        expect((await preview([{ date: D, description: ' ', amount: '1' }])).body.error).toBe('Line 1 of the statement: the description is empty');
        const many = Array.from({ length: 1001 }, () => ({ date: D, description: 'x', amount: '1' }));
        expect((await preview(many)).body.error).toBe('One import takes at most 1000 rows. Download the statement in shorter periods.');
        expect((await otherAgent.post('/api/imports/preview').send({ accountId: bank.id, rows: STATEMENT })).body.error).toBe('Account not found');
    });
});

describe('import', () => {
    const LAYOUT = {
        signature: 'date|narration|chq/ref no|value dt|withdrawal amt|deposit amt|closing balance', presetKey: 'hdfc_account',
        mapping: { date: 0, description: 1, debit: 4, credit: 5, amount: null, direction: null, balance: 6, reference: 2, dateOrder: 'dmy', positive: 'in' },
    };
    const kept = () => STATEMENT.map((row, index) => ({ ...row, action: review.rows[index].action })).filter((_, index) => !review.rows[index].duplicate);

    test('saves the kept rows as one import, in balance', async () => {
        const before = { bank: await balance(bank.id), cash: await balance(cash.id), card: await balance(card.id), wallet: await balance(wallet.id) };
        const response = await agent.post('/api/imports').send({
            accountId: bank.id, fileKind: 'csv', rowsInFile: 9, layout: LAYOUT, closingBalance: { date: D2, amount: '176900.00' }, rows: kept(),
        });
        expect(response.status).toBe(200);
        batch = response.body;
        expect(batch).toMatchObject({ imported: 8, transfers: 3, replaced: 1, account: { id: bank.id, balance: review.balanceAfter } });
        expect(batch.closing).toMatchObject({ date: D2, balance: '176900.00' });

        expect(await balance(cash.id)).toBe((Number(before.cash) + 2000).toFixed(2));
        // A card payment lowers what is owed
        expect(await balance(card.id)).toBe((Number(before.card) + 5000).toFixed(2));
        // The wallet's top-up is now the transfer from the bank: its balance is unchanged
        expect(await balance(wallet.id)).toBe(before.wallet);

        const check = await query('SELECT count(*)::int AS n FROM ledger_entry_check WHERE user_id = $1', [user.id]);
        expect(check.rows[0].n).toBe(0);
        const unbalanced = await query(
            `SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
             WHERE e.user_id = $1 GROUP BY e.id HAVING sum(l.amount_paise) <> 0`, [user.id]);
        expect(unbalanced.rows).toEqual([]);
        const log = await query('SELECT description, new_values FROM activity_log WHERE user_id = $1 AND entity_type = \'import\'', [user.id]);
        expect(log.rows).toHaveLength(1);
        expect(log.rows[0].new_values).toMatchObject({ entries: 8, transfers: 3, replaced: 1 });
    });

    test('the entries are listed, and the column choice is remembered', async () => {
        const [year, month] = D2.split('-');
        const entries = (await agent.get(`/api/entries?month=${Number(month)}&year=${year}`)).body;
        expect(entries.find(entry => entry.description === 'ATW-512345XXXXXX1234-S1ANMU01')).toMatchObject({ type: 'transfer', toAccount: { id: cash.id } });
        const profiles = (await agent.get('/api/imports/profiles')).body;
        expect(profiles).toEqual([{ ...LAYOUT, accountId: bank.id }]);
        const list = (await agent.get('/api/imports')).body;
        expect(list[0]).toMatchObject({ id: batch.batchId, account: { id: bank.id }, imported: 8, active: 8, rowsInFile: 9, closingBalance: '176900.00', undoneAt: null });
    });

    test('the same statement again: every row is a duplicate', async () => {
        const again = (await agent.post('/api/imports/preview').send({ accountId: bank.id, rows: STATEMENT })).body;
        expect(again.rows.every(row => row.duplicate !== null)).toBe(true);
        expect(again.balanceAfter).toBe(again.account.balance);
    });

    test('refuses actions that do not fit', async () => {
        const one = action => agent.post('/api/imports').send({ accountId: bank.id, fileKind: 'csv', rows: [{ date: D, description: 'x', amount: '-1', action }] });
        expect((await one(undefined)).body.error).toBe('Line 1 of the statement: choose a category, or the other account of a transfer');
        expect((await one({ type: 'category', categoryId: category('Salary').id })).body.error).toBe('Line 1 of the statement: Choose a spending category for an expense');
        expect((await one({ type: 'transfer', accountId: bank.id })).body.error).toBe('Line 1 of the statement: Choose two different accounts for a transfer');
        // The wallet entry was replaced already
        expect((await one({ type: 'replace', entryId: review.rows[7].action.entryId })).body.error).toContain('the entry it matched has changed');
        const income = await agent.post('/api/imports').send({ accountId: card.id, fileKind: 'csv', rows: [{ date: D, description: 'x', amount: '10', action: { type: 'category', categoryId: category('Salary').id } }] });
        expect(income.body.error).toBe('Line 1 of the statement: Income goes into a bank, cash, a wallet or a meal card; on a credit card, only a refund or cashback');
        const layout = await agent.post('/api/imports').send({ accountId: bank.id, fileKind: 'csv', layout: { ...LAYOUT, mapping: { ...LAYOUT.mapping, date: null } },
            rows: [{ date: D, description: 'x', amount: '-1', action: { type: 'category', categoryId: null } }] });
        expect(layout.body.error).toBe('The column choice is not valid. Choose the columns again.');
        expect((await agent.post('/api/imports').send({ accountId: bank.id, fileKind: 'pdf', rows: [{ date: D, description: 'x', amount: '-1', action: { type: 'category', categoryId: null } }] })).status).toBe(400);
        expect((await agent.get('/api/imports')).body).toHaveLength(1);
    });

    test('other users see none of it', async () => {
        expect((await otherAgent.get('/api/imports')).body).toEqual([]);
        expect((await otherAgent.get('/api/imports/profiles')).body).toEqual([]);
        expect((await otherAgent.delete(`/api/imports/${batch.batchId}`)).status).toBe(404);
    });

    test('undo voids the import and brings back what it replaced', async () => {
        const response = await agent.delete(`/api/imports/${batch.batchId}`);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ undone: 8, restored: 1 });
        expect(await balance(bank.id)).toBe(review.account.balance);
        const top = await query('SELECT voided_at FROM journal_entries WHERE user_id = $1 AND description = \'Top-up\'', [user.id]);
        expect(top.rows[0].voided_at).toBeNull();
        expect((await agent.delete(`/api/imports/${batch.batchId}`)).body.error).toBe('This import was already undone');
        expect((await agent.get('/api/imports')).body[0]).toMatchObject({ active: 0, undoneAt: expect.any(String) });
        const check = await query('SELECT count(*)::int AS n FROM ledger_entry_check WHERE user_id = $1', [user.id]);
        expect(check.rows[0].n).toBe(0);
    });

    test('a card refund imports as income in Refund', async () => {
        const response = await agent.post('/api/imports').send({
            accountId: card.id, fileKind: 'excel', rows: [{ date: D1, description: 'Amazon', amount: '299', action: { type: 'category', categoryId: category('Refund').id } }],
        });
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ imported: 1, transfers: 0, closing: null });
    });
});
