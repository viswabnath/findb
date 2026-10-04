import { isHttps, userAgent, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { listSessions, signOutEverywhere } from '@/lib/services/security';
import { clearSessionCookie, clearSignedInHintCookie, SESSION_COOKIE, sessionIdFromCookie } from '@/lib/session';

// The user's signed-in sessions, newest use first; `current` marks this one
export const GET = withUser(async (request, userId) =>
    Response.json(await listSessions(db(), userId, sessionIdFromCookie(request.cookies.get(SESSION_COOKIE)?.value))));

// Sign out everywhere, this browser included
export const DELETE = withUser(async (request, userId) => {
    await signOutEverywhere(db(), userId, userAgent(request));
    const headers = new Headers({ 'Set-Cookie': clearSessionCookie(isHttps(request)) });
    headers.append('Set-Cookie', clearSignedInHintCookie(isHttps(request)));
    return Response.json({ success: true }, { headers });
});
