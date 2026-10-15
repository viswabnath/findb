import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { archiveGroup, updateGroup } from '@/lib/services/groups';

/** The [id] segment: a group's id */
type Context = { params: Promise<{ id: string }> };

// { name?, memberIds?, eventId? }
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await updateGroup(db(), userId, id, await jsonBody(request)));
});

// Removes a group once everyone is settled
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await archiveGroup(db(), userId, id);
    return Response.json({ success: true });
});
