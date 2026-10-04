import { isHttps, jsonBody, withPublic } from '@/lib/api-route';
import { db } from '@/lib/db';
import { register } from '@/lib/services/auth';
import { createSession, destroySession, SESSION_COOKIE, signedInHintCookie } from '@/lib/session';

// Registration also logs the new user in, with a fresh session
export const POST = withPublic(async (request) => {
    const userId = await register(db(), await jsonBody(request));
    await destroySession(db(), request.cookies.get(SESSION_COOKIE)?.value);
    const cookie = await createSession(db(), userId, isHttps(request));
    const headers = new Headers({ 'Set-Cookie': cookie });
    headers.append('Set-Cookie', signedInHintCookie(isHttps(request)));
    return Response.json({ success: true, userId }, { headers });
}, { authLimited: true, errorMessage: 'Registration failed. Please try again.' });
