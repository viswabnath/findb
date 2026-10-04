import { jsonBody, userAgent, withPublic } from '@/lib/api-route';
import { db } from '@/lib/db';
import { finishLogin, requirePendingLogin } from '@/lib/login-flow';
import { verifyLoginCode } from '@/lib/services/security';

// Step two: { code } from the authenticator app, or { recoveryCode }. Finishes the login with a new session.
export const POST = withPublic(async (request) => {
    const pending = await requirePendingLogin(request, ['verify']);
    const user = await verifyLoginCode(db(), pending.userId, await jsonBody(request), userAgent(request));
    const headers = await finishLogin(request, pending);
    return Response.json(
        { success: true, userId: pending.userId, name: user.name, trackingOption: user.tracking_option },
        { headers },
    );
}, { authLimited: true, errorMessage: 'Login failed. Please try again.' });
