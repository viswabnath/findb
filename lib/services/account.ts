import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { DATA_INVENTORY } from '../data-inventory';
import { documentStore, StoreUnavailableError } from '../document-store';
import { RequestError, withTransaction } from '../transaction';
import { t } from '../i18n';
import { csvRow, zipFiles } from '../zip';
import { getProfile } from './profile';
import { checkCurrentCode } from './security';

/**
 * The last data protection rights (v2 Phase 5, docs/privacy.md): a copy of everything FinDB holds
 * about the user, and deleting the account.
 *
 * The export covers every table the data inventory (lib/data-inventory.ts) marks as exported, the
 * user's rows only. Password and answer hashes, encrypted secrets and two-step login state are left
 * out; PAN and demat numbers are given masked, as Settings shows them. Vault files are not inside
 * (each can be downloaded from Documents).
 *
 * Deleting the account needs the password and a current code from the authenticator app. The vault
 * files go first (if the store cannot be reached, nothing is deleted and the user is asked to try
 * again); then the user row, which takes every other row with it (on delete cascade).
 */

type Rows = Array<Record<string, unknown>>;

/** Tables from the former app whose rows do not go with the user row, in an order their references allow */
const LEGACY_TABLES = ['activity_log', 'expenses', 'income_entries', 'cash_balance', 'credit_cards', 'banks'] as const;

/** Columns never exported: hashes, encrypted values (masked forms are added instead) and login state */
const HIDDEN = /(_hash|_enc|^totp_last_step)$/;

export interface ExportData {
    exportedAt: string;
    notes: string[];
    profile: Awaited<ReturnType<typeof getProfile>>;
    tables: Record<string, Rows>;
}

export async function exportData(pool: Pool, userId: number): Promise<ExportData> {
    const tables: Record<string, Rows> = {};
    for (const record of DATA_INVENTORY) {
        if (!record.exported || record.category === 'system') continue;
        // Table names come from the fixed inventory, never from the request
        const column = record.table === 'users' ? 'id' : 'user_id';
        const result = await pool.query(`SELECT * FROM ${record.table} WHERE ${column} = $1 ORDER BY 1`, [userId]);
        tables[record.table] = result.rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !HIDDEN.test(key))));
    }
    return {
        exportedAt: new Date().toISOString(),
        notes: [t('account.export.notePaise'), t('account.export.noteHidden'), t('account.export.noteFiles')],
        profile: await getProfile(pool, userId),
        tables,
    };
}

/** The same as one CSV a table, with the notes and profile, in a ZIP */
export async function exportZip(pool: Pool, userId: number): Promise<Buffer> {
    const data = await exportData(pool, userId);
    const files = Object.entries(data.tables).filter(([, rows]) => rows.length > 0).map(([table, rows]) => {
        const columns = Object.keys(rows[0]!);
        return { name: `${table}.csv`, content: [csvRow(columns), ...rows.map(row => csvRow(columns.map(column => row[column])))].join('\r\n') + '\r\n' };
    });
    return zipFiles([
        { name: 'README.txt', content: `${t('account.export.readme', { date: data.exportedAt })}\r\n\r\n${data.notes.join('\r\n')}\r\n` },
        { name: 'profile.json', content: JSON.stringify(data.profile, null, 2) },
        ...files,
    ]);
}

/**
 * { password, code, confirm: "DELETE" }: delete the account and everything in it. Runs as the owner
 * (the user row and the stored files are beyond the user's own role), with explicit user filters.
 */
export async function deleteAccount(owner: Pool, userId: number, body: Record<string, unknown>, userAgent: string | null): Promise<void> {
    if (body.confirm !== 'DELETE') throw new RequestError(400, t('errors.account.typeDelete'));
    const password = typeof body.password === 'string' ? body.password : '';
    const user = (await owner.query('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0];
    if (!user || !password || !(await bcrypt.compare(password, user.password_hash))) throw new RequestError(400, t('errors.account.wrongPassword'));
    await checkCurrentCode(owner, userId, body.code, userAgent);

    const files = await owner.query('SELECT storage_path FROM documents WHERE user_id = $1', [userId]);
    if (files.rows.length > 0) {
        try {
            const store = documentStore();
            for (const row of files.rows) await store.remove(String(row.storage_path));
        } catch (error) {
            if (error instanceof StoreUnavailableError) throw new RequestError(503, t('errors.account.filesUnavailable'));
            throw error;
        }
    }
    await withTransaction(owner, async (client) => {
        // The former app's tables (created before the ledger) do not cascade; every later table does
        for (const table of LEGACY_TABLES) await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
    });
}
