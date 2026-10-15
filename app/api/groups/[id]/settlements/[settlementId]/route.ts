import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteSettlement } from '@/lib/services/groups';

/** The [id] and [settlementId] segments: a group, and one of its settlements */
type Context = { params: Promise<{ id: string; settlementId: string }> };

export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id, settlementId } = await context.params;
    return Response.json(await deleteSettlement(db(), userId, id, settlementId));
});
