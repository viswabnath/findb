import { jsonBody, userAgent, withPublic } from '@/lib/api-route';
import { db } from '@/lib/db';
import { finishLogin, requirePendingLogin } from '@/lib/login-flow';
import { confirmTwoFactorSetup, twoFactorSetupInfo } from '@/lib/services/security';

// During a login waiting for two-factor setup: the secret to add to an authenticator app
export const GET = withPublic(async (request) => {
    const pending = await requirePendingLogin(request, ['setup']);
    const info = await twoFactorSetupInfo(db(), pending.userId);
    return Response.json(info, { headers: { 'Cache-Control': 'no-store' } });
});

// { code }: the first code from the app turns two-factor login on, returns the recovery codes
// (shown once) and finishes the login
export const POST = withPublic(async (request) => {
    const pending = await requirePendingLogin(request, ['setup']);
    const recoveryCodes = await confirmTwoFactorSetup(db(), pending.userId, (await jsonBody(request)).code, userAgent(request));
    const headers = await finishLogin(request, pending);
    headers.set('Cache-Control', 'no-store');
    return Response.json({ success: true, recoveryCodes }, { headers });
}, { authLimited: true });
