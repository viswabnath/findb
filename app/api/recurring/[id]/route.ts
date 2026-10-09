import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteRepeating, updateRepeating } from '@/lib/services/recurring';

/** The [id] segment: a repeating entry's id */
type Context = { params: Promise<{ id: string }> };

// Any field of POST /api/recurring, and { paused }; the rest stay
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await updateRepeating(db(), userId, id, await jsonBody(request)));
});

// Entries it already made stay
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await deleteRepeating(db(), userId, id);
    return Response.json({ success: true });
});
