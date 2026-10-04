import { isHttps, jsonBody, withPublic } from '@/lib/api-route';
import { db } from '@/lib/db';
import { login } from '@/lib/services/auth';
import { createSession, destroySession, SESSION_COOKIE, signedInHintCookie } from '@/lib/session';

// A new session id on every login, and the previous session (if any) removed: protects
// against session fixation, like express-session's regenerate
export const POST = withPublic(async (request) => {
    const user = await login(db(), await jsonBody(request));
    await destroySession(db(), request.cookies.get(SESSION_COOKIE)?.value);
    const cookie = await createSession(db(), user.id, isHttps(request));
    const headers = new Headers({ 'Set-Cookie': cookie });
    headers.append('Set-Cookie', signedInHintCookie(isHttps(request)));
    return Response.json(
        { success: true, userId: user.id, name: user.name, trackingOption: user.tracking_option },
        { headers },
    );
}, { authLimited: true, errorMessage: 'Login failed. Please try again.' });
