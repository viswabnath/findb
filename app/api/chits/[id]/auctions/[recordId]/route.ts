import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteChitRecord } from '@/lib/services/chits';

/** The [id] and [recordId] segments: a chit, and one of its auctions */
type Context = { params: Promise<{ id: string; recordId: string }> };

export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id, recordId } = await context.params;
    return Response.json(await deleteChitRecord(db(), userId, id, 'auctions', recordId));
});
