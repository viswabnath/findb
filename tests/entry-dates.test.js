/**
 * Entry date tests (real database, balancetrack_test schema)
 *
 * An income or expense must be stored on the calendar date the user picked, in the month and
 * year of that date, whatever the server's time zone. The add routes used to convert through
 * local time, which stored entries made just after midnight IST on the previous day.
 * Also covers the overspend check's handling of amounts sent as strings.
 * @jest-environment node
 */

const request = require('supertest');


const { target, closeTarget } = require('./api-target');
const { createTestUser, createTestBank, createTestCashBalance, deleteTestUser, query, logIn } = require('../test-helpers');

const USERNAME = 'entry_dates_user';
const PASSWORD = 'TestPass123&';
const ORIGINAL_TZ = process.env.TZ;

let agent;
let bankId;

async function stored(table, id) {
    const result = await query(`SELECT date::text AS date, month, year FROM ${table} WHERE id = $1`, [id]);
    return result.rows[0];
}

beforeAll(async () => {
    await deleteTestUser(USERNAME);
    const user = await createTestUser({ username: USERNAME, password: PASSWORD, email: 'entry_dates@example.com' });
    bankId = (await createTestBank(user.id, { name: 'DATES BANK', balance: 100000 })).id;
    await createTestCashBalance(user.id, 100000);
    agent = request.agent(target());
    expect((await logIn(agent, USERNAME, PASSWORD)).status).toBe(200);
});

afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
});

afterAll(async () => {
    await deleteTestUser(USERNAME);
    await closeTarget();
});

// UTC+14 and UTC-7: with the old local-time conversion, one of these shifted the date at
// almost any time of day
describe.each(['Pacific/Kiritimati', 'America/Los_Angeles'])('server time zone %s', (zone) => {
    beforeEach(() => {
        process.env.TZ = zone;
    });

    test('added income keeps its date, month and year', async () => {
        const response = await agent.post('/api/income')
            .send({ source: 'Dated income', amount: 10, creditedToType: 'bank', creditedToId: bankId, date: '2026-10-01' });
        expect(response.status).toBe(200);
        expect(await stored('income_entries', response.body.id)).toEqual({ date: '2026-10-01', month: 10, year: 2026 });
    });

    test('an added expense on the first of a year keeps its date', async () => {
        const response = await agent.post('/api/expenses')
            .send({ title: 'Dated expense', amount: 5, paymentMethod: 'cash', paymentSourceId: null, date: '2027-01-01' });
        expect(response.status).toBe(200);
        expect(await stored('expenses', response.body.id)).toEqual({ date: '2027-01-01', month: 1, year: 2027 });
    });

    test('edits keep the new date, month and year', async () => {
        const income = await agent.post('/api/income')
            .send({ source: 'Edited income', amount: 10, creditedToType: 'cash', creditedToId: null, date: '2026-05-15' });
        const edited = await agent.put(`/api/income/${income.body.id}`)
            .send({ source: 'Edited income', amount: 12, creditedToType: 'cash', creditedToId: null, date: '2026-03-01' });
        expect(edited.status).toBe(200);
        expect(await stored('income_entries', income.body.id)).toEqual({ date: '2026-03-01', month: 3, year: 2026 });

        const expense = await agent.post('/api/expenses')
            .send({ title: 'Edited expense', amount: 5, paymentMethod: 'cash', paymentSourceId: null, date: '2026-05-15' });
        const editedExpense = await agent.put(`/api/expenses/${expense.body.id}`)
            .send({ title: 'Edited expense', amount: 6, paymentMethod: 'cash', paymentSourceId: null, date: '2026-12-31' });
        expect(editedExpense.status).toBe(200);
        expect(await stored('expenses', expense.body.id)).toEqual({ date: '2026-12-31', month: 12, year: 2026 });
    });
});

test('an amount sent as a string is checked as a number', async () => {
    // A bank with 100000: "700" must pass the overspend check (a text comparison refused it)
    const response = await agent.post('/api/expenses')
        .send({ title: 'String amount', amount: '700', paymentMethod: 'bank', paymentSourceId: bankId, date: '2026-04-01' });
    expect(response.status).toBe(200);
    const tooMuch = await agent.post('/api/expenses')
        .send({ title: 'Too much', amount: '9999999', paymentMethod: 'bank', paymentSourceId: bankId, date: '2026-04-01' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toBe('Insufficient bank balance');
});

test('dates that do not exist are refused', async () => {
    const add = await agent.post('/api/income')
        .send({ source: 'Bad date', amount: 10, creditedToType: 'cash', creditedToId: null, date: '2026-02-30' });
    expect(add.status).toBe(400);
    expect(add.body.error).toBe('Invalid date format');

    const expense = await agent.post('/api/expenses')
        .send({ title: 'Bad date', amount: 1, paymentMethod: 'cash', paymentSourceId: null, date: 'not a date' });
    expect(expense.status).toBe(400);
    expect(expense.body.error).toBe('Invalid date format');
});
