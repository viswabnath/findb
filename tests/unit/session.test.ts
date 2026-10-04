/**
 * Unit tests for lib/session.ts: cookies signed by express-session's signer are accepted, and
 * cookies signed here are accepted by it, so both apps share one login during the migration.
 */
import type { Pool } from 'pg';
import { clearSessionCookie, createSession, destroySession, SESSION_MAX_AGE_MS, sessionUserId, signSessionCookie, unsignSessionCookie, signedInHintCookie, clearSignedInHintCookie, SIGNED_IN_HINT_COOKIE } from '../../lib/session';

// The signer express-session uses (a dependency of express-session)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const expressSigner = require('cookie-signature') as { sign(value: string, secret: string): string; unsign(value: string, secret: string): string | false };

const SECRET = 'test-secret-for-session-cookies';
const SID = 'AbC123-xyz_sessionId';

/** The cookie value as express-session sets it */
const expressCookie = (sid: string, secret = SECRET) => encodeURIComponent(`s:${expressSigner.sign(sid, secret)}`);

describe('unsignSessionCookie', () => {
    test('accepts a cookie signed by express-session', () => {
        expect(unsignSessionCookie(expressCookie(SID), SECRET)).toBe(SID);
    });

    test('express-session accepts a cookie signed here', () => {
        const value = decodeURIComponent(signSessionCookie(SID, SECRET)).slice(2);
        expect(expressSigner.unsign(value, SECRET)).toBe(SID);
    });

    test.each([
        ['another secret', expressCookie(SID, 'other-secret')],
        ['a changed session id', expressCookie(SID).replace('AbC123', 'AbC124')],
        ['no s: prefix', encodeURIComponent(expressSigner.sign(SID, SECRET))],
        ['no signature', encodeURIComponent(`s:${SID}`)],
        ['bad URL encoding', '%E0%A4%A'],
        ['an empty value', ''],
    ])('rejects %s', (_label, value) => {
        expect(unsignSessionCookie(value, SECRET)).toBeNull();
    });
});

describe('sessionUserId', () => {
    const OLD_SECRET = process.env.SESSION_SECRET;
    beforeEach(() => { process.env.SESSION_SECRET = SECRET; });
    afterAll(() => { process.env.SESSION_SECRET = OLD_SECRET; });

    function poolReturning(rows: unknown[]) {
        const query = jest.fn().mockResolvedValue({ rows });
        return { pool: { query } as unknown as Pool, query };
    }

    test('returns the user id of a live session', async () => {
        const { pool, query } = poolReturning([{ sess: { userId: 42, cookie: {} } }]);
        expect(await sessionUserId(pool, expressCookie(SID))).toBe(42);
        const [sql, params] = query.mock.calls[0] as [string, string[]];
        expect(params).toEqual([SID]);
        expect(sql).toContain('SELECT sess FROM session WHERE sid = $1 AND expire > NOW()');
        // Notes the last use, at most every five minutes (the session list shows it)
        expect(sql).toContain('UPDATE session SET last_seen_at = NOW()');
        expect(sql).toContain("last_seen_at < NOW() - interval '5 minutes'");
    });

    test('null for an expired or missing session, or one without a numeric user id', async () => {
        // A login waiting for its two-factor code has no userId, so it opens nothing
        expect(await sessionUserId(poolReturning([{ sess: { pendingLogin: { userId: 42, stage: 'verify' } } }]).pool, expressCookie(SID))).toBeNull();
        expect(await sessionUserId(poolReturning([]).pool, expressCookie(SID))).toBeNull();
        expect(await sessionUserId(poolReturning([{ sess: { userId: '42' } }]).pool, expressCookie(SID))).toBeNull();
        expect(await sessionUserId(poolReturning([{ sess: {} }]).pool, expressCookie(SID))).toBeNull();
    });

    test('null without a cookie, with a forged cookie, or without a configured secret (no query made)', async () => {
        const { pool, query } = poolReturning([{ sess: { userId: 42 } }]);
        expect(await sessionUserId(pool, undefined)).toBeNull();
        expect(await sessionUserId(pool, expressCookie(SID, 'forged'))).toBeNull();
        delete process.env.SESSION_SECRET;
        expect(await sessionUserId(pool, expressCookie(SID))).toBeNull();
        expect(query).not.toHaveBeenCalled();
    });
});

