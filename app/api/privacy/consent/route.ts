import { jsonBody, userAgent, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { giveConsent } from '@/lib/services/privacy';

// { noticeVersion }: agree to the current privacy notice (an account from before it, or after withdrawing)
export const POST = withUser(async (request, userId) => {
    await giveConsent(db(), userId, await jsonBody(request), userAgent(request));
    return Response.json({ success: true });
});
