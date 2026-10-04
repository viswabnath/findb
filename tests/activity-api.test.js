/**
 * Activity API tests (real database, balancetrack_test schema): paging counts that follow the
 * filters, safe page and limit values, and a CSV export that spreadsheets cannot run as formulas.
 * @jest-environment node
 */

const request = require('supertest');


const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, query, logIn } = require('../test-helpers');

const USERNAME = 'activity_api_user';
const OTHER_USERNAME = 'activity_api_other';
const PASSWORD = 'TestPass123&';
let agent;

beforeAll(async () => {
    await deleteTestUser(USERNAME);
    await deleteTestUser(OTHER_USERNAME);
    await createTestUser({ username: USERNAME, password: PASSWORD, email: 'activity_api@example.com' });
    agent = request.agent(target());
    expect((await logIn(agent, USERNAME, PASSWORD)).status).toBe(200);

    const bank = await agent.post('/api/banks').send({ name: '=SUM(1,2)', initialBalance: 100 });
    expect(bank.status).toBe(200);
    for (const source of ['say "hi"', 'Plain', 'Third']) {
        const income = await agent.post('/api/income')
            .send({ source, amount: 5, creditedToType: 'bank', creditedToId: bank.body.id, date: '2026-01-15' });
        expect(income.status).toBe(200);
    }
});

afterAll(async () => {
    await deleteTestUser(USERNAME);
    await deleteTestUser(OTHER_USERNAME);
    await closeTarget();
});

test('the total and page count follow the filters', async () => {
    const all = await agent.get('/api/activity?limit=2');
    expect(all.body.totalItems).toBe(4);
    expect(all.body.totalPages).toBe(2);
    expect(all.body.activities).toHaveLength(2);

    const lastYear = new Date().getFullYear() - 1;
    const filtered = await agent.get(`/api/activity?year=${lastYear}&limit=2`);
    expect(filtered.body.activities).toHaveLength(0);
    expect(filtered.body.totalItems).toBe(0);
    expect(filtered.body.totalPages).toBe(0);

    const banksOnly = await agent.get('/api/activity?type=bank');
    expect(banksOnly.body.totalItems).toBe(1);
});

test('bad page and limit values fall back to defaults instead of failing', async () => {
    const response = await agent.get('/api/activity?page=abc&limit=xyz');
    expect(response.status).toBe(200);
    expect(response.body.currentPage).toBe(1);
    expect(response.body.limit).toBe(20);

    const capped = await agent.get('/api/activity?limit=100000&page=-3');
    expect(capped.status).toBe(200);
    expect(capped.body.limit).toBe(100);
    expect(capped.body.currentPage).toBe(1);
});

test('the CSV export quotes every field and neutralizes formulas', async () => {
    const response = await agent.get('/api/activity?export=true');
    expect(response.status).toBe(200);
    const lines = response.text.split('\n');
    expect(lines[0]).toBe('Date,Type,Description,Amount,Account');
    // Quotes in a description are doubled inside a quoted field
    expect(response.text).toContain('"Added income: say ""hi"""');
    // An account named like a formula is prefixed so spreadsheets show it as text
    expect(response.text).toContain('"\'=SUM(1,2)"');
    expect(response.text).not.toMatch(/(^|,)"?=SUM/m);
    for (const line of lines.slice(1)) {
        expect(line).toMatch(/^"[^"]*","[^"]*",".*","[0-9.]+","[^"]*"$/);
    }
});

test('the feed never shows another user\'s account name', async () => {
    // Another user's bank, whose id this user then sends with an income entry
    const other = request.agent(target());
    await createTestUser({ username: OTHER_USERNAME, password: PASSWORD, email: 'activity_api_other@example.com' });
    expect((await logIn(other, OTHER_USERNAME, PASSWORD)).status).toBe(200);
    const secretBank = await other.post('/api/banks').send({ name: 'Secret Bank Name', initialBalance: 100 });
    expect(secretBank.status).toBe(200);

    // The API now refuses another user's account (tests/account-ownership.test.js), so write the
    // kind of entry an edit used to record straight into the log: the feed must still not resolve it
    const me = await query('SELECT id FROM users WHERE username = $1', [USERNAME]);
    await query(
        `INSERT INTO activity_log (user_id, action_type, entity_type, entity_id, description, amount, new_values)
         VALUES ($1, 'updated', 'income', 0, 'Updated income: Probe', 1, $2)`,
        [me.rows[0].id, JSON.stringify({ source: 'Probe', creditedToType: 'bank', creditedToId: secretBank.body.id })],
    );
    const feed = await agent.get('/api/activity?limit=100');
    expect(feed.status).toBe(200);
    expect(JSON.stringify(feed.body)).not.toContain('SECRET BANK NAME');
    const csv = await agent.get('/api/activity?export=true');
    expect(csv.text).not.toContain('SECRET BANK NAME');
});
