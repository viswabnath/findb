/**
 * Module switches (real database, balancetrack_test schema; lib/modules.ts)
 *
 * What a user tracks: existing users keep what their former choice meant, a change keeps the former
 * choice in step, and a suggestion is offered until it is accepted or declined.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'modules_user';
const PASSWORD = 'Ledger_Pass9';

let agent;
let user;

beforeAll(async () => {
    await deleteTestUser(USER);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'modules_user@example.com', trackingOption: 'expenses' });
    agent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
});

afterAll(async () => {
    await deleteTestUser(USER);
    await closeTarget();
});

describe('modules', () => {
    test('a user without modules has what their former choice meant', async () => {
        expect((await agent.get('/api/modules')).body).toEqual({ modules: ['spending', 'credit_cards'], declined: [] });
        expect((await agent.get('/api/user')).body.modules).toEqual(['spending', 'credit_cards']);
    });

    test('changing modules keeps the former choice in step and is logged', async () => {
        const saved = await agent.put('/api/modules').send({ modules: ['investments', 'income'] });
        expect(saved.status).toBe(200);
        // Stored in the listed order
        expect(saved.body.modules).toEqual(['income', 'investments']);
        const row = (await query('SELECT modules, tracking_option FROM users WHERE id = $1', [user.id])).rows[0];
        expect(row).toEqual({ modules: ['income', 'investments'], tracking_option: 'income' });
        const log = await query('SELECT entity_type FROM activity_log WHERE user_id = $1 AND entity_type = $2', [user.id, 'modules']);
        expect(log.rows).toHaveLength(1);

        await agent.put('/api/modules').send({ modules: ['income', 'spending', 'credit_cards'] });
        expect((await query('SELECT tracking_option FROM users WHERE id = $1', [user.id])).rows[0].tracking_option).toBe('both');
    });

    test('mistakes are refused', async () => {
        expect((await agent.put('/api/modules').send({ modules: ['goals'] })).body.error).toMatch(/income or spending/);
        expect((await agent.put('/api/modules').send({ modules: ['spending', 'crypto'] })).status).toBe(400);
        expect((await agent.post('/api/modules/suggestion').send({ module: 'crypto', accept: true })).status).toBe(400);
    });

    test('the former tracking route sets the modules it means', async () => {
        expect((await agent.post('/api/set-tracking-option').send({ trackingOption: 'income' })).status).toBe(200);
        expect((await agent.get('/api/modules')).body.modules).toEqual(['income']);
        await agent.post('/api/set-tracking-option').send({ trackingOption: 'both' });
    });

    test('a suggestion is offered until accepted or declined', async () => {
        const suggest = async title => (await agent.get(`/api/modules/suggestion?title=${encodeURIComponent(title)}`)).body.suggestion;
        expect(await suggest('Car loan EMI')).toMatchObject({ key: 'debts', name: 'Debts and people' });
        expect(await suggest('Groceries')).toBeNull();

        const declined = await agent.post('/api/modules/suggestion').send({ module: 'debts', accept: false });
        expect(declined.body.declined).toEqual(['debts']);
        expect(await suggest('Car loan EMI')).toBeNull();

        expect(await suggest('Term insurance premium')).toMatchObject({ key: 'insurance' });
        const accepted = await agent.post('/api/modules/suggestion').send({ module: 'insurance', accept: true });
        expect(accepted.body.modules).toContain('insurance');
        expect(await suggest('Term insurance premium')).toBeNull();
    });
});
