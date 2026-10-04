/**
 * Unit tests for lib/transaction.ts (no database)
 */
import type { Pool, PoolClient } from 'pg';
import { withTransaction, withUserScope, RequestError, type TransactionPool } from '../../lib/transaction';

function mockPool({ failOn }: { failOn?: string } = {}) {
    const statements: string[] = [];
    const client = {
        query: jest.fn(async (sql: string) => {
            statements.push(sql);
            if (failOn && sql === failOn) throw new Error(`${sql} failed`);
            return { rows: [] };
        }),
        release: jest.fn(),
    };
    const pool = { connect: jest.fn(async () => client as unknown as PoolClient) } as unknown as TransactionPool;
    return { pool, client, statements };
}

describe('withTransaction', () => {
    test('runs BEGIN, the work and COMMIT on one connection, then releases it', async () => {
        const { pool, client, statements } = mockPool();

        const result = await withTransaction(pool, async (tx) => {
            await tx.query('INSERT 1');
            return 'done';
        });

        expect(result).toBe('done');
        expect(pool.connect).toHaveBeenCalledTimes(1);
        expect(statements).toEqual(['BEGIN', 'INSERT 1', 'COMMIT']);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('rolls back and rethrows when the work throws', async () => {
        const { pool, client, statements } = mockPool();
        const failure = new RequestError(400, 'Insufficient bank balance');

        await expect(withTransaction(pool, async () => { throw failure; })).rejects.toBe(failure);

        expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('keeps the original error when ROLLBACK itself fails', async () => {
        const { pool, client } = mockPool({ failOn: 'ROLLBACK' });
        const failure = new Error('insert failed');

        await expect(withTransaction(pool, async () => { throw failure; })).rejects.toBe(failure);
        expect(client.release).toHaveBeenCalledTimes(1);
        // The connection's state is unknown, so it is closed rather than reused
        expect(client.release.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    test('rolls back when COMMIT fails', async () => {
        const { pool, client, statements } = mockPool({ failOn: 'COMMIT' });

        await expect(withTransaction(pool, async () => 'ok')).rejects.toThrow('COMMIT failed');
        expect(statements).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
        expect(client.release).toHaveBeenCalledTimes(1);
    });
});

describe('RequestError', () => {
    test('carries an HTTP status and message', () => {
        const error = new RequestError(404, 'Income transaction not found');

        expect(error).toBeInstanceOf(Error);
        expect(error.status).toBe(404);
        expect(error.message).toBe('Income transaction not found');
    });
});

describe('withUserScope', () => {
    test('one transaction as findb_user with app.user_id, committed at the end', async () => {
        const { pool, client, statements } = mockPool();

        const result = await withUserScope(pool as unknown as Pool, 42, async (scoped) => {
            await scoped.query('SELECT 1');
            return 'done';
        });

        expect(result).toBe('done');
        expect(statements).toEqual([
            'BEGIN; SET LOCAL ROLE "findb_user"; SELECT set_config(\'app.user_id\', \'42\', true)',
            'SELECT 1',
            'COMMIT',
        ]);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('withTransaction inside it uses a savepoint on the same connection', async () => {
        const { pool, statements } = mockPool();

        await withUserScope(pool as unknown as Pool, 7, async (scoped) => {
            await withTransaction(scoped, async (tx) => { await tx.query('INSERT 1'); });
            await expect(withTransaction(scoped, async (tx) => {
                await tx.query('INSERT 2');
                throw new RequestError(400, 'no');
            })).rejects.toThrow('no');
        });

        expect(statements.slice(1)).toEqual([
            'SAVEPOINT findb_sp_1', 'INSERT 1', 'RELEASE SAVEPOINT findb_sp_1',
            'SAVEPOINT findb_sp_2', 'INSERT 2', 'ROLLBACK TO SAVEPOINT findb_sp_2',
            'COMMIT',
        ]);
        expect(pool.connect).toHaveBeenCalledTimes(1);
    });

    test('commits writes made before an expected failure, and rethrows it', async () => {
        const { pool, statements } = mockPool();
        const failure = new RequestError(400, 'That code is not right');

        await expect(withUserScope(pool as unknown as Pool, 7, async (scoped) => {
            await scoped.query('INSERT wrong_code event');
            throw failure;
        })).rejects.toBe(failure);

        expect(statements.slice(1, 3)).toEqual(['INSERT wrong_code event', 'COMMIT']);
    });

    test('refuses a user id that is not a whole number', async () => {
        const { pool } = mockPool();
        await expect(withUserScope(pool as unknown as Pool, 1.5, async () => 'x')).rejects.toThrow('whole-number user id');
        await expect(withUserScope(pool as unknown as Pool, Number.NaN, async () => 'x')).rejects.toThrow('whole-number user id');
        expect(pool.connect).not.toHaveBeenCalled();
    });
});
