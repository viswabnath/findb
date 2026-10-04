/**
 * Security tests (real database, balancetrack_test schema; docs/security.md)
 *
 * Two-factor login is required: a password alone opens nothing, a new account is signed in only
 * once its authenticator app is confirmed, codes cannot be reused, wrong codes are limited, and
 * recovery codes work once each. The session list signs devices out, and the login history
 * records what happened. Secrets are stored encrypted.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const {
    createTestUser, currentTotpCode, deleteTestUser, enableTestTwoFactor, logIn, query, TEST_TOTP_SECRET,
} = require('../test-helpers');

const NEW_USER = 'security_new';
const USER = 'security_user';
const PLAIN = 'security_plain';
const PASSWORD = 'Ledger_Pass9';

const cookiesOf = response => String(response.headers['set-cookie'] || '');

beforeAll(async () => {
    for (const name of [NEW_USER, USER, PLAIN, 'security_phrase']) await deleteTestUser(name);
    await createTestUser({ username: USER, password: PASSWORD, email: 'security_user@example.com' });
    // An account from before two-factor login: it is asked to set it up at its next login
    await createTestUser({ username: PLAIN, password: PASSWORD, email: 'security_plain@example.com', twoFactor: false });
});

afterAll(async () => {
    for (const name of [NEW_USER, USER, PLAIN, 'security_phrase']) await deleteTestUser(name);
    await closeTarget();
});

describe('a new account sets up two-factor login before it is signed in', () => {
    const agent = request.agent(target());
    let secret;

    test('registering starts a pending login, which opens nothing', async () => {
        const response = await agent.post('/api/register').send({
            username: NEW_USER, password: PASSWORD, name: 'New User', email: 'security_new@example.com',
            securityQuestion: 'pet', securityAnswer: 'rex', acceptPrivacyNotice: true,
        });
        expect(response.status).toBe(200);
        expect(response.body.twoFactor).toBe('setup');
        expect(cookiesOf(response)).toContain('findb_login=');
        expect(cookiesOf(response)).not.toContain('sessionId=');
        expect((await agent.get('/api/user')).status).toBe(401);
        // A pending setup cannot skip ahead to the code step
        expect((await agent.post('/api/login/two-factor').send({ code: '123456' })).status).toBe(401);
    });

    test('the setup shows the same secret until it is confirmed, and stores it encrypted', async () => {
        const first = await agent.get('/api/two-factor/setup');
        expect(first.status).toBe(200);
        expect(first.body.secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(first.body.otpauthUri).toContain(`secret=${first.body.secret}`);
        expect(first.body.otpauthUri).toContain('issuer=FinDB');
        secret = first.body.secret;
        expect((await agent.get('/api/two-factor/setup')).body.secret).toBe(secret);

        const stored = await query('SELECT totp_pending_secret_enc FROM users WHERE username = $1', [NEW_USER]);
        expect(stored.rows[0].totp_pending_secret_enc).toMatch(/^v\d+\./);
        expect(stored.rows[0].totp_pending_secret_enc).not.toContain(secret);
    });

    test('a wrong code does not turn it on', async () => {
        const wrong = String((Number(currentTotpCode(secret)) + 1) % 1000000).padStart(6, '0');
        const response = await agent.post('/api/two-factor/setup').send({ code: wrong });
        expect(response.status).toBe(400);
        expect((await agent.get('/api/user')).status).toBe(401);
    });

    test('the right code turns it on, returns ten recovery codes once, and signs in', async () => {
        const response = await agent.post('/api/two-factor/setup').send({ code: currentTotpCode(secret) });
        expect(response.status).toBe(200);
        expect(response.body.recoveryCodes).toHaveLength(10);
        for (const code of response.body.recoveryCodes) expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
        expect(cookiesOf(response)).toContain('sessionId=');
        expect((await agent.get('/api/user')).status).toBe(200);

        const stored = await query(
            'SELECT totp_secret_enc, totp_pending_secret_enc, (SELECT count(*)::int FROM recovery_codes r WHERE r.user_id = u.id) AS codes FROM users u WHERE username = $1',
            [NEW_USER]);
        expect(stored.rows[0].totp_pending_secret_enc).toBeNull();
        expect(stored.rows[0].totp_secret_enc).toMatch(/^v\d+\./);
        expect(stored.rows[0].codes).toBe(10);
        // Only hashes of the recovery codes are kept
        const hashes = await query('SELECT code_hash FROM recovery_codes r JOIN users u ON u.id = r.user_id WHERE u.username = $1', [NEW_USER]);
        expect(hashes.rows.map(row => row.code_hash)).not.toContain(response.body.recoveryCodes[0]);
    });
});

describe('logging in', () => {
    test('an account without two-factor login is asked to set it up', async () => {
        const response = await request(target()).post('/api/login').send({ username: PLAIN, password: PASSWORD });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true, twoFactor: 'setup' });
    });

    test('the code finishes the login; the same code cannot be used again', async () => {
        await query('UPDATE users SET totp_last_step = NULL WHERE username = $1', [USER]);
        const code = currentTotpCode();
        const first = request.agent(target());
        expect((await first.post('/api/login').send({ username: USER, password: PASSWORD })).status).toBe(200);
        expect((await first.post('/api/login/two-factor').send({ code })).status).toBe(200);
        expect((await first.get('/api/user')).status).toBe(200);

        const second = request.agent(target());
        expect((await second.post('/api/login').send({ username: USER, password: PASSWORD })).status).toBe(200);
        const replay = await second.post('/api/login/two-factor').send({ code });
        expect(replay.status).toBe(400);
        expect((await second.get('/api/user')).status).toBe(401);
    });

    test('a recovery code works once', async () => {
        const agent = request.agent(target());
        expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
        expect((await agent.post('/api/login/two-factor').send({ code: '000000' })).status).toBe(401);
        await query('UPDATE users SET totp_last_step = NULL WHERE username = $1', [USER]);
        const made = await agent.post('/api/two-factor/recovery-codes').send({ code: currentTotpCode() });
        expect(made.status).toBe(200);
        const [recoveryCode] = made.body.recoveryCodes;

        const withCode = request.agent(target());
        await withCode.post('/api/login').send({ username: USER, password: PASSWORD });
        const used = await withCode.post('/api/login/two-factor').send({ recoveryCode: recoveryCode.toUpperCase() });
        expect(used.status).toBe(200);
        expect((await withCode.get('/api/user')).status).toBe(200);

        const again = request.agent(target());
        await again.post('/api/login').send({ username: USER, password: PASSWORD });
        expect((await again.post('/api/login/two-factor').send({ recoveryCode })).status).toBe(400);

        const status = await withCode.get('/api/two-factor');
        expect(status.body.recoveryCodesLeft).toBe(9);
    });

    test('after five wrong codes, codes are refused for a while, even the right one', async () => {
        const clearWrongCodes = () => query(
            'DELETE FROM login_events WHERE event = \'wrong_code\' AND user_id = (SELECT id FROM users WHERE username = $1)', [USER]);
        // Earlier tests here entered wrong codes too; count from zero
        await clearWrongCodes();
        try {
            const agent = request.agent(target());
            await agent.post('/api/login').send({ username: USER, password: PASSWORD });
            const wrong = String((Number(currentTotpCode()) + 500000) % 1000000).padStart(6, '0');
            for (let i = 0; i < 5; i++) expect((await agent.post('/api/login/two-factor').send({ code: wrong })).status).toBe(400);
            await query('UPDATE users SET totp_last_step = NULL WHERE username = $1', [USER]);
            const locked = await agent.post('/api/login/two-factor').send({ code: currentTotpCode() });
            expect(locked.status).toBe(429);
            expect(locked.body.error).toMatch(/Too many wrong codes/);
        } finally {
            await clearWrongCodes();
        }
    });

    test('the secret every test user has is stored encrypted, never as text', async () => {
        const stored = await query('SELECT totp_secret_enc FROM users WHERE username = $1', [USER]);
        expect(stored.rows[0].totp_secret_enc).not.toContain(TEST_TOTP_SECRET);
    });
});

describe('sessions and login history', () => {
    test('the list shows each signed-in device; one can be signed out', async () => {
        await query('DELETE FROM session WHERE sess->>\'userId\' = (SELECT id::text FROM users WHERE username = $1)', [USER]);
        const laptop = request.agent(target());
        const phone = request.agent(target());
        await logIn(laptop, USER, PASSWORD);
        await logIn(phone, USER, PASSWORD);

        const list = await laptop.get('/api/sessions');
        expect(list.status).toBe(200);
        expect(list.body).toHaveLength(2);
        expect(list.body.filter(session => session.current)).toHaveLength(1);
        // Session ids as shown are not the real ones
        const real = await query('SELECT sid FROM session WHERE sess->>\'userId\' = (SELECT id::text FROM users WHERE username = $1)', [USER]);
        for (const session of list.body) expect(real.rows.map(row => row.sid)).not.toContain(session.id);

        const other = list.body.find(session => !session.current);
        expect((await laptop.delete(`/api/sessions/${other.id}`)).status).toBe(200);
        expect((await phone.get('/api/user')).status).toBe(401);
        expect((await laptop.get('/api/user')).status).toBe(200);
        expect((await laptop.delete('/api/sessions/not-a-session')).status).toBe(404);
    });

    test('sign out everywhere ends every session, this one included', async () => {
        const laptop = request.agent(target());
        const phone = request.agent(target());
        await logIn(laptop, USER, PASSWORD);
        await logIn(phone, USER, PASSWORD);
        const response = await phone.delete('/api/sessions');
        expect(response.status).toBe(200);
        expect((await laptop.get('/api/user')).status).toBe(401);
        expect((await phone.get('/api/user')).status).toBe(401);
    });

    test('the login history records logins, wrong passwords and sign-outs', async () => {
        await request(target()).post('/api/login').send({ username: USER, password: 'Wrong_Pass99' });
        const agent = request.agent(target());
        await logIn(agent, USER, PASSWORD);
        const history = await agent.get('/api/login-history');
        expect(history.status).toBe(200);
        const events = history.body.map(item => item.event);
        expect(events[0]).toBe('signed_in');
        for (const event of ['wrong_password', 'signed_out_everywhere', 'signed_out_session', 'recovery_code_used']) {
            expect(events).toContain(event);
        }
    });

    test('a user sees only their own sessions and history', async () => {
        // Signed in with the shared test secret instead of the one it set up
        const id = await query('SELECT id FROM users WHERE username = $1', [NEW_USER]);
        await enableTestTwoFactor(id.rows[0].id);
        const agent = request.agent(target());
        expect((await logIn(agent, NEW_USER, PASSWORD)).status).toBe(200);
        const sessions = (await agent.get('/api/sessions')).body;
        const mine = await query('SELECT count(*)::int AS n FROM session WHERE sess->>\'userId\' = (SELECT id::text FROM users WHERE username = $1)', [NEW_USER]);
        expect(sessions).toHaveLength(mine.rows[0].n);
        const history = (await agent.get('/api/login-history')).body;
        expect(history.map(item => item.event)).not.toContain('wrong_password');
    });
});

describe('passwords', () => {
    const base = { name: 'Phrase User', securityQuestion: 'pet', securityAnswer: 'rex', acceptPrivacyNotice: true };

    test('a passphrase of plain words, 16 characters or more, is accepted', async () => {
        const response = await request(target()).post('/api/register')
            .send({ ...base, username: 'security_phrase', email: 'security_phrase@example.com', password: 'mango river quietly bicycle' });
        expect(response.status).toBe(200);
    });

    test('a password containing the username, or a common one, is refused', async () => {
        const withName = await request(target()).post('/api/register')
            .send({ ...base, username: 'security_named', email: 'security_named@example.com', password: 'Security_named9!' });
        expect(withName.status).toBe(400);
        expect(withName.body.error).toBe('Password must not contain your username');

        const common = await request(target()).post('/api/register')
            .send({ ...base, username: 'security_common', email: 'security_common@example.com', password: 'Welcome@123' });
        expect(common.status).toBe(400);
        expect(common.body.error).toBe('This password is too common. Choose another.');
    });
});
