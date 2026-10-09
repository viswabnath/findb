/**
 * Events and projects (real database, balancetrack_test schema; docs/ledger.md)
 *
 * An event is a purpose any entry can carry. It shows what was spent by category, what was
 * received, the net cost, the budget left, which accounts paid, and a timeline; a one-off event is
 * left out of regular spending in the monthly summary.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'events_user';
const OTHER = 'events_other';
const PASSWORD = 'Ledger_Pass9';

const today = new Date();
const MONTH = today.getMonth() + 1;
const YEAR = today.getFullYear();
const DAY = `${YEAR}-${String(MONTH).padStart(2, '0')}-01`;

let agent;
let user;
let bank;
let card;
let categories;
let wedding;
let trip;
const category = name => categories.find(item => item.name === name).id;
const entry = body => agent.post('/api/entries').send({ date: DAY, accountId: bank.id, ...body });

beforeAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(OTHER);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'events_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'events_other@example.com' });
    await query('UPDATE users SET created_at = created_at - interval \'40 days\' WHERE id = $1', [user.id]);
    agent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    await agent.post('/api/banks').send({ name: 'Events Bank', initialBalance: 500000 });
    await agent.post('/api/credit-cards').send({ name: 'Events Card', creditLimit: 100000 });
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

describe('events', () => {
    test('add events; names are unique, dates must make sense', async () => {
        const created = await agent.post('/api/events').send({ name: 'Sister\'s wedding', startsOn: DAY, budget: 200000 });
        expect(created.status).toBe(200);
        wedding = created.body;
        expect(wedding).toMatchObject({ name: 'Sister\'s wedding', startsOn: DAY, budget: '200000.00', oneOff: true, spent: '0.00', entries: 0 });
        trip = (await agent.post('/api/events').send({ name: 'Goa trip', oneOff: false })).body;
        expect(trip.oneOff).toBe(false);

        expect((await agent.post('/api/events').send({ name: 'sister\'s WEDDING' })).status).toBe(400);
        const backwards = await agent.post('/api/events').send({ name: 'Backwards', startsOn: '2026-05-10', endsOn: '2026-05-01' });
        expect(backwards.body.error).toBe('The end date is before the start date');
        expect((await agent.post('/api/events').send({ name: '' })).status).toBe(400);
        expect((await agent.post('/api/events').send({ name: 'Minus', budget: -1 })).status).toBe(400);
    });

    test('entries carry an event; the event adds up spending, receipts, budget and who paid', async () => {
        const catering = await entry({ type: 'expense', description: 'Catering', amount: 180000, categoryId: category('Restaurants and food delivery'), eventId: wedding.id });
        expect(catering.body.event).toEqual({ id: wedding.id, name: 'Sister\'s wedding' });
        await entry({ type: 'expense', description: 'Clothes', amount: 40000, accountId: card.id, categoryId: category('Shopping'), eventId: wedding.id });
        await entry({ type: 'income', description: 'Gifts at the wedding', amount: 25000, categoryId: category('Gifts received'), eventId: wedding.id });
        await entry({ type: 'expense', description: 'Unrelated', amount: 500 });

        const detail = (await agent.get(`/api/events/${wedding.id}`)).body;
        expect(detail).toMatchObject({ spent: '220000.00', received: '25000.00', netCost: '195000.00', budgetLeft: '-20000.00', entries: 3 });
        expect(detail.spentByCategory).toEqual([
            expect.objectContaining({ name: 'Restaurants and food delivery', amount: '180000.00' }),
            expect.objectContaining({ name: 'Shopping', amount: '40000.00' }),
        ]);
        expect(detail.receivedByCategory).toEqual([expect.objectContaining({ name: 'Gifts received', amount: '25000.00' })]);
        expect(detail.paidFrom).toEqual([
            expect.objectContaining({ name: 'EVENTS BANK', amount: '180000.00' }),
            expect.objectContaining({ name: 'EVENTS CARD', amount: '40000.00' }),
        ]);
        expect(detail.timeline.map(item => item.description).sort()).toEqual(['Catering', 'Clothes', 'Gifts at the wedding']);

        const list = (await agent.get('/api/events')).body;
        expect(list.find(item => item.id === wedding.id).netCost).toBe('195000.00');
    });

    test('an edit keeps the event when it is not mentioned, and clears it with null; bulk categorising keeps it', async () => {
        const created = (await entry({ type: 'expense', description: 'Flowers', amount: 3000, eventId: wedding.id })).body;
        const kept = (await agent.put(`/api/entries/${created.id}`)
            .send({ type: 'expense', description: 'Flowers', amount: 3500, accountId: bank.id, date: DAY })).body;
        expect(kept.event.id).toBe(wedding.id);
        const recategorised = await agent.post('/api/entries/categorise').send({ entryIds: [kept.id], categoryId: category('Gifts') });
        expect(recategorised.body).toEqual({ changed: 1 });
        const afterBulk = (await agent.get(`/api/events/${wedding.id}`)).body.timeline.find(item => item.description === 'Flowers');
        expect(afterBulk.category.name).toBe('Gifts');
        const cleared = (await agent.put(`/api/entries/${afterBulk.id}`)
            .send({ type: 'expense', description: 'Flowers', amount: 3500, accountId: bank.id, date: DAY, eventId: null })).body;
        expect(cleared.event).toBeNull();
    });

    test('one-off events are left out of regular spending; others are not', async () => {
        await entry({ type: 'expense', description: 'Beach shack', amount: 2000, eventId: trip.id });
        const summary = (await agent.get(`/api/monthly-summary?month=${MONTH}&year=${YEAR}`)).body;
        // Wedding spending (one-off) is 220000; the trip (not one-off) and the rest are regular
        expect(summary.oneOffSpending).toBeCloseTo(220000, 2);
        expect(summary.regularSpending).toBeCloseTo(summary.totalExpenses - 220000, 2);
    });

    test('an event can be edited and removed; its entries keep it', async () => {
        const edited = await agent.put(`/api/events/${trip.id}`).send({ budget: 15000, endsOn: DAY });
        expect(edited.body).toMatchObject({ name: 'Goa trip', budget: '15000.00', endsOn: DAY, spent: '2000.00', budgetLeft: '13000.00' });
        expect((await agent.delete(`/api/events/${trip.id}`)).status).toBe(200);
        expect((await agent.get('/api/events')).body.map(item => item.id)).not.toContain(trip.id);
        const shack = (await agent.get(`/api/entries?month=${MONTH}&year=${YEAR}`)).body.find(item => item.description === 'Beach shack');
        expect(shack.event).toEqual({ id: trip.id, name: 'Goa trip' });
        // Editing it without mentioning the event keeps the archived event
        const kept = await agent.put(`/api/entries/${shack.id}`)
            .send({ type: 'expense', description: 'Beach shack', amount: 2100, accountId: bank.id, date: DAY });
        expect(kept.status).toBe(200);
        expect(kept.body.event.id).toBe(trip.id);
        // But it cannot be chosen for a new entry
        expect((await entry({ type: 'expense', description: 'Late', amount: 10, eventId: trip.id })).body.error).toBe('Event not found');
    });

    test('another user\'s events are not theirs to see or use', async () => {
        const otherAgent = request.agent(target());
        await logIn(otherAgent, OTHER, PASSWORD);
        expect((await otherAgent.get('/api/events')).body).toEqual([]);
        expect((await otherAgent.get(`/api/events/${wedding.id}`)).status).toBe(404);
        expect((await otherAgent.put(`/api/events/${wedding.id}`).send({ name: 'Mine' })).status).toBe(400);
        const cash = (await otherAgent.get('/api/accounts')).body.find(account => account.type === 'cash');
        const used = await otherAgent.post('/api/entries')
            .send({ type: 'expense', description: 'Probe', amount: 1, accountId: cash.id, eventId: wedding.id, date: DAY });
        expect(used.body.error).toBe('Event not found');
    });
});
