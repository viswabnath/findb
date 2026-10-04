import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { Pool } from 'pg';

/**
 * Login sessions, stored in the `session` table.
 *
 * The format is the one the former Express app used (express-session with connect-pg-simple),
 * so sessions created before the move to Next.js stay valid: the cookie `sessionId` is
 * `s:<sid>.<signature>` (URL-encoded), where the signature is HMAC-SHA256 of the sid with
 * SESSION_SECRET, base64 without padding (the cookie-signature package; the unit tests check
 * against it). The row holds sess JSON with the cookie and userId, and an expire time.
 */

export const SESSION_COOKIE = 'sessionId';
/** Two hours, like the Express cookie's maxAge */
export const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function sign(sid: string, secret: string): string {
    return createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
}

/** The session id from a signed cookie value, or null if it is malformed or the signature is wrong */
export function unsignSessionCookie(cookieValue: string, secret: string): string | null {
    let value: string;
    try {
        value = decodeURIComponent(cookieValue);
    } catch {
        return null;
    }
    if (!value.startsWith('s:')) return null;
    const signed = value.slice(2);
    const dot = signed.lastIndexOf('.');
    if (dot < 1) return null;
    const sid = signed.slice(0, dot);
    const given = Buffer.from(signed.slice(dot + 1));
    const expected = Buffer.from(sign(sid, secret));
    return given.length === expected.length && timingSafeEqual(given, expected) ? sid : null;
}

/** The signed cookie value for a session id */
export function signSessionCookie(sid: string, secret: string): string {
    return encodeURIComponent(`s:${sid}.${sign(sid, secret)}`);
}

/** The session id behind a signed cookie, or null */
export function sessionIdFromCookie(cookieValue: string | undefined): string | null {
    const secret = process.env.SESSION_SECRET;
    if (!cookieValue || !secret) return null;
    return unsignSessionCookie(cookieValue, secret);
}

/** A session's id as shown to its user (the session list): a hash, so the real id never leaves the server */
export function publicSessionId(sid: string): string {
    return createHash('sha256').update(sid).digest('hex').slice(0, 24);
}

/**
 * The logged-in user's id for a request's session cookie, or null: no cookie, a bad signature,
 * an expired or deleted session, a login still waiting for its two-factor code, or no
 * SESSION_SECRET configured. Notes when the session was last used, at most every five minutes.
 */
export async function sessionUserId(pool: Pool, cookieValue: string | undefined): Promise<number | null> {
    const sid = sessionIdFromCookie(cookieValue);
    if (!sid) return null;
    const result = await pool.query<{ sess: { userId?: unknown } }>(
        `WITH seen AS (
            UPDATE session SET last_seen_at = NOW()
            WHERE sid = $1 AND expire > NOW() AND (last_seen_at IS NULL OR last_seen_at < NOW() - interval '5 minutes')
         )
         SELECT sess FROM session WHERE sid = $1 AND expire > NOW()`,
        [sid],
    );
    const userId = result.rows[0]?.sess?.userId;
    return typeof userId === 'number' && Number.isInteger(userId) ? userId : null;
}

/** The secret, or an error: sessions cannot be signed without one */
function requireSecret(): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error('SESSION_SECRET is not set');
    return secret;
}

/**
 * Start a new session for a user and return the Set-Cookie header value. Always a new id, so a
 * session id known before login is useless afterwards (express-session's regenerate did this).
 * The row matches connect-pg-simple's: sess JSON with the cookie and userId, and expire.
 */
export async function createSession(pool: Pick<Pool, 'query'>, userId: number, secure: boolean, userAgent?: string | null): Promise<string> {
    const secret = requireSecret();
    const sid = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + SESSION_MAX_AGE_MS);
    const sess = {
        cookie: {
            originalMaxAge: SESSION_MAX_AGE_MS, expires: expires.toISOString(),
            secure, httpOnly: true, path: '/', sameSite: 'strict',
        },
        userId,
    };
    await pool.query(
        'INSERT INTO session (sid, sess, expire, user_id, user_agent, last_seen_at) VALUES ($1, $2, to_timestamp($3), $4, $5, NOW())',
        [sid, JSON.stringify(sess), expires.getTime() / 1000, userId, userAgent?.slice(0, 300) ?? null]);
    // Expired sessions are removed here (connect-pg-simple pruned them on a timer); indexed on expire
    await pool.query('DELETE FROM session WHERE expire < NOW()');
    return [
        `${SESSION_COOKIE}=${signSessionCookie(sid, secret)}`, 'Path=/', `Expires=${expires.toUTCString()}`,
        'HttpOnly', 'SameSite=Strict', ...(secure ? ['Secure'] : []),
    ].join('; ');
}