describe('createSession and destroySession', () => {
    const OLD_SECRET = process.env.SESSION_SECRET;
    beforeEach(() => { process.env.SESSION_SECRET = SECRET; });
    afterAll(() => { process.env.SESSION_SECRET = OLD_SECRET; });

    test('stores the express-session row shape and sets a cookie express-session accepts', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [] });
        const before = Date.now();
        const header = await createSession({ query } as unknown as Pool, 42, true, 'Mozilla/5.0 Test');

        const [sql, params] = query.mock.calls[0] as [string, [string, string, number, number, string]];
        // Expired sessions are cleared on each login
        expect(query.mock.calls[1]).toEqual(['DELETE FROM session WHERE expire < NOW()']);
        expect(sql).toBe('INSERT INTO session (sid, sess, expire, user_id, user_agent, last_seen_at) VALUES ($1, $2, to_timestamp($3), $4, $5, NOW())');
        const [sid, sessJson, expireSeconds, userId, userAgent] = params;
        // The user and device, for the session list (docs/security.md)
        expect([userId, userAgent]).toEqual([42, 'Mozilla/5.0 Test']);
        const sess = JSON.parse(sessJson);
        expect(sess.userId).toBe(42);
        expect(sess.cookie).toMatchObject({ originalMaxAge: SESSION_MAX_AGE_MS, httpOnly: true, path: '/', sameSite: 'strict', secure: true });
        expect(expireSeconds * 1000).toBeGreaterThanOrEqual(before + SESSION_MAX_AGE_MS - 1000);

        const cookieValue = header.split(';')[0]!.replace('sessionId=', '');
        expect(expressSigner.unsign(decodeURIComponent(cookieValue).slice(2), SECRET)).toBe(sid);
        expect(header).toMatch(/; Path=\/; Expires=.+; HttpOnly; SameSite=Strict; Secure$/);
    });

    test('a new random session id every time, and no Secure flag over plain HTTP', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [] });
        const first = await createSession({ query } as unknown as Pool, 1, false);
        const second = await createSession({ query } as unknown as Pool, 1, false);
        expect(first).not.toBe(second);
        expect(first).not.toMatch(/Secure/);
    });

    test('destroySession deletes the row behind a valid cookie and ignores bad ones', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [] });
        await destroySession({ query } as unknown as Pool, expressCookie(SID));
        expect(query).toHaveBeenCalledWith('DELETE FROM session WHERE sid = $1', [SID]);
        query.mockClear();
        await destroySession({ query } as unknown as Pool, expressCookie(SID, 'forged'));
        await destroySession({ query } as unknown as Pool, undefined);
        expect(query).not.toHaveBeenCalled();
    });

    test('clearSessionCookie expires the cookie', () => {
        expect(clearSessionCookie(false)).toBe('sessionId=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict');
    });
});

describe('signed-in hint cookie (read by the static website pages)', () => {
    test('says only that someone is signed in, readable by scripts, for the length of a session', () => {
        const cookie = signedInHintCookie(true, Date.UTC(2026, 9, 4, 10, 0, 0));
        expect(cookie.startsWith(`${SIGNED_IN_HINT_COOKIE}=1;`)).toBe(true);
        expect(cookie).not.toContain('HttpOnly');
        expect(cookie).toContain('Expires=Sun, 04 Oct 2026 12:00:00 GMT');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).toContain('Secure');
        expect(signedInHintCookie(false)).not.toContain('Secure');
    });

    test('is removed at logout', () => {
        expect(clearSignedInHintCookie(true)).toMatch(/^findb_signed_in=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
    });
});
