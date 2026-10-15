/**
 * The document vault (real database, balancetrack_test schema; lib/services/documents.ts)
 *
 * Upload, type check by content, limits, links to an entry that follow it through an edit, the
 * file back decrypted, the financial year, the expiry next step, deletion, and isolation. Test
 * servers keep files in memory unless the test project's storage key is set (lib/document-store.ts).
 * @jest-environment node
 */

const request = require('supertest');

const { target, closeTarget } = require('./api-target');
const { createTestUser, deleteTestUser, logIn, query } = require('../test-helpers');

const USER = 'documents_user';
const OTHER = 'documents_other';
const PASSWORD = 'Docs_Pass9!';

const pad = n => String(n).padStart(2, '0');
const india = new Date(Date.now() + 330 * 60_000);
const TODAY = `${india.getUTCFullYear()}-${pad(india.getUTCMonth() + 1)}-${pad(india.getUTCDate())}`;
const inDays = n => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);

let agent;
let otherAgent;
let user;
let bank;
let entry;
let receipt;

const upload = (as, file, fields = {}, name = 'receipt.pdf', type = 'application/pdf') => {
    let call = as.post('/api/documents').attach('file', file, { filename: name, contentType: type });
    for (const [key, value] of Object.entries(fields)) call = call.field(key, value);
    return call;
};

beforeAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    user = await createTestUser({ username: USER, password: PASSWORD, email: 'documents_user@example.com' });
    await createTestUser({ username: OTHER, password: PASSWORD, email: 'documents_other@example.com' });
    agent = request.agent(target());
    otherAgent = request.agent(target());
    expect((await logIn(agent, USER, PASSWORD)).status).toBe(200);
    expect((await logIn(otherAgent, OTHER, PASSWORD)).status).toBe(200);
    expect((await agent.post('/api/banks').send({ name: 'Docs Bank', initialBalance: 50000 })).status).toBe(200);
    bank = (await agent.get('/api/accounts')).body.find(account => account.type === 'bank');
    entry = (await agent.post('/api/entries').send({ type: 'expense', date: '2026-05-10', description: 'New fridge', amount: '32000', accountId: bank.id })).body;
});

afterAll(async () => {
    for (const name of [USER, OTHER]) await deleteTestUser(name);
    await closeTarget();
});

describe('upload', () => {
    test('a PDF with its details and a link to an entry; the financial year from its date', async () => {
        const response = await upload(agent, PDF, {
            kind: 'warranty', title: 'Fridge warranty', date: '2026-05-10', expiresOn: inDays(20), links: JSON.stringify([{ type: 'entry', id: entry.id }]),
        });
        expect(response.status).toBe(200);
        receipt = response.body;
        expect(receipt).toMatchObject({
            kind: 'warranty', title: 'Fridge warranty', date: '2026-05-10', financialYear: '2026-27', expiresOn: inDays(20),
            fileName: 'receipt.pdf', mimeType: 'application/pdf', size: PDF.length, links: [{ type: 'entry', id: entry.id, name: 'New fridge' }],
        });
        const stored = await query('SELECT storage_path FROM documents WHERE id = $1', [receipt.id]);
        expect(stored.rows[0].storage_path).toMatch(new RegExp(`^${user.id}/[0-9a-f-]{36}$`));
    });

    test('the file comes back as it was; a picture opens in the browser', async () => {
        const file = await agent.get(`/api/documents/${receipt.id}/file`).buffer(true).parse((res, done) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => done(null, Buffer.concat(chunks)));
        });
        expect(file.status).toBe(200);
        expect(file.headers['content-type']).toBe('application/pdf');
        expect(file.headers['content-disposition']).toMatch(/^attachment; filename="receipt.pdf"/);
        expect(file.headers['cache-control']).toBe('private, no-store');
        expect(Buffer.compare(file.body, PDF)).toBe(0);

        const picture = await upload(agent, PNG, { kind: 'receipt' }, 'bill photo.png', 'image/png');
        expect(picture.body).toMatchObject({ title: 'bill photo', mimeType: 'image/png', financialYear: null });
        const opened = await agent.get(`/api/documents/${picture.body.id}/file`);
        expect(opened.headers['content-disposition']).toMatch(/^inline/);
    });

    test('refuses other file types (by content, not name), empty and large files, and bad details', async () => {
        const html = await upload(agent, Buffer.from('<html><script>alert(1)</script></html>'), {}, 'trick.pdf', 'application/pdf');
        expect(html.body.error).toBe('Upload a PDF or a picture (JPEG, PNG or WebP)');
        expect((await agent.post('/api/documents').field('kind', 'receipt')).body.error).toBe('Choose a file to upload');
        const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(2 * 1024 * 1024)]);
        expect((await upload(agent, big)).body.error).toMatch(/larger than 2 MB/);
        expect((await upload(agent, PDF, { kind: 'diary' })).body.error).toBe('Choose what kind of document this is');
        expect((await upload(agent, PDF, { date: '2026-02-30' })).body.error).toBe('Date is not a valid date');
        expect((await upload(agent, PDF, { links: JSON.stringify([{ type: 'entry', id: 999999999 }]) })).body.error).toBe('An entry, account or event to link was not found');
        expect((await upload(agent, PDF, { links: 'nonsense' })).body.error).toBe('The links are not valid');
    });
});

