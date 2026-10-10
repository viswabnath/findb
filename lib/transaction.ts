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

/**
 * Time limits every transaction sets for itself, so a wait fails fast with a clear error instead of
 * hanging until the client gives up (lib/db.ts: 20 s), and the database cleans up after it:
 *   - lock_timeout: waiting for a row another request has locked stops after 5 seconds;
 *   - statement_timeout: the database cancels a query after 15 seconds, before the client gives up,
 *     so the query does not keep running on its own;
 *   - idle_in_transaction_session_timeout: a transaction left open for 15 seconds between queries is
 *     ended, so it cannot hold locks for minutes.
 * All are local to the transaction, so nothing carries over on a pooled connection.
 */
export const TRANSACTION_LIMITS = "SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s'; "
    + "SET LOCAL idle_in_transaction_session_timeout = '15s'";

/** A query slower than this is logged (its SQL only; values are sent separately and never logged) */
const SLOW_QUERY_MS = 2000;

/** Log a slow query with the start of its SQL, so a slow request can be traced in the server logs */
function noteSlowQuery(sql: unknown, startedAt: number): void {
    const elapsed = Date.now() - startedAt;
    if (elapsed < SLOW_QUERY_MS) return;
    const text = typeof sql === 'string' ? sql : (sql as { text?: string } | null)?.text ?? '';
    console.warn(`Warning: slow query (${elapsed} ms): ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
}

/** A client whose queries are timed (noteSlowQuery) */
function timed(client: PoolClient): PoolClient['query'] {
    return (async (...args: unknown[]) => {
        const startedAt = Date.now();
        try {
            return await (client.query as (...params: unknown[]) => Promise<unknown>)(...args);
        } finally {
            noteSlowQuery(args[0], startedAt);
        }
    }) as PoolClient['query'];
}

/**
 * Whether an error came from the connection rather than from Postgres or the app: a query that
 * timed out on the client (lib/db.ts), or a connection that broke. After one, nothing more may be sent on the connection: a ROLLBACK or
 * COMMIT would wait behind the stuck query (20 s each), and the connection would go back to the
 * pool still stuck, stalling later requests. It is closed instead, which ends its transaction.
 */
export function isConnectionError(error: unknown): boolean {
    if (!(error instanceof Error) || error instanceof RequestError) return false;
    const code = (error as { code?: unknown }).code;
    // A Postgres error: the connection is fine, the transaction can be rolled back as usual
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return false;
    // Node's network errors (ECONNRESET, ETIMEDOUT, EPIPE...) and pg's own connection messages
    return (typeof code === 'string' && /^E[A-Z]+$/.test(code))
        || /Query read timeout|Connection terminated|Client has encountered a connection error|Connection is not open/i.test(error.message);
}

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
            // After a connection error, withUserScope closes the connection; nothing more is sent
            if (!isConnectionError(error)) await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            throw error;
        }
    }
    const client = await pool.connect();
    // Set when the connection's state is unknown (a connection error, or a failed ROLLBACK): it is
    // then closed instead of going back to the pool
    let broken: Error | undefined;
    try {
        await client.query(`BEGIN; ${TRANSACTION_LIMITS}`);
        const result = await fn(Object.assign(Object.create(null), { query: timed(client), release: () => undefined }) as PoolClient);
        await commit(client);
        return result;
    } catch (error) {
        if (isConnectionError(error)) {
            broken = error as Error;
        } else if (!(error instanceof RolledBackAtCommit)) {
            // A failed ROLLBACK must not hide the original error
            await client.query('ROLLBACK').catch((rollbackError: Error) => { broken = rollbackError; });
        }
        throw error;
    } finally {
        client.release(broken);
    }
}

/**
 * COMMIT, and make sure it was one: Postgres answers COMMIT in a transaction broken by an earlier
 * error with ROLLBACK and no error, which would let a request report success for changes that
 * were never saved.
 */
async function commit(client: Pick<PoolClient, 'query'>): Promise<void> {
    const result = await client.query('COMMIT');
    if ((result as { command?: string } | undefined)?.command === 'ROLLBACK') throw new RolledBackAtCommit();
}

/** Thrown by commit(): the transaction is over (nothing to roll back), and nothing was saved */
class RolledBackAtCommit extends Error {
    constructor() {
        super('The transaction was rolled back at COMMIT: an earlier statement failed');
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
    let closed = false;
    try {
        // One round trip; both values are safe to write in: an escaped role name and an integer
        await client.query(`BEGIN; SET LOCAL ROLE ${escapeIdentifier(USER_ROLE)}; ${TRANSACTION_LIMITS}; `
            + `SELECT set_config('app.user_id', '${userId}', true)`);
        const query = timed(client);
        const scoped = {
            [SCOPED]: { nextSavepoint: 1 },
            query,
            // withTransaction's client: the same connection, which it must not release
            connect: async () => ({ query, release: () => undefined }) as unknown as PoolClient,
        } as unknown as Pool;
        let result: T;
        try {
            result = await fn(scoped);
        } catch (error) {
            // Committed all the same (see above), unless the connection itself failed
            if (isConnectionError(error)) {
                broken = error as Error;
                throw error;
            }
            await client.query('COMMIT');
            closed = true;
            throw error;
        }
        try {
            await commit(client);
        } finally {
            closed = true;
        }
        return result;
    } catch (error) {
        if (isConnectionError(error)) broken ??= error as Error;
        // Only while the transaction may still be open (BEGIN or COMMIT failed): after a COMMIT,
        // a ROLLBACK would only draw "there is no transaction in progress"
        if (!closed && !broken) await client.query('ROLLBACK').catch((rollbackError: Error) => { broken = rollbackError; });
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
