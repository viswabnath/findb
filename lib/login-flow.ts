import type { NextRequest } from 'next/server';
import { isHttps, userAgent } from './api-route';
import { db } from './db';
import {
    clearPendingLoginCookie, createPendingLogin, createSession, destroyPendingLogin, destroySession, pendingLogin,
    PENDING_LOGIN_COOKIE, SESSION_COOKIE, signedInHintCookie, type PendingLogin, type PendingStage,
} from './session';
import { RequestError } from './transaction';

/**
 * The steps of a login in the route handlers: a right password (or a new registration) starts a
 * pending login; the two-factor code, or confirming two-factor setup, finishes it with a session.
 */

/** Response headers that start a pending login, replacing any session or pending login the browser had */
export async function startPendingLogin(request: NextRequest, userId: number, stage: PendingStage): Promise<Headers> {
    await destroySession(db(), request.cookies.get(SESSION_COOKIE)?.value);
    const previous = await pendingLogin(db(), request.cookies.get(PENDING_LOGIN_COOKIE)?.value);
    if (previous) await destroyPendingLogin(db(), previous.sid);
    return new Headers({ 'Set-Cookie': await createPendingLogin(db(), userId, stage, isHttps(request)) });
}

/** The request's pending login at one of the given stages, or a 401 asking to log in again */
export async function requirePendingLogin(request: NextRequest, stages: PendingStage[]): Promise<PendingLogin> {
    const pending = await pendingLogin(db(), request.cookies.get(PENDING_LOGIN_COOKIE)?.value);
    if (!pending || !stages.includes(pending.stage)) throw new RequestError(401, 'Your login has expired. Log in again.');
    return pending;
}

/** Response headers that end the pending login and start a real session */
export async function finishLogin(request: NextRequest, pending: PendingLogin): Promise<Headers> {
    await destroyPendingLogin(db(), pending.sid);
    await destroySession(db(), request.cookies.get(SESSION_COOKIE)?.value);
    const headers = new Headers({ 'Set-Cookie': await createSession(db(), pending.userId, isHttps(request), userAgent(request)) });
    headers.append('Set-Cookie', signedInHintCookie(isHttps(request)));
    headers.append('Set-Cookie', clearPendingLoginCookie(isHttps(request)));
    return headers;
}
