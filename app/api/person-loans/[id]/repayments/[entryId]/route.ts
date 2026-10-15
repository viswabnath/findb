import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteRepayment } from '@/lib/services/people';

/** The [id] and [entryId] segments: a loan's id, and the entry of a repayment or settlement on it */
type Context = { params: Promise<{ id: string; entryId: string }> };

export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id, entryId } = await context.params;
    return Response.json(await deleteRepayment(db(), userId, id, entryId));
});
