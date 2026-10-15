import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { documentStore, StoreUnavailableError, type DocumentStore } from '../document-store';
import { decryptBytes, encryptBytes } from '../field-encryption';
import { RequestError } from '../transaction';
import { t } from '../i18n';
import { entryDate } from './transactions';

/**
 * The document vault (v2 Phase 2): receipts, statements, policies and other papers, encrypted by
 * FinDB and kept in private storage (lib/document-store.ts), each with a type, a date, India's
 * financial year and an optional expiry, and linked to any entries, accounts and events.
 *
 * Kept small so FinDB stays free: PDF, JPEG, PNG or WebP only (checked by the file's first bytes,
 * not its name), 2 MB a file (the browser shrinks photos first), 20 MB per user.
 *
 * Every handler here runs inside the request's transaction (withUser), so a file is stored before
 * its row is written, and removed if the row cannot be.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;

export const DOCUMENT_KINDS = ['receipt', 'statement', 'invoice', 'policy', 'loan', 'property', 'warranty', 'certificate', 'tax', 'other'] as const;
export type DocumentKind = typeof DOCUMENT_KINDS[number];
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_USER_BYTES = 20 * 1024 * 1024;
const MAX_LINKS = 20;

export interface DocumentLink { type: 'entry' | 'account' | 'event'; id: number; name: string }

export interface VaultDocument {
    id: number;
    kind: DocumentKind;
    title: string;
    date: string | null;
    financialYear: string | null;
    expiresOn: string | null;
    notes: string | null;
    fileName: string;
    mimeType: string;
    size: number;
    createdAt: string;
    links: DocumentLink[];
}

/** India's financial year (April to March) of a date: 2026-05-10 is "2026-27" */
export function financialYear(date: string): string {
    const year = Number(date.slice(0, 4));
    const start = Number(date.slice(5, 7)) >= 4 ? year : year - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The file's type from its first bytes; null if it is none of the allowed ones */
export function sniffType(bytes: Buffer): string | null {
    if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
}

const context = (userId: number, path: string) => `document:${userId}:${path}`;

const DOCUMENT_QUERY = `
    SELECT d.id, d.kind, d.title, d.document_date::text AS document_date, d.financial_year, d.expires_on::text AS expires_on, d.notes,
           d.file_name, d.mime_type, d.size_bytes, d.created_at,
           coalesce((SELECT json_agg(json_build_object(
                        'type', CASE WHEN dl.entry_id IS NOT NULL THEN 'entry' WHEN dl.account_id IS NOT NULL THEN 'account' ELSE 'event' END,
                        'id', coalesce(dl.entry_id, dl.account_id, dl.event_id),
                        'name', coalesce(e.description, a.name, ev.name)) ORDER BY dl.id)
                     FROM document_links dl
                     LEFT JOIN journal_entries e ON e.user_id = dl.user_id AND e.id = dl.entry_id
                     LEFT JOIN ledger_accounts a ON a.user_id = dl.user_id AND a.id = dl.account_id
                     LEFT JOIN events ev ON ev.user_id = dl.user_id AND ev.id = dl.event_id
                     WHERE dl.user_id = d.user_id AND dl.document_id = d.id), '[]'::json) AS links
    FROM documents d WHERE d.user_id = $1`;

function toDocument(row: Record<string, unknown>): VaultDocument {
    return {
        id: Number(row.id), kind: row.kind as DocumentKind, title: String(row.title), date: (row.document_date as string | null) ?? null,
        financialYear: (row.financial_year as string | null) ?? null, expiresOn: (row.expires_on as string | null) ?? null,
        notes: (row.notes as string | null) ?? null, fileName: String(row.file_name), mimeType: String(row.mime_type), size: Number(row.size_bytes),
        createdAt: new Date(row.created_at as string).toISOString(), links: (row.links as DocumentLink[]).map(link => ({ ...link, id: Number(link.id) })),
    };
}

export interface Vault { documents: VaultDocument[]; used: number; limit: number }

/** The user's documents, newest first, optionally only those linked to one entry, account or event */
export async function listDocuments(pool: Pool, userId: number, filter: { entryId?: string | null; accountId?: string | null; eventId?: string | null } = {}): Promise<Vault> {
    const params: unknown[] = [userId];
    let where = '';
    for (const [key, column] of [['entryId', 'entry_id'], ['accountId', 'account_id'], ['eventId', 'event_id']] as const) {
        const value = filter[key];
        if (!value) continue;
        if (!/^\d+$/.test(value)) throw new RequestError(400, t('errors.documents.badFilter'));
        params.push(value);
        where += ` AND EXISTS (SELECT 1 FROM document_links x WHERE x.user_id = d.user_id AND x.document_id = d.id AND x.${column} = $${params.length})`;
    }
    const result = await pool.query(`${DOCUMENT_QUERY}${where} ORDER BY coalesce(d.document_date, d.created_at::date) DESC, d.id DESC`, params);
    const used = await pool.query('SELECT coalesce(sum(size_bytes), 0)::bigint AS used FROM documents WHERE user_id = $1', [userId]);
    return { documents: result.rows.map(toDocument), used: Number(used.rows[0].used), limit: MAX_USER_BYTES };
}

function optionalDate(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    const date = entryDate(value);
    if (!date) throw new RequestError(400, t('errors.fieldNotValidDate', { field }));
    return date.date;
}

interface Details { kind: DocumentKind; title: string; date: string | null; expiresOn: string | null; notes: string | null }

function readDetails(body: Body, fallbackTitle?: string): Details {
    const kind = String(body.kind ?? 'other');
    if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) throw new RequestError(400, t('errors.documents.badKind'));
    const title = String(body.title ?? '').trim() || (fallbackTitle ?? '');
    if (!title) throw new RequestError(400, t('errors.documents.titleRequired'));
    if (title.length > 120) throw new RequestError(400, t('errors.fieldTooLong', { field: t('errors.documents.titleField'), max: 120 }));
    const notes = String(body.notes ?? '').trim();
    if (notes.length > 500) throw new RequestError(400, t('errors.fieldTooLong', { field: t('errors.fields.notes'), max: 500 }));
    return {
        kind: kind as DocumentKind, title, date: optionalDate(body.date, t('errors.documents.dateField')),
        expiresOn: optionalDate(body.expiresOn, t('errors.documents.expiryField')), notes: notes || null,
    };
}

