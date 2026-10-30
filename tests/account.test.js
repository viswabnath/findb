/**
 * A copy of everything, and deleting the account (real database, balancetrack_test schema;
 * lib/services/account.ts)
 *
 * The export holds the user's own rows and none of another user's, without hashes or secrets, as
 * JSON and as a ZIP of CSVs. Deletion needs the password, a current code and "DELETE"; afterwards
 * nothing of the user is left and their session no longer works.
 * @jest-environment node
 */

const { execFileSync } = require('node:child_process');
const { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, currentTotpCode, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'account_user';
const OTHER = 'account_other';
const PASSWORD = 'Account_Pass9';
const PDF = Buffer.from('%PDF-1.4\n% FinDB test\n');

let agent;
let otherAgent;
let user;

const binary = (res, callback) => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'account_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'account_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Mine Bank', initialBalance: 50000 })).status).toBe(200);
    expect((await otherAgent.post('/api/banks').send({ name: 'Other Bank', initialBalance: 99 })).status).toBe(200);
    const bank = (await agent.get('/api/accounts')).body.find(account => account.type === 'bank');
    expect((await agent.post('/api/entries').send({ type: 'expense', description: 'Groceries', amount: 1200, accountId: bank.id, date: '2026-10-01' })).status).toBe(200);
    expect((await agent.post('/api/documents').attach('file', PDF, { filename: 'bill.pdf', contentType: 'application/pdf' }).field('kind', 'receipt')).status).toBe(200);
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

test('the JSON copy has the user\'s rows only, without hashes or secrets', async () => {
    const response = await agent.get('/api/privacy/export?format=json');
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="findb-data-\d{4}-\d{2}-\d{2}\.json"$/);
    const data = JSON.parse(response.text);
    expect(data.tables.users).toHaveLength(1);
    expect(data.tables.users[0]).toMatchObject({ username: USER, email: 'account_user@example.com' });
    for (const hidden of ['password_hash', 'security_answer_hash', 'totp_secret_enc', 'totp_last_step']) expect(data.tables.users[0]).not.toHaveProperty(hidden);
    expect(data.tables.banks.map(bank => bank.name)).toEqual(['MINE BANK']);
    expect(data.tables.documents).toHaveLength(1);
    expect(data.tables.journal_entries.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(data)).not.toContain('OTHER BANK');
    expect(data.notes).toHaveLength(3);
    expect(data.profile).toHaveProperty('panMasked');
    expect(data.tables).not.toHaveProperty('session');
});

test('the CSV copy is a ZIP with one file a table', async () => {
    const response = await agent.get('/api/privacy/export?format=csv').buffer(true).parse(binary);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    const dir = mkdtempSync(join(tmpdir(), 'findb-export-'));
    try {
        writeFileSync(join(dir, 'export.zip'), response.body);
        execFileSync('unzip', ['-q', 'export.zip'], { cwd: dir });
        const files = readdirSync(dir);
        expect(files).toEqual(expect.arrayContaining(['README.txt', 'profile.json', 'users.csv', 'banks.csv', 'journal_lines.csv']));
        const users = readFileSync(join(dir, 'users.csv'), 'utf8').split('\r\n');
        expect(users[0]).toContain('username');
        expect(users[0]).not.toContain('password_hash');
        expect(users[1]).toContain(USER);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('deleting needs DELETE, the password and a current code', async () => {
    const send = body => agent.post('/api/account/delete').send(body);
    expect((await send({ password: PASSWORD, code: '000000', confirm: 'delete' })).body.error).toBe('Type DELETE to confirm');
    expect((await send({ password: 'Wrong_Pass9', code: '000000', confirm: 'DELETE' })).body.error).toBe('The password is wrong');
    expect((await send({ password: PASSWORD, code: '000000', confirm: 'DELETE' })).body.error).toBe('That code is not right. Enter the newest code from your app.');
    expect((await query('SELECT count(*)::int AS n FROM users WHERE id = $1', [user.id])).rows[0].n).toBe(1);
});

test('deleting removes everything of the user, and signs them out; others are untouched', async () => {
    // The code used to log in cannot be used again in the same 30 seconds
    await query('UPDATE users SET totp_last_step = 0 WHERE id = $1', [user.id]);
    const response = await agent.post('/api/account/delete').send({ password: PASSWORD, code: currentTotpCode(), confirm: 'DELETE' });
    expect(response.status).toBe(200);
    expect(response.headers['set-cookie'].join(';')).toMatch(/sessionId=;/);
    for (const table of ['users', 'banks', 'journal_entries', 'ledger_accounts', 'documents', 'session', 'activity_log']) {
        const column = table === 'users' ? 'id' : 'user_id';
        expect((await query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [user.id])).rows[0].n).toBe(0);
    }
    expect((await agent.get('/api/accounts')).status).toBe(401);
    expect((await otherAgent.get('/api/accounts')).body.find(account => account.type === 'bank').name).toBe('OTHER BANK');
});
