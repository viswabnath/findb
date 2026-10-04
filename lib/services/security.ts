import { createHash, randomBytes } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { decryptField, encryptField } from '../field-encryption';
import { publicSessionId } from '../session';
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from '../totp';
import { RequestError, withTransaction } from '../transaction';

/**
 * Two-factor login, recovery codes, the session list and login history (docs/security.md).
 *
 * Two-factor login is required for everyone: a new user sets it up right after registering, an
 * existing user at their next login. A code from an authenticator app (lib/totp.ts) or a one-time
 * recovery code completes the login. Secrets are encrypted with lib/field-encryption.ts, bound to
 * the user, and recovery codes are kept only as hashes.
 */

type Client = Pick<PoolClient, 'query'>;

export type LoginEvent = 'signed_in' | 'wrong_password' | 'wrong_code' | 'recovery_code_used' | 'two_factor_enabled'
    | 'recovery_codes_created' | 'signed_out_session' | 'signed_out_everywhere' | 'password_changed';

const RECOVERY_CODE_COUNT = 10;
const MAX_WRONG_CODES = 5;
const WRONG_CODE_WINDOW_MINUTES = 15;
/** Login history older than this is removed, so it is kept only as long as it is useful */
const HISTORY_DAYS = 365;

const secretContext = (userId: number) => `users.totp_secret:${userId}`;

export async function recordLoginEvent(client: Client, userId: number, event: LoginEvent, userAgent?: string | null): Promise<void> {
    await client.query('INSERT INTO login_events (user_id, event, user_agent) VALUES ($1, $2, $3)',
        [userId, event, userAgent?.slice(0, 300) ?? null]);
}

// ----- Setting up two-factor login -----

/**
 * The secret to add to an authenticator app, as text and as the link its QR code holds. The same
 * secret is shown until it is confirmed, so reloading the page does not invalidate a scan.
 */
export async function twoFactorSetupInfo(pool: Pool, userId: number): Promise<{ secret: string; otpauthUri: string }> {
    const user = await pool.query('SELECT username, totp_pending_secret_enc FROM users WHERE id = $1', [userId]);
    if (user.rows.length === 0) throw new RequestError(404, 'User not found');
    let secret: string;
    if (user.rows[0].totp_pending_secret_enc) {
        secret = decryptField(user.rows[0].totp_pending_secret_enc, secretContext(userId));
    } else {
        secret = newTotpSecret();
        await pool.query('UPDATE users SET totp_pending_secret_enc = $1 WHERE id = $2', [encryptField(secret, secretContext(userId)), userId]);
    }
    return { secret, otpauthUri: otpauthUri(secret, user.rows[0].username) };
}

/** New recovery codes replace any earlier ones; returns them, the only time they are shown */
async function createRecoveryCodes(client: Client, userId: number): Promise<string[]> {
    await client.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
        // 50 random bits, as two groups of five, in lower case
        const text = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
        const code = `${text.slice(0, 5)}-${text.slice(5)}`;
        codes.push(code);
        await client.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, hashRecoveryCode(code)]);
    }
    return codes;
}

