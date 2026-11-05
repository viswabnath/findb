/**
 * Reminders by push notification (real database, balancetrack_test schema;
 * lib/services/reminders.ts, migration 0037)
 *
 * A device turns reminders on; the daily run sends one notification naming what is due today and
 * tomorrow, without amounts, once a day; a subscription the push service says is gone is removed;
 * the daily route refuses anyone but the cron job.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');
const { runReminders } = require('../lib/services/reminders');

const USER = 'remind_user';
const OTHER = 'remind_other';
const PASSWORD = 'Remind_Pass9';

const india = new Date(Date.now() + 330 * 60_000);
const TODAY = india.toISOString().slice(0, 10);
const device = name => ({ endpoint: `https://push.example.com/send/${name}-${Date.now()}`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } });

let agent;
let otherAgent;
let user;
let other;
let phone;

/** A sender that records what it would send; "gone" for the endpoints listed */
function fakeSender(gone = []) {
    const sent = [];
    return { sent, send: async (targetDevice, message) => (gone.includes(targetDevice.endpoint) ? 'gone' : (sent.push({ endpoint: targetDevice.endpoint, message }), 'sent')) };
}

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'remind_user@example.com' });
    other = await createTestUser({ username: OTHER, password: PASSWORD, email: 'remind_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Remind Bank', initialBalance: 50000 })).status).toBe(200);
    const bank = (await agent.get('/api/accounts')).body.find(account => account.type === 'bank');
    // Rent due today, waiting to be confirmed
    expect((await agent.post('/api/recurring').send({
        type: 'expense', description: 'Flat rent', amount: 15000, accountId: bank.id, frequency: 'monthly', dayOfMonth: Number(TODAY.slice(8)), startsOn: TODAY, mode: 'confirm',
    })).status).toBe(200);
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

test('a device turns reminders on; a bad subscription is refused', async () => {
    expect((await agent.get('/api/reminders')).body).toMatchObject({ devices: [] });
    expect((await agent.post('/api/reminders/subscribe').send({ endpoint: 'http://insecure', keys: {} })).body.error)
        .toBe('This browser did not give a usable subscription. Try turning reminders on again.');
    phone = device('phone');
    expect((await agent.post('/api/reminders/subscribe').set('User-Agent', 'Mozilla/5.0 (Linux; Android 14) Chrome/130').send(phone)).status).toBe(200);
    const listed = (await agent.get(`/api/reminders?endpoint=${encodeURIComponent(phone.endpoint)}`)).body.devices;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ current: true });
    expect((await otherAgent.get('/api/reminders')).body.devices).toEqual([]);
});

test('a test notification goes to the user\'s devices', async () => {
    expect((await agent.post('/api/reminders/test')).body).toEqual({ sent: 1 });
    expect((await otherAgent.post('/api/reminders/test')).body.error).toBe('Turn reminders on on this device first.');
});

test('the daily run names what is due, without amounts, once a day', async () => {
    const sender = fakeSender();
    const pool = { query };
    const first = await runReminders(pool, TODAY, sender);
    const mine = sender.sent.filter(item => item.endpoint === phone.endpoint);
    expect(mine).toHaveLength(1);
    expect(mine[0].message).toMatchObject({ title: expect.stringMatching(/^FinDB: \d+ things? to see to$/), url: '/calendar', tag: 'findb-reminder' });
    expect(mine[0].message.body).toContain('Due today: Flat rent');
    expect(mine[0].message.body).not.toMatch(/₹|15,000/);
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    expect((await query('SELECT count(*)::int AS n FROM reminders_sent WHERE user_id = $1 AND sent_on = $2', [user.id, TODAY])).rows[0].n).toBe(1);

    const again = fakeSender();
    await runReminders(pool, TODAY, again);
    expect(again.sent.filter(item => item.endpoint === phone.endpoint)).toHaveLength(0);
});

test('a subscription the push service says is gone is removed', async () => {
    const stale = device('stale');
    expect((await otherAgent.post('/api/reminders/subscribe').send(stale)).status).toBe(200);
    const bank = (await otherAgent.post('/api/banks').send({ name: 'Other Remind Bank', initialBalance: 100 })).body;
    expect(bank).toBeTruthy();
    const otherBank = (await otherAgent.get('/api/accounts')).body.find(account => account.type === 'bank');
    expect((await otherAgent.post('/api/recurring').send({
        type: 'expense', description: 'Gym', amount: 50, accountId: otherBank.id, frequency: 'monthly', dayOfMonth: Number(TODAY.slice(8)), startsOn: TODAY, mode: 'confirm',
    })).status).toBe(200);
    await runReminders({ query }, TODAY, fakeSender([stale.endpoint]));
    expect((await query('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [other.id])).rows[0].n).toBe(0);
});

test('a browser signed in as someone else hands its subscription over; turning off removes it', async () => {
    expect((await otherAgent.post('/api/reminders/subscribe').send(phone)).status).toBe(200);
    expect((await agent.get('/api/reminders')).body.devices).toEqual([]);
    expect((await otherAgent.get('/api/reminders')).body.devices).toHaveLength(1);
    expect((await otherAgent.post('/api/reminders/unsubscribe').send({ endpoint: phone.endpoint })).status).toBe(200);
    expect((await otherAgent.get('/api/reminders')).body.devices).toEqual([]);
});

test('the daily route refuses anyone but the cron job', async () => {
    expect((await request(target()).get('/api/cron/reminders')).status).toBe(401);
    expect((await request(target()).get('/api/cron/reminders').set('Authorization', 'Bearer guess')).status).toBe(401);
});
