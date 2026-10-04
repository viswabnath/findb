/**
 * Privacy tests (real database, balancetrack_test schema; docs/privacy.md)
 *
 * An account cannot be created without accepting the privacy notice, and the consent is recorded
 * with the notice's version. An account from before the notice is asked once; withdrawing consent
 * signs out everywhere and asks again. The user sees what FinDB holds about them, and the data
 * inventory names exactly the tables in the database.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestBank, createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');
const { PRIVACY_NOTICE_VERSION } = require('../lib/privacy-notice.ts');
const { DATA_INVENTORY } = require('../lib/data-inventory.ts');

const NEW_USER = 'privacy_new';
const OLD_USER = 'privacy_old';
const PASSWORD = 'Ledger_Pass9';

const registration = extra => ({
    username: NEW_USER, password: PASSWORD, name: 'Privacy User', email: 'privacy_new@example.com',
    securityQuestion: 'pet', securityAnswer: 'rex', ...extra,
});

let oldUser;

beforeAll(async () => {
    await deleteTestUser(NEW_USER);
    await deleteTestUser(OLD_USER);
    // An account from before the notice: created directly, so no consent is on record
    oldUser = await createTestUser({ username: OLD_USER, password: PASSWORD, email: 'privacy_old@example.com' });
    await createTestBank(oldUser.id, { name: 'OLD BANK', balance: 50 });
});

afterAll(async () => {
    await deleteTestUser(NEW_USER);
    await deleteTestUser(OLD_USER);
    await closeTarget();
});

describe('consent at sign-up', () => {
    test('an account cannot be created without accepting the privacy notice', async () => {
        for (const acceptPrivacyNotice of [undefined, false, 'yes']) {
            const response = await request(target()).post('/api/register').send(registration({ acceptPrivacyNotice }));
            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Please read and accept the privacy notice to create an account');
        }
        const users = await query('SELECT id FROM users WHERE username = $1', [NEW_USER]);
        expect(users.rows).toEqual([]);
    });

    test('accepting it records the consent with the notice version', async () => {
        const response = await request(target()).post('/api/register')
            .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/129.0 Safari/537.36')
            .send(registration({ acceptPrivacyNotice: true }));
        expect(response.status).toBe(200);
        const consents = await query(
            'SELECT notice_version, purpose, withdrawn_at, user_agent FROM consents WHERE user_id = $1', [response.body.userId]);
        expect(consents.rows).toEqual([{
            notice_version: PRIVACY_NOTICE_VERSION, purpose: 'provide_service', withdrawn_at: null,
            user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/129.0 Safari/537.36',
        }]);
    });
});

describe('an account from before the notice', () => {
    const agent = request.agent(target());

    test('is asked to agree, and only to the current version', async () => {
        expect((await logIn(agent, OLD_USER, PASSWORD)).status).toBe(200);
        const user = await agent.get('/api/user');
        expect(user.body).toMatchObject({ consentNeeded: true, noticeVersion: PRIVACY_NOTICE_VERSION });

        const stale = await agent.post('/api/privacy/consent').send({ noticeVersion: '2020-01-01' });
        expect(stale.status).toBe(400);
        expect((await agent.post('/api/privacy/consent').send({ noticeVersion: PRIVACY_NOTICE_VERSION })).status).toBe(200);
        expect((await agent.get('/api/user')).body.consentNeeded).toBe(false);
    });

    test('sees what FinDB holds about them, counted from their own rows only', async () => {
        const response = await agent.get('/api/privacy');
        expect(response.status).toBe(200);
        expect(response.body.consent).toMatchObject({ noticeVersion: PRIVACY_NOTICE_VERSION, withdrawnAt: null });
        const rows = Object.fromEntries(response.body.tables.map(item => [item.table, item.rows]));
        expect(rows.users).toBe(1);
        expect(rows.banks).toBe(1);
        expect(rows.consents).toBe(1);
        expect(rows.session).toBeGreaterThanOrEqual(1);
        expect(Object.keys(rows)).not.toContain('schema_migrations');
        for (const item of response.body.tables) expect(item.holds && item.purpose && item.retention).toBeTruthy();
    });

    test('withdrawing consent signs out everywhere and asks again at the next login', async () => {
        const other = request.agent(target());
        await logIn(other, OLD_USER, PASSWORD);
        expect((await agent.post('/api/privacy/withdraw').send({})).status).toBe(200);
        expect((await agent.get('/api/user')).status).toBe(401);
        expect((await other.get('/api/user')).status).toBe(401);

        const consent = await query('SELECT withdrawn_at FROM consents WHERE user_id = $1', [oldUser.id]);
        expect(consent.rows[0].withdrawn_at).not.toBeNull();

        const again = request.agent(target());
        await logIn(again, OLD_USER, PASSWORD);
        expect((await again.get('/api/user')).body.consentNeeded).toBe(true);
        // Agreeing again adds a new record; the withdrawn one stays as history
        expect((await again.post('/api/privacy/consent').send({ noticeVersion: PRIVACY_NOTICE_VERSION })).status).toBe(200);
        expect((await again.get('/api/user')).body.consentNeeded).toBe(false);
        const history = await query('SELECT count(*)::int AS n FROM consents WHERE user_id = $1', [oldUser.id]);
        expect(history.rows[0].n).toBe(2);
    });
});

describe('data inventory', () => {
    test('names exactly the tables in the database', async () => {
        const tables = await query(
            `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = current_schema() AND c.relkind = 'r' ORDER BY c.relname`,
        );
        expect(DATA_INVENTORY.map(item => item.table).sort()).toEqual(tables.rows.map(row => row.name));
    });
});
