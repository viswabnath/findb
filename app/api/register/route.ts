import { jsonBody, userAgent, withPublic } from '@/lib/api-route';
import { db } from '@/lib/db';
import { startPendingLogin } from '@/lib/login-flow';
import { register } from '@/lib/services/auth';

// Registration starts a pending login at two-factor setup: the new account is signed in once its
// first code is confirmed (/api/two-factor/setup)
export const POST = withPublic(async (request) => {
    const userId = await register(db(), await jsonBody(request), userAgent(request));
    const headers = await startPendingLogin(request, userId, 'setup');
    return Response.json({ success: true, userId, twoFactor: 'setup' }, { headers });
}, { authLimited: true, errorMessage: 'Registration failed. Please try again.' });
