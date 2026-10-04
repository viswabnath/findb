/**
 * Account recovery tests (real database, balancetrack_test schema)
 *
 * Recovery must not reveal whether an account exists, must not accept a bare user id, must
 * pause after repeated wrong answers, and a password reset must sign the account out everywhere.
 * @jest-environment node
 */

const request = require('supertest');


const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, query, logIn } = require('../test-helpers');

const USER = {
    username: 'recovery_user',
    password: 'TestPass123&',
    email: 'recovery_user@example.com',
    securityQuestion: 'school',
    securityAnswer: 'greenwood',
};
const LOCK_USER = { ...USER, username: 'recovery_lock_user', email: 'recovery_lock@example.com' };
const UNKNOWN_EMAIL = 'nobody-recovery@example.com';
const QUESTIONS = ['pet', 'school', 'city', 'mother', 'car', 'street'];
const FAILED = /^Security answer could not be verified/;

let userId;

async function recoveryEvents(id, actionType) {
    const result = await query('SELECT COUNT(*)::int AS n FROM activity_log WHERE user_id = $1 AND action_type = $2', [id, actionType]);
    return result.rows[0].n;
}

beforeAll(async () => {
    await deleteTestUser(USER.username);
    await deleteTestUser(LOCK_USER.username);
    userId = (await createTestUser(USER)).id;
    await createTestUser(LOCK_USER);
});

afterAll(async () => {
    await deleteTestUser(USER.username);
    await deleteTestUser(LOCK_USER.username);
    await closeTarget();
});

describe('nothing reveals whether an account exists', () => {
    test('forgot-password answers a known and an unknown account the same way', async () => {
        const known = await request(target()).post('/api/forgot-password').send({ email: USER.email });
        const unknown = await request(target()).post('/api/forgot-password').send({ email: UNKNOWN_EMAIL });

        expect(known.status).toBe(200);
        expect(unknown.status).toBe(200);
        expect(Object.keys(known.body).sort()).toEqual(['securityQuestion', 'success']);
        expect(Object.keys(unknown.body).sort()).toEqual(['securityQuestion', 'success']);
        expect(known.body.securityQuestion).toBe('school');
        expect(QUESTIONS).toContain(unknown.body.securityQuestion);
    });

    test('an unknown account gets the same made-up question every time', async () => {
        const first = await request(target()).post('/api/forgot-password').send({ username: 'no_such_user_xyz' });
        const second = await request(target()).post('/api/forgot-password').send({ username: 'no_such_user_xyz' });
        expect(second.body.securityQuestion).toBe(first.body.securityQuestion);
    });

    test('forgot-username returns a question, never the username, for an email alone', async () => {
        const known = await request(target()).post('/api/forgot-username').send({ email: USER.email });
        const unknown = await request(target()).post('/api/forgot-username').send({ email: UNKNOWN_EMAIL });
        expect(known.body).toEqual({ success: true, securityQuestion: 'school' });
        expect(Object.keys(unknown.body).sort()).toEqual(['securityQuestion', 'success']);
        expect(JSON.stringify(known.body)).not.toContain(USER.username);
    });

    test('a wrong answer and an unknown account get the same error', async () => {
        const wrong = await request(target()).post('/api/forgot-username').send({ email: USER.email, securityAnswer: 'nope' });
        const unknown = await request(target()).post('/api/forgot-username').send({ email: UNKNOWN_EMAIL, securityAnswer: 'nope' });
        expect(wrong.status).toBe(400);
        expect(unknown.status).toBe(400);
        expect(wrong.body.error).toMatch(FAILED);
        expect(unknown.body).toEqual(wrong.body);
    });

    test('format errors are still reported', async () => {
        const email = await request(target()).post('/api/forgot-password').send({ email: 'not-an-email' });
        const username = await request(target()).post('/api/forgot-password').send({ username: 'bad name!' });
        const missing = await request(target()).post('/api/forgot-username').send({});
        expect(email.body.error).toBe('Invalid email format');
        expect(username.body.error).toMatch(/^Invalid username format/);
        expect(missing.body.error).toBe('Email is required');
    });
});

describe('forgot username', () => {
    test('the right answer returns the username (case and spaces in the answer ignored)', async () => {
        const response = await request(target()).post('/api/forgot-username').send({ email: USER.email, securityAnswer: '  GreenWood ' });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true, username: USER.username });
    });
});

describe('password reset', () => {
    test('a user id alone is refused', async () => {
        const response = await request(target()).post('/api/reset-password')
            .send({ userId, securityAnswer: USER.securityAnswer, newPassword: 'NewPass123&' });
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Username or email is required');
    });

    test('a wrong answer is refused and recorded in the activity log', async () => {
        const before = await recoveryEvents(userId, 'recovery_failed');
        const response = await request(target()).post('/api/reset-password')
            .send({ username: USER.username, securityAnswer: 'wrong', newPassword: 'NewPass123&' });
        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(FAILED);
        expect(await recoveryEvents(userId, 'recovery_failed')).toBe(before + 1);
    });

    test('a reset changes the password, signs out every session, and is logged', async () => {
        const session = request.agent(target());
        const login = await logIn(session, USER.username, USER.password);
        expect(login.status).toBe(200);
        expect((await session.get('/api/banks')).status).toBe(200);

        const newPassword = 'NewPass123&';
        const reset = await request(target()).post('/api/reset-password')
            .send({ email: USER.email, securityAnswer: USER.securityAnswer, newPassword });
        expect(reset.status).toBe(200);
        expect(reset.body.success).toBe(true);

        expect((await session.get('/api/banks')).status).toBe(401);
        expect((await request(target()).post('/api/login').send({ username: USER.username, password: USER.password })).status).toBe(400);
        expect((await request(target()).post('/api/login').send({ username: USER.username, password: newPassword })).status).toBe(200);
        expect(await recoveryEvents(userId, 'password_reset')).toBe(1);
    });
});

describe('repeated wrong answers pause recovery', () => {
    test('after 5 wrong answers even the right one is refused, with the same message', async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
            const wrong = await request(target()).post('/api/forgot-username').send({ email: LOCK_USER.email, securityAnswer: `wrong${attempt}` });
            expect(wrong.status).toBe(400);
        }
        const right = await request(target()).post('/api/forgot-username')
            .send({ email: LOCK_USER.email, securityAnswer: LOCK_USER.securityAnswer });
        expect(right.status).toBe(400);
        expect(right.body.error).toMatch(FAILED);

        const reset = await request(target()).post('/api/reset-password')
            .send({ email: LOCK_USER.email, securityAnswer: LOCK_USER.securityAnswer, newPassword: 'NewPass123&' });
        expect(reset.status).toBe(400);
        expect(reset.body.error).toMatch(FAILED);
    });
});
