/**
 * Search across everything (real database, balancetrack_test schema; lib/services/search.ts)
 *
 * Words match an entry's description, category, accounts, tags and event, or its amount; filters
 * narrow by date, amount, type, account, category, tag and event; the totals cover every match.
 * Saved searches keep the filters by name. Another user finds nothing of it.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn } = require('../test-helpers');

const USER = 'search_user';
const OTHER = 'search_other';
const PASSWORD = 'Search_Pass9';
const YEAR = new Date().getFullYear() - 1;

let agent;
let otherAgent;
let bank;
let cash;
let categories;
let goa;

const find = async query => agent.get(`/api/search?${new URLSearchParams(query)}`);
const descriptions = response => response.body.entries.map(entry => entry.description);

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await createTestUser({ username: USER, password: PASSWORD, email: 'search_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'search_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Search Bank', initialBalance: 100000 })).status).toBe(200);
    const accounts = (await agent.get('/api/accounts')).body;
    bank = accounts.find(account => account.type === 'bank');
    cash = accounts.find(account => account.type === 'cash');
    categories = (await agent.get('/api/categories')).body;
    const category = name => categories.find(item => item.name === name).id;
    goa = (await agent.post('/api/events').send({ name: 'Goa trip' })).body;
    const saved = await agent.post('/api/entries/bulk').send({ entries: [
        { type: 'expense', date: `${YEAR}-03-02`, description: 'Swiggy biryani', amount: '450', accountId: bank.id, categoryId: category('Restaurants and food delivery') },
        { type: 'expense', date: `${YEAR}-03-09`, description: 'Swiggy pizza', amount: '620.50', accountId: bank.id, categoryId: category('Restaurants and food delivery'), tags: 'weekend' },
        { type: 'expense', date: `${YEAR}-04-01`, description: 'Rent April', amount: '22000', accountId: bank.id, categoryId: category('Rent') },
        { type: 'expense', date: `${YEAR}-05-10`, description: 'Beach shack', amount: '1800', accountId: bank.id, categoryId: category('Restaurants and food delivery'), eventId: goa.id },
        { type: 'income', date: `${YEAR}-04-30`, description: 'Salary April', amount: '85000', accountId: bank.id, categoryId: category('Salary') },
        { type: 'transfer', date: `${YEAR}-04-15`, description: 'ATM', amount: '2000', accountId: bank.id, toAccountId: cash.id },
    ] });
    expect(saved.status).toBe(200);
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

describe('search', () => {
    test('words match descriptions, newest first, with totals', async () => {
        const response = await find({ q: 'swiggy' });
        expect(response.status).toBe(200);
        expect(descriptions(response)).toEqual(['Swiggy pizza', 'Swiggy biryani']);
        expect(response.body).toMatchObject({ total: 2, totals: { expense: '1070.50', income: '0.00', transfer: '0.00' }, more: false });
    });

    test('every word must match, in the description, category, account, tag or event', async () => {
        expect(descriptions(await find({ q: 'swiggy weekend' }))).toEqual(['Swiggy pizza']);
        expect(descriptions(await find({ q: 'goa' }))).toEqual(['Beach shack']);
        expect(descriptions(await find({ q: 'restaurants shack' }))).toEqual(['Beach shack']);
        expect((await find({ q: 'search bank' })).body.total).toBe(6);
        expect((await find({ q: 'nothing-like-this' })).body.total).toBe(0);
    });

    test('a number matches the amount, with Indian commas', async () => {
        expect(descriptions(await find({ q: '22,000' }))).toEqual(['Rent April']);
        expect(descriptions(await find({ q: '₹450' }))).toEqual(['Swiggy biryani']);
    });

    test('names matching the words are offered as filters', async () => {
        const response = await find({ q: 'goa' });
        expect(response.body.events).toEqual([{ id: goa.id, name: 'Goa trip' }]);
        const rent = (await find({ q: 'rent' })).body;
        expect(rent.categories.map(item => item.name)).toContain('Rent');
    });

    test('filters: dates, amounts, type, account, category, tag and event', async () => {
        expect(descriptions(await find({ from: `${YEAR}-04-01`, to: `${YEAR}-04-30`, type: 'expense' }))).toEqual(['Rent April']);
        expect(descriptions(await find({ min: '600', max: '2000', type: 'expense' }))).toEqual(['Beach shack', 'Swiggy pizza']);
        expect(descriptions(await find({ accountId: cash.id }))).toEqual(['ATM']);
        const rent = categories.find(item => item.name === 'Rent').id;
        expect(descriptions(await find({ categoryId: rent }))).toEqual(['Rent April']);
        expect(descriptions(await find({ tag: 'WEEKEND' }))).toEqual(['Swiggy pizza']);
        expect(descriptions(await find({ eventId: goa.id }))).toEqual(['Beach shack']);
        const year = (await find({ from: `${YEAR}-01-01`, to: `${YEAR}-12-31` })).body;
        expect(year.totals).toEqual({ expense: '24870.50', income: '85000.00', transfer: '2000.00' });
    });

    test('wildcards are taken literally, and bad filters are refused', async () => {
        expect((await find({ q: '%' })).body.total).toBe(0);
        expect((await find({ q: '_' })).body.total).toBe(0);
        expect((await find({ from: 'yesterday' })).body.error).toBe('A date in the search is not valid');
        expect((await find({ min: '-5' })).body.error).toBe('An amount in the search is not valid');
        expect((await find({ type: 'loan' })).status).toBe(400);
        expect((await find({ accountId: 'x' })).body.error).toBe('A filter in the search is not valid');
        expect((await find({ q: 'x'.repeat(101) })).body.error).toBe('Search for at most 100 characters');
    });

    test('another user finds nothing of it', async () => {
        expect((await otherAgent.get('/api/search?q=swiggy')).body.total).toBe(0);
        expect((await otherAgent.get(`/api/search?accountId=${bank.id}`)).body.total).toBe(0);
    });
});

describe('saved searches', () => {
    let saved;

    test('a search is kept by name; the same name replaces it', async () => {
        const first = await agent.post('/api/searches').send({ name: 'Eating out', filters: { q: 'swiggy', min: '' } });
        expect(first.status).toBe(200);
        expect(first.body).toMatchObject({ name: 'Eating out', filters: { q: 'swiggy' } });
        const again = await agent.post('/api/searches').send({ name: 'eating out', filters: { q: 'swiggy', min: '500' } });
        expect(again.body).toMatchObject({ id: first.body.id, filters: { q: 'swiggy', min: '500.00' } });
        saved = again.body;
        expect((await agent.get('/api/searches')).body).toEqual([saved]);
    });

    test('refuses an empty search or name, and other users cannot see or remove it', async () => {
        expect((await agent.post('/api/searches').send({ name: 'Nothing', filters: {} })).body.error).toBe('Search for something before saving it');
        expect((await agent.post('/api/searches').send({ name: ' ', filters: { q: 'x' } })).body.error).toBe('Give the search a name');
        expect((await otherAgent.get('/api/searches')).body).toEqual([]);
        expect((await otherAgent.delete(`/api/searches/${saved.id}`)).status).toBe(404);
    });

    test('removed', async () => {
        expect((await agent.delete(`/api/searches/${saved.id}`)).status).toBe(200);
        expect((await agent.get('/api/searches')).body).toEqual([]);
        expect((await agent.delete(`/api/searches/${saved.id}`)).status).toBe(404);
    });
});