function hashRecoveryCode(code: string): string {
    return createHash('sha256').update(code.toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
}

/** Confirm setup with the first code from the app: turns two-factor login on and returns the recovery codes */
export async function confirmTwoFactorSetup(pool: Pool, userId: number, code: unknown, userAgent: string | null): Promise<string[]> {
    if (typeof code !== 'string' || !code.trim()) throw new RequestError(400, 'Enter the 6-digit code from your app');
    return withTransaction(pool, async (client) => {
        const user = await client.query('SELECT totp_pending_secret_enc FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const pending = user.rows[0]?.totp_pending_secret_enc;
        if (!pending) throw new RequestError(400, 'Two-factor setup has not started. Reload the page and scan the new code.');
        const step = verifyTotp(decryptField(pending, secretContext(userId)), code, null);
        if (step === null) throw new RequestError(400, 'That code is not right. Check the time on your phone, and enter the newest code.');
        await client.query(
            `UPDATE users SET totp_secret_enc = totp_pending_secret_enc, totp_pending_secret_enc = NULL,
                    totp_enabled_at = NOW(), totp_last_step = $1 WHERE id = $2`,
            [step, userId],
        );
        await recordLoginEvent(client, userId, 'two_factor_enabled', userAgent);
        return createRecoveryCodes(client, userId);
    });
}

// ----- Logging in with a code -----

async function tooManyWrongCodes(client: Client, userId: number): Promise<boolean> {
    const wrong = await client.query(
        `SELECT COUNT(*)::int AS n FROM login_events
         WHERE user_id = $1 AND event = 'wrong_code' AND created_at > NOW() - make_interval(mins => $2)`,
        [userId, WRONG_CODE_WINDOW_MINUTES],
    );
    return wrong.rows[0].n >= MAX_WRONG_CODES;
}

const TOO_MANY_CODES = `Too many wrong codes. Wait ${WRONG_CODE_WINDOW_MINUTES} minutes, then try again.`;

/**
 * Check the second step of a login: { code } from the authenticator app, or { recoveryCode }. A
 * wrong one is recorded; after five in fifteen minutes the account refuses codes for a while.
 */
export async function verifyLoginCode(pool: Pool, userId: number, body: Record<string, unknown>, userAgent: string | null)
    : Promise<{ name: string; tracking_option: string }> {
    const { code, recoveryCode } = body;
    if ((typeof code !== 'string' || !code.trim()) && (typeof recoveryCode !== 'string' || !recoveryCode.trim())) {
        throw new RequestError(400, 'Enter the 6-digit code from your app, or a recovery code');
    }
    // The wrong-code record must stay even though the request fails, so it is written outside the
    // transaction that is rolled back
    let wrong = false;
    try {
        return await withTransaction(pool, async (client) => {
            const user = await client.query(
                'SELECT name, tracking_option, totp_secret_enc, totp_last_step FROM users WHERE id = $1 FOR UPDATE', [userId]);
            const row = user.rows[0];
            if (!row?.totp_secret_enc) throw new RequestError(400, 'Two-factor login is not set up yet');
            if (await tooManyWrongCodes(client, userId)) throw new RequestError(429, TOO_MANY_CODES);

            if (typeof recoveryCode === 'string' && recoveryCode.trim()) {
                const used = await client.query(
                    `UPDATE recovery_codes SET used_at = NOW()
                     WHERE id = (SELECT id FROM recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL LIMIT 1)
                     RETURNING id`,
                    [userId, hashRecoveryCode(recoveryCode)],
                );
                if (used.rows.length === 0) {
                    wrong = true;
                    throw new RequestError(400, 'That recovery code is not right, or has been used');
                }
                await recordLoginEvent(client, userId, 'recovery_code_used', userAgent);
            } else {
                const lastStep = row.totp_last_step === null ? null : Number(row.totp_last_step);
                const step = verifyTotp(decryptField(row.totp_secret_enc, secretContext(userId)), String(code), lastStep);
                if (step === null) {
                    wrong = true;
                    throw new RequestError(400, 'That code is not right. Enter the newest code from your app.');
                }
                await client.query('UPDATE users SET totp_last_step = $1 WHERE id = $2', [step, userId]);
            }
            await recordLoginEvent(client, userId, 'signed_in', userAgent);
            await client.query('DELETE FROM login_events WHERE user_id = $1 AND created_at < NOW() - make_interval(days => $2)',
                [userId, HISTORY_DAYS]);
            return { name: row.name, tracking_option: row.tracking_option };
        });
    } finally {
        if (wrong) await recordLoginEvent(pool, userId, 'wrong_code', userAgent);
    }
}

/** New recovery codes for a logged-in user, after a current code from their app */
export async function regenerateRecoveryCodes(pool: Pool, userId: number, code: unknown, userAgent: string | null): Promise<string[]> {
    if (typeof code !== 'string' || !code.trim()) throw new RequestError(400, 'Enter the 6-digit code from your app');
    let wrong = false;
    try {
        return await withTransaction(pool, async (client) => {
            const user = await client.query('SELECT totp_secret_enc, totp_last_step FROM users WHERE id = $1 FOR UPDATE', [userId]);
            const row = user.rows[0];
            if (!row?.totp_secret_enc) throw new RequestError(400, 'Two-factor login is not set up yet');
            if (await tooManyWrongCodes(client, userId)) throw new RequestError(429, TOO_MANY_CODES);
            const lastStep = row.totp_last_step === null ? null : Number(row.totp_last_step);
            const step = verifyTotp(decryptField(row.totp_secret_enc, secretContext(userId)), code, lastStep);
            if (step === null) {
                wrong = true;
                throw new RequestError(400, 'That code is not right. Enter the newest code from your app.');
            }
            await client.query('UPDATE users SET totp_last_step = $1 WHERE id = $2', [step, userId]);
            await recordLoginEvent(client, userId, 'recovery_codes_created', userAgent);
            return createRecoveryCodes(client, userId);
        });
    } finally {
        if (wrong) await recordLoginEvent(pool, userId, 'wrong_code', userAgent);
    }
}

/** Whether two-factor login is on, and how many recovery codes are left */
export async function twoFactorStatus(pool: Pool, userId: number): Promise<{ enabledAt: string | null; recoveryCodesLeft: number }> {
    const result = await pool.query(
        `SELECT totp_enabled_at,
                (SELECT COUNT(*)::int FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL) AS left
         FROM users WHERE id = $1`,
        [userId],
    );
    return { enabledAt: result.rows[0]?.totp_enabled_at ?? null, recoveryCodesLeft: result.rows[0]?.left ?? 0 };
}

// ----- Sessions and login history -----

/** "Chrome on Windows", "Safari on iPhone": enough to recognise a device, from its user agent */
export function describeUserAgent(userAgent: string | null | undefined): string {
    if (!userAgent) return 'Unknown device';
    const ua = userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
        : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
    const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
        : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook'
            : /Linux/.test(ua) ? 'Linux' : 'an unknown device';
    return `${browser} on ${device}`;
}

export interface SessionInfo { id: string; device: string; createdAt: string | null; lastSeenAt: string | null; current: boolean }

export async function listSessions(pool: Pool, userId: number, currentSid: string | null): Promise<SessionInfo[]> {
    const result = await pool.query(
        `SELECT sid, user_agent, created_at, last_seen_at FROM session
         WHERE sess->>'userId' = $1 AND expire > NOW()
         ORDER BY last_seen_at DESC NULLS LAST, created_at DESC`,
        [String(userId)],
    );
    return result.rows.map(row => ({
        id: publicSessionId(row.sid),
        device: describeUserAgent(row.user_agent),
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        current: row.sid === currentSid,
    }));
}

/** Sign out one of the user's sessions, by the id the session list shows */
export async function signOutSession(pool: Pool, userId: number, publicId: string, userAgent: string | null): Promise<void> {
    const sessions = await pool.query('SELECT sid FROM session WHERE sess->>\'userId\' = $1', [String(userId)]);
    const match = sessions.rows.find(row => publicSessionId(row.sid) === publicId);
    if (!match) throw new RequestError(404, 'Session not found');
    await withTransaction(pool, async (client) => {
        await client.query('DELETE FROM session WHERE sid = $1', [match.sid]);
        await recordLoginEvent(client, userId, 'signed_out_session', userAgent);
    });
}

/** Sign out every session of the user, this one included */
export async function signOutEverywhere(pool: Pool, userId: number, userAgent: string | null): Promise<void> {
    await withTransaction(pool, async (client) => {
        await client.query('DELETE FROM session WHERE sess->>\'userId\' = $1', [String(userId)]);
        await recordLoginEvent(client, userId, 'signed_out_everywhere', userAgent);
    });
}

export async function loginHistory(pool: Pool, userId: number): Promise<{ event: string; device: string; at: string }[]> {
    const result = await pool.query(
        'SELECT event, user_agent, created_at FROM login_events WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 30',
        [userId],
    );
    return result.rows.map(row => ({ event: row.event, device: describeUserAgent(row.user_agent), at: row.created_at }));
}
