import { jsonBody, userAgent, withPublic } from '@/lib/api-route';
import { db } from '@/lib/db';
import { startPendingLogin } from '@/lib/login-flow';
import { login } from '@/lib/services/auth';

// Step one of a login: the password. A right one starts a pending login (no session yet), which
// the two-factor code finishes (/api/login/two-factor), or two-factor setup for an account that
// has not set it up (/api/two-factor/setup). Any session the browser had is ended.
export const POST = withPublic(async (request) => {
    const user = await login(db(), await jsonBody(request), userAgent(request));
    const twoFactor = user.twoFactorEnabled ? 'verify' : 'setup';
    const headers = await startPendingLogin(request, user.id, twoFactor);
    return Response.json({ success: true, twoFactor }, { headers });
}, { authLimited: true, errorMessage: 'Login failed. Please try again.' });