/** Delete the session behind a cookie, if any (a bad or missing cookie is simply ignored) */
export async function destroySession(pool: Pick<Pool, 'query'>, cookieValue: string | undefined): Promise<void> {
    const secret = process.env.SESSION_SECRET;
    if (!cookieValue || !secret) return;
    const sid = unsignSessionCookie(cookieValue, secret);
    if (sid) await pool.query('DELETE FROM session WHERE sid = $1', [sid]);
}

/** Set-Cookie value that removes the session cookie */
export function clearSessionCookie(secure: boolean): string {
    return [`${SESSION_COOKIE}=`, 'Path=/', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'HttpOnly', 'SameSite=Strict', ...(secure ? ['Secure'] : [])].join('; ');
}

/**
 * A cookie the website's static pages can read to show "Open FinDB" instead of "Log in" without a
 * server call. It holds no secret and grants nothing: the session itself stays in the HttpOnly
 * sessionId cookie, which every logged-in request checks. It lasts as long as a new session.
 */
export const SIGNED_IN_HINT_COOKIE = 'findb_signed_in';

export function signedInHintCookie(secure: boolean, now = Date.now()): string {
    const expires = new Date(now + SESSION_MAX_AGE_MS);
    return [`${SIGNED_IN_HINT_COOKIE}=1`, 'Path=/', `Expires=${expires.toUTCString()}`, 'SameSite=Strict', ...(secure ? ['Secure'] : [])].join('; ');
}

/** Set-Cookie value that removes the signed-in hint */
export function clearSignedInHintCookie(secure: boolean): string {
    return [`${SIGNED_IN_HINT_COOKIE}=`, 'Path=/', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'SameSite=Strict', ...(secure ? ['Secure'] : [])].join('; ');
}

// ----- A login between its password and its two-factor code -----

/**
 * After the right password, a login waits for its two-factor code (or for two-factor setup) in a
 * pending login: a row in the session table with no userId, so it opens nothing (sessionUserId
 * ignores it), behind its own short-lived cookie. Ten minutes to finish.
 */
export const PENDING_LOGIN_COOKIE = 'findb_login';
const PENDING_LOGIN_MAX_AGE_MS = 10 * 60 * 1000;

export type PendingStage = 'verify' | 'setup';
export interface PendingLogin { sid: string; userId: number; stage: PendingStage }

export async function createPendingLogin(pool: Pick<Pool, 'query'>, userId: number, stage: PendingStage, secure: boolean): Promise<string> {
    const secret = requireSecret();
    const sid = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + PENDING_LOGIN_MAX_AGE_MS);
    await pool.query('INSERT INTO session (sid, sess, expire) VALUES ($1, $2, to_timestamp($3))',
        [sid, JSON.stringify({ pendingLogin: { userId, stage } }), expires.getTime() / 1000]);
    return [
        `${PENDING_LOGIN_COOKIE}=${signSessionCookie(sid, secret)}`, 'Path=/', `Expires=${expires.toUTCString()}`,
        'HttpOnly', 'SameSite=Strict', ...(secure ? ['Secure'] : []),
    ].join('; ');
}

export async function pendingLogin(pool: Pick<Pool, 'query'>, cookieValue: string | undefined): Promise<PendingLogin | null> {
    const sid = sessionIdFromCookie(cookieValue);
    if (!sid) return null;
    const result = await pool.query<{ sess: { pendingLogin?: { userId?: unknown; stage?: unknown } } }>(
        'SELECT sess FROM session WHERE sid = $1 AND expire > NOW()', [sid]);
    const pending = result.rows[0]?.sess?.pendingLogin;
    if (!pending || typeof pending.userId !== 'number' || (pending.stage !== 'verify' && pending.stage !== 'setup')) return null;
    return { sid, userId: pending.userId, stage: pending.stage };
}

export async function destroyPendingLogin(pool: Pick<Pool, 'query'>, sid: string): Promise<void> {
    await pool.query('DELETE FROM session WHERE sid = $1', [sid]);
}

export function clearPendingLoginCookie(secure: boolean): string {
    return [`${PENDING_LOGIN_COOKIE}=`, 'Path=/', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'HttpOnly', 'SameSite=Strict', ...(secure ? ['Secure'] : [])].join('; ');
}
