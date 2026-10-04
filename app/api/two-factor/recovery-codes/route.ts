import { jsonBody, userAgent, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { regenerateRecoveryCodes } from '@/lib/services/security';

// { code }: new recovery codes, replacing the old ones, after a current code from the app
export const POST = withUser(async (request, userId) => {
    const recoveryCodes = await regenerateRecoveryCodes(db(), userId, (await jsonBody(request)).code, userAgent(request));
    return Response.json({ success: true, recoveryCodes }, { headers: { 'Cache-Control': 'no-store' } });
});
