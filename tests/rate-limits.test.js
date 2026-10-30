/**
 * Rate limits shared by every server instance (real database, balancetrack_test schema;
 * PostgresRateLimitStore in lib/rate-limit.ts, migration 0035)
 * @jest-environment node
 */

const { query } = require('../test-helpers');
const { PostgresRateLimitStore, allowWrite, authBlocked, recordAuthFailure, ipKey, WRITE_LIMIT, AUTH_LIMIT } = require('../lib/rate-limit');

const store = new PostgresRateLimitStore(() => ({ query }), () => 1);
// A window far from now, so other runs do not share it
const NOW = 4_000_000_000_000 + Math.floor(Math.random() * 1_000_000) * 60_000;
const OLD = { disable: process.env.DISABLE_RATE_LIMIT, env: process.env.NODE_ENV };

beforeAll(() => {
    delete process.env.DISABLE_RATE_LIMIT;
    process.env.NODE_ENV = 'production';
});

afterAll(async () => {
    process.env.DISABLE_RATE_LIMIT = OLD.disable;
    process.env.NODE_ENV = OLD.env;
    await query('DELETE FROM rate_limits WHERE key LIKE $1 OR key = $2', ['write:u-%', `auth:${ipKey('198.51.100.9')}`]);
});

test('counts are kept in the table, one row per key and window', async () => {
    expect(await store.hit('write:u-test', 60_000, NOW)).toBe(1);
    expect(await store.hit('write:u-test', 60_000, NOW + 1000)).toBe(2);
    expect(await store.peek('write:u-test', 60_000, NOW + 2000)).toBe(2);
    expect(await store.peek('write:u-test', 60_000, NOW + 60_000)).toBe(0);
    const rows = (await query('SELECT count FROM rate_limits WHERE key = $1', ['write:u-test'])).rows;
    expect(rows).toEqual([{ count: 2 }]);
});

test('the write limit refuses the 61st change in a minute', async () => {
    const who = { userId: -Math.floor(Math.random() * 1e6) - 1 };
    for (let index = 0; index < WRITE_LIMIT.max; index++) expect(await allowWrite(who, store, NOW)).toBe(true);
    expect(await allowWrite(who, store, NOW)).toBe(false);
});

test('failed sign-ins are counted by a hash of the address, which is never stored', async () => {
    for (let index = 0; index < AUTH_LIMIT.max; index++) await recordAuthFailure('198.51.100.9', store, NOW);
    expect(await authBlocked('198.51.100.9', store, NOW)).toBe(true);
    const keys = (await query('SELECT key FROM rate_limits WHERE key LIKE $1', ['auth:%'])).rows.map(row => row.key);
    expect(keys.some(key => key.includes('198.51'))).toBe(false);
});
