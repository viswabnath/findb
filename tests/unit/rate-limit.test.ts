/**
 * Unit tests for lib/rate-limit.ts
 */
import {
    allowRequest, allowWrite, AUTH_LIMIT, authBlocked, GENERAL_LIMIT, ipKey, isWrite, MemoryRateLimitStore, PostgresRateLimitStore, recordAuthFailure, WRITE_LIMIT,
} from '../../lib/rate-limit';

describe('allowRequest', () => {
    const OLD = process.env.DISABLE_RATE_LIMIT;
    beforeEach(() => { delete process.env.DISABLE_RATE_LIMIT; });
    afterAll(() => { process.env.DISABLE_RATE_LIMIT = OLD; });

    test('allows 100 requests a minute per IP, then refuses until the minute is over', async () => {
        const store = new MemoryRateLimitStore();
        const start = 1_000_000;
        for (let index = 0; index < GENERAL_LIMIT.max; index++) {
            expect(await allowRequest('1.2.3.4', store, start + index)).toBe(true);
        }
        expect(await allowRequest('1.2.3.4', store, start + 500)).toBe(false);
        // Another IP has its own count
        expect(await allowRequest('5.6.7.8', store, start + 500)).toBe(true);
        // A new window starts after a minute
        expect(await allowRequest('1.2.3.4', store, start + GENERAL_LIMIT.windowMs)).toBe(true);
    });

    test('DISABLE_RATE_LIMIT=true turns the limit off', async () => {
        process.env.DISABLE_RATE_LIMIT = 'true';
        const store = new MemoryRateLimitStore();
        for (let index = 0; index < GENERAL_LIMIT.max + 10; index++) {
            expect(await allowRequest('1.2.3.4', store, 0)).toBe(true);
        }
    });
});

describe('write limit', () => {
    const OLD = process.env.DISABLE_RATE_LIMIT;
    beforeEach(() => { delete process.env.DISABLE_RATE_LIMIT; });
    afterAll(() => { process.env.DISABLE_RATE_LIMIT = OLD; });

    test('only changes count', () => {
        expect(['POST', 'put', 'PATCH', 'DELETE'].every(isWrite)).toBe(true);
        expect(isWrite('GET') || isWrite('HEAD')).toBe(false);
    });

    test('60 writes a minute per user, and per IP when signed out', async () => {
        const store = new MemoryRateLimitStore();
        for (let index = 0; index < WRITE_LIMIT.max; index++) expect(await allowWrite({ userId: 7 }, store, 0)).toBe(true);
        expect(await allowWrite({ userId: 7 }, store, 0)).toBe(false);
        expect(await allowWrite({ userId: 8 }, store, 0)).toBe(true);
        expect(await allowWrite({ ip: '1.2.3.4' }, store, 0)).toBe(true);
    });
});

describe('auth limit', () => {
    const OLD = { disable: process.env.DISABLE_RATE_LIMIT, env: process.env.NODE_ENV };
    beforeEach(() => { delete process.env.DISABLE_RATE_LIMIT; (process.env as Record<string, string>).NODE_ENV = 'production'; });
    afterAll(() => { process.env.DISABLE_RATE_LIMIT = OLD.disable; (process.env as Record<string, string | undefined>).NODE_ENV = OLD.env; });

    test('blocks an IP after 5 failed attempts in 15 minutes, until the window ends', async () => {
        const store = new MemoryRateLimitStore();
        for (let index = 0; index < AUTH_LIMIT.max; index++) {
            expect(await authBlocked('1.1.1.1', store, 0)).toBe(false);
            await recordAuthFailure('1.1.1.1', store, 0);
        }
        expect(await authBlocked('1.1.1.1', store, 1000)).toBe(true);
        expect(await authBlocked('2.2.2.2', store, 1000)).toBe(false);
        expect(await authBlocked('1.1.1.1', store, AUTH_LIMIT.windowMs)).toBe(false);
    });

    test('checking does not count as an attempt', async () => {
        const store = new MemoryRateLimitStore();
        for (let index = 0; index < 50; index++) await authBlocked('1.1.1.1', store, 0);
        expect(await authBlocked('1.1.1.1', store, 0)).toBe(false);
    });

    test('skipped in development', async () => {
        (process.env as Record<string, string>).NODE_ENV = 'development';
        const store = new MemoryRateLimitStore();
        for (let index = 0; index < 10; index++) await recordAuthFailure('1.1.1.1', store, 0);
        expect(await authBlocked('1.1.1.1', store, 0)).toBe(false);
    });
});

describe('the shared store', () => {
    test('an IP is kept only as a short hash', () => {
        expect(ipKey('203.0.113.7')).toHaveLength(22);
        expect(ipKey('203.0.113.7')).not.toContain('203');
        expect(ipKey('203.0.113.7')).toBe(ipKey('203.0.113.7'));
        expect(ipKey('203.0.113.8')).not.toBe(ipKey('203.0.113.7'));
    });

    test('counts in fixed windows, one upsert a hit, and clears old windows now and then', async () => {
        const calls: Array<[string, unknown[] | undefined]> = [];
        const pool = { query: async (text: string, values?: unknown[]) => { calls.push([text, values]); return { rows: [{ count: 3 }] }; } };
        const store = new PostgresRateLimitStore(() => pool, () => 0.001);
        expect(await store.hit('write:u1', 60_000, 125_000)).toBe(3);
        expect(calls[0]![0]).toContain('ON CONFLICT (key, window_start) DO UPDATE');
        expect(calls[0]![1]).toEqual(['write:u1', 2]);
        expect(calls[1]![0]).toContain('DELETE FROM rate_limits');
    });

    test('a database that cannot be reached lets the request through', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const store = new PostgresRateLimitStore(() => ({ query: async () => { throw new Error('down'); } }));
        expect(await store.hit('write:u1', 60_000, 0)).toBe(0);
        expect(await store.peek('auth:x', 60_000, 0)).toBe(0);
        expect(warn).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });
});
