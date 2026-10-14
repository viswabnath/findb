import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteBudget } from '@/lib/services/budgets';

/** The [id] segment: a budget's id */
type Context = { params: Promise<{ id: string }> };

export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await deleteBudget(db(), userId, id);
    return Response.json({ success: true });
});
