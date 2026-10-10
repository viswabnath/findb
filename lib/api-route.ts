import type { NextRequest } from 'next/server';
import { ownerPool, requestScope } from './db';
import { allowRequest, authBlocked, recordAuthFailure } from './rate-limit';
import { SESSION_COOKIE, sessionUserId } from './session';
import { RequestError, withUserScope } from './transaction';

/**
 * Shared plumbing for the API route handlers, matching the legacy Express app's responses:
 * the same 401 and 429 bodies, RequestError for expected failures, and a generic 500 otherwise.
 */

const GENERIC_ERROR = 'An error occurred. Please try again.';
const BUSY_ERROR = 'FinDB is busy right now. Please try again in a moment.';

/**
 * Postgres codes for a wait cut short by the transaction time limits (lib/transaction.ts): a lock
 * not granted in time (55P03), or a query cancelled for running too long (57014). Nothing was
 * changed, so the user can simply try again.
 */
const BUSY_CODES = new Set(['55P03', '57014']);
const isBusy = (error: unknown) => BUSY_CODES.has(String((error as { code?: unknown } | null)?.code));

/** The database refused to mix sample data with real money (FS001, migration 0018); its message is for the user */
const isSampleRefusal = (error: unknown): error is Error => (error as { code?: unknown } | null)?.code === 'FS001';

export function jsonError(status: number, error: string): Response {
    return Response.json({ error }, { status });
}

/** The client's IP for rate limiting: the first X-Forwarded-For entry (set by Vercel and the local router) */
export function clientIp(request: NextRequest): string {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/** The parsed JSON body, or {} when there is none or it is not an object (Express's json parser did the same) */
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
    try {
        const body: unknown = await request.json();
        return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

/** Whether the request reached us over HTTPS (session cookies are Secure only then) */
export function isHttps(request: NextRequest): boolean {
    return request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
}

type AuthedHandler<C> = (request: NextRequest, userId: number, context: C) => Promise<Response>;

interface PublicOptions {
    /** Count failed answers toward the auth limit (5 per 15 minutes per IP), and refuse when it is reached */
    authLimited?: boolean;
    /** The legacy route's own 500 message (for example "Login failed. Please try again.") */
    errorMessage?: string;
}

/** Wrap a handler that works without a login (register, login, recovery, logout) */
export function withPublic(handler: (request: NextRequest) => Promise<Response>, options: PublicOptions = {}) {
    return async (request: NextRequest): Promise<Response> => {
        const ip = clientIp(request);
        if (!allowRequest(ip)) return jsonError(429, 'Too many requests. Please slow down.');
        if (options.authLimited && authBlocked(ip)) {
            return jsonError(429, 'Too many authentication attempts. Please try again in 15 minutes.');
        }
        let response: Response;
        try {
            response = await handler(request);
        } catch (error) {
            if (error instanceof RequestError) {
                response = jsonError(error.status, error.message);
            } else {
                console.error(`${request.method} ${request.nextUrl.pathname} failed:`, error);
                response = isBusy(error) ? jsonError(503, BUSY_ERROR) : jsonError(500, options.errorMessage ?? GENERIC_ERROR);
            }
        }
        // Like express-rate-limit with skipSuccessfulRequests: only failed answers count
        if (options.authLimited && response.status >= 400) recordAuthFailure(ip);
        return response;
    };
}

/**
 * Wrap a handler that needs a logged-in user: applies the general rate limit, reads the session
 * (401 when there is none), and turns errors into the legacy JSON responses.
 */
export function withUser<C>(handler: AuthedHandler<C>) {
    return async (request: NextRequest, context: C): Promise<Response> => {
        if (!allowRequest(clientIp(request))) {
            return jsonError(429, 'Too many requests. Please slow down.');
        }
        try {
            const userId = await sessionUserId(ownerPool(), request.cookies.get(SESSION_COOKIE)?.value);
            if (userId === null) return jsonError(401, 'Authentication required');
            // Everything the handler does with db() runs as the user, limited to their rows by the
            // database itself (docs/security.md)
            return await withUserScope(ownerPool(), userId,
                scoped => requestScope.run(scoped, () => handler(request, userId, context)));
        } catch (error) {
            if (error instanceof RequestError) return jsonError(error.status, error.message);
            if (isSampleRefusal(error)) return jsonError(400, error.message);
            console.error(`${request.method} ${request.nextUrl.pathname} failed:`, error);
            return isBusy(error) ? jsonError(503, BUSY_ERROR) : jsonError(500, GENERIC_ERROR);
        }
    };
}

/** The browser's user agent, for the session list and login history */
export function userAgent(request: NextRequest): string | null {
    return request.headers.get('user-agent');
}
