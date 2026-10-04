import { AsyncLocalStorage } from 'async_hooks';
import { Pool } from 'pg';

/**
 * The app's Postgres pool:
 *   - DB_SCHEMA selects the schema (tests: balancetrack_test; production: unset, so public);
 *   - SSL when DB_SSL=true or in production;
 *   - client-side time limits, so a stalled connection fails instead of hanging.
 *
 * REQUIRE_TEST_SCHEMA=true (set by `npm test` and the end-to-end runs) refuses to connect to
 * anything but a *_test schema, so a test server can never write production data.
 */
const globalForDb = globalThis as unknown as { findbPool?: Pool };

function createPool(): Pool {
    const schema = process.env.DB_SCHEMA;
    if (process.env.REQUIRE_TEST_SCHEMA === 'true' && !/_test$/.test(schema ?? '')) {
        throw new Error(`Refusing to connect: REQUIRE_TEST_SCHEMA is set but DB_SCHEMA is "${schema ?? ''}"`);
    }
    return new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: Number(process.env.DB_PORT || 5432),
        ssl: process.env.DB_SSL === 'true' || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        ...(schema ? { options: `-c search_path=${schema}` } : {}),
        connectionTimeoutMillis: 10000,
        query_timeout: 20000,
        keepAlive: true,
    });
}

/** The shared pool, created on first use (one per server instance; reused across hot reloads in dev) */
export function ownerPool(): Pool {
    globalForDb.findbPool ??= createPool();
    return globalForDb.findbPool;
}

/** The current request's user-scoped database, set by withUser */
export const requestScope = new AsyncLocalStorage<Pool>();

/**
 * The database for the code running now. Inside a logged-in request (withUser in lib/api-route.ts)
 * that is the request's own transaction as the row-level-security role, limited to the user's rows
 * (withUserScope in lib/transaction.ts). Elsewhere (login, registration, recovery, the session
 * check) it is the pool, as the tables' owner.
 */
export function db(): Pool {
    return requestScope.getStore() ?? ownerPool();
}
