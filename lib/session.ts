import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
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

/**
 * The logged-in user's id for a request's session cookie, or null: no cookie, a bad signature,
 * an expired or deleted session, or no SESSION_SECRET configured.
 */
export async function sessionUserId(pool: Pool, cookieValue: string | undefined): Promise<number | null> {
    const secret = process.env.SESSION_SECRET;
    if (!cookieValue || !secret) return null;
    const sid = unsignSessionCookie(cookieValue, secret);
    if (!sid) return null;
    const result = await pool.query<{ sess: { userId?: unknown } }>(
        'SELECT sess FROM session WHERE sid = $1 AND expire > NOW()',
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
export async function createSession(pool: Pick<Pool, 'query'>, userId: number, secure: boolean): Promise<string> {
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
    await pool.query('INSERT INTO session (sid, sess, expire) VALUES ($1, $2, to_timestamp($3))',
        [sid, JSON.stringify(sess), expires.getTime() / 1000]);
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
