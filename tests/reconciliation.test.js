/**
 * Reconciliation (real database, balancetrack_test schema; docs/ledger.md)
 *
 * Checking an account against a statement finds a planted difference (the plan's test for Phase 1),
 * finishes at no difference or with a recorded adjustment, and protects the entries it cleared:
 * changing one needs confirmation, unless the account and amount stay the same.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'reconcile_user';
const OTHER = 'reconcile_other';
const PASSWORD = 'Ledger_Pass9';

// Statements are dated today (a bank's opening entry is dated the day it was added) and tomorrow
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const [YEAR, MONTH] = TODAY.split('-');
const DAY = TODAY;
const LATER = (() => {
    const [y, m, d] = TODAY.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
})();

let agent;
let user;
let bank;
let card;
let categories;
let rec;
const entry = body => agent.post('/api/entries').send({ date: DAY, accountId: bank.id, ...body });

beforeAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(OTHER);
    // Expenses only, so the spending check does not get in the way of the balances this builds
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'reconcile_user@example.com', trackingOption: 'expenses' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'reconcile_other@example.com' });
    agent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    await agent.post('/api/banks').send({ name: 'Reconcile Bank', initialBalance: 10000 });
    await agent.post('/api/credit-cards').send({ name: 'Reconcile Card', creditLimit: 50000 });
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

describe('a statement', () => {
    let salary;
    let rent;

    test('shows the difference, and the entries that make it up', async () => {
        salary = (await entry({ type: 'income', description: 'Salary', amount: 50000 })).body;
        rent = (await entry({ type: 'expense', description: 'Rent', amount: 20000 })).body;
        // The bank's statement shows the salary and rent, and a 499 charge FinDB does not know about (the planted difference)
        const started = await agent.post('/api/reconciliations').send({ accountId: bank.id, statementDate: DAY, statementBalance: '39501.00' });
        expect(started.status).toBe(200);
        rec = started.body;
        expect(rec).toMatchObject({ status: 'open', statementBalance: '39501.00', clearedBalance: '0.00', difference: '39501.00' });
        expect(rec.lines.map(line => [line.description, line.amount])).toEqual(expect.arrayContaining([
            ['Opening balance: RECONCILE BANK', '10000.00'], ['Salary', '50000.00'], ['Rent', '-20000.00'],
        ]));
    });

    test('ticking every entry leaves exactly the planted difference', async () => {
        const ids = rec.lines.map(line => line.lineId);
        const ticked = await agent.post(`/api/reconciliations/${rec.id}/tick`).send({ lineIds: ids, ticked: true });
        expect(ticked.body).toMatchObject({ clearedBalance: '40000.00', difference: '-499.00' });
        const refused = await agent.post(`/api/reconciliations/${rec.id}/finish`).send({});
        expect(refused.status).toBe(400);
        expect(refused.body.error).toContain('differ by ₹499.00');
        // Unticking one moves the difference
        const unticked = await agent.post(`/api/reconciliations/${rec.id}/tick`).send({ lineIds: [rec.lines.find(line => line.description === 'Rent').lineId], ticked: false });
        expect(unticked.body.difference).toBe('-20499.00');
        await agent.post(`/api/reconciliations/${rec.id}/tick`).send({ lineIds: ids, ticked: true });
    });

    test('recording the missing charge makes it match; finishing protects the entries', async () => {
        const charge = (await entry({ type: 'expense', description: 'Bank charges', amount: 499, categoryId: categories.find(c => c.name === 'Bills and utilities').id })).body;
        const current = (await agent.get(`/api/reconciliations/${rec.id}`)).body;
        const line = current.lines.find(item => item.description === 'Bank charges');
        expect(line.ticked).toBe(false);
        const matched = await agent.post(`/api/reconciliations/${rec.id}/tick`).send({ lineIds: [line.lineId], ticked: true });
        expect(matched.body.difference).toBe('0.00');
        const done = await agent.post(`/api/reconciliations/${rec.id}/finish`).send({});
        expect(done.status).toBe(200);
        expect(done.body.status).toBe('done');
        expect(charge.id).toBeDefined();
    });

    test('changing a reconciled amount, or deleting it, needs confirmation; recategorising does not', async () => {
        const body = { type: 'expense', description: 'Rent', amount: 21000, accountId: bank.id, date: DAY };
        const refused = await agent.put(`/api/entries/${rent.id}`).send(body);
        expect(refused.status).toBe(409);
        expect(refused.body.error).toContain('which you reconciled');

        // Same account and amount: the tick moves with the entry, so no warning
        const renamed = await agent.put(`/api/entries/${rent.id}`).send({ ...body, amount: 20000, description: 'House rent' });
        expect(renamed.status).toBe(200);
        const recategorised = await agent.post('/api/entries/categorise').send({ entryIds: [renamed.body.id], categoryId: categories.find(c => c.name === 'Rent').id });
        expect(recategorised.body).toEqual({ changed: 1 });
        const ticks = await query(
            `SELECT count(*)::int AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
             WHERE l.user_id = $1 AND l.reconciliation_id = $2 AND e.voided_at IS NULL`, [user.id, rec.id]);
        expect(ticks.rows[0].n).toBe(4);

        const latest = (await agent.get(`/api/entries?month=${Number(MONTH)}&year=${YEAR}`)).body.find(item => item.description === 'House rent');
        expect((await agent.delete(`/api/entries/${latest.id}`)).status).toBe(409);
        expect((await agent.put(`/api/entries/${latest.id}`).send({ ...body, confirmReconciled: true })).status).toBe(200);
        expect((await agent.delete(`/api/entries/${salary.id}?confirmReconciled=true`)).status).toBe(200);
    });

    test('a later statement starts from what is already cleared; a difference can be recorded as an adjustment', async () => {
        await entry({ type: 'expense', description: 'Groceries', amount: 1000, date: LATER });
        const next = (await agent.post('/api/reconciliations').send({ accountId: bank.id, statementDate: LATER, statementBalance: '0' })).body;
        // The rent changed to 21000 with confirmation, so its new line is not cleared and comes up again
        expect(next.lines.map(line => [line.description, line.amount])).toEqual([['Rent', '-21000.00'], ['Groceries', '-1000.00']]);
        // Still cleared from the first statement: the opening 10000 and the 499 charge (the salary was deleted)
        expect(next.previouslyCleared).toBe('9501.00');
        await agent.post(`/api/reconciliations/${next.id}/tick`).send({ lineIds: next.lines.map(line => line.lineId), ticked: true });
        const adjusted = await agent.post(`/api/reconciliations/${next.id}/finish`).send({ adjust: true });
        expect(adjusted.status).toBe(200);
        const adjustment = await query(
            `SELECT l.amount_paise FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
             WHERE e.user_id = $1 AND e.entry_type = 'adjustment' AND e.description LIKE 'Reconciliation adjustment%' AND l.account_id = $2`,
            [user.id, bank.id]);
        expect(Number(adjustment.rows[0].amount_paise)).toBe(1249900);
        // The bank now shows what the statement said
        expect((await agent.get('/api/accounts')).body.find(account => account.id === bank.id).balance).toBe('0.00');
    });
});

describe('cards and rules', () => {
    test('a card is reconciled against the amount owed', async () => {
        await entry({ type: 'expense', description: 'Flight', amount: 7000, accountId: card.id });
        const started = (await agent.post('/api/reconciliations').send({ accountId: card.id, statementDate: DAY, statementBalance: '7000' })).body;
        const flight = started.lines.find(line => line.description === 'Flight');
        expect(flight.amount).toBe('7000.00');
        const ticked = (await agent.post(`/api/reconciliations/${started.id}/tick`).send({ lineIds: [flight.lineId], ticked: true })).body;
        expect(ticked.difference).toBe('0.00');
        // Cancelling removes the ticks
        expect((await agent.delete(`/api/reconciliations/${started.id}`)).status).toBe(200);
        const again = (await agent.post('/api/reconciliations').send({ accountId: card.id, statementDate: DAY, statementBalance: '7000' })).body;
        expect(again.lines.every(line => !line.ticked)).toBe(true);
    });

    test('mistakes, finished ones and other users are refused', async () => {
        expect((await agent.post('/api/reconciliations').send({ accountId: bank.id, statementBalance: '1' })).body.error).toBe('Statement date is required');
        expect((await agent.post('/api/reconciliations').send({ accountId: bank.id, statementDate: DAY, statementBalance: 'abc' })).status).toBe(400);
        expect((await agent.post(`/api/reconciliations/${rec.id}/tick`).send({ lineIds: [1], ticked: true })).body.error).toBe('This reconciliation is finished');
        const otherAgent = request.agent(target());
        await logIn(otherAgent, OTHER, PASSWORD);
        expect((await otherAgent.get(`/api/reconciliations/${rec.id}`)).status).toBe(404);
        expect((await otherAgent.get('/api/reconciliations')).body).toEqual([]);
        expect((await otherAgent.post('/api/reconciliations').send({ accountId: bank.id, statementDate: DAY, statementBalance: '1' })).body.error).toBe('Account not found');
    });
});
