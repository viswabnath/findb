/**
 * Database transaction helpers for the Next.js app. Framework-free (no Next.js imports).
 * Every multi-statement write goes through withTransaction (tests/atomic-writes.test.js checks the source).
 *
 * Never run `pool.query('BEGIN')`: a pg Pool may send each query to a different
 * connection, so the statements are not atomic and the open transaction leaks to
 * whichever request uses that connection next.
 */
import { escapeIdentifier, type Pool, type PoolClient } from 'pg';

/** The part of a pg Pool these helpers need; makes them easy to test without a database */
export type TransactionPool = Pick<Pool, 'connect'>;

/** Marks the database handle of a user's request (withUserScope): its transactions become savepoints */
const SCOPED = Symbol('findb.userScope');
type Scoped = { [SCOPED]: { nextSavepoint: number } };

function scopeOf(pool: TransactionPool): Scoped[typeof SCOPED] | undefined {
    return (pool as Partial<Scoped>)[SCOPED];
}

/**
 * Run `fn` inside one transaction on a single checked-out connection.
 * Commits if `fn` resolves, rolls back if it throws, and always releases the connection
 * (closing it if the rollback failed).
 */
export async function withTransaction<T>(
    pool: TransactionPool,
    fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const scope = scopeOf(pool);
    if (scope) {
        // Inside a user's request, which is already one transaction: a savepoint gives the same
        // all-or-nothing result for this group of writes
        const client = await pool.connect();
        const savepoint = `findb_sp_${scope.nextSavepoint++}`;
        await client.query(`SAVEPOINT ${savepoint}`);
        try {
            const result = await fn(client);
            await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            return result;
        } catch (error) {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            throw error;
        }
    }
    const client = await pool.connect();
    // Set when ROLLBACK fails: the connection's state is then unknown (for example a query that
    // timed out may still be running), so it is closed instead of going back to the pool
    let broken: Error | undefined;
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        // A failed ROLLBACK must not hide the original error
        await client.query('ROLLBACK').catch((rollbackError: Error) => { broken = rollbackError; });
        throw error;
    } finally {
        client.release(broken);
    }
}

/** The role a user's requests run as (db/migrations/0006_user_isolation.sql): row level security applies to it */
export const USER_ROLE = 'findb_user';

/**
 * Run a logged-in user's request (docs/security.md, database-enforced isolation): one transaction
 * on one connection, switched to USER_ROLE with app.user_id set to the user, so the row level
 * security policies let every query see and change only that user's rows, even one that forgot
 * its own user_id filter. Both settings are local to the transaction, so nothing carries over to
 * the next user of the pooled connection.
 *
 * `fn` gets a Pool-like handle: its queries run in this transaction, and withTransaction on it
 * uses a savepoint. The transaction commits when `fn` ends, also when it throws, so a write made
 * outside withTransaction stays, as it would without the scope; a transaction broken by an SQL
 * error rolls back instead (Postgres turns that COMMIT into a ROLLBACK).
 */
export async function withUserScope<T>(pool: Pool, userId: number, fn: (scoped: Pool) => Promise<T>): Promise<T> {
    if (!Number.isInteger(userId)) throw new Error('withUserScope needs a whole-number user id');
    const client = await pool.connect();
    let broken: Error | undefined;
    try {
        // One round trip; both values are safe to write in: an escaped role name and an integer
        await client.query(`BEGIN; SET LOCAL ROLE ${escapeIdentifier(USER_ROLE)}; SELECT set_config('app.user_id', '${userId}', true)`);
        const scoped = {
            [SCOPED]: { nextSavepoint: 1 },
            query: client.query.bind(client),
            // withTransaction's client: the same connection, which it must not release
            connect: async () => ({ query: client.query.bind(client), release: () => undefined }) as unknown as PoolClient,
        } as unknown as Pool;
        try {
            return await fn(scoped);
        } finally {
            await client.query('COMMIT');
        }
    } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: Error) => { broken = rollbackError; });
        throw error;
    } finally {
        client.release(broken);
    }
}

/**
 * An expected failure (validation, not found) raised inside a transaction.
 * Throwing it rolls the transaction back; the route turns it into an HTTP response.
 */
export class RequestError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'RequestError';
        this.status = status;
    }
}
