/**
 * Entries added offline (real database, balancetrack_test schema; migration 0036)
 *
 * The phone sends an entry with its own reference; sending it again (the first answer lost) gives
 * back the same entry, never a second one. References are per user.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'offline_user';
const OTHER = 'offline_other';
const PASSWORD = 'Offline_Pass9';
const REF = '3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b';

let agent;
let otherAgent;
let user;

const bankOf = async as => (await as.get('/api/accounts')).body.find(account => account.type === 'bank');
const entry = (bank, ref) => ({ type: 'expense', description: 'Chai', amount: 20, accountId: bank.id, date: '2026-10-29', clientRef: ref });

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'offline_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'offline_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    for (const as of [agent, otherAgent]) expect((await as.post('/api/banks').send({ name: 'Offline Bank', initialBalance: 1000 })).status).toBe(200);
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

test('the same entry sent twice is made once', async () => {
    const bank = await bankOf(agent);
    const first = await agent.post('/api/entries').send(entry(bank, REF));
    expect(first.status).toBe(200);
    const again = await agent.post('/api/entries').send(entry(bank, REF));
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    const made = await query('SELECT count(*)::int AS n FROM journal_entries WHERE user_id = $1 AND client_ref = $2', [user.id, REF]);
    expect(made.rows[0].n).toBe(1);
    expect((await bankOf(agent)).balance).toBe('980.00');
});

test('references are per user, and must look like one', async () => {
    const bank = await bankOf(otherAgent);
    expect((await otherAgent.post('/api/entries').send(entry(bank, REF))).status).toBe(200);
    expect((await bankOf(otherAgent)).balance).toBe('980.00');
    expect((await otherAgent.post('/api/entries').send(entry(bank, 'bad ref!'))).body.error).toBe('The entry\'s reference is not valid');
});

test('signed-in users get their own id, for the offline queue', async () => {
    expect((await agent.get('/api/user')).body.id).toBe(user.id);
});
