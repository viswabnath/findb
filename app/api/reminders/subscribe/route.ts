import { jsonBody, userAgent, withUser } from '@/lib/api-route';
import { ownerPool } from '@/lib/db';
import { subscribe } from '@/lib/services/reminders';

// { endpoint, keys: { p256dh, auth } }: turn reminders on for this device. Runs as the owner: a
// browser that was subscribed for another account hands its subscription over.
export const POST = withUser(async (request, userId) => {
    await subscribe(ownerPool(), userId, await jsonBody(request), userAgent(request));
    return Response.json({ success: true });
});