/** Links as [{ type, id }] (or JSON text of it, from a form), each one the user's own */
async function readLinks(client: Client, userId: number, value: unknown): Promise<{ type: 'entry' | 'account' | 'event'; id: number }[]> {
    if (value === undefined || value === null || value === '') return [];
    let list: unknown = value;
    if (typeof value === 'string') {
        try {
            list = JSON.parse(value);
        } catch {
            throw new RequestError(400, t('errors.documents.badLinks'));
        }
    }
    if (!Array.isArray(list) || list.length > MAX_LINKS) throw new RequestError(400, t('errors.documents.badLinks'));
    const links = list.map(item => {
        const link = (item && typeof item === 'object' ? item : {}) as Body;
        if (!['entry', 'account', 'event'].includes(String(link.type)) || !/^\d+$/.test(String(link.id ?? ''))) {
            throw new RequestError(400, t('errors.documents.badLinks'));
        }
        return { type: link.type as 'entry' | 'account' | 'event', id: Number(link.id) };
    });
    for (const link of links) {
        const found = await client.query(
            link.type === 'entry' ? 'SELECT 1 FROM journal_entries WHERE user_id = $1 AND id = $2 AND voided_at IS NULL'
                : link.type === 'account' ? 'SELECT 1 FROM ledger_accounts WHERE user_id = $1 AND id = $2 AND archived_at IS NULL'
                    : 'SELECT 1 FROM events WHERE user_id = $1 AND id = $2',
            [userId, link.id]);
        if (found.rows.length === 0) throw new RequestError(400, t('errors.documents.linkNotFound'));
    }
    return links.filter((link, index) => links.findIndex(other => other.type === link.type && other.id === link.id) === index);
}

async function setLinks(client: Client, userId: number, documentId: number, links: { type: string; id: number }[]): Promise<void> {
    await client.query('DELETE FROM document_links WHERE user_id = $1 AND document_id = $2', [userId, documentId]);
    for (const link of links) {
        await client.query(
            'INSERT INTO document_links (user_id, document_id, entry_id, account_id, event_id) VALUES ($1, $2, $3, $4, $5)',
            [userId, documentId, link.type === 'entry' ? link.id : null, link.type === 'account' ? link.id : null, link.type === 'event' ? link.id : null]);
    }
}

async function lockedDocument(client: Client, userId: number, id: unknown): Promise<VaultDocument & { storagePath: string }> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, t('errors.documents.notFound'));
    const lock = await client.query('SELECT storage_path FROM documents WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
    if (lock.rows.length === 0) throw new RequestError(404, t('errors.documents.notFound'));
    const result = await client.query(`${DOCUMENT_QUERY} AND d.id = $2`, [userId, id]);
    return { ...toDocument(result.rows[0]), storagePath: lock.rows[0].storage_path };
}

/** Run a storage call; unreachable or unconfigured storage is a 503 the user can retry */
async function withStore<T>(call: (store: DocumentStore) => Promise<T>): Promise<T> {
    try {
        return await call(documentStore());
    } catch (error) {
        return storeProblem(error);
    }
}

const storeProblem = (error: unknown): never => {
    if (error instanceof StoreUnavailableError) {
        console.error(`Document store: ${error.message}`);
        throw new RequestError(503, t('errors.documents.storeUnavailable'));
    }
    throw error;
};

