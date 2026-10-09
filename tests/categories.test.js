/**
 * Categories and tags (real database, balancetrack_test schema; docs/ledger.md)
 *
 * Each user gets the default categories once; they can rename them, mark spending essential, add
 * their own and remove them, but not the built-in fallbacks. Entries carry a category and tags;
 * titles suggest a category from the user's past choices, then keywords; several entries can be
 * put in a category at once; the summary breaks spending down by category.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'categories_user';
const OTHER = 'categories_other';
const PASSWORD = 'Ledger_Pass9';

const today = new Date();
const MONTH = today.getMonth() + 1;
const YEAR = today.getFullYear();
const DAY = `${YEAR}-${String(MONTH).padStart(2, '0')}-01`;

let agent;
let user;
let bank;
let categories;
const find = name => categories.find(category => category.name === name);

beforeAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(OTHER);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'categories_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'categories_other@example.com' });
    await query('UPDATE users SET created_at = created_at - interval \'40 days\' WHERE id = $1', [user.id]);
    agent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    await agent.post('/api/banks').send({ name: 'Categories Bank', initialBalance: 50000 });
    bank = (await agent.get('/api/accounts')).body.find(account => account.type === 'bank');
});

afterAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(OTHER);
    await closeTarget();
});

const entry = body => agent.post('/api/entries').send({ date: DAY, accountId: bank.id, amount: 100, ...body });

describe('categories', () => {
    test('the defaults are made once, spending first, with the fallbacks last', async () => {
        categories = (await agent.get('/api/categories')).body;
        const again = (await agent.get('/api/categories')).body;
        expect(again).toHaveLength(categories.length);
        const spending = categories.filter(category => category.kind === 'expense');
        const income = categories.filter(category => category.kind === 'income');
        expect(spending).toHaveLength(19);
        expect(income).toHaveLength(11);
        expect(spending[0]).toMatchObject({ name: 'Rent', key: 'rent', essential: true, fallback: false });
        expect(spending.at(-1)).toMatchObject({ name: 'Uncategorised', fallback: true, essential: null });
        expect(income.at(-1)).toMatchObject({ name: 'Other income', fallback: true });
        expect(categories.findIndex(category => category.kind === 'income')).toBe(19);
    });

    test('add, rename, mark essential and remove; the fallbacks cannot change', async () => {
        const pets = await agent.post('/api/categories').send({ kind: 'expense', name: 'Pets', essential: true });
        expect(pets.status).toBe(200);
        expect(pets.body).toMatchObject({ name: 'Pets', essential: true, key: null });
        expect((await agent.post('/api/categories').send({ kind: 'expense', name: 'pets' })).status).toBe(400);
        // The same name for income is fine
        expect((await agent.post('/api/categories').send({ kind: 'income', name: 'Pets' })).status).toBe(200);

        const renamed = await agent.put(`/api/categories/${pets.body.id}`).send({ name: 'Pet care', essential: false });
        expect(renamed.body).toMatchObject({ name: 'Pet care', essential: false });
        expect((await agent.put(`/api/categories/${find('Salary').id}`).send({ essential: true })).status).toBe(400);

        const fallback = find('Uncategorised');
        expect((await agent.put(`/api/categories/${fallback.id}`).send({ name: 'Misc' })).status).toBe(400);
        expect((await agent.delete(`/api/categories/${fallback.id}`)).status).toBe(400);

        expect((await agent.delete(`/api/categories/${pets.body.id}`)).status).toBe(200);
        const names = (await agent.get('/api/categories')).body.map(category => category.name);
        expect(names).not.toContain('Pet care');
    });

    test('another user\'s categories are not theirs to use or change', async () => {
        const otherAgent = request.agent(target());
        await logIn(otherAgent, OTHER, PASSWORD);
        expect((await otherAgent.put(`/api/categories/${find('Rent').id}`).send({ name: 'Mine' })).status).toBe(400);
        const otherBank = (await otherAgent.get('/api/accounts')).body.find(account => account.type === 'cash');
        const used = await otherAgent.post('/api/entries')
            .send({ type: 'expense', description: 'Probe', amount: 1, accountId: otherBank.id, categoryId: find('Rent').id, date: DAY });
        expect(used.status).toBe(400);
        expect(used.body.error).toBe('Category not found');
    });
});

describe('entries with categories and tags', () => {
    test('an entry takes a category of its kind, or the fallback when none is given', async () => {
        const groceries = await entry({ type: 'expense', description: 'BigBasket', categoryId: find('Groceries').id, tags: ['home', 'Home', ' weekly '] });
        expect(groceries.status).toBe(200);
        expect(groceries.body).toMatchObject({ category: { name: 'Groceries' }, tags: ['home', 'weekly'] });

        const plain = await entry({ type: 'expense', description: 'Something' });
        expect(plain.body.category.name).toBe('Uncategorised');
        const wrongKind = await entry({ type: 'expense', description: 'Probe', categoryId: find('Salary').id });
        expect(wrongKind.status).toBe(400);
        expect(wrongKind.body.error).toBe('Choose a spending category for an expense');

        expect((await entry({ type: 'expense', description: 'Probe', tags: 'a,b,c,d,e,f,g,h,i,j,k' })).status).toBe(400);
        expect((await entry({ type: 'expense', description: 'Probe', tags: ['x'.repeat(31)] })).status).toBe(400);
    });

    test('an edit keeps the category and tags it does not mention, and replaces those it does', async () => {
        const created = (await entry({ type: 'expense', description: 'Zomato', categoryId: find('Restaurants and food delivery').id, tags: 'friday' })).body;
        const kept = (await agent.put(`/api/entries/${created.id}`)
            .send({ type: 'expense', description: 'Zomato dinner', amount: 250, accountId: bank.id, date: DAY })).body;
        expect(kept).toMatchObject({ category: { name: 'Restaurants and food delivery' }, tags: ['friday'], amount: '250.00' });
        const changed = (await agent.put(`/api/entries/${kept.id}`)
            .send({ type: 'expense', description: 'Zomato dinner', amount: 250, accountId: bank.id, date: DAY, categoryId: find('Travel').id, tags: [] })).body;
        expect(changed).toMatchObject({ category: { name: 'Travel' }, tags: [] });
    });

    test('a title suggests a category: the user\'s past choice first, then a keyword', async () => {
        const suggest = async (kind, description) => (await agent.get('/api/categories/suggest').query({ kind, description })).body;
        expect(await suggest('expense', 'Uber ride')).toMatchObject({ reason: 'keyword', category: { name: 'Transport' } });
        expect(await suggest('income', 'March salary')).toMatchObject({ reason: 'keyword', category: { name: 'Salary' } });
        expect(await suggest('expense', 'Mystery shop')).toEqual({ category: null, reason: null });

        // BigBasket was put in Groceries above; "bigbasket weekly" starts with the same word
        expect(await suggest('expense', 'bigbasket weekly')).toMatchObject({ reason: 'history', category: { name: 'Groceries' } });
        // The user's own choice beats the keyword: Uber put in Travel once
        await entry({ type: 'expense', description: 'Uber ride', categoryId: find('Travel').id });
        expect(await suggest('expense', 'Uber ride')).toMatchObject({ reason: 'history', category: { name: 'Travel' } });
        expect((await agent.get('/api/categories/suggest').query({ kind: 'gift', description: 'x' })).status).toBe(400);
    });

    test('several entries go into one category at once, including ones from the former routes', async () => {
        const one = (await entry({ type: 'expense', description: 'Bulk one' })).body;
        const two = (await entry({ type: 'expense', description: 'Bulk two', tags: ['keep'] })).body;
        const legacy = await agent.post('/api/expenses')
            .send({ title: 'Bulk legacy', amount: 40, paymentMethod: 'bank', paymentSourceId: bank.sourceId, date: DAY });
        const legacyEntry = (await agent.get(`/api/entries?month=${MONTH}&year=${YEAR}`)).body.find(row => row.description === 'Bulk legacy');

        const result = await agent.post('/api/entries/categorise')
            .send({ entryIds: [one.id, two.id, legacyEntry.id], categoryId: find('Shopping').id });
        expect(result.status).toBe(200);
        expect(result.body).toEqual({ changed: 3 });
        const list = (await agent.get(`/api/entries?month=${MONTH}&year=${YEAR}`)).body;
        for (const description of ['Bulk one', 'Bulk two', 'Bulk legacy']) {
            expect(list.find(row => row.description === description).category.name).toBe('Shopping');
        }
        expect(list.find(row => row.description === 'Bulk two').tags).toEqual(['keep']);
        expect((await query('SELECT id FROM expenses WHERE id = $1', [legacy.body.id])).rows).toEqual([]);
        expect((await query('SELECT count(*)::int AS n FROM ledger_entry_check WHERE user_id = $1', [user.id])).rows[0].n).toBe(0);

        const income = (await entry({ type: 'income', description: 'Bonus' })).body;
        const mixed = await agent.post('/api/entries/categorise').send({ entryIds: [income.id], categoryId: find('Shopping').id });
        expect(mixed.status).toBe(400);
        expect((await agent.post('/api/entries/categorise').send({ entryIds: [], categoryId: find('Shopping').id })).status).toBe(400);
    });
});

describe('the summary', () => {
    test('breaks spending down by category, with essential and discretionary totals', async () => {
        const summary = (await agent.get(`/api/monthly-summary?month=${MONTH}&year=${YEAR}`)).body;
        const names = summary.spendingByCategory.map(item => item.name);
        expect(names).toEqual(expect.arrayContaining(['Groceries', 'Shopping', 'Travel', 'Uncategorised']));
        const total = summary.spendingByCategory.reduce((sum, item) => sum + Number(item.amount), 0);
        expect(total).toBeCloseTo(summary.totalExpenses, 2);
        expect(summary.essentialSpending + summary.discretionarySpending + summary.uncategorisedSpending).toBeCloseTo(summary.totalExpenses, 2);
        expect(summary.spendingByCategory.find(item => item.name === 'Groceries').essential).toBe(true);
        expect(summary.spendingByCategory.find(item => item.name === 'Uncategorised').essential).toBeNull();
        // Largest first
        const amounts = summary.spendingByCategory.map(item => Number(item.amount));
        expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
    });
});