describe('the vault', () => {
    test('lists by date (the upload date when it has none), newest first, with the space used, and by entry', async () => {
        const vault = (await agent.get('/api/documents')).body;
        expect(vault.documents.map(item => item.title)).toEqual(['bill photo', 'Fridge warranty']);
        expect(vault.used).toBe(PDF.length + PNG.length);
        expect(vault.limit).toBe(20 * 1024 * 1024);
        expect((await agent.get(`/api/documents?entryId=${entry.id}`)).body.documents.map(item => item.id)).toEqual([receipt.id]);
    });

    test('an edited entry keeps its documents under its new id', async () => {
        const edited = (await agent.put(`/api/entries/${entry.id}`).send({ type: 'expense', date: '2026-05-10', description: 'New fridge (LG)', amount: '32000', accountId: bank.id })).body;
        expect(edited.id).not.toBe(entry.id);
        const linked = (await agent.get(`/api/documents?entryId=${edited.id}`)).body.documents;
        expect(linked.map(item => item.id)).toEqual([receipt.id]);
        expect(linked[0].links).toEqual([{ type: 'entry', id: edited.id, name: 'New fridge (LG)' }]);
    });

    test('a document expiring within 30 days is the next step', async () => {
        expect((await agent.get('/api/next-step')).body).toMatchObject({ kind: 'expiring', text: `Fridge warranty expires on ${inDays(20)}. Renew it, or note what replaces it.` });
    });

    test('details and links can change; the activity log records it', async () => {
        const changed = await agent.put(`/api/documents/${receipt.id}`).send({ title: 'LG fridge warranty', date: '2026-03-31', links: [{ type: 'account', id: bank.id }] });
        expect(changed.body).toMatchObject({ title: 'LG fridge warranty', financialYear: '2025-26', links: [{ type: 'account', id: bank.id, name: 'DOCS BANK' }] });
        const log = await query('SELECT action_type FROM activity_log WHERE user_id = $1 AND entity_type = $2 ORDER BY id', [user.id, 'document']);
        expect(log.rows.map(row => row.action_type)).toEqual(['created', 'created', 'updated']);
    });

    test('another user can neither see, open, change nor delete it', async () => {
        expect((await otherAgent.get('/api/documents')).body).toMatchObject({ documents: [], used: 0 });
        expect((await otherAgent.get(`/api/documents/${receipt.id}/file`)).status).toBe(404);
        expect((await otherAgent.put(`/api/documents/${receipt.id}`).send({ title: 'mine' })).status).toBe(404);
        expect((await otherAgent.delete(`/api/documents/${receipt.id}`)).status).toBe(404);
        const linked = await upload(otherAgent, PDF, { links: JSON.stringify([{ type: 'account', id: bank.id }]) });
        expect(linked.body.error).toBe('An entry, account or event to link was not found');
    });

    test('deleting removes the document, its links and its file', async () => {
        expect((await agent.delete(`/api/documents/${receipt.id}`)).status).toBe(200);
        expect((await agent.get(`/api/documents/${receipt.id}/file`)).status).toBe(404);
        const left = await query('SELECT count(*)::int AS n FROM document_links WHERE document_id = $1', [receipt.id]);
        expect(left.rows[0].n).toBe(0);
        expect((await agent.get('/api/next-step')).body.kind).not.toBe('expiring');
    });
});