/** A new document: the file (from a form) and its details */
export async function uploadDocument(client: Client, userId: number, file: File | null, body: Body): Promise<VaultDocument> {
    if (!file || typeof file === 'string') throw new RequestError(400, t('errors.documents.fileRequired'));
    if (file.size === 0) throw new RequestError(400, t('errors.documents.fileEmpty'));
    if (file.size > MAX_FILE_BYTES) throw new RequestError(400, t('errors.documents.fileTooLarge'));
    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = sniffType(bytes);
    if (!mimeType) throw new RequestError(400, t('errors.documents.fileType'));
    const fileName = (file.name || 'document').replace(/[\\/\r\n\t]/g, ' ').trim().slice(0, 120) || 'document';
    const details = readDetails(body, fileName.replace(/\.[a-z0-9]{1,5}$/i, ''));
    const links = await readLinks(client, userId, body.links);

    // One upload at a time per user, so two cannot both fit under the limit
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const used = await client.query('SELECT coalesce(sum(size_bytes), 0)::bigint AS used FROM documents WHERE user_id = $1', [userId]);
    if (Number(used.rows[0].used) + bytes.length > MAX_USER_BYTES) throw new RequestError(400, t('errors.documents.full'));

    const storagePath = `${userId}/${randomUUID()}`;
    await withStore(store => store.put(storagePath, encryptBytes(bytes, context(userId, storagePath))));
    try {
        const created = await client.query(
            `INSERT INTO documents (user_id, kind, title, document_date, financial_year, expires_on, notes, file_name, mime_type, size_bytes, storage_path)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [userId, details.kind, details.title, details.date, details.date ? financialYear(details.date) : null, details.expiresOn, details.notes,
                fileName, mimeType, bytes.length, storagePath]);
        const id = Number(created.rows[0].id);
        await setLinks(client, userId, id, links);
        await logActivity(client, userId, 'created', 'document', id, `Added document: ${details.title}`, null, null,
            { title: details.title, kind: details.kind, fileName, size: bytes.length, links: links.length });
        return toDocument((await client.query(`${DOCUMENT_QUERY} AND d.id = $2`, [userId, id])).rows[0]);
    } catch (error) {
        // The row was not written: the file must not stay behind
        await withStore(store => store.remove(storagePath)).catch(() => undefined);
        throw error;
    }
}

/** { kind?, title?, date?, expiresOn?, notes?, links? }: change a document's details or links */
export async function updateDocument(client: Client, userId: number, id: string, body: Body): Promise<VaultDocument> {
    const old = await lockedDocument(client, userId, id);
    const details = readDetails({
        kind: body.kind ?? old.kind, title: body.title ?? old.title, date: body.date === undefined ? old.date : body.date,
        expiresOn: body.expiresOn === undefined ? old.expiresOn : body.expiresOn, notes: body.notes === undefined ? old.notes : body.notes,
    });
    await client.query(
        'UPDATE documents SET kind = $1, title = $2, document_date = $3, financial_year = $4, expires_on = $5, notes = $6 WHERE id = $7 AND user_id = $8',
        [details.kind, details.title, details.date, details.date ? financialYear(details.date) : null, details.expiresOn, details.notes, old.id, userId]);
    if (body.links !== undefined) await setLinks(client, userId, old.id, await readLinks(client, userId, body.links));
    await logActivity(client, userId, 'updated', 'document', old.id, `Updated document: ${details.title}`, null,
        { title: old.title, kind: old.kind, date: old.date, expiresOn: old.expiresOn, links: old.links.length },
        { title: details.title, kind: details.kind, date: details.date, expiresOn: details.expiresOn });
    return toDocument((await client.query(`${DOCUMENT_QUERY} AND d.id = $2`, [userId, old.id])).rows[0]);
}

/** Delete a document and its file: documents are not money history, so nothing is kept */
export async function deleteDocument(client: Client, userId: number, id: string): Promise<void> {
    const old = await lockedDocument(client, userId, id);
    await withStore(store => store.remove(old.storagePath));
    await client.query('DELETE FROM documents WHERE id = $1 AND user_id = $2', [old.id, userId]);
    await logActivity(client, userId, 'deleted', 'document', old.id, `Deleted document: ${old.title}`, null, { title: old.title, kind: old.kind, fileName: old.fileName }, null);
}

/** The file itself, decrypted */
export async function documentFile(client: Client, userId: number, id: string): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
    const doc = await lockedDocument(client, userId, id);
    const stored = await withStore(store => store.get(doc.storagePath));
    return { bytes: decryptBytes(stored, context(userId, doc.storagePath)), mimeType: doc.mimeType, fileName: doc.fileName };
}

/** An edited entry is recorded under a new id: its documents follow it (lib/services/entries.ts) */
export async function moveEntryLinks(client: Client, userId: number, fromEntryId: number, toEntryId: number): Promise<void> {
    await client.query('UPDATE document_links SET entry_id = $1 WHERE user_id = $2 AND entry_id = $3', [toEntryId, userId, fromEntryId]);
}
