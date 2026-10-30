import { createHash } from 'node:crypto';

/**
 * Request rate limits for the API route handlers:
 *   - 100 requests a minute per IP, counted in memory on each server instance (every request, so
 *     kept cheap: no database round trip);
 *   - 60 writes (POST, PUT, PATCH, DELETE) a minute per signed-in user, or per IP when signed out;
 *   - 5 failed sign-in attempts per 15 minutes per IP.
 * The last two are counted in Postgres (PostgresRateLimitStore, migration 0035), so they hold
 * however many instances run. Keys carry a user id or a hash of the IP, never the IP itself.
 *
 * Skipped when DISABLE_RATE_LIMIT=true (the end-to-end and contract runs drive a server faster
 * than a person would). The auth limit is also skipped in development.
 */

export interface RateLimitStore {
    /** Count one hit for key in the current window; returns the count so far in that window */
    hit(key: string, windowMs: number, now: number): Promise<number>;
    /** The count so far in the current window, without counting a hit */
    peek(key: string, windowMs: number, now: number): Promise<number>;
}

export class MemoryRateLimitStore implements RateLimitStore {
    private readonly windows = new Map<string, { start: number; count: number }>();

    async peek(key: string, windowMs: number, now: number): Promise<number> {
        const current = this.windows.get(key);
        return current && now - current.start < windowMs ? current.count : 0;
    }

    async hit(key: string, windowMs: number, now: number): Promise<number> {
        const current = this.windows.get(key);
        if (!current || now - current.start >= windowMs) {
            // Drop expired windows now and then so the map does not grow without bound
            if (this.windows.size > 10_000) {
                for (const [entryKey, entry] of this.windows) {
                    if (now - entry.start >= windowMs) this.windows.delete(entryKey);
                }
            }
            this.windows.set(key, { start: now, count: 1 });
            return 1;
        }
        current.count += 1;
        return current.count;
    }
}

interface Queryable {
    query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Windows older than this are deleted as new ones are counted */
const KEEP_MS = 24 * 60 * 60_000;

/**
 * Counts in the rate_limits table (migration 0035), in fixed windows, one upsert a hit. A database
 * that cannot be reached lets the request through (a warning is logged): the limit protects the
 * service, it must not take it down.
 */
export class PostgresRateLimitStore implements RateLimitStore {
    constructor(private readonly pool: () => Queryable, private readonly random: () => number = Math.random) {}

    async hit(key: string, windowMs: number, now: number): Promise<number> {
        try {
            const result = await this.pool().query(
                `INSERT INTO rate_limits (key, window_start) VALUES ($1, $2)
                 ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1, updated_at = now()
                 RETURNING count`, [key, Math.floor(now / windowMs)]);
            // About one hit in a hundred clears out old windows
            if (this.random() < 0.01) await this.pool().query('DELETE FROM rate_limits WHERE updated_at < $1', [new Date(now - KEEP_MS)]);
            return Number(result.rows[0]!.count);
        } catch (error) {
            console.warn('Warning: rate limit not counted:', (error as Error).message);
            return 0;
        }
    }

    async peek(key: string, windowMs: number, now: number): Promise<number> {
        try {
            const result = await this.pool().query('SELECT count FROM rate_limits WHERE key = $1 AND window_start = $2', [key, Math.floor(now / windowMs)]);
            return result.rows[0] ? Number(result.rows[0].count) : 0;
        } catch (error) {
            console.warn('Warning: rate limit not read:', (error as Error).message);
            return 0;
        }
    }
}

/** A short hash of an IP address, so the shared table never holds the address itself */
export function ipKey(ip: string): string {
    return createHash('sha256').update(ip).digest('base64url').slice(0, 22);
}

const limitsOff = () => process.env.DISABLE_RATE_LIMIT === 'true';

export const GENERAL_LIMIT = { max: 100, windowMs: 60_000 };

const generalStore = new MemoryRateLimitStore();

/** False when this IP has used up the general limit for the current minute */
export async function allowRequest(ip: string, store: RateLimitStore = generalStore, now: number = Date.now()): Promise<boolean> {
    if (limitsOff()) return true;
    return (await store.hit(`general:${ip}`, GENERAL_LIMIT.windowMs, now)) <= GENERAL_LIMIT.max;
}

export const WRITE_LIMIT = { max: 60, windowMs: 60_000 };

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Whether a request changes something, and so counts toward the write limit */
export const isWrite = (method: string) => WRITE_METHODS.has(method.toUpperCase());

/** False when this user (or, signed out, this IP) has used up the write limit for the current minute */
export async function allowWrite(who: { userId: number } | { ip: string }, store: RateLimitStore, now: number = Date.now()): Promise<boolean> {
    if (limitsOff()) return true;
    const key = 'userId' in who ? `write:u${who.userId}` : `write:ip:${ipKey(who.ip)}`;
    return (await store.hit(key, WRITE_LIMIT.windowMs, now)) <= WRITE_LIMIT.max;
}

export const AUTH_LIMIT = { max: 5, windowMs: 15 * 60_000 };

const authLimitSkipped = () => limitsOff() || process.env.NODE_ENV === 'development';

/** True when this IP has had 5 failed auth attempts in the current 15 minutes (successful ones do not count) */
export async function authBlocked(ip: string, store: RateLimitStore, now: number = Date.now()): Promise<boolean> {
    if (authLimitSkipped()) return false;
    return (await store.peek(`auth:${ipKey(ip)}`, AUTH_LIMIT.windowMs, now)) >= AUTH_LIMIT.max;
}

/** Count one failed auth attempt (any 4xx or 5xx answer) */
export async function recordAuthFailure(ip: string, store: RateLimitStore, now: number = Date.now()): Promise<void> {
    if (authLimitSkipped()) return;
    await store.hit(`auth:${ipKey(ip)}`, AUTH_LIMIT.windowMs, now);
}
