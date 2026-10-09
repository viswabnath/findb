/**
 * Profile and dependants (real database, balancetrack_test schema; docs/privacy.md)
 *
 * PAN and demat account IDs are stored encrypted, never as text, and only ever returned masked;
 * Aadhaar is at most its last four digits; everything is optional and only the user's own.
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'profile_user';
const OTHER = 'profile_other';
const PASSWORD = 'Ledger_Pass9';

let agent;
let user;

beforeAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(OTHER);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'profile_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'profile_other@example.com' });
    agent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
});

afterAll(async () => {
    await deleteTestUser(USER);
    await deleteTestUser(OTHER);
    await closeTarget();
});

test('an empty profile to start with', async () => {
    expect((await agent.get('/api/profile')).body).toEqual({
        dateOfBirth: null, city: null, taxResidency: null, panMasked: null, aadhaarLast4: null, dematAccounts: [],
    });
});

test('PAN is stored encrypted and shown masked; other fields as given', async () => {
    const saved = await agent.put('/api/profile').send({ dateOfBirth: '1990-05-17', city: 'Pune', taxResidency: 'resident', pan: 'abcde1234f', aadhaarLast4: '9012' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ dateOfBirth: '1990-05-17', city: 'Pune', taxResidency: 'resident', panMasked: 'AB******4F', aadhaarLast4: '9012' });
    const stored = await query('SELECT pan_enc FROM profiles WHERE user_id = $1', [user.id]);
    expect(stored.rows[0].pan_enc).toMatch(/^v\d+\./);
    expect(stored.rows[0].pan_enc).not.toContain('ABCDE1234F');
    // Changing something else keeps the PAN; null removes it
    expect((await agent.put('/api/profile').send({ city: 'Mumbai' })).body).toMatchObject({ city: 'Mumbai', panMasked: 'AB******4F' });
    // The activity log names what changed, never the PAN
    const logged = await query('SELECT description FROM activity_log WHERE user_id = $1 AND entity_type = $2', [user.id, 'profile']);
    expect(JSON.stringify(logged.rows)).not.toContain('ABCDE1234F');
});

test('mistakes are refused, and a full Aadhaar number is never kept', async () => {
    const put = body => agent.put('/api/profile').send(body);
    expect((await put({ pan: 'ABCD1234F' })).body.error).toBe('PAN must be 5 letters, 4 digits and a letter, such as ABCDE1234F');
    expect((await put({ aadhaarLast4: '1234 5678 9012' })).body.error).toBe('FinDB keeps only the last four digits of Aadhaar, never the full number');
    expect((await put({ aadhaarLast4: '12' })).body.error).toBe('Enter the last four digits of Aadhaar');
    expect((await put({ dateOfBirth: '2999-01-01' })).body.error).toBe('Date of birth cannot be in the future');
    expect((await put({ taxResidency: 'martian' })).status).toBe(400);
    const stored = await query('SELECT aadhaar_last4 FROM profiles WHERE user_id = $1', [user.id]);
    expect(stored.rows[0].aadhaar_last4).toBe('9012');
});

test('demat accounts are encrypted as a whole and listed masked; one can be removed', async () => {
    await agent.post('/api/profile/demat').send({ broker: 'Zerodha', accountId: 'ab1234' });
    const added = await agent.post('/api/profile/demat').send({ broker: 'Groww', accountId: '1208160012345678' });
    expect(added.body.dematAccounts).toEqual([
        { broker: 'Zerodha', accountMasked: 'AB**34' },
        { broker: 'Groww', accountMasked: '12************78' },
    ]);
    const stored = await query('SELECT demat_accounts_enc FROM profiles WHERE user_id = $1', [user.id]);
    expect(stored.rows[0].demat_accounts_enc).not.toContain('Zerodha');
    const removed = await agent.delete('/api/profile/demat/0');
    expect(removed.body.dematAccounts).toEqual([{ broker: 'Groww', accountMasked: '12************78' }]);
    expect((await agent.delete('/api/profile/demat/5')).status).toBe(404);
    expect((await agent.post('/api/profile/demat').send({ broker: 'X', accountId: '!' })).status).toBe(400);
});

test('dependants are added, changed and removed', async () => {
    const spouse = (await agent.post('/api/profile/dependants').send({ relationship: 'spouse', name: 'Asha', dateOfBirth: '1991-02-03' })).body;
    await agent.post('/api/profile/dependants').send({ relationship: 'child', name: 'Ravi' });
    expect((await agent.get('/api/profile/dependants')).body.map(item => item.name)).toEqual(['Asha', 'Ravi']);
    expect((await agent.put(`/api/profile/dependants/${spouse.id}`).send({ name: 'Asha R' })).body).toMatchObject({ name: 'Asha R', relationship: 'spouse', dateOfBirth: '1991-02-03' });
    expect((await agent.post('/api/profile/dependants').send({ relationship: 'cousin', name: 'X' })).status).toBe(400);
    expect((await agent.delete(`/api/profile/dependants/${spouse.id}`)).status).toBe(200);
    expect((await agent.get('/api/profile/dependants')).body.map(item => item.name)).toEqual(['Ravi']);
});

test('another user sees only their own profile', async () => {
    const otherAgent = request.agent(target());
    await logIn(otherAgent, OTHER, PASSWORD);
    expect((await otherAgent.get('/api/profile')).body.panMasked).toBeNull();
    expect((await otherAgent.get('/api/profile/dependants')).body).toEqual([]);
    const ravi = (await agent.get('/api/profile/dependants')).body[0];
    expect((await otherAgent.delete(`/api/profile/dependants/${ravi.id}`)).status).toBe(404);
});
