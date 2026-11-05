import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { unsubscribe } from '@/lib/services/reminders';

// { endpoint } or { id }: turn reminders off for one device
export const POST = withUser(async (request, userId) => {
    await unsubscribe(db(), userId, await jsonBody(request));
    return Response.json({ success: true });
});
