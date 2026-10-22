/**
 * Chit funds (real database, balancetrack_test schema; lib/services/chits.ts)
 *
 * A Rs 1 lakh chit of 10 members over 10 months: auctions others win set the dividend; payments
 * are savings in the chit; winning month 3 brings the prize in and turns the rest into what is
 * owed; a missed payment is the next step.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'chits_user';
const OTHER = 'chits_other';
const PASSWORD = 'Chits_Pass9';

const india = new Date(Date.now() + 330 * 60_000);
const monthsAgo = n => new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth() - n, 1)).toISOString().slice(0, 10);

let agent;
let otherAgent;
let user;
let bank;
let chit;

const balanceOf = async id => (await agent.get('/api/accounts')).body.find(account => account.id === id).balance;
const sumIn = async key => Number((await query(
    `SELECT coalesce(sum(l.amount_paise), 0)::bigint AS paise FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.id = l.account_id
     WHERE e.user_id = $1 AND e.voided_at IS NULL AND a.category_key = $2`, [user.id, key])).rows[0].paise);

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'chits_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'chits_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Chit Bank', initialBalance: 200000 })).status).toBe(200);
    bank = (await agent.get('/api/accounts')).body.find(account => account.type === 'bank');
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

test('a chit is added; an informal one is marked', async () => {
    const response = await agent.post('/api/chits').send({
        name: 'Office chit', organiserKind: 'informal', organiser: 'Ramesh', value: '100000', members: 10, months: 10, commissionPercent: '5', startedOn: monthsAgo(3),
    });
    expect(response.status).toBe(200);
    chit = response.body;
    expect(chit).toMatchObject({ organiserKind: 'informal', contribution: '10000.00', commission: '5000.00', balance: '0.00', monthsPaid: 0,
        next: { month: 1, amount: '10000.00', dividendKnown: false } });
    expect((await agent.post('/api/chits').send({ name: 'x', organiserKind: 'friend', value: '1', members: 10, startedOn: monthsAgo(1) })).body.error)
        .toBe('Choose whether the organiser is a registered chit company or a person');
});

test('an auction others win sets the dividend; a payment is savings in the chit, the dividend income', async () => {
    chit = (await agent.post(`/api/chits/${chit.id}/auctions`).send({ month: 1, heldOn: monthsAgo(3), discount: '20000' })).body;
    // 20,000 less 5,000 commission, shared by 10
    expect(chit.auctions[0]).toMatchObject({ month: 1, dividend: '1500.00', wonByUser: false });
    expect(chit.next).toMatchObject({ month: 1, amount: '8500.00', dividendKnown: true });
    chit = (await agent.post(`/api/chits/${chit.id}/instalments`).send({ month: 1, accountId: bank.id, date: monthsAgo(3) })).body;
    expect(chit).toMatchObject({ balance: '10000.00', monthsPaid: 1, paid: '8500.00', dividends: '1500.00' });
    expect(await balanceOf(bank.id)).toBe('191500.00');
    expect(await sumIn('dividends')).toBe(-150_000);

    chit = (await agent.post(`/api/chits/${chit.id}/auctions`).send({ month: 2, heldOn: monthsAgo(2), discount: '15000' })).body;
    chit = (await agent.post(`/api/chits/${chit.id}/instalments`).send({ month: 2, accountId: bank.id, date: monthsAgo(2) })).body;
    expect(chit).toMatchObject({ balance: '20000.00', paid: '17500.00' });
});

test('winning brings the prize in; what is left to pay is owed; the discount is the cost', async () => {
    const before = await sumIn('loan_interest');
    chit = (await agent.post(`/api/chits/${chit.id}/auctions`).send({ month: 3, heldOn: monthsAgo(1), discount: '12000', wonByUser: true, deductions: '500', accountId: bank.id })).body;
    expect(chit.won).toMatchObject({ month: 3, prize: '88000.00', net: '87500.00' });
    // 20,000 saved, less the whole 1,00,000 commitment: 80,000 left to pay
    expect(chit.balance).toBe('-80000.00');
    expect(await sumIn('loan_interest') - before).toBe(1_250_000);
    expect(chit.outcome.role).toBe('borrower');
    expect(chit.outcome.yearlyRate).toBeGreaterThan(0);
    expect((await agent.post(`/api/chits/${chit.id}/auctions`).send({ month: 4, heldOn: monthsAgo(0), discount: '1', wonByUser: true, accountId: bank.id })).body.error)
        .toBe('You have already won this chit');
});

test('payments after winning reduce what is owed; a missed one is the next step', async () => {
    chit = (await agent.post(`/api/chits/${chit.id}/instalments`).send({ month: 3, accountId: bank.id, date: monthsAgo(1) })).body;
    expect(chit.instalments.find(item => item.month === 3)).toMatchObject({ dividend: '700.00', paid: '9300.00' });
    expect(chit.balance).toBe('-70000.00');
    expect((await agent.post(`/api/chits/${chit.id}/instalments`).send({ month: 3, accountId: bank.id, date: monthsAgo(1) })).body.error).toBe('Month 3 is already paid');
    // Month 4 was due on the 1st of this month
    if (new Date(Date.now() + 330 * 60_000).getUTCDate() > 1) {
        expect(chit.missed).toBe(1);
        expect((await agent.get('/api/next-step')).body).toMatchObject({ kind: 'chit', text: expect.stringContaining('Office chit: month 4') });
    }
});

test('a record entered by mistake is removed; others see nothing; the ledger balances', async () => {
    const won = chit.auctions.find(item => item.wonByUser);
    chit = (await agent.delete(`/api/chits/${chit.id}/auctions/${won.id}`)).body;
    expect(chit.won).toBeNull();
    expect(chit.balance).toBe('30000.00');
    expect((await otherAgent.get('/api/chits')).body).toEqual([]);
    expect((await otherAgent.post(`/api/chits/${chit.id}/instalments`).send({ month: 4, accountId: bank.id, date: monthsAgo(0) })).status).toBe(404);
    const unbalanced = await query(
        `SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE e.user_id = $1 GROUP BY e.id HAVING sum(l.amount_paise) <> 0`, [user.id]);
    expect(unbalanced.rows).toEqual([]);
});
