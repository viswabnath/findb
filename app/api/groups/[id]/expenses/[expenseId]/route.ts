import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteSharedExpense } from '@/lib/services/groups';

/** The [id] and [expenseId] segments: a group, and one of its shared expenses */
type Context = { params: Promise<{ id: string; expenseId: string }> };

export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id, expenseId } = await context.params;
    return Response.json(await deleteSharedExpense(db(), userId, id, expenseId));
});
