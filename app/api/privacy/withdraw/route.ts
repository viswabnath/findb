import { isHttps, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { withdrawConsent } from '@/lib/services/privacy';
import { clearSessionCookie, clearSignedInHintCookie } from '@/lib/session';

// Withdraw consent to the privacy notice: recorded, and the account is signed out everywhere
export const POST = withUser(async (request, userId) => {
    await withdrawConsent(db(), userId);
    const headers = new Headers({ 'Set-Cookie': clearSessionCookie(isHttps(request)) });
    headers.append('Set-Cookie', clearSignedInHintCookie(isHttps(request)));
    return Response.json({ success: true }, { headers });
});
