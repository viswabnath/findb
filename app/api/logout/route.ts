import { isHttps, withPublic } from '@/lib/api-route';
import { db } from '@/lib/db';
import { clearSessionCookie, clearSignedInHintCookie, destroySession, SESSION_COOKIE } from '@/lib/session';

// Deletes the session and clears the sessionId cookie (Express cleared the wrong cookie name)
export const POST = withPublic(async (request) => {
    await destroySession(db(), request.cookies.get(SESSION_COOKIE)?.value);
    const headers = new Headers({ 'Set-Cookie': clearSessionCookie(isHttps(request)) });
    headers.append('Set-Cookie', clearSignedInHintCookie(isHttps(request)));
    return Response.json({ success: true }, { headers });
}, { errorMessage: 'Logout failed' });
