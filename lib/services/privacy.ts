import type { Pool, PoolClient } from 'pg';
import { DATA_INVENTORY } from '../data-inventory';
import { PRIVACY_NOTICE_VERSION } from '../privacy-notice';
import { RequestError, withTransaction } from '../transaction';

/**
 * Consent to the privacy notice and the user's view of their data (docs/privacy.md). Consent is
 * given at sign-up, or once by an account from before the notice; withdrawing it signs the account
 * out everywhere, and the app stays locked until the user agrees again.
 */

type Client = Pick<PoolClient, 'query'>;

export async function recordConsent(client: Client, userId: number, userAgent: string | null): Promise<void> {
    await client.query('INSERT INTO consents (user_id, notice_version, user_agent) VALUES ($1, $2, $3)',
        [userId, PRIVACY_NOTICE_VERSION, userAgent?.slice(0, 300) ?? null]);
}

export interface ConsentStatus {
    /** True until the user has agreed to the current notice, or after they withdrew */
    needed: boolean;
    noticeVersion: string;
    givenAt: string | null;
    withdrawnAt: string | null;
}

export async function consentStatus(pool: Pick<Pool, 'query'>, userId: number): Promise<ConsentStatus> {
    const latest = await pool.query(
        'SELECT notice_version, given_at, withdrawn_at FROM consents WHERE user_id = $1 ORDER BY given_at DESC, id DESC LIMIT 1',
        [userId],
    );
    const row = latest.rows[0];
    return {
        needed: !row || row.notice_version !== PRIVACY_NOTICE_VERSION || row.withdrawn_at !== null,
        noticeVersion: PRIVACY_NOTICE_VERSION,
        givenAt: row?.given_at ?? null,
        withdrawnAt: row?.withdrawn_at ?? null,
    };
}

/** { noticeVersion }: agree to the notice the user was shown, which must be the current one */
export async function giveConsent(pool: Pool, userId: number, body: Record<string, unknown>, userAgent: string | null): Promise<void> {
    if (body.noticeVersion !== PRIVACY_NOTICE_VERSION) {
        throw new RequestError(400, 'The privacy notice has changed. Reload the page to read the current one.');
    }
    await recordConsent(pool, userId, userAgent);
}

/** Withdraw consent: recorded, and every session of the account is signed out */
export async function withdrawConsent(pool: Pool, userId: number): Promise<void> {
    await withTransaction(pool, async (client) => {
        await client.query('UPDATE consents SET withdrawn_at = NOW() WHERE user_id = $1 AND withdrawn_at IS NULL', [userId]);
        await client.query('DELETE FROM session WHERE sess->>\'userId\' = $1', [String(userId)]);
    });
}

/** What FinDB holds about the user: each table's record from the inventory, with how many rows are theirs */
export async function myData(pool: Pool, userId: number): Promise<{ consent: ConsentStatus; tables: Array<{ table: string; category: string; holds: string; purpose: string; retention: string; rows: number }> }> {
    const tables = [];
    for (const record of DATA_INVENTORY) {
        if (record.category === 'system') continue;
        // Table names come from the fixed inventory, never from the request
        const column = record.table === 'users' ? 'id' : record.table === 'session' ? null : 'user_id';
        const count = column
            ? await pool.query(`SELECT count(*)::int AS n FROM ${record.table} WHERE ${column} = $1`, [userId])
            : await pool.query('SELECT count(*)::int AS n FROM session WHERE sess->>\'userId\' = $1', [String(userId)]);
        tables.push({ table: record.table, category: record.category, holds: record.holds, purpose: record.purpose, retention: record.retention, rows: count.rows[0].n });
    }
    return { consent: await consentStatus(pool, userId), tables };
}
